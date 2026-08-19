import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_DIR = join(homedir(), ".intuneatlas");
const DB_PATH = join(CACHE_DIR, "intuneatlas.db");

let db: DatabaseSync | undefined;

/**
 * Singleton connection to the tool's local state store — scan snapshots,
 * scan history, and notes. Baselines stay separate, plain YAML files (rules
 * a human authors and reviews via git, not tool-managed state); this is only
 * for what the tool itself writes.
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
      policy_count INTEGER NOT NULL
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
      rec_json TEXT
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
      priority INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_policy_snapshot_scan ON policy_snapshot(scan_id);

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_key TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_target ON notes(target_key);
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
  const columns = db.prepare(`PRAGMA table_info(settings_snapshot)`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "rec_json")) {
    db.exec(`ALTER TABLE settings_snapshot ADD COLUMN rec_json TEXT`);
  }
}
