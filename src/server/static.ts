import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveAppPath } from "../packagedPaths.js";
import type { ViewerIdentity } from "../auth/webSession.js";
import { can } from "../auth/roles.js";
import type { StartServerOptions } from "./types.js";

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
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

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

export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  getReport: () => unknown,
  viewer: ViewerIdentity,
  onEvaluateForViewer: StartServerOptions["onEvaluateForViewer"],
  version?: string,
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
    const raw = can(viewer.role, "view") ? getReport() : null;
    const report = raw && onEvaluateForViewer ? await onEvaluateForViewer(raw, viewer) : raw;
    const injectedScript =
      `<script>window.__INTUNEATLAS_REPORT__ = ${jsonForScriptTag(report)};` +
      `window.__INTUNEATLAS_SESSION__ = ${jsonForScriptTag(viewer)};` +
      `window.__INTUNEATLAS_VERSION__ = ${jsonForScriptTag(version ?? null)};</script>`;
    body = Buffer.from(body.toString("utf8").replace("</head>", `${injectedScript}</head>`));
  }

  res.writeHead(200, { "Content-Type": contentType });
  res.end(body);
}
