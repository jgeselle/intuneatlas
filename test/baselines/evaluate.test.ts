import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBaselines, findUncoveredEntries, type BaselineDefinitions } from "../../src/baselines/evaluate.js";
import type { BaselineRule } from "../../src/baselines/types.js";
import type { SettingIndexEntry, SettingSchema, SettingValueNode } from "../../src/scan/types.js";

/** A two-option choice setting as a scan would index it, set to `option` by one assigned policy. */
const SCHEMA: SettingSchema = {
  definitionId: "tamper",
  name: "Tamper protection",
  kind: "choice",
  options: [
    { id: "tamper_0", label: "Disabled" },
    { id: "tamper_1", label: "Enabled" },
  ],
};
const scannedChoice = (option: 0 | 1): SettingValueNode => ({
  kind: "choice",
  definitionId: "tamper",
  name: "Tamper protection",
  optionId: `tamper_${option}`,
  label: SCHEMA.options![option].label,
});
function entry(overrides: Partial<SettingIndexEntry> = {}): SettingIndexEntry {
  const structured = scannedChoice(0);
  return {
    key: "tamper::windows10",
    name: "Tamper protection",
    cspPath: "./Defender/TamperProtection",
    category: "Defender",
    platform: "windows10",
    values: ["Disabled"],
    sources: [{ policyId: "p1", policyName: "Policy 1", value: "Disabled", deployed: true, structured }],
    conflict: false,
    state: "Not checked",
    definitionId: "tamper",
    schemas: { tamper: SCHEMA },
    recs: [],
    ...overrides,
  };
}
/** A baseline rule as the loader produces it from an export: ids only, no names or labels. */
function rule(option: 0 | 1, overrides: Partial<BaselineRule> = {}): BaselineRule {
  return {
    id: `oib/v4::Defender::tamper::${option}`,
    pack: "oib/v4",
    source: "OIB v4",
    policyName: "Defender",
    definitionId: "tamper",
    platform: "windows10",
    expected: { kind: "choice", definitionId: "tamper", name: "tamper", optionId: `tamper_${option}`, label: `tamper_${option}` },
    compare: "exact",
    ...overrides,
  };
}

test("applyBaselines: a setting no rule covers is Not checked, with an empty checks list", () => {
  const [result] = applyBaselines([entry()], [rule(1, { definitionId: "something_else" })]);
  assert.equal(result.state, "Not checked");
  assert.deepEqual(result.checks, []);
  assert.deepEqual(result.recs, []);
});

test("applyBaselines: matches by definition id and reports the baseline's value with real labels, not ids", () => {
  const [result] = applyBaselines([entry()], [rule(1, { severity: "critical", rationale: "why", reference: "ref" })]);
  assert.equal(result.state, "Below baseline");
  assert.deepEqual(result.recs, [
    { ruleId: "oib/v4::Defender::tamper::1", current: "Disabled", recommended: "Enabled", source: "OIB v4", severity: "critical", why: "why" },
  ]);
  const [check] = result.checks!;
  assert.equal(check.expected, "Enabled");
  assert.equal(check.policyName, "Defender");
  assert.equal(check.passed, false);
  assert.equal(check.reference, "ref");
  assert.deepEqual(check.differences, [{ path: [], expected: "Enabled", actual: "Disabled" }]);
  assert.equal((check.expectedNode as { label: string }).label, "Enabled");
});

test("applyBaselines: a met baseline gives Meets baseline, no recommendation, and still says who expects what", () => {
  const [result] = applyBaselines([entry()], [rule(0)]);
  assert.equal(result.state, "Meets baseline");
  assert.deepEqual(result.recs, []);
  assert.equal(result.checks![0].passed, true);
  assert.equal("differences" in result.checks![0], false);
  assert.equal("severity" in result.checks![0], false, "an export alone carries no severity");
});

