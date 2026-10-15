import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViewerIdentity, WebSessionManager } from "../auth/webSession.js";
import { can } from "../auth/roles.js";
import { BaselineInputError } from "../baselines/manage.js";
import { logRequestError, sendApiError } from "./http.js";
import type { StartServerOptions } from "./types.js";

/**
 * A scan of a real tenant takes minutes, and the proxies a shared
 * instance sits behind give up on a request long before that (Azure
 * Container Apps: four minutes) — the browser would see an error while
 * the scan carried on unseen. So starting one only starts it: the answer
 * comes straight back, and the page asks how it's going until it's done.
 * One scan at a time; a second "sync" while one runs joins it.
 */
interface ScanJob {
  id: number;
  status: "running" | "done" | "failed";
  error?: string;
}

export function createScanJobs() {
  let job: ScanJob | undefined;
  return {
    current: () => job,
    start(run: () => Promise<void>): ScanJob {
      if (job?.status === "running") return job;
      const started: ScanJob = { id: (job?.id ?? 0) + 1, status: "running" };
      job = started;
      run().then(
        () => {
          started.status = "done";
        },
        (err) => {
          logRequestError(err);
          started.status = "failed";
          started.error = err instanceof Error ? err.message : String(err);
        },
      );
      return started;
    },
  };
}

export async function handleScanRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onScanRequest: StartServerOptions["onScanRequest"],
  session: WebSessionManager,
  viewer: ViewerIdentity,
  jobs: ReturnType<typeof createScanJobs>,
  setReport: (report: unknown) => void,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!onScanRequest) return json(501, { error: "Live scanning isn't available from this session." });
  if (!can(viewer.role, "scan")) return json(403, { error: "Your role doesn't include scanning the tenant. Ask an Admin." });

  try {
    const graphToken = await session.getGraphToken(req.headers.cookie);
    if (!graphToken) return json(401, { error: "Your sign-in expired — refresh the page to sign in again.", loginUrl: "/auth/login" });

    // What's stored (and what every viewer's own next request judges for
    // themselves) is the raw report — see handleScanStatus for the answer
    // whoever is waiting on this scan gets.
    const job = jobs.start(async () => setReport(await onScanRequest(graphToken)));
    json(202, { job: job.id, status: job.status });
  } catch (err) {
    sendApiError(res, err);
  }
}

/** How the scan a page is waiting on is going — and, once it's done, the report judged for whoever asks. */
export async function handleScanStatus(
  req: IncomingMessage,
  res: ServerResponse,
  onEvaluateForViewer: StartServerOptions["onEvaluateForViewer"],
  viewer: ViewerIdentity,
  jobs: ReturnType<typeof createScanJobs>,
  getReport: () => unknown,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!can(viewer.role, "view")) return json(403, { error: "Your role doesn't include viewing the report." });

  const wanted = Number(new URL(req.url ?? "", "http://x").searchParams.get("job"));
  const job = jobs.current();
  // A job this server doesn't know — it restarted mid-scan — is one that will never finish.
  if (!job || job.id !== wanted) return json(404, { error: "That scan was interrupted. Start it again." });
  if (job.status === "running") return json(200, { job: job.id, status: "running" });
  if (job.status === "failed") return json(200, { job: job.id, status: "failed", error: job.error });

  try {
    const raw = getReport();
    const report = onEvaluateForViewer ? await onEvaluateForViewer(raw, viewer) : raw;
    json(200, { job: job.id, status: "done", report });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function handleHistory(
  req: IncomingMessage,
  res: ServerResponse,
  onHistoryRequest: StartServerOptions["onHistoryRequest"],
  viewer: ViewerIdentity,
  onRecentHistory?: StartServerOptions["onRecentHistory"],
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!onHistoryRequest) return json(501, { error: "History isn't available from this session." });
  if (!can(viewer.role, "view")) return json(403, { error: "Your role doesn't include viewing the report." });
  const params = new URL(req.url ?? "", "http://localhost").searchParams;
  const key = params.get("key") ?? "";
  // No setting named: the whole tenant's, where the server has it.
  const whole = !key && params.get("all") === "1" && onRecentHistory;
  if (!key && !whole) return json(400, { error: "Name a setting." });
  try {
    const visible = viewer.visiblePolicies;
    if (whole) {
      // The tenant-wide log comes a page at a time, already narrowed — kind, words, and what this viewer
      // may see — so a page, the next one and the counts agree. `next` is where the following page starts.
      const limit = Math.min(Math.max(Number(params.get("limit")) || 100, 1), 1000);
      const offset = Math.max(Number(params.get("offset")) || 0, 0);
      const kind = params.get("kind");
      const answer = await onRecentHistory({
        limit,
        offset,
        ...(kind === "pushed" || kind === "seen" ? { kind } : {}),
        words: (params.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10),
        ...(visible ? { policyIds: [...visible.keys()] } : {}),
      });
      return json(200, { events: answer.events, counts: answer.counts, next: answer.events.length === limit ? offset + limit : null });
    }
    const events = (await onHistoryRequest(key)) as Array<{ policyId?: string }>;
    json(200, { events: visible ? events.filter((e) => !e.policyId || visible.has(e.policyId)) : events });
  } catch (err) {
    console.error("[history]", err);
    json(500, { error: "Couldn't read this setting's history." });
  }
}

/**
 * The settings as one group gets them: the same shape the page was
 * loaded with, for the browser to show in place of the tenant-wide list.
 * Same right as the report itself.
 */
export async function handleScope(
  req: IncomingMessage,
  res: ServerResponse,
  onScopeReport: StartServerOptions["onScopeReport"],
  onEvaluateForViewer: StartServerOptions["onEvaluateForViewer"],
  viewer: ViewerIdentity,
  getReport: () => unknown,
): Promise<void> {
  if (!onScopeReport) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Viewing by group isn't available from this session." }));
    return;
  }
  if (!can(viewer.role, "view")) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Your role doesn't include viewing the report." }));
    return;
  }
  const group = new URL(req.url ?? "", "http://localhost").searchParams.get("group") ?? "";
  if (!group) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Choose a group." }));
    return;
  }
  try {
    const raw = getReport();
    const scoped = raw ? await onScopeReport(raw, group) : null;
    const judged = (scoped && onEvaluateForViewer ? await onEvaluateForViewer(scoped, viewer) : scoped) as Record<string, unknown> | null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        group,
        settings: judged?.settings ?? [],
        compliancePolicies: judged?.compliancePolicies ?? [],
        enrollmentConfigurations: judged?.enrollmentConfigurations ?? [],
        conflictCount: judged?.conflictCount ?? 0,
        belowBaselineCount: judged?.belowBaselineCount ?? 0,
      }),
    );
  } catch (err) {
    if (err instanceof BaselineInputError) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    sendApiError(res, err);
  }
}
