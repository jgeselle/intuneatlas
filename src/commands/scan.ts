import { writeFile } from "node:fs/promises";
import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { can } from "../auth/roles.js";
import { defaultBaselinesDir, loadBaselines } from "../baselines/loader.js";
import { applyBaselinesToReport, buildReport } from "../scan/report.js";
import { recordScan } from "../storage/scans.js";

export interface ScanOptions extends ResolveAuthOptions {
  out?: string;
  baseline?: string;
}

export async function runScan(options: ScanOptions): Promise<void> {
  const auth = await resolveAuth(options);
  // client-credentials authenticates as the app itself, not a human — no
  // per-user role to check, so it's exempt rather than always failing the
  // can(null, ...) check every other flow is subject to.
  if (auth.flow !== "client-credentials" && !can(await auth.getRole(), "scan")) {
    throw new Error("Your role doesn't include scanning the tenant. Ask an Admin to run it, or to assign you the Admin role.");
  }
  const token = await auth.getToken();

  // Scanning and evaluating are deliberately separate: recordScan persists
  // only the raw report, so evaluating against a different baseline
  // selection later never needs another scan.
  const rawReport = await buildReport(token, auth.flow, auth.tenantId);
  recordScan(rawReport);

  const baselineRules = await loadBaselines(options.baseline ?? defaultBaselinesDir());
  const report = applyBaselinesToReport(rawReport, baselineRules);
  const json = JSON.stringify(report, null, 2);

  if (options.out) {
    await writeFile(options.out, json, "utf8");
    console.error(
      `Wrote ${report.settingCount} settings (${report.conflictCount} conflicts, ${report.belowBaselineCount} below baseline) from ${report.policyCount} configuration policies, ` +
        `${report.legacyPolicyCount} legacy device configuration profiles, ${report.compliancePolicies.length} compliance policies, and ` +
        `${report.enrollmentConfigurations.length} enrollment configs to ${options.out}`,
    );
  } else {
    console.log(json);
  }
}
