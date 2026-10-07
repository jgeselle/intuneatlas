import assert from "node:assert/strict";
import { test } from "node:test";
import type { BaselineRule } from "../../src/baselines/types.js";
import { buildSettingIndex } from "../../src/scan/index.js";
import { applyBaselinesToReport, type ScanReport } from "../../src/scan/report.js";
import { scopeToGroup } from "../../src/scan/scope.js";
import type { AssignmentTarget, GroupDirectory, RawPolicy, SettingValueNode } from "../../src/scan/types.js";

const group = (groupId: string, excluded = false): AssignmentTarget => ({ kind: "group", groupId, excluded });
const simple = (id: string, value: number): SettingValueNode => ({ kind: "simple", definitionId: id, name: id, value });
function policy(id: string, assignments: AssignmentTarget[], settings: Record<string, number>): RawPolicy {
  return {
    id,
    name: id,
    platform: "windows10",
    assignments,
    settings: Object.entries(settings).map(([def, value]) => ({
      settingDefinitionId: def,
      name: def,
      cspPath: `./${def}`,
      category: "C",
      value: String(value),
      structured: simple(def, value),
      schemas: { [def]: { definitionId: def, name: def, kind: "simple", valueType: "integer" } },
    })),
  };
}
function report(policies: RawPolicy[], groups?: GroupDirectory): ScanReport {
  const settings = buildSettingIndex(policies, groups);
  return {
    scannedAt: "2026-01-01T00:00:00.000Z",
    flow: "test",
    tenant: "contoso",
    policyCount: policies.length,
    legacyPolicyCount: 0,
    settingCount: settings.length,
    conflictCount: settings.filter((e) => e.conflict).length,
    belowBaselineCount: 0,
    settings,
    compliancePolicies: [],
    enrollmentConfigurations: [],
    ...(groups ? { groups } : {}),
  };
}
const NESTED: GroupDirectory = { available: true, names: {}, contains: { windows: ["pilot", "prod"] } };
// Rings: pilot defers 0 days, production 7; a tenant-wide policy sets something else for everyone;
// one policy is only for kiosks; one is for everyone but pilot.
const RINGS = report(
  [
    policy("ring-pilot", [group("pilot")], { defer: 0 }),
    policy("ring-prod", [group("prod")], { defer: 7 }),
    policy("everyone", [{ kind: "allDevices" }], { lock: 5 }),
    policy("kiosks", [group("kiosks")], { kioskmode: 1 }),
    policy("not-pilot", [{ kind: "allDevices" }, group("pilot", true)], { telemetry: 1 }),
    policy("windows-wide", [group("windows")], { firewall: 1 }),
    policy("draft", [], { lock: 9 }),
  ],
  NESTED,
);
const byKey = (r: ScanReport) => Object.fromEntries(r.settings.map((e) => [e.key.split("::")[0], e]));

test("scopeToGroup: tenant-wide, rings with different values are not a conflict and both values show", () => {
  const defer = byKey(RINGS).defer;
  assert.equal(defer.state, "Not checked");
  assert.deepEqual(defer.values, ["0", "7"]);
});

test("scopeToGroup: a group sees the policies assigned to it, to a group containing it, and to everyone — and only those", () => {
  const pilot = byKey(scopeToGroup(RINGS, "pilot"));
  assert.deepEqual(Object.keys(pilot).sort(), ["defer", "firewall", "lock"]);
  assert.deepEqual(pilot.defer.values, ["0"], "its own ring's value, not production's");
  assert.deepEqual(pilot.defer.sources.map((s) => s.policyName), ["ring-pilot"]);
  assert.deepEqual(pilot.firewall.sources.map((s) => s.policyName), ["windows-wide"], "reached through the parent group");
  assert.deepEqual(pilot.lock.sources.map((s) => s.policyName), ["everyone"], "the unassigned draft reaches no group");
  assert.equal("telemetry" in pilot, false, "excluded from that policy");
  assert.equal("kioskmode" in pilot, false, "another group's policy");

  const prod = byKey(scopeToGroup(RINGS, "prod"));
  assert.deepEqual(prod.defer.values, ["7"]);
  assert.equal("telemetry" in prod, true);
});

