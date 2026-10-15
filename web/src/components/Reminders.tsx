import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Bell } from "@phosphor-icons/react";
import { addMonths, dueLabel, formatDate, isDue, localToday, repeatLabel } from "../lib/reminders.js";
import type { Reminder, Session } from "../types.js";

/** What the form sends; the server adds the setting and who made it. */
export interface ReminderInput {
  dueOn: string;
  repeatMonths: number | null;
  note: string;
}

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
interface ReminderItemProps {
  reminder: Reminder;
  canEdit: boolean;
  canDelete: boolean;
  onDone: () => void;
  onSnooze: () => void;
  onDelete?: () => void;
  onOpen?: () => void;
}

function ReminderItem({ reminder, canEdit, canDelete, onDone, onSnooze, onDelete, onOpen }: ReminderItemProps) {
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
function nextDue(reminder: Reminder): string {
  const today = localToday();
  const months = reminder.repeatMonths ?? 0;
  let next = addMonths(reminder.dueOn, months);
  while (next <= today) next = addMonths(next, months);
  return next;
}

/** A setting's reminders in its drawer, and the form to add one. */
interface RemindersSectionProps {
  reminders: Reminder[];
  canEdit: boolean;
  viewer: Session | null;
  /** Resolves to whether it was kept, so the form knows whether to clear itself. */
  onAdd: (input: ReminderInput) => Promise<boolean>;
  onDone: (id: number) => void;
  onSnooze: (id: number) => void;
  onDelete: (id: number) => void;
}

function RemindersSection({ reminders, canEdit, viewer, onAdd, onDone, onSnooze, onDelete }: RemindersSectionProps) {
  const [adding, setAdding] = useState(false);
  const [when, setWhen] = useState("12");
  const [date, setDate] = useState(() => addMonths(localToday(), 1));
  const [repeat, setRepeat] = useState("");
  const [note, setNote] = useState("");
  const canDelete = (r: Reminder) => viewer?.role === "admin" || (canEdit && Boolean(r.createdById) && r.createdById === viewer?.id);
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
 * The bell in the sidebar header: how many reminders are due, and every
 * reminder on the instance in a panel, due ones first. Behaves like the
 * account menu — opens inside the sidebar at its width (`rail`), keeps a
 * collapsed sidebar open while it's up (`onOpenChange`), and on a narrow
 * screen hangs below the top bar instead (`bar`).
 */
interface ReminderBellProps {
  reminders: Reminder[];
  canEdit: boolean;
  /** Opens the setting a reminder is on, by its key. */
  onOpen: (key: string) => void;
  onDone: (id: number) => void;
  onSnooze: (id: number) => void;
  onOpenChange?: (open: boolean) => void;
  placement?: "rail" | "bar";
  className?: string;
}

function ReminderBell({ reminders, canEdit, onOpen, onDone, onSnooze, onOpenChange, placement = "rail", className = "" }: ReminderBellProps) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const today = localToday();
  const due = reminders.filter((r) => isDue(r, today));
  const upcoming = reminders.filter((r) => !isDue(r, today));

  useEffect(() => {
    onOpenChange?.(open);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wider than the sidebar, which would clip it — so it's put in the page and lined up with the
  // sidebar's header from there: from the sidebar's left edge, or under the top bar's right end.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const header = button.current?.parentElement?.getBoundingClientRect();
      const aside = button.current?.closest("aside")?.getBoundingClientRect();
      if (!header) return;
      setPlace(placement === "rail" ? { top: header.bottom - 4, left: (aside?.left ?? 0) + 12 } : { top: header.bottom + 4, right: 12 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const list = (title: string, items: Reminder[]) =>
    items.length > 0 && (
      <div>
        <h4 className="px-0.5 font-sans text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          {title} <span className="tabular-nums text-stone-400">· {items.length}</span>
        </h4>
        <ul className="mt-1.5 space-y-1.5">
          {items.map((r) => (
            <PanelItem
              key={r.id}
              reminder={r}
              canEdit={canEdit}
              onOpen={() => {
                setOpen(false);
                onOpen(r.targetKey);
              }}
              onDone={() => onDone(r.id)}
              onSnooze={() => onSnooze(r.id)}
            />
          ))}
        </ul>
      </div>
    );

  return (
    <>
      <button
        ref={button}
        onClick={() => setOpen((o) => !o)}
        title={due.length ? `${due.length} reminder${due.length === 1 ? "" : "s"} due` : "Reminders"}
        aria-label={due.length ? `Reminders, ${due.length} due` : "Reminders"}
        aria-haspopup="true"
        aria-expanded={open}
        className={
          "relative shrink-0 rounded-md p-1.5 text-teal-300 hover:bg-teal-800 hover:text-teal-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-300 " +
          (open ? "bg-teal-800 text-teal-100 " : "") +
          className
        }
      >
        <Bell weight="bold" className="h-4 w-4" />
        {due.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-semibold leading-none text-teal-950 tabular-nums">
            {due.length}
          </span>
        )}
      </button>

      {createPortal(
        <>
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      {/* Always mounted, like the account menu's, so closing plays its transition. */}
      <div
        role="dialog"
        style={place ?? { top: 0, left: 0 }}
        aria-label="Reminders"
        aria-hidden={!open}
        className={
          "fixed z-50 flex max-h-[min(34rem,calc(100vh-6rem))] w-[min(21rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-stone-200 bg-surface text-stone-900 shadow-xl transition duration-150 ease-out " +
          (placement === "rail" ? "origin-top-left " : "origin-top-right ") +
          (open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1.5 scale-95 opacity-0")
        }
      >
        <div className="flex items-baseline justify-between border-b border-stone-100 px-3 py-2.5">
          <span className="text-sm font-medium">Reminders</span>
          {reminders.length > 0 && <span className="text-xs tabular-nums text-stone-400">{reminders.length}</span>}
        </div>
        <div className="space-y-3 overflow-y-auto p-2.5">
          {reminders.length === 0 ? <p className="py-5 text-center text-xs text-stone-500">No reminders</p> : null}
          {list("Due", due)}
          {list("Upcoming", upcoming)}
        </div>
      </div>
        </>,
        document.body,
      )}
    </>
  );
}

/** A reminder in the bell's panel — compact: the panel is only as wide as the sidebar. */
function PanelItem({ reminder, canEdit, onOpen, onDone, onSnooze }: Omit<ReminderItemProps, "canDelete" | "onDelete" | "onOpen"> & { onOpen: () => void }) {
  const due = isDue(reminder);
  return (
    <li className="rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
      <button onClick={onOpen} title={reminder.targetName} className="line-clamp-2 w-full text-left font-medium text-stone-800 hover:underline focus:outline-none focus-visible:underline">
        {reminder.targetName}
      </button>
      <div className="mt-0.5 flex flex-wrap gap-x-2">
        <span className={due ? "font-medium text-amber-700" : "text-stone-600"}>{dueLabel(reminder)}</span>
        {reminder.repeatMonths ? <span className="text-stone-400">{repeatLabel(reminder.repeatMonths)}</span> : null}
      </div>
      {reminder.note && <p className="mt-1 line-clamp-3 break-words text-stone-600">{reminder.note}</p>}
      {canEdit && due && (
        <div className="mt-2 flex gap-1.5 whitespace-nowrap">
          <button
            onClick={onDone}
            title={reminder.repeatMonths ? "Next: " + formatDate(nextDue(reminder)) : undefined}
            className="flex-1 rounded-md bg-surface px-2 py-1 font-medium text-stone-700 ring-1 ring-inset ring-stone-300 hover:bg-stone-100 focus:outline-none focus-visible:ring-stone-500"
          >
            Done
          </button>
          <button
            onClick={onSnooze}
            title="Remind again in a week"
            className="flex-1 rounded-md bg-surface px-2 py-1 font-medium text-stone-700 ring-1 ring-inset ring-stone-300 hover:bg-stone-100 focus:outline-none focus-visible:ring-stone-500"
          >
            Snooze 1 week
          </button>
        </div>
      )}
    </li>
  );
}

export { RemindersSection, ReminderBell };
