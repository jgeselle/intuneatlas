import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchVisiblePolicies, restrictToPolicies } from "../../src/scan/visibility.js";
import type { SettingIndexEntry, SettingIndexSource } from "../../src/scan/types.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, statusText: status === 403 ? "Forbidden" : "OK", headers: { "content-type": "application/json" } });

test("fetchVisiblePolicies: asks with the viewer's token for ids only; a kind their role can't read is simply none", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const asked: string[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    asked.push(u);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer viewer-token");
    if (u.includes("/configurationPolicies?")) return json({ value: [{ id: "cat-1" }, { id: "cat-2" }] });
    if (u.includes("/deviceConfigurations?")) return json({ value: [{ id: "legacy-1" }] });
    if (u.includes("/deviceCompliancePolicies?")) return json({ value: [{ id: "comp-1" }] });
    // This viewer's Intune role has no rights on enrollment, Linux compliance or tenant-wide settings.
    return json({ error: { code: "Forbidden" } }, 403);
  }) as typeof fetch;

  const visible = await fetchVisiblePolicies("viewer-token");
  assert.deepEqual([...visible.entries()].sort(), [
    ["cat-1", "catalog"],
    ["cat-2", "catalog"],
    ["comp-1", "compliance"],
    ["legacy-1", "legacy"],
  ]);
  assert.ok(asked.filter((u) => !u.endsWith("/deviceManagement/settings")).every((u) => u.includes("$select=id")), "ids only");
});

const source = (policyId: string, value: string): SettingIndexSource => ({ policyId, policyName: policyId, value, deployed: true, targets: [{ kind: "allDevices" }] });
const entry = (key: string, sources: SettingIndexSource[], extra: Partial<SettingIndexEntry> = {}): SettingIndexEntry => ({
  key,
  name: key,
  cspPath: "",
  category: "",
  platform: "windows10",
  values: [...new Set(sources.map((s) => s.value))],
  sources,
  conflict: new Set(sources.map((s) => s.value)).size > 1,
  state: new Set(sources.map((s) => s.value)).size > 1 ? "Conflict" : "Not checked",
  recs: [],
  ...extra,
});

test("restrictToPolicies: a viewer sees their policies only, judged from those alone", () => {
  const report = {
    settings: [
      // Seattle's policy and Headquarters' disagree: a conflict for whoever sees both, not for Seattle's admin.
      entry("camera::windows10", [source("seattle", "Block"), source("hq", "Allow")]),
      entry("bluetooth::windows10", [source("hq", "Block")]),
      entry("compliance.windows10.passwordRequired::windows10", [source("comp-seattle", "Yes"), source("comp-hq", "No")], { conflict: false, state: "Not checked" }),
    ],
    compliancePolicies: [{ id: "comp-seattle" }, { id: "comp-hq" }],
    enrollmentConfigurations: [{ id: "enroll-hq" }],
    changes: { "camera::windows10::hq": { policyId: "hq" }, "camera::windows10::seattle": { policyId: "seattle" }, "camera::windows10::new": { policyId: "" } },
    policyCount: 2,
    legacyPolicyCount: 0,
    settingCount: 3,
    conflictCount: 1,
  };
  const visible = new Map([
    ["seattle", "catalog"],
    ["comp-seattle", "compliance"],
  ] as const);

  const narrowed = restrictToPolicies(report, visible);
  assert.deepEqual(narrowed.settings.map((e) => e.key), ["camera::windows10", "compliance.windows10.passwordRequired::windows10"]);
  const camera = narrowed.settings[0];
  assert.deepEqual(camera.sources.map((s) => s.policyId), ["seattle"]);
  assert.deepEqual([camera.values, camera.conflict, camera.state], [["Block"], false, "Not checked"]);
  assert.deepEqual(narrowed.compliancePolicies, [{ id: "comp-seattle" }]);
  assert.deepEqual(narrowed.enrollmentConfigurations, []);
  assert.deepEqual(Object.keys(narrowed.changes).sort(), ["camera::windows10::new", "camera::windows10::seattle"]);
  assert.deepEqual([narrowed.policyCount, narrowed.settingCount, narrowed.conflictCount], [1, 2, 0]);
});

test("restrictToPolicies: someone who sees everything gets the report exactly as it was", () => {
  const report = { settings: [entry("camera::windows10", [source("a", "Block"), source("b", "Allow")])], policyCount: 2, settingCount: 1, conflictCount: 1 };
  const narrowed = restrictToPolicies(report, new Map([["a", "catalog"], ["b", "catalog"]] as const));
  assert.deepEqual(narrowed, report);
});
