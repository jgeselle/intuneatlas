import assert from "node:assert/strict";
import { test } from "node:test";
import { graphGet } from "../src/graph.js";

/**
 * Covers a real bug found by scanning a real, large tenant (~1,200
 * settings across 111 policies): graphGet had no handling for 429 at
 * all — a real tenant of any size legitimately trips Intune Graph's
 * throttling during a scan, which previously failed the whole scan
 * outright instead of backing off and retrying.
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

test("graphGet", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  await t.test("retries a 429 using Retry-After, then succeeds", async () => {
    let calls = 0;
    global.fetch = (async () => {
      calls++;
      if (calls === 1) {
        return new Response("", { status: 429, headers: { "Retry-After": "0" } });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await graphGet<{ ok: boolean }>("token", "/thing");
    assert.equal(calls, 2);
    assert.deepEqual(result, { ok: true });
  });

  await t.test("a non-429 error throws immediately, no retries wasted", async () => {
    let calls = 0;
    global.fetch = (async () => {
      calls++;
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }) as typeof fetch;

    await assert.rejects(() => graphGet("token", "/missing"), /404/);
    assert.equal(calls, 1);
  });

  await t.test("succeeds on the first try when there's no throttling", async () => {
    let calls = 0;
    global.fetch = (async () => {
      calls++;
      return jsonResponse({ value: [1, 2, 3] });
    }) as typeof fetch;

    const result = await graphGet<{ value: number[] }>("token", "/thing");
    assert.equal(calls, 1);
    assert.deepEqual(result, { value: [1, 2, 3] });
  });

  await t.test("a dropped connection is tried again instead of failing the scan", async () => {
    let calls = 0;
    global.fetch = (async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    assert.deepEqual(await graphGet<{ ok: boolean }>("token", "/thing"), { ok: true });
    assert.equal(calls, 2);
  });

  await t.test("a gateway error is tried again", async () => {
    let calls = 0;
    global.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response("", { status: 503, headers: { "Retry-After": "0" } });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    assert.deepEqual(await graphGet<{ ok: boolean }>("token", "/thing"), { ok: true });
    assert.equal(calls, 2);
  });

  await t.test("never more than a handful of requests are open at once", async () => {
    let open = 0;
    let peak = 0;
    global.fetch = (async () => {
      open++;
      peak = Math.max(peak, open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open--;
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    await Promise.all(Array.from({ length: 100 }, (_, i) => graphGet("token", `/thing/${i}`)));
    assert.equal(peak, 8);
    assert.equal(open, 0);
  });

  await t.test("one throttled request holds the others back, and none of them fails", async () => {
    // Graph allows a burst, then refuses everything for a moment — the shape that used up every retry on a first scan.
    let blockedUntil = 0;
    let served = 0;
    let refused = 0;
    global.fetch = (async () => {
      if (Date.now() < blockedUntil) {
        refused++;
        return new Response("", { status: 429, headers: { "Retry-After": "0.05" } });
      }
      served++;
      if (served % 40 === 0) blockedUntil = Date.now() + 40;
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    await Promise.all(Array.from({ length: 400 }, (_, i) => graphGet("token", `/thing/${i}`)));
    assert.equal(served, 400);
    // Without the shared pause every queued request would be refused in turn, several times over.
    assert.ok(refused < 100, `refused ${refused} times`);
  });

  await t.test("throttling that never lets up still ends in an error", async () => {
    let calls = 0;
    global.fetch = (async () => {
      calls++;
      return new Response("slow down", { status: 429, statusText: "Too Many Requests", headers: { "Retry-After": "0" } });
    }) as typeof fetch;

    await assert.rejects(() => graphGet("token", "/thing"), /429/);
    assert.equal(calls, 13);
  });
});
