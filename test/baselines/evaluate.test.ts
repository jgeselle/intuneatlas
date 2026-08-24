import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBaselines } from "../../src/baselines/evaluate.js";
import type { BaselineRule } from "../../src/baselines/types.js";
import type { SettingIndexEntry } from "../../src/scan/types.js";

interface Fixture {
  description: string;
  entries: SettingIndexEntry[];
  rules: BaselineRule[];
  expect: Array<Partial<SettingIndexEntry>>;
}

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

for (const file of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8")) as Fixture;

  test(`applyBaselines: ${file} — ${fixture.description}`, () => {
    const result = applyBaselines(fixture.entries, fixture.rules);
    assert.equal(result.length, fixture.expect.length);

    for (const expected of fixture.expect) {
      const actual = result.find((entry) => entry.key === expected.key);
      assert.ok(actual, `expected an entry with key "${expected.key}"`);
      for (const [field, value] of Object.entries(expected)) {
        assert.deepEqual((actual as unknown as Record<string, unknown>)[field], value, `field "${field}" on "${expected.key}"`);
      }
    }
  });
}

test("applyBaselines: every matching rule attaches its own recommendation — a setting can have several, from different sources", () => {
  const entries: SettingIndexEntry[] = [
    {
      key: "Require BitLocker::windows10",
      name: "Require BitLocker",
      cspPath: "./x",
      category: "Encryption",
      platform: "windows10",
      values: ["0"],
      sources: [],
      conflict: false,
      state: "Baseline",
      recs: [],
    },
  ];
  const rules: BaselineRule[] = [
    { id: "first-rule", name: "First", platform: "windows", path: "./x", expect: "1", severity: "critical", rationale: "first", source: "A" },
    { id: "second-rule", name: "Second", platform: "windows", path: "./x", expect: "1", severity: "low", rationale: "second", source: "B" },
  ];

  const [result] = applyBaselines(entries, rules);
  assert.equal(result.recs.length, 2);
  assert.deepEqual(result.recs.map((r) => r.ruleId), ["first-rule", "second-rule"]);
  assert.deepEqual(result.recs.map((r) => r.source), ["A", "B"]);
});

test("applyBaselines: a rule that's already satisfied doesn't produce a recommendation, even alongside one that isn't", () => {
  const entries: SettingIndexEntry[] = [
    {
      key: "Require BitLocker::windows10",
      name: "Require BitLocker",
      cspPath: "./x",
      category: "Encryption",
      platform: "windows10",
      values: ["1"],
      sources: [],
      conflict: false,
      state: "Baseline",
      recs: [],
    },
  ];
  const rules: BaselineRule[] = [
    { id: "already-satisfied", name: "Satisfied", platform: "windows", path: "./x", expect: "1", severity: "critical", rationale: "ok", source: "A" },
    { id: "still-failing", name: "Failing", platform: "windows", path: "./x", expect: "0", severity: "low", rationale: "conflicting rule", source: "B" },
  ];

  const [result] = applyBaselines(entries, rules);
  assert.deepEqual(result.recs.map((r) => r.ruleId), ["still-failing"]);
});

test("applyBaselines: no rule at all for the path — entry passes through unchanged", () => {
  const entries: SettingIndexEntry[] = [
    {
      key: "Unrelated Setting::windows10",
      name: "Unrelated Setting",
      cspPath: "./nowhere",
      category: "Misc",
      platform: "windows10",
      values: ["anything"],
      sources: [],
      conflict: false,
      state: "Baseline",
      recs: [],
    },
  ];
  const result = applyBaselines(entries, []);
  assert.deepEqual(result, entries);
});
