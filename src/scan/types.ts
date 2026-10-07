/** A single resolved setting value from a Settings Catalog policy. */
export interface RawSetting {
  settingDefinitionId: string;
  name: string;
  cspPath: string;
  category: string;
  value: string;
}

export type AssignmentTarget =
  | { kind: "allDevices" }
  | { kind: "allLicensedUsers" }
  | { kind: "group"; groupId: string; excluded: boolean };

export interface RawPolicy {
  id: string;
  name: string;
  platform: string;
  assignments: AssignmentTarget[];
  settings: RawSetting[];
}

/**
 * Compliance policies and enrollment configurations: flat, typed-per-kind
 * Graph resources (no nested settingInstance model like Settings Catalog),
 * so there's nothing to merge into the settings index — just identity and
 * deployment status.
 */
export interface RawSimplePolicy {
  id: string;
  name: string;
  platform: string;
  deployed: boolean;
  /** Enrollment configurations only — lower value wins when multiple target the same user. */
  priority?: number;
}

/**
 * Exactly one per setting:
 * - "Conflict": deployed policies set different values.
 * - "Not assigned": a policy sets it, but none of them targets any group.
 * - "Below baseline": an active baseline rule covers it and its value fails.
 * - "Meets baseline": at least one active rule covers it and all of them pass.
 * - "Not checked": no active rule has an opinion on it (also what every
 *   non-conflicting, assigned setting is straight out of a scan, before
 *   any baseline has been applied).
 * - "Missing": synthetic — a baseline rule requires a setting that no
 *   policy in the tenant configures at all.
 */
export type SettingIndexState = "Conflict" | "Not assigned" | "Below baseline" | "Meets baseline" | "Not checked" | "Missing";

export interface SettingIndexSource {
  policyId: string;
  policyName: string;
  value: string;
  deployed: boolean;
}

/** Attached by the baseline engine (src/baselines/evaluate.ts) when a matching rule fails. */
export interface SettingRecommendation {
  ruleId: string;
  current: string;
  recommended: string;
  severity: "critical" | "high" | "medium" | "low";
  why: string;
  source: string;
}

/**
 * One active baseline rule that covers a setting, whatever the outcome —
 * unlike SettingRecommendation above, which only exists for failures.
 * Lets a reader see which baseline expects what even when the setting
 * passes, or when it has no verdict at all.
 */
export interface BaselineCheck {
  ruleId: string;
  source: string;
  pack: string;
  /** The rule's expectation as a display string (same text as a recommendation's `recommended`). */
  expected: string;
  severity: "critical" | "high" | "medium" | "low";
  why: string;
  /**
   * null when the setting wasn't judged against the rule: it's in
   * conflict or not assigned, so there's no single effective value to
   * compare — the expectation is still worth showing.
   */
  passed: boolean | null;
}

export interface SettingIndexEntry {
  key: string;
  name: string;
  cspPath: string;
  category: string;
  platform: string;
  values: string[];
  sources: SettingIndexSource[];
  conflict: boolean;
  state: SettingIndexState;
  /**
   * Zero, one, or many — a setting can have no baseline opinion, one, or
   * several from different sources (Microsoft's security baseline, a CIS
   * benchmark, a house rules pack, ...) that may even disagree with each
   * other. Always a real array, never omitted — buildSettingIndex sets it
   * to [] up front, applyBaselines only ever pushes into it.
   */
  recs: SettingRecommendation[];
  /**
   * Every active baseline rule covering this setting, pass or fail.
   * Absent until applyBaselines has run (a raw scan has no baseline
   * opinion yet); empty once it has and no rule covers the setting.
   */
  checks?: BaselineCheck[];
}
