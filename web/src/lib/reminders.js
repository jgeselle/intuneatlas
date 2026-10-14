// Dates for reminders, in the viewer's own calendar. A reminder's date is a
// plain YYYY-MM-DD; "due" means that day has come, wherever the viewer is.

export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Same rule as the server (src/storage/reminders.ts): 31 January plus one month is the end of February. */
export function addMonths(date, months) {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

const dayNumber = (date) => Date.UTC(...date.split("-").map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) / 86400000;

export function isDue(reminder, today = localToday()) {
  return reminder.dueOn <= today;
}

export function formatDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function dueLabel(reminder, today = localToday()) {
  const days = dayNumber(reminder.dueOn) - dayNumber(today);
  if (days === 0) return "Due today";
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 1) return "Due tomorrow";
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return formatDate(reminder.dueOn);
}

export function repeatLabel(months) {
  if (!months) return "";
  if (months === 1) return "Every month";
  if (months === 12) return "Every year";
  if (months % 12 === 0) return `Every ${months / 12} years`;
  return `Every ${months} months`;
}
