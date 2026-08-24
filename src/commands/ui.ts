import { readFile } from "node:fs/promises";
import open from "open";
import { resolveClientId } from "../auth/index.js";
import { createWebSessionManager } from "../auth/webSession.js";
import { defaultBaselinesDir, loadBaselines } from "../baselines/loader.js";
import { listBaselinePacks, type BaselinePack } from "../baselines/packs.js";
import { applyBaselinesToReport, buildReport, type ScanReport } from "../scan/report.js";
import {
  LOOPBACK_HOSTS,
  startServer,
  type StageChangeRequestBody,
  type UpdateChangeRequestBody,
} from "../server/staticServer.js";
import type { ViewerIdentity } from "../auth/webSession.js";
import { addNote, deleteNote, getAllNotes, getNoteById, type Note } from "../storage/notes.js";
import { getLatestScan, recordScan } from "../storage/scans.js";
import { clearSelectedPacks, getSelectedPacks, setSelectedPacks } from "../storage/baselineSelections.js";
import {
  getAllChanges,
  getChangeById,
  revertChange,
  stageChange,
  updateReason,
  updateReviewer,
  type StagedChange,
} from "../storage/changes.js";

export interface UiOptions {
  tenant?: string;
  clientId?: string;
  report?: string;
  baseline?: string;
  /** Interface to bind to (default: 127.0.0.1, this machine only). */
  host?: string;
}

/** Raw — settings carry no baseline judgment yet, notes/changes are tenant-wide and shared. */
type RawEnrichedReport = ScanReport & { notes: Record<string, Note[]>; changes: Record<string, StagedChange> };
/** What actually gets served — judged for one specific viewer's own active-baseline selection. */
type ViewerReport = RawEnrichedReport & { baselinePacks: BaselinePack[]; activeBaselinePacks: string[] | null };

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
  const clientId = await resolveClientId(options.clientId);
  const session = await createWebSessionManager(tenantId, clientId);
  const baselinePath = options.baseline;

  const { url } = await startServer({
    // Raw — never pre-evaluated. Judging it for the specific viewer loading
    // the page happens in onEvaluateForViewer below, every time, so it's
    // never stale relative to whatever that viewer's own selection is.
    report: staticReport ? enrichReport(staticReport) : null,
    host,
    session,
    onScanRequest: async (graphToken) => enrichReport(await runViewerTriggeredScan(tenantId, graphToken)),
    onEvaluateForViewer: (report, viewer) => evaluateForViewer(report as RawEnrichedReport, viewer, baselinePath),
    onSetBaselineSelection: (viewerId, packs) => {
      if (packs === null) clearSelectedPacks(viewerId);
      else setSelectedPacks(viewerId, packs);
    },
    onNoteRequest: (body, viewer) => addNote(body.targetKey, viewer.id, viewer.name, body.text),
    onDeleteNote: (id: number) => deleteNote(id),
    getNoteById: (id: number) => getNoteById(id),
    onStageChange: (body: StageChangeRequestBody, viewer) => stageChange(body, viewer.id, viewer.name),
    onUpdateChange: (id: number, body: UpdateChangeRequestBody, viewer) => {
      // "Reviewed by" always names the real signed-in viewer, never
      // client-supplied text — otherwise anyone could type any name into
      // the box and claim someone else reviewed a change.
      if (body.reviewedBy !== undefined) return updateReviewer(id, viewer.name);
      if (body.reason !== undefined) return updateReason(id, body.reason);
      throw new Error("reason or reviewedBy is required");
    },
    onRevertChange: (id: number) => revertChange(id),
    getChangeById: (id: number) => getChangeById(id),
  });
  console.log(`intuneatlas ui — ${url}`);
  if (!staticReport) console.log("No report yet — sign in, then scan from the page that just opened.");
  if (LOOPBACK_HOSTS.has(host)) {
    await open(url);
  } else {
    console.log("Share that URL with your team — everyone signs in with their own Microsoft account.");
    // The app itself only ever speaks plain HTTP — no built-in TLS — and
    // session cookies are deliberately not marked Secure to match (a Secure
    // cookie over plain HTTP just gets silently dropped by the browser).
    // Entra's own redirect-URI rule (https:// or exactly localhost) means
    // sign-in can't complete at all without a real TLS-terminating proxy in
    // front of this, but there's nothing here to catch a misconfigured one
    // — say so explicitly rather than relying on someone having already
    // read the docs.
    console.log("This must sit behind a real HTTPS reverse proxy (see intuneatlas.com/docs) — never expose it directly.");
  }
}

function enrichReport(report: ScanReport): RawEnrichedReport {
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

async function runViewerTriggeredScan(tenantId: string, graphToken: string): Promise<ScanReport> {
  // recordScan persists only the raw report — evaluating against a
  // different baseline selection later never needs another scan.
  const rawReport = await buildReport(graphToken, "interactive-browser", tenantId);
  recordScan(rawReport);
  return rawReport;
}

/**
 * Judges a raw (but notes/changes-enriched) report for one specific
 * viewer: loads whatever baseline rules currently exist on disk (fresh —
 * baselines are just YAML files, an edit takes effect on the very next
 * request, no restart needed), looks up that viewer's own active-pack
 * selection (undefined = never customized = every pack active), and
 * attaches the full discovered pack list too so the picker always has
 * something to show regardless of what's currently selected.
 */
async function evaluateForViewer(
  report: RawEnrichedReport,
  viewer: ViewerIdentity,
  baselinePath: string | undefined,
): Promise<ViewerReport> {
  const baselineRules = await loadBaselines(baselinePath ?? defaultBaselinesDir());
  const activePacks = getSelectedPacks(viewer.id);
  const evaluated = applyBaselinesToReport(report, baselineRules, activePacks);
  return {
    ...evaluated,
    notes: report.notes,
    changes: report.changes,
    baselinePacks: listBaselinePacks(baselineRules),
    activeBaselinePacks: activePacks ?? null,
  };
}
