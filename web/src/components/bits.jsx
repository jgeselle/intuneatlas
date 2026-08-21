import { useState } from "react";
import { Check, CaretRight, Copy } from "@phosphor-icons/react";

function Chip({ className = "", children }) {
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset " + className}>
      {children}
    </span>
  );
}

function Diff({ from, to }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-stone-500 line-through decoration-stone-300">{from}</span>
      <CaretRight className="h-4 w-4 shrink-0 text-stone-400" />
      <span className="rounded border border-teal-200 bg-teal-50 px-2 py-1 font-medium text-teal-800">{to}</span>
    </div>
  );
}

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
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
      {label ? <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div> : null}
      <div className="mt-1.5 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-stone-700">{value}</code>
        <button
          onClick={copy}
          className="shrink-0 rounded px-1.5 py-1 text-stone-400 hover:bg-white hover:text-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
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

/**
 * One "policy name -> value" row, used for both a conflict's disagreeing
 * sources and the plain "set by" list. A short, single-line value stays
 * as the original compact inline pill; anything longer or multi-line
 * switches to a stacked layout instead of forcing a pill (meant for
 * "Enabled", not a 1,000-character blob) to hold it.
 */
function SourceRow({ policyName, value, tone = "default" }) {
  const isSimple = typeof value === "string" && !value.includes("\n") && value.length <= 50;
  const alert = tone === "alert";

  if (isSimple) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className={"truncate text-xs " + (alert ? "text-red-900" : "")}>{policyName}</span>
        <span
          className={
            "shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium " +
            (alert ? "border-red-200 bg-white text-red-800" : "border-stone-200 bg-stone-50 text-stone-700")
          }
        >
          {value}
        </span>
      </div>
    );
  }
  return (
    <div>
      <div className={"text-xs font-medium " + (alert ? "text-red-900" : "")}>{policyName}</div>
      <div className="mt-1">
        <ValueDisplay value={value} compact />
      </div>
    </div>
  );
}

function NoteThread({ notes = [], onAdd, readOnly = false }) {
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  }

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        Notes {notes.length ? <span className="tabular-nums text-stone-400">· {notes.length}</span> : null}
      </h3>

      {notes.length > 0 && (
        <ul className="mt-2 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-stone-700">{n.author}</span>
                <span className="shrink-0 text-stone-400">{new Date(n.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-stone-600">{n.text}</p>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={notes.length ? "Add to the thread" : "Why is it set this way? Write it down for whoever looks next."}
            className="w-full resize-none rounded-md border border-stone-300 bg-white p-2.5 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="mt-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:text-stone-300 disabled:ring-stone-200"
          >
            Add note
          </button>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub, tone = "neutral", icon: Icon }) {
  const iconTone =
    tone === "amber" ? "text-amber-500" : tone === "alert" ? "text-red-500" : tone === "brand" ? "text-teal-600" : "text-stone-400";
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-1.5">
        {Icon ? <Icon className={"h-3.5 w-3.5 shrink-0 " + iconTone} /> : null}
        <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-stone-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-stone-500">{sub}</div> : null}
    </div>
  );
}

function NotAvailableYet({ title, children }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-10 text-center">
      <p className="text-sm font-medium text-stone-600">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-stone-500">{children}</p>
    </div>
  );
}

export { Chip, Diff, RefPath, NoteThread, Stat, NotAvailableYet, ValueDisplay, SourceRow };
