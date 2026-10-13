import type { DefinitionStore } from "../scan/settingDefinitions.js";
import { getDb } from "./db.js";

/** Setting definitions and categories, kept in the local database between runs — see DefinitionStore. */
export const definitionStore: DefinitionStore = {
  get(key, maxAgeMs) {
    const row = getDb().prepare("SELECT json, fetched_at FROM definition_cache WHERE key = ?").get(key) as
      | { json: string; fetched_at: number }
      | undefined;
    if (!row || Date.now() - row.fetched_at >= maxAgeMs) return undefined;
    return row.json;
  },
  set(key, json) {
    getDb()
      .prepare(
        "INSERT INTO definition_cache (key, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
      )
      .run(key, json, Date.now());
  },
};
