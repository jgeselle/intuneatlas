import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_DIR = join(homedir(), ".intuneatlas");
const DB_PATH = join(CACHE_DIR, "intuneatlas.db");

let db: DatabaseSync | undefined;

/**
 * Singleton connection to the tool's local state store — scan snapshots,
 * scan history, notes, and small persisted config (e.g. the saved client
 * ID). Baselines stay separate, plain YAML files (rules a human authors and
 * reviews via git, not tool-managed state); this is only for what the tool
 * itself writes.
 */
export function getDb(): DatabaseSync {
  if (db) return db;

  mkdirSync(CACHE_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scanned_at TEXT NOT NULL,
      flow TEXT NOT NULL,
      tenant TEXT NOT NULL,
      tenant_name TEXT,
      policy_count INTEGER NOT NULL,
      legacy_policy_count INTEGER NOT NULL DEFAULT 0,
      baseline_definitions_json TEXT,
      groups_json TEXT
    );

    CREATE TABLE IF NOT EXISTS settings_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER NOT NULL REFERENCES scans(id),
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      csp_path TEXT NOT NULL,
      category TEXT NOT NULL,
      platform TEXT NOT NULL,
      state TEXT NOT NULL,
      conflict INTEGER NOT NULL,
      values_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      recs_json TEXT,
      definition_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_settings_snapshot_scan ON settings_snapshot(scan_id);

    CREATE TABLE IF NOT EXISTS policy_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER NOT NULL REFERENCES scans(id),
      kind TEXT NOT NULL CHECK (kind IN ('compliance', 'enrollment')),
      policy_id TEXT NOT NULL,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      deployed INTEGER NOT NULL,
      priority INTEGER,
      targets_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_policy_snapshot_scan ON policy_snapshot(scan_id);

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_key TEXT NOT NULL,
      author TEXT NOT NULL,
      author_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_target ON notes(target_key);

    CREATE TABLE IF NOT EXISTS staged_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_key TEXT NOT NULL,
      target_name TEXT NOT NULL,
      setting_key TEXT NOT NULL DEFAULT '',
      policy_id TEXT NOT NULL DEFAULT '',
      policy_name TEXT NOT NULL DEFAULT '',
      target_kind TEXT NOT NULL DEFAULT 'existing',
      rule_id TEXT NOT NULL,
      from_value TEXT NOT NULL,
      to_value TEXT NOT NULL,
      to_structured_json TEXT,
      reason TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      staged_by TEXT NOT NULL DEFAULT '',
      staged_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staged_changes_target ON staged_changes(target_key);

    -- What happened to each setting, scan to scan (see src/storage/history.ts).
    -- Small next to the snapshots: one row per change, not per setting per scan.
    CREATE TABLE IF NOT EXISTS setting_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant TEXT NOT NULL,
      setting_key TEXT NOT NULL,
      scan_id INTEGER REFERENCES scans(id),
      occurred_at TEXT NOT NULL,
      since TEXT,
      kind TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      policy_name TEXT NOT NULL,
      from_value TEXT,
      to_value TEXT,
      -- Only on a change the tool itself pushed (kind 'pushed'): who pushed it, who had staged
      -- and reviewed it, why — and when a scan first saw it in the tenant.
      actor_name TEXT,
      staged_by_name TEXT,
      reviewed_by TEXT,
      reason TEXT,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_setting_history_setting ON setting_history(tenant, setting_key);

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Which baseline packs (source/name+version folders under baselines/)
    -- are active, per signed-in viewer — not tenant data, a personal
    -- preference. Row absence means "never customized" (defaults to every
    -- pack active, today's behavior); an explicit empty array means
    -- "deliberately chose none".
    CREATE TABLE IF NOT EXISTS baseline_selections (
      viewer_id TEXT PRIMARY KEY,
      selected_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  migrate(db);
  return db;
}

/**
 * CREATE TABLE IF NOT EXISTS only handles brand-new databases — it doesn't
 * retroactively add columns to a table that already exists on disk from a
 * previous version. rec_json (baseline recommendations) was added after
 * settings_snapshot was already shipping, so existing local databases need
 * this once. Deliberately minimal (no migration framework, see project
 * plan) — add another guarded ALTER here if the schema changes again before
 * this graduates into something more formal.
 */
function migrate(db: DatabaseSync): void {
  // setting_history's columns for pushed changes — on a database that got the table before they existed.
  const historyColumns = db.prepare(`PRAGMA table_info(setting_history)`).all() as Array<{ name: string }>;
  for (const column of ["staged_by_name", "reviewed_by", "confirmed_at"]) {
    if (!historyColumns.some((c) => c.name === column)) db.exec(`ALTER TABLE setting_history ADD COLUMN ${column} TEXT`);
  }

  const settingsColumns = db.prepare(`PRAGMA table_info(settings_snapshot)`).all() as Array<{ name: string }>;
  if (!settingsColumns.some((c) => c.name === "rec_json")) {
    db.exec(`ALTER TABLE settings_snapshot ADD COLUMN rec_json TEXT`);
  }

  // recs_json (plural) replaces rec_json: a setting can now carry several
  // baseline recommendations (different sources), not just one. rec_json
  // itself is left in place rather than dropped — SQLite column drops are
  // more invasive than this project's "no migration framework" approach
  // wants to take on for a column that just goes unused going forward.
  if (!settingsColumns.some((c) => c.name === "recs_json")) {
    db.exec(`ALTER TABLE settings_snapshot ADD COLUMN recs_json TEXT`);
  }

  // definition_json — the setting's definition id and schemas (options,
  // ranges, sub-settings). Null on every row scanned before schemas were
  // kept; those settings simply stay free-text until the next scan.
  if (!settingsColumns.some((c) => c.name === "definition_json")) {
    db.exec(`ALTER TABLE settings_snapshot ADD COLUMN definition_json TEXT`);
  }

  // targets_json — who a compliance or enrollment policy is assigned to.
  const policyColumns = db.prepare(`PRAGMA table_info(policy_snapshot)`).all() as Array<{ name: string }>;
  if (!policyColumns.some((c) => c.name === "targets_json")) {
    db.exec(`ALTER TABLE policy_snapshot ADD COLUMN targets_json TEXT`);
  }

  const scanColumns = db.prepare(`PRAGMA table_info(scans)`).all() as Array<{ name: string }>;
  if (!scanColumns.some((c) => c.name === "tenant_name")) {
    db.exec(`ALTER TABLE scans ADD COLUMN tenant_name TEXT`);
  }
  // baseline_definitions_json — definitions looked up for settings a
  // baseline expects but no policy in the tenant configures.
  // groups_json — names and nesting of the groups policies are assigned to.
  if (!scanColumns.some((c) => c.name === "groups_json")) {
    db.exec(`ALTER TABLE scans ADD COLUMN groups_json TEXT`);
  }
  if (!scanColumns.some((c) => c.name === "baseline_definitions_json")) {
    db.exec(`ALTER TABLE scans ADD COLUMN baseline_definitions_json TEXT`);
  }

  // staged_by (role-based access control) — rows from before this column
  // existed get '', which never matches a real signed-in id, so they
  // become admin-only to edit/revert rather than owned by no one in
  // particular. Fail-closed, not a bug.
  const stagedChangesColumns = db.prepare(`PRAGMA table_info(staged_changes)`).all() as Array<{ name: string }>;
  // setting_key / policy_id / policy_name — a staged change now targets one
  // policy's value of a setting. Rows from before get '', which the UI
  // reads as "a change to the setting as a whole" (target_key is then the
  // setting's own key).
  // to_structured_json — the staged value with its structure; null on
  // older rows and on changes to settings that have none (legacy profiles).
  if (!stagedChangesColumns.some((c) => c.name === "to_structured_json")) {
    db.exec(`ALTER TABLE staged_changes ADD COLUMN to_structured_json TEXT`);
  }

  // target_kind — 'existing' (a change to a policy in the tenant, all there
  // was before) or 'new' (a setting staged into a policy to be created).
  if (!stagedChangesColumns.some((c) => c.name === "target_kind")) {
    db.exec(`ALTER TABLE staged_changes ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'existing'`);
  }

  for (const column of ["setting_key", "policy_id", "policy_name"]) {
    if (!stagedChangesColumns.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE staged_changes ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    }
  }

  if (!stagedChangesColumns.some((c) => c.name === "staged_by")) {
    db.exec(`ALTER TABLE staged_changes ADD COLUMN staged_by TEXT NOT NULL DEFAULT ''`);
  }

  // staged_by_name — display-only counterpart to staged_by. staged_by
  // itself started out holding the signed-in user's Entra *display name*
  // (a real bug: display names aren't unique or stable, so two same-named
  // users — or one renamed user — could touch each other's staged
  // changes). It now holds the Entra object ID instead, which breaks
  // nothing for ownership (a non-matching leftover display-name value in
  // an existing row just falls back to admin-only, same fail-closed
  // behavior as the empty-string case above), but the UI still needs
  // something human-readable to show as "staged by ___", hence this
  // separate column.
  if (!stagedChangesColumns.some((c) => c.name === "staged_by_name")) {
    db.exec(`ALTER TABLE staged_changes ADD COLUMN staged_by_name TEXT NOT NULL DEFAULT ''`);
  }

  // legacy_policy_count — existing scan rows predate legacy deviceConfigurations
  // scanning entirely; DEFAULT 0 is accurate for them (they genuinely didn't
  // scan any), not a placeholder.
  if (!scanColumns.some((c) => c.name === "legacy_policy_count")) {
    db.exec(`ALTER TABLE scans ADD COLUMN legacy_policy_count INTEGER NOT NULL DEFAULT 0`);
  }

  // author_id — same fail-closed reasoning as staged_by above: existing
  // notes predate per-author deletion and get '', which never matches a
  // real signed-in id, so they become admin-only to delete rather than
  // owned by no one in particular.
  const notesColumns = db.prepare(`PRAGMA table_info(notes)`).all() as Array<{ name: string }>;
  if (!notesColumns.some((c) => c.name === "author_id")) {
    db.exec(`ALTER TABLE notes ADD COLUMN author_id TEXT NOT NULL DEFAULT ''`);
  }
}
