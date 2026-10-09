import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ScanReport } from "../../src/scan/report.js";
import type { SettingIndexEntry } from "../../src/scan/types.js";

// The database lives under the home directory, fixed when the storage module loads — so the home
// directory is pointed at a scratch folder first, and the modules are loaded only after that.
const home = mkdtempSync(join(tmpdir(), "intuneatlas-history-test-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { getDb } = await import("../../src/storage/db.js");
const { recordScan } = await import("../../src/storage/scans.js");
const { getSettingHistory, recordPushedChange } = await import("../../src/storage/history.js");
after(() => {
  getDb().close();
  rmSync(home, { recursive: true, force: true });
});

function entry(key: string, sources: Array<[policyId: string, value: string, deployed?: boolean]>): SettingIndexEntry {
  return {
    key,
    name: key,
    cspPath: "",
    category: "C",
    platform: "windows10",
    values: sources.map(([, value]) => value),
    sources: sources.map(([policyId, value, deployed = true]) => ({ policyId, policyName: `Policy ${policyId}`, value, deployed })),
    conflict: false,
    state: "Not checked",
    definitionId: key,
    recs: [],
  };
}
function scan(tenant: string, scannedAt: string, settings: SettingIndexEntry[]): ScanReport {
  return { scannedAt, flow: "test", tenant, policyCount: 1, legacyPolicyCount: 0, settingCount: settings.length, conflictCount: 0, belowBaselineCount: 0, settings, compliancePolicies: [], enrollmentConfigurations: [] };
}

test("history: scans stored before history existed are turned into it once, each tenant on its own", () => {
  const db = getDb();
  // Three scans of one tenant and one of another, recorded as an older version would have: no history rows, no marker.
  recordScan(scan("contoso", "2026-01-01T08:00:00.000Z", [entry("defer", [["p1", "14"]])]));
  recordScan(scan("fabrikam", "2026-01-02T08:00:00.000Z", [entry("defer", [["x1", "30"]])]));
  recordScan(scan("contoso", "2026-01-03T08:00:00.000Z", [entry("defer", [["p1", "7"]])]));
  recordScan(scan("contoso", "2026-01-05T08:00:00.000Z", [entry("defer", [["p1", "7"], ["p2", "0"]])]));
  db.exec("DELETE FROM setting_history; DELETE FROM config WHERE key = 'history_backfilled';");

  const history = getSettingHistory("contoso", "defer");

  assert.deepEqual(
    history.map((e) => [e.at, e.since, e.kind, e.policyName, e.from, e.to]),
    [
      ["2026-01-05T08:00:00.000Z", "2026-01-03T08:00:00.000Z", "added", "Policy p2", undefined, "0"],
      ["2026-01-03T08:00:00.000Z", "2026-01-01T08:00:00.000Z", "changed", "Policy p1", "14", "7"],
    ],
  );
  // The other tenant's single scan has nothing before it, and isn't compared with contoso's.
  assert.deepEqual(getSettingHistory("fabrikam", "defer"), []);
  // Asking again doesn't build it twice.
  assert.equal(getSettingHistory("contoso", "defer").length, 2);
});

test("history: each new scan adds what changed since the tenant's last one", () => {
  recordScan(scan("contoso", "2026-01-08T08:00:00.000Z", [entry("defer", [["p1", "7", false]]), entry("tamper", [["p3", "Enabled"]])]));

  assert.deepEqual(
    getSettingHistory("contoso", "defer").slice(0, 2).map((e) => [e.at, e.kind, e.policyName, e.from]),
    [
      ["2026-01-08T08:00:00.000Z", "removed", "Policy p2", "0"],
      ["2026-01-08T08:00:00.000Z", "unassigned", "Policy p1", undefined],
    ],
  );
  assert.deepEqual(
    getSettingHistory("contoso", "tamper").map((e) => [e.kind, e.to]),
    [["added", "Enabled"]],
  );

  // A scan with nothing different records nothing.
  recordScan(scan("contoso", "2026-01-09T08:00:00.000Z", [entry("defer", [["p1", "7", false]]), entry("tamper", [["p3", "Enabled"]])]));
  assert.equal(getSettingHistory("contoso", "defer").length, 4);
  assert.equal(getSettingHistory("contoso", "tamper").length, 1);
});

test("history: a pushed change is recorded first-hand with who and why, and the scan that sees it confirms it instead of repeating it", () => {
  // As the write action will call it, once Graph has accepted the change.
  recordPushedChange({
    tenant: "contoso",
    settingKey: "tamper",
    policyId: "p3",
    policyName: "Policy p3",
    from: "Enabled",
    to: "Disabled",
    pushedBy: "Alex Meyer",
    stagedBy: "Sam Okafor",
    reviewedBy: "Alex Meyer",
    reason: "Imaging project needs it off until Friday.",
    at: "2026-01-10T09:00:00.000Z",
  });

  // On record straight away — no scan needed.
  const [pushed] = getSettingHistory("contoso", "tamper");
  assert.deepEqual(
    { ...pushed, id: 0 },
    {
      id: 0,
      at: "2026-01-10T09:00:00.000Z",
      since: null,
      kind: "pushed",
      policyId: "p3",
      policyName: "Policy p3",
      from: "Enabled",
      to: "Disabled",
      pushedBy: "Alex Meyer",
      stagedBy: "Sam Okafor",
      reviewedBy: "Alex Meyer",
      reason: "Imaging project needs it off until Friday.",
    },
  );

  // The next scan sees the pushed value: that confirms the entry, it isn't a second change.
  recordScan(scan("contoso", "2026-01-10T12:00:00.000Z", [entry("defer", [["p1", "7", false]]), entry("tamper", [["p3", "Disabled"]])]));
  const afterScan = getSettingHistory("contoso", "tamper");
  assert.deepEqual(afterScan.map((e) => e.kind), ["pushed", "added"]);
  assert.equal(afterScan[0].confirmedAt, "2026-01-10T12:00:00.000Z");

  // Someone changing it back by hand afterwards is an observation like any other — no reason, nobody named.
  recordScan(scan("contoso", "2026-01-11T12:00:00.000Z", [entry("defer", [["p1", "7", false]]), entry("tamper", [["p3", "Enabled"]])]));
  const [changedBack] = getSettingHistory("contoso", "tamper");
  assert.deepEqual([changedBack.kind, changedBack.from, changedBack.to, changedBack.reason, changedBack.pushedBy], ["changed", "Disabled", "Enabled", undefined, undefined]);
});

test("history: a scan showing a different value than the one pushed doesn't confirm the push", () => {
  recordPushedChange({ tenant: "contoso", settingKey: "defer", policyId: "p1", policyName: "Policy p1", from: "7", to: "3", pushedBy: "Alex Meyer", stagedBy: "Alex Meyer", reviewedBy: "Sam Okafor", reason: "Faster patching.", at: "2026-01-12T09:00:00.000Z" });
  recordScan(scan("contoso", "2026-01-12T12:00:00.000Z", [entry("defer", [["p1", "5", false]]), entry("tamper", [["p3", "Enabled"]])]));

  const [observed, pushed] = getSettingHistory("contoso", "defer");
  assert.deepEqual([observed.kind, observed.from, observed.to], ["changed", "7", "5"]);
  assert.equal(pushed.kind, "pushed");
  assert.equal(pushed.confirmedAt, undefined);
});

test("history: a pushed removal is confirmed by the scan that finds the policy no longer setting it", () => {
  recordPushedChange({ tenant: "contoso", settingKey: "tamper", policyId: "p3", policyName: "Policy p3", from: "Enabled", to: "Not configured", pushedBy: "Alex Meyer", stagedBy: "Alex Meyer", reviewedBy: "Sam Okafor", reason: "Moved to the baseline policy.", at: "2026-01-13T09:00:00.000Z" });
  recordScan(scan("contoso", "2026-01-13T12:00:00.000Z", [entry("defer", [["p1", "5", false]])]));

  const [latest] = getSettingHistory("contoso", "tamper");
  // One entry for it — the push, now confirmed — not a second, anonymous "no longer sets it".
  assert.deepEqual([latest.kind, latest.to, latest.confirmedAt], ["pushed", "Not configured", "2026-01-13T12:00:00.000Z"]);
  assert.equal(getSettingHistory("contoso", "tamper").filter((e) => e.kind === "removed").length, 0);
});
