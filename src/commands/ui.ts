import { readFile } from "node:fs/promises";
import open from "open";
import { resolveClientId } from "../auth/index.js";
import { createWebSessionManager } from "../auth/webSession.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { baselineDirs, loadBaselines, userBaselinesDir } from "../baselines/loader.js";
import { scopeToGroup } from "../scan/scope.js";
import { addPack, removePack, renamePack } from "../baselines/manage.js";
import { listBaselinePacks, type BaselinePack } from "../baselines/packs.js";
import { applyBaselinesToReport, baselineDefinitionIds, buildReport, type ScanReport } from "../scan/report.js";
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
  updateNewPolicyName,
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
  /** This build's version, for the UI to show. */
  version?: string;
}

/** Raw — settings carry no baseline judgment yet, notes/changes are tenant-wide and shared. */
type RawEnrichedReport = ScanReport & { notes: Record<string, Note[]>; changes: Record<string, StagedChange> };
/** What actually gets served — judged for one specific viewer's own active-baseline selection. */
type ViewerReport = RawEnrichedReport & { baselinePacks: BaselinePack[]; activeBaselinePacks: string[] | null; baselineFolder?: string };

export async function runUi(options: UiOptions): Promise<void> {
  // The environment variables are for where there is no command line to speak of — a container:
  // INTUNEATLAS_HOST and INTUNEATLAS_TENANT_ID stand in for --host and --tenant (and
  // INTUNEATLAS_CLIENT_ID, read by resolveClientId, for --client-id); INTUNEATLAS_PORT moves it off 7878.
  const host = options.host ?? process.env.INTUNEATLAS_HOST ?? "127.0.0.1";
  const staticReport = await resolveStaticReport(options);

  // As a container's main process nothing ends this on SIGTERM unless it says so itself —
  // without it every restart or scale-down waits out the platform's kill timeout.
  process.once("SIGTERM", () => process.exit(0));

  // Every launch — solo laptop or a `--host`-exposed team instance — signs
  // in the same way (see src/auth/webSession.ts), and that sign-in needs a
  // tenant to scope itself to. Fall back to whatever a stored/loaded report
  // already names so returning to a tenant you've scanned before doesn't
  // require retyping it.
  const tenantId = options.tenant ?? process.env.INTUNEATLAS_TENANT_ID ?? staticReport?.tenant;
  if (!tenantId) {
    throw new Error(
      "Missing tenant. Pass --tenant <id-or-domain> (or set INTUNEATLAS_TENANT_ID) — needed to sign in — or run `intuneatlas scan` first.",
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
    ...(options.version ? { version: options.version } : {}),
    host,
    // 7878 unless told otherwise — for a platform that dictates the port its containers listen on.
    ...(Number(process.env.INTUNEATLAS_PORT) > 0 ? { startPort: Number(process.env.INTUNEATLAS_PORT) } : {}),
    session,
    onScanRequest: async (graphToken) => enrichReport(await runViewerTriggeredScan(tenantId, graphToken, baselinePath)),
    onEvaluateForViewer: (report, viewer) => evaluateForViewer(report as RawEnrichedReport, viewer, baselinePath),
    onScopeReport: (report, groupId) => scopeToGroup(report as RawEnrichedReport, groupId),
    // With --baseline the baselines come from a folder of the operator's choosing; that isn't the app's to write to.
    ...(baselinePath
      ? {}
      : {
          baselines: {
            add: (input) => addPack(userBaselinesDir(), input),
            rename: (pack, name) => renamePack(userBaselinesDir(), pack, name),
            remove: (pack) => removePack(userBaselinesDir(), pack),
          },
        }),
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
      // An empty value takes the review back; anything else records the signed-in viewer, whatever was sent.
      if (body.reviewedBy !== undefined) return updateReviewer(id, body.reviewedBy === "" ? "" : viewer.name);
      if (body.reason !== undefined) return updateReason(id, body.reason);
      if (body.policyName !== undefined) return updateNewPolicyName(id, body.policyName);
      throw new Error("reason, reviewedBy or policyName is required");
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
    // The app itself only ever speaks plain HTTP — no built-in TLS. Entra's own
    // redirect-URI rule (https:// or exactly localhost) means sign-in can't
    // complete at all without something terminating TLS in front of this
    // (a reverse proxy, or a platform's ingress — which is also what makes
    // the session cookie Secure, see staticServer.ts), but there's nothing
    // here to catch a missing one — say so explicitly rather than relying on
    // someone having already read the docs.
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

async function runViewerTriggeredScan(tenantId: string, graphToken: string, baselinePath: string | undefined): Promise<ScanReport> {
  // recordScan persists only the raw report — evaluating against a
  // different baseline selection later never needs another scan.
  // The baselines only tell the scan which definitions to also look up, so settings a baseline expects but the tenant lacks have names.
  const baselineRules = await loadBaselines(baselineDirs(baselinePath));
  const rawReport = await buildReport(graphToken, "interactive-browser", tenantId, baselineDefinitionIds(baselineRules));
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
  const baselineRules = await loadBaselines(baselineDirs(baselinePath));
  const activePacks = getSelectedPacks(viewer.id);
  // The lookup table has done its job once the report is judged; the browser never reads it.
  const { baselineDefinitions: _lookups, ...evaluated } = applyBaselinesToReport(report, baselineRules, activePacks);
  return {
    ...evaluated,
    notes: report.notes,
    changes: report.changes,
    // A baseline can be renamed or removed from the UI only if it sits in the user's own folder.
    baselinePacks: listBaselinePacks(baselineRules).map((pack) => ({
      ...pack,
      editable: !baselinePath && existsSync(join(userBaselinesDir(), ...pack.path.split("/"))),
    })),
    activeBaselinePacks: activePacks ?? null,
    ...(baselinePath ? {} : { baselineFolder: userBaselinesDir() }),
  };
}
