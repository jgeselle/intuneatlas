import { readFile } from "node:fs/promises";
import open from "open";
import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { defaultBaselinesDir, loadBaselines } from "../baselines/loader.js";
import { buildReport, type ScanReport } from "../scan/report.js";
import { startServer, type ScanRequestBody } from "../server/staticServer.js";
import { addNote, getAllNotes, type Note } from "../storage/notes.js";
import { getLatestScan, recordScan } from "../storage/scans.js";

export interface UiOptions extends ResolveAuthOptions {
  report?: string;
  baseline?: string;
}

type ReportWithNotes = ScanReport & { notes: Record<string, Note[]> };

export async function runUi(options: UiOptions): Promise<void> {
  const report = await resolveReport(options);

  const { url } = await startServer({
    report: report ? withNotes(report) : null,
    onScanRequest: async (body) => withNotes(await runBrowserTriggeredScan(options, body)),
    onNoteRequest: (body) => addNote(body.targetKey, "You", body.text),
  });
  console.log(`intuneatlas ui — ${url}`);
  if (!report) console.log("No report yet — connect a tenant from the page that just opened.");
  await open(url);
}

function withNotes(report: ScanReport): ReportWithNotes {
  return { ...report, notes: getAllNotes() };
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
