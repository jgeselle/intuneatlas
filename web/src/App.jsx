import { useEffect, useState } from "react";
import {
  SquaresFour,
  Sliders,
  ShieldCheck,
  DeviceMobile,
  Lightbulb,
  ListChecks,
  MagnifyingGlass,
  X,
  Check,
  CaretRight,
  Warning,
  WarningCircle,
  CheckCircle,
  Prohibit,
  Copy,
  ChatCircle,
  Compass,
  ArrowCounterClockwise,
  ArrowsClockwise,
  PaperPlaneTilt,
  Clock,
  SignOut,
  CaretDown,
  CaretDoubleLeft,
} from "@phosphor-icons/react";

const RAIL_COLLAPSE_KEY = "intuneatlas.rail-collapsed";

/* --------------------------------------------------------------- utils --- */

function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function sinceLabel(mins) {
  if (mins <= 0) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return mins + " minutes ago";
  const h = Math.floor(mins / 60);
  if (h === 1) return "1 hour ago";
  if (h < 24) return h + " hours ago";
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : d + " days ago";
}

/* ------------------------------------------------------------- styles --- */

const STATE_STYLE = {
  Conflict: "bg-red-50 text-red-700 ring-red-200",
  "Below baseline": "bg-amber-50 text-amber-800 ring-amber-200",
  "Not deployed": "bg-stone-100 text-stone-500 ring-stone-200",
  Baseline: "bg-white text-stone-500 ring-stone-200",
};

const SEVERITY_STYLE = {
  critical: { chip: "bg-red-50 text-red-700 ring-red-200", label: "Critical", rank: 0 },
  high: { chip: "bg-amber-50 text-amber-800 ring-amber-200", label: "High", rank: 1 },
  medium: { chip: "bg-stone-100 text-stone-700 ring-stone-300", label: "Medium", rank: 2 },
  low: { chip: "bg-stone-50 text-stone-500 ring-stone-200", label: "Low", rank: 3 },
};

/* ------------------------------------------------------------ helpers --- */

/**
 * Real platform/kind strings come straight from Graph odata types
 * ("windows10", "androidWorkProfile", "deviceEnrollmentPlatformRestrictions")
 * rather than the prototype's hand-picked labels — this is a best-effort
 * humanizer, not a precise mapping.
 */
function platformLabel(raw) {
  if (!raw) return "Unknown";
  const spaced = raw.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
  return spaced
    .split(" ")
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === "ios") return "iOS";
      if (lower === "macos") return "macOS";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function refLabel(platform) {
  const p = (platform || "").toLowerCase();
  if (p.includes("windows")) return "CSP / OMA-URI";
  if (p.includes("ios") || p.includes("macos")) return "Payload key";
  if (p.includes("android")) return "Managed configuration key";
  return "Graph property";
}

/* ---------------------------------------------------------------- bits --- */

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

