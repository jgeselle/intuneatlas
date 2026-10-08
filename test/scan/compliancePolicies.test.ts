import assert from "node:assert/strict";
import { test } from "node:test";
import type { BaselineRule } from "../../src/baselines/types.js";
import { fetchCompliancePolicies } from "../../src/scan/compliancePolicies.js";
import { complianceSettingsOf } from "../../src/scan/complianceSettings.js";
import { buildSettingIndex } from "../../src/scan/index.js";
import { applyBaselinesToReport, type ScanReport } from "../../src/scan/report.js";
import { scopeToGroup } from "../../src/scan/scope.js";
import type { AssignmentTarget, RawPolicy } from "../../src/scan/types.js";

const WINDOWS = "#microsoft.graph.windows10CompliancePolicy";
const LENGTH = "compliance.windows10.passwordMinimumLength";
const BITLOCKER = "compliance.windows10.bitLockerEnabled";
const group = (groupId: string): AssignmentTarget => ({ kind: "group", groupId, excluded: false });

function compliancePolicy(id: string, assignments: AssignmentTarget[], properties: Record<string, unknown>): RawPolicy {
  return { id, name: id, platform: "windows10", assignments, settings: complianceSettingsOf({ "@odata.type": WINDOWS, ...properties }) };
}
function report(policies: RawPolicy[]): ScanReport {
  const settings = buildSettingIndex(policies, undefined, { conflicts: false });
  return {
    scannedAt: "2026-01-01T00:00:00.000Z",
    flow: "test",
    tenant: "contoso.onmicrosoft.com",
    policyCount: 0,
    legacyPolicyCount: 0,
    settingCount: settings.length,
    conflictCount: 0,
    belowBaselineCount: 0,
    settings,
    compliancePolicies: [],
    enrollmentConfigurations: [],
  };
}
function rule(definitionId: string, properties: Record<string, unknown>, compare: BaselineRule["compare"] = "exact"): BaselineRule {
  const expected = complianceSettingsOf({ "@odata.type": WINDOWS, ...properties }).find((s) => s.settingDefinitionId === definitionId)!.structured!;
  return { id: `b::${definitionId}`, pack: "b/v1", source: "Baseline", policyName: "Compliance", definitionId, platform: "windows10", expected, compare };
}

