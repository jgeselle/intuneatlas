import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBaselinesToReport, baselineDefinitionIds, type ScanReport } from "../../src/scan/report.js";
import type { BaselineRule } from "../../src/baselines/types.js";
import type { SettingIndexEntry } from "../../src/scan/types.js";

function makeRawReport(settings: SettingIndexEntry[]): ScanReport {
  return {
    scannedAt: "2026-01-01T00:00:00.000Z",
    flow: "interactive-browser",
    tenant: "contoso.onmicrosoft.com",
    policyCount: 1,
    legacyPolicyCount: 0,
    settingCount: settings.length,
    conflictCount: settings.filter((e) => e.conflict).length,
    belowBaselineCount: 0,
    settings,
    compliancePolicies: [],
    enrollmentConfigurations: [],
  };
}

const tamperEntry: SettingIndexEntry = {
  key: "tamper::windows10",
  name: "Tamper protection",
  cspPath: "./Defender/TamperProtection",
  category: "Endpoint protection",
  platform: "windows10",
  values: ["Disabled"],
  sources: [
    {
      policyId: "p1",
      policyName: "Policy 1",
      value: "Disabled",
      deployed: true,
      structured: { kind: "choice", definitionId: "tamper", name: "Tamper protection", optionId: "tamper_0", label: "Disabled" },
    },
  ],
  conflict: false,
  state: "Not checked",
  definitionId: "tamper",
  schemas: {
    tamper: {
      definitionId: "tamper",
      name: "Tamper protection",
      kind: "choice",
      options: [
        { id: "tamper_0", label: "Disabled" },
        { id: "tamper_1", label: "Enabled" },
      ],
    },
  },
  recs: [],
};

const tamperRule: BaselineRule = {
  id: "defender.tamper-protection",
  pack: "microsoft/defender-hardening-guidance",
  source: "Microsoft",
  policyName: "Defender",
  definitionId: "tamper",
  platform: "windows10",
  expected: { kind: "choice", definitionId: "tamper", name: "tamper", optionId: "tamper_1", label: "tamper_1" },
  compare: "exact",
};

const bitlockerRule: BaselineRule = {
  id: "bitlocker.recovery-key",
  pack: "cis/windows-11-benchmark-l1",
  source: "CIS",
  policyName: "BitLocker",
  definitionId: "bitlocker",
  platform: "windows10",
  expected: { kind: "simple", definitionId: "bitlocker", name: "bitlocker", value: 1 },
  compare: "exact",
};

test("applyBaselinesToReport: judges a raw report, leaving raw tenant facts untouched", () => {
  const raw = makeRawReport([tamperEntry]);
  const result = applyBaselinesToReport(raw, [tamperRule, bitlockerRule]);

  const tamper = result.settings.find((e) => e.key === "tamper::windows10")!;
  assert.equal(tamper.state, "Below baseline");
  assert.equal(tamper.recs.length, 1);
  assert.equal(result.belowBaselineCount, 1);

  // BitLocker rule matches nothing in the tenant -> a synthetic "Missing" entry.
  const uncovered = result.settings.find((e) => e.state === "Missing");
  assert.ok(uncovered, "expected a synthetic Missing entry for the unmatched BitLocker rule");

  // Raw tenant facts aren't touched by evaluation.
  assert.equal(result.settingCount, raw.settingCount);
  assert.equal(result.conflictCount, raw.conflictCount);
  assert.equal(raw.settings[0].state, "Not checked", "the raw report itself is not mutated");
});

test("applyBaselinesToReport: no rules -> nothing is judged", () => {
  const result = applyBaselinesToReport(makeRawReport([tamperEntry]), []);
  assert.equal(result.settings.length, 1);
  assert.equal(result.settings[0].state, "Not checked");
  assert.equal(result.belowBaselineCount, 0);
});

