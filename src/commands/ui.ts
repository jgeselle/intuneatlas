import { readFile } from "node:fs/promises";
import open from "open";
import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { defaultBaselinesDir, loadBaselines } from "../baselines/loader.js";
import { buildReport, type ScanReport } from "../scan/report.js";
import {
  startServer,
  type ScanRequestBody,
  type StageChangeRequestBody,
  type UpdateChangeRequestBody,
} from "../server/staticServer.js";
import { addNote, getAllNotes, type Note } from "../storage/notes.js";
import { getLatestScan, recordScan } from "../storage/scans.js";
import { getAllChanges, revertChange, stageChange, updateReason, updateReviewer, type StagedChange } from "../storage/changes.js";

export interface UiOptions extends ResolveAuthOptions {
  report?: string;
  baseline?: string;
}

type EnrichedReport = ScanReport & { notes: Record<string, Note[]>; changes: Record<string, StagedChange> };

export async function runUi(options: UiOptions): Promise<void> {
  const report = await resolveReport(options);

  const { url } = await startServer({
    report: report ? enrichReport(report) : null,
    onScanRequest: async (body) => enrichReport(await runBrowserTriggeredScan(options, body)),
    onNoteRequest: (body) => addNote(body.targetKey, "You", body.text),
    onStageChange: (body: StageChangeRequestBody) => stageChange(body),
    onUpdateChange: (id: number, body: UpdateChangeRequestBody) => {
      if (body.reason !== undefined) return updateReason(id, body.reason);
      if (body.reviewedBy !== undefined) return updateReviewer(id, body.reviewedBy);
      throw new Error("reason or reviewedBy is required");
    },
    onRevertChange: (id: number) => revertChange(id),
  });
  console.log(`intuneatlas ui — ${url}`);
  if (!report) console.log("No report yet — connect a tenant from the page that just opened.");
  await open(url);
}

function enrichReport(report: ScanReport): EnrichedReport {
  return { ...report, notes: getAllNotes(), changes: getAllChanges() };
}

async function resolveReport(options: UiOptions): Promise<ScanReport | undefined> {
  if (options.report) {
    const raw = await readFile(options.report, "utf8");
    return JSON.parse(raw) as ScanReport;
  }

  if (options.tenant) {
    return runLiveScan(options);
  }

  return getLatestScan();
}

async function runLiveScan(options: UiOptions): Promise<ScanReport> {
  const auth = resolveAuth(options);
  const token = await auth.getToken();
  const baselineRules = await loadBaselines(options.baseline ?? defaultBaselinesDir());
  const report = await buildReport(token, auth.flow, auth.tenantId, baselineRules);
  recordScan(report);
  return report;
}

/**
 * Backs the browser's "connect a tenant" screen. Only --client-id/--device-code/
 * --baseline from the CLI invocation carry over — the form itself only asks
 * for a tenant, keeping advanced flags a CLI-only concern (see project plan).
 */
async function runBrowserTriggeredScan(options: UiOptions, body: ScanRequestBody): Promise<ScanReport> {
  return runLiveScan({
    tenant: body.tenant,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    deviceCode: body.deviceCode ?? options.deviceCode,
    baseline: options.baseline,
  });
}