function NoteThread({ notes = [], onAdd }) {
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

/* ------------------------------------------------------------- drawer --- */

function DrawerShell({ eyebrow, title, chips, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 transition-opacity" style={{ backgroundColor: "rgba(28, 25, 23, 0.32)" }} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-stone-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-stone-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-stone-500">{eyebrow}</div>
              <h2 className="mt-1 text-base font-semibold leading-snug">{title}</h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>
        </div>
        <div className="space-y-5 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function SettingDrawer({ entry, notes, onAddNote, onClose, change, onStage, onRevert }) {
  const rec = entry.rec;

  return (
    <DrawerShell
      eyebrow={entry.category}
      title={entry.name}
      onClose={onClose}
      chips={
        <>
          <Chip className={STATE_STYLE[entry.state]}>{entry.state}</Chip>
          <Chip className="bg-stone-100 text-stone-600 ring-stone-200">{platformLabel(entry.platform)}</Chip>
        </>
      }
    >
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Effective value</h3>
        {entry.conflict ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
            <div className="flex gap-2">
              <Warning className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-xs leading-relaxed text-red-800">
                Two policies set this differently on overlapping groups. Devices apply whichever processes last, so the result is not
                predictable.
              </p>
            </div>
            <ul className="mt-3 space-y-1.5">
              {entry.sources.map((s, n) => (
                <li key={n} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-red-900">{s.policyName}</span>
                  <span className="shrink-0 rounded border border-red-200 bg-white px-1.5 py-0.5 font-medium text-red-800">
                    {s.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-2 rounded-md border border-stone-200 p-3">
            <div className="text-sm font-medium">{entry.values.join(", ")}</div>
            {entry.state === "Not deployed" && (
              <p className="mt-1 text-xs text-stone-500">
                Configured but not reaching any device, because the policy holding it has no group assigned.
              </p>
            )}
          </div>
        )}
      </section>

      {entry.cspPath && <RefPath value={entry.cspPath} label={refLabel(entry.platform)} />}

      {rec && change && (
        <section className="rounded-md border border-teal-200 bg-teal-50 p-3">
          <div className="flex items-center gap-2">
            <Chip className="bg-white text-teal-700 ring-teal-200">{change.ready ? "Ready" : "Staged"}</Chip>
            {!change.ready && <span className="text-xs text-teal-800">Needs a reason and reviewer</span>}
          </div>
          <div className="mt-3">
            <Diff from={change.from} to={change.to} />
          </div>
          <p className="mt-2 text-xs text-teal-700">Edit the reason and reviewer from the Change log tab.</p>
          <button
            onClick={() => onRevert(change.id)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <ArrowCounterClockwise className="h-3.5 w-3.5" />
            Revert
          </button>
        </section>
      )}

      {rec && !change && (
        <section className="rounded-md border border-stone-200 p-3">
          <div className="flex items-center gap-2">
            <WarningCircle className="h-4 w-4 shrink-0 text-amber-500" />
            <h3 className="text-sm font-semibold">Recommended change</h3>
            <Chip className={"ml-auto " + SEVERITY_STYLE[rec.severity].chip}>{SEVERITY_STYLE[rec.severity].label}</Chip>
          </div>
          <div className="mt-3">
            <Diff from={rec.current} to={rec.recommended} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-stone-600">{rec.why}</p>
          <p className="mt-2 text-xs text-stone-400">Source: {rec.source}</p>
          <button
            onClick={onStage}
            className="mt-3 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Stage this change
          </button>
          <p className="mt-2 text-xs text-stone-400">
            Staging doesn't touch the tenant — it just queues this for review. Deploying needs write-back, which isn't built yet.
          </p>
        </section>
      )}

      {!rec && !entry.conflict && (
        <p className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          Matches the baseline. Nothing to change.
        </p>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Set by</h3>
        <ul className="mt-2 space-y-2">
          {entry.sources.map((s, n) => (
            <li key={n} className="rounded-md border border-stone-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-medium">{s.policyName}</div>
                <span className="shrink-0 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-700">
                  {s.value}
                </span>
              </div>
              <div className="mt-2 text-xs text-stone-500">
                {s.deployed ? "Deployed" : <span className="text-stone-400">Not deployed to any group</span>}
              </div>
            </li>
          ))}
        </ul>
        {entry.sources.length > 1 && !entry.conflict && (
          <p className="mt-2 text-xs text-stone-500">
            Defined in {entry.sources.length} policies with the same value. Harmless, but worth consolidating.
          </p>
        )}
      </section>

      <NoteThread notes={notes} onAdd={onAddNote} />
    </DrawerShell>
  );
}

function SimplePolicyDrawer({ item, kindLabel, notes, onAddNote, onClose }) {
  return (
    <DrawerShell
      eyebrow={kindLabel}
      title={item.name}
      onClose={onClose}
      chips={
        <>
          <Chip className={item.deployed ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-stone-100 text-stone-500 ring-stone-200"}>
            {item.deployed ? "Deployed" : "Not deployed"}
          </Chip>
          <Chip className="bg-stone-100 text-stone-600 ring-stone-200">{platformLabel(item.platform)}</Chip>
          {item.priority !== undefined && (
            <Chip className="bg-stone-100 text-stone-600 ring-stone-200">Priority {item.priority}</Chip>
          )}
        </>
      }
    >
      <p className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
        Per-setting detail for {kindLabel.toLowerCase()} policies isn't scanned yet — this shows identity and deployment status only.
      </p>
      <NoteThread notes={notes} onAdd={onAddNote} />
    </DrawerShell>
  );
}

/* ---------------------------------------------------------- overview --- */

function Overview({ settingIndex, compliancePolicies, enrollmentConfigurations, changes, onGo, onOpen }) {
  const conflicts = settingIndex.filter((e) => e.conflict).length;
  const undeployed = settingIndex.filter((e) => e.state === "Not deployed").length;
  const recs = settingIndex
    .filter((e) => e.rec)
    .sort((a, b) => SEVERITY_STYLE[a.rec.severity].rank - SEVERITY_STYLE[b.rec.severity].rank);
  const complianceDeployed = compliancePolicies.filter((p) => p.deployed).length;
  const enrollmentDeployed = enrollmentConfigurations.filter((p) => p.deployed).length;
  const changeList = Object.values(changes).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="mt-1 text-sm text-stone-500">Where the tenant stands, and what to fix first.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Settings managed"
          value={settingIndex.length}
          sub={conflicts + " conflicting, " + undeployed + " not deployed"}
          tone={conflicts ? "amber" : "neutral"}
          icon={Sliders}
        />
        <Stat label="Compliance policies" value={compliancePolicies.length} sub={complianceDeployed + " deployed"} icon={ShieldCheck} />
        <Stat
          label="Enrollment configs"
          value={enrollmentConfigurations.length}
          sub={enrollmentDeployed + " deployed"}
          icon={DeviceMobile}
        />
        <Stat label="Conflicts" value={conflicts} tone={conflicts ? "alert" : "neutral"} icon={Warning} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-lg border border-stone-200 bg-white lg:col-span-3">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold">Fix these first</h2>
            <button
              onClick={() => onGo("recommendations")}
              className="rounded text-xs font-medium text-teal-600 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {recs.length > 0 ? "See all " + recs.length : "Recommendations"}
            </button>
          </div>
          {recs.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <CheckCircle className="mx-auto h-6 w-6 text-teal-500" />
              <p className="mt-2 text-sm font-medium">Nothing outstanding</p>
              <p className="mt-1 text-xs text-stone-500">Every scanned setting matches the baseline.</p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {recs.slice(0, 5).map((e) => (
                <li key={e.key}>
                  <button
                    onClick={() => onOpen(e.key)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{e.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-stone-500">
                        {platformLabel(e.platform)} · {e.category}
                      </span>
                    </span>
                    <Chip className={SEVERITY_STYLE[e.rec.severity].chip}>{SEVERITY_STYLE[e.rec.severity].label}</Chip>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Compliance by platform</h2>
            <div className="mt-3">
              <NotAvailableYet title="Needs device sync">Per-device compliance percentages aren't scanned yet.</NotAvailableYet>
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Recent changes</h2>
            {changeList.length === 0 ? (
              <p className="mt-2 text-xs text-stone-500">
                No changes yet. Staging a recommendation lands it here before anything reaches the tenant.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {changeList.slice(0, 4).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs">
                    {c.ready ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-teal-600" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    )}
                    <span className="truncate text-stone-700">{c.targetName}</span>
                    <span className="ml-auto shrink-0 text-stone-400">{c.ready ? "ready" : "needs review"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ recommendations --- */

function Recommendations({ settingIndex, onOpen }) {
  const [filter, setFilter] = useState("All");
  const recs = settingIndex
    .filter((e) => e.rec)
    .sort((a, b) => SEVERITY_STYLE[a.rec.severity].rank - SEVERITY_STYLE[b.rec.severity].rank);
  const levels = ["All", "critical", "high", "medium", "low"];
  const shown = filter === "All" ? recs : recs.filter((e) => e.rec.severity === filter);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Recommendations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Settings that differ from the baseline, ranked by what they expose. Write-back doesn't exist yet, so these are
          for review — nothing here changes the tenant.
        </p>
      </header>

      <div className="flex gap-1 overflow-x-auto">
        {levels.map((l) => (
          <button
            key={l}
            onClick={() => setFilter(l)}
            className={
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
              (filter === l ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
            }
          >
            {l === "All" ? "All" : SEVERITY_STYLE[l].label}
            <span className="ml-1.5 tabular-nums opacity-60">
              {l === "All" ? recs.length : recs.filter((e) => e.rec.severity === l).length}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.map((e) => (
          <article key={e.key} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Chip className={SEVERITY_STYLE[e.rec.severity].chip}>{SEVERITY_STYLE[e.rec.severity].label}</Chip>
                  <span className="truncate text-xs text-stone-500">
                    {platformLabel(e.platform)} · {e.category}
                  </span>
                </div>
                <h3 className="mt-2 font-medium">{e.name}</h3>
                <button
                  onClick={() => onOpen(e.key)}
                  className="mt-0.5 rounded text-xs text-stone-500 hover:text-teal-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  See where this is set
                </button>
              </div>
            </div>
            <div className="mt-3">
              <Diff from={e.rec.current} to={e.rec.recommended} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-stone-600">{e.rec.why}</p>
            <p className="mt-2 text-xs text-stone-400">Source: {e.rec.source}</p>
          </article>
        ))}

        {shown.length === 0 && (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-16 text-center">
            <CheckCircle className="mx-auto h-7 w-7 text-teal-500" />
            <p className="mt-3 text-sm font-medium">No recommendations at this level</p>
            <p className="mt-1 text-xs text-stone-500">Switch filters to review the rest.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- change log --- */

function ChangeCard({ change, onUpdateField, onRevert, viewer }) {
  const [reason, setReason] = useState(change.reason);
  const reviewedByMe = change.reviewedBy === viewer.name;

  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Chip className={change.ready ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-amber-50 text-amber-800 ring-amber-200"}>
              {change.ready ? "Ready" : "Needs review"}
            </Chip>
          </div>
          <h3 className="mt-2 text-sm font-medium">{change.targetName}</h3>
        </div>
        <button
          onClick={() => onRevert(change.id, change.targetKey)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <ArrowCounterClockwise className="h-3.5 w-3.5" />
          Revert
        </button>
      </div>

      <div className="mt-3">
        <Diff from={change.from} to={change.to} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-stone-500">Reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => reason !== change.reason && onUpdateField(change.id, "reason", reason)}
            rows={2}
            placeholder="Why is this change needed?"
            className="mt-1 w-full resize-none rounded-md border border-stone-300 bg-white p-2 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
        </label>
        <div>
          <span className="text-xs font-medium text-stone-500">Reviewed by</span>
          <button
            type="button"
            onClick={() => onUpdateField(change.id, "reviewedBy", viewer.name)}
            disabled={reviewedByMe}
            className={
              "mt-1 flex w-full items-center justify-center gap-1.5 rounded-md p-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
              (reviewedByMe
                ? "cursor-default bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200"
                : "bg-stone-100 text-stone-700 hover:bg-stone-200")
            }
          >
            <Check className="h-3.5 w-3.5" />
            {reviewedByMe ? `Reviewed by ${viewer.name}` : `Mark reviewed by ${viewer.name}`}
          </button>
        </div>
      </div>
    </li>
  );
}

function ChangeLog({ changes, onUpdateField, onRevert, viewer }) {
  const list = Object.values(changes).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const ready = list.filter((c) => c.ready).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Change log</h1>
          <p className="mt-1 text-sm text-stone-500">
            {list.length === 0
              ? "Nothing staged yet. Apply a recommendation and it lands here for review."
              : ready + " of " + list.length + " ready. Reason and a reviewer are required before deploying."}
          </p>
        </div>
        <button
          disabled
          title="Deploying to the tenant needs write-back, which isn't built yet."
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-md bg-stone-200 px-3.5 py-2 text-sm font-medium text-stone-400"
        >
          <PaperPlaneTilt className="h-4 w-4" />
          Deploy
        </button>
      </header>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-16 text-center">
          <Clock className="mx-auto h-6 w-6 text-stone-400" />
          <p className="mt-3 text-sm font-medium">Nothing staged</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-stone-500">
            Open a recommendation and click "Stage this change" — it'll show up here for review.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((c) => (
            <ChangeCard key={c.id} change={c} onUpdateField={onUpdateField} onRevert={onRevert} viewer={viewer} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ settings --- */

function SettingsView({ entries, notes = {}, query, setQuery, platform, setPlatform, onOpen }) {
  const [state, setState] = useState("All");
  const platforms = ["All", ...Array.from(new Set(entries.map((e) => e.platform)))];
  const states = ["All", "Below baseline", "Conflict", "Not deployed", "Baseline"];

  const shown = entries.filter(
    (e) =>
      (platform === "All" || e.platform === platform) &&
      (state === "All" || e.state === state) &&
      (e.name.toLowerCase().includes(query.toLowerCase()) ||
        e.category.toLowerCase().includes(query.toLowerCase()) ||
        (e.cspPath || "").toLowerCase().includes(query.toLowerCase())),
  );

  const categories = Array.from(new Set(shown.map((e) => e.category)));
  const count = (s) => entries.filter((e) => e.state === s).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-stone-500">
          Every configuration setting in the tenant, merged across policies. Where two policies set the same thing differently, it
          shows up here as a conflict.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Managed" value={entries.length} icon={Sliders} />
        <Stat label="Below baseline" value={count("Below baseline")} tone={count("Below baseline") ? "amber" : "neutral"} icon={WarningCircle} />
        <Stat label="Conflicting" value={count("Conflict")} tone={count("Conflict") ? "alert" : "neutral"} icon={Warning} />
        <Stat label="Not deployed" value={count("Not deployed")} icon={Prohibit} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, category, or CSP path"
            className="w-full rounded-md border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-stone-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {states.map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              className={
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
                (state === s ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
              }
            >
              {s}
              <span className="ml-1.5 tabular-nums opacity-60">{s === "All" ? entries.length : count(s)}</span>
            </button>
          ))}
          <span className="mx-1 hidden w-px bg-stone-200 sm:block" />
          {platforms.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
                (platform === p ? "bg-teal-700 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
              }
            >
              {p === "All" ? "All" : platformLabel(p)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {categories.map((cat) => (
          <section key={cat}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{cat}</h2>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
              {shown
                .filter((e) => e.category === cat)
                .map((e) => (
                  <li key={e.key}>
                    <button
                      onClick={() => onOpen(e.key)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{e.name}</span>
                          {(notes[e.key] || []).length > 0 && (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 text-xs text-stone-400"
                              title={(notes[e.key] || []).length + " notes"}
                            >
                              <ChatCircle className="h-3.5 w-3.5" />
                              <span className="tabular-nums">{(notes[e.key] || []).length}</span>
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-stone-500">
                          {platformLabel(e.platform)} · {e.sources.length === 1 ? e.sources[0].policyName : e.sources.length + " policies"}
                        </div>
                      </div>
                      <div className="hidden w-56 shrink-0 sm:block">
                        <div className={"truncate text-sm " + (e.conflict ? "text-red-700" : "text-stone-700")}>
                          {e.values.join(", ")}
                        </div>
                      </div>
                      <Chip className={STATE_STYLE[e.state]}>{e.state}</Chip>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}

        {shown.length === 0 && (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-16 text-center">
            <p className="text-sm font-medium">No settings match that filter</p>
            <p className="mt-1 text-xs text-stone-500">Clear the search or pick a different state.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------- compliance/enrollment --- */

function SimplePolicyList({ kindLabel, items, query, setQuery, onOpen }) {
  const shown = items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()));
  const hasPriority = items.some((i) => i.priority !== undefined);
  const deployedCount = items.filter((i) => i.deployed).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{kindLabel}</h1>
        <p className="mt-1 text-sm text-stone-500">
          {items.length} {kindLabel.toLowerCase()} found · {deployedCount} deployed.
        </p>
      </header>

      <div className="relative">
        <MagnifyingGlass className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className="w-full rounded-md border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-stone-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Platform</th>
              {hasPriority && <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Priority</th>}
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.map((i) => (
              <tr
                key={i.id}
                onClick={() => onOpen(i.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpen(i.id);
                }}
                className="cursor-pointer hover:bg-stone-50 focus:bg-stone-50 focus:outline-none"
              >
                <td className="px-4 py-3 font-medium">{i.name}</td>
                <td className="hidden px-4 py-3 text-xs text-stone-600 sm:table-cell">{platformLabel(i.platform)}</td>
                {hasPriority && (
                  <td className="hidden px-4 py-3 text-xs tabular-nums text-stone-600 sm:table-cell">{i.priority ?? "—"}</td>
                )}
                <td className="px-4 py-3">
                  <Chip className={i.deployed ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-stone-100 text-stone-500 ring-stone-200"}>
                    {i.deployed ? "Deployed" : "Not deployed"}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium">No {kindLabel.toLowerCase()} match that search</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- connect screen --- */

function ConnectScreen({ onConnected, session }) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Scan failed");
      onConnected(body);
    } catch (err) {
      setError(err.message);
      setScanning(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-6">
        <div className="flex items-center gap-2.5">
          <Compass className="h-6 w-6 shrink-0 text-teal-700" />
          <div className="text-sm font-semibold">IntuneAtlas</div>
        </div>
        <h1 className="mt-4 text-lg font-semibold">No scan yet</h1>
        <p className="mt-1 text-sm text-stone-500">
          {session ? `Signed in as ${session.name}. ` : ""}
          Nothing's been pulled from Intune yet — scan now to build the settings index.
        </p>
        <form onSubmit={submit} className="mt-4">
          <button
            type="submit"
            disabled={scanning}
            className="w-full rounded-md bg-teal-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
          >
            {scanning ? "Scanning…" : "Scan now"}
          </button>
        </form>
        {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
        {session && (
          <p className="mt-4 text-center text-xs text-stone-400">
            Wrong account? <a href="/auth/logout" className="text-stone-500 underline hover:text-stone-700">Sign out</a>
          </p>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------- sync & identity --- */

function SyncControl({ syncing, syncedAgo, onSync, compact = false, textClassName = "" }) {
  const dot = syncing ? "bg-teal-300" : syncedAgo >= 60 ? "bg-amber-400" : "bg-teal-400";

  if (compact) {
    return (
      <button
        onClick={onSync}
        disabled={syncing}
        aria-label={syncing ? "Syncing" : "Sync tenant"}
        title={syncing ? "Reading tenant…" : "Synced " + sinceLabel(syncedAgo)}
        className="rounded-md p-1.5 text-teal-100 hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 disabled:text-teal-400"
      >
        <ArrowsClockwise className={"h-4 w-4 " + (syncing ? "animate-spin" : "")} />
      </button>
    );
  }

  return (
    <div>
      {/* The dot stays put (it's the icon-strip's "status at a glance"),
          only the label text fades in the collapsed rail. */}
      <div className="flex items-center gap-2 px-1">
        <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + dot} />
        <span className={"min-w-0 truncate text-xs text-teal-300 transition-opacity duration-150 " + textClassName}>
          {syncing ? "Reading tenant…" : "Synced " + sinceLabel(syncedAgo)}
        </span>
      </div>
      <button
        onClick={onSync}
        disabled={syncing}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-teal-50 ring-1 ring-inset ring-teal-700 hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 disabled:cursor-not-allowed disabled:text-teal-400"
      >
        <ArrowsClockwise className={"h-3.5 w-3.5 shrink-0 " + (syncing ? "animate-spin" : "")} />
        <span className={"transition-opacity duration-150 " + textClassName}>{syncing ? "Syncing" : "Sync now"}</span>
      </button>
    </div>
  );
}

function AccountMenu({ session, tenant, up = false, full = false, textClassName = "", onOpenChange }) {
  const [open, setOpen] = useState(false);

  // Lets a parent rail pin itself open while the popover is up (see
  // `menuPinned` in App) — needed only for the collapsible-sidebar
  // placement, harmless everywhere else since the callback is optional.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const initials = initialsOf(session.name);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title={textClassName ? session.name : undefined}
        className={"flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 " + (full ? "w-full" : "")}
      >
        {/* The avatar is the "icon" here — like a nav icon it stays fully
            visible in the collapsed rail; only the surrounding text fades. */}
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white">
          {initials}
        </span>
        {full ? (
          <span className={"min-w-0 flex-1 text-left transition-opacity duration-150 " + textClassName}>
            <span className="block truncate text-sm text-white">{session.name}</span>
            <span className="block truncate text-xs text-teal-300">{session.email}</span>
          </span>
        ) : (
          <span className="hidden text-sm text-teal-50 sm:block">{session.name}</span>
        )}
        <CaretDown
          className={
            "h-3.5 w-3.5 shrink-0 text-teal-300 transition-[transform,opacity] duration-150 " +
            (open ? "rotate-180 " : "") +
            textClassName
          }
        />
      </button>

      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      {/* Always mounted (not `{open && ...}`) so the close transition below
          can actually play instead of the panel just vanishing. */}
      <div
        className={
          "absolute z-40 rounded-lg border border-stone-200 bg-white p-3 shadow-xl transition duration-150 ease-out " +
          // "up" opens from the sidebar footer, which is narrower than a
          // fixed width — stretch to match the rail instead of
          // overflowing past its edge. The other placement has open
          // room to its left, so a fixed width there is fine.
          (up ? "bottom-full left-0 right-0 mb-2 origin-bottom " : "right-0 mt-2 w-64 origin-top-right ") +
          (open
            ? "translate-y-0 scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0 " + (up ? "translate-y-1.5" : "-translate-y-1.5"))
        }
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-800 text-xs font-semibold text-white">
            {initials}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{session.name}</div>
            <div className="truncate text-xs text-stone-500">{session.email}</div>
          </div>
        </div>

        {tenant && (
          <dl className="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-stone-500">Tenant</dt>
              <dd className="truncate text-right text-stone-700">{tenant}</dd>
            </div>
          </dl>
        )}

        <a
          href="/auth/logout"
          className="mt-3 flex w-full items-center gap-2 rounded-md border-t border-stone-200 px-2 pt-3 pb-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <SignOut className="h-3.5 w-3.5" />
          Sign out
        </a>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- app --- */

export default function App({ initialReport, session }) {
  const [report, setReport] = useState(initialReport);
  const [view, setView] = useState("overview");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("All");
  const [notes, setNotes] = useState(initialReport?.notes ?? {});
  const [changes, setChanges] = useState(initialReport?.changes ?? {});
  const [open, setOpen] = useState(null);
  const [toast, setToast] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [, forceTick] = useState(0);

  // Desktop-only: collapse the rail to an icon-only strip, pinned across
  // reloads. The hover-to-flyout expansion itself is plain CSS
  // (`lg:hover:w-60` / `lg:group-hover:opacity-100` below) rather than
  // JS-tracked mouseenter/mouseleave state — real `:hover` is simply more
  // reliable than reimplementing it, and it's exactly how the ported
  // Seresphere original does it too. JS only needs to know about
  // `menuPinned`: opening the account menu while collapsed should force the
  // rail open even if the pointer isn't over it (e.g. it was opened via
  // keyboard), and keep it open through the close animation instead of
  // letting a CSS-only rail snap shut mid-transition.
  const [railCollapsed, setRailCollapsed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(RAIL_COLLAPSE_KEY) === "1",
  );
  const [menuPinned, setMenuPinned] = useState(false);

  // Opacity classes for text that should hide in the icon-only strip but
  // reveal on hover (CSS) or while the account menu is pinned open (JS).
  function railDim(extra = "") {
    if (!railCollapsed) return extra;
    return extra + (menuPinned ? " lg:opacity-100" : " lg:opacity-0 lg:group-hover:opacity-100");
  }

  function toggleRailCollapsed() {
    setRailCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem(RAIL_COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  // Notes and staged changes are persisted server-side and aren't
  // scan-specific — resync whenever a fresh report comes in (e.g. after
  // connecting a tenant).
  useEffect(() => {
    if (report?.notes) setNotes(report.notes);
    if (report?.changes) setChanges(report.changes);
  }, [report]);

  // The "synced N minutes ago" label ages whether or not anyone's looking —
  // just a render tick, syncedAgo below is always recomputed from the real
  // scannedAt timestamp rather than tracked as separate drift-prone state.
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 60000);
    return () => window.clearInterval(t);
  }, []);

  if (!report) {
    return <ConnectScreen onConnected={setReport} session={session} />;
  }

  const settingIndex = report.settings ?? [];
  const compliancePolicies = report.compliancePolicies ?? [];
  const enrollmentConfigurations = report.enrollmentConfigurations ?? [];
  const syncedAgo = report.scannedAt ? Math.max(0, Math.round((Date.now() - new Date(report.scannedAt).getTime()) / 60000)) : 0;

  const flash = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  async function resync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Sync failed");
      setReport(body);
      flash("Re-indexed " + (body.policyCount ?? 0) + " policies · " + (body.settingCount ?? 0) + " settings");
    } catch (err) {
      flash(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function addNote(key, text) {
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKey: key, text }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || "Couldn't save the note");
      setNotes((n) => ({ ...n, [key]: updated }));
      flash("Note added");
    } catch (err) {
      flash(err.message);
    }
  }

  async function stageEntryChange(entry) {
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetKey: entry.key,
          targetName: entry.name,
          ruleId: entry.rec.ruleId,
          from: entry.rec.current,
          to: entry.rec.recommended,
        }),
      });
      const change = await res.json();
      if (!res.ok) throw new Error(change.error || "Couldn't stage the change");
      setChanges((c) => ({ ...c, [entry.key]: change }));
      flash("Change staged. Add a reason and reviewer before it's ready.");
    } catch (err) {
      flash(err.message);
    }
  }

  async function updateChangeField(id, field, value) {
    try {
      const res = await fetch("/api/changes/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const change = await res.json();
      if (!res.ok) throw new Error(change.error || "Couldn't update the change");
      setChanges((c) => ({ ...c, [change.targetKey]: change }));
    } catch (err) {
      flash(err.message);
    }
  }

  async function revertEntryChange(id, targetKey) {
    try {
      const res = await fetch("/api/changes/" + id, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't revert the change");
      setChanges((c) => {
        const next = { ...c };
        delete next[targetKey];
        return next;
      });
      flash("Change reverted");
    } catch (err) {
      flash(err.message);
    }
  }

  const nav = [
    { id: "overview", label: "Overview", icon: SquaresFour },
    { id: "configuration", label: "Settings", icon: Sliders, count: settingIndex.length },
    { id: "compliance", label: "Compliance", icon: ShieldCheck, count: compliancePolicies.length },
    { id: "enrollment", label: "Enrollment", icon: DeviceMobile, count: enrollmentConfigurations.length },
    { id: "recommendations", label: "Recommendations", icon: Lightbulb, count: settingIndex.filter((e) => e.rec).length },
    { id: "changes", label: "Change log", icon: ListChecks, count: Object.keys(changes).length },
  ];

  const openSetting = open?.type === "setting" ? settingIndex.find((e) => e.key === open.key) : null;
  const openCompliance = open?.type === "compliance" ? compliancePolicies.find((p) => p.id === open.id) : null;
  const openEnrollment = open?.type === "enrollment" ? enrollmentConfigurations.find((p) => p.id === open.id) : null;

  return (
    <div className="flex min-h-screen w-full flex-col bg-stone-50 text-stone-900 lg:flex-row">
      {/* Reserves the icon-strip's width in the flex flow while the rail
          itself goes `lg:fixed` below — the hover/pinned flyout then
          overlays this gap instead of reflowing `main`. */}
      {railCollapsed && <div className="hidden shrink-0 lg:block lg:w-16" aria-hidden="true" />}

      <aside
        className={
          "group flex shrink-0 flex-col bg-teal-900 transition-[width] duration-200 ease-out " +
          (railCollapsed
            ? "overflow-hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 " +
              (menuPinned ? "lg:w-60 lg:shadow-2xl" : "lg:w-16 lg:hover:w-60 lg:hover:shadow-2xl")
            : "lg:w-60")
        }
      >
        <div className="flex items-center gap-2.5 px-4 py-4">
          <Compass className="h-6 w-6 shrink-0 text-teal-300" />
          <div className={"min-w-0 transition-opacity duration-150 " + railDim()}>
            <div className="truncate text-sm font-semibold leading-tight text-white">IntuneAtlas</div>
            <div className="truncate text-xs leading-tight text-teal-300" title={report.tenant}>
              {report.tenantName || report.tenant || "no tenant"}
            </div>
          </div>

          {/* narrow layouts: the sidebar collapses into a top bar, so these ride along here */}
          {session && (
            <div className="ml-auto flex shrink-0 items-center gap-1 lg:hidden">
              <SyncControl syncing={syncing} syncedAgo={syncedAgo} onSync={resync} compact />
              <AccountMenu session={session} tenant={report.tenantName || report.tenant} />
            </div>
          )}

          <button
            onClick={toggleRailCollapsed}
            title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={"ml-auto hidden shrink-0 rounded-md p-1.5 text-teal-300 transition-opacity duration-150 hover:bg-teal-800 hover:text-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 lg:block " + railDim()}
          >
            <CaretDoubleLeft className={"h-4 w-4 transition-transform duration-200 " + (railCollapsed ? "rotate-180" : "")} />
          </button>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible lg:pb-4">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = view === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 lg:w-full " +
                  (active ? "bg-teal-800 font-medium text-white" : "text-teal-100 hover:bg-teal-800")
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={"whitespace-nowrap transition-opacity duration-150 " + railDim()}>{n.label}</span>
                <span
                  className={
                    "ml-auto rounded px-1.5 py-0.5 text-xs tabular-nums transition-opacity duration-150 " +
                    (active ? "bg-teal-700 text-teal-50" : "bg-teal-800 text-teal-200") +
                    " " +
                    railDim()
                  }
                >
                  {n.count}
                </span>
              </button>
            );
          })}
        </nav>

        {/* wide layouts: sync and identity settle at the foot of the rail */}
        <div className="mt-auto hidden border-t border-teal-800 px-3 py-3 lg:block">
          <SyncControl syncing={syncing} syncedAgo={syncedAgo} onSync={resync} textClassName={railDim()} />
          {session && (
            <div className="mt-3 border-t border-teal-800 pt-3">
              <AccountMenu
                session={session}
                tenant={report.tenantName || report.tenant}
                up
                full
                textClassName={railDim()}
                onOpenChange={(isOpen) => {
                  if (isOpen) {
                    setMenuPinned(true);
                  } else {
                    window.setTimeout(() => setMenuPinned(false), 180);
                  }
                }}
              />
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
          {view === "overview" && (
            <Overview
              settingIndex={settingIndex}
              compliancePolicies={compliancePolicies}
              enrollmentConfigurations={enrollmentConfigurations}
              changes={changes}
              onGo={setView}
              onOpen={(key) => setOpen({ type: "setting", key })}
            />
          )}

          {view === "configuration" && (
            <SettingsView
              entries={settingIndex}
              notes={notes}
              query={query}
              setQuery={setQuery}
              platform={platform}
              setPlatform={setPlatform}
              onOpen={(key) => setOpen({ type: "setting", key })}
            />
          )}

          {view === "compliance" && (
            <SimplePolicyList
              kindLabel="Compliance"
              items={compliancePolicies}
              query={query}
              setQuery={setQuery}
              onOpen={(id) => setOpen({ type: "compliance", id })}
            />
          )}

          {view === "enrollment" && (
            <SimplePolicyList
              kindLabel="Enrollment"
              items={enrollmentConfigurations}
              query={query}
              setQuery={setQuery}
              onOpen={(id) => setOpen({ type: "enrollment", id })}
            />
          )}

          {view === "recommendations" && (
            <Recommendations settingIndex={settingIndex} onOpen={(key) => setOpen({ type: "setting", key })} />
          )}

          {view === "changes" && (
            <ChangeLog changes={changes} onUpdateField={updateChangeField} onRevert={revertEntryChange} viewer={session} />
          )}
        </div>
      </main>

      {openSetting && (
        <SettingDrawer
          entry={openSetting}
          notes={notes[openSetting.key] || []}
          onAddNote={(text) => addNote(openSetting.key, text)}
          onClose={() => setOpen(null)}
          change={changes[openSetting.key]}
          onStage={() => stageEntryChange(openSetting)}
          onRevert={(id) => revertEntryChange(id, openSetting.key)}
        />
      )}
      {openCompliance && (
        <SimplePolicyDrawer
          item={openCompliance}
          kindLabel="Compliance"
          notes={notes[openCompliance.id] || []}
          onAddNote={(text) => addNote(openCompliance.id, text)}
          onClose={() => setOpen(null)}
        />
      )}
      {openEnrollment && (
        <SimplePolicyDrawer
          item={openEnrollment}
          kindLabel="Enrollment"
          notes={notes[openEnrollment.id] || []}
          onAddNote={(text) => addNote(openEnrollment.id, text)}
          onClose={() => setOpen(null)}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
        </div>
      )}
    </div>
  );
}
