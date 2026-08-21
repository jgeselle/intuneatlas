import {
  choiceSettingInstance,
  getSettingDefinition,
  groupSettingCollectionInstance,
  integerSettingInstance,
  isChoice,
  isGroup,
  stringCollectionSettingInstance,
  stringSettingInstance,
  type SettingDefinition,
} from "../seed-tenant/settingsCatalog.js";
import type { SeedClient } from "../seed-tenant/client.js";
import type { ExportedSetting } from "./parseExport.js";

/** Resolves every distinct id across the whole corpus once, cached, concurrency-limited. */
export async function resolveAllDefinitions(
  client: SeedClient,
  ids: string[],
): Promise<{ resolved: Map<string, SettingDefinition>; failures: Array<{ id: string; error: string }> }> {
  const resolved = new Map<string, SettingDefinition>();
  const failures: Array<{ id: string; error: string }> = [];

  async function resolveBatch(batchIds: string[]) {
    let cursor = 0;
    async function worker() {
      while (cursor < batchIds.length) {
        const id = batchIds[cursor++];
        if (resolved.has(id)) continue;
        try {
          resolved.set(id, await getSettingDefinition(client, id));
        } catch (err) {
          failures.push({ id, error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
  }

  await resolveBatch([...new Set(ids)]);

  // A child's rootDefinitionId may not have been in the originally
  // exported id list at all — confirmed live (LocalUsersAndGroups): some
  // export tools omit a group's own row entirely when only its children
  // were configured, since the group itself carries no value. Resolve
  // those too, so buildPolicyInstances can tell whether an unexported
  // root is actually a group (needs no value of its own — reconstructable
  // from children alone) or something else (does need one, and can't be
  // reconstructed if it's missing).
  const failedIds = new Set(failures.map((f) => f.id));
  const discoveredRootIds = [...resolved.values()]
    .map((def) => def.rootDefinitionId)
    .filter((id): id is string => Boolean(id) && !resolved.has(id!) && !failedIds.has(id!));
  if (discoveredRootIds.length > 0) {
    await resolveBatch([...new Set(discoveredRootIds)]);
  }

  return { resolved, failures };
}

/**
 * Reconstructs an option's real itemId from an exported applied_value.
 * The export format's choice values aren't consistent — sometimes a plain
 * numeric index (matching the `{definitionId}_{index}` itemId pattern
 * confirmed live), sometimes already-resolved display text, sometimes the
 * option's own text embedded in the itemId itself (confirmed live: e.g.
 * "..._block all flash activation"). Tries all three; undefined (skip,
 * never guess) if none match.
 */
function resolveOptionItemId(def: SettingDefinition, appliedValue: unknown): string | undefined {
  if (typeof appliedValue === "number") {
    const itemId = `${def.id}_${appliedValue}`;
    return def.options?.some((o) => o.itemId === itemId) ? itemId : undefined;
  }
  if (typeof appliedValue === "string") {
    return def.options?.find((o) => o.displayName === appliedValue || o.itemId === appliedValue || o.itemId.endsWith(appliedValue))
      ?.itemId;
  }
  return undefined;
}

/** A leaf (non-group, non-nested-parent) instance — no children of its own considered here. */
function buildLeafInstance(def: SettingDefinition, exported: ExportedSetting): unknown | undefined {
  if (exported.valueType === "secret") return undefined; // never reconstruct a secret value
  if (isChoice(def)) {
    const itemId = resolveOptionItemId(def, exported.appliedValue);
    return itemId ? choiceSettingInstance(def.id, itemId) : undefined;
  }
  if (exported.valueType === "string") return stringSettingInstance(def.id, String(exported.appliedValue));
  if (exported.valueType === "integer" && typeof exported.appliedValue === "number") {
    return integerSettingInstance(def.id, exported.appliedValue);
  }
  if (exported.valueType === "stringCollection" && Array.isArray(exported.appliedValue)) {
    return stringCollectionSettingInstance(def.id, exported.appliedValue.map(String));
  }
  return undefined;
}

export interface SkippedSetting {
  settingDefinitionId: string;
  reason: string;
}

/**
 * One policy's flat exported setting list → real, correctly-nested
 * settingInstance payloads. The export flattens group/dependent-child
 * relationships into a flat list — this re-nests them using each
 * definition's own rootDefinitionId, one level deep (matches every real
 * nesting case confirmed live so far; a genuinely deeper real case would
 * flatten incorrectly here, not crash — worth revisiting if one turns up).
 *
 * Root ids are derived from every setting's rootDefinitionId, not just
 * from which ids happen to literally be rows in the export — confirmed
 * live (LocalUsersAndGroups) that some export tools omit a group's own
 * row entirely when only its children were configured, since a group
 * carries no value of its own. A group can always be reconstructed from
 * its children alone; a non-group parent (a choice with a dependent
 * child) can't — it needs its own exported value, and is skipped with a
 * clear reason if that's missing rather than guessed at.
 */
export function buildPolicyInstances(
  settings: ExportedSetting[],
  resolved: Map<string, SettingDefinition>,
): { instances: unknown[]; skipped: SkippedSetting[] } {
  const byId = new Map(settings.map((s) => [s.settingDefinitionId, s]));
  const skipped: SkippedSetting[] = [];
  const instances: unknown[] = [];

  const rootIds = new Set<string>();
  for (const s of settings) {
    const def = resolved.get(s.settingDefinitionId);
    if (def) rootIds.add(def.rootDefinitionId ?? def.id);
  }

  for (const rootId of rootIds) {
    const rootDef = resolved.get(rootId);
    if (!rootDef) {
      skipped.push({ settingDefinitionId: rootId, reason: "parent definition could not be resolved" });
      continue;
    }

    const childIds = settings
      .map((s) => s.settingDefinitionId)
      .filter((cid) => cid !== rootId && resolved.get(cid)?.rootDefinitionId === rootId);

    if (isGroup(rootDef)) {
      const childInstances = childIds
        .map((cid) => buildLeafInstance(resolved.get(cid)!, byId.get(cid)!))
        .filter((x): x is unknown => x !== undefined);
      if (childInstances.length === 0) {
        skipped.push({ settingDefinitionId: rootId, reason: "group setting with no resolvable children present in this policy" });
        continue;
      }
      instances.push(groupSettingCollectionInstance(rootId, childInstances));
      continue;
    }

    // Not a group — a plain top-level leaf, or a choice with a dependent
    // child. Either way this root MUST have its own exported value.
    const exportedRoot = byId.get(rootId);
    if (!exportedRoot) {
      skipped.push({ settingDefinitionId: rootId, reason: "dependent child(ren) present but the parent's own value wasn't exported" });
      continue;
    }

    if (isChoice(rootDef)) {
      const itemId = resolveOptionItemId(rootDef, exportedRoot.appliedValue);
      if (!itemId) {
        skipped.push({ settingDefinitionId: rootId, reason: `unresolvable choice value ${JSON.stringify(exportedRoot.appliedValue)}` });
        continue;
      }
      const dependentChild = childIds
        .map((cid) => buildLeafInstance(resolved.get(cid)!, byId.get(cid)!))
        .filter((x): x is unknown => x !== undefined);
      instances.push(choiceSettingInstance(rootId, itemId, dependentChild));
      continue;
    }

    const leaf = buildLeafInstance(rootDef, exportedRoot);
    if (leaf === undefined) {
      skipped.push({ settingDefinitionId: rootId, reason: `unsupported value shape (${exportedRoot.valueType})` });
      continue;
    }
    instances.push(leaf);
  }

  // Anything exported whose own definition never resolved at all, and
  // whose id also never showed up as anyone's rootDefinitionId (already
  // reported above via "parent definition could not be resolved" in that
  // case) — count for an honest skipped total.
  for (const s of settings) {
    if (!resolved.has(s.settingDefinitionId) && !rootIds.has(s.settingDefinitionId)) {
      skipped.push({ settingDefinitionId: s.settingDefinitionId, reason: "definition could not be resolved" });
    }
  }

  return { instances, skipped };
}
