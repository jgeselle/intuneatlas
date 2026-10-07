import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchGroupDirectory } from "../../src/scan/groups.js";

function mockGraph(t: { after: (fn: () => void) => void }, handler: (url: string) => Response) {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const seen: string[] = [];
  global.fetch = (async (url: string | URL) => {
    seen.push(String(url));
    return handler(String(url));
  }) as typeof fetch;
  return seen;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, statusText: status === 200 ? "OK" : "Error", headers: { "content-type": "application/json" } });

test("fetchGroupDirectory: names for every assigned group and for the groups nested inside them", async (t) => {
  const seen = mockGraph(t, (url) => {
    if (url.includes("/groups/windows/transitiveMembers")) return json({ value: [{ id: "finance", displayName: "Finance laptops" }, { id: "emea", displayName: "Finance EMEA" }] });
    if (url.includes("/groups/pilot/transitiveMembers")) return json({ value: [] });
    if (url.includes("/groups/windows?")) return json({ id: "windows", displayName: "All Windows devices" });
    if (url.includes("/groups/pilot?")) return json({ id: "pilot", displayName: "Pilot ring" });
    throw new Error("unexpected " + url);
  });
  const directory = await fetchGroupDirectory("token", ["windows", "pilot", "windows", ""]);
  assert.deepEqual(directory, {
    available: true,
    names: { windows: "All Windows devices", pilot: "Pilot ring", finance: "Finance laptops", emea: "Finance EMEA" },
    contains: { windows: ["finance", "emea"] },
  });
  assert.equal(seen.length, 4, "one name lookup and one nesting lookup per distinct group");
  assert.ok(seen.every((url) => !/\/members\b|devices|users/.test(url)), "nothing about devices or users is read");
});

test("fetchGroupDirectory: without permission to read groups it reports itself unavailable instead of failing the scan", async (t) => {
  mockGraph(t, () => json({ error: { code: "Authorization_RequestDenied" } }, 403));
  assert.deepEqual(await fetchGroupDirectory("token", ["a", "b"]), { available: false, names: {}, contains: {} });
});

test("fetchGroupDirectory: a group that no longer exists is left without a name; the others still resolve", async (t) => {
  mockGraph(t, (url) => {
    if (url.includes("/groups/gone")) return json({ error: { code: "Request_ResourceNotFound" } }, 404);
    if (url.includes("transitiveMembers")) return json({ value: [] });
    return json({ id: "here", displayName: "Still here" });
  });
  assert.deepEqual(await fetchGroupDirectory("token", ["gone", "here"]), { available: true, names: { here: "Still here" }, contains: {} });
});

test("fetchGroupDirectory: any other failure still fails the scan", async (t) => {
  mockGraph(t, () => json({ error: { code: "ServiceUnavailable" } }, 503));
  await assert.rejects(fetchGroupDirectory("token", ["a"]), /failed: 503/);
});

test("fetchGroupDirectory: no groups assigned means no requests at all", async (t) => {
  const seen = mockGraph(t, () => json({}));
  assert.deepEqual(await fetchGroupDirectory("token", []), { available: true, names: {}, contains: {} });
  assert.equal(seen.length, 0);
});
