import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file compiles to dist/server/staticServer.js — the Vite build output
// lives at web/dist relative to the package root, two levels up from dist/server.
const WEB_DIST = join(fileURLToPath(new URL("../../web/dist", import.meta.url)));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface ScanRequestBody {
  tenant: string;
  deviceCode?: boolean;
}

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
  /** Backs the browser's "connect a tenant" flow — kept out of this module so it stays auth-agnostic. */
  onScanRequest?: (body: ScanRequestBody) => Promise<unknown>;
  /** Backs the note-adding UI; returns the updated note list for that key. */
  onNoteRequest?: (body: NoteRequestBody) => unknown[];
  /** Stages a change; must return the created record including its targetKey. */
  onStageChange?: (body: StageChangeRequestBody) => WithTargetKey;
  /** Updates reason/reviewer on a staged change; must return the updated record including its targetKey. */
  onUpdateChange?: (id: number, body: UpdateChangeRequestBody) => WithTargetKey;
  /** Reverts a staged change; returns the targetKey that was removed, or undefined if it didn't exist. */
  onRevertChange?: (id: number) => string | undefined;
}

export async function startServer(options: StartServerOptions): Promise<{ url: string; server: Server }> {
  let currentReport = options.report;

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
      if (req.method === "POST" && req.url === "/api/scan") {
        await handleScanRequest(req, res, options.onScanRequest, (report) => {
          currentReport = report;
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/notes") {
        await handleNoteRequest(req, res, options.onNoteRequest, (targetKey, notes) => {
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
        await handleUpdateChange(req, res, Number(changeIdMatch[1]), options.onUpdateChange, (change) =>
          setChange(change.targetKey, change),
        );
        return;
      }
      if (changeIdMatch && req.method === "DELETE") {
        await handleRevertChange(res, Number(changeIdMatch[1]), options.onRevertChange, removeChange);
        return;
      }

      await serveStatic(req, res, () => currentReport);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  const port = await listenOnFreePort(server, options.startPort ?? 7878);
  return { url: `http://localhost:${port}`, server };
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, getReport: () => unknown): Promise<void> {
  const requestPath = (req.url ?? "/").split("?")[0];
  const filePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const fullPath = join(WEB_DIST, filePath);

  // Not resolving deep client-side routes — this is a single-page app with
  // no router, so anything unrecognized just falls back to index.html.
  const isAsset = extname(filePath) !== "";
  const targetPath = isAsset ? fullPath : join(WEB_DIST, "index.html");

  let body = await readFile(targetPath);
  const contentType = CONTENT_TYPES[extname(targetPath)] ?? "application/octet-stream";

  if (extname(targetPath) === ".html") {
    const injectedScript = `<script>window.__INTUNEATLAS_REPORT__ = ${JSON.stringify(getReport())};</script>`;
    body = Buffer.from(body.toString("utf8").replace("</head>", `${injectedScript}</head>`));
  }

  res.writeHead(200, { "Content-Type": contentType });
  res.end(body);
}

async function handleScanRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onScanRequest: StartServerOptions["onScanRequest"],
  setReport: (report: unknown) => void,
): Promise<void> {
  if (!onScanRequest) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Live scanning isn't available from this session." }));
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req)) as ScanRequestBody;
    if (!body.tenant) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "tenant is required" }));
      return;
    }

    const report = await onScanRequest(body);
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

    const notes = onNoteRequest(body);
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

    const change = onUpdateChange(id, body);
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

function listenOnFreePort(server: Server, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number) {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port < startPort + 20) {
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      // Bind to localhost only — this server can trigger sign-in and serve
      // real tenant data, it must not be reachable from the local network.
      server.listen(port, "127.0.0.1", () => resolve(port));
    }
    tryPort(startPort);
  });
}