test("applyBaselines: one baseline setting the same thing in several policies accepts any of them", () => {
  const ring1 = rule(0, { id: "a", policyName: "Ring 1" });
  const ring2 = rule(1, { id: "b", policyName: "Ring 2" });
  const [result] = applyBaselines([entry()], [ring2, ring1]);
  assert.equal(result.state, "Meets baseline");
  assert.equal(result.checks!.length, 1, "one check per baseline, not per policy inside it");
  assert.equal(result.checks![0].policyName, "Ring 1", "reported against the alternative it matches");
  assert.deepEqual(result.checks![0].alternatives, ["Enabled"]);
});

test("applyBaselines: different baselines are judged separately and can disagree", () => {
  const [result] = applyBaselines([entry()], [rule(0), rule(1, { id: "cis", pack: "cis/l1", source: "CIS L1" })]);
  assert.equal(result.state, "Below baseline");
  assert.deepEqual(result.checks!.map((c) => [c.source, c.passed]), [
    ["OIB v4", true],
    ["CIS L1", false],
  ]);
  assert.deepEqual(result.recs.map((r) => r.source), ["CIS L1"]);
});

test("applyBaselines: conflicting and unassigned settings keep their state but still carry what the baseline expects", () => {
  for (const state of ["Conflict", "Not assigned"] as const) {
    const [result] = applyBaselines([entry({ state })], [rule(1)]);
    assert.equal(result.state, state);
    assert.deepEqual(result.checks!.map((c) => [c.expected, c.passed]), [["Enabled", null]]);
  }
});

test("applyBaselines: a rule for another platform doesn't apply", () => {
  const [result] = applyBaselines([entry()], [rule(1, { platform: "macOS" })]);
  assert.equal(result.state, "Not checked");
});

test("applyBaselines: a setting without a definition id (a legacy profile's) is never matched", () => {
  const [result] = applyBaselines([entry({ definitionId: undefined, schemas: undefined })], [rule(1)]);
  assert.equal(result.state, "Not checked");
});

test("applyBaselines: the verdict is recomputed from scratch — re-judging against different rules leaves nothing stale", () => {
  const [failing] = applyBaselines([entry()], [rule(1)]);
  assert.equal(failing.state, "Below baseline");
  const [unjudged] = applyBaselines([failing], []);
  assert.equal(unjudged.state, "Not checked");
  assert.deepEqual(unjudged.recs, []);
  assert.deepEqual(unjudged.checks, []);
});

test("applyBaselines: a compound value is held sub-setting by sub-setting", () => {
  const scanned: SettingValueNode = {
    kind: "choice",
    definitionId: "startup",
    name: "Startup authentication",
    optionId: "startup_1",
    label: "Enabled",
    children: [{ kind: "simple", definitionId: "startup_pin", name: "Minimum PIN length", value: 4 }],
  };
  const schemas: Record<string, SettingSchema> = {
    startup: { definitionId: "startup", name: "Startup authentication", kind: "choice", options: [{ id: "startup_1", label: "Enabled", childIds: ["startup_pin"] }] },
    startup_pin: { definitionId: "startup_pin", name: "Minimum PIN length", kind: "simple", valueType: "integer" },
  };
  const e = entry({
    key: "startup::windows10",
    definitionId: "startup",
    schemas,
    values: ["Enabled\nMinimum PIN length: 4"],
    sources: [{ policyId: "p", policyName: "P", value: "Enabled\nMinimum PIN length: 4", deployed: true, structured: scanned }],
  });
  const r = rule(1, {
    definitionId: "startup",
    expected: {
      kind: "choice",
      definitionId: "startup",
      name: "startup",
      optionId: "startup_1",
      label: "startup_1",
      children: [{ kind: "simple", definitionId: "startup_pin", name: "startup_pin", value: 6 }],
    },
  });
  const [result] = applyBaselines([e], [r]);
  assert.equal(result.state, "Below baseline");
  assert.deepEqual(result.checks![0].differences, [{ path: ["Minimum PIN length"], expected: "6", actual: "4" }]);
  assert.equal(result.checks![0].expected, "Enabled\nMinimum PIN length: 6");
});

