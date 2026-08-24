import { applyBaselines, findUncoveredEntries } from "../baselines/evaluate.js";
import type { BaselineRule } from "../baselines/types.js";
import { fetchCompliancePolicies } from "./compliancePolicies.js";
import { fetchConfigurationPolicies } from "./configurationPolicies.js";
import { fetchLegacyDeviceConfigurations } from "./deviceConfigurations.js";
import { fetchEnrollmentConfigurations } from "./enrollmentConfigurations.js";
import { buildSettingIndex } from "./index.js";
import { fetchTenantDisplayName } from "./organization.js";

export interface ScanReport {
  scannedAt: string;
  flow: string;
  tenant: string;
  /** Friendly "Org Name (domain.onmicrosoft.com)" for display — `tenant` above stays the raw --tenant value used for auth/storage lookups. Undefined if Graph didn't return one (never blocks a scan over it). */
  tenantName?: string;
  policyCount: number;
  /** Legacy deviceConfigurations profiles that contributed at least one mapped setting — see src/scan/deviceConfigurations.ts for exactly what's covered. */
  legacyPolicyCount: number;
  settingCount: number;
  conflictCount: number;
  belowBaselineCount: number;
  settings: ReturnType<typeof buildSettingIndex>;
  compliancePolicies: Awaited<ReturnType<typeof fetchCompliancePolicies>>;
  enrollmentConfigurations: Awaited<ReturnType<typeof fetchEnrollmentConfigurations>>;
}

export async function buildReport(
  token: string,
  flow: string,
  tenant: string,
  baselineRules: BaselineRule[] = [],
): Promise<ScanReport> {
  const [policies, legacyPolicies, compliancePolicies, enrollmentConfigurations, tenantName] = await Promise.all([
    fetchConfigurationPolicies(token),
    fetchLegacyDeviceConfigurations(token),
    fetchCompliancePolicies(token),
    fetchEnrollmentConfigurations(token),
    fetchTenantDisplayName(token),
  ]);
  // Legacy profiles fold into the same merge — a Settings Catalog policy and
  // a legacy Device Restrictions profile writing the same real setting need
  // to land in the same bucket to be conflict-checked against each other.
  const settingIndex = applyBaselines(buildSettingIndex([...policies, ...legacyPolicies]), baselineRules);
  // Synthetic "Not covered" entries for baseline rules with no matching
  // setting anywhere in the tenant — appended for display only, after
  // settingCount/conflictCount/belowBaselineCount are computed from the
  // real scanned entries, so those counts stay truthful to what was
  // actually found in the tenant rather than what the baseline merely
  // wishes existed.
  const settingsWithGaps = [...settingIndex, ...findUncoveredEntries(settingIndex, baselineRules)];

  return {
    scannedAt: new Date().toISOString(),
    flow,
    tenant,
    tenantName,
    policyCount: policies.length,
    legacyPolicyCount: legacyPolicies.length,
    settingCount: settingIndex.length,
    conflictCount: settingIndex.filter((e) => e.conflict).length,
    belowBaselineCount: settingIndex.filter((e) => e.state === "Below baseline").length,
    settings: settingsWithGaps,
    compliancePolicies,
    enrollmentConfigurations,
  };
}
