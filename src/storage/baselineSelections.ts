import { getDb } from "./db.js";

/**
 * The signed-in viewer's chosen set of active baseline packs (each
 * identified by its "source/name+version" path — see
 * src/baselines/packs.ts). undefined means "never customized" — the
 * caller should default to every discovered pack being active, matching
 * behavior from before this selection existed. An explicit empty array
 * means the viewer deliberately deselected everything.
 */
export function getSelectedPacks(viewerId: string): string[] | undefined {
  const row = getDb().prepare(`SELECT selected_json FROM baseline_selections WHERE viewer_id = ?`).get(viewerId) as
    | { selected_json: string }
    | undefined;
  return row ? (JSON.parse(row.selected_json) as string[]) : undefined;
}

export function setSelectedPacks(viewerId: string, packs: string[]): void {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO baseline_selections (viewer_id, selected_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(viewer_id) DO UPDATE SET selected_json = excluded.selected_json, updated_at = excluded.updated_at
  `,
  ).run(viewerId, JSON.stringify(packs), new Date().toISOString());
}

/** Reverts to "never customized" — every pack active — by removing the row entirely, not by storing every known pack path. */
export function clearSelectedPacks(viewerId: string): void {
  getDb().prepare(`DELETE FROM baseline_selections WHERE viewer_id = ?`).run(viewerId);
}
