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
const { getSettingHistory } = await import("../../src/storage/history.js");
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
