import { getDb } from "./db.js";

/**
 * A date to come back to a setting — "renew the code-signing certificate",
 * "check this is still needed" — once, or every so many months. Shared:
 * everyone on the instance sees every reminder, and anyone who can add
 * notes can mark one done or snooze it. Kept by setting key, like notes,
 * not by scan.
 */
export interface Reminder {
  id: number;
  targetKey: string;
  /** The setting's name when the reminder was made — shown even if a later scan no longer has the setting. */
  targetName: string;
  note: string;
  /** YYYY-MM-DD. */
  dueOn: string;
  /** Null for a one-off. */
  repeatMonths: number | null;
  createdBy: string;
  /** Entra object ID of whoever made it — the ownership key for deleting; never display this. */
  createdById: string;
  createdAt: string;
}

export interface ReminderInput {
  targetKey: string;
  targetName: string;
  note?: string;
  dueOn: string;
  repeatMonths?: number | null;
}

interface ReminderRow {
  id: number;
  target_key: string;
  target_name: string;
  note: string;
  due_on: string;
  repeat_months: number | null;
  created_by: string;
  created_by_id: string;
  created_at: string;
}

const fromRow = (r: ReminderRow): Reminder => ({
  id: r.id,
  targetKey: r.target_key,
  targetName: r.target_name,
  note: r.note,
  dueOn: r.due_on,
  repeatMonths: r.repeat_months,
  createdBy: r.created_by,
  createdById: r.created_by_id,
  createdAt: r.created_at,
});

/** Today in UTC, as YYYY-MM-DD — what "due" is measured against on the server. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** A date some months on, kept to the last day of a shorter month: 31 January plus one month is 28 (or 29) February. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return today(target);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return today(new Date(Date.UTC(y, m - 1, d + days)));
}

export function listReminders(): Reminder[] {
  const rows = getDb().prepare(`SELECT * FROM reminders ORDER BY due_on ASC, id ASC`).all() as unknown as ReminderRow[];
  return rows.map(fromRow);
}

export function getReminder(id: number): Reminder | undefined {
  const row = getDb().prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) as unknown as ReminderRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function addReminder(input: ReminderInput, createdById: string, createdBy: string): Reminder[] {
  getDb()
    .prepare(
      `INSERT INTO reminders (target_key, target_name, note, due_on, repeat_months, created_by, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.targetKey, input.targetName, input.note?.trim() ?? "", input.dueOn, input.repeatMonths ?? null, createdBy, createdById, new Date().toISOString());
  return listReminders();
}

/**
 * Done: a one-off is gone; a repeating one moves on by its cycle from the
 * date it was due — not from today, so "every year in March" stays in
 * March — as many cycles as it takes to land after today.
 */
export function completeReminder(id: number, now: string = today()): Reminder[] {
  const reminder = getReminder(id);
  if (!reminder) return listReminders();
  if (!reminder.repeatMonths) {
    getDb().prepare(`DELETE FROM reminders WHERE id = ?`).run(id);
    return listReminders();
  }
  let next = addMonths(reminder.dueOn, reminder.repeatMonths);
  while (next <= now) next = addMonths(next, reminder.repeatMonths);
  getDb().prepare(`UPDATE reminders SET due_on = ? WHERE id = ?`).run(next, id);
  return listReminders();
}

export const SNOOZE_DAYS = 7;

export function snoozeReminder(id: number, now: string = today()): Reminder[] {
  getDb().prepare(`UPDATE reminders SET due_on = ? WHERE id = ?`).run(addDays(now, SNOOZE_DAYS), id);
  return listReminders();
}

export function deleteReminder(id: number): Reminder[] {
  getDb().prepare(`DELETE FROM reminders WHERE id = ?`).run(id);
  return listReminders();
}
