import { writeFile } from "node:fs/promises";
import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { fetchConfigurationPolicies } from "../scan/configurationPolicies.js";
import { buildSettingIndex } from "../scan/index.js";

export interface ScanOptions extends ResolveAuthOptions {
  out?: string;
}

export async function runScan(options: ScanOptions): Promise<void> {
  const auth = resolveAuth(options);
  const token = await auth.getToken();

  const policies = await fetchConfigurationPolicies(token);
  const settingIndex = buildSettingIndex(policies);

  const report = {
    scannedAt: new Date().toISOString(),
    flow: auth.flow,
    policyCount: policies.length,
    settingCount: settingIndex.length,
    conflictCount: settingIndex.filter((e) => e.conflict).length,
    settings: settingIndex,
  };

  const json = JSON.stringify(report, null, 2);

  if (options.out) {
    await writeFile(options.out, json, "utf8");
    console.error(
      `Wrote ${settingIndex.length} settings (${report.conflictCount} conflicts) from ${policies.length} policies to ${options.out}`,
    );
  } else {
    console.log(json);
  }
}
