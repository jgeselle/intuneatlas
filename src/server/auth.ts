import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebSessionManager } from "../auth/webSession.js";

export async function handleCallback(
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
    const { sessionId, returnTo } = await session.completeLogin({ code, state, redirectUri: `${requestOrigin(req)}/auth/callback` });
    res.writeHead(302, { Location: appPath(returnTo) ?? "/", "Set-Cookie": session.sessionCookie(sessionId, requestOrigin(req).startsWith("https://")) });
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(`Sign-in failed: ${message}`);
  }
}

/**
 * A place in this app to go back to after signing in — a path on this
 * server and nothing else. Anything that could leave it (a full URL,
 * "//elsewhere", a backslash browsers read as a slash) or loop back into
 * sign-in is refused, so the redirect can't be turned into a way out.
 */
export function appPath(value: string | null | undefined): string | undefined {
  if (!value || value.length > 2048) return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return undefined;
  if (value.startsWith("/auth/")) return undefined;
  return value;
}
