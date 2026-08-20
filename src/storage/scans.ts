import { getDb } from "./db.js";
import type { ScanReport } from "../scan/report.js";
import type { RawSimplePolicy } from "../scan/types.js";

interface ScanRow {
  id: number;
  scanned_at: string;
  flow: string;
  tenant: string;
  tenant_name: string | null;
  policy_count: number;
}

interface SettingsSnapshotRow {
  key: string;
  name: string;
  csp_path: string;
  category: string;
  platform: string;
  state: string;
  conflict: number;
  values_json: string;
  sources_json: string;
  rec_json: string | null;
}

interface PolicySnapshotRow {
  kind: "compliance" | "enrollment";
  policy_id: string;
  name: string;
  platform: string;
  deployed: number;
  priority: number | null;
}

/** Persists a scan and every row of it — the scan-history record this whole storage layer exists for. */
export function recordScan(report: ScanReport): void {
  const db = getDb();

  db.exec("BEGIN");
  try {
    const scanResult = db
      .prepare(`INSERT INTO scans (scanned_at, flow, tenant, tenant_name, policy_count) VALUES (?, ?, ?, ?, ?)`)
      .run(report.scannedAt, report.flow, report.tenant, report.tenantName ?? null, report.policyCount);
    const scanId = scanResult.lastInsertRowid;

    const insertSetting = db.prepare(`
      INSERT INTO settings_snapshot (scan_id, key, name, csp_path, category, platform, state, conflict, values_json, sources_json, rec_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of report.settings) {
      insertSetting.run(
        scanId,
        e.key,
        e.name,
        e.cspPath,
        e.category,
        e.platform,
        e.state,
        e.conflict ? 1 : 0,
        JSON.stringify(e.values),
        JSON.stringify(e.sources),
        e.rec ? JSON.stringify(e.rec) : null,
      );
    }

    const insertPolicy = db.prepare(`
      INSERT INTO policy_snapshot (scan_id, kind, policy_id, name, platform, deployed, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of report.compliancePolicies) {
      insertPolicy.run(scanId, "compliance", p.id, p.name, p.platform, p.deployed ? 1 : 0, p.priority ?? null);
    }
    for (const p of report.enrollmentConfigurations) {
      insertPolicy.run(scanId, "enrollment", p.id, p.name, p.platform, p.deployed ? 1 : 0, p.priority ?? null);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Reconstructs the same ScanReport shape the rest of the codebase already expects — callers don't need to know storage changed underneath. */
export function getLatestScan(tenant?: string): ScanReport | undefined {
  const db = getDb();

  const scan = tenant
    ? (db.prepare(`SELECT * FROM scans WHERE tenant = ? ORDER BY scanned_at DESC LIMIT 1`).get(tenant) as ScanRow | undefined)
    : (db.prepare(`SELECT * FROM scans ORDER BY scanned_at DESC LIMIT 1`).get() as ScanRow | undefined);

  if (!scan) return undefined;

  const settingRows = db
    .prepare(`SELECT key, name, csp_path, category, platform, state, conflict, values_json, sources_json, rec_json FROM settings_snapshot WHERE scan_id = ?`)
    .all(scan.id) as unknown as SettingsSnapshotRow[];

  const settings = settingRows.map((r) => ({
    key: r.key,
    name: r.name,
    cspPath: r.csp_path,
    category: r.category,
    platform: r.platform,
    state: r.state as ScanReport["settings"][number]["state"],
    conflict: Boolean(r.conflict),
    values: JSON.parse(r.values_json),
    sources: JSON.parse(r.sources_json),
    ...(r.rec_json ? { rec: JSON.parse(r.rec_json) } : {}),
  }));

  const policyRows = db
    .prepare(`SELECT kind, policy_id, name, platform, deployed, priority FROM policy_snapshot WHERE scan_id = ?`)
    .all(scan.id) as unknown as PolicySnapshotRow[];

  const toSimplePolicy = (r: PolicySnapshotRow): RawSimplePolicy => ({
    id: r.policy_id,
    name: r.name,
    platform: r.platform,
    deployed: Boolean(r.deployed),
    ...(r.priority !== null ? { priority: r.priority } : {}),
  });

  const compliancePolicies = policyRows.filter((r) => r.kind === "compliance").map(toSimplePolicy);
  const enrollmentConfigurations = policyRows.filter((r) => r.kind === "enrollment").map(toSimplePolicy);

  return {
    scannedAt: scan.scanned_at,
    flow: scan.flow,
    tenant: scan.tenant,
    ...(scan.tenant_name ? { tenantName: scan.tenant_name } : {}),
    policyCount: scan.policy_count,
    settingCount: settings.length,
    conflictCount: settings.filter((s) => s.conflict).length,
    belowBaselineCount: settings.filter((s) => s.state === "Below baseline").length,
    settings,
    compliancePolicies,
    enrollmentConfigurations,
  };
}
