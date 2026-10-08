import type { SettingValueNode } from "../scan/types.js";

export type Severity = "critical" | "high" | "medium" | "low";

/**
 * How a tenant's value is held against the baseline's:
 * - exact: must be the baseline's value
 * - atMost / atLeast: a number that may also be lower / higher than the
 *   baseline's (e.g. "defer updates 7 days or less")
 */
export type CompareMode = "exact" | "atMost" | "atLeast";

/**
 * One setting a baseline has an opinion on.
 *
 * Every baseline is stored the same way: as policies exported from
 * Intune (the JSON Graph returns) — Settings Catalog and compliance —
 * dropped into a folder. A rule is one setting from one of those
 * policies — its value kept as the same tree a scan produces, matched to
 * a tenant by Intune's own setting definition id (for a compliance
 * setting, the policy type and property it lives in).
 *
 * What an export can't say — how severe a deviation is, why the value
 * was chosen, where that's documented, whether "lower is fine too" —
 * lives beside the policies in the pack's `baseline.yml`, keyed by
 * definition id (see loader.ts). It never changes the stored value.
 */
export interface BaselineRule {
  id: string;
  /** The pack it belongs to — its folder's first two path segments, e.g. "oib/windows-v4.0". */
  pack: string;
  /** The pack's display name, e.g. "Open Intune Baseline – Windows v4.0". */
  source: string;
  /** The exported policy this setting came from. */
  policyName: string;
  definitionId: string;
  platform: string;
  /** Names and option labels are raw ids until hydrated against definitions — a baseline file carries none. */
  expected: SettingValueNode;
  compare: CompareMode;
  severity?: Severity;
  rationale?: string;
  reference?: string;
}
