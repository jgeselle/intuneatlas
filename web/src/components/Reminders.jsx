import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "@phosphor-icons/react";
import { addMonths, dueLabel, formatDate, isDue, localToday, repeatLabel } from "../lib/reminders.js";

const control =
  "rounded-md border border-stone-300 bg-surface px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const quiet =
  "rounded-md px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:text-stone-300 disabled:ring-stone-200";

const WHEN = [
  ["1", "In 1 month"],
  ["3", "In 3 months"],
  ["6", "In 6 months"],
  ["12", "In 1 year"],
  ["date", "On a date"],
];
const REPEAT = [
  ["", "Doesn't repeat"],
  ["1", "Every month"],
  ["3", "Every 3 months"],
  ["6", "Every 6 months"],
  ["12", "Every year"],
];

/** One reminder: when, how often, the note, and what can be done with it. */
function ReminderItem({ reminder, canEdit, canDelete, onDone, onSnooze, onDelete, onOpen }) {
  const due = isDue(reminder);
  return (
    <li className="rounded-md border border-stone-200 bg-surface p-2.5 text-xs">
      {onOpen ? (
        <button onClick={onOpen} title={reminder.targetName} className="block w-full truncate text-left text-sm font-medium text-stone-800 hover:text-teal-700 focus:outline-none focus-visible:underline">
          {reminder.targetName}
        </button>
      ) : null}
      <div className={"flex flex-wrap items-baseline gap-x-2 " + (onOpen ? "mt-0.5" : "")}>
        <span className={due ? "font-medium text-amber-800" : "text-stone-700"}>{dueLabel(reminder)}</span>
        {reminder.repeatMonths ? <span className="text-stone-500">{repeatLabel(reminder.repeatMonths)}</span> : null}
        <span className="ml-auto truncate text-stone-400">{reminder.createdBy}</span>
      </div>
      {reminder.note && <p className="mt-1 whitespace-pre-wrap break-words text-stone-600">{reminder.note}</p>}
      {((canEdit && due) || (canDelete && onDelete)) && (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {canEdit && due && (
          <>
            <button onClick={onDone} className="font-medium text-teal-700 hover:underline focus:outline-none focus-visible:underline">
              {reminder.repeatMonths ? "Done, next " + formatDate(nextDue(reminder)) : "Done"}
            </button>
            <button onClick={onSnooze} className="font-medium text-stone-600 hover:underline focus:outline-none focus-visible:underline">
              Snooze a week
            </button>
          </>
        )}
        {canDelete && onDelete && (
          <button onClick={onDelete} className="ml-auto text-stone-500 hover:text-red-700 hover:underline focus:outline-none focus-visible:underline">
            Delete
          </button>
        )}
      </div>
      )}
    </li>
  );
}

/** Where "Done" moves a repeating reminder — the server's rule, shown before it's clicked. */
function nextDue(reminder) {
  const today = localToday();
  let next = addMonths(reminder.dueOn, reminder.repeatMonths);
  while (next <= today) next = addMonths(next, reminder.repeatMonths);
  return next;
}

