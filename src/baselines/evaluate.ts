import { describeExpectation, satisfiesExpectation } from "./compare.js";
import type { BaselineRule } from "./types.js";
import type { SettingIndexEntry } from "../scan/types.js";

/**
 * Matches rules to settings-index entries by CSP path (+ loose platform
 * prefix match, since real Graph platforms like "windows10" never match the
 * baseline schema's simplified "windows" exactly), attaches a recommendation
 * for every matching rule that fails (not just the first one — a setting can
 * have no baseline opinion, one, or several from different sources that may
 * even disagree with each other), and promotes state to "Below baseline"
 * when at least one applies.
 *
 * Precedence unchanged from buildSettingIndex's original design:
 * Conflict > Not deployed > Below baseline > Baseline. A conflicting or
 * undeployed setting doesn't get a baseline verdict — there's no single
 * "current value" to judge yet, or it isn't reaching any device.
 */
export function applyBaselines(entries: SettingIndexEntry[], rules: BaselineRule[]): SettingIndexEntry[] {
  return entries.map((entry) => {
    if (entry.state === "Conflict" || entry.state === "Not deployed") return entry;

    const matching = rules.filter((r) => r.path === entry.cspPath && platformMatches(r.platform, entry.platform));
    if (matching.length === 0) return entry;

    const current = entry.values[0] ?? "";
    const recs = matching
      .filter((rule) => !satisfiesExpectation(current, rule.expect))
      .map((rule) => ({
        ruleId: rule.id,
        current,
        recommended: describeExpectation(rule.expect),
        severity: rule.severity,
        why: rule.rationale,
        source: rule.source,
      }));
    if (recs.length === 0) return entry;

    return { ...entry, state: "Below baseline" as const, recs };
  });
}

function platformMatches(rulePlatform: string, entryPlatform: string): boolean {
  return entryPlatform.toLowerCase().startsWith(rulePlatform.toLowerCase());
}

/**
 * A baseline rule whose path never appears as any entry's cspPath isn't
 * evaluated by applyBaselines at all — it just silently never matches
 * anything, and there's no signal that the tenant doesn't configure this
 * setting *anywhere*, not even badly. That's a stronger gap than "Not
 * deployed" (which still has a real policy, just not assigned to a
 * group) — nothing in the tenant even attempts this setting. Synthesizes
 * one placeholder entry per uncovered (path, platform) — real settings-
 * index entries in every other state still count as "covered" (Conflict,
 * Not deployed, Below baseline, Baseline all mean some policy sets it);
 * only a path with zero matching entries in any state is a true gap.
 */
export function findUncoveredEntries(entries: SettingIndexEntry[], rules: BaselineRule[]): SettingIndexEntry[] {
  const groups = new Map<string, BaselineRule[]>();
  for (const rule of rules) {
    const covered = entries.some((e) => e.cspPath === rule.path && platformMatches(rule.platform, e.platform));
    if (covered) continue;
    const groupKey = `${rule.path}::${rule.platform}`;
    const group = groups.get(groupKey);
    if (group) group.push(rule);
    else groups.set(groupKey, [rule]);
  }

  return Array.from(groups.entries()).map(([groupKey, groupRules]) => ({
    key: `uncovered::${groupKey}`,
    name: groupRules[0].name,
    cspPath: groupRules[0].path,
    category: "Not covered by any policy",
    platform: groupRules[0].platform,
    values: [],
    sources: [],
    conflict: false,
    state: "Not covered" as const,
    recs: groupRules.map((rule) => ({
      ruleId: rule.id,
      current: "Not configured",
      recommended: describeExpectation(rule.expect),
      severity: rule.severity,
      why: rule.rationale,
      source: rule.source,
    })),
  }));
}
