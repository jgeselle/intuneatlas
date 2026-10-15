import { createServer, type IncomingMessage, type Server } from "node:http";
import type { ViewerIdentity } from "../auth/webSession.js";
import { appPath, handleCallback } from "./auth.js";
import { handleManageBaselines, handleSetBaselineSelection } from "./baselines.js";
import { handlePushChange, handleRevertChange, handleStageChange, handleUpdateChange } from "./changes.js";
import { fromThisOrigin, logRequestError, READ_METHODS } from "./http.js";
import { handleDeleteNote, handleNoteRequest } from "./notes.js";
import { handleReminders, settingVisible } from "./reminders.js";
import { createScanJobs, handleHistory, handleScanRequest, handleScanStatus, handleScope } from "./scans.js";
import { serveStatic } from "./static.js";
import type { StartServerOptions } from "./types.js";

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export async function startServer(options: StartServerOptions): Promise<{ url: string; server: Server }> {
  let currentReport = options.report;
  const host = options.host ?? "127.0.0.1";
  const session = options.session;

  function requestOrigin(req: IncomingMessage): string {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
    return `${proto}://${req.headers.host}`;
  }

  /** Whether the browser's own connection is HTTPS — this server only ever sees what the proxy in front of it reports. */
  function isHttps(req: IncomingMessage): boolean {
    return requestOrigin(req).startsWith("https://");
  }

  function setNotes(targetKey: string, notes: unknown[]): void {
    if (!currentReport || typeof currentReport !== "object") return;
    const existing = currentReport as Record<string, unknown>;
    const existingNotes = (existing.notes as Record<string, unknown[]> | undefined) ?? {};
    currentReport = { ...existing, notes: { ...existingNotes, [targetKey]: notes } };
  }

  function setChange(targetKey: string, change: unknown): void {
    if (!currentReport || typeof currentReport !== "object") return;
    const existing = currentReport as Record<string, unknown>;
    const existingChanges = (existing.changes as Record<string, unknown> | undefined) ?? {};
    currentReport = { ...existing, changes: { ...existingChanges, [targetKey]: change } };
  }

  function removeChange(targetKey: string): void {
    if (!currentReport || typeof currentReport !== "object") return;
    const existing = currentReport as Record<string, unknown>;
    const existingChanges = { ...((existing.changes as Record<string, unknown> | undefined) ?? {}) };
    delete existingChanges[targetKey];
    currentReport = { ...existing, changes: existingChanges };
  }

  const scanJobs = createScanJobs();

  // What each viewer may see, kept a few minutes — a page load makes several requests, each of which
  // needs it. Forgotten whenever there's a new scan: new policies are visible to someone.
  const VISIBILITY_TTL_MS = 10 * 60_000;
  const visibilityCache = new Map<string, { at: number; scanned: unknown; value: ReadonlyMap<string, string> }>();
  async function withVisibility(req: IncomingMessage, viewer: ViewerIdentity): Promise<ViewerIdentity> {
    if (!options.policyVisibility) return viewer;
    const scanned = (currentReport as { scannedAt?: unknown } | null)?.scannedAt;
    const held = visibilityCache.get(viewer.id);
    if (held && held.scanned === scanned && Date.now() - held.at < VISIBILITY_TTL_MS) return { ...viewer, visiblePolicies: held.value };
    try {
      const token = await session.getGraphToken(req.headers.cookie);
      if (!token) return { ...viewer, visiblePolicies: new Map(), visibilityError: "Your sign-in expired — refresh the page to sign in again." };
      const value = await options.policyVisibility(token);
      visibilityCache.set(viewer.id, { at: Date.now(), scanned, value });
      return { ...viewer, visiblePolicies: value };
    } catch (err) {
      logRequestError(err);
      // Seeing nothing, not everything: the scan was made with someone else's rights.
      if (held) return { ...viewer, visiblePolicies: held.value };
      const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ...viewer, visiblePolicies: new Map(), visibilityError: `Couldn't check which policies your Intune role lets you see (${reason}).` };
    }
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/auth/login" || req.url?.startsWith("/auth/login?"))) {
        const returnTo = appPath(new URL(req.url, "http://x").searchParams.get("return"));
        const url = await session.loginRedirectUrl(`${requestOrigin(req)}/auth/callback`, returnTo);
        res.writeHead(302, { Location: url });
        res.end();
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/auth/callback")) {
        await handleCallback(req, res, session, requestOrigin);
        return;
      }
      if (req.method === "GET" && req.url === "/auth/logout") {
        await session.signOut(req.headers.cookie);
        res.writeHead(302, { Location: "/", "Set-Cookie": session.clearSessionCookie(isHttps(req)) });
        res.end();
        return;
      }

      // Anything that changes something must come from this app's own page. The SameSite=Lax cookie
      // already keeps other sites out; this keeps out a neighbour on the same parent domain too.
      if (!READ_METHODS.has(req.method ?? "GET") && !fromThisOrigin(req.headers, requestOrigin(req))) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "This request didn't come from IntuneAtlas's own page." }));
        return;
      }

      let viewer = await session.getSession(req.headers.cookie);
      if (!viewer && req.method === "GET" && LOOPBACK_HOSTS.has(host)) {
        // A returning solo user shouldn't have to click through a visible
        // sign-in every launch — try the OS-cached account first, silently.
        // Loopback-only: trySilentLogin() reads from a single server-process-
        // wide cache (whoever last signed in on this machine), not anything
        // tied to the calling browser. Off loopback that's the whole tenant's
        // network reachability away from an anonymous visitor's very first
        // GET silently minting them a session as the operator, with the
        // operator's real Graph token behind it — exactly the "everyone
        // signs in individually" guarantee shared mode is supposed to give.
        const silent = await session.trySilentLogin();
        if (silent) {
          res.writeHead(302, { Location: req.url ?? "/", "Set-Cookie": session.sessionCookie(silent.sessionId, isHttps(req)) });
          res.end();
          return;
        }
      }
      if (!viewer) {
        if (req.method === "GET") {
          // A shared link survives signing in: the sign-in comes back to it.
          const back = appPath(req.url);
          res.writeHead(302, { Location: back && back !== "/" ? "/auth/login?return=" + encodeURIComponent(back) : "/auth/login" });
          res.end();
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Sign in required.", loginUrl: "/auth/login" }));
        }
        return;
      }

      // The page and the API carry tenant data; scripts, styles and images don't.
      if (req.url === "/" || req.url?.startsWith("/?") || req.url?.startsWith("/api/")) viewer = await withVisibility(req, viewer);

      if (req.method === "POST" && req.url === "/api/scan") {
        await handleScanRequest(req, res, options.onScanRequest, session, viewer, scanJobs, (report) => {
          currentReport = report;
        });
        return;
      }

      if (req.method === "GET" && req.url?.startsWith("/api/scan?")) {
        await handleScanStatus(req, res, options.onEvaluateForViewer, viewer, scanJobs, () => currentReport);
        return;
      }

      if (req.method === "PUT" && req.url === "/api/baseline-selection") {
        await handleSetBaselineSelection(
          req,
          res,
          options.onSetBaselineSelection,
          options.onEvaluateForViewer,
          viewer,
          () => currentReport,
        );
        return;
      }

      if (req.method === "GET" && req.url?.startsWith("/api/scope?")) {
        await handleScope(req, res, options.onScopeReport, options.onEvaluateForViewer, viewer, () => currentReport);
        return;
      }

      if (req.method === "GET" && req.url?.startsWith("/api/history?")) {
        await handleHistory(req, res, options.onHistoryRequest, viewer, options.onRecentHistory);
        return;
      }

      if (req.url === "/api/baselines" && (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE")) {
        await handleManageBaselines(req, res, options.baselines, options.onEvaluateForViewer, viewer, () => currentReport);
        return;
      }

      if (req.method === "POST" && req.url === "/api/notes") {
        await handleNoteRequest(req, res, options.onNoteRequest, viewer, setNotes);
        return;
      }

      const noteIdMatch = req.url?.match(/^\/api\/notes\/(\d+)$/);
      if (noteIdMatch && req.method === "DELETE") {
        await handleDeleteNote(res, Number(noteIdMatch[1]), options.onDeleteNote, options.getNoteById, viewer, setNotes);
        return;
      }

      if (req.url === "/api/reminders" || req.url?.startsWith("/api/reminders/")) {
        await handleReminders(req, res, options.reminders, viewer, (key) => settingVisible(currentReport, viewer, key));
        return;
      }

      if (req.method === "POST" && req.url === "/api/changes") {
        await handleStageChange(req, res, options.onStageChange, viewer, (change) => setChange(change.targetKey, change));
        return;
      }

      const changeIdMatch = req.url?.match(/^\/api\/changes\/(\d+)$/);
      if (changeIdMatch && req.method === "PATCH") {
        await handleUpdateChange(
          req,
          res,
          Number(changeIdMatch[1]),
          options.onUpdateChange,
          options.getChangeById,
          viewer,
          (change) => setChange(change.targetKey, change),
        );
        return;
      }
      const pushMatch = req.url?.match(/^\/api\/changes\/(\d+)\/push$/);
      if (pushMatch && req.method === "POST") {
        await handlePushChange(req, res, Number(pushMatch[1]), options, session, viewer, () => currentReport, removeChange, (report) => {
          currentReport = report;
        });
        return;
      }

      if (changeIdMatch && req.method === "DELETE") {
        await handleRevertChange(res, Number(changeIdMatch[1]), options.onRevertChange, options.getChangeById, viewer, removeChange);
        return;
      }

      await serveStatic(req, res, () => currentReport, viewer, options.onEvaluateForViewer, options.version);
    } catch (err) {
      // serveStatic's readFile throwing ENOENT for a genuinely missing
      // static asset is the routine, expected case this 404 exists for —
      // not worth logging. Anything else reaching here is a real bug
      // (in this handler or something it calls) masquerading as a plain
      // 404 with zero visibility into what actually happened.
      const isMissingAsset = typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
      if (!isMissingAsset) logRequestError(err);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  // The redirect URI registered on the Entra app is an exact string, and
  // OAuth doesn't allow wildcard port matching — every launch goes through
  // the same sign-in now, so silently walking to the next free port would
  // just break it. Fail loudly instead of guessing.
  const port = await listenOnFreePort(server, options.startPort ?? 7878, host);
  return { url: `http://${LOOPBACK_HOSTS.has(host) ? "localhost" : host}:${port}`, server };
}

function listenOnFreePort(server: Server, startPort: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(startPort, host, () => resolve(startPort));
  });
}