test("applyBaselinesToReport: re-evaluating an already-evaluated report doesn't duplicate or misjudge the synthetic entries", () => {
  const once = applyBaselinesToReport(makeRawReport([tamperEntry]), [tamperRule, bitlockerRule]);
  const twice = applyBaselinesToReport(once, [tamperRule, bitlockerRule]);
  assert.equal(twice.settings.filter((e) => e.state === "Missing").length, 1);
  assert.equal(twice.settings.filter((e) => e.state === "Below baseline").length, 1);
  assert.equal(twice.settings.length, once.settings.length);
});

test("applyBaselinesToReport: activePacks narrows which loaded rules actually get evaluated", () => {
  const raw = makeRawReport([tamperEntry]);
  const rules = [tamperRule, bitlockerRule];

  const both = applyBaselinesToReport(raw, rules, ["microsoft/defender-hardening-guidance", "cis/windows-11-benchmark-l1"]);
  assert.equal(both.belowBaselineCount, 1);
  assert.equal(both.settings.filter((e) => e.state === "Missing").length, 1);

  // Only the CIS pack active: the tamper rule isn't evaluated at all,
  // so it has no verdict ("Not checked") -- only the BitLocker gap shows.
  const cisOnly = applyBaselinesToReport(raw, rules, ["cis/windows-11-benchmark-l1"]);
  assert.equal(cisOnly.belowBaselineCount, 0);
  assert.equal(cisOnly.settings.find((e) => e.key === "tamper::windows10")!.state, "Not checked");
  assert.equal(cisOnly.settings.filter((e) => e.state === "Missing").length, 1);

  const none = applyBaselinesToReport(raw, rules, []);
  assert.equal(none.settings.length, 1);
  assert.equal(none.settings[0].state, "Not checked");
});

test("applyBaselinesToReport: a report carrying the pre-rework state names is mapped forward before judging", () => {
  const met = { ...tamperEntry, values: ["Enabled"], sources: [{ ...tamperEntry.sources[0], value: "Enabled", structured: { kind: "choice" as const, definitionId: "tamper", name: "Tamper protection", optionId: "tamper_1", label: "Enabled" } }] };
  const legacy = makeRawReport([
    { ...met, state: "Baseline" as never },
    { ...tamperEntry, key: "other::windows10", definitionId: "other", state: "Not deployed" as never },
    { ...tamperEntry, key: "uncovered::x", definitionId: "gone", values: [], state: "Not covered" as never },
  ]);
  const result = applyBaselinesToReport(legacy, [tamperRule]);

  assert.equal(result.settings.find((e) => e.key === "tamper::windows10")!.state, "Meets baseline");
  assert.equal(result.settings.find((e) => e.key === "other::windows10")!.state, "Not assigned");
  // The old synthetic entry is dropped rather than re-judged as a real setting.
  assert.equal(result.settings.some((e) => e.key === "uncovered::x"), false);
});

test("applyBaselinesToReport: definitions the scan looked up for the baselines name the Missing settings", () => {
  const raw = {
    ...makeRawReport([tamperEntry]),
    baselineDefinitions: {
      schemas: { bitlocker: { definitionId: "bitlocker", name: "Require device encryption", kind: "simple" as const, valueType: "integer" as const } },
      info: { bitlocker: { cspPath: "./BitLocker/RequireDeviceEncryption", category: "BitLocker" } },
    },
  };
  const missing = applyBaselinesToReport(raw, [bitlockerRule]).settings.find((e) => e.state === "Missing")!;
  assert.equal(missing.name, "Require device encryption");
  assert.equal(missing.cspPath, "./BitLocker/RequireDeviceEncryption");
});

test("baselineDefinitionIds: every definition a baseline mentions, sub-settings included, once each", () => {
  const nested: BaselineRule = {
    ...tamperRule,
    expected: { kind: "choice", definitionId: "a", name: "a", optionId: "a_1", label: "a_1", children: [{ kind: "simple", definitionId: "a_child", name: "a_child", value: 1 }] },
  };
  assert.deepEqual(baselineDefinitionIds([tamperRule, nested, tamperRule]).sort(), ["a", "a_child", "tamper"]);
});
