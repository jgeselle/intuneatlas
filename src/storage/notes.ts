import { getDb } from "./db.js";

export interface Note {
  id: number;
  author: string;
  createdAt: string;
  text: string;
}

interface NoteRow {
  id: number;
  author: string;
  created_at: string;
  text: string;
}

/** target_key is a settings-index `key` or a compliance/enrollment policy `id` — same identifiers already used elsewhere, notes aren't scan-scoped. */
export function addNote(targetKey: string, author: string, text: string): Note[] {
  const db = getDb();
  db.prepare(`INSERT INTO notes (target_key, author, created_at, text) VALUES (?, ?, ?, ?)`).run(
    targetKey,
    author,
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
    .prepare(`SELECT id, target_key as targetKey, author, created_at, text FROM notes WHERE target_key IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...targetKeys) as unknown as Array<NoteRow & { targetKey: string }>;

  for (const row of rows) {
    const list = result.get(row.targetKey) ?? [];
    list.push({ id: row.id, author: row.author, createdAt: row.created_at, text: row.text });
    result.set(row.targetKey, list);
  }
  return result;
}

/** Every note in storage, keyed the same way — used to attach notes to a full report. */
export function getAllNotes(): Record<string, Note[]> {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, target_key as targetKey, author, created_at, text FROM notes ORDER BY created_at ASC`)
    .all() as unknown as Array<NoteRow & { targetKey: string }>;

  const result: Record<string, Note[]> = {};
  for (const row of rows) {
    (result[row.targetKey] ??= []).push({ id: row.id, author: row.author, createdAt: row.created_at, text: row.text });
  }
  return result;
}