const DEFINITIONS: BaselineDefinitions = {
  schemas: { laps: { definitionId: "laps", name: "Backup directory", kind: "choice", options: [{ id: "laps_1", label: "Entra ID" }] } },
  info: { laps: { cspPath: "./LAPS/BackupDirectory", category: "LAPS" } },
};
const lapsRule = (overrides: Partial<BaselineRule> = {}): BaselineRule =>
  rule(1, { id: "laps-rule", definitionId: "laps", expected: { kind: "choice", definitionId: "laps", name: "laps", optionId: "laps_1", label: "laps_1" }, ...overrides });

test("findUncoveredEntries: a setting a baseline expects but no policy configures becomes one Missing entry, named from the scan's lookups", () => {
  const [missing, ...rest] = findUncoveredEntries([entry()], [rule(1), lapsRule()], DEFINITIONS);
  assert.equal(rest.length, 0, "the tamper rule has a real entry, in whatever state");
  assert.equal(missing.state, "Missing");
  assert.equal(missing.name, "Backup directory");
  assert.equal(missing.cspPath, "./LAPS/BackupDirectory");
  assert.equal(missing.category, "LAPS", "filed under its real category, with the settings around it");
  assert.equal(missing.definitionId, "laps");
  assert.deepEqual(missing.values, []);
  assert.deepEqual(missing.recs, [{ ruleId: "laps-rule", current: "Not configured", recommended: "Entra ID", source: "OIB v4" }]);
  assert.deepEqual(missing.checks!.map((c) => [c.expected, c.passed, c.differences]), [["Entra ID", false, [{ path: [], expected: "Entra ID", actual: null }]]]);
});

test("findUncoveredEntries: without a lookup for it, a Missing setting falls back to its raw id rather than vanishing", () => {
  const [missing] = findUncoveredEntries([], [lapsRule()]);
  assert.equal(missing.name, "laps");
  assert.equal(missing.category, "Other");
  assert.equal(missing.cspPath, "");
  assert.equal(missing.recs[0].recommended, "laps_1");
});

test("findUncoveredEntries: several baselines expecting the same missing setting share one entry, a recommendation each", () => {
  const entries = findUncoveredEntries([], [lapsRule(), lapsRule({ id: "cis-laps", pack: "cis/l1", source: "CIS L1" })], DEFINITIONS);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].recs.map((r) => r.source), ["OIB v4", "CIS L1"]);
});

test("findUncoveredEntries: an entry in ANY state counts as covered", () => {
  for (const state of ["Conflict", "Not assigned", "Below baseline", "Meets baseline", "Not checked"] as const) {
    assert.deepEqual(findUncoveredEntries([entry({ state })], [rule(1)]), [], `state "${state}" should count as covered`);
  }
});

test("applyBaselines: a relaxed comparison from the annotations is honoured and carried on the check", () => {
  const schemas: Record<string, SettingSchema> = { defer: { definitionId: "defer", name: "Deferral days", kind: "simple", valueType: "integer" } };
  const scanned = (value: number) =>
    entry({
      key: "defer::windows10",
      definitionId: "defer",
      schemas,
      values: [String(value)],
      sources: [{ policyId: "p", policyName: "P", value: String(value), deployed: true, structured: { kind: "simple", definitionId: "defer", name: "Deferral days", value } }],
    });
  const atMost7 = rule(1, { definitionId: "defer", expected: { kind: "simple", definitionId: "defer", name: "defer", value: 7 }, compare: "atMost" });

  const [lower] = applyBaselines([scanned(3)], [atMost7]);
  assert.equal(lower.state, "Meets baseline");
  assert.equal(lower.checks![0].compare, "atMost");

  const [higher] = applyBaselines([scanned(14)], [atMost7]);
  assert.equal(higher.state, "Below baseline");
  assert.deepEqual(higher.checks![0].differences, [{ path: [], expected: "7 or less", actual: "14" }]);
});

test("findUncoveredEntries: a Missing entry carries only the definitions its own baseline values mention, not the whole lookup table", () => {
  const definitions: BaselineDefinitions = {
    schemas: { ...DEFINITIONS.schemas, unrelated: { definitionId: "unrelated", name: "Unrelated", kind: "simple" } },
    info: DEFINITIONS.info,
  };
  const [missing] = findUncoveredEntries([], [lapsRule()], definitions);
  assert.deepEqual(Object.keys(missing.schemas!), ["laps"]);
});
