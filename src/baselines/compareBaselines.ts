import { hydrateNode, renderNode } from "../scan/settingValue.js";
import type { SettingIndexEntry, SettingSchema } from "../scan/types.js";
import { compareValues } from "./compare.js";
import type { BaselineDefinitions } from "./evaluate.js";
import type { BaselineRule } from "./types.js";

/**
 * How the tenant stands on one compared setting, judged against the
 * baseline being moved *to* (for a setting that one no longer has: simply
 * whether the tenant configures it).
 */
export type TenantStanding = "meets" | "below" | "missing" | "conflict" | "notAssigned" | "configured" | "notConfigured";

/** One setting two baselines treat differently. */
export interface BaselineChange {
  definitionId: string;
  platform: string;
  /** added: only the second baseline has it. removed: only the first. changed: both, with different values. */
  change: "added" | "removed" | "changed";
  name: string;
  category: string;
  cspPath: string;
  /** The value(s) each side accepts — several when a baseline sets the setting in more than one policy. Empty on the side that lacks it. */
  from: string[];
  to: string[];
  tenant: TenantStanding;
  /** The tenant's own value, when it has a single effective one. */
  current: string | null;
  /** The settings-index entry to open for it, when the tenant configures the setting. */
  entryKey?: string;
}

/**
 * What differs between two baselines, setting by setting, and where the
 * tenant stands on each difference. Compared by setting definition id,
 * never by policy file — a baseline's files get renamed and regrouped
 * from one release to the next while the settings inside barely move.
 *
 * Works for any two baselines (two versions of one, or two different
 * publishers), and neither has to be active: this reads the rules and
 * the scan's facts directly, not anyone's verdicts.
 */
export function compareBaselines(
  rules: BaselineRule[],
  fromPack: string,
  toPack: string,
  entries: SettingIndexEntry[],
  definitions?: BaselineDefinitions,
): BaselineChange[] {
  const from = bySetting(rules.filter((r) => r.pack === fromPack));
  const to = bySetting(rules.filter((r) => r.pack === toPack));
  const changes: BaselineChange[] = [];

  for (const key of new Set([...from.keys(), ...to.keys()])) {
    const fromRules = from.get(key) ?? [];
    const toRules = to.get(key) ?? [];
    // Compared on the raw (id-only) values, so two baselines that mean the same thing can't differ by a label.
    // As a set: a baseline repeating the same value in two of its policies accepts nothing more than one stating it once.
    const raw = (list: BaselineRule[]) => Array.from(new Set(list.map((r) => `${r.compare}:${renderNode(r.expected)}`))).sort().join("\u0000");
    if (fromRules.length > 0 && toRules.length > 0 && raw(fromRules) === raw(toRules)) continue;

    const { definitionId, platform } = (toRules[0] ?? fromRules[0])!;
    const entry = entries.find((e) => e.definitionId === definitionId && e.state !== "Missing" && platformMatches(platform, e.platform));
    const schemas: Record<string, SettingSchema> = { ...definitions?.schemas, ...entry?.schemas };
    const text = (list: BaselineRule[]) => Array.from(new Set(list.map((r) => renderNode(hydrateNode(r.expected, schemas)) + suffix(r))));

    changes.push({
      definitionId,
      platform,
      change: fromRules.length === 0 ? "added" : toRules.length === 0 ? "removed" : "changed",
      name: entry?.name ?? schemas[definitionId]?.name ?? definitionId,
      category: entry?.category ?? definitions?.info[definitionId]?.category ?? "",
      cspPath: entry?.cspPath ?? definitions?.info[definitionId]?.cspPath ?? "",
      from: text(fromRules),
      to: text(toRules),
      tenant: standing(entry, toRules, schemas),
      current: entry && !entry.conflict ? (entry.values[0] ?? null) : null,
      ...(entry ? { entryKey: entry.key } : {}),
    });
  }

  return changes.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.definitionId.localeCompare(b.definitionId));
}

function suffix(rule: BaselineRule): string {
  return rule.compare === "atMost" ? " or less" : rule.compare === "atLeast" ? " or more" : "";
}

function standing(entry: SettingIndexEntry | undefined, toRules: BaselineRule[], schemas: Record<string, SettingSchema>): TenantStanding {
  if (toRules.length === 0) return entry ? "configured" : "notConfigured";
  if (!entry) return "missing";
  if (entry.conflict) return "conflict";
  const assigned = entry.sources.find((source) => source.deployed);
  if (!assigned) return "notAssigned";
  // Any of the values the baseline accepts will do — same as a normal verdict.
  return toRules.some((rule) => compareValues(hydrateNode(rule.expected, schemas), assigned.structured, rule.compare).length === 0) ? "meets" : "below";
}

function bySetting(rules: BaselineRule[]): Map<string, BaselineRule[]> {
  const groups = new Map<string, BaselineRule[]>();
  for (const rule of rules) {
    const key = `${rule.definitionId}::${rule.platform.toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.push(rule);
    else groups.set(key, [rule]);
  }
  return groups;
}

function platformMatches(rulePlatform: string, entryPlatform: string): boolean {
  if (!rulePlatform) return true;
  const entry = entryPlatform.toLowerCase();
  return rulePlatform
    .toLowerCase()
    .split(",")
    .some((p) => entry.startsWith(p.trim()) || p.trim().startsWith(entry));
}
