import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { resolveAppPath } from "../packagedPaths.js";
import type { ViewerIdentity, WebSessionManager } from "../auth/webSession.js";

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// Lazy, not a top-level constant — cli.ts imports every command module
// eagerly regardless of which command actually runs, so a top-level
// resolveAppPath() call here would execute (and could throw) on every
// invocation, even `--help`, whether or not the server is ever started.
function webDist(): string {
  return resolveAppPath("web/dist", import.meta.url);
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface NoteRequestBody {
  targetKey: string;
  text: string;
}

export interface StageChangeRequestBody {
  targetKey: string;
  targetName: string;
  ruleId: string;
  from: string;
  to: string;
}

export interface UpdateChangeRequestBody {
  reason?: string;
  reviewedBy?: string;
}

interface WithTargetKey {
  targetKey: string;
}

export interface StartServerOptions {
  /** null means "nothing scanned yet" — the UI shows its connect screen. */
  report: unknown | null;
  startPort?: number;
  /** Interface to bind to. Defaults to loopback-only; anything else is a shared/team deployment. */
  host?: string;
  /**
   * There's exactly one way in: a real per-browser Entra sign-in (see
   * src/auth/webSession.ts), gating every route — including the page itself
   * — whether this is running solo on a laptop or exposed for a team. What
   * differs between those two is only `host` above and whether sign-in can
   * happen silently from a cached account (see WebSessionManager.trySilentLogin).
   */
  session: WebSessionManager;
  /** Backs the browser's "scan now" action — the token comes from the caller's own session, there's nothing else to pass in. */
  onScanRequest?: (graphToken: string) => Promise<unknown>;
  /** Backs the note-adding UI; returns the updated note list for that key. */
  onNoteRequest?: (body: NoteRequestBody, viewer: ViewerIdentity) => unknown[];
  /** Stages a change; must return the created record including its targetKey. */
  onStageChange?: (body: StageChangeRequestBody) => WithTargetKey;
  /** Updates reason/reviewer on a staged change; must return the updated record including its targetKey. */
  onUpdateChange?: (id: number, body: UpdateChangeRequestBody, viewer: ViewerIdentity) => WithTargetKey;
  /** Reverts a staged change; returns the targetKey that was removed, or undefined if it didn't exist. */
  onRevertChange?: (id: number) => string | undefined;
}

export async function startServer(options: StartServerOptions): Promise<{ url: string; server: Server }> {
  let currentReport = options.report;
  const host = options.host ?? "127.0.0.1";
  const session = options.session;

  function requestOrigin(req: IncomingMessage): string {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
    return `${proto}://${req.headers.host}`;
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

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/auth/login") {
        const url = await session.loginRedirectUrl(`${requestOrigin(req)}/auth/callback`);
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
        res.writeHead(302, { Location: "/", "Set-Cookie": session.clearSessionCookie() });
        res.end();
        return;
      }

      let viewer = session.getSession(req.headers.cookie);
      if (!viewer && req.method === "GET") {
        // A returning solo user shouldn't have to click through a visible
        // sign-in every launch — try the OS-cached account first, silently.
        const silent = await session.trySilentLogin();
        if (silent) {
          res.writeHead(302, { Location: req.url ?? "/", "Set-Cookie": session.sessionCookie(silent.sessionId) });
          res.end();
          return;
        }
      }
      if (!viewer) {
        if (req.method === "GET") {
          res.writeHead(302, { Location: "/auth/login" });
          res.end();
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Sign in required.", loginUrl: "/auth/login" }));
        }
        return;
      }

      if (req.method === "POST" && req.url === "/api/scan") {
        await handleScanRequest(req, res, options.onScanRequest, session, (report) => {
          currentReport = report;
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/notes") {
        await handleNoteRequest(req, res, options.onNoteRequest, viewer, (targetKey, notes) => {
          if (currentReport && typeof currentReport === "object") {
            const existing = currentReport as Record<string, unknown>;
            const existingNotes = (existing.notes as Record<string, unknown[]> | undefined) ?? {};
            currentReport = { ...existing, notes: { ...existingNotes, [targetKey]: notes } };
          }
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/changes") {
        await handleStageChange(req, res, options.onStageChange, (change) => setChange(change.targetKey, change));
        return;
      }

      const changeIdMatch = req.url?.match(/^\/api\/changes\/(\d+)$/);
      if (changeIdMatch && req.method === "PATCH") {
        await handleUpdateChange(req, res, Number(changeIdMatch[1]), options.onUpdateChange, viewer, (change) =>
          setChange(change.targetKey, change),
        );
        return;
      }
      if (changeIdMatch && req.method === "DELETE") {
        await handleRevertChange(res, Number(changeIdMatch[1]), options.onRevertChange, removeChange);
        return;
      }

      await serveStatic(req, res, () => currentReport, viewer);
    } catch {
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

async function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  session: WebSessionManager,
  requestOrigin: (req: IncomingMessage) => string,
): Promise<void> {
  const url = new URL(req.url ?? "", requestOrigin(req));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing code or state.");
    return;
  }

  try {
    const { sessionId } = await session.completeLogin({ code, state, redirectUri: `${requestOrigin(req)}/auth/callback` });
    res.writeHead(302, { Location: "/", "Set-Cookie": session.sessionCookie(sessionId) });
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(`Sign-in failed: ${message}`);
  }
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  getReport: () => unknown,
  viewer: ViewerIdentity,
): Promise<void> {
  const dist = webDist();
  const requestPath = (req.url ?? "/").split("?")[0];
  const filePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const fullPath = join(dist, filePath);

  // Not resolving deep client-side routes — this is a single-page app with
  // no router, so anything unrecognized just falls back to index.html.
  const isAsset = extname(filePath) !== "";
  const targetPath = isAsset ? fullPath : join(dist, "index.html");

  let body = await readFile(targetPath);
  const contentType = CONTENT_TYPES[extname(targetPath)] ?? "application/octet-stream";

  if (extname(targetPath) === ".html") {
    const injectedScript =
      `<script>window.__INTUNEATLAS_REPORT__ = ${JSON.stringify(getReport())};` +
      `window.__INTUNEATLAS_SESSION__ = ${JSON.stringify(viewer)};</script>`;
    body = Buffer.from(body.toString("utf8").replace("</head>", `${injectedScript}</head>`));
  }

  res.writeHead(200, { "Content-Type": contentType });
  res.end(body);
}

async function handleScanRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onScanRequest: StartServerOptions["onScanRequest"],
  session: WebSessionManager,
  setReport: (report: unknown) => void,
): Promise<void> {
  if (!onScanRequest) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Live scanning isn't available from this session." }));
    return;
  }

  try {
    const graphToken = await session.getGraphToken(req.headers.cookie);
    if (!graphToken) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Your sign-in expired — refresh the page to sign in again.", loginUrl: "/auth/login" }));
      return;
    }

    const report = await onScanRequest(graphToken);
    setReport(report);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(report));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleNoteRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onNoteRequest: StartServerOptions["onNoteRequest"],
  viewer: ViewerIdentity,
  onSaved: (targetKey: string, notes: unknown[]) => void,
): Promise<void> {
  if (!onNoteRequest) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Notes aren't available from this session." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req)) as NoteRequestBody;
    if (!body.targetKey || !body.text?.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "targetKey and text are required" }));
      return;
    }

    const notes = onNoteRequest(body, viewer);
    onSaved(body.targetKey, notes);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(notes));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleStageChange(
  req: IncomingMessage,
  res: ServerResponse,
  onStageChange: StartServerOptions["onStageChange"],
  onSaved: (change: WithTargetKey) => void,
): Promise<void> {
  if (!onStageChange) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Staging changes isn't available from this session." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req)) as StageChangeRequestBody;
    if (!body.targetKey || !body.targetName || !body.ruleId || body.from === undefined || body.to === undefined) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "targetKey, targetName, ruleId, from, and to are required" }));
      return;
    }

    const change = onStageChange(body);
    onSaved(change);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(change));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleUpdateChange(
  req: IncomingMessage,
  res: ServerResponse,
  id: number,
  onUpdateChange: StartServerOptions["onUpdateChange"],
  viewer: ViewerIdentity,
  onSaved: (change: WithTargetKey) => void,
): Promise<void> {
  if (!onUpdateChange) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Updating changes isn't available from this session." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req)) as UpdateChangeRequestBody;
    if (body.reason === undefined && body.reviewedBy === undefined) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "reason or reviewedBy is required" }));
      return;
    }

    const change = onUpdateChange(id, body, viewer);
    onSaved(change);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(change));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleRevertChange(
  res: ServerResponse,
  id: number,
  onRevertChange: StartServerOptions["onRevertChange"],
  onReverted: (targetKey: string) => void,
): Promise<void> {
  if (!onRevertChange) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Reverting changes isn't available from this session." }));
    return;
  }

  try {
    const targetKey = onRevertChange(id);
    if (targetKey) onReverted(targetKey);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ reverted: Boolean(targetKey) }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function listenOnFreePort(server: Server, startPort: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(startPort, host, () => resolve(startPort));
  });
}
