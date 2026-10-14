import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet, graphGetAll } from "../graph.js";
import { TENANT_COMPLIANCE_POLICY_ID } from "./compliancePolicies.js";
import { summarizeSources } from "./index.js";
import type { SettingIndexEntry } from "./types.js";

/**
 * What one signed-in person's own Intune role lets them see — so the
 * shared scan, made by whoever pressed Sync, is shown to each viewer only
 * as far as Intune itself would show it to them.
 *
 * Intune decides, not IntuneAtlas: this asks Graph, with the viewer's own
 * token, for the ids of every policy they can read — the same lists a
 * scan reads, ids only. A role without read access to a kind of policy
 * (Graph answers 403) sees none of that kind. Scope tags, and the
 * per-assignment "Scoped permissions" Intune is moving to, apply on
 * Intune's side; nothing about them is reimplemented here.
 */
export type PolicyKind = "catalog" | "legacy" | "compliance" | "enrollment";
/** Each policy the viewer can see, by id, with which kind it is — the counts on the overview are per kind. */
export type VisiblePolicies = ReadonlyMap<string, PolicyKind>;

export async function fetchVisiblePolicies(token: string): Promise<Map<string, PolicyKind>> {
  const ids = (kind: PolicyKind, path: string, base?: string) =>
    graphGetAll<{ id: string }>(token, path, base).then(
      (items) => items.map((item): [string, PolicyKind] => [item.id, kind]),
      (err) => {
        if (deniedOrMissing(err)) return [];
        throw err;
      },
    );
  const lists = await Promise.all([
    ids("catalog", "/deviceManagement/configurationPolicies?$select=id", GRAPH_BETA_BASE),
    ids("compliance", "/deviceManagement/compliancePolicies?$select=id", GRAPH_BETA_BASE),
    ids("legacy", "/deviceManagement/deviceConfigurations?$select=id"),
    ids("compliance", "/deviceManagement/deviceCompliancePolicies?$select=id", GRAPH_BETA_BASE),
    ids("enrollment", "/deviceManagement/deviceEnrollmentConfigurations?$select=id"),
    // The tenant-wide compliance settings aren't a policy, but the scan shows them as one; whoever may read them sees it.
    graphGet(token, "/deviceManagement/settings", GRAPH_BETA_BASE).then(
      (): Array<[string, PolicyKind]> => [[TENANT_COMPLIANCE_POLICY_ID, "compliance"]],
      (err) => {
        if (deniedOrMissing(err)) return [];
        throw err;
      },
    ),
  ]);
  return new Map(lists.flat());
}

function deniedOrMissing(err: unknown): boolean {
  return err instanceof Error && /failed: (400|401|403|404)\b/.test(err.message);
}

interface Restrictable {
  settings: SettingIndexEntry[];
  compliancePolicies?: Array<{ id: string }>;
  enrollmentConfigurations?: Array<{ id: string }>;
  changes?: Record<string, { policyId?: string }>;
  policyCount?: number;
  legacyPolicyCount?: number;
  settingCount?: number;
  conflictCount?: number;
}

/**
 * A report as one viewer may see it: only the policies they can see, and
 * every setting judged again from those alone — a conflict with a policy
 * they can't see isn't theirs to know about, and would give it away. A
 * setting none of whose policies they can see is gone; changes staged on
 * such policies too. A change for a new policy has no policy yet and
 * stays.
 */
export function restrictToPolicies<T extends Restrictable>(report: T, visible: VisiblePolicies, groups?: Parameters<typeof summarizeSources>[1]): T {
  const settings: SettingIndexEntry[] = [];
  let removed = false;
  for (const entry of report.settings) {
    const sources = entry.sources.filter((s) => visible.has(s.policyId));
    if (sources.length === entry.sources.length) {
      settings.push(entry);
      continue;
    }
    removed = true;
    if (sources.length === 0) continue;
    const compliance = (entry.definitionId ?? entry.key).startsWith("compliance.");
    settings.push({ ...entry, sources, ...summarizeSources(sources, groups, { conflicts: !compliance }) });
  }
  const changes = report.changes
    ? Object.fromEntries(Object.entries(report.changes).filter(([, c]) => !c.policyId || visible.has(c.policyId)))
    : undefined;
  return {
    ...report,
    settings,
    ...(report.compliancePolicies ? { compliancePolicies: report.compliancePolicies.filter((p) => visible.has(p.id)) } : {}),
    ...(report.enrollmentConfigurations ? { enrollmentConfigurations: report.enrollmentConfigurations.filter((p) => visible.has(p.id)) } : {}),
    ...(changes ? { changes } : {}),
    // Policy counts are left as the scan made them unless something was taken out; then they're
    // counted from what's left, which leaves out a visible policy with no settings at all.
    ...(removed && report.policyCount !== undefined ? { policyCount: countOf("catalog", settings, visible) } : {}),
    ...(removed && report.legacyPolicyCount !== undefined ? { legacyPolicyCount: countOf("legacy", settings, visible) } : {}),
    ...(report.settingCount !== undefined ? { settingCount: settings.length } : {}),
    ...(report.conflictCount !== undefined ? { conflictCount: settings.filter((e) => e.conflict).length } : {}),
  };
}

function countOf(kind: PolicyKind, settings: SettingIndexEntry[], visible: VisiblePolicies): number {
  return new Set(settings.flatMap((e) => e.sources.map((s) => s.policyId)).filter((id) => visible.get(id) === kind)).size;
}
