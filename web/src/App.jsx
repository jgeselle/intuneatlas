import { useEffect, useRef, useState } from "react";
import {
  SquaresFour,
  Sliders,
  ShieldCheck,
  DeviceMobile,
  Lightbulb,
  ListChecks,
  Compass,
  CaretDoubleLeft,
} from "@phosphor-icons/react";
import { ConnectScreen } from "./ConnectScreen.jsx";
import { NoRoleScreen } from "./NoRoleScreen.jsx";
import { SyncControl } from "./components/SyncControl.jsx";
import { AccountMenu } from "./components/AccountMenu.jsx";
import { SettingDrawer } from "./components/SettingDrawer.jsx";
import { SimplePolicyDrawer } from "./components/SimplePolicyDrawer.jsx";
import { Overview } from "./views/Overview.jsx";
import { SettingsView } from "./views/SettingsView.jsx";
import { SimplePolicyList } from "./views/SimplePolicyList.jsx";
import { Recommendations } from "./views/Recommendations.jsx";
import { ChangeLog } from "./views/ChangeLog.jsx";

const RAIL_COLLAPSE_KEY = "intuneatlas.rail-collapsed";

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
  // reloads. `menuPinned`: opening the account menu while collapsed should
  // force the rail open even if the pointer isn't over it (e.g. opened via
  // keyboard), and keep it open through the close animation instead of
  // snapping shut mid-transition.
  const [railCollapsed, setRailCollapsed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(RAIL_COLLAPSE_KEY) === "1",
  );
  const [menuPinned, setMenuPinned] = useState(false);

  // The rail's hover-to-flyout width used to be plain CSS (`lg:hover:w-60`
  // with a `lg:delay-200` on the resting state, so a quick pass-over
  // wouldn't collapse it instantly). That had a real bug: `transition-delay`
  // freezes an element exactly where it is when the target changes and
  // *then* waits out the delay — it has no notion of "already fully open"
  // vs. "still mid-expansion". So leaving right after a brief hover (before
  // the 150ms expand had finished) froze the rail at some half-open width
  // for the whole 200ms delay before it finally started shrinking — it
  // visibly got stuck. JS timing fixes this because it actually knows which
  // case it's in: `railSettled` only becomes true once the expand has had
  // time to finish, and only *that* case gets the grace period before
  // collapsing. Leaving mid-expansion collapses immediately instead, with
  // no artificial freeze — the width transition just smoothly reverses
  // from wherever it currently is.
  const [railHoverOpen, setRailHoverOpen] = useState(false);
  const [railSettled, setRailSettled] = useState(false);
  const railSettleTimer = useRef(null);
  const railCloseTimer = useRef(null);
  const railWide = railHoverOpen || menuPinned;

  // Opacity for text that should hide in the icon-only strip but reveal
  // once the rail is wide — tracks `railWide` directly (no separate delay
  // needed here, same reasoning as above: JS already decides exactly when
  // to flip it). Only for elements whose *layout* doesn't depend on being
  // centered — opacity alone still reserves the element's full width,
  // which is fine for a label sitting next to a fixed-position icon, but
  // fights any `justify-center` on the row (see `syncFullShown` below,
  // which swaps whole blocks by display instead, for exactly that case).
  function railDim(extra = "") {
    if (!railCollapsed) return extra;
    return extra + (railWide ? " lg:opacity-100" : " lg:opacity-0");
  }

  // Whether the sync control's full block (vs. its icon-only strip form)
  // should be showing. Driven by JS with a short setTimeout, not CSS
  // `:hover` — a `hidden`→`block` swap can't be delayed or animated by CSS
  // (an element can't transition in *from* display:none, and a plain
  // `:hover` swap has no way to wait a beat first), and the alternative of
  // keeping it always-rendered with a delayed opacity fade solves that but
  // reserves its full height even while collapsed, leaving a dead gap above
  // the account menu. A few milliseconds of JS timing gets both: no
  // reserved space when collapsed, and a short pause before it pops in so
  // it doesn't render into a rail that's still mid-width-transition.
  const [syncRevealed, setSyncRevealed] = useState(false);
  // A beat behind `syncRevealed` — drives just the status row's (dot +
  // "Synced…" text) opacity fade. It has to be a separate, later flip: the
  // block only actually exists once `syncRevealed` flips it to
  // display:block, so setting its opacity in that same tick still wouldn't
  // animate (nothing to transition *from* yet). The double rAF waits for
  // that first real paint, then flips the opacity class on its own — now
  // there's a rendered "before" state, so it genuinely fades in.
  const [syncStatusFaded, setSyncStatusFaded] = useState(false);
  const syncRevealTimer = useRef(null);

  function onRailMouseEnter() {
    if (!railCollapsed) return;
    window.clearTimeout(railCloseTimer.current);
    setRailHoverOpen(true);
    if (!railSettled) {
      window.clearTimeout(railSettleTimer.current);
      // Matches the width transition's own duration below — once this
      // fires, the rail has actually had time to reach full width.
      railSettleTimer.current = window.setTimeout(() => setRailSettled(true), 150);
    }
    window.clearTimeout(syncRevealTimer.current);
    syncRevealTimer.current = window.setTimeout(() => {
      setSyncRevealed(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setSyncStatusFaded(true)));
    }, 80);
  }
  function onRailMouseLeave() {
    window.clearTimeout(railSettleTimer.current);
    window.clearTimeout(syncRevealTimer.current);
    if (railSettled) {
      // Was genuinely fully open — give it a short grace period before
      // collapsing, so a quick pass just past the edge doesn't slam it
      // shut. The sync block gets the same grace period so it retreats
      // together with the rail instead of vanishing first.
      railCloseTimer.current = window.setTimeout(() => {
        setRailHoverOpen(false);
        setRailSettled(false);
      }, 200);
      syncRevealTimer.current = window.setTimeout(() => {
        setSyncRevealed(false);
        setSyncStatusFaded(false);
      }, 200);
    } else {
      // Never finished opening — collapse immediately instead of freezing
      // mid-width for the same grace period.
      setRailHoverOpen(false);
      setRailSettled(false);
      setSyncRevealed(false);
      setSyncStatusFaded(false);
    }
  }
  const syncFullShown = !railCollapsed || menuPinned || syncRevealed;
  const syncStatusVisible = !railCollapsed || menuPinned || syncStatusFaded;

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

  if (session && !session.role) {
    return <NoRoleScreen session={session} />;
  }

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

  // Not just for applying a baseline recommendation — ruleId is "manual"
  // for a freeform edit with no baseline rule behind it. The server never
  // required a real rule id; this was always a frontend-only constraint.
  async function stageChange(entry, { ruleId, from, to }) {
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKey: entry.key, targetName: entry.name, ruleId, from, to }),
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
    {
      id: "recommendations",
      label: "Recommendations",
      icon: Lightbulb,
      // Matches Recommendations.jsx's own count exactly — one per
      // (setting, recommendation) pair, not one per setting, since a
      // setting can have several from different sources.
      count: settingIndex.reduce((n, e) => n + e.recs.length, 0),
    },
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
        onMouseEnter={onRailMouseEnter}
        onMouseLeave={onRailMouseLeave}
        className={
          "flex shrink-0 flex-col bg-teal-900 transition-[width] duration-150 ease-out " +
          (railCollapsed
            ? "overflow-hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 " +
              (railWide ? "lg:w-60 lg:shadow-2xl" : "lg:w-16")
            // Not collapsed: still a plain flex sibling of `main`, which
            // stretches it to match main's full height by default — fine
            // normally, but main can now be much taller than the viewport
            // (the virtualized settings list reserves real scroll height
            // for ~800+ rows), which pushed the footer (sync control,
            // account menu) far down the page. Pin it to the viewport
            // instead, independent of main's height.
            : "lg:w-60 lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-y-auto")
        }
      >
        <div className="flex items-center gap-2.5 pl-[20px] pr-4 py-4">
          <Compass weight="bold" className="h-6 w-6 shrink-0 text-teal-300" />
          <div className={"min-w-0 transition-opacity duration-150 " + railDim()}>
            <div className="truncate text-sm font-semibold leading-tight text-white">IntuneAtlas</div>
            <div className="truncate text-xs leading-tight text-teal-300" title={report.tenant}>
              {report.tenantName || report.tenant || "no tenant"}
            </div>
          </div>

          {/* narrow layouts: the sidebar collapses into a top bar, so these ride along here */}
          {session && (
            <div className="ml-auto flex shrink-0 items-center gap-1 lg:hidden">
              <SyncControl syncing={syncing} syncedAgo={syncedAgo} onSync={resync} canSync={session?.role === "admin"} compact />
              <AccountMenu session={session} tenant={report.tenantName || report.tenant} />
            </div>
          )}

          <button
            onClick={toggleRailCollapsed}
            title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={"ml-auto hidden shrink-0 rounded-md p-1.5 text-teal-300 transition-opacity duration-150 hover:bg-teal-800 hover:text-teal-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-300 lg:block " + railDim()}
          >
            <CaretDoubleLeft
              weight="bold"
              className={"h-4 w-4 transition-transform duration-200 " + (railCollapsed ? "rotate-180" : "")}
            />
          </button>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-4">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = view === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={
                  "flex shrink-0 items-center gap-2 rounded-md py-2 pl-3 pr-3 text-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-300 lg:w-full " +
                  (active ? "bg-teal-800 font-medium text-white" : "text-teal-100 hover:bg-teal-800")
                }
              >
                <Icon weight="bold" className="h-4 w-4 shrink-0" />
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
          <div className={"justify-center " + (railCollapsed && !syncFullShown ? "flex" : "hidden")}>
            <SyncControl syncing={syncing} syncedAgo={syncedAgo} onSync={resync} canSync={session?.role === "admin"} compact />
          </div>
          <div className={railCollapsed && !syncFullShown ? "hidden" : ""}>
            <SyncControl syncing={syncing} syncedAgo={syncedAgo} onSync={resync} statusVisible={syncStatusVisible} canSync={session?.role === "admin"} />
          </div>
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
          onStage={(to, ruleId, from) => stageChange(openSetting, { ruleId, from, to })}
          onRevert={(id) => revertEntryChange(id, openSetting.key)}
          viewer={session}
        />
      )}
      {openCompliance && (
        <SimplePolicyDrawer
          item={openCompliance}
          kindLabel="Compliance"
          notes={notes[openCompliance.id] || []}
          onAddNote={(text) => addNote(openCompliance.id, text)}
          onClose={() => setOpen(null)}
          viewer={session}
        />
      )}
      {openEnrollment && (
        <SimplePolicyDrawer
          item={openEnrollment}
          kindLabel="Enrollment"
          notes={notes[openEnrollment.id] || []}
          onAddNote={(text) => addNote(openEnrollment.id, text)}
          onClose={() => setOpen(null)}
          viewer={session}
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
