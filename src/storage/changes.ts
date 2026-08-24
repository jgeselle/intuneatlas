import { getDb } from "./db.js";

export interface StagedChange {
  id: number;
  targetKey: string;
  targetName: string;
  ruleId: string;
  from: string;
  to: string;
  reason: string;
  reviewedBy: string;
  /** Entra object ID of whoever staged this — the ownership key; never display this. */
  stagedBy: string;
  /** Display name only, for "staged by ___" UI text — never use for ownership checks. */
  stagedByName: string;
  createdAt: string;
  updatedAt: string;
  /** Derived, not stored — true once both a reason and a named reviewer are present. */
  ready: boolean;
}

interface ChangeRow {
  id: number;
  target_key: string;
  target_name: string;
  rule_id: string;
  from_value: string;
  to_value: string;
  reason: string;
  reviewed_by: string;
  staged_by: string;
  staged_by_name: string;
  created_at: string;
  updated_at: string;
}

function toStagedChange(r: ChangeRow): StagedChange {
  return {
    id: r.id,
    targetKey: r.target_key,
    targetName: r.target_name,
    ruleId: r.rule_id,
    from: r.from_value,
    to: r.to_value,
    reason: r.reason,
    reviewedBy: r.reviewed_by,
    stagedBy: r.staged_by,
    stagedByName: r.staged_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ready: Boolean(r.reason.trim() && r.reviewed_by.trim()),
  };
}

export interface StageChangeInput {
  targetKey: string;
  targetName: string;
  ruleId: string;
  from: string;
  to: string;
  /** Optional — can be set right away instead of only via the later reason/reviewer edit. */
  reason?: string;
}

/**
 * `to` can be any value the caller sends, not just an existing baseline
 * recommendation's — this layer never enforced that restriction (it only
 * ever lived in the web UI, which used to show "Stage this change" only
 * next to a real recommendation). `ruleId` is `"manual"` for a freeform
 * edit with no baseline rule behind it. Replaces any existing staged
 * change for the same key; restaging transfers ownership to whoever just
 * restaged it. `reason` resets to whatever (if anything) was passed this
 * time — `reviewedBy` always resets, since a fresh restage needs fresh
 * review regardless. `stagedBy` must be a stable id (Entra object ID), not
 * a display name — see ViewerIdentity.id; `stagedByName` is display-only.
 */
export function stageChange(input: StageChangeInput, stagedBy: string, stagedByName: string): StagedChange {
  const db = getDb();
  const now = new Date().toISOString();
  const reason = input.reason ?? "";

  db.prepare(
    `
    INSERT INTO staged_changes (target_key, target_name, rule_id, from_value, to_value, reason, staged_by, staged_by_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_key) DO UPDATE SET
      target_name = excluded.target_name,
      rule_id = excluded.rule_id,
      from_value = excluded.from_value,
      to_value = excluded.to_value,
      reason = excluded.reason,
      reviewed_by = '',
      staged_by = excluded.staged_by,
      staged_by_name = excluded.staged_by_name,
      updated_at = excluded.updated_at
  `,
  ).run(input.targetKey, input.targetName, input.ruleId, input.from, input.to, reason, stagedBy, stagedByName, now, now);

  const row = db.prepare(`SELECT * FROM staged_changes WHERE target_key = ?`).get(input.targetKey) as unknown as ChangeRow;
  return toStagedChange(row);
}

/** Single-row lookup, used to check ownership before allowing an edit/revert. */
export function getChangeById(id: number): StagedChange | undefined {
  const row = getDb().prepare(`SELECT * FROM staged_changes WHERE id = ?`).get(id) as unknown as ChangeRow | undefined;
  return row ? toStagedChange(row) : undefined;
}

export function updateReason(id: number, reason: string): StagedChange {
  return updateField(id, "reason", reason);
}

// Display name is correct here today — reviewedBy is attribution, not an
// authorization input (nothing currently checks "is the reviewer allowed
// to review," only "is a reviewer present"). That stops being true the
// moment write-back gets a four-eyes rule (can't approve your own staged
// change): comparing reviewedBy against stagedBy to enforce that would hit
// the exact same bug fixed for ownership — display names collide and
// change, stable ids don't. When that lands, this needs viewer.id too, the
// same way stageChange's stagedBy does.
export function updateReviewer(id: number, reviewedBy: string): StagedChange {
  return updateField(id, "reviewed_by", reviewedBy);
}

function updateField(id: number, column: "reason" | "reviewed_by", value: string): StagedChange {
  const db = getDb();
  db.prepare(`UPDATE staged_changes SET ${column} = ?, updated_at = ? WHERE id = ?`).run(
    value,
    new Date().toISOString(),
    id,
  );
  const row = db.prepare(`SELECT * FROM staged_changes WHERE id = ?`).get(id) as unknown as ChangeRow | undefined;
  if (!row) throw new Error(`No staged change with id ${id}.`);
  return toStagedChange(row);
}

/** Returns the target key that was reverted, so callers can update any in-memory copy of the report — undefined if there was no such change. */
export function revertChange(id: number): string | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT target_key FROM staged_changes WHERE id = ?`).get(id) as { target_key: string } | undefined;
  if (!row) return undefined;
  db.prepare(`DELETE FROM staged_changes WHERE id = ?`).run(id);
  return row.target_key;
}

/** All staged changes, keyed by target — merged into a served report the same way notes are. */
export function getAllChanges(): Record<string, StagedChange> {
  const rows = getDb().prepare(`SELECT * FROM staged_changes`).all() as unknown as ChangeRow[];
  const result: Record<string, StagedChange> = {};
  for (const row of rows) result[row.target_key] = toStagedChange(row);
  return result;
}
