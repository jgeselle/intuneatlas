import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveAppPath } from "../packagedPaths.js";
import type { ViewerIdentity, WebSessionManager } from "../auth/webSession.js";
import { can } from "../auth/roles.js";

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
  onStageChange?: (body: StageChangeRequestBody, viewer: ViewerIdentity) => WithTargetKey;
  /** Updates reason/reviewer on a staged change; must return the updated record including its targetKey. */
  onUpdateChange?: (id: number, body: UpdateChangeRequestBody, viewer: ViewerIdentity) => WithTargetKey;
  /** Reverts a staged change; returns the targetKey that was removed, or undefined if it didn't exist. */
  onRevertChange?: (id: number) => string | undefined;
  /** Looks up who staged a change, for the editChange/revertChange ownership check — undefined if the id doesn't exist. */
  getChangeById?: (id: number) => { stagedBy: string } | undefined;
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
        await handleScanRequest(req, res, options.onScanRequest, session, viewer, (report) => {
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
      if (changeIdMatch && req.method === "DELETE") {
        await handleRevertChange(res, Number(changeIdMatch[1]), options.onRevertChange, options.getChangeById, viewer, removeChange);
        return;
      }

      await serveStatic(req, res, () => currentReport, viewer);
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

/**
 * JSON.stringify for embedding straight into a `<script>` block. Plain
 * JSON.stringify doesn't escape angle brackets, so a value containing a
 * literal script-closing sequence — e.g. a policy display name, which is
 * free text the tenant controls, not something this app validates —
 * closes the script tag early as far as the HTML *parser* is concerned
 * (it doesn't know or care that the text was inside a JS string literal),
 * letting whatever follows open a new, real script tag of its own.
 * Replacing every "<" with its six-character unicode escape round-trips
 * through JSON.parse to the identical string at runtime, but the HTML
 * parser never sees a literal "<" to act on. Confirmed live: without
 * this, a report containing a policy name built from a closing script
 * tag followed by a new opening one executed arbitrary JS in a real
 * browser loading this page.
 */
function jsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Given a request path, resolves which file under `dist` to actually
 * serve — pulled out as its own pure function so the security-critical
 * part (never resolving outside `dist`) is unit-testable without a real
 * built `web/dist` on disk. join()/resolve() alone don't stop `..` from
 * walking outside `dist` — a browser normalizes that out of a URL before
 * it's ever sent, but a bare HTTP client (curl --path-as-is, or worse)
 * won't, and this route only requires *a* valid session, not any Intune
 * permission. Without this check, a signed-in-but-otherwise-unprivileged
 * viewer could read anything else readable by the host process — the
 * local scan/notes DB, the MSAL token cache. relative() (not a plain
 * startsWith(dist)) so a sibling directory that happens to share `dist`
 * as a string prefix (e.g. a `dist-secrets` folder next to `dist`) isn't
 * misjudged as "inside" it. Not resolving deep client-side routes either
 * — this is a single-page app with no router, so anything unrecognized
 * (including anything that tried to escape `dist`) just falls back to
 * index.html.
 */
export function resolveStaticPath(dist: string, requestPath: string): string {
  const filePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const fullPath = resolve(dist, filePath);

  const rel = relative(dist, fullPath);
  const escapesDist = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

  const isAsset = extname(filePath) !== "" && !escapesDist;
  return isAsset ? fullPath : join(dist, "index.html");
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  getReport: () => unknown,
  viewer: ViewerIdentity,
): Promise<void> {
  const dist = webDist();
  const requestPath = (req.url ?? "/").split("?")[0];
  const targetPath = resolveStaticPath(dist, requestPath);

  let body = await readFile(targetPath);
  const contentType = CONTENT_TYPES[extname(targetPath)] ?? "application/octet-stream";

  if (extname(targetPath) === ".html") {
    // A signed-in-but-unassigned viewer (no Entra App Role) still gets the
    // SPA shell — it needs to load to render the "no role assigned"
    // screen — but never the actual report contents.
    const report = can(viewer.role, "view") ? getReport() : null;
    const injectedScript =
      `<script>window.__INTUNEATLAS_REPORT__ = ${jsonForScriptTag(report)};` +
      `window.__INTUNEATLAS_SESSION__ = ${jsonForScriptTag(viewer)};</script>`;
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
  viewer: ViewerIdentity,
  setReport: (report: unknown) => void,
): Promise<void> {
  if (!onScanRequest) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Live scanning isn't available from this session." }));
    return;
  }
  if (!can(viewer.role, "scan")) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Your role doesn't include scanning the tenant. Ask an Admin." }));
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
    sendApiError(res, err);
  }
}

// Same INTUNEATLAS_DEBUG convention cli.ts's own error handling uses.
// PayloadTooLargeError isn't logged — that one's an expected, correctly-
// handled condition (see readRequestBody), not a bug to go looking for.
function logRequestError(err: unknown): void {
  if (err instanceof PayloadTooLargeError) return;
  if (process.env.INTUNEATLAS_DEBUG) {
    console.error(err);
  } else {
    console.error(`intuneatlas: request error — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Shared by every JSON API handler's catch block — a too-large body gets its own status, everything else stays a 500. */
function sendApiError(res: ServerResponse, err: unknown): void {
  logRequestError(err);
  const message = err instanceof Error ? err.message : String(err);
  res.writeHead(err instanceof PayloadTooLargeError ? 413 : 500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
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
  if (!can(viewer.role, "note")) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Your role doesn't include adding notes." }));
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
    sendApiError(res, err);
  }
}

async function handleStageChange(
  req: IncomingMessage,
  res: ServerResponse,
  onStageChange: StartServerOptions["onStageChange"],
  viewer: ViewerIdentity,
  onSaved: (change: WithTargetKey) => void,
): Promise<void> {
  if (!onStageChange) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Staging changes isn't available from this session." }));
    return;
  }
  if (!can(viewer.role, "stage")) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Your role doesn't include staging changes." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req)) as StageChangeRequestBody;
    if (!body.targetKey || !body.targetName || !body.ruleId || body.from === undefined || body.to === undefined) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "targetKey, targetName, ruleId, from, and to are required" }));
      return;
    }

    const change = onStageChange(body, viewer);
    onSaved(change);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(change));
  } catch (err) {
    sendApiError(res, err);
  }
}

async function handleUpdateChange(
  req: IncomingMessage,
  res: ServerResponse,
  id: number,
  onUpdateChange: StartServerOptions["onUpdateChange"],
  getChangeById: StartServerOptions["getChangeById"],
  viewer: ViewerIdentity,
  onSaved: (change: WithTargetKey) => void,
): Promise<void> {
  if (!onUpdateChange) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Updating changes isn't available from this session." }));
    return;
  }

  const existing = getChangeById?.(id);
  if (!existing) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `No staged change with id ${id}.` }));
    return;
  }
  if (!can(viewer.role, "editChange", { stagedBy: existing.stagedBy, viewerId: viewer.id })) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "You can only edit changes you staged yourself, unless you're an Admin." }));
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
    sendApiError(res, err);
  }
}

async function handleRevertChange(
  res: ServerResponse,
  id: number,
  onRevertChange: StartServerOptions["onRevertChange"],
  getChangeById: StartServerOptions["getChangeById"],
  viewer: ViewerIdentity,
  onReverted: (targetKey: string) => void,
): Promise<void> {
  if (!onRevertChange) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Reverting changes isn't available from this session." }));
    return;
  }

  const existing = getChangeById?.(id);
  if (!existing) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `No staged change with id ${id}.` }));
    return;
  }
  if (!can(viewer.role, "revertChange", { stagedBy: existing.stagedBy, viewerId: viewer.id })) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "You can only revert changes you staged yourself, unless you're an Admin." }));
    return;
  }

  try {
    const targetKey = onRevertChange(id);
    if (targetKey) onReverted(targetKey);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ reverted: Boolean(targetKey) }));
  } catch (err) {
    sendApiError(res, err);
  }
}

// Notes/change payloads are a few short strings — nowhere near this. Purely
// a memory ceiling: without one, any signed-in viewer (even one with zero
// Intune rights — this app deliberately lets that person browse an existing
// report) could POST/PATCH an arbitrarily large body to /api/notes,
// /api/changes, or /api/changes/:id and the server would just keep
// concatenating it into one growing string until the process runs out of
// memory.
const MAX_REQUEST_BODY_BYTES = 1_000_000;

export class PayloadTooLargeError extends Error {}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return; // still draining the rest of an over-limit body — see below
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        // Not req.destroy() — that tears down the shared socket, which
        // means the 413 the caller's about to write can never actually
        // reach the client; they'd just see the connection reset instead.
        // Drop what we've buffered and stop growing it, but let the
        // request finish draining normally so the response can still go
        // out over the same connection.
        rejected = true;
        data = "";
        reject(new PayloadTooLargeError(`Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit.`));
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (!rejected) resolve(data);
    });
    req.on("error", reject);
  });
}

function listenOnFreePort(server: Server, startPort: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(startPort, host, () => resolve(startPort));
  });
}
