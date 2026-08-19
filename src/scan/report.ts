import { fetchCompliancePolicies } from "./compliancePolicies.js";
import { fetchConfigurationPolicies } from "./configurationPolicies.js";
import { fetchEnrollmentConfigurations } from "./enrollmentConfigurations.js";
import { buildSettingIndex } from "./index.js";

export interface ScanReport {
  scannedAt: string;
  flow: string;
  policyCount: number;
  settingCount: number;
  conflictCount: number;
  settings: ReturnType<typeof buildSettingIndex>;
  compliancePolicies: Awaited<ReturnType<typeof fetchCompliancePolicies>>;
  enrollmentConfigurations: Awaited<ReturnType<typeof fetchEnrollmentConfigurations>>;
}

export async function buildReport(token: string, flow: string): Promise<ScanReport> {
  const [policies, compliancePolicies, enrollmentConfigurations] = await Promise.all([
    fetchConfigurationPolicies(token),
    fetchCompliancePolicies(token),
    fetchEnrollmentConfigurations(token),
  ]);
  const settingIndex = buildSettingIndex(policies);

  return {
    scannedAt: new Date().toISOString(),
    flow,
    policyCount: policies.length,
    settingCount: settingIndex.length,
    conflictCount: settingIndex.filter((e) => e.conflict).length,
    settings: settingIndex,
    compliancePolicies,
    enrollmentConfigurations,
  };
}
