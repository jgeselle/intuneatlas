import assert from "node:assert/strict";
import { test } from "node:test";
import type { BaselineRule } from "../../src/baselines/types.js";
import { buildCheckResult, finding, formatCsv, formatText, resolveGroup, scannedLabel } from "../../src/commands/checkResult.js";
import { searchCsv, searchText } from "../../src/commands/search.js";
import { buildSettingIndex } from "../../src/scan/index.js";
import { applyBaselinesToReport, type ScanReport } from "../../src/scan/report.js";
import { scopeToGroup } from "../../src/scan/scope.js";
import type { AssignmentTarget, GroupDirectory, RawPolicy } from "../../src/scan/types.js";

const group = (groupId: string): AssignmentTarget => ({ kind: "group", groupId, excluded: false });
function policy(id: string, name: string, assignments: AssignmentTarget[], settings: Record<string, number>): RawPolicy {
  return {
    id,
    name,
    platform: "windows10",
    assignments,
    settings: Object.entries(settings).map(([def, value]) => ({
      settingDefinitionId: def,
      name: `Setting ${def}`,
      cspPath: `./${def}`,
      category: "Updates",
      value: String(value),
      structured: { kind: "simple" as const, definitionId: def, name: `Setting ${def}`, value },
      schemas: { [def]: { definitionId: def, name: `Setting ${def}`, kind: "simple" as const, valueType: "integer" as const } },
    })),
  };
}
const GROUPS: GroupDirectory = { available: true, names: { pilot: "Pilot ring", prod: "Production ring" }, contains: {} };
const rule = (definitionId: string, value: number): BaselineRule => ({
  id: `b::${definitionId}`,
  pack: "check/OIB",
  source: "OIB Windows",
  policyName: "Baseline policy",
  definitionId,
  platform: "windows10",
  expected: { kind: "simple", definitionId, name: definitionId, value },
  compare: "exact",
});
function scan(): ScanReport {
  const policies = [
    policy("p1", "Pilot updates", [group("pilot")], { defer: 14, hours: 8 }),
    policy("p2", "Pilot overrides", [group("pilot")], { hours: 9 }),
    policy("p3", "Production updates", [group("prod")], { defer: 7, extra: 1 }),
    policy("p4", "Draft", [], { draft: 1 }),
  ];
  const settings = buildSettingIndex(policies, GROUPS);
  return { scannedAt: "2026-01-01T00:00:00.000Z", flow: "test", tenant: "contoso.onmicrosoft.com", tenantName: "Contoso Ltd", policyCount: 4, legacyPolicyCount: 0, settingCount: settings.length, conflictCount: 0, belowBaselineCount: 0, settings, compliancePolicies: [], enrollmentConfigurations: [], groups: GROUPS };
}
const RULES = [rule("defer", 7), rule("extra", 1), rule("missing", 1)];
const baselines = [{ name: "OIB Windows", settings: 3, policies: 1 }];

test("check: the same six states the web UI shows, for one group — and it fails when something needs attention", () => {
  const report = scan();
  const pilot = resolveGroup(report, "pilot ring");
  const result = buildCheckResult(applyBaselinesToReport(scopeToGroup(report, pilot.id), RULES), { group: pilot, baselines });

  // For the pilot ring: defer is 14 where the baseline says 7; "hours" is set twice, differently; "extra" and
  // "missing" aren't aimed at this group at all. Production's own settings don't come into it.
  assert.deepEqual(result.counts, { "Below baseline": 1, Conflict: 1, Missing: 2, "Not assigned": 0, "Meets baseline": 0, "Not checked": 0 });
  assert.equal(result.failed, true);
  assert.deepEqual(result.settings.map((s) => [s.state, s.name]), [
    ["Below baseline", "Setting defer"],
    ["Conflict", "Setting hours"],
    // Within a state, in the UI's own order: by category, then name.
    ["Missing", "missing"],
    ["Missing", "Setting extra"],
  ]);
  assert.deepEqual(result.settings[0].policies, [{ name: "Pilot updates", value: "14", assigned: true, assignedTo: "Pilot ring" }]);
  assert.deepEqual(result.settings[0].expected, [{ baseline: "OIB Windows", policy: "Baseline policy", value: "7", met: false }]);

  // Production meets it where it is checked; the group that needs nothing done doesn't fail.
  const prod = buildCheckResult(applyBaselinesToReport(scopeToGroup(report, "prod"), [rule("defer", 7), rule("extra", 1)]), { group: resolveGroup(report, "prod"), baselines });
  assert.deepEqual([prod.counts["Meets baseline"], prod.failed, prod.settings], [2, false, []]);
});

test("check: without a group it is the whole tenant, and --all lists every setting", () => {
  const judged = applyBaselinesToReport(scan(), RULES);
  const attention = buildCheckResult(judged, { baselines });
  assert.equal(attention.group, undefined);
  assert.deepEqual(attention.counts, { "Below baseline": 1, Conflict: 1, Missing: 1, "Not assigned": 1, "Meets baseline": 1, "Not checked": 0 });
  assert.deepEqual(attention.settings.map((s) => s.state), ["Below baseline", "Conflict", "Missing"]);
  assert.deepEqual(buildCheckResult(judged, { baselines, all: true }).settings.map((s) => s.state), ["Below baseline", "Conflict", "Missing", "Not assigned", "Meets baseline"]);
});

