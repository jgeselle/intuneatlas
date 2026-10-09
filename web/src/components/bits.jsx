import { useState } from "react";
import { Dropdown } from "./Dropdown.jsx";
import { Check, CaretRight, Copy, Trash } from "@phosphor-icons/react";
import { SEVERITY_STYLE } from "../lib/styles.js";

function Chip({ className = "", children }) {
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset " + className}>
      {children}
    </span>
  );
}

/** How many changed lines a multi-line comparison shows before folding the rest away. */
const LINE_DIFF_LIMIT = 10;

function LineDiff({ from, to }) {
  const [expanded, setExpanded] = useState(false);
  const before = String(from).split("\n").filter(Boolean);
  const after = String(to).split("\n").filter(Boolean);
  const removed = before.filter((line) => !after.includes(line)).map((line) => ({ line, kind: "removed" }));
  const added = after.filter((line) => !before.includes(line)).map((line) => ({ line, kind: "added" }));
  const unchanged = after.length - added.length;
  // A whole firewall rule set staged at once is hundreds of lines — shown in full only on request.
  const all = [...removed, ...added];
  const shown = expanded ? all : all.slice(0, LINE_DIFF_LIMIT);

  return (
    <div className="space-y-1 text-xs">
      {shown.map(({ line, kind }, i) => (
        <div
          key={i}
          className={
            "break-words rounded border px-2 py-1 " +
            (kind === "removed" ? "border-stone-200 bg-stone-50 text-stone-500 line-through decoration-stone-300" : "border-teal-200 bg-teal-50 font-medium text-teal-800")
          }
        >
          {line}
        </div>
      ))}
      <div className="flex flex-wrap gap-x-3 text-stone-400">
        {all.length > LINE_DIFF_LIMIT && (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="font-medium text-teal-700 hover:underline focus:outline-none">
            {expanded ? "Show fewer" : "Show all " + all.length + " lines"}
          </button>
        )}
        {unchanged > 0 && <span>{unchanged} unchanged</span>}
      </div>
    </div>
  );
}

/**
 * Old value -> new value. Single values sit side by side; a value made of
 * several lines (a list, a group, a choice with sub-settings) is compared
 * line by line instead — what was removed, what was added — since two
 * multi-line blobs next to each other don't show what actually changed.
 */
function Diff({ from, to }) {
  if (String(from).includes("\n") || String(to).includes("\n")) return <LineDiff from={from} to={to} />;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-stone-500 line-through decoration-stone-300">{from}</span>
      <CaretRight className="h-4 w-4 shrink-0 text-stone-400" />
      <span className="rounded border border-teal-200 bg-teal-50 px-2 py-1 font-medium text-teal-800">{to}</span>
    </div>
  );
}

/**
 * A page's subtitle: which group the page is showing — also where that is
 * chosen, for every page at once — then whatever fact the page has to
 * state about itself (a count, a location). `scope` is absent on pages a
 * group doesn't change and in tenants with no groups to choose from; with
 * neither part there is no subtitle at all. Pages don't describe themselves.
 */
function PageSubtitle({ scope, children }) {
  const hasFact = children !== undefined && children !== null && children !== false && children !== "";
  if (!scope && !hasFact) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-stone-500">
      {scope && <Dropdown inline searchable value={scope.value} options={scope.options} onChange={scope.onChange} ariaLabel="Show everything for" />}
      {scope && hasFact && <span>·</span>}
      {hasFact && <span className="min-w-0">{children}</span>}
    </div>
  );
}

/**
 * "There is nothing here", said the same way everywhere: one muted,
 * centred line stating what is absent — no icon, no advice.
 *
 * - default: a page whose list is empty — a dashed outline where the
 *   list would be.
 * - `bare`: inside something that already has its own border (a card, a
 *   table) — the line alone.
 * - `compact`: a section of the setting panel — the dashed outline at
 *   the panel's smaller scale.
 */
function Empty({ children, bare = false, compact = false }) {
  const size = compact ? "px-3 py-4 text-xs" : bare ? "px-4 py-10 text-sm" : "px-4 py-12 text-sm";
  const outline = bare ? "" : "rounded-lg border border-dashed border-stone-300 " + (compact ? "bg-stone-50 " : "bg-white ");
  return <p className={outline + size + " text-center text-stone-500"}>{children}</p>;
}

