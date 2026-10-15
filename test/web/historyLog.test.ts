import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { heldHistoryLog, loadHistoryLog, loadMoreHistory, LOG_PAGE_SIZE } from "../../web/src/lib/historyLog.js";
import type { LogEvent } from "../../web/src/types.js";

const event = (id: number): LogEvent => ({ id, at: "2026-10-15T10:00:00Z", since: null, kind: "changed", policyId: "p", policyName: "P", settingKey: "k", settingName: "K" });

/** Answers /api/history from a list of events, a page at a time, and records what was asked. */
function serveHistory(t: TestContext, events: LogEvent[], status = 200): URLSearchParams[] {
  const asked: URLSearchParams[] = [];
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  global.fetch = (async (url: string | URL | Request) => {
    const params = new URLSearchParams(String(url).split("?")[1]);
    asked.push(params);
    if (status !== 200) return new Response("{}", { status });
    const offset = Number(params.get("offset"));
    const limit = Number(params.get("limit"));
    const page = events.slice(offset, offset + limit);
    const next = offset + limit < events.length ? offset + limit : null;
    return new Response(JSON.stringify({ events: page, next, counts: { pushed: 0, seen: events.length } }), { status: 200 });
  }) as typeof fetch;
  return asked;
}

test("the first page is asked for once and kept for that scan and filter", async (t) => {
  const asked = serveHistory(t, [event(1), event(2)]);
  const first = await loadHistoryLog("scan-1", { kind: "seen", q: " Firewall " });
  assert.deepEqual(first.events.map((e) => e.id), [1, 2]);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].get("kind"), "seen");
  assert.equal(asked[0].get("q"), "Firewall");
  assert.equal(asked[0].get("limit"), String(LOG_PAGE_SIZE));

  // Kept: the same filter (words compared without case or spaces) isn't asked for again…
  assert.equal(await loadHistoryLog("scan-1", { kind: "seen", q: "firewall" }), first);
  assert.equal(heldHistoryLog("scan-1", { kind: "seen", q: "FIREWALL" }), first);
  assert.equal(asked.length, 1);
  // …unless asked for fresh — someone else may have pushed since.
  await loadHistoryLog("scan-1", { kind: "seen", q: "firewall" }, true);
  assert.equal(asked.length, 2);
});

test("questions asked at the same time share one request", async (t) => {
  const asked = serveHistory(t, [event(1)]);
  const [a, b] = await Promise.all([loadHistoryLog("scan-2", {}), loadHistoryLog("scan-2", {})]);
  assert.equal(a, b);
  assert.equal(asked.length, 1);
});

test("a new scan or push starts over", async (t) => {
  const asked = serveHistory(t, [event(1)]);
  await loadHistoryLog("scan-3", {});
  assert.notEqual(heldHistoryLog("scan-3", {}), undefined);
  assert.equal(heldHistoryLog("scan-3#1", {}), undefined);
  await loadHistoryLog("scan-3#1", {});
  assert.equal(asked.length, 2);
  // What was kept for the old one is gone.
  assert.equal(heldHistoryLog("scan-3", {}), undefined);
});

test("older pages are added to what's kept, without repeating an event", async (t) => {
  const events = Array.from({ length: LOG_PAGE_SIZE + 5 }, (_, i) => event(i + 1));
  const asked = serveHistory(t, events);
  const first = await loadHistoryLog("scan-4", {});
  assert.equal(first.events.length, LOG_PAGE_SIZE);
  assert.equal(first.next, LOG_PAGE_SIZE);

  const more = await loadMoreHistory("scan-4", {});
  assert.equal(asked[1].get("offset"), String(LOG_PAGE_SIZE));
  assert.equal(more?.events.length, LOG_PAGE_SIZE + 5);
  assert.equal(new Set(more?.events.map((e) => e.id)).size, LOG_PAGE_SIZE + 5);
  assert.equal(more?.next, null);
  assert.equal(heldHistoryLog("scan-4", {}), more);

  // Nothing older: nothing more is asked.
  assert.equal(await loadMoreHistory("scan-4", {}), more);
  assert.equal(asked.length, 2);
});

test("a failed answer is an error, and nothing is kept", async (t) => {
  serveHistory(t, [], 503);
  await assert.rejects(loadHistoryLog("scan-5", {}), /503/);
  assert.equal(heldHistoryLog("scan-5", {}), undefined);
});
