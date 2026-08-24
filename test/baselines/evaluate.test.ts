import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBaselines, findUncoveredEntries } from "../../src/baselines/evaluate.js";
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

test("findUncoveredEntries: a rule whose path matches nothing in the tenant produces one synthetic entry", () => {
  const rules: BaselineRule[] = [
    { id: "gap-rule", name: "BitLocker recovery key backup", platform: "windows", path: "./nowhere", expect: "1", severity: "high", rationale: "why", source: "CIS" },
  ];

  const [result] = findUncoveredEntries([], rules);
  assert.equal(result.key, "uncovered::./nowhere::windows");
  assert.equal(result.name, "BitLocker recovery key backup");
  assert.equal(result.cspPath, "./nowhere");
  assert.equal(result.platform, "windows");
  assert.deepEqual(result.values, []);
  assert.deepEqual(result.sources, []);
  assert.equal(result.conflict, false);
  assert.equal(result.state, "Not covered");
  assert.deepEqual(result.recs.map((r) => r.ruleId), ["gap-rule"]);
});

test("findUncoveredEntries: a real entry at that path — in ANY state — counts as covered, not just Baseline/Below baseline", () => {
  const makeEntry = (state: SettingIndexEntry["state"]): SettingIndexEntry => ({
    key: "k::windows10",
    name: "Some setting",
    cspPath: "./x",
    category: "Cat",
    platform: "windows10",
    values: ["1"],
    sources: [],
    conflict: state === "Conflict",
    state,
    recs: [],
  });
  const rules: BaselineRule[] = [
    { id: "r", name: "R", platform: "windows", path: "./x", expect: "1", severity: "low", rationale: "why", source: "A" },
  ];

  for (const state of ["Conflict", "Not deployed", "Below baseline", "Baseline"] as const) {
    assert.deepEqual(findUncoveredEntries([makeEntry(state)], rules), [], `state "${state}" should count as covered`);
  }
});

test("findUncoveredEntries: several uncovered rules sharing the same path+platform merge into one entry", () => {
  const rules: BaselineRule[] = [
    { id: "r1", name: "First", platform: "windows", path: "./x", expect: "1", severity: "high", rationale: "a", source: "CIS" },
    { id: "r2", name: "Second", platform: "windows", path: "./x", expect: "1", severity: "low", rationale: "b", source: "Microsoft" },
  ];

  const result = findUncoveredEntries([], rules);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].recs.map((r) => r.ruleId), ["r1", "r2"]);
  assert.deepEqual(result[0].recs.map((r) => r.source), ["CIS", "Microsoft"]);
});

test("findUncoveredEntries: an entry on a different platform doesn't cover a rule for this one", () => {
  const entries: SettingIndexEntry[] = [
    {
      key: "k::iOS",
      name: "Some setting",
      cspPath: "./x",
      category: "Cat",
      platform: "iOS",
      values: ["1"],
      sources: [],
      conflict: false,
      state: "Baseline",
      recs: [],
    },
  ];
  const rules: BaselineRule[] = [
    { id: "r", name: "R", platform: "windows", path: "./x", expect: "1", severity: "low", rationale: "why", source: "A" },
  ];

  const result = findUncoveredEntries(entries, rules);
  assert.equal(result.length, 1);
  assert.equal(result[0].platform, "windows");
});

test("findUncoveredEntries: no rules at all — nothing to report", () => {
  assert.deepEqual(findUncoveredEntries([], []), []);
});
