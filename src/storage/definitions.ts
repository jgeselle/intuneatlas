import type { DefinitionStore } from "../scan/settingDefinitions.js";
import { getDb } from "./db.js";

const UPSERT =
  "INSERT INTO definition_cache (key, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at";

/** Setting definitions and categories, kept in the local database between runs — see DefinitionStore. */
export const definitionStore: DefinitionStore = {
  get(key, maxAgeMs) {
    const row = getDb().prepare("SELECT json, fetched_at FROM definition_cache WHERE key = ?").get(key) as
      | { json: string; fetched_at: number }
      | undefined;
    if (!row || Date.now() - row.fetched_at >= maxAgeMs) return undefined;
    return row.json;
  },
  setMany(entries) {
    const db = getDb();
    const insert = db.prepare(UPSERT);
    const now = Date.now();
    db.exec("BEGIN");
    try {
      for (const [key, json] of entries) insert.run(key, json, now);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  },
  set(key, json) {
    getDb().prepare(UPSERT)
      .run(key, json, Date.now());
  },
};
