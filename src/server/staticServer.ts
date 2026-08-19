import { createServer, type Server } from "node:http";
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

export interface StartServerOptions {
  report: unknown;
  startPort?: number;
}

export async function startServer(options: StartServerOptions): Promise<{ url: string; server: Server }> {
  const injectedScript = `<script>window.__INTUNEATLAS_REPORT__ = ${JSON.stringify(options.report)};</script>`;

  const server = createServer(async (req, res) => {
    try {
      const requestPath = (req.url ?? "/").split("?")[0];
      const filePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
      const fullPath = join(WEB_DIST, filePath);

      // Not resolving deep client-side routes — this is a single-page app
      // with no router, so anything unrecognized just falls back to index.html.
      const isAsset = extname(filePath) !== "";
      const targetPath = isAsset ? fullPath : join(WEB_DIST, "index.html");

      let body = await readFile(targetPath);
      const contentType = CONTENT_TYPES[extname(targetPath)] ?? "application/octet-stream";

      if (extname(targetPath) === ".html") {
        body = Buffer.from(body.toString("utf8").replace("</head>", `${injectedScript}</head>`));
      }

      res.writeHead(200, { "Content-Type": contentType });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  const port = await listenOnFreePort(server, options.startPort ?? 7878);
  return { url: `http://localhost:${port}`, server };
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
      server.listen(port, () => resolve(port));
    }
    tryPort(startPort);
  });
}
