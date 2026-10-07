import assert from "node:assert/strict";
import { test } from "node:test";
import { compareBaselines } from "../../src/baselines/compareBaselines.js";
import type { BaselineDefinitions } from "../../src/baselines/evaluate.js";
import type { BaselineRule } from "../../src/baselines/types.js";
import type { SettingIndexEntry, SettingSchema } from "../../src/scan/types.js";

const onOff = (id: string, name: string): SettingSchema => ({
  definitionId: id,
  name,
  kind: "choice",
  options: [
    { id: `${id}_0`, label: "Off" },
    { id: `${id}_1`, label: "On" },
  ],
});
/** A choice rule as loaded from an export: ids only. */
function rule(pack: string, id: string, option: 0 | 1, overrides: Partial<BaselineRule> = {}): BaselineRule {
  return {
    id: `${pack}::${overrides.policyName ?? "Policy"}::${id}`,
    pack,
    source: pack,
    policyName: "Policy",
    definitionId: id,
    platform: "windows10",
    expected: { kind: "choice", definitionId: id, name: id, optionId: `${id}_${option}`, label: `${id}_${option}` },
    compare: "exact",
    ...overrides,
  };
}
function entry(id: string, name: string, option: 0 | 1, overrides: Partial<SettingIndexEntry> = {}): SettingIndexEntry {
  const label = option ? "On" : "Off";
  return {
    key: `${id}::windows10`,
    name,
    cspPath: `./${id}`,
    category: "Cat " + name[0],
    platform: "windows10",
    values: [label],
    sources: [{ policyId: "p", policyName: "P", value: label, deployed: true, structured: { kind: "choice", definitionId: id, name, optionId: `${id}_${option}`, label } }],
    conflict: false,
    state: "Not checked",
    definitionId: id,
    schemas: { [id]: onOff(id, name) },
    recs: [],
    ...overrides,
  };
}

const V1 = "oib/v1";
const V2 = "oib/v2";

test("compareBaselines: lists what was added, removed and changed — and nothing that stayed the same", () => {
  const rules = [
    rule(V1, "same", 1),
    rule(V2, "same", 1),
    rule(V1, "changed", 0),
    rule(V2, "changed", 1),
    rule(V1, "removed", 1),
    rule(V2, "added", 1),
  ];
  const entries = [entry("same", "Same", 1), entry("changed", "Changed", 0), entry("removed", "Removed", 1), entry("added", "Added", 1)];
  const changes = compareBaselines(rules, V1, V2, entries);
  assert.deepEqual(
    changes.map((c) => [c.definitionId, c.change, c.from, c.to]),
    [
      ["added", "added", [], ["On"]],
      ["changed", "changed", ["Off"], ["On"]],
      ["removed", "removed", ["On"], []],
    ],
  );
});

test("compareBaselines: where the tenant stands is judged against the baseline being moved to", () => {
  const rules = [rule(V2, "a", 1), rule(V2, "b", 1), rule(V2, "c", 1), rule(V2, "d", 1), rule(V2, "e", 1), rule(V1, "f", 1), rule(V1, "g", 1)];
  const entries = [
    entry("a", "A", 1),
    entry("b", "B", 0),
    entry("d", "D", 1, { conflict: true, state: "Conflict", values: ["On", "Off"] }),
    entry("e", "E", 1, { state: "Not assigned", sources: [{ policyId: "p", policyName: "P", value: "On", deployed: false }] }),
    entry("f", "F", 1),
  ];
  const standing = Object.fromEntries(compareBaselines(rules, V1, V2, entries).map((c) => [c.definitionId, [c.tenant, c.current, c.entryKey ?? null]]));
  assert.deepEqual(standing, {
    a: ["meets", "On", "a::windows10"],
    b: ["below", "Off", "b::windows10"],
    c: ["missing", null, null],
    d: ["conflict", null, "d::windows10"],
    e: ["notAssigned", "On", "e::windows10"],
    // No longer in the baseline: just whether the tenant has it.
    f: ["configured", "On", "f::windows10"],
    g: ["notConfigured", null, null],
  });
});

