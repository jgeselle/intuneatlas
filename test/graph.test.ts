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
});