/** A baseline's severity for a setting — nothing at all when the baseline doesn't rate it (a plain exported policy doesn't). */
function SeverityChip({ severity, className = "" }) {
  const style = SEVERITY_STYLE[severity];
  return style ? <Chip className={className + " " + style.chip}>{style.label}</Chip> : null;
}

/**
 * Where a setting falls short of a baseline, one row per shortfall: the
 * sub-setting it concerns (if it isn't the setting itself), what the
 * tenant has, and what the baseline expects. Only the shortfalls — a
 * baseline is a floor, so whatever else the tenant configures isn't
 * listed as a difference.
 */
function Differences({ differences }) {
  return (
    <ul className="space-y-2">
      {differences.map((d, i) => (
        <li key={i}>
          {d.path.length > 0 && <div className="mb-1 text-xs font-medium leading-snug text-stone-600">{d.path.join(" › ")}</div>}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={
                "min-w-0 break-words rounded border border-stone-200 bg-stone-50 px-2 py-1 text-stone-500 " +
                (d.actual === null ? "italic" : "line-through decoration-stone-300")
              }
            >
              {d.actual === null ? "Not set" : clip(d.actual)}
            </span>
            <CaretRight className="h-4 w-4 shrink-0 text-stone-400" />
            <span className="min-w-0 break-words rounded border border-teal-200 bg-teal-50 px-2 py-1 font-medium text-teal-800">{clip(d.expected)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Some single values are enormous (an encoded XML blob); a comparison row shows enough to recognise it. */
function clip(text) {
  const s = String(text);
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

/** The setting's reference path with a copy button — part of what identifies the setting, so it sits in the drawer header. */
function RefPath({ value, label }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      {label ? <div className="text-xs uppercase tracking-wide text-stone-400">{label}</div> : null}
      <div className="mt-0.5 flex items-start gap-1.5">
        <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-stone-600">{value}</code>
        <button
          onClick={copy}
          className="-mt-0.5 shrink-0 rounded px-1.5 py-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
          aria-label="Copy path"
          title="Copy path"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-teal-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

/**
 * A single value line, wrapping instead of overflowing (long unbroken
 * strings — base64 blobs, GUIDs — have no spaces to wrap at without
 * break-words) and truncated-with-toggle past a length that stops being
 * skimmable rather than dumped in full every time.
 */
function ExpandableText({ text, compact = false }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 180;
  const shown = isLong && !expanded ? text.slice(0, 180) + "…" : text;

  return (
    <span className={"break-words " + (compact ? "text-xs" : "text-sm")}>
      {shown}
      {isLong && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="ml-1.5 whitespace-nowrap text-xs font-medium text-teal-700 hover:underline focus:outline-none"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </span>
  );
}

/**
 * A setting value, which — unlike the plain string this used to be
 * treated as everywhere — can be several discrete things joined by a
 * newline (a group setting's children, a dependent choice's child, a
 * collection's items). Rendered as a real list instead of one run-on
 * string, so a real conflict between two 1,000+ character group settings
 * is actually legible instead of an unreadable comma-joined blob.
 */
function ValueDisplay({ value, compact = false }) {
  const lines = String(value ?? "")
    .split("\n")
    .filter((l) => l.length > 0);

  if (lines.length <= 1) {
    return <ExpandableText text={lines[0] ?? ""} compact={compact} />;
  }
  return (
    <ul className={compact ? "space-y-1" : "space-y-1.5"}>
      {lines.map((line, i) => (
        <li key={i}>
          <ExpandableText text={line} compact={compact} />
        </li>
      ))}
    </ul>
  );
}

/** A note entry in the history feed. */
function NoteEntry({ note, onDelete, canDelete }) {
  return (
    <li className="animate-rise-in rounded-md border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-stone-700">{note.author}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-stone-400">
          {new Date(note.createdAt).toLocaleDateString()}
          {onDelete && canDelete && (
            <button
              onClick={() => onDelete(note.id)}
              aria-label="Delete note"
              title="Delete note"
              className="rounded p-0.5 hover:bg-stone-200 hover:text-stone-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
            >
              <Trash className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-stone-600">{note.text}</p>
    </li>
  );
}

/**
 * The notes on a setting or policy, newest first. Staged changes used to
 * be mixed into this feed; they now show on the policy they change (see
 * PolicyValueCard in SettingDrawer.jsx), so this is notes only.
 */
function NotesSection({ notes = [], onAdd, onDelete, readOnly = false, viewer }) {
  const [draft, setDraft] = useState("");
  // Whoever wrote a note can delete it themselves; an Admin can delete
  // any — mirrors the same author-or-admin check the server enforces
  // (src/auth/roles.ts's deleteNote capability).
  const canDeleteNote = (note) => viewer?.role === "admin" || (Boolean(note.authorId) && note.authorId === viewer?.id);

  const entries = [...notes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  }

  return (
    <section>
      <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">
        Notes {entries.length ? <span className="tabular-nums text-stone-400">· {entries.length}</span> : null}
      </h3>

      {!readOnly && (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Add a note"
            className="w-full resize-none rounded-md border border-stone-300 bg-white p-2.5 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="mt-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:text-stone-300 disabled:ring-stone-200"
          >
            Add note
          </button>
        </div>
      )}

      {entries.length > 0 && (
        <ul className="mt-3 space-y-2">
          {entries.map((note) => (
            <NoteEntry key={note.id} note={note} onDelete={onDelete} canDelete={canDeleteNote(note)} />
          ))}
        </ul>
      )}
    </section>
  );
}

const HISTORY_TEXT = {
  added: "Started setting it",
  removed: "No longer sets it",
  assigned: "Now assigned",
  unassigned: "No longer assigned",
};

/**
 * What has happened to a setting, newest first. Most entries are what a
 * scan saw: a policy began or stopped setting it, changed its value, or
 * gained or lost its assignment — dated by the scan that showed it. A
 * change pushed from the change log is the other kind, recorded when it
 * was pushed, with who did it and the reason given. `events` is undefined
 * while loading or where history isn't available — then there is no
 * section at all.
 */
function HistoryList({ events }) {
  if (!events) return null;
  return (
    <section>
      <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">
        History{events.length > 0 && <span className="ml-1.5 font-normal tabular-nums text-stone-400">· {events.length}</span>}
      </h3>
      {events.length === 0 ? (
        <div className="mt-2">
          <Empty compact>No changes recorded</Empty>
        </div>
      ) : (
        <ol className="mt-2 space-y-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-md border border-stone-200 bg-white px-3 py-2.5 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium text-stone-800" title={event.policyName}>
                  {event.policyName}
                </span>
                <time className="shrink-0 tabular-nums text-stone-400" dateTime={event.at} title={event.since ? "Between the scans of " + new Date(event.since).toLocaleString() + " and " + new Date(event.at).toLocaleString() : undefined}>
                  {new Date(event.at).toLocaleDateString()}
                </time>
              </div>
              {event.kind === "pushed" ? (
                // The one kind the app did itself, so the one that knows who and why.
                <div className="mt-1.5 space-y-1.5">
                  {event.from !== undefined ? <Diff from={event.from} to={event.to} /> : <p className="text-stone-700">{String(event.to).split("\n").join(", ")}</p>}
                  {event.reason && <p className="leading-relaxed text-stone-700">{event.reason}</p>}
                  <p className="text-stone-500">
                    {["Pushed by " + event.pushedBy, event.stagedBy && event.stagedBy !== event.pushedBy ? "staged by " + event.stagedBy : null, event.reviewedBy ? "reviewed by " + event.reviewedBy : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-stone-400">
                    {event.confirmedAt ? "Seen in the tenant by the scan of " + new Date(event.confirmedAt).toLocaleDateString() : "Not seen by a scan yet"}
                  </p>
                </div>
              ) : event.kind === "changed" ? (
                <div className="mt-1.5">
                  <Diff from={event.from} to={event.to} />
                </div>
              ) : (
                <p className="mt-1 text-stone-600">
                  {HISTORY_TEXT[event.kind] ?? event.kind}
                  {(event.to ?? event.from) !== undefined && (
                    <span className="text-stone-500">
                      {event.kind === "removed" ? " · was " : " · "}
                      <span className="text-stone-700">{String(event.to ?? event.from).split("\n").join(", ")}</span>
                    </span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * One number at the top of a page. The label is deliberately quiet —
 * small, sentence case, no icon — so the number is what is read.
 */
function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-[11px] leading-4 text-stone-500">{label}</div>
      <div className="mt-1.5 text-3xl font-semibold tabular-nums text-stone-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-stone-500">{sub}</div> : null}
    </div>
  );
}

export { Chip, Empty, PageSubtitle, SeverityChip, Diff, Differences, RefPath, NotesSection, HistoryList, Stat, ValueDisplay };
