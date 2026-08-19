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

export type SettingIndexState = "Conflict" | "Not deployed" | "Baseline";

export interface SettingIndexSource {
  policyId: string;
  policyName: string;
  value: string;
  deployed: boolean;
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
}
