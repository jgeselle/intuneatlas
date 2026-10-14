import type { DatabaseSync } from "node:sqlite";
import { diffScans, type ScannedSetting, type SettingEventKind } from "../scan/history.js";
import { getDb } from "./db.js";

/**
 * A setting's history, as stored: one row per thing that happened to it.
 * There are two kinds of row, and the difference matters:
 *
 * - **Observed** (added, removed, changed, assigned, unassigned): a scan
 *   saw the tenant differ from the scan before (see src/scan/history.ts).
 *   Nobody told the tool; it knows what, not who or why.
 * - **Pushed**: the tool itself wrote a staged change to the tenant.
 *   Recorded by recordPushedChange at the moment of the push, first-hand —
 *   who pushed it, who staged and reviewed it, and the reason given. It
 *   doesn't wait for, or depend on, a scan.
 *
 * The next scan will of course see what a push did. That observation
 * confirms the pushed row (`confirmedAt`) instead of becoming a second
 * entry for the same change.
 *
 * Nothing pushes yet — write-back isn't built. recordPushedChange is the
 * contract for when it is: the write action calls it once Graph has
 * accepted the change, in the same step that closes the staged change.
 */
export interface HistoryEntry {
  id: number;
  /** Observed: the time of the scan that showed it. Pushed: when it was pushed. */
  at: string;
  /** Observed only: the scan before — it happened some time between the two. */
  since: string | null;
  kind: SettingEventKind | "pushed";
  policyId: string;
  policyName: string;
  from?: string;
  to?: string;
  /** Pushed only. */
  pushedBy?: string;
  stagedBy?: string;
  reviewedBy?: string;
  reason?: string;
  /** Pushed only: when a scan first saw the pushed value in the tenant; absent until one has. */
  confirmedAt?: string;
}

/** What a push records. Display names, as they were at the time — history isn't rewritten when someone is renamed. */
export interface PushedChange {
  tenant: string;
  settingKey: string;
  /** The policy as it is in the tenant after the push — for a setting pushed into a new policy, the id Graph gave it. */
  policyId: string;
  policyName: string;
  from?: string;
  to: string;
  pushedBy: string;
  stagedBy: string;
  reviewedBy: string;
  reason: string;
  /** Defaults to now. */
  at?: string;
}

