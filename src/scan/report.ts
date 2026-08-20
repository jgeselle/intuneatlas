import { applyBaselines } from "../baselines/evaluate.js";
import type { BaselineRule } from "../baselines/types.js";
import { fetchCompliancePolicies } from "./compliancePolicies.js";
import { fetchConfigurationPolicies } from "./configurationPolicies.js";
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
  const [policies, compliancePolicies, enrollmentConfigurations, tenantName] = await Promise.all([
    fetchConfigurationPolicies(token),
    fetchCompliancePolicies(token),
    fetchEnrollmentConfigurations(token),
    fetchTenantDisplayName(token),
  ]);
  const settingIndex = applyBaselines(buildSettingIndex(policies), baselineRules);

  return {
    scannedAt: new Date().toISOString(),
    flow,
    tenant,
    tenantName,
    policyCount: policies.length,
    settingCount: settingIndex.length,
    conflictCount: settingIndex.filter((e) => e.conflict).length,
    belowBaselineCount: settingIndex.filter((e) => e.state === "Below baseline").length,
    settings: settingIndex,
    compliancePolicies,
    enrollmentConfigurations,
  };
}
