import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSettingIndex } from "../../src/scan/index.js";
import type { RawPolicy } from "../../src/scan/types.js";

/**
 * The merge/conflict engine is this project's entire value proposition — an
 * Intune admin trusting a conflict verdict needs to be able to see it
 * demonstrated, not just take the code's word for it. Each fixture below is
 * a small, readable "here are the real policies, here's the settings-index
 * entry they must produce" case; adding a new scenario is just dropping in
 * another JSON file, no test code to touch.
 */
interface Fixture {
  description: string;
  policies: RawPolicy[];
  expect: Array<Partial<ReturnType<typeof buildSettingIndex>[number]>>;
}

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

for (const file of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8")) as Fixture;

  test(`buildSettingIndex: ${file} — ${fixture.description}`, () => {
    const result = buildSettingIndex(fixture.policies);
    assert.equal(result.length, fixture.expect.length, `expected ${fixture.expect.length} settings-index entries, got ${result.length}`);

    for (const expected of fixture.expect) {
      const actual = result.find((entry) => entry.key === expected.key);
      assert.ok(actual, `expected an entry with key "${expected.key}", but none was produced`);
      for (const [field, value] of Object.entries(expected)) {
        assert.deepEqual((actual as unknown as Record<string, unknown>)[field], value, `field "${field}" on "${expected.key}"`);
      }
    }
  });
}

test("buildSettingIndex: sorts entries by category, then name", () => {
  const policies: RawPolicy[] = [
    {
      id: "p1",
      name: "Policy",
      platform: "windows10",
      assignments: [{ kind: "allDevices" }],
      settings: [
        { settingDefinitionId: "d1", name: "Zebra Setting", cspPath: "./z", category: "Zoo", value: "1" },
        { settingDefinitionId: "d2", name: "Apple Setting", cspPath: "./a", category: "Zoo", value: "1" },
        { settingDefinitionId: "d3", name: "Any Setting", cspPath: "./b", category: "Alphabet", value: "1" },
      ],
    },
  ];

  const result = buildSettingIndex(policies);
  assert.deepEqual(
    result.map((e) => `${e.category}/${e.name}`),
    ["Alphabet/Any Setting", "Zoo/Apple Setting", "Zoo/Zebra Setting"],
  );
});

test("buildSettingIndex: empty policy list produces an empty index", () => {
  assert.deepEqual(buildSettingIndex([]), []);
});

test("buildSettingIndex: a single deployed source is never a conflict, regardless of value", () => {
  const policies: RawPolicy[] = [
    {
      id: "p1",
      name: "Only Policy",
      platform: "windows10",
      assignments: [{ kind: "allDevices" }],
      settings: [{ settingDefinitionId: "d1", name: "Solo Setting", cspPath: "./x", category: "Cat", value: "42" }],
    },
  ];
  const [entry] = buildSettingIndex(policies);
  assert.equal(entry.conflict, false);
  assert.equal(entry.state, "Baseline");
});