test("fetchCompliancePolicies: keeps each policy's identity, and its configured settings alongside", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  let requested = "";
  global.fetch = (async (url: string | URL) => {
    requested = String(url);
    return new Response(
      JSON.stringify({
        value: [
          {
            "@odata.type": WINDOWS,
            id: "c1",
            displayName: "Windows compliance",
            passwordRequired: true,
            passwordMinimumLength: 12,
            bitLockerEnabled: false,
            assignments: [{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g1" } }],
          },
          { "@odata.type": "#microsoft.graph.iosCompliancePolicy", id: "c2", displayName: "Empty iOS policy", passcodeRequired: false, assignments: [] },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const { policies, settings } = await fetchCompliancePolicies("token");

  assert.match(requested, /\/beta\/deviceManagement\/deviceCompliancePolicies\?/);
  assert.deepEqual(
    policies.map((p) => [p.id, p.name, p.platform, p.deployed]),
    [
      ["c1", "Windows compliance", "windows10", true],
      ["c2", "Empty iOS policy", "ios", false],
    ],
  );
  // The policy that configures nothing has no settings to contribute.
  assert.equal(settings.length, 1);
  assert.equal(settings[0].id, "c1");
  assert.equal(settings[0].platform, "windows10");
  assert.deepEqual(settings[0].assignments, [{ kind: "group", groupId: "g1", excluded: false }]);
  assert.deepEqual(
    settings[0].settings.map((s) => [s.settingDefinitionId, s.value]),
    [
      ["compliance.windows10.passwordRequired", "Require"],
      [LENGTH, "12"],
    ],
  );
});

test("compliance settings: differing values for the same group are not a conflict — Intune applies each policy on its own", () => {
  const policies = [compliancePolicy("a", [group("g1")], { passwordMinimumLength: 8 }), compliancePolicy("b", [group("g1")], { passwordMinimumLength: 12 })];

  const [entry] = report(policies).settings;
  assert.equal(entry.key, `${LENGTH}::windows10`);
  assert.equal(entry.conflict, false);
  assert.equal(entry.state, "Not checked");
  assert.deepEqual(entry.values, ["8", "12"]);

  // The same pair as configuration settings would be one.
  assert.equal(buildSettingIndex(policies)[0].state, "Conflict");
  // And narrowing to the group works it out again the same way.
  assert.equal(scopeToGroup(report(policies), "g1").settings[0].state, "Not checked");
});

test("compliance settings: judged against a baseline like any other setting — every assigned value has to meet it", () => {
  const scanned = report([
    compliancePolicy("a", [group("g1")], { passwordMinimumLength: 8, bitLockerEnabled: true }),
    compliancePolicy("b", [group("g2")], { passwordMinimumLength: 14 }),
  ]);
  const judged = applyBaselinesToReport(scanned, [rule(LENGTH, { passwordMinimumLength: 12 }, "atLeast"), rule(BITLOCKER, { bitLockerEnabled: true })]);
  const byId = Object.fromEntries(judged.settings.map((e) => [e.definitionId, e]));

  assert.equal(byId[BITLOCKER].state, "Meets baseline");
  assert.equal(byId[LENGTH].state, "Below baseline"); // one of the two policies asks for only 8
  assert.equal(byId[LENGTH].recs[0].recommended, "12");

  const g2 = applyBaselinesToReport(scopeToGroup(scanned, "g2"), [rule(LENGTH, { passwordMinimumLength: 12 }, "atLeast"), rule(BITLOCKER, { bitLockerEnabled: true })]);
  const forG2 = Object.fromEntries(g2.settings.map((e) => [e.definitionId, e]));
  assert.equal(forG2[LENGTH].state, "Meets baseline");
  assert.equal(forG2[BITLOCKER].state, "Missing"); // g2's policy doesn't ask for it
});

test("compliance settings: add up — a policy that meets the baseline makes up for one, for the same devices, that asks for less", () => {
  const atLeast12 = [rule(LENGTH, { passwordMinimumLength: 12 }, "atLeast")];
  const stateOf = (r: ScanReport) => applyBaselinesToReport(r, atLeast12).settings[0].state;

  // Both for the same group: a device there must satisfy both, so 14 is what holds.
  assert.equal(stateOf(report([compliancePolicy("a", [group("g1")], { passwordMinimumLength: 8 }), compliancePolicy("b", [group("g1")], { passwordMinimumLength: 14 })])), "Meets baseline");

  // Different groups: g1's devices are only asked for 8.
  const rings = report([compliancePolicy("a", [group("g1")], { passwordMinimumLength: 8 }), compliancePolicy("b", [group("g2")], { passwordMinimumLength: 14 })]);
  assert.equal(stateOf(rings), "Below baseline");

  // Narrowed to a group that gets both (one via everyone, one directly), the stricter one holds.
  const layered = report([compliancePolicy("a", [{ kind: "allDevices" }], { passwordMinimumLength: 8 }), compliancePolicy("b", [group("g2")], { passwordMinimumLength: 14 })]);
  assert.equal(stateOf(layered), "Below baseline"); // tenant-wide: devices outside g2 are only asked for 8
  assert.equal(stateOf(scopeToGroup(layered, "g2")), "Meets baseline");
  assert.equal(stateOf(scopeToGroup(layered, "g3")), "Below baseline");

  // Configuration settings don't add up: every assigned value has to meet the baseline.
  const asConfiguration = (value: number) => ({ settingDefinitionId: "x", name: "x", cspPath: "", category: "C", value: String(value), structured: { kind: "simple" as const, definitionId: "x", name: "x", value }, schemas: { x: { definitionId: "x", name: "x", kind: "simple" as const, valueType: "integer" as const } } });
  const configuration = { ...report([]), settings: buildSettingIndex([{ id: "a", name: "a", platform: "windows10", assignments: [group("g1")], settings: [asConfiguration(8)] }, { id: "b", name: "b", platform: "windows10", assignments: [group("g2")], settings: [asConfiguration(14)] }]) };
  const xRule: BaselineRule = { id: "b::x", pack: "b/v1", source: "Baseline", policyName: "P", definitionId: "x", platform: "windows10", expected: { kind: "simple", definitionId: "x", name: "x", value: 12 }, compare: "atLeast" };
  assert.equal(applyBaselinesToReport(configuration, [xRule]).settings[0].state, "Below baseline");
});

test("compliance settings: one a baseline expects and no policy has is Missing, already named — no Graph lookup needed", () => {
  const judged = applyBaselinesToReport(report([]), [rule("compliance.windows10.secureBootEnabled", { secureBootEnabled: true })]);

  assert.equal(judged.settings.length, 1);
  const [missing] = judged.settings;
  assert.equal(missing.state, "Missing");
  assert.equal(missing.name, "Secure boot enabled");
  assert.equal(missing.category, "Device health");
  assert.equal(missing.cspPath, "windows10CompliancePolicy/secureBootEnabled");
  assert.equal(missing.checks?.[0].expected, "Require");
  assert.deepEqual(Object.keys(missing.schemas ?? {}), ["compliance.windows10.secureBootEnabled"]);
});
