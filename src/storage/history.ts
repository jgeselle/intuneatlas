import type { DatabaseSync } from "node:sqlite";
import { diffScans, type ScannedSetting, type SettingEventKind } from "../scan/history.js";
import { getDb } from "./db.js";

/**
 * A setting's history, as stored: one row per thing that happened to it.
 *
 * Today every row is something a scan observed (see src/scan/history.ts),
 * written when the scan is recorded by comparing it with the one before.
 * `actor_name` and `reason` are empty for those; they are there for the
 * day a change is pushed from the change log, which will be recorded here
 * too — with who and why, which an observation can't know.
 */
export interface HistoryEntry {
  id: number;
  /** When it was noticed: the time of the scan that showed it. */
  at: string;
  /** The scan before that — it happened some time between the two. */
  since: string | null;
  kind: SettingEventKind;
  policyId: string;
  policyName: string;
  from?: string;
  to?: string;
}

interface HistoryRow {
  id: number;
  occurred_at: string;
  since: string | null;
  kind: SettingEventKind;
  policy_id: string;
  policy_name: string;
  from_value: string | null;
  to_value: string | null;
}

const BACKFILLED_KEY = "history_backfilled";

function settingsOfScan(db: DatabaseSync, scanId: number | bigint): ScannedSetting[] {
  const rows = db.prepare(`SELECT key, sources_json, definition_json FROM settings_snapshot WHERE scan_id = ?`).all(scanId) as unknown as Array<{
    key: string;
    sources_json: string;
    definition_json: string | null;
  }>;
  return rows.map((row) => ({
    key: row.key,
    definitionId: row.definition_json ? (JSON.parse(row.definition_json) as { definitionId?: string }).definitionId : undefined,
    sources: JSON.parse(row.sources_json) as ScannedSetting["sources"],
  }));
}

function insertEvents(
  db: DatabaseSync,
  scan: { id: number | bigint; tenant: string; scannedAt: string },
  previous: { scannedAt: string; settings: ScannedSetting[] },
  current: ScannedSetting[],
): void {
  const insert = db.prepare(
    `INSERT INTO setting_history (tenant, setting_key, scan_id, occurred_at, since, kind, policy_id, policy_name, from_value, to_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const event of diffScans(previous.settings, current)) {
    insert.run(scan.tenant, event.settingKey, scan.id, scan.scannedAt, previous.scannedAt, event.kind, event.policyId, event.policyName, event.from ?? null, event.to ?? null);
  }
}

/**
 * Records what a just-stored scan changed, against the tenant's previous
 * scan. Called inside recordScan's transaction, after the scan's own rows
 * are in. A tenant's first scan has nothing to compare with and records
 * nothing.
 */
export function recordHistoryForScan(db: DatabaseSync, scan: { id: number | bigint; tenant: string; scannedAt: string }, current: ScannedSetting[]): void {
  const previous = db.prepare(`SELECT id, scanned_at FROM scans WHERE tenant = ? AND id <> ? ORDER BY scanned_at DESC, id DESC LIMIT 1`).get(scan.tenant, scan.id) as
    | { id: number; scanned_at: string }
    | undefined;
  if (!previous) return;
  insertEvents(db, scan, { scannedAt: previous.scanned_at, settings: settingsOfScan(db, previous.id) }, current);
}

/**
 * Once per database: builds the history that scans stored before this
 * existed already imply, by walking each tenant's scans in order. Every
 * scan is kept in full, so nothing is lost by having started late.
 */
export function ensureHistoryBackfilled(): void {
  const db = getDb();
  if (db.prepare(`SELECT 1 FROM config WHERE key = ?`).get(BACKFILLED_KEY)) return;

  db.exec("BEGIN");
  try {
    const scans = db.prepare(`SELECT id, tenant, scanned_at FROM scans ORDER BY tenant, scanned_at, id`).all() as unknown as Array<{ id: number; tenant: string; scanned_at: string }>;
    let previous: { tenant: string; scannedAt: string; settings: ScannedSetting[] } | undefined;
    for (const scan of scans) {
      const settings = settingsOfScan(db, scan.id);
      if (previous && previous.tenant === scan.tenant) insertEvents(db, { id: scan.id, tenant: scan.tenant, scannedAt: scan.scanned_at }, previous, settings);
      previous = { tenant: scan.tenant, scannedAt: scan.scanned_at, settings };
    }
    db.prepare(`INSERT INTO config (key, value) VALUES (?, ?)`).run(BACKFILLED_KEY, new Date().toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** One setting's history in a tenant, newest first. */
export function getSettingHistory(tenant: string, settingKey: string, limit = 100): HistoryEntry[] {
  ensureHistoryBackfilled();
  const rows = getDb()
    .prepare(`SELECT id, occurred_at, since, kind, policy_id, policy_name, from_value, to_value FROM setting_history WHERE tenant = ? AND setting_key = ? ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .all(tenant, settingKey, limit) as unknown as HistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    at: row.occurred_at,
    since: row.since,
    kind: row.kind,
    policyId: row.policy_id,
    policyName: row.policy_name,
    ...(row.from_value !== null ? { from: row.from_value } : {}),
    ...(row.to_value !== null ? { to: row.to_value } : {}),
  }));
}
