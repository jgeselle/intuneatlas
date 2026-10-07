import { describeExpectation, satisfiesExpectation } from "./compare.js";
import type { BaselineRule } from "./types.js";
import type { BaselineCheck, SettingIndexEntry } from "../scan/types.js";

/**
 * Matches rules to settings-index entries by CSP path (+ loose platform
 * prefix match, since real Graph platforms like "windows10" never match the
 * baseline schema's simplified "windows" exactly) and gives each one its
 * baseline verdict:
 *
 * - no rule matches            -> "Not checked"
 * - rules match, all pass      -> "Meets baseline"
 * - rules match, any fails     -> "Below baseline", with a recommendation
 *   for every failing rule (not just the first one — a setting can have
 *   several, from different sources that may even disagree with each other)
 *
 * Precedence: Conflict > Not assigned > the verdict above. A conflicting
 * or unassigned setting doesn't get a baseline verdict — there's no single
 * "current value" to judge yet, or it isn't reaching any device.
 *
 * The verdict is always recomputed from scratch (state and recs both),
 * never carried over from whatever the entry came in with — so judging an
 * already-judged report against a different set of rules can't leave a
 * stale "Below baseline" or stale recommendations behind.
 */
export function applyBaselines(entries: SettingIndexEntry[], rules: BaselineRule[]): SettingIndexEntry[] {
  return entries.map((entry) => {
    const matching = rules.filter((r) => r.path === entry.cspPath && platformMatches(r.platform, entry.platform));

    // No verdict for these two, but which baselines have an expectation
    // for the setting is still worth carrying along.
    if (entry.state === "Conflict" || entry.state === "Not assigned") {
      return { ...entry, checks: matching.map((rule) => toCheck(rule, null)) };
    }

    if (matching.length === 0) return { ...entry, state: "Not checked" as const, recs: [], checks: [] };

    const current = entry.values[0] ?? "";
    const checks = matching.map((rule) => toCheck(rule, satisfiesExpectation(current, rule.expect)));
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
    if (recs.length === 0) return { ...entry, state: "Meets baseline" as const, recs: [], checks };

    return { ...entry, state: "Below baseline" as const, recs, checks };
  });
}

function toCheck(rule: BaselineRule, passed: boolean | null): BaselineCheck {
  return {
    ruleId: rule.id,
    source: rule.source,
    pack: rule.pack,
    expected: describeExpectation(rule.expect),
    severity: rule.severity,
    why: rule.rationale,
    passed,
  };
}

function platformMatches(rulePlatform: string, entryPlatform: string): boolean {
  return entryPlatform.toLowerCase().startsWith(rulePlatform.toLowerCase());
}

/**
 * A baseline rule whose path never appears as any entry's cspPath isn't
 * evaluated by applyBaselines at all — it just silently never matches
 * anything, and there's no signal that the tenant doesn't configure this
 * setting *anywhere*, not even badly. That's a stronger gap than "Not
 * assigned" (which still has a real policy, just not assigned to a
 * group) — nothing in the tenant even attempts this setting. Synthesizes
 * one placeholder entry per uncovered (path, platform) — real settings-
 * index entries in every other state still count as "covered" (Conflict,
 * Not assigned, Below baseline, Meets baseline, Not checked all mean some
 * policy sets it);
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
    category: "Missing from the tenant",
    platform: groupRules[0].platform,
    values: [],
    sources: [],
    conflict: false,
    state: "Missing" as const,
    recs: groupRules.map((rule) => ({
      ruleId: rule.id,
      current: "Not configured",
      recommended: describeExpectation(rule.expect),
      severity: rule.severity,
      why: rule.rationale,
      source: rule.source,
    })),
    checks: groupRules.map((rule) => toCheck(rule, false)),
  }));
}
