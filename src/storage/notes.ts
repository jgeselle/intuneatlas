import { getDb } from "./db.js";

export interface Note {
  id: number;
  author: string;
  /** Entra object ID of whoever wrote this — the ownership key; never display this. */
  authorId: string;
  createdAt: string;
  text: string;
}

interface NoteRow {
  id: number;
  author: string;
  author_id: string;
  created_at: string;
  text: string;
}

/** target_key is a settings-index `key` or a compliance/enrollment policy `id` — same identifiers already used elsewhere, notes aren't scan-scoped. */
export function addNote(targetKey: string, authorId: string, authorName: string, text: string): Note[] {
  const db = getDb();
  db.prepare(`INSERT INTO notes (target_key, author, author_id, created_at, text) VALUES (?, ?, ?, ?, ?)`).run(
    targetKey,
    authorName,
    authorId,
    new Date().toISOString(),
    text,
  );
  return getNotesFor([targetKey]).get(targetKey) ?? [];
}

/** Batch-loads notes for many keys at once, e.g. every settings-index entry in a report. */
export function getNotesFor(targetKeys: string[]): Map<string, Note[]> {
  const result = new Map<string, Note[]>();
  if (targetKeys.length === 0) return result;

  const db = getDb();
  const placeholders = targetKeys.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT id, target_key as targetKey, author, author_id, created_at, text FROM notes WHERE target_key IN (${placeholders}) ORDER BY created_at ASC`,
    )
    .all(...targetKeys) as unknown as Array<NoteRow & { targetKey: string }>;

  for (const row of rows) {
    const list = result.get(row.targetKey) ?? [];
    list.push({ id: row.id, author: row.author, authorId: row.author_id, createdAt: row.created_at, text: row.text });
    result.set(row.targetKey, list);
  }
  return result;
}

/** Every note in storage, keyed the same way — used to attach notes to a full report. */
export function getAllNotes(): Record<string, Note[]> {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, target_key as targetKey, author, author_id, created_at, text FROM notes ORDER BY created_at ASC`)
    .all() as unknown as Array<NoteRow & { targetKey: string }>;

  const result: Record<string, Note[]> = {};
  for (const row of rows) {
    (result[row.targetKey] ??= []).push({ id: row.id, author: row.author, authorId: row.author_id, createdAt: row.created_at, text: row.text });
  }
  return result;
}

/** Single-row lookup, used to check ownership before allowing a delete. */
export function getNoteById(id: number): Note | undefined {
  const row = getDb()
    .prepare(`SELECT id, author, author_id, created_at, text FROM notes WHERE id = ?`)
    .get(id) as unknown as NoteRow | undefined;
  return row ? { id: row.id, author: row.author, authorId: row.author_id, createdAt: row.created_at, text: row.text } : undefined;
}

/** Deletes one note and returns its target key plus the remaining notes for that key, or undefined if it didn't exist. */
export function deleteNote(id: number): { targetKey: string; notes: Note[] } | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT target_key as targetKey FROM notes WHERE id = ?`).get(id) as { targetKey: string } | undefined;
  if (!row) return undefined;
  db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
  return { targetKey: row.targetKey, notes: getNotesFor([row.targetKey]).get(row.targetKey) ?? [] };
}
