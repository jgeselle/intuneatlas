import { readFile } from "node:fs/promises";
import open from "open";
import { createWebSessionManager } from "../auth/webSession.js";
import { defaultBaselinesDir, loadBaselines } from "../baselines/loader.js";
import { buildReport, type ScanReport } from "../scan/report.js";
import { LOOPBACK_HOSTS, startServer, type StageChangeRequestBody, type UpdateChangeRequestBody } from "../server/staticServer.js";
import { addNote, getAllNotes, type Note } from "../storage/notes.js";
import { getLatestScan, recordScan } from "../storage/scans.js";
import { getAllChanges, revertChange, stageChange, updateReason, updateReviewer, type StagedChange } from "../storage/changes.js";

export interface UiOptions {
  tenant?: string;
  clientId?: string;
  report?: string;
  baseline?: string;
  /** Interface to bind to (default: 127.0.0.1, this machine only). */
  host?: string;
}

type EnrichedReport = ScanReport & { notes: Record<string, Note[]>; changes: Record<string, StagedChange> };

export async function runUi(options: UiOptions): Promise<void> {
  const host = options.host ?? "127.0.0.1";
  const staticReport = await resolveStaticReport(options);

  // Every launch — solo laptop or a `--host`-exposed team instance — signs
  // in the same way (see src/auth/webSession.ts), and that sign-in needs a
  // tenant to scope itself to. Fall back to whatever a stored/loaded report
  // already names so returning to a tenant you've scanned before doesn't
  // require retyping it.
  const tenantId = options.tenant ?? staticReport?.tenant;
  if (!tenantId) {
    throw new Error(
      "Missing tenant. Pass --tenant <id-or-domain> — needed to sign in — or run `intuneatlas scan` first.",
    );
  }
  const clientId = options.clientId ?? process.env.INTUNEATLAS_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "Missing client ID. Register your own Entra app (see intuneatlas.com/docs) and pass " +
        "--client-id <id>, or set INTUNEATLAS_CLIENT_ID.",
    );
  }
  const session = await createWebSessionManager(tenantId, clientId);
  const baselinePath = options.baseline;

  const { url } = await startServer({
    report: staticReport ? enrichReport(staticReport) : null,
    host,
    session,
    onScanRequest: async (graphToken) => enrichReport(await runViewerTriggeredScan(tenantId, baselinePath, graphToken)),
    onNoteRequest: (body, viewer) => addNote(body.targetKey, viewer.name, body.text),
    onStageChange: (body: StageChangeRequestBody) => stageChange(body),
    onUpdateChange: (id: number, body: UpdateChangeRequestBody, viewer) => {
      // "Reviewed by" always names the real signed-in viewer, never
      // client-supplied text — otherwise anyone could type any name into
      // the box and claim someone else reviewed a change.
      if (body.reviewedBy !== undefined) return updateReviewer(id, viewer.name);
      if (body.reason !== undefined) return updateReason(id, body.reason);
      throw new Error("reason or reviewedBy is required");
    },
    onRevertChange: (id: number) => revertChange(id),
  });
  console.log(`intuneatlas ui — ${url}`);
  if (!staticReport) console.log("No report yet — sign in, then scan from the page that just opened.");
  if (LOOPBACK_HOSTS.has(host)) {
    await open(url);
  } else {
    console.log("Share that URL with your team — everyone signs in with their own Microsoft account.");
  }
}

function enrichReport(report: ScanReport): EnrichedReport {
  return { ...report, notes: getAllNotes(), changes: getAllChanges() };
}

/** Reads a canned report or the last stored scan — never touches Graph; live scanning only ever happens via a signed-in browser session (see runViewerTriggeredScan). */
async function resolveStaticReport(options: UiOptions): Promise<ScanReport | undefined> {
  if (options.report) {
    const raw = await readFile(options.report, "utf8");
    return JSON.parse(raw) as ScanReport;
  }
  return getLatestScan(options.tenant);
}

async function runViewerTriggeredScan(tenantId: string, baselinePath: string | undefined, graphToken: string): Promise<ScanReport> {
  const baselineRules = await loadBaselines(baselinePath ?? defaultBaselinesDir());
  const report = await buildReport(graphToken, "interactive-browser", tenantId, baselineRules);
  recordScan(report);
  return report;
}
