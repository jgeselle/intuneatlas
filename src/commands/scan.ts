import { writeFile } from "node:fs/promises";
import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { defaultBaselinesDir, loadBaselines } from "../baselines/loader.js";
import { buildReport } from "../scan/report.js";
import { recordScan } from "../storage/scans.js";

export interface ScanOptions extends ResolveAuthOptions {
  out?: string;
  baseline?: string;
}

export async function runScan(options: ScanOptions): Promise<void> {
  const auth = await resolveAuth(options);
  const token = await auth.getToken();
  const baselineRules = await loadBaselines(options.baseline ?? defaultBaselinesDir());

  const report = await buildReport(token, auth.flow, auth.tenantId, baselineRules);
  recordScan(report);
  const json = JSON.stringify(report, null, 2);

  if (options.out) {
    await writeFile(options.out, json, "utf8");
    console.error(
      `Wrote ${report.settingCount} settings (${report.conflictCount} conflicts, ${report.belowBaselineCount} below baseline) from ${report.policyCount} configuration policies, ` +
        `${report.compliancePolicies.length} compliance policies, and ${report.enrollmentConfigurations.length} enrollment configs to ${options.out}`,
    );
  } else {
    console.log(json);
  }
}
