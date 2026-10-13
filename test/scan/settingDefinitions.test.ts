import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { primeDefinitions, resolveSettingDefinition, resolveSettingDefinitionOrStandIn, useDefinitionStore, type DefinitionStore } from "../../src/scan/settingDefinitions.js";

/**
 * Covers what a real hosted instance ran into: a first scan against a
 * large baseline asked Graph for ~1,500 definitions, plus each one's
 * category again, was throttled, and did it all over after every restart.
 */
function memoryStore(now: () => number = Date.now): DefinitionStore & { rows: Map<string, { json: string; at: number }> } {
  const rows = new Map<string, { json: string; at: number }>();
  return {
    rows,
    get: (key, maxAgeMs) => {
      const row = rows.get(key);
      return row && now() - row.at < maxAgeMs ? row.json : undefined;
    },
    set: (key, json) => void rows.set(key, { json, at: now() }),
  };
}

function mockGraph(t: TestContext): { calls: string[] } {
  const calls: string[] = [];
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
    useDefinitionStore(undefined);
  });
  global.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u.split("/deviceManagement/")[1]);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.includes("configurationCategories/")) return json({ id: "cat", displayName: "Defender" });
    if (u.endsWith("/gone")) return json({ error: {} }, 404);
    const id = u.split("/").pop();
    return json({ id, displayName: `Name of ${id}`, baseUri: "./Device", offsetUri: `/${id}`, categoryId: "cat" });
  }) as typeof fetch;
  return { calls };
}

test("definitions: many callers at once share one lookup, and one category lookup", async (t) => {
  const { calls } = mockGraph(t);
  useDefinitionStore(undefined);
  const all = await Promise.all(Array.from({ length: 50 }, (_, i) => resolveSettingDefinition("token", `setting_${i % 5}`)));
  assert.equal(all[0].category, "Defender");
  assert.equal(calls.filter((c) => c.startsWith("configurationSettings/")).length, 5);
  assert.equal(calls.filter((c) => c.startsWith("configurationCategories/")).length, 1);
});

test("definitions: what was kept is not asked for again after a restart", async (t) => {
  const { calls } = mockGraph(t);
  const store = memoryStore();
  useDefinitionStore(store);
  const first = await resolveSettingDefinition("token", "setting_a");
  assert.equal(calls.length, 2);

  // Setting the store again empties what's held in memory — the same as a new process.
  useDefinitionStore(store);
  const second = await resolveSettingDefinition("token", "setting_a");
  assert.equal(calls.length, 2);
  assert.deepEqual(second, first);
});

test("definitions: an id Graph has nothing for is remembered for a day, a real answer for a week", async (t) => {
  const { calls } = mockGraph(t);
  let now = 1_000_000;
  const store = memoryStore(() => now);
  const restart = () => useDefinitionStore(store);
  const day = 24 * 60 * 60 * 1000;

  restart();
  assert.equal((await resolveSettingDefinitionOrStandIn("token", "gone")).name, "gone");
  await resolveSettingDefinition("token", "setting_a");
  const asked = calls.length;

  now += day / 2;
  restart();
  assert.equal((await resolveSettingDefinitionOrStandIn("token", "gone")).name, "gone");
  await resolveSettingDefinition("token", "setting_a");
  assert.equal(calls.length, asked);

  now += day;
  restart();
  await resolveSettingDefinitionOrStandIn("token", "gone");
  await resolveSettingDefinition("token", "setting_a");
  assert.deepEqual(calls.slice(asked), ["configurationSettings/gone"]);

  now += 7 * day;
  restart();
  await resolveSettingDefinition("token", "setting_a");
  assert.deepEqual(calls.slice(asked + 1), ["configurationSettings/setting_a", "configurationCategories/cat"]);
});

test("definitions: a store that throws or holds rubbish never fails a lookup", async (t) => {
  mockGraph(t);
  useDefinitionStore({
    get: (key) => {
      if (key.startsWith("category/")) throw new Error("disk gone");
      return "{not json";
    },
    set: () => {
      throw new Error("disk full");
    },
  });
  assert.equal((await resolveSettingDefinition("token", "setting_a")).name, "Name of setting_a");
});

test("definitions: one that arrived with a policy's settings is never asked for, and is kept for next time", async (t) => {
  const { calls } = mockGraph(t);
  const store = memoryStore();
  useDefinitionStore(store);
  primeDefinitions("configurationSettings", [
    { id: "handed_over", displayName: "Handed over", baseUri: "./Device", offsetUri: "/x", categoryId: "cat" },
    { id: "half a definition" },
    null,
  ]);
  assert.equal((await resolveSettingDefinition("token", "handed_over")).name, "Handed over");
  assert.deepEqual(calls, ["configurationCategories/cat"]);
  assert.deepEqual([...store.rows.keys()].sort(), ["category/cat", "configurationSettings/handed_over"]);

  useDefinitionStore(store);
  assert.equal((await resolveSettingDefinition("token", "handed_over")).name, "Handed over");
  assert.equal(calls.length, 1);
});
