import { writeFile } from "node:fs/promises";
import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { fetchCompliancePolicies } from "../scan/compliancePolicies.js";
import { fetchConfigurationPolicies } from "../scan/configurationPolicies.js";
import { fetchEnrollmentConfigurations } from "../scan/enrollmentConfigurations.js";
import { buildSettingIndex } from "../scan/index.js";

export interface ScanOptions extends ResolveAuthOptions {
  out?: string;
}

export async function runScan(options: ScanOptions): Promise<void> {
  const auth = resolveAuth(options);
  const token = await auth.getToken();

  const [policies, compliancePolicies, enrollmentConfigurations] = await Promise.all([
    fetchConfigurationPolicies(token),
    fetchCompliancePolicies(token),
    fetchEnrollmentConfigurations(token),
  ]);
  const settingIndex = buildSettingIndex(policies);

  const report = {
    scannedAt: new Date().toISOString(),
    flow: auth.flow,
    policyCount: policies.length,
    settingCount: settingIndex.length,
    conflictCount: settingIndex.filter((e) => e.conflict).length,
    settings: settingIndex,
    compliancePolicies,
    enrollmentConfigurations,
  };

  const json = JSON.stringify(report, null, 2);

  if (options.out) {
    await writeFile(options.out, json, "utf8");
    console.error(
      `Wrote ${settingIndex.length} settings (${report.conflictCount} conflicts) from ${policies.length} configuration policies, ` +
        `${compliancePolicies.length} compliance policies, and ${enrollmentConfigurations.length} enrollment configs to ${options.out}`,
    );
  } else {
    console.log(json);
  }
}