test("scopeToGroup: counts and conflicts are worked out again for the group", () => {
  const clash = report([
    policy("a", [group("pilot")], { x: 1 }),
    policy("b", [{ kind: "allDevices" }], { x: 2 }),
    policy("c", [group("prod")], { x: 3 }),
  ]);
  const pilot = scopeToGroup(clash, "pilot");
  assert.equal(pilot.settings[0].state, "Conflict");
  assert.deepEqual(pilot.settings[0].values, ["1", "2"], "production's value is not part of pilot's conflict");
  assert.equal(pilot.conflictCount, 1);

  const kiosks = scopeToGroup(clash, "kiosks");
  assert.equal(kiosks.settings[0].state, "Not checked", "only the tenant-wide policy reaches it");
  assert.equal(kiosks.conflictCount, 0);
  assert.equal(kiosks.settingCount, 1);
});

test("scopeToGroup: baselines applied afterwards judge the group's own value, and report what it lacks as Missing for it", () => {
  const rule = (def: string, value: number, compare: BaselineRule["compare"] = "exact"): BaselineRule => ({
    id: `b::${def}`,
    pack: "b/1",
    source: "B",
    policyName: "P",
    definitionId: def,
    platform: "windows10",
    expected: simple(def, value),
    compare,
  });
  const rules = [rule("defer", 3, "atMost"), rule("kioskmode", 1)];

  const state = (r: ScanReport, def: string) => applyBaselinesToReport(r, rules).settings.find((e) => e.definitionId === def)!.state;
  assert.equal(state(scopeToGroup(RINGS, "pilot"), "defer"), "Meets baseline", "pilot defers 0 days");
  assert.equal(state(scopeToGroup(RINGS, "prod"), "defer"), "Below baseline", "production defers 7");
  assert.equal(state(RINGS, "defer"), "Below baseline", "tenant-wide: met only if every assigned value meets it");
  assert.equal(state(scopeToGroup(RINGS, "kiosks"), "kioskmode"), "Meets baseline");
  assert.equal(state(scopeToGroup(RINGS, "pilot"), "kioskmode"), "Missing", "nothing aimed at pilot sets it");
  // ...and it keeps its real name and path: the tenant knows the setting, just not for this group.
  const named = report([policy("k", [group("kiosks")], { kioskmode: 1 })]);
  named.settings[0].name = "Kiosk mode";
  named.settings[0].schemas!.kioskmode.name = "Kiosk mode";
  const missing = applyBaselinesToReport(scopeToGroup(named, "pilot"), rules).settings.find((e) => e.definitionId === "kioskmode")!;
  assert.deepEqual([missing.state, missing.name, missing.cspPath], ["Missing", "Kiosk mode", "./kioskmode"]);
});

test("scopeToGroup: a scan stored before targets were kept can't place its policies — they are left out", () => {
  const old = report([policy("a", [group("pilot")], { x: 1 })]);
  for (const entry of old.settings) for (const source of entry.sources) delete source.targets;
  assert.deepEqual(scopeToGroup(old, "pilot").settings, []);
});

test("scopeToGroup: compliance and enrollment policies are kept only if they reach the group", () => {
  const base = report([policy("a", [group("pilot")], { x: 1 })], NESTED);
  const simplePolicy = (id: string, targets?: AssignmentTarget[]) => ({ id, name: id, platform: "windows10", deployed: Boolean(targets?.length), ...(targets ? { targets } : {}) });
  const withPolicies: ScanReport = {
    ...base,
    compliancePolicies: [
      simplePolicy("for-pilot", [group("pilot")]),
      simplePolicy("for-prod", [group("prod")]),
      simplePolicy("for-everyone", [{ kind: "allLicensedUsers" }]),
      simplePolicy("via-parent", [group("windows")]),
      simplePolicy("everyone-but-pilot", [{ kind: "allDevices" }, group("pilot", true)]),
      simplePolicy("unassigned", []),
      simplePolicy("from-an-older-scan"),
    ],
    enrollmentConfigurations: [simplePolicy("enroll-prod", [group("prod")]), simplePolicy("enroll-all", [{ kind: "allDevices" }])],
  };
  const pilot = scopeToGroup(withPolicies, "pilot");
  assert.deepEqual(pilot.compliancePolicies.map((p) => p.id), ["for-pilot", "for-everyone", "via-parent"]);
  assert.deepEqual(pilot.enrollmentConfigurations.map((p) => p.id), ["enroll-all"]);
});