/** A setting's reminders in its drawer, and the form to add one. */
function RemindersSection({ reminders, canEdit, viewer, onAdd, onDone, onSnooze, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [when, setWhen] = useState("12");
  const [date, setDate] = useState(() => addMonths(localToday(), 1));
  const [repeat, setRepeat] = useState("");
  const [note, setNote] = useState("");
  const canDelete = (r) => viewer?.role === "admin" || (canEdit && Boolean(r.createdById) && r.createdById === viewer?.id);
  const dueOn = when === "date" ? date : addMonths(localToday(), Number(when));

  async function submit() {
    if (!dueOn) return;
    const saved = await onAdd({ dueOn, repeatMonths: repeat ? Number(repeat) : null, note: note.trim() });
    if (saved) {
      setAdding(false);
      setNote("");
      setRepeat("");
      setWhen("12");
    }
  }

  return (
    <section>
      <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">
        Reminders {reminders.length ? <span className="tabular-nums text-stone-400">· {reminders.length}</span> : null}
      </h3>

      {reminders.length > 0 && (
        <ul className="mt-2 space-y-2">
          {reminders.map((r) => (
            <ReminderItem
              key={r.id}
              reminder={r}
              canEdit={canEdit}
              canDelete={canDelete(r)}
              onDone={() => onDone(r.id)}
              onSnooze={() => onSnooze(r.id)}
              onDelete={() => onDelete(r.id)}
            />
          ))}
        </ul>
      )}

      {canEdit &&
        (adding ? (
          <div className="mt-2 space-y-2 rounded-md border border-stone-200 bg-surface p-2.5">
            <div className="flex flex-wrap gap-2">
              <select value={when} onChange={(e) => setWhen(e.target.value)} className={control} aria-label="When">
                {WHEN.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {when === "date" && (
                <input type="date" value={date} min={localToday()} onChange={(e) => setDate(e.target.value)} className={control} aria-label="Date" />
              )}
              <select value={repeat} onChange={(e) => setRepeat(e.target.value)} className={control} aria-label="Repeat">
                {REPEAT.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="What needs doing (optional)"
              className="w-full resize-none rounded-md border border-stone-300 bg-surface p-2.5 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
            />
            <div className="flex items-center gap-2">
              <button onClick={submit} disabled={!dueOn} className={quiet}>
                Add reminder for {dueOn ? formatDate(dueOn) : "…"}
              </button>
              <button onClick={() => setAdding(false)} className="text-xs text-stone-500 hover:underline focus:outline-none focus-visible:underline">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className={quiet + " mt-2"}>
            Add reminder
          </button>
        ))}
      {!canEdit && reminders.length === 0 && <p className="mt-2 text-xs text-stone-400">None</p>}
    </section>
  );
}

/**
 * The bell in the sidebar: how many reminders are due, and every reminder
 * on the instance in a panel, due ones first. The panel is placed against
 * the viewport — the sidebar scrolls, and would clip it.
 */
function ReminderBell({ reminders, canEdit, onOpen, onDone, onSnooze, className = "" }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const button = useRef(null);
  const today = localToday();
  const due = reminders.filter((r) => isDue(r, today));
  const upcoming = reminders.filter((r) => !isDue(r, today));

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle() {
    const rect = button.current.getBoundingClientRect();
    // Beside the sidebar on a wide screen, below the top bar on a narrow one.
    const wide = window.innerWidth >= 1024;
    const edge = button.current.closest("aside")?.getBoundingClientRect().right ?? rect.right;
    setPlace(wide ? { top: rect.top - 4, left: edge + 8 } : { top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen((o) => !o);
  }

  const item = (r) => (
    <ReminderItem
      key={r.id}
      reminder={r}
      canEdit={canEdit}
      canDelete={false}
      onOpen={() => {
        setOpen(false);
        onOpen(r.targetKey);
      }}
      onDone={() => onDone(r.id)}
      onSnooze={() => onSnooze(r.id)}
    />
  );

  return (
    <>
      <button
        ref={button}
        onClick={toggle}
        title={due.length ? `${due.length} reminder${due.length === 1 ? "" : "s"} due` : "Reminders"}
        aria-label={due.length ? `Reminders, ${due.length} due` : "Reminders"}
        aria-expanded={open}
        className={"relative shrink-0 rounded-md p-1.5 text-teal-300 hover:bg-teal-800 hover:text-teal-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-300 " + className}
      >
        <Bell weight="bold" className="h-4 w-4" />
        {due.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-semibold leading-none text-teal-950 tabular-nums">
            {due.length}
          </span>
        )}
      </button>
      {/* Outside the sidebar in the page, so it takes the content's colours, not the sidebar's greens. */}
      {open &&
        createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Reminders"
            style={place ?? undefined}
            className="fixed z-50 flex max-h-[min(36rem,calc(100vh-2rem))] w-80 max-w-[calc(100vw-1rem)] animate-rise-in flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-50 text-stone-900 shadow-xl"
          >
            <div className="border-b border-stone-200 px-3 py-2.5 font-heading text-sm font-semibold">Reminders</div>
            <div className="space-y-4 overflow-y-auto p-3">
              {reminders.length === 0 && <p className="py-6 text-center text-xs text-stone-500">No reminders</p>}
              {due.length > 0 && (
                <div>
                  <h4 className="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">Due · {due.length}</h4>
                  <ul className="mt-2 space-y-2">{due.map(item)}</ul>
                </div>
              )}
              {upcoming.length > 0 && (
                <div>
                  <h4 className="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">Upcoming · {upcoming.length}</h4>
                  <ul className="mt-2 space-y-2">{upcoming.map(item)}</ul>
                </div>
              )}
            </div>
          </div>
        </>,
          document.body,
        )}
    </>
  );
}

export { RemindersSection, ReminderBell };