export function recordPushedChange(change: PushedChange): void {
  getDb()
    .prepare(
      `INSERT INTO setting_history (tenant, setting_key, occurred_at, kind, policy_id, policy_name, from_value, to_value, actor_name, staged_by_name, reviewed_by, reason) VALUES (?, ?, ?, 'pushed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      change.tenant,
      change.settingKey,
      change.at ?? new Date().toISOString(),
      change.policyId,
      change.policyName,
      change.from ?? null,
      change.to,
      change.pushedBy,
      change.stagedBy,
      change.reviewedBy,
      change.reason,
    );
}

interface HistoryRow {
  id: number;
  occurred_at: string;
  since: string | null;
  kind: SettingEventKind | "pushed";
  policy_id: string;
  policy_name: string;
  from_value: string | null;
  to_value: string | null;
  actor_name: string | null;
  staged_by_name: string | null;
  reviewed_by: string | null;
  reason: string | null;
  confirmed_at: string | null;
}

const BACKFILLED_KEY = "history_backfilled";
/** What a setting reads as once a policy no longer sets it — also the text a staged removal carries as its new value. */
export const NOT_CONFIGURED = "Not configured";

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
  // A pushed change this scan is the first to see: same setting, same policy, the value that was pushed.
  const confirm = db.prepare(
    `UPDATE setting_history SET confirmed_at = ? WHERE id = (
       SELECT id FROM setting_history
       WHERE tenant = ? AND setting_key = ? AND policy_id = ? AND kind = 'pushed' AND confirmed_at IS NULL AND to_value = ? AND occurred_at <= ?
       ORDER BY occurred_at DESC LIMIT 1)`,
  );
  for (const event of diffScans(previous.settings, current)) {
    // What a push did is already on record, with who and why. Seeing it in the tenant confirms that entry; it isn't a second change.
    // A pushed removal is on record as a change to "Not configured"; the scan sees the policy no longer setting it.
    const seen = event.kind === "changed" || event.kind === "added" ? event.to : event.kind === "removed" ? NOT_CONFIGURED : undefined;
    if (seen !== undefined) {
      const confirmed = confirm.run(scan.scannedAt, scan.tenant, event.settingKey, event.policyId, seen, scan.scannedAt);
      if (Number(confirmed.changes) > 0) continue;
    }
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
function toEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    at: row.occurred_at,
    since: row.since,
    kind: row.kind,
    policyId: row.policy_id,
    policyName: row.policy_name,
    ...(row.from_value !== null ? { from: row.from_value } : {}),
    ...(row.to_value !== null ? { to: row.to_value } : {}),
    ...(row.actor_name ? { pushedBy: row.actor_name } : {}),
    ...(row.staged_by_name ? { stagedBy: row.staged_by_name } : {}),
    ...(row.reviewed_by ? { reviewedBy: row.reviewed_by } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}),
  };
}

export function getSettingHistory(tenant: string, settingKey: string, limit = 100): HistoryEntry[] {
  ensureHistoryBackfilled();
  const rows = getDb()
    .prepare(`SELECT * FROM setting_history WHERE tenant = ? AND setting_key = ? ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .all(tenant, settingKey, limit) as unknown as HistoryRow[];
  return rows.map(toEntry);
}

/**
 * What has happened across the whole tenant, newest first: every
 * setting's history in one list, each event with its setting's key and
 * name. The name comes from the latest scan that had the setting, so a
 * setting no longer in the tenant keeps the name it had.
 *
 * Read a page at a time, already narrowed — by kind (pushed from here, or
 * seen by a scan), by words (each one in the setting's name, the policy,
 * a value, the reason or who pushed it), and to the policies a viewer may
 * see — so the page, "show older" and the counts all agree, however long
 * the history is.
 */
const LOG_VALUE_LENGTH = 200;

export interface HistoryQuery {
  limit?: number;
  offset?: number;
  kind?: "pushed" | "seen";
  words?: string[];
  /** Only events of these policies (a viewer's); every event when absent. */
  policyIds?: string[];
}

function narrowed(tenant: string, query: HistoryQuery): { sql: string; params: Array<string | number> } {
  const where = ["h.tenant = ?"];
  const params: Array<string | number> = [tenant];
  if (query.kind === "pushed") where.push("h.kind = 'pushed'");
  if (query.kind === "seen") where.push("h.kind <> 'pushed'");
  if (query.policyIds) {
    where.push("h.policy_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(query.policyIds));
  }
  for (const word of query.words ?? []) {
    // A literal match, case-insensitively: % and _ in what was typed mean themselves.
    const like = "%" + word.toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    where.push(
      "(" +
        ["h.setting_name", "h.policy_name", "h.from_value", "h.to_value", "h.reason", "h.actor_name", "h.reviewed_by"]
          .map((column) => `lower(coalesce(${column}, '')) LIKE ? ESCAPE '\\'`)
          .join(" OR ") +
        ")",
    );
    for (let i = 0; i < 7; i++) params.push(like);
  }
  return {
    sql: `WITH h AS (
            SELECT h.*, (SELECT s.name FROM settings_snapshot s WHERE s.key = h.setting_key ORDER BY s.scan_id DESC LIMIT 1) AS setting_name
            FROM setting_history h WHERE h.tenant = ?
          )
          SELECT * FROM h WHERE ${where.join(" AND ")}`,
    params: [tenant, ...params],
  };
}

export function getRecentHistory(tenant: string, query: HistoryQuery = {}): Array<HistoryEntry & { settingKey: string; settingName: string }> {
  ensureHistoryBackfilled();
  const { sql, params } = narrowed(tenant, query);
  const rows = getDb()
    .prepare(`${sql} ORDER BY h.occurred_at DESC, h.id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.limit ?? 100, query.offset ?? 0) as unknown as Array<HistoryRow & { setting_key: string; setting_name: string | null }>;
  // A row of the log shows the start of a value; the whole of it is in the setting's own history.
  // Some values are encoded files or long rule lists, and would make the log many times its size.
  const brief = (value: string | undefined) => (value !== undefined && value.length > LOG_VALUE_LENGTH ? value.slice(0, LOG_VALUE_LENGTH) + "…" : value);
  return rows.map((row) => {
    const entry = toEntry(row);
    return {
      ...entry,
      ...(entry.from !== undefined ? { from: brief(entry.from) } : {}),
      ...(entry.to !== undefined ? { to: brief(entry.to) } : {}),
      settingKey: row.setting_key,
      settingName: row.setting_name ?? row.setting_key.split("::")[0],
    };
  });
}

/** How many events there are of each kind, for the same words and policies — the counts on the filters. */
export function countRecentHistory(tenant: string, query: Omit<HistoryQuery, "kind" | "limit" | "offset"> = {}): { pushed: number; seen: number } {
  ensureHistoryBackfilled();
  const { sql, params } = narrowed(tenant, query);
  const row = getDb()
    .prepare(`SELECT coalesce(sum(kind = 'pushed'), 0) AS pushed, coalesce(sum(kind <> 'pushed'), 0) AS seen FROM (${sql})`)
    .get(...params) as { pushed: number; seen: number };
  return { pushed: Number(row.pushed), seen: Number(row.seen) };
}
