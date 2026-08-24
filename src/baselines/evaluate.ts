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
