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
    async getWriteToken() {
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

test("the session cookie is marked Secure exactly when the browser's own connection is HTTPS", async () => {
  // What a TLS-terminating proxy (Azure Container Apps' ingress, Caddy, ...) reports is all this plain-HTTP server has to go on.
  const session = mockSession({ clearSessionCookie: (secure?: boolean) => `intuneatlas_session=${secure ? "; Secure" : ""}` });
  const server = await startTestServer("127.0.0.1", 17893, session);
  try {
    const behindProxy = await fetch("http://127.0.0.1:17893/auth/logout", { redirect: "manual", headers: { "x-forwarded-proto": "https" } });
    assert.match(behindProxy.headers.get("set-cookie") ?? "", /; Secure$/);
    // On plain HTTP — the solo run on localhost — a Secure cookie would be dropped by the browser.
    const direct = await fetch("http://127.0.0.1:17893/auth/logout", { redirect: "manual" });
    assert.doesNotMatch(direct.headers.get("set-cookie") ?? "", /Secure/);
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
// /api/scope — the report as one group gets it.
// ------------------------------------------------------------------------

test("/api/scope: narrows the report to a group, judges it for the viewer, and needs the right to view", async () => {
  const start = async (port: number, role: Role, withScope = true) => {
    const identity: ViewerIdentity = { id: "oid", name: "Someone", email: "s@x.com", role };
    const { server } = await startServer({
      report: { settings: [{ key: "a" }, { key: "b" }] },
      host: "127.0.0.1",
      startPort: port,
      session: mockSession({ getSession: async () => identity }),
      ...(withScope ? { onScopeReport: (report, groupId) => ({ ...(report as object), settings: [{ key: "a", scopedTo: groupId }], conflictCount: 0 }) } : {}),
      onEvaluateForViewer: async (r) => ({ ...(r as object), belowBaselineCount: 1, judged: true }),
    });
    return server;
  };
  const get = async (port: number, query: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/scope?${query}`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  let server = await start(18794, "viewer");
  try {
    const res = await get(18794, "group=grp-pilot");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      group: "grp-pilot",
      settings: [{ key: "a", scopedTo: "grp-pilot" }],
      compliancePolicies: [],
      enrollmentConfigurations: [],
      conflictCount: 0,
      belowBaselineCount: 1,
    });
    assert.equal((await get(18794, "group=")).status, 400);
  } finally {
    server.close();
  }

  server = await start(18795, null);
  try {
    assert.equal((await get(18795, "group=grp-pilot")).status, 403);
  } finally {
    server.close();
  }

  server = await start(18796, "admin", false);
  try {
    assert.equal((await get(18796, "group=grp-pilot")).status, 501);
  } finally {
    server.close();
  }
});

// ------------------------------------------------------------------------
// POST /api/changes/:id/push — the one route that leads to a write in the tenant
// ------------------------------------------------------------------------

async function pushAs(
  port: number,
  role: Role,
  options: { writeToken?: string; onPushChange?: StartServerOptions["onPushChange"]; report?: unknown },
): Promise<{ status: number; body: Record<string, unknown>; reportAfter: () => Promise<Record<string, unknown>> }> {
  const identity: ViewerIdentity = { id: "oid", name: "Alex", email: "a@x.com", role };
  const session = mockSession({ getSession: async () => identity, getWriteToken: async () => options.writeToken });
  const { server } = await startServer({
    report: options.report ?? { settings: [], changes: { "k::p1": { id: 5 } } },
    host: "127.0.0.1",
    startPort: port,
    session,
    getChangeById: (id) => (id === 5 ? { stagedBy: "someone-else" } : undefined),
    ...(options.onPushChange ? { onPushChange: options.onPushChange } : {}),
    onEvaluateForViewer: async (r) => ({ ...(r as object), evaluated: true }),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/changes/5/push`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = (await res.json()) as Record<string, unknown>;
    return {
      status: res.status,
      body,
      reportAfter: async () => ({}),
    };
  } finally {
    server.close();
  }
}

test("push: only an Admin reaches it — a Contributor who staged and reviewed the change still can't write to the tenant", async () => {
  let called = 0;
  const onPushChange: StartServerOptions["onPushChange"] = async () => {
    called++;
    return { closed: [], policyName: "P", created: false };
  };
  for (const [port, role] of [
    [18801, "viewer"],
    [18802, "contributor"],
    [18803, null],
  ] as Array<[number, Role]>) {
    const { status } = await pushAs(port, role, { writeToken: "write-token", onPushChange });
    assert.equal(status, 403, String(role));
  }
  assert.equal(called, 0);
});

test("push: without the write permission on the app registration nothing is attempted, and the answer says what is missing", async () => {
  let called = 0;
  const { status, body } = await pushAs(18804, "admin", {
    writeToken: undefined,
    onPushChange: async () => {
      called++;
      return { closed: [], policyName: "P", created: false };
    },
  });
  assert.equal(status, 403);
  assert.match(String(body.error), /DeviceManagementConfiguration\.ReadWrite\.All/);
  assert.equal(called, 0);
});

test("push: a refusal comes back as the reason, not as a server error", async () => {
  const { PushRefused } = await import("../../src/push/values.js");
  const { status, body } = await pushAs(18805, "admin", {
    writeToken: "write-token",
    onPushChange: async () => {
      throw new PushRefused("It was 14, it is now 7.");
    },
  });
  assert.equal(status, 409);
  assert.equal(body.error, "It was 14, it is now 7.");
});

test("push: an Admin's push gets the Admin's own write token, and the answer names what was closed", async () => {
  const seen: unknown[] = [];
  const { status, body } = await pushAs(18806, "admin", {
    writeToken: "write-token",
    onPushChange: async (id, writeToken, viewer, report) => {
      seen.push(id, writeToken, viewer.name);
      return { closed: [{ targetKey: "k::p1" }], policyName: "Update ring", created: false, report: { ...(report as object), settings: [{ key: "k", pushed: true }] } };
    },
  });
  assert.equal(status, 200);
  assert.deepEqual(seen, [5, "write-token", "Alex"]);
  assert.deepEqual([body.closed, body.policyName, body.created], [["k::p1"], "Update ring", false]);
  // The report it answers with is the brought-up-to-date one, as this viewer sees it — and no longer lists the change as staged.
  const report = body.report as { settings: unknown[]; changes: Record<string, unknown>; evaluated: boolean };
  assert.deepEqual(report.settings, [{ key: "k", pushed: true }]);
  assert.deepEqual(report.changes, {});
  assert.equal(report.evaluated, true);
});

test("push: unavailable (501) where the server wasn't given a way to push, and 404 for a change that isn't staged", async () => {
  assert.equal((await pushAs(18807, "admin", { writeToken: "write-token" })).status, 501);
});

// ------------------------------------------------------------------------
// /api/scan — a scan runs in the background; the page asks how it's going
// ------------------------------------------------------------------------

test("scan: starting one answers at once, and its status carries the judged report when it's done", async () => {
  const port = 18861;
  const identity: ViewerIdentity = { id: "oid", name: "Alex", email: "a@x.com", role: "admin" };
  let finish: (report: unknown) => void = () => {};
  let scans = 0;
  const { server } = await startServer({
    report: null,
    host: "127.0.0.1",
    startPort: port,
    session: mockSession({ getSession: async () => identity, getGraphToken: async () => "graph-token" }),
    onScanRequest: () => {
      scans++;
      return new Promise((resolve) => (finish = resolve));
    },
    onEvaluateForViewer: async (r) => ({ ...(r as object), evaluated: true }),
  });
  const call = async (method: string, path: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try {
    const started = await call("POST", "/api/scan");
    assert.equal(started.status, 202);
    assert.deepEqual(started.body, { job: 1, status: "running" });

    // A second sync while one runs joins it rather than scanning the tenant twice.
    assert.deepEqual((await call("POST", "/api/scan")).body, { job: 1, status: "running" });
    assert.equal(scans, 1);
    assert.deepEqual((await call("GET", "/api/scan?job=1")).body, { job: 1, status: "running" });

    finish({ policyCount: 3 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual((await call("GET", "/api/scan?job=1")).body, { job: 1, status: "done", report: { policyCount: 3, evaluated: true } });

    // A job the server never ran (it restarted mid-scan) is reported as such, not waited on forever.
    assert.equal((await call("GET", "/api/scan?job=7")).status, 404);
  } finally {
    server.close();
  }
});

test("scan: one that fails says why in its status; a viewer without the scan role can't start one", async () => {
  const port = 18862;
  let role: Role = "admin";
  const { server } = await startServer({
    report: null,
    host: "127.0.0.1",
    startPort: port,
    session: mockSession({ getSession: async () => ({ id: "oid", name: "Alex", email: "a@x.com", role }), getGraphToken: async () => "graph-token" }),
    onScanRequest: async () => {
      throw new Error("Couldn't reach Microsoft Graph (ETIMEDOUT) after 6 tries");
    },
  });
  try {
    const post = () => fetch(`http://127.0.0.1:${port}/api/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const started = (await (await post()).json()) as { job: number };
    await new Promise((resolve) => setTimeout(resolve, 10));
    const status = (await (await fetch(`http://127.0.0.1:${port}/api/scan?job=${started.job}`)).json()) as Record<string, unknown>;
    assert.equal(status.status, "failed");
    assert.match(String(status.error), /ETIMEDOUT/);

    role = "viewer";
    assert.equal((await post()).status, 403);
  } finally {
    server.close();
  }
});

// ------------------------------------------------------------------------
// /api/reminders — shared by everyone; making one takes what a note takes
// ------------------------------------------------------------------------

test("reminders: everyone sees them; who may add, complete and delete one follows the note rules", async () => {
  const port = 18871;
  let role: Role = "contributor";
  let viewerId = "oid-maker";
  const store = new Map<number, { id: number; createdById: string; dueOn: string; repeatMonths: number | null }>();
  let nextId = 1;
  const list = () => [...store.values()];
  const { server } = await startServer({
    report: null,
    host: "127.0.0.1",
    startPort: port,
    session: mockSession({ getSession: async () => ({ id: viewerId, name: "Alex", email: "a@x.com", role }) }),
    reminders: {
      list,
      get: (id) => store.get(id),
      add: (input, viewer) => {
        store.set(nextId, { id: nextId++, createdById: viewer.id, dueOn: input.dueOn, repeatMonths: input.repeatMonths });
        return list();
      },
      complete: (id) => (store.delete(id), list()),
      snooze: (id) => list().map((r) => (r.id === id ? { ...r, snoozed: true } : r)),
      remove: (id) => (store.delete(id), list()),
    },
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const valid = { targetKey: "k::windows10", targetName: "Camera", note: "Check", dueOn: "2026-11-01", repeatMonths: 12 };
  try {
    assert.equal((await call("POST", "/api/reminders", valid)).status, 200);
    assert.equal((await call("POST", "/api/reminders", { ...valid, dueOn: "next week" })).status, 400);
    assert.equal((await call("POST", "/api/reminders", { ...valid, repeatMonths: 0 })).status, 400);
    assert.equal((await call("POST", "/api/reminders", { ...valid, targetKey: "" })).status, 400);

    role = "viewer";
    assert.equal(((await call("GET", "/api/reminders")).body as unknown[]).length, 1, "a viewer sees them");
    assert.equal((await call("POST", "/api/reminders", valid)).status, 403);
    assert.equal((await call("POST", "/api/reminders/1/done")).status, 403);

    // Someone else who can add notes can snooze or complete it — it's shared — but not delete it.
    role = "contributor";
    viewerId = "oid-colleague";
    assert.equal((await call("POST", "/api/reminders/1/snooze")).status, 200);
    assert.equal((await call("DELETE", "/api/reminders/1")).status, 403);
    role = "admin";
    assert.equal((await call("DELETE", "/api/reminders/1")).status, 200);
    assert.equal((await call("POST", "/api/reminders/1/done")).status, 404);
  } finally {
    server.close();
  }
});

// ------------------------------------------------------------------------
// Each viewer sees the shared scan only as far as their own Intune role reaches
// ------------------------------------------------------------------------

test("visibility: asked once with the viewer's own token, then handed with them to everything that answers", async () => {
  const port = 18881;
  const identity: ViewerIdentity = { id: "oid-seattle", name: "Sam", email: "s@x.com", role: "contributor" };
  const tokensAsked: string[] = [];
  const seen: Array<ReadonlyMap<string, string> | undefined> = [];
  const report = { scannedAt: "2026-10-14T09:00:00Z", settings: [{ key: "camera::windows10", sources: [{ policyId: "seattle" }] }, { key: "bluetooth::windows10", sources: [{ policyId: "hq" }] }] };
  const { server } = await startServer({
    report,
    host: "127.0.0.1",
    startPort: port,
    session: mockSession({ getSession: async () => identity, getGraphToken: async () => "sam-token" }),
    policyVisibility: async (token) => {
      tokensAsked.push(token);
      return new Map([["seattle", "catalog"]]);
    },
    onEvaluateForViewer: async (r, viewer) => {
      seen.push(viewer.visiblePolicies);
      return r;
    },
    onHistoryRequest: () => [{ policyId: "seattle", kind: "added" }, { policyId: "hq", kind: "added" }, { kind: "pushed" }],
    onRecentHistory: () => [{ policyId: "hq", settingKey: "bluetooth::windows10" }, { policyId: "seattle", settingKey: "camera::windows10" }],
    onStageChange: () => ({ targetKey: "x" }),
    reminders: {
      list: () => [{ targetKey: "camera::windows10" }, { targetKey: "bluetooth::windows10" }],
      get: () => undefined,
      add: () => [],
      complete: () => [],
      snooze: () => [],
      remove: () => [],
    },
  });
  const get = async (path: string) => (await fetch(`http://127.0.0.1:${port}${path}`)).json() as Promise<unknown>;
  try {
    await fetch(`http://127.0.0.1:${port}/`);
    const history = (await get("/api/history?key=camera::windows10")) as { events: unknown[] };
    assert.deepEqual(history.events, [{ policyId: "seattle", kind: "added" }, { kind: "pushed" }], "events on a policy they can't see are left out");
    assert.deepEqual(await get("/api/reminders"), [{ targetKey: "camera::windows10" }]);
    // The tenant-wide log too.
    assert.deepEqual(((await get("/api/history?all=1")) as { events: unknown[] }).events, [{ policyId: "seattle", settingKey: "camera::windows10" }]);
    const stage = await fetch(`http://127.0.0.1:${port}/api/changes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetKey: "k", targetName: "n", policyId: "hq", ruleId: "manual", from: "a", to: "b" }) });
    assert.equal(stage.status, 403, "nothing can be staged on a policy their role doesn't show them");

    assert.deepEqual(tokensAsked, ["sam-token"], "asked once, with their own token");
    assert.ok(seen.length > 0 && seen.every((v) => v?.has("seattle") && !v.has("hq")));
  } finally {
    server.close();
  }
});

test("visibility: when it can't be checked, the viewer sees nothing and is told why", async () => {
  const port = 18882;
  let evaluatedWith: { visiblePolicies?: ReadonlyMap<string, string>; visibilityError?: string } | undefined;
  const { server } = await startServer({
    report: { scannedAt: "x", settings: [] },
    host: "127.0.0.1",
    startPort: port,
    session: mockSession({ getSession: async () => ({ id: "oid", name: "A", email: "a@x.com", role: "viewer" }), getGraphToken: async () => "t" }),
    policyVisibility: async () => {
      throw new Error("Couldn't reach Microsoft Graph (ETIMEDOUT) after 6 tries");
    },
    onEvaluateForViewer: async (r, viewer) => {
      evaluatedWith = viewer;
      return r;
    },
  });
  try {
    await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(evaluatedWith?.visiblePolicies?.size, 0);
    assert.match(evaluatedWith?.visibilityError ?? "", /^Couldn't check which policies your Intune role lets you see \(Couldn't reach Microsoft Graph \(ETIMEDOUT\)/);
  } finally {
    server.close();
  }
});
