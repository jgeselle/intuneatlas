/**
 * What Intune's own setting definition says a setting can hold — the
 * source of the dropdowns, ranges and sub-settings its portal editor
 * shows. One per settingDefinitionId; a compound setting's descendants
 * each have their own.
 *
 * - choice / choiceCollection: `options` (and, per option, which other
 *   definitions it reveals — "dependent" sub-settings, each of them
 *   optional: confirmed live that a policy can select the option and
 *   configure all, some or none of them)
 * - simple / simpleCollection: `valueType` plus its range or length limits
 * - group / groupCollection: `childIds`, the sub-settings it bundles
 * - unknown: the definition didn't say (or a legacy profile with no
 *   definition at all) — treated as free text
 */
export type SettingKind = "choice" | "choiceCollection" | "simple" | "simpleCollection" | "group" | "groupCollection" | "unknown";

export interface SettingOption {
  /** Graph's opaque `{definitionId}_{index}` item id — what a policy actually stores. */
  id: string;
  label: string;
  description?: string;
  /** Definitions of the sub-settings that only exist while this option is selected. */
  childIds?: string[];
}

export interface SettingSchema {
  definitionId: string;
  name: string;
  kind: SettingKind;
  description?: string;
  options?: SettingOption[];
  defaultOptionId?: string;
  valueType?: "integer" | "string";
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** What Intune pre-fills for a simple setting, when its definition names one. */
  defaultValue?: string | number;
  /** Graph's string format hint, e.g. "none", "email", "json", "xml". */
  format?: string;
  isSecret?: boolean;
  childIds?: string[];
  /** Collections only: how many items/instances Intune allows. */
  minCount?: number;
  maxCount?: number;
}

/**
 * A setting's value with its structure intact — the same tree Graph
 * returns, with option ids resolved to labels. RawSetting.value (the
 * newline-joined text every reader has always used) is rendered from
 * this, never the other way round; this is what a structured editor, and
 * eventually a write back to the tenant, needs.
 */
export type SettingValueNode =
  | { kind: "simple"; definitionId: string; name: string; value: string | number | boolean }
  | { kind: "choice"; definitionId: string; name: string; optionId: string; label: string; children?: SettingValueNode[] }
  | { kind: "simpleCollection"; definitionId: string; name: string; items: Array<string | number | boolean> }
  | { kind: "choiceCollection"; definitionId: string; name: string; items: Array<{ optionId: string; label: string }> }
  | { kind: "group"; definitionId: string; name: string; children: SettingValueNode[] }
  | { kind: "groupCollection"; definitionId: string; name: string; groups: SettingValueNode[][] }
  | { kind: "unknown"; definitionId: string; name: string };

/** A single resolved setting value from a Settings Catalog policy. */
export interface RawSetting {
  settingDefinitionId: string;
  name: string;
  cspPath: string;
  category: string;
  value: string;
  /** Settings Catalog only — legacy device configuration profiles have no definition to build this from. */
  structured?: SettingValueNode;
  /**
   * The schema of this setting and of every sub-setting it could have —
   * not only the ones this policy's value happens to configure — keyed by
   * definition id. An editor needs the ones that aren't set yet too.
   */
  schemas?: Record<string, SettingSchema>;
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
  structured?: SettingValueNode;
}

/** One place a setting's value falls short of a baseline's — see compareValues in src/baselines/compare.ts. */
export interface ValueDifference {
  path: string[];
  expected: string;
  actual: string | null;
}

/** Attached by the baseline engine (src/baselines/evaluate.ts) for every baseline the setting falls short of. */
export interface SettingRecommendation {
  ruleId: string;
  current: string;
  recommended: string;
  /** The baseline's display name. */
  source: string;
  /** Present only where the baseline's annotations give them — an exported policy alone has neither. */
  severity?: "critical" | "high" | "medium" | "low";
  why?: string;
}

/**
 * One active baseline's position on a setting, whatever the outcome —
 * unlike SettingRecommendation above, which only exists for shortfalls.
 * Lets a reader see which baseline expects what even when the setting
 * passes, or when it has no verdict at all.
 */
export interface BaselineCheck {
  ruleId: string;
  source: string;
  pack: string;
  /** The exported policy inside the baseline that sets this. */
  policyName: string;
  /** The baseline's value as text, and with its structure (names and labels filled in where known). */
  expected: string;
  expectedNode: SettingValueNode;
  /**
   * Other values the same baseline also accepts for this setting — it can
   * set one setting in several policies meant for different groups of
   * devices (update rings, OS versions), and matching any of them passes.
   */
  alternatives?: string[];
  /** Set when the baseline accepts more than its exact value: a number that may also be lower ("atMost") or higher ("atLeast"). */
  compare?: "atMost" | "atLeast";
  severity?: "critical" | "high" | "medium" | "low";
  why?: string;
  reference?: string;
  /**
   * null when the setting wasn't judged against the baseline: it's in
   * conflict or not assigned, so there's no single effective value to
   * compare — the expectation is still worth showing.
   */
  passed: boolean | null;
  /** Where exactly it falls short, when it does. */
  differences?: ValueDifference[];
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
  /** Root setting definition id, and the schemas for it and its sub-settings — absent for legacy profiles and for scans stored before schemas were kept. */
  definitionId?: string;
  schemas?: Record<string, SettingSchema>;
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