test("compareBaselines: neither baseline needs to be active, and verdicts already on the entries are ignored", () => {
  const judged = entry("a", "A", 0, { state: "Meets baseline", checks: [] });
  const [change] = compareBaselines([rule(V1, "a", 0), rule(V2, "a", 1)], V1, V2, [judged]);
  assert.equal(change.tenant, "below");
});

test("compareBaselines: a setting one baseline sets in several policies compares as the set of values it accepts", () => {
  const ring = (pack: string, option: 0 | 1, policyName: string) => rule(pack, "ring", option, { policyName });
  // Same two accepted values on both sides, just listed in a different order: not a change.
  assert.deepEqual(compareBaselines([ring(V1, 0, "R1"), ring(V1, 1, "R2"), ring(V2, 1, "Ra"), ring(V2, 0, "Rb")], V1, V2, []), []);
  // The same value repeated in two policies on one side and stated once on the other: not a change either.
  assert.deepEqual(compareBaselines([ring(V1, 1, "R1"), ring(V1, 1, "R2"), ring(V2, 1, "Ra")], V1, V2, []), []);
  // One side drops an alternative: a change, and the tenant meets it by matching any that remain.
  const [change] = compareBaselines([ring(V1, 0, "R1"), ring(V1, 1, "R2"), ring(V2, 1, "Ra")], V1, V2, [entry("ring", "Ring", 1)]);
  assert.deepEqual([change.change, change.from, change.to, change.tenant], ["changed", ["Off", "On"], ["On"], "meets"]);
});

test("compareBaselines: a relaxed comparison is part of what's compared, and shows in the value", () => {
  const defer = (pack: string, value: number, compare: BaselineRule["compare"]): BaselineRule =>
    rule(pack, "defer", 1, { expected: { kind: "simple", definitionId: "defer", name: "defer", value }, compare });
  const [change] = compareBaselines([defer(V1, 7, "exact"), defer(V2, 7, "atMost")], V1, V2, []);
  assert.deepEqual([change.change, change.from, change.to], ["changed", ["7"], ["7 or less"]]);
});

test("compareBaselines: a setting the tenant lacks is named from the scan's lookups, or by id without them", () => {
  const definitions: BaselineDefinitions = { schemas: { laps: onOff("laps", "Backup directory") }, info: { laps: { cspPath: "./LAPS", category: "LAPS" } } };
  const rules = [rule(V2, "laps", 1), rule(V2, "unknown", 1)];
  const byId = Object.fromEntries(compareBaselines(rules, V1, V2, [], definitions).map((c) => [c.definitionId, [c.name, c.category, c.cspPath, c.to]]));
  assert.deepEqual(byId, {
    laps: ["Backup directory", "LAPS", "./LAPS", ["On"]],
    unknown: ["unknown", "", "", ["unknown_1"]],
  });
});

test("compareBaselines: works across publishers, and an identical or unknown pair yields nothing", () => {
  const rules = [rule("oib/v4", "a", 1), rule("cis/l1", "a", 0), rule("cis/l1", "b", 1)];
  assert.deepEqual(
    compareBaselines(rules, "oib/v4", "cis/l1", []).map((c) => [c.definitionId, c.change]),
    [
      ["a", "changed"],
      ["b", "added"],
    ],
  );
  assert.deepEqual(compareBaselines(rules, "oib/v4", "oib/v4", []), []);
  assert.deepEqual(compareBaselines(rules, "nope/1", "nope/2", []), []);
});

test("compareBaselines: a rule for another platform isn't matched to the tenant's setting of the same id", () => {
  const [change] = compareBaselines([rule(V2, "a", 1, { platform: "macOS" })], V1, V2, [entry("a", "A", 1)]);
  assert.deepEqual([change.platform, change.tenant, change.entryKey ?? null], ["macOS", "missing", null]);
});
