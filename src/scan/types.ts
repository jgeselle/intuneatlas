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

export type SettingIndexState = "Conflict" | "Not deployed" | "Below baseline" | "Baseline" | "Not covered";

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
}
