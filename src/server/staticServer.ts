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

export interface StartServerOptions {
  /** null means "nothing scanned yet" — the UI shows its connect screen. */
  report: unknown | null;
  startPort?: number;
  /** Backs the browser's "connect a tenant" flow — kept out of this module so it stays auth-agnostic. */
  onScanRequest?: (body: ScanRequestBody) => Promise<unknown>;
  /** Backs the note-adding UI; returns the updated note list for that key. */
  onNoteRequest?: (body: NoteRequestBody) => unknown[];
}

export async function startServer(options: StartServerOptions): Promise<{ url: string; server: Server }> {
  let currentReport = options.report;

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
