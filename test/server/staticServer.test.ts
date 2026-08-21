import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStaticPath, startServer, type StartServerOptions } from "../../src/server/staticServer.js";
import type { ViewerIdentity, WebSessionManager } from "../../src/auth/webSession.js";

// ------------------------------------------------------------------------
// resolveStaticPath — pure, no filesystem/network involved, so these run
// without a built web/dist (CI doesn't build the web UI before `npm test`).
// ------------------------------------------------------------------------

test("resolveStaticPath: a normal asset path resolves inside dist", () => {
  assert.equal(resolveStaticPath("/app/web/dist", "/assets/index.js"), "/app/web/dist/assets/index.js");
});

test("resolveStaticPath: root falls back to index.html", () => {
  assert.equal(resolveStaticPath("/app/web/dist", "/"), "/app/web/dist/index.html");
});

test("resolveStaticPath: an unrecognized client-side route falls back to index.html (no server-side router)", () => {
  assert.equal(resolveStaticPath("/app/web/dist", "/settings/some-key"), "/app/web/dist/index.html");
});

test("resolveStaticPath: path traversal with .. never resolves outside dist — falls back to index.html", () => {
  // Needs a file extension (".txt") — otherwise it would fall back to
  // index.html anyway via the "not a recognized asset" branch, without
  // ever exercising the traversal guard specifically.
  assert.equal(resolveStaticPath("/app/web/dist", "/../../../etc/secrets.txt"), "/app/web/dist/index.html");
});

test("resolveStaticPath: a sibling directory sharing dist as a string prefix is not misjudged as inside it", () => {
  // /app/web/dist-secrets is NOT inside /app/web/dist, even though
  // startsWith(dist) would wrongly say it is — this is exactly the bug
  // relative()-based containment checking exists to avoid.
  assert.equal(resolveStaticPath("/app/web/dist", "/../dist-secrets/leak.txt"), "/app/web/dist/index.html");
});

// ------------------------------------------------------------------------
// Silent-login loopback gating — pins the fix for the shared-mode auth
// bypass: trySilentLogin() must never fire for an unauthenticated request
// unless the server was started bound to a loopback host.
// ------------------------------------------------------------------------

function mockSession(overrides: Partial<WebSessionManager> = {}): WebSessionManager & { silentLoginCalls: number } {
  const identity: ViewerIdentity = { id: "oid-test-user", name: "Test User", email: "test@x.com", role: "admin" };
  const manager = {
    silentLoginCalls: 0,
    async loginRedirectUrl() {
      return "https://login.example.com/authorize";
    },
    async completeLogin() {
      throw new Error("not used in this test");
    },
    async trySilentLogin() {
      manager.silentLoginCalls++;
      return { sessionId: "fake-session-id", identity };
    },
    async getSession() {
      return undefined; // nobody has a session cookie in these tests
    },
    async getGraphToken() {
      return undefined;
    },
    async signOut() {},
    sessionCookie(id: string) {
      return `intuneatlas_session=${id}`;
    },
    clearSessionCookie() {
      return "intuneatlas_session=";
    },
    ...overrides,
  };
  return manager;
}

async function startTestServer(host: string, port: number, session: WebSessionManager) {
  const options: StartServerOptions = { report: null, host, startPort: port, session };
  const { server } = await startServer(options);
  return server;
}

test("silent login does NOT fire on a non-loopback host — an unauthenticated GET redirects to /auth/login instead", async () => {
  const session = mockSession();
  const server = await startTestServer("0.0.0.0", 18781, session);
  try {
    const res = await fetch("http://127.0.0.1:18781/", { redirect: "manual" });
    assert.equal(session.silentLoginCalls, 0);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/auth/login");
    assert.equal(res.headers.get("set-cookie"), null);
  } finally {
    server.close();
  }
});

test("silent login DOES fire on a loopback host — an unauthenticated GET is silently signed in", async () => {
  const session = mockSession();
  const server = await startTestServer("127.0.0.1", 18782, session);
  try {
    const res = await fetch("http://127.0.0.1:18782/", { redirect: "manual" });
    assert.equal(session.silentLoginCalls, 1);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
    assert.match(res.headers.get("set-cookie") ?? "", /^intuneatlas_session=fake-session-id/);
  } finally {
    server.close();
  }
});
