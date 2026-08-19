import { writeFile } from "node:fs/promises";
import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { buildReport } from "../scan/report.js";

export interface ScanOptions extends ResolveAuthOptions {
  out?: string;
}

export async function runScan(options: ScanOptions): Promise<void> {
  const auth = resolveAuth(options);
  const token = await auth.getToken();

  const report = await buildReport(token, auth.flow);
  const json = JSON.stringify(report, null, 2);

  if (options.out) {
    await writeFile(options.out, json, "utf8");
    console.error(
      `Wrote ${report.settingCount} settings (${report.conflictCount} conflicts) from ${report.policyCount} configuration policies, ` +
        `${report.compliancePolicies.length} compliance policies, and ${report.enrollmentConfigurations.length} enrollment configs to ${options.out}`,
    );
  } else {
    console.log(json);
  }
}
