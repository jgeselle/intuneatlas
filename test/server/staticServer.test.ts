import assert from "node:assert/strict";
import { test } from "node:test";
import { baselineVerdicts, resolveStaticPath, startServer, type StartServerOptions } from "../../src/server/staticServer.js";
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

// ------------------------------------------------------------------------
// baselineVerdicts — what a baseline toggle sends back instead of the
// whole report.
// ------------------------------------------------------------------------

test("baselineVerdicts: real settings are reduced to their verdict, Missing entries are sent whole", () => {
  const report = {
    tenant: "contoso",
    belowBaselineCount: 1,
    baselinePacks: [{ path: "oib/v4" }],
    activeBaselinePacks: ["oib/v4"],
    settings: [
      { key: "a::w", name: "A", sources: [{ big: "payload" }], schemas: { a: {} }, state: "Below baseline", recs: [{ ruleId: "r" }], checks: [{ ruleId: "r" }] },
      { key: "b::w", name: "B", sources: [], state: "Not checked", recs: [] },
      { key: "uncovered::c", name: "C", state: "Missing", recs: [{ ruleId: "m" }], checks: [] },
    ],
  };
  assert.deepEqual(baselineVerdicts(report), {
    verdicts: {
      "a::w": { state: "Below baseline", recs: [{ ruleId: "r" }], checks: [{ ruleId: "r" }] },
      "b::w": { state: "Not checked", recs: [], checks: [] },
    },
    missing: [report.settings[2]],
    belowBaselineCount: 1,
    baselinePacks: [{ path: "oib/v4" }],
    activeBaselinePacks: ["oib/v4"],
  });
});

// ------------------------------------------------------------------------
// /api/baselines — adding, renaming and removing baselines writes and
// deletes files on the machine running the server, so who may call it and
// what reaches the callbacks is pinned here.
// ------------------------------------------------------------------------

type Role = ViewerIdentity["role"];

