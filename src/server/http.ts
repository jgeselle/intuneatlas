import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

export const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request was sent from a page on `origin` itself. Browsers name
 * the page a fetch came from in `Origin` (and, where they send it,
 * `Sec-Fetch-Site`) on every request that isn't a plain read; a script on
 * another site can't change either. A request with neither isn't from a
 * browser at all, so no one's cookie came with it by surprise.
 */
export function fromThisOrigin(headers: IncomingHttpHeaders, origin: string): boolean {
  if (headers.origin !== undefined) return headers.origin === origin;
  const site = headers["sec-fetch-site"];
  if (site !== undefined) return site === "same-origin" || site === "none";
  return true;
}

/**
 * Whether a request's `Host` names this machine's loopback address. A server
 * listening only on loopback is reached by name only through localhost; any
 * other name in `Host` is a page whose DNS was pointed at 127.0.0.1 after it
 * loaded, and its origin would otherwise pass for this app's own.
 */
export function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const name = hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
  return ["localhost", "127.0.0.1", "[::1]"].includes(name.toLowerCase());
}

// Same INTUNEATLAS_DEBUG convention cli.ts's own error handling uses.
// PayloadTooLargeError isn't logged — that one's an expected, correctly-
// handled condition (see readRequestBody), not a bug to go looking for.
export function logRequestError(err: unknown): void {
  if (err instanceof PayloadTooLargeError) return;
  if (process.env.INTUNEATLAS_DEBUG) {
    console.error(err);
  } else {
    console.error(`intuneatlas: request error — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Shared by every JSON API handler's catch block — a too-large body gets its own status, everything else stays a 500. */
export function sendApiError(res: ServerResponse, err: unknown): void {
  logRequestError(err);
  const message = err instanceof Error ? err.message : String(err);
  res.writeHead(err instanceof PayloadTooLargeError ? 413 : 500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

// Notes/change payloads are a few short strings — nowhere near this. Purely
// a memory ceiling: without one, any signed-in viewer (even one with zero
// Intune rights — this app deliberately lets that person browse an existing
// report) could POST/PATCH an arbitrarily large body to /api/notes,
// /api/changes, or /api/changes/:id and the server would just keep
// concatenating it into one growing string until the process runs out of
// memory.
export const MAX_REQUEST_BODY_BYTES = 1_000_000;

export class PayloadTooLargeError extends Error {}

export function readRequestBody(req: IncomingMessage, maxBytes: number = MAX_REQUEST_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return; // still draining the rest of an over-limit body — see below
      bytes += chunk.length;
      if (bytes > maxBytes) {
        // Not req.destroy() — that tears down the shared socket, which
        // means the 413 the caller's about to write can never actually
        // reach the client; they'd just see the connection reset instead.
        // Drop what we've buffered and stop growing it, but let the
        // request finish draining normally so the response can still go
        // out over the same connection.
        rejected = true;
        data = "";
        reject(new PayloadTooLargeError(`Request body exceeds the ${maxBytes}-byte limit.`));
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
