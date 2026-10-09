import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ViewerIdentity } from "../../src/auth/webSession.js";
import type { SettingIndexEntry } from "../../src/scan/types.js";

// Storage lives under the home directory, fixed when its module loads — point that at a scratch folder first.
const home = mkdtempSync(join(tmpdir(), "intuneatlas-push-test-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { getDb } = await import("../../src/storage/db.js");
const { stageChange, updateReviewer, getAllChanges } = await import("../../src/storage/changes.js");
const { getSettingHistory } = await import("../../src/storage/history.js");
const { applyPush } = await import("../../src/push/apply.js");
const { PushRefused } = await import("../../src/push/values.js");
const { complianceSettingsOf } = await import("../../src/scan/complianceSettings.js");
after(() => {
  getDb().close();
  rmSync(home, { recursive: true, force: true });
});

const WINDOWS = "#microsoft.graph.windows10CompliancePolicy";
const LEN = "compliance.windows10.passwordMinimumLength";
const admin: ViewerIdentity = { id: "oid-alex", name: "Alex Meyer", email: "alex@x.com", role: "admin" };
const lengthNode = (n: number) => complianceSettingsOf({ "@odata.type": WINDOWS, passwordMinimumLength: n })[0].structured!;

/** A tenant with one compliance policy; records what is written to it. */
function fakeTenant(t: { after: (fn: () => void) => void }, policy: Record<string, unknown>) {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  global.fetch = (async (input: string | URL, init?: RequestInit) => {
    const path = decodeURIComponent(String(input)).replace("https://graph.microsoft.com/beta", "");
    const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (init?.method && init.method !== "GET") {
      writes.push({ method: init.method, path, body: JSON.parse(String(init.body)) });
      return init.method === "POST" ? json(201, { id: "created-id" }) : json(204, null);
    }
    return path.startsWith("/deviceManagement/deviceCompliancePolicies/c1") ? json(200, policy) : json(404, {});
  }) as typeof fetch;
  return writes;
}

function reportWith(value: number): { settings: SettingIndexEntry[] } {
  return {
    settings: [
      {
        key: `${LEN}::windows10`,
        name: "Minimum password length",
        cspPath: "",
        category: "System Security",
        platform: "windows10",
        values: [String(value)],
        sources: [{ policyId: "c1", policyName: "Windows compliance", value: String(value), deployed: true, structured: lengthNode(value) }],
        conflict: false,
        state: "Not checked",
        definitionId: LEN,
        recs: [],
      },
    ],
  };
}

test("applyPush: writes the change, records who and why in the setting's history, closes the staged change, and brings the report up to date", async (t) => {
  const writes = fakeTenant(t, { "@odata.type": WINDOWS, id: "c1", displayName: "Windows compliance", passwordMinimumLength: 8 });
  const staged = stageChange(
    { targetKey: `${LEN}::windows10::c1`, targetName: "Minimum password length", settingKey: `${LEN}::windows10`, policyId: "c1", policyName: "Windows compliance", ruleId: "r", from: "8", to: "14", toStructured: lengthNode(14), reason: "Baseline asks for 14." },
    "oid-sam",
    "Sam Okafor",
  );

  // Staged with a reason but not reviewed: not ready, nothing is written.
  await assert.rejects(applyPush(staged.id, "write-token", admin, reportWith(8), "contoso"), PushRefused);
  assert.deepEqual(writes, []);

  updateReviewer(staged.id, "Alex Meyer");
  const result = await applyPush(staged.id, "write-token", admin, reportWith(8), "contoso");

  assert.deepEqual(writes, [{ method: "PATCH", path: "/deviceManagement/deviceCompliancePolicies/c1", body: { "@odata.type": WINDOWS, passwordMinimumLength: 14 } }]);
  assert.deepEqual([result.closed.map((c) => c.id), result.policyName, result.created], [[staged.id], "Windows compliance", false]);
  assert.deepEqual(getAllChanges(), {});

  const [entry] = getSettingHistory("contoso", `${LEN}::windows10`);
  assert.deepEqual(
    [entry.kind, entry.policyId, entry.from, entry.to, entry.pushedBy, entry.stagedBy, entry.reviewedBy, entry.reason],
    ["pushed", "c1", "8", "14", "Alex Meyer", "Sam Okafor", "Alex Meyer", "Baseline asks for 14."],
  );

  const [setting] = (result.report as { settings: SettingIndexEntry[] }).settings;
  assert.deepEqual([setting.values, setting.sources[0].value, setting.sources[0].structured], [["14"], "14", lengthNode(14)]);
});

test("applyPush: when the tenant refuses or the value has moved on, the change stays staged and nothing is recorded", async (t) => {
  const writes = fakeTenant(t, { "@odata.type": WINDOWS, id: "c1", displayName: "Windows compliance", passwordMinimumLength: 10 });
  const staged = stageChange(
    { targetKey: `${LEN}::windows10::c1`, targetName: "Minimum password length", settingKey: `${LEN}::windows10`, policyId: "c1", policyName: "Windows compliance", ruleId: "r", from: "14", to: "16", toStructured: lengthNode(16), reason: "More." },
    "oid-sam",
    "Sam Okafor",
  );
  updateReviewer(staged.id, "Alex Meyer");
  const historyBefore = getSettingHistory("contoso", `${LEN}::windows10`).length;

  await assert.rejects(applyPush(staged.id, "write-token", admin, reportWith(14), "contoso"), (err: Error) => err instanceof PushRefused && /it is now "10"/.test(err.message));

  assert.deepEqual(writes, []);
  assert.equal(Object.keys(getAllChanges()).length, 1);
  assert.equal(getSettingHistory("contoso", `${LEN}::windows10`).length, historyBefore);
});

test("applyPush: a new policy is created from every setting staged under its name — none of them is pushed alone", async (t) => {
  for (const change of Object.values(getAllChanges())) (await import("../../src/storage/changes.js")).revertChange(change.id);
  const writes = fakeTenant(t, {});
  const stageNew = (property: string, value: unknown) => {
    const [setting] = complianceSettingsOf({ "@odata.type": WINDOWS, [property]: value });
    // Staged from Missing settings: their key says so, and there is no policy yet.
    return stageChange(
      { targetKey: `uncovered::${setting.settingDefinitionId}::windows10::new::x`, targetName: setting.name, settingKey: `uncovered::${setting.settingDefinitionId}::windows10`, policyName: "Baseline – Compliance", targetKind: "new", ruleId: "r", from: "Not configured", to: setting.value, toStructured: setting.structured, reason: "Baseline." },
      "oid-sam",
      "Sam Okafor",
    );
  };
  const bitLocker = stageNew("bitLockerEnabled", true);
  const tpm = stageNew("tpmRequired", true);
  updateReviewer(bitLocker.id, "Alex Meyer");

  // One of the two isn't reviewed yet: the policy isn't created with half its settings.
  await assert.rejects(applyPush(bitLocker.id, "write-token", admin, { settings: [] }, "contoso"), (err: Error) => err instanceof PushRefused && /1 of them still needs/.test(err.message));
  assert.equal(writes.length, 0);

  updateReviewer(tpm.id, "Alex Meyer");
  const result = await applyPush(tpm.id, "write-token", admin, { settings: [] }, "contoso");

  assert.equal(writes.length, 1);
  assert.deepEqual([writes[0].method, writes[0].path, writes[0].body.displayName, writes[0].body.bitLockerEnabled, writes[0].body.tpmRequired], ["POST", "/deviceManagement/deviceCompliancePolicies", "Baseline – Compliance", true, true]);
  assert.deepEqual([result.created, result.closed.length, result.report], [true, 2, undefined]);
  assert.deepEqual(getAllChanges(), {});
  // Recorded under the key the setting will have once a scan finds it in the new policy, with the id Intune gave that policy.
  const [entry] = getSettingHistory("contoso", "compliance.windows10.tpmRequired::windows10");
  assert.deepEqual([entry.kind, entry.policyId, entry.policyName, entry.from, entry.to], ["pushed", "created-id", "Baseline – Compliance", undefined, "Require"]);
});

test("applyPush: a staged removal takes the setting out, records it as now not configured, and drops it from the report", async (t) => {
  const writes = fakeTenant(t, { "@odata.type": WINDOWS, id: "c1", displayName: "Windows compliance", passwordMinimumLength: 14 });
  const staged = stageChange(
    { targetKey: `${LEN}::windows10::c1`, targetName: "Minimum password length", settingKey: `${LEN}::windows10`, policyId: "c1", policyName: "Windows compliance", ruleId: "manual", from: "14", to: "Not configured", toStructured: { kind: "removed", definitionId: LEN, name: "Minimum password length" }, reason: "Covered by the new baseline policy." },
    "oid-sam",
    "Sam Okafor",
  );
  updateReviewer(staged.id, "Alex Meyer");

  const result = await applyPush(staged.id, "write-token", admin, reportWith(14), "contoso");

  assert.deepEqual(writes, [{ method: "PATCH", path: "/deviceManagement/deviceCompliancePolicies/c1", body: { "@odata.type": WINDOWS, passwordMinimumLength: null } }]);
  // No policy sets it any more: it is no longer in the list.
  assert.deepEqual((result.report as { settings: unknown[] }).settings, []);
  const [entry] = getSettingHistory("contoso", `${LEN}::windows10`);
  assert.deepEqual([entry.kind, entry.from, entry.to, entry.reason], ["pushed", "14", "Not configured", "Covered by the new baseline policy."]);
});