async function withBaselineServer(
  port: number,
  role: Role,
  baselines: StartServerOptions["baselines"],
  run: (call: (method: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>) => Promise<void>,
) {
  const identity: ViewerIdentity = { id: "oid", name: "Someone", email: "s@x.com", role };
  const session = mockSession({ getSession: async () => identity });
  const report = { settings: [{ key: "a::w", state: "Not checked", recs: [] }], belowBaselineCount: 0 };
  const { server } = await startServer({
    report,
    host: "127.0.0.1",
    startPort: port,
    session,
    ...(baselines ? { baselines } : {}),
    onEvaluateForViewer: async (r) => ({ ...(r as object), baselinePacks: [{ path: "oib/v4" }], activeBaselinePacks: null }),
  });
  try {
    await run(async (method, body) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/baselines`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });
  } finally {
    server.close();
  }
}

function recordingBaselines() {
  const calls: unknown[][] = [];
  const baselines: NonNullable<StartServerOptions["baselines"]> = {
    add: async (input) => {
      calls.push(["add", input]);
      return "oib/v4";
    },
    rename: async (pack, name) => {
      calls.push(["rename", pack, name]);
    },
    remove: async (pack) => {
      calls.push(["remove", pack]);
    },
  };
  return { calls, baselines };
}

test("/api/baselines: only an Admin gets through — nothing is called for anyone else", async () => {
  for (const [port, role] of [
    [18783, "viewer"],
    [18784, "contributor"],
    [18785, null],
  ] as Array<[number, Role]>) {
    const { calls, baselines } = recordingBaselines();
    await withBaselineServer(port, role, baselines, async (call) => {
      for (const method of ["POST", "PATCH", "DELETE"]) {
        const res = await call(method, { pack: "oib/v4", name: "X", source: "s", version: "v", files: [] });
        assert.equal(res.status, 403, `${method} as ${role}`);
      }
    });
    assert.deepEqual(calls, []);
  }
});

test("/api/baselines: an Admin's add, rename and remove reach the callbacks and answer with fresh verdicts", async () => {
  const { calls, baselines } = recordingBaselines();
  await withBaselineServer(18786, "admin", baselines, async (call) => {
    const input = { source: "oib", version: "v4", name: "OIB 4", files: [{ path: "p.json", contentBase64: "e30=" }] };
    const added = await call("POST", input);
    assert.equal(added.status, 200);
    assert.equal(added.body.pack, "oib/v4");
    assert.deepEqual(added.body.verdicts, { "a::w": { state: "Not checked", recs: [], checks: [] } });
    assert.deepEqual(added.body.baselinePacks, [{ path: "oib/v4" }]);

    assert.equal((await call("PATCH", { pack: "oib/v4", name: "Renamed" })).status, 200);
    assert.equal((await call("DELETE", { pack: "oib/v4" })).status, 200);
    assert.deepEqual(calls, [["add", input], ["rename", "oib/v4", "Renamed"], ["remove", "oib/v4"]]);
  });
});

test("/api/baselines: a problem with the request comes back as a 400 with its message", async () => {
  const { BaselineInputError } = await import("../../src/baselines/manage.js");
  const baselines: NonNullable<StartServerOptions["baselines"]> = {
    add: async () => {
      throw new BaselineInputError("None of the uploaded files is a Settings Catalog policy exported from Intune.");
    },
    rename: async () => {},
    remove: async () => {},
  };
  await withBaselineServer(18787, "admin", baselines, async (call) => {
    const res = await call("POST", { source: "s", version: "v", files: [] });
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /Settings Catalog policy/);
  });
});

test("/api/baselines: unavailable (501) when the server wasn't given a baselines folder to manage", async () => {
  await withBaselineServer(18788, "admin", undefined, async (call) => {
    assert.equal((await call("POST", { source: "s", version: "v", files: [] })).status, 501);
  });
});

test("/api/baselines: an upload may exceed the 1 MB limit other requests live under; a rename may not", async () => {
  const { calls, baselines } = recordingBaselines();
  const big = "A".repeat(1_500_000);
  await withBaselineServer(18789, "admin", baselines, async (call) => {
    assert.equal((await call("POST", { source: "s", version: "v", files: [{ path: "p.json", contentBase64: big }] })).status, 200);
    assert.equal((await call("PATCH", { pack: "oib/v4", name: big })).status, 413);
  });
  assert.deepEqual(calls.map((c) => c[0]), ["add"]);
});

// ------------------------------------------------------------------------
// /api/baselines/compare — read-only, but it carries the tenant's own
// values, so it sits behind the same right as the report.
// ------------------------------------------------------------------------

async function withCompareServer(port: number, role: Role, onCompareBaselines: StartServerOptions["onCompareBaselines"], run: (get: (query: string) => Promise<{ status: number; body: Record<string, unknown> }>) => Promise<void>) {
  const identity: ViewerIdentity = { id: "oid", name: "Someone", email: "s@x.com", role };
  const { server } = await startServer({
    report: { settings: [] },
    host: "127.0.0.1",
    startPort: port,
    session: mockSession({ getSession: async () => identity }),
    ...(onCompareBaselines ? { onCompareBaselines } : {}),
  });
  try {
    await run(async (query) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/baselines/compare?${query}`);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });
  } finally {
    server.close();
  }
}

test("/api/baselines/compare: any role that can view the report can compare; no role can't", async () => {
  const seen: string[][] = [];
  const compare: StartServerOptions["onCompareBaselines"] = async (_report, from, to) => {
    seen.push([from, to]);
    return [{ definitionId: "a", change: "added" }];
  };
  await withCompareServer(18790, "viewer", compare, async (get) => {
    const res = await get("from=oib%2Fv3.8&to=oib%2Fv4.0");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { from: "oib/v3.8", to: "oib/v4.0", changes: [{ definitionId: "a", change: "added" }] });
  });
  await withCompareServer(18791, null, compare, async (get) => {
    assert.equal((await get("from=a%2F1&to=b%2F2")).status, 403);
  });
  assert.deepEqual(seen, [["oib/v3.8", "oib/v4.0"]]);
});

test("/api/baselines/compare: needs two different baselines; an unknown one is a 400 with its message", async () => {
  const { BaselineInputError } = await import("../../src/baselines/manage.js");
  const compare: StartServerOptions["onCompareBaselines"] = async () => {
    throw new BaselineInputError('There is no baseline "nope/1".');
  };
  await withCompareServer(18792, "admin", compare, async (get) => {
    assert.equal((await get("from=a%2F1&to=a%2F1")).status, 400);
    assert.equal((await get("from=a%2F1")).status, 400);
    const unknown = await get("from=nope%2F1&to=a%2F1");
    assert.equal(unknown.status, 400);
    assert.match(String(unknown.body.error), /no baseline "nope\/1"/);
  });
  await withCompareServer(18793, "admin", undefined, async (get) => {
    assert.equal((await get("from=a%2F1&to=b%2F2")).status, 501);
  });
});
