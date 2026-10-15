import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViewerIdentity } from "../auth/webSession.js";
import { can } from "../auth/roles.js";
import { BaselineInputError, type AddPackInput } from "../baselines/manage.js";
import { MAX_REQUEST_BODY_BYTES, readRequestBody, sendApiError } from "./http.js";
import type { StartServerOptions } from "./types.js";

export async function handleSetBaselineSelection(
  req: IncomingMessage,
  res: ServerResponse,
  onSetBaselineSelection: StartServerOptions["onSetBaselineSelection"],
  onEvaluateForViewer: StartServerOptions["onEvaluateForViewer"],
  viewer: ViewerIdentity,
  getReport: () => unknown,
): Promise<void> {
  if (!onSetBaselineSelection || !onEvaluateForViewer) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Baseline selection isn't available from this session." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req)) as { packs: string[] | null };
    if (body.packs !== null && !Array.isArray(body.packs)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "packs must be an array of pack paths, or null for every pack" }));
      return;
    }

    onSetBaselineSelection(viewer.id, body.packs);
    const raw = getReport();
    const report = raw ? await onEvaluateForViewer(raw, viewer) : null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(report ? baselineVerdicts(report) : null));
  } catch (err) {
    sendApiError(res, err);
  }
}

// A whole baseline arrives as one request (a few MB of exported policies,
// base64-encoded) — far over the limit every other endpoint lives under,
// and only an Admin gets this far. manage.ts enforces its own, tighter
// limit on what the files decode to.
const MAX_BASELINE_UPLOAD_BYTES = 48_000_000;

/**
 * POST adds a baseline from uploaded files, PATCH renames one, DELETE
 * removes one. Admin only: these write and delete files on the machine
 * the server runs on. Answers with fresh baseline verdicts, since the set
 * of baselines the report is judged against just changed.
 */
export async function handleManageBaselines(
  req: IncomingMessage,
  res: ServerResponse,
  baselines: StartServerOptions["baselines"],
  onEvaluateForViewer: StartServerOptions["onEvaluateForViewer"],
  viewer: ViewerIdentity,
  getReport: () => unknown,
): Promise<void> {
  if (!baselines || !onEvaluateForViewer) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Baselines can't be managed from this session." }));
    return;
  }
  if (!can(viewer.role, "manageBaselines")) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Only the Admin role can add, rename or remove baselines." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req, req.method === "POST" ? MAX_BASELINE_UPLOAD_BYTES : MAX_REQUEST_BODY_BYTES)) as Record<string, unknown>;
    let pack: string | undefined;
    if (req.method === "POST") pack = await baselines.add(body as unknown as AddPackInput);
    else if (req.method === "PATCH") await baselines.rename(String(body.pack ?? ""), String(body.name ?? ""));
    else await baselines.remove(String(body.pack ?? ""));

    const raw = getReport();
    const report = raw ? await onEvaluateForViewer(raw, viewer) : null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...(pack ? { pack } : {}), ...(report ? (baselineVerdicts(report) as object) : {}) }));
  } catch (err) {
    if (err instanceof BaselineInputError) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    sendApiError(res, err);
  }
}

/**
 * What changes about a report when only the baselines do — the browser
 * already holds everything else. Per real setting just its verdict
 * (state, recommendations, checks); the synthetic "Missing" entries in
 * full, since they exist only because of the baselines; and the pack
 * list and selection. Sending this instead of the whole report again
 * keeps a baseline toggle to a fraction of the size.
 */
export function baselineVerdicts(report: unknown): unknown {
  const r = report as {
    settings: Array<{ key: string; state: string; recs: unknown; checks?: unknown }>;
    belowBaselineCount: number;
    baselinePacks?: unknown;
    activeBaselinePacks?: unknown;
    baselineFolder?: unknown;
  };
  const verdicts: Record<string, { state: string; recs: unknown; checks: unknown }> = {};
  const missing: unknown[] = [];
  for (const entry of r.settings) {
    if (entry.state === "Missing") missing.push(entry);
    else verdicts[entry.key] = { state: entry.state, recs: entry.recs, checks: entry.checks ?? [] };
  }
  return {
    verdicts,
    missing,
    belowBaselineCount: r.belowBaselineCount,
    baselinePacks: r.baselinePacks ?? [],
    activeBaselinePacks: r.activeBaselinePacks ?? null,
    ...(r.baselineFolder ? { baselineFolder: r.baselineFolder } : {}),
  };
}
