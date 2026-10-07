import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBaselinesToReport, type ScanReport } from "../../src/scan/report.js";
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
  sources: [{ policyId: "p1", policyName: "Policy 1", value: "Disabled", deployed: true }],
  conflict: false,
  state: "Not checked",
  recs: [],
};

const tamperRule: BaselineRule = {
  id: "defender.tamper-protection",
  name: "Tamper protection",
  platform: "windows",
  path: "./Defender/TamperProtection",
  expect: "Enabled",
  severity: "critical",
  rationale: "why",
  source: "Microsoft",
  pack: "microsoft/defender-hardening-guidance",
};

const bitlockerRule: BaselineRule = {
  id: "bitlocker.recovery-key",
  name: "BitLocker recovery key backup",
  platform: "windows",
  path: "./BitLocker/RequireDeviceEncryption",
  expect: "1",
  severity: "high",
  rationale: "why",
  source: "CIS",
  pack: "cis/windows-11-benchmark-l1",
};

test("applyBaselinesToReport: judges a raw report, leaving raw tenant facts untouched", () => {
  const raw = makeRawReport([tamperEntry]);
  const result = applyBaselinesToReport(raw, [tamperRule, bitlockerRule]);

  // Raw facts about the tenant itself are untouched by baseline evaluation.
  assert.equal(result.scannedAt, raw.scannedAt);
  assert.equal(result.tenant, raw.tenant);
  assert.equal(result.policyCount, raw.policyCount);
  assert.equal(result.settingCount, raw.settingCount);
  assert.equal(result.conflictCount, raw.conflictCount);

  // Baseline judgment: tamper protection fails (Disabled, expects Enabled).
  const tamper = result.settings.find((e) => e.key === "tamper::windows10")!;
  assert.equal(tamper.state, "Below baseline");
  assert.equal(tamper.recs.length, 1);
  assert.equal(result.belowBaselineCount, 1);

  // BitLocker rule matches nothing in the tenant -> a synthetic "Missing" entry.
  const uncovered = result.settings.find((e) => e.state === "Missing");
  assert.ok(uncovered, "expected a synthetic Missing entry for the unmatched BitLocker rule");
  assert.equal(uncovered!.recs[0].ruleId, "bitlocker.recovery-key");

  assert.equal(result.settings.length, 2);
});

test("applyBaselinesToReport: raw entries pass straight through when no rule matches", () => {
  const raw = makeRawReport([tamperEntry]);
  const result = applyBaselinesToReport(raw, []);

  assert.equal(result.settings.length, 1);
  assert.equal(result.settings[0].state, "Not checked");
  assert.equal(result.belowBaselineCount, 0);
});

test("applyBaselinesToReport: re-running on an already-evaluated report doesn't corrupt synthetic entries", () => {
  // Mirrors what actually happens when --report points at a file a
  // previous `scan --out` wrote — already-evaluated output, not raw.
  const raw = makeRawReport([tamperEntry]);
  const onceEvaluated = applyBaselinesToReport(raw, [tamperRule, bitlockerRule]);

  const twiceEvaluated = applyBaselinesToReport(onceEvaluated, [tamperRule, bitlockerRule]);

  const uncovered = twiceEvaluated.settings.find((e) => e.state === "Missing");
  assert.ok(uncovered, "the coverage gap should still be reported, not silently dropped");
  // The bug this guards against: feeding a synthetic "Missing" entry
  // (values: []) back into applyBaselines scores it against an empty
  // string and misclassifies it as "Below baseline" instead.
  assert.equal(uncovered!.state, "Missing");
  assert.equal(twiceEvaluated.settings.filter((e) => e.state === "Below baseline").length, 1);
  assert.equal(twiceEvaluated.settings.length, 2);
});

test("applyBaselinesToReport: activePacks narrows which loaded rules actually get evaluated", () => {
  const raw = makeRawReport([tamperEntry]);

  // Both packs active (or undefined -- everything active): tamper fails, bitlocker is a gap.
  const both = applyBaselinesToReport(raw, [tamperRule, bitlockerRule], ["microsoft/defender-hardening-guidance", "cis/windows-11-benchmark-l1"]);
  assert.equal(both.settings.length, 2);
  assert.equal(both.belowBaselineCount, 1);

  // Only the CIS pack active: tamper's own (Microsoft) rule no longer applies at all,
  // so it has no verdict ("Not checked") -- only the BitLocker gap shows.
  const cisOnly = applyBaselinesToReport(raw, [tamperRule, bitlockerRule], ["cis/windows-11-benchmark-l1"]);
  assert.equal(cisOnly.belowBaselineCount, 0);
  assert.equal(cisOnly.settings.find((e) => e.key === "tamper::windows10")!.state, "Not checked");
  assert.equal(cisOnly.settings.filter((e) => e.state === "Missing").length, 1);

  // Neither pack active: no judgment at all, no gaps.
  const none = applyBaselinesToReport(raw, [tamperRule, bitlockerRule], []);
  assert.equal(none.settings.length, 1);
  assert.equal(none.settings[0].state, "Not checked");
});

test("applyBaselinesToReport: a report carrying the pre-rework state names is mapped forward before judging", () => {
  const legacy = makeRawReport([
    { ...tamperEntry, values: ["Enabled"], state: "Baseline" as never },
    { ...tamperEntry, key: "other::windows10", cspPath: "./Other", state: "Not deployed" as never },
    { ...tamperEntry, key: "uncovered::x", cspPath: "./Gone", values: [], state: "Not covered" as never },
  ]);
  const result = applyBaselinesToReport(legacy, [tamperRule]);

  assert.equal(result.settings.find((e) => e.key === "tamper::windows10")!.state, "Meets baseline");
  assert.equal(result.settings.find((e) => e.key === "other::windows10")!.state, "Not assigned");
  // The old synthetic entry is dropped rather than re-judged as a real setting.
  assert.equal(result.settings.some((e) => e.key === "uncovered::x"), false);
});
