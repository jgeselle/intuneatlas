import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { loadCatalog, primeDefinitions, resolveSettingDefinition, resolveSettingDefinitionOrStandIn, useDefinitionStore, type DefinitionStore } from "../../src/scan/settingDefinitions.js";

/**
 * Covers what a real hosted instance ran into: a first scan against a
 * large baseline asked Graph for ~1,750 definitions one at a time, was
 * throttled before it finished, and did it all over after every restart.
 * Confirmed live that Graph answers a plain list of the catalog with all
 * of it at once — so that is the only way definitions are fetched now.
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
    setMany: (entries) => {
      for (const [key, json] of entries) rows.set(key, { json, at: now() });
    },
  };
}

const LISTS = ["complianceCategories", "complianceSettings", "configurationCategories", "configurationSettings"];

function mockGraph(t: TestContext, failing: { status?: number } = {}): { calls: string[] } {
  const calls: string[] = [];
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
    useDefinitionStore(undefined);
  });
  global.fetch = (async (url: string | URL | Request) => {
    const path = String(url).split("/deviceManagement/")[1];
    calls.push(path);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, statusText: status === 403 ? "Forbidden" : "OK", headers: { "content-type": "application/json" } });
    if (failing.status) return json({ error: {} }, failing.status);
    if (path === "configurationSettings") {
      return json({
        value: [
          {
            id: "in_catalog",
            displayName: "In the catalog",
            baseUri: "./Device",
            offsetUri: "/a",
            categoryId: "cat",
            keywords: ["dropped"],
            helpText: null,
            options: [{ itemId: "in_catalog_1", displayName: "Enabled", optionValue: { value: 1 }, dependedOnBy: [] }],
          },
          { id: "admx_thing", displayName: "ADMX thing", baseUri: "./Device", offsetUri: "/b", categoryId: "cat-admx" },
          { id: "apple_thing", displayName: "Apple thing", baseUri: "", offsetUri: "", categoryId: "cat-unlisted" },
          { id: "orphan", displayName: "Orphan", baseUri: "", offsetUri: "", categoryId: "cat-nowhere" },
        ],
      });
    }
    if (path === "complianceSettings") return json({ value: [{ id: "linux_thing", displayName: "Linux thing", baseUri: "", offsetUri: "", categoryId: "cat-linux" }] });
    if (path === "configurationCategories") {
      return json({ value: [{ id: "cat", displayName: "Defender", parentCategoryId: "x" }, { id: "cat-admx", displayName: "", description: "Administrative Templates" }] });
    }
    if (path === "complianceCategories") return json({ value: [{ id: "cat-linux", displayName: "Password Policy" }] });
    if (path === "configurationCategories/cat-unlisted") return json({ id: "cat-unlisted", displayName: "Setup Assistant" });
    return json({ error: {} }, 404);
  }) as typeof fetch;
  return { calls };
}

test("catalog: fetched whole, after which any number of definitions cost no request at all", async (t) => {
  const { calls } = mockGraph(t);
  const store = memoryStore();
  useDefinitionStore(store);

  await Promise.all([loadCatalog("token"), loadCatalog("token")]);
  // The four lists, and the categories the lists left out — asked for once, as part of the catalog.
  assert.deepEqual([...calls].sort(), [...LISTS, "configurationCategories/cat-nowhere", "configurationCategories/cat-unlisted"].sort());

  const all = await Promise.all(Array.from({ length: 50 }, () => resolveSettingDefinition("token", "in_catalog")));
  assert.equal(all[0].name, "In the catalog");
  assert.equal(all[0].category, "Defender");
  assert.equal(all[0].options?.get("in_catalog_1"), "Enabled");
  // An ADMX category has an empty displayName but a useful description; one the lists omit is asked for by id;
  // one Graph has nothing for is shown by its id, never blank.
  assert.equal((await resolveSettingDefinition("token", "admx_thing")).category, "Administrative Templates");
  assert.equal((await resolveSettingDefinition("token", "apple_thing")).category, "Setup Assistant");
  assert.equal((await resolveSettingDefinition("token", "orphan")).category, "cat-nowhere");
  assert.equal(calls.length, 6);

  // Only what's read is kept.
  assert.deepEqual(Object.keys(JSON.parse(store.rows.get("configurationSettings/in_catalog")!.json)).sort(), ["baseUri", "categoryId", "displayName", "id", "offsetUri", "options"]);
});

test("catalog: kept for a week across restarts, then fetched again", async (t) => {
  const { calls } = mockGraph(t);
  let now = 1_000_000;
  const store = memoryStore(() => now);
  const day = 24 * 60 * 60 * 1000;
  // Setting the store again forgets everything held in memory — the same as a new process.
  const restart = () => useDefinitionStore(store);

  restart();
  await resolveSettingDefinition("token", "in_catalog");
  const once = calls.length;

  now += 6 * day;
  restart();
  assert.equal((await resolveSettingDefinition("token", "in_catalog")).name, "In the catalog");
  assert.equal(calls.length, once);

  now += 2 * day;
  restart();
  await resolveSettingDefinition("token", "in_catalog");
  assert.equal(calls.length, once * 2);
});

test("catalog: a definition it doesn't hold is never asked for on its own", async (t) => {
  const { calls } = mockGraph(t);
  useDefinitionStore(memoryStore());
  await loadCatalog("token");
  const before = calls.length;

  await assert.rejects(resolveSettingDefinition("token", "not_in_catalog"), /no definition for not_in_catalog/);
  const standIn = await resolveSettingDefinitionOrStandIn("token", "not_in_catalog");
  assert.deepEqual([standIn.name, standIn.category], ["not_in_catalog", "Unknown"]);
  assert.equal(calls.length, before);
});

test("catalog: with nowhere to keep it, it's held in memory for the run", async (t) => {
  const { calls } = mockGraph(t);
  useDefinitionStore(undefined);
  assert.equal((await resolveSettingDefinition("token", "in_catalog")).name, "In the catalog");
  assert.equal((await resolveSettingDefinition("token", "compliance.catalog.linux_thing")).category, "Password Policy");
  assert.equal(calls.length, 6);
});

test("catalog: when it can't be fetched the scan fails and says why — nothing is looked up one by one instead", async (t) => {
  const { calls } = mockGraph(t, { status: 403 });
  useDefinitionStore(memoryStore());

  await assert.rejects(resolveSettingDefinition("token", "in_catalog"), (err: Error) => {
    assert.match(err.message, /^Couldn't download Intune's settings catalog from Microsoft Graph, and a scan can't name settings without it\. Nothing in the tenant was changed — try again in a minute\./);
    assert.match(err.message, /403 Forbidden/);
    return true;
  });
  assert.deepEqual([...new Set(calls)].sort(), LISTS);

  // It isn't remembered as a failure: the next scan tries again.
  const tries = calls.length;
  await assert.rejects(loadCatalog("token"));
  assert.ok(calls.length > tries);
});

test("catalog: when a refresh fails, the copy from an earlier scan is used and said to be", async (t) => {
  const now = { value: 1_000_000 };
  const store = memoryStore(() => now.value);
  const working = mockGraph(t);
  useDefinitionStore(store);
  await loadCatalog("token");
  assert.ok(working.calls.length > 0);

  now.value += 30 * 24 * 60 * 60 * 1000;
  mockGraph(t, { status: 500 });
  useDefinitionStore(store);
  const said: string[] = [];
  await loadCatalog("token", (message) => said.push(message));
  assert.match(said.join(" "), /using the copy from an earlier scan/);
  assert.equal((await resolveSettingDefinition("token", "in_catalog")).name, "In the catalog");
});

test("catalog: a store that can't be read or written never fails a scan — the catalog is fetched and held in memory", async (t) => {
  mockGraph(t);
  const said: string[] = [];
  useDefinitionStore({
    get: () => {
      throw new Error("disk gone");
    },
    set: () => {
      throw new Error("disk full");
    },
    setMany: () => {
      throw new Error("disk full");
    },
  });
  await loadCatalog("token", (message) => said.push(message));
  assert.match(said.join(" "), /Couldn't save the settings catalog \(disk full\)/);
  assert.equal((await resolveSettingDefinition("token", "in_catalog")).name, "In the catalog");
});

test("definitions: one newer than the kept catalog still resolves when it arrives with a policy's settings, and is added to what's kept", async (t) => {
  const { calls } = mockGraph(t);
  const store = memoryStore();
  useDefinitionStore(store);
  await loadCatalog("token");
  const before = calls.length;

  primeDefinitions("configurationSettings", [
    { id: "brand_new", displayName: "Brand new", baseUri: "./Device", offsetUri: "/x", categoryId: "cat", keywords: ["dropped"] },
    { id: "half a definition" },
    null,
  ]);
  const found = await resolveSettingDefinition("token", "brand_new");
  assert.deepEqual([found.name, found.category], ["Brand new", "Defender"]);
  assert.equal(calls.length, before);
  assert.deepEqual(Object.keys(JSON.parse(store.rows.get("configurationSettings/brand_new")!.json)).sort(), ["baseUri", "categoryId", "displayName", "id", "offsetUri"]);

  useDefinitionStore(store);
  assert.equal((await resolveSettingDefinition("token", "brand_new")).name, "Brand new");
  assert.equal(calls.length, before);
});