test("check: a group is given by name or id — and a wrong one is answered with the groups there are", () => {
  const report = scan();
  assert.deepEqual(resolveGroup(report, "Pilot ring"), { id: "pilot", name: "Pilot ring" });
  assert.deepEqual(resolveGroup(report, "prod"), { id: "prod", name: "Production ring" });
  assert.throws(() => resolveGroup(report, "Sales"), /No policy is assigned to a group called "Sales"\. Groups policies are assigned to: Pilot ring, Production ring\./);
  // Where the scan couldn't read group names, only an id will do — and the message says why.
  const nameless = { ...report, groups: { available: false, names: {}, contains: {} } };
  assert.deepEqual(resolveGroup(nameless, "pilot"), { id: "pilot", name: "pilot" });
  assert.throws(() => resolveGroup(nameless, "Pilot ring"), /Group\.Read\.All/);
  // Two groups with one name.
  const twins = { ...report, groups: { ...GROUPS, names: { pilot: "Ring", prod: "Ring" } } };
  assert.throws(() => resolveGroup(twins, "ring"), /2 groups are named "ring"/);
});

test("check: as text for a terminal, and as rows for a spreadsheet", () => {
  const report = scan();
  const pilot = resolveGroup(report, "pilot");
  const result = buildCheckResult(applyBaselinesToReport(scopeToGroup(report, "pilot"), RULES), { group: pilot, baselines });

  assert.equal(
    formatText(result),
    [
      "Contoso Ltd · Pilot ring",
      `Scanned ${scannedLabel("2026-01-01T00:00:00.000Z")}`,
      "Baseline: OIB Windows — 3 settings in 1 policy",
      "",
      "  Below baseline      1",
      "  Conflict            1",
      "  Missing             2",
      "  Not assigned        0",
      "  Meets baseline      0",
      "  Not checked         0",
      "",
      "BELOW BASELINE",
      "  Setting defer  (windows10 · Updates)",
      "    Pilot updates [Pilot ring]: 14",
      "    expected by OIB Windows: 7",
      "",
      "CONFLICT",
      "  Setting hours  (windows10 · Updates)",
      "    Pilot updates [Pilot ring]: 8",
      "    Pilot overrides [Pilot ring]: 9",
      "",
      "MISSING",
      "  missing  (windows10 · Other)",
      "    expected by OIB Windows: 1",
      "  Setting extra  (windows10 · Updates)",
      "    expected by OIB Windows: 1",
      "",
    ].join("\n"),
  );
  assert.deepEqual(formatCsv(result).split("\n").slice(0, 3), [
    "state,name,platform,category,policies,values,baseline,expected",
    "Below baseline,Setting defer,windows10,Updates,Pilot updates,14,OIB Windows,7",
    "Conflict,Setting hours,windows10,Updates,Pilot updates | Pilot overrides,8 | 9,,",
  ]);
});

test("check and search: who a policy reaches is said in words — everyone, groups by name, exclusions, or nobody", () => {
  const report = scan();
  const entry = { ...report.settings.find((e) => e.key === "defer::windows10")! };
  const targets = (list: AssignmentTarget[]) => finding({ ...entry, sources: [{ ...entry.sources[0], targets: list }] }, GROUPS).policies[0].assignedTo;

  assert.equal(targets([{ kind: "allDevices" }]), "All devices");
  assert.equal(targets([{ kind: "allLicensedUsers", filtered: true }]), "All users (filtered)");
  assert.equal(targets([group("pilot"), group("prod")]), "Pilot ring, Production ring");
  assert.equal(targets([{ kind: "allDevices" }, { kind: "group", groupId: "pilot", excluded: true }]), "All devices, except Pilot ring");
  assert.equal(targets([]), "not assigned");
  assert.equal(targets([group("unknown-id")]), "unknown-id");
});

test("search: each match with its state, its path, and its policies; one row per policy as CSV", () => {
  const judged = applyBaselinesToReport(scan(), RULES);
  const settings = judged.settings.filter((e) => ["defer::windows10", "draft::windows10"].includes(e.key)).map((e) => finding(e, judged.groups));

  assert.equal(
    searchText({ tenant: "Contoso Ltd", scannedAt: "2026-01-01T00:00:00.000Z", query: "d" }, settings),
    [
      "Contoso Ltd · all policies",
      `Scanned ${scannedLabel("2026-01-01T00:00:00.000Z")}`,
      '2 settings matching "d"',
      "",
      "  Setting defer  (windows10 · Updates)  Below baseline",
      "    ./defer",
      "    Pilot updates [Pilot ring]: 14",
      "    Production updates [Production ring]: 7",
      "    expected by OIB Windows: 7",
      "",
      "  Setting draft  (windows10 · Updates)  Not assigned",
      "    ./draft",
      "    Draft [not assigned]: 1",
      "",
    ].join("\n"),
  );
  assert.deepEqual(searchCsv(settings).trim().split("\n"), [
    "state,name,platform,category,path,policy,assigned to,value,expected",
    "Below baseline,Setting defer,windows10,Updates,./defer,Pilot updates,Pilot ring,14,OIB Windows: 7",
    "Below baseline,Setting defer,windows10,Updates,./defer,Production updates,Production ring,7,OIB Windows: 7",
    "Not assigned,Setting draft,windows10,Updates,./draft,Draft,not assigned,1,",
  ]);
});
