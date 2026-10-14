import { useEffect, useMemo, useState } from "react";
import { Check, MagnifyingGlass, PaperPlaneTilt, PencilSimple } from "@phosphor-icons/react";
import { Chip, Diff, PageSubtitle, Empty, RevertButton } from "../components/bits.jsx";

/**
 * The step that writes to the tenant, kept deliberate: the button asks
 * once more, naming exactly what will happen, before anything is sent.
 * A refusal — the tenant value changed since staging, the app has no
 * write permission — is shown right here, in full.
 */
function PushButton({ label, confirmText, confirmLabel, onPush, full = false }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function push() {
    setBusy(true);
    setError(null);
    const problem = await onPush();
    // On success the change leaves the list, and this with it.
    if (problem) {
      setError(problem);
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <div className={full ? "w-full" : ""}>
      {asking ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-stone-700">{confirmText}</p>
          <button
            type="button"
            onClick={push}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 dark:hover:bg-teal-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-300"
          >
            <PaperPlaneTilt className="h-3.5 w-3.5" />
            {busy ? "Pushing…" : confirmLabel}
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            disabled={busy}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAsking(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 dark:hover:bg-teal-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500"
        >
          <PaperPlaneTilt className="h-3.5 w-3.5" />
          {label}
        </button>
      )}
      {error && <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">{error}</p>}
    </div>
  );
}

const quietButton =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:text-stone-300";

/** A time as people say it: "today 14:05", "yesterday", or the date. */
function when(iso) {
  const d = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return "today " + time;
  if (days === 1) return "yesterday " + time;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The reason, always open to whoever may edit it: typed straight in, and
 * kept as soon as the field is left — no save button. Everyone else reads
 * it as text.
 */
function Reason({ value, setValue, canEdit, onSave }) {
  if (!canEdit) {
    return value.trim() ? <p className="text-xs leading-relaxed text-stone-700 [overflow-wrap:anywhere]">{value}</p> : <p className="text-xs text-stone-400">No reason given yet</p>;
  }
  return (
    <label className="block">
      <span className="sr-only">Reason</span>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={onSave}
        rows={2}
        placeholder="Why this change?"
        className="w-full resize-y rounded-md border border-stone-200 bg-stone-50 p-2 text-xs leading-relaxed placeholder-stone-400 hover:border-stone-300 focus:border-teal-600 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-teal-600"
      />
    </label>
  );
}

/**
 * One staged change: what it is and where, the value before and after,
 * why — then, in one row at the foot, its review, taking it back, and
 * pushing it once it's ready.
 */
function ChangeCard({ change, onUpdateField, onRevert, onPush, viewer, inGroup = false, onOpen }) {
  // Contributors can only touch changes they staged themselves; Admins can
  // touch any — mirrors the server-side editChange/revertChange check.
  // Compared by id (Entra object ID), not display name — names aren't
  // unique or stable.
  const canEdit = viewer.role === "admin" || (viewer.role === "contributor" && change.stagedBy === viewer.id);
  const canPush = !inGroup && change.ready && onPush && viewer.role === "admin";
  // The reason as typed, before it's kept — so "Mark reviewed" can appear as soon as there is one.
  const [reason, setReason] = useState(change.reason);
  useEffect(() => setReason(change.reason), [change.reason]);
  const saveReason = async () => {
    if (reason !== change.reason) await onUpdateField(change.id, "reason", reason);
  };

  return (
    <li className="animate-rise-in rounded-lg border border-stone-200 bg-surface">
      <div className="p-4">
        {/* On a phone the status goes above the name, so neither squeezes the other. */}
        <div className="flex flex-col-reverse items-start gap-1.5 sm:flex-row sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium [overflow-wrap:anywhere]">
              {/* The setting's name opens its panel — where the staged value can be looked at in context and edited. */}
              {onOpen ? (
                <button type="button" onClick={onOpen} className="rounded text-left hover:text-teal-700 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500">
                  {change.targetName}
                </button>
              ) : (
                change.targetName
              )}
            </h3>
            <p className="mt-0.5 text-xs text-stone-500 [overflow-wrap:anywhere]">
              {/* Inside a new policy's group the name is the group's heading already. */}
              {[!inGroup && change.policyName, change.stagedByName && "staged by " + change.stagedByName, change.updatedAt && when(change.updatedAt)].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Chip className={"shrink-0 " + (change.ready ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-amber-50 text-amber-800 ring-amber-200")}>
            {change.ready ? "Ready" : !change.reason.trim() && !change.reviewedBy ? "Needs reason and review" : !change.reason.trim() ? "Needs a reason" : "Needs review"}
          </Chip>
        </div>

        <div className="mt-3 min-w-0">
          <Diff from={change.from} to={change.to} />
        </div>

        <div className="mt-3">
          <Reason value={reason} setValue={setReason} canEdit={canEdit} onSave={saveReason} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-stone-100 px-4 py-2.5">
        {change.reviewedBy ? (
          // Reviewed — by whoever it was, not only by the person looking. "Undo" takes the review back.
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-teal-700">
            <Check weight="bold" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Reviewed by {change.reviewedBy}</span>
            {canEdit && (
              <button type="button" onClick={() => onUpdateField(change.id, "reviewedBy", "")} className="font-medium text-stone-500 hover:underline focus:outline-none focus-visible:underline">
                Undo
              </button>
            )}
          </span>
        ) : (
          // A change is reviewed with its reason, so the button is there once one is written — kept first if it's still being typed.
          reason.trim() &&
          canEdit && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={async () => {
                await saveReason();
                await onUpdateField(change.id, "reviewedBy", viewer.name);
              }}
              className={quietButton + " ring-1 ring-inset ring-stone-300"}
            >
              <Check className="h-3.5 w-3.5" />
              Mark reviewed
            </button>
          )
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {canEdit && <RevertButton onRevert={() => onRevert(change.id, change.targetKey)} className="text-xs" />}
          {/* A change to an existing policy is pushed on its own; one of a new policy's settings goes with the policy (see NewPolicyGroup). */}
          {canPush && (
            <PushButton
              label="Push to tenant"
              confirmText={
                change.toStructured?.kind === "removed" ? (
                  <>
                    Removes <span className="font-medium">{change.targetName}</span> from <span className="font-medium">{change.policyName || "the policy"}</span> in Intune.
                  </>
                ) : (
                  <>Writes the new value to <span className="font-medium">{change.policyName || "the policy"}</span> in Intune.</>
                )
              }
              confirmLabel="Push"
              onPush={() => onPush(change)}
            />
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Every setting staged into the same not-yet-existing policy, under that
 * policy's name — together they are the policy to be created. Renaming it
 * renames it for all of them.
 */
function NewPolicyGroup({ name, changes, onUpdateField, onRevert, onPush, viewer, openerFor }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  // Same rule as a single change: your own, unless you're an Admin — and a rename touches every change in the group.
  const canRename = changes.every((c) => viewer.role === "admin" || (viewer.role === "contributor" && c.stagedBy === viewer.id));

  async function save(e) {
    e.preventDefault();
    const next = draft.trim();
    if (next && next !== name) {
      for (const change of changes) await onUpdateField(change.id, "policyName", next);
    }
    setRenaming(false);
  }

  return (
    <li className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip className="bg-teal-50 text-teal-700 ring-teal-200">New policy</Chip>
        {renaming ? (
          <form onSubmit={save} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-stone-300 bg-surface px-2.5 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
            />
            <button type="submit" disabled={!draft.trim()} className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white dark:text-stone-50 disabled:bg-stone-200 disabled:text-stone-400">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(name);
                setRenaming(false);
              }}
              className={quietButton}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h3 className="min-w-0 font-heading text-sm font-semibold [overflow-wrap:anywhere]">{name}</h3>
            <span className="text-xs tabular-nums text-stone-400">
              {changes.length} {changes.length === 1 ? "setting" : "settings"}
            </span>
            {canRename && (
              <button onClick={() => setRenaming(true)} className={quietButton + " ml-auto"}>
                <PencilSimple className="h-3.5 w-3.5" />
                Rename
              </button>
            )}
          </>
        )}
      </div>
      <ul className="space-y-3">
        {changes.map((c) => (
          <ChangeCard key={c.id} change={c} onUpdateField={onUpdateField} onRevert={onRevert} viewer={viewer} inGroup onOpen={openerFor(c)} />
        ))}
      </ul>
      {/* The policy is created from all of its settings at once, so all of them have to be ready. */}
      {onPush && viewer.role === "admin" && changes.every((c) => c.ready) && (
        <div className="flex justify-end">
          <PushButton
            label="Create policy in tenant"
            confirmText={
              <>
                Creates <span className="font-medium">{name}</span> in Intune with {changes.length === 1 ? "this setting" : "these " + changes.length + " settings"}. It won't be assigned to anyone.
              </>
            }
            confirmLabel="Create"
            onPush={() => onPush(changes[0])}
          />
        </div>
      )}
    </li>
  );
}

const SEEN_TEXT = {
  added: "Now set by",
  removed: "No longer set by",
  changed: "Value changed in",
  assigned: "Now assigned:",
  unassigned: "No longer assigned:",
};

/** A short value for a log row: its lines joined, cut down to something a row can hold. */
const short = (value) => {
  const text = String(value ?? "").split("\n").filter(Boolean).join(", ");
  return text.length > 140 ? text.slice(0, 140) + "…" : text;
};

/** One thing that happened: pushed from here, or seen by a scan. */
function LogRow({ event, onOpen }) {
  const pushed = event.kind === "pushed";
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 px-4 py-2.5 text-xs sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <time className="pt-px tabular-nums text-stone-400" dateTime={event.at} title={new Date(event.at).toLocaleString()}>
        {new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </time>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {onOpen ? (
            <button type="button" onClick={onOpen} className="min-w-0 text-left text-sm font-medium text-stone-800 hover:text-teal-700 hover:underline focus:outline-none focus-visible:underline [overflow-wrap:anywhere]">
              {event.settingName}
            </button>
          ) : (
            <span className="min-w-0 text-sm font-medium text-stone-800 [overflow-wrap:anywhere]">{event.settingName}</span>
          )}
          {pushed && <Chip className="bg-teal-50 text-teal-700 ring-teal-200">Pushed</Chip>}
        </div>
        <p className="mt-0.5 text-stone-500 [overflow-wrap:anywhere]">
          {pushed ? (
            <>
              {"In " + event.policyName + " by " + event.pushedBy}
              {event.reviewedBy ? ", reviewed by " + event.reviewedBy : ""}
              {event.confirmedAt ? "" : " · not seen by a scan yet"}
            </>
          ) : (
            <>
              {SEEN_TEXT[event.kind] ?? event.kind} {event.policyName}
            </>
          )}
        </p>
        {(event.from !== undefined || event.to !== undefined) && (
          <p className="mt-1 text-stone-600 [overflow-wrap:anywhere]">
            {event.from !== undefined && event.to !== undefined ? (
              <>
                <span className="text-stone-400 line-through decoration-stone-300">{short(event.from)}</span>
                <span className="mx-1.5 text-stone-400">→</span>
                <span className="font-medium text-stone-700">{short(event.to)}</span>
              </>
            ) : (
              <span>{short(event.to ?? event.from)}</span>
            )}
          </p>
        )}
        {pushed && event.reason && <p className="mt-1 italic text-stone-500 [overflow-wrap:anywhere]">{event.reason}</p>}
      </div>
    </li>
  );
}

const day = (iso) => new Date(iso).toDateString();
function dayLabel(iso) {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const FILTERS = ["All", "Staged", "Pushed", "Seen in scans"];
const LOG_PAGE = 100;
/** How many events the server sends at most (getRecentHistory in src/storage/history.ts). */
const LOG_LIMIT = 1000;

/**
 * Everything that changes, in one place: what's staged and waiting —
 * first, since it's what needs doing — then the log of what happened,
 * newest first: changes pushed from here, and every change a scan saw,
 * wherever it was made. Filtered by kind and by words.
 */
function ChangeLog({ changes, onUpdateField, onRevert, onPush, viewer, onOpen, canOpen, query = "", setQuery = () => {}, scannedAt }) {
  const [filter, setFilter] = useState("All");
  const [events, setEvents] = useState(undefined);
  const [shown, setShown] = useState(LOG_PAGE);

  // The log lives on the server and grows with each scan and push.
  const pushedCount = Object.keys(changes).length;
  useEffect(() => {
    let stale = false;
    fetch("/api/history?all=1")
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((body) => !stale && setEvents(body.events ?? []))
      .catch(() => !stale && setEvents([]));
    return () => {
      stale = true;
    };
  }, [scannedAt, pushedCount]);

  // A change made before changes recorded their setting is keyed by the setting itself.
  const settingKeyOf = (change) => change.settingKey || change.targetKey;
  // Only where there is a setting to open: one that has since left the tenant has no panel.
  const openerFor = (key) => (onOpen && canOpen?.(key) ? () => onOpen(key) : undefined);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (...texts) => words.every((w) => texts.some((t) => String(t ?? "").toLowerCase().includes(w)));

  const staged = Object.values(changes)
    .filter((c) => matches(c.targetName, c.policyName, c.from, c.to, c.reason, c.stagedByName))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const ready = Object.values(changes).filter((c) => c.ready).length;
  const toExisting = staged.filter((c) => c.targetKind !== "new");
  // Settings staged into policies that don't exist yet, grouped into those policies by name.
  const newPolicies = [];
  for (const change of staged.filter((c) => c.targetKind === "new")) {
    const group = newPolicies.find(([name]) => name === change.policyName);
    if (group) group[1].push(change);
    else newPolicies.push([change.policyName, [change]]);
  }

  const log = useMemo(
    () =>
      (events ?? []).filter(
        (e) =>
          (filter === "All" || (filter === "Pushed" ? e.kind === "pushed" : filter === "Seen in scans" && e.kind !== "pushed")) &&
          matches(e.settingName, e.policyName, e.from, e.to, e.reason, e.pushedBy),
      ),
    [events, filter, query], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // A day's heading counts all of that day's entries, also the ones not shown yet.
  const perDay = new Map();
  for (const event of log) perDay.set(day(event.at), (perDay.get(day(event.at)) ?? 0) + 1);
  const days = [];
  for (const event of log.slice(0, shown)) {
    const last = days[days.length - 1];
    if (last && last.key === day(event.at)) last.events.push(event);
    else days.push({ key: day(event.at), label: dayLabel(event.at), total: perDay.get(day(event.at)), events: [event] });
  }

  // The server sends the latest LOG_LIMIT events; a count that reached it says so.
  const capped = (n) => (n === undefined ? undefined : n > 0 && events.length >= LOG_LIMIT ? n + "+" : n);
  const counts = {
    All: undefined,
    Staged: Object.keys(changes).length,
    Pushed: capped(events?.filter((e) => e.kind === "pushed").length),
    "Seen in scans": capped(events?.filter((e) => e.kind !== "pushed").length),
  };
  const showStaged = filter === "All" || filter === "Staged";
  const showLog = filter !== "Staged";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Changes</h1>
        <PageSubtitle>{Object.keys(changes).length > 0 ? Object.keys(changes).length + " staged · " + ready + " ready" : undefined}</PageSubtitle>
      </header>

      <div className="space-y-3">
        <div className="relative">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by setting, policy, value, reason or person"
            className="w-full rounded-md border border-stone-300 bg-surface py-2 pl-9 pr-3 text-sm placeholder-stone-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setShown(LOG_PAGE);
              }}
              className={
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 " +
                (filter === f ? "bg-stone-900 text-white dark:text-stone-50" : "bg-surface text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
              }
            >
              {f}
              {counts[f] !== undefined && <span className="ml-1.5 tabular-nums opacity-60">{counts[f]}</span>}
            </button>
          ))}
        </div>
      </div>

      {showStaged && (
        <section className="space-y-3">
          {filter === "All" && <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">Staged · {staged.length}</h2>}
          {staged.length === 0 ? (
            <Empty>{words.length ? "No staged change matches" : "Nothing staged"}</Empty>
          ) : (
            <ul className="space-y-3">
              {newPolicies.map(([name, group]) => (
                <NewPolicyGroup key={name} name={name} changes={group} onUpdateField={onUpdateField} onRevert={onRevert} onPush={onPush} viewer={viewer} openerFor={(c) => openerFor(settingKeyOf(c))} />
              ))}
              {toExisting.map((c) => (
                <ChangeCard key={c.id} change={c} onUpdateField={onUpdateField} onRevert={onRevert} onPush={onPush} viewer={viewer} onOpen={openerFor(settingKeyOf(c))} />
              ))}
            </ul>
          )}
        </section>
      )}

      {showLog && (
        <section className="space-y-3">
          {filter === "All" && <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">History</h2>}
          {events === undefined ? null : log.length === 0 ? (
            <Empty>{words.length ? "Nothing in the history matches" : "No changes recorded"}</Empty>
          ) : (
            <div className="space-y-4">
              {days.map((d) => (
                <div key={d.key}>
                  <h3 className="mb-1.5 font-sans text-xs font-medium text-stone-500">
                    {d.label} <span className="tabular-nums text-stone-400">· {d.total}</span>
                  </h3>
                  <ol className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-surface">
                    {d.events.map((event) => (
                      <LogRow key={event.id} event={event} onOpen={openerFor(event.settingKey)} />
                    ))}
                  </ol>
                </div>
              ))}
              {log.length > shown && (
                <button type="button" onClick={() => setShown((n) => n + LOG_PAGE)} className={quietButton + " ring-1 ring-inset ring-stone-300"}>
                  Show more ({log.length - shown} older)
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export { ChangeLog };
