import { describeExpectation, satisfiesExpectation } from "./compare.js";
import type { BaselineRule } from "./types.js";
import type { SettingIndexEntry } from "../scan/types.js";

/**
 * Matches rules to settings-index entries by CSP path (+ loose platform
 * prefix match, since real Graph platforms like "windows10" never match the
 * baseline schema's simplified "windows" exactly), attaches a recommendation
 * where a rule fails, and promotes state to "Below baseline".
 *
 * Precedence unchanged from buildSettingIndex's original design:
 * Conflict > Not deployed > Below baseline > Baseline. A conflicting or
 * undeployed setting doesn't get a baseline verdict — there's no single
 * "current value" to judge yet, or it isn't reaching any device.
 */
export function applyBaselines(entries: SettingIndexEntry[], rules: BaselineRule[]): SettingIndexEntry[] {
  return entries.map((entry) => {
    if (entry.state === "Conflict" || entry.state === "Not deployed") return entry;

    const rule = rules.find((r) => r.path === entry.cspPath && platformMatches(r.platform, entry.platform));
    if (!rule) return entry;

    const current = entry.values[0] ?? "";
    if (satisfiesExpectation(current, rule.expect)) return entry;

    return {
      ...entry,
      state: "Below baseline",
      rec: {
        ruleId: rule.id,
        current,
        recommended: describeExpectation(rule.expect),
        severity: rule.severity,
        why: rule.rationale,
        source: rule.source,
      },
    };
  });
}

function platformMatches(rulePlatform: string, entryPlatform: string): boolean {
  return entryPlatform.toLowerCase().startsWith(rulePlatform.toLowerCase());
}
