import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  SquaresFour,
  Sliders,
  ShieldCheck,
  DeviceMobile,
  ListChecks,
  Stack,
  CaretDoubleLeft,
} from "@phosphor-icons/react";
import { ConnectScreen } from "./ConnectScreen.js";
import { NoRoleScreen } from "./NoRoleScreen.js";
import { SyncControl } from "./components/SyncControl.js";
import { AccountMenu } from "./components/AccountMenu.js";
import { SettingDrawer } from "./components/SettingDrawer.js";
import { SimplePolicyDrawer } from "./components/SimplePolicyDrawer.js";
import { isComplianceSetting } from "./lib/format.js";
import { runScan } from "./lib/scan.js";
import { readRoute, routeSearch, type Open, type View } from "./lib/route.js";
import { loadHistoryLog } from "./lib/historyLog.js";
import { ReminderBell, type ReminderInput } from "./components/Reminders.js";
import { isDue } from "./lib/reminders.js";
import { Overview } from "./views/Overview.js";
import { SettingsView } from "./views/SettingsView.js";
import { SimplePolicyList } from "./views/SimplePolicyList.js";
import { ChangeLog, type ChangeField } from "./views/ChangeLog.js";
import { Baselines } from "./views/Baselines.js";
import type { StageInput } from "./components/SettingDrawer.js";
import type { ApiError, Change, GroupDirectory, Note, RawSimplePolicy, Reminder, Report, Scope, Session, SettingIndexEntry, SettingIndexSource, VerdictPatch } from "./types.js";
import { allows } from "./lib/permissions.js";

/** The settings and policies as one group gets them — see /api/scope. */
interface Scoped {
  group: string;
  settings: SettingIndexEntry[];
  compliancePolicies: RawSimplePolicy[];
  enrollmentConfigurations: RawSimplePolicy[];
}

const RAIL_COLLAPSE_KEY = "intuneatlas.rail-collapsed";
/** The "no group chosen" entry of the group chooser — a value no group id can be. */
const ALL_POLICIES = "::all";
const SCOPE_KEY = "intuneatlas.scope-group";

/** The group chosen last time in this browser, if it was chosen for this same tenant. */
function readStoredScope(tenant: string | undefined): string | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SCOPE_KEY) ?? "null");
    return stored && stored.tenant === tenant && typeof stored.group === "string" ? stored.group : null;
  } catch {
    return null;
  }
}

/**
 * The report with a fresh set of baseline verdicts folded in (see
 * baselineVerdicts in src/server/staticServer.ts): every real setting
 * keeps its facts and takes its new state, recommendations and checks;
 * the synthetic "Missing" entries are replaced wholesale.
 */
/**
 * The groups the app can be narrowed to: every group a policy of any kind
 * is assigned to, plus the groups nested inside those. Labelled by name when
 * the scan could read names (it needs Group.Read.All for that), by id
 * otherwise.
 */
function groupChoices(report: Report, groups: GroupDirectory | undefined) {
  const ids = new Set<string>();
  const note = (targets: SettingIndexSource["targets"]) => {
    for (const target of targets ?? []) {
      if (target.kind === "group" && target.groupId) ids.add(target.groupId);
    }
  };
  for (const entry of report.settings ?? []) for (const source of entry.sources ?? []) note(source.targets);
  for (const policy of [...(report.compliancePolicies ?? []), ...(report.enrollmentConfigurations ?? [])]) note(policy.targets);
  for (const id of [...ids]) for (const child of groups?.contains?.[id] ?? []) ids.add(child);
  return [...ids]
    .map((id) => ({ value: id, label: groups?.names?.[id] ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function withBaselineVerdicts(report: Report, patch: VerdictPatch | undefined): Report {
  if (!patch) return report;
  const settings = report.settings
    .filter((e) => e.state !== "Missing")
    .map((e) => (patch.verdicts[e.key] ? { ...e, ...patch.verdicts[e.key] } : e));
  return {
    ...report,
    settings: [...settings, ...patch.missing],
    belowBaselineCount: patch.belowBaselineCount,
    baselinePacks: patch.baselinePacks,
    activeBaselinePacks: patch.activeBaselinePacks,
    ...(patch.baselineFolder ? { baselineFolder: patch.baselineFolder } : {}),
  };
}

/**
 * Decides which screen there is to show: no role, nothing scanned yet, or
 * the app itself. Kept apart from Dashboard on purpose — Dashboard's hooks
 * all need a report, and a component can't run some of its hooks only once
 * a report has arrived (the first scan finishing used to blank the page
 * for exactly that reason).
 */
export default function App({ initialReport, session }: { initialReport: Report | null; session: Session | null }) {
  const [report, setReport] = useState(initialReport);
  if (session && !session.role) return <NoRoleScreen session={session} />;
  if (!report) return <ConnectScreen onConnected={setReport} session={session} />;
  return <Dashboard initialReport={report} session={session} />;
}

function Dashboard({ initialReport, session }: { initialReport: Report; session: Session | null }) {
  const [report, setReport] = useState(initialReport);
  // Where the page was opened — a reload, or a link someone shared — names the page, panel and group to start on.
  const [initialRoute] = useState(() => readRoute(window.location.search));
  const [view, setView] = useState<View>(initialRoute.view);
  // A page can be opened already filtered — the Overview's shortcut into the Settings list. Any other way there starts unfiltered.
  const [arriveWith, setArriveWith] = useState<string | undefined>(undefined);
  function go(page: View, state?: string) {
    setArriveWith(state);
    setView(page);
  }
  // Each page with a search field keeps its own text: what was typed on Settings means nothing on Enrollment.
  const [queries, setQueries] = useState<Partial<Record<View, string>>>({});
  const searchOf = (page: View) => ({ query: queries[page] ?? "", setQuery: (text: string) => setQueries((all) => ({ ...all, [page]: text })) });
  const [platform, setPlatform] = useState("All");
  const [compliancePlatform, setCompliancePlatform] = useState("All");
  // Everything can be narrowed to what one group gets, chosen once (in any
  // page's subtitle): `scopeGroup` is that group's id, `scoped` the settings and
  // policies as the group gets them (worked out by the server — conflicts
  // and baseline verdicts differ per group, it isn't a filter over the
  // tenant-wide list). Every page reads from it while a group is chosen.
  // Remembered across reloads, per tenant — a group id means nothing in another tenant.
  // A link that names a place also names its group (or none): it shows what was shared, not whatever group the reader last chose.
  const [scopeGroup, setScopeGroupState] = useState<string | null>(() => (initialRoute.named ? initialRoute.group : readStoredScope(initialReport?.tenant)));
  const [scoped, setScoped] = useState<Scoped | null>(null);
  function setScopeGroup(group: string | null) {
    setScopeGroupState(group);
    try {
      if (group) window.localStorage.setItem(SCOPE_KEY, JSON.stringify({ tenant: report.tenant, group }));
      else window.localStorage.removeItem(SCOPE_KEY);
    } catch {
      // Storage unavailable (private mode, blocked): the choice just won't outlive the page.
    }
  }
  const [notes, setNotes] = useState<Record<string, Note[]>>(initialReport?.notes ?? {});
  const [changes, setChanges] = useState<Record<string, Change>>((initialReport?.changes ?? {}) as Record<string, Change>);
  const [open, setOpen] = useState<Open>(initialRoute.open);

  // The address follows the page, the open panel and the group. Each move is a step back can undo;
  // going back (or forward) puts the app where that address says, without adding another step.
  const routed = useRef(false);
  useEffect(() => {
    const search = routeSearch({ view, open, group: scopeGroup });
    // The first time it only writes down where the app started (a remembered group, say) — that's no step to go back over.
    const step = routed.current ? "pushState" : "replaceState";
    routed.current = true;
    if (search !== window.location.search) window.history[step](null, "", window.location.pathname + search);
  }, [view, open, scopeGroup]);
  useEffect(() => {
    const onPop = () => {
      const route = readRoute(window.location.search);
      setView(route.view);
      setOpen(route.open);
      setScopeGroupState(route.group);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  // The tenant-wide history changes only with a sync or a push: loaded once in the background
  // when the app opens, so the Changes page has it to hand (see lib/historyLog.ts).
  const [pushes, setPushes] = useState(0);
  const historyStamp = report.scannedAt + "#" + pushes;
  useEffect(() => {
    loadHistoryLog(historyStamp, {}).catch(() => {});
  }, [historyStamp]);
  const canNote = allows(session, "note");
  const canScan = allows(session, "scan");
  const dueReminders = reminders.filter((r) => isDue(r)).length;
  const [toast, setToast] = useState<string | null>(null);
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
  const railRef = useRef<HTMLElement>(null);

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
  const railSettleTimer = useRef<number | undefined>(undefined);
  const railCloseTimer = useRef<number | undefined>(undefined);
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
  const syncRevealTimer = useRef<number | undefined>(undefined);

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

  // A menu opened from the rail (the account menu, the group chooser) keeps the collapsed rail
  // expanded for as long as it's open. Unpinning waits out the menu's own closing animation, so
  // the rail doesn't snap shut under it.
  function pinRailWhileOpen(isOpen: boolean) {
    if (isOpen) {
      setMenuPinned(true);
      return;
    }
    window.setTimeout(() => {
      setMenuPinned(false);
      // A menu's click-catching overlay belongs to the rail as far as React's mouse-leave goes, so leaving
      // the rail while a menu was open never registered. Closed with the pointer elsewhere: collapse.
      if (railRef.current && !railRef.current.matches(":hover")) {
        setRailHoverOpen(false);
        setRailSettled(false);
        setSyncRevealed(false);
        setSyncStatusFaded(false);
      }
    }, 180);
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
    if (report?.changes) setChanges(report.changes as Record<string, Change>);
  }, [report]);

  // The "synced N minutes ago" label ages whether or not anyone's looking —
  // just a render tick, syncedAgo below is always recomputed from the real
  // scannedAt timestamp rather than tracked as separate drift-prone state.
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 60000);
    return () => window.clearInterval(t);
  }, []);

  const wholeTenant = report.settings ?? [];
  // Fetched again whenever anything it depends on changes: the group, a new scan, or which baselines are judged against.
  const scopeStamp = [scopeGroup, report.scannedAt, JSON.stringify(report.activeBaselinePacks ?? null), (report.baselinePacks ?? []).map((p) => p.path + ":" + p.ruleCount).join("|")].join("#");
  useEffect(() => {
    if (!scopeGroup) {
      setScoped(null);
      return;
    }
    let stale = false;
    fetch("/api/scope?group=" + encodeURIComponent(scopeGroup))
      .then(async (res) => {
        const body = (await res.json()) as Partial<Scoped> & ApiError;
        if (stale) return;
        if (!res.ok) throw new Error(body.error || "Couldn't load that group's settings");
        setScoped({
          group: scopeGroup,
          settings: body.settings ?? [],
          compliancePolicies: body.compliancePolicies ?? [],
          enrollmentConfigurations: body.enrollmentConfigurations ?? [],
        });
      })
      .catch((err) => {
        if (stale) return;
        flash((err as Error).message);
        setScopeGroup(null);
      });
    return () => {
      stale = true;
    };
  }, [scopeStamp]);
  // What every page shows: the chosen group's view once it has loaded, the whole tenant otherwise.
  const inScope = Boolean(scopeGroup) && scoped?.group === scopeGroup;
  const settingIndex = inScope && scoped ? scoped.settings : wholeTenant;
  // Every group a policy names (or that sits inside one that is named), by name where the scan could read names.
  const groupOptions = useMemo(() => groupChoices(report, report.groups), [report.settings, report.compliancePolicies, report.enrollmentConfigurations, report.groups]);
  // The chooser itself, shown in each page's subtitle. Absent when the tenant has no groups to choose from.
  const scope: Scope | undefined =
    groupOptions.length > 0
      ? {
          value: scopeGroup ?? ALL_POLICIES,
          options: [{ value: ALL_POLICIES, label: "All policies" }, ...groupOptions],
          onChange: (value) => setScopeGroup(value === ALL_POLICIES ? null : value),
        }
      : undefined;
  // A remembered group that the current scan no longer knows (deleted, or no policy names it any more) is dropped.
  useEffect(() => {
    if (scopeGroup && !groupOptions.some((g) => g.value === scopeGroup)) setScopeGroup(null);
  }, [scopeGroup, groupOptions]);
  // One list, two pages: what configuration policies set, and what compliance policies demand.
  const configurationSettings = useMemo(() => settingIndex.filter((e) => !isComplianceSetting(e)), [settingIndex]);
  const complianceSettings = useMemo(() => settingIndex.filter(isComplianceSetting), [settingIndex]);
  const compliancePolicies = (inScope && scoped ? scoped.compliancePolicies : report.compliancePolicies) ?? [];
  const enrollmentConfigurations = (inScope && scoped ? scoped.enrollmentConfigurations : report.enrollmentConfigurations) ?? [];
  const syncedAgo = report.scannedAt ? Math.max(0, Math.round((Date.now() - new Date(report.scannedAt).getTime()) / 60000)) : 0;

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  async function resync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const body = await runScan("Sync failed");
      setReport(body);
      flash("Re-indexed " + (body.policyCount ?? 0) + " policies · " + (body.settingCount ?? 0) + " settings");
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  // `packs`: an array of pack paths to make active, or null to reset to
  // "every pack" (the default before this viewer ever customized it).
  // Personal to the signed-in viewer — doesn't touch the tenant, doesn't
  // need a rescan, and never affects anyone else's own selection.
  async function updateBaselineSelection(packs: string[] | null) {
    try {
      const res = await fetch("/api/baseline-selection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packs }),
      });
      const body = (await res.json()) as VerdictPatch & ApiError;
      if (!res.ok) throw new Error(body.error || "Couldn't update baseline selection");
      setReport((current) => withBaselineVerdicts(current, body));
    } catch (err) {
      flash((err as Error).message);
    }
  }

  // Adding, renaming and removing baselines changes files on the machine
  // running the server (Admin only, enforced there). Each answers with
  // fresh verdicts, since what the report is judged against just changed.
  // Returns whether it worked, so a form knows whether to clear itself.
  async function manageBaselines(method: "POST" | "PATCH" | "DELETE", payload: object, done: string): Promise<boolean> {
    try {
      const res = await fetch("/api/baselines", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as VerdictPatch & ApiError;
      if (!res.ok) throw new Error(body.error || "Couldn't update the baselines");
      setReport((current) => withBaselineVerdicts(current, body));
      flash(done);
      return true;
    } catch (err) {
      flash((err as Error).message);
      return false;
    }
  }

  // Reminders are shared and kept apart from scans — loaded once, then replaced by whatever each change answers with.
  useEffect(() => {
    fetch("/api/reminders")
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => Array.isArray(list) && setReminders(list))
      .catch(() => {});
  }, []);

  async function reminderRequest(method: "POST" | "DELETE", path: string, body: object | null, done?: string): Promise<boolean> {
    try {
      const res = await fetch("/api/reminders" + path, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const updated = (await res.json()) as Reminder[] & ApiError;
      if (!res.ok) throw new Error(updated.error || "Couldn't update the reminder");
      setReminders(updated);
      if (done) flash(done);
      return true;
    } catch (err) {
      flash((err as Error).message);
      return false;
    }
  }
  const addReminder = (entry: SettingIndexEntry, input: ReminderInput) => reminderRequest("POST", "", { targetKey: entry.key, targetName: entry.name, ...input }, "Reminder added");
  const completeReminder = (id: number) => reminderRequest("POST", `/${id}/done`, null, "Reminder done");
  const snoozeReminder = (id: number) => reminderRequest("POST", `/${id}/snooze`, null, "Snoozed for a week");
  const deleteReminder = (id: number) => reminderRequest("DELETE", `/${id}`, null, "Reminder deleted");

  async function addNote(key: string, text: string) {
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKey: key, text }),
      });
      const updated = (await res.json()) as Note[] & ApiError;
      if (!res.ok) throw new Error(updated.error || "Couldn't save the note");
      setNotes((n) => ({ ...n, [key]: updated }));
      flash("Note added");
    } catch (err) {
      flash((err as Error).message);
    }
  }

  async function deleteNote(key: string, id: number) {
    try {
      const res = await fetch("/api/notes/" + id, { method: "DELETE" });
      const updated = (await res.json()) as Note[] & ApiError;
      if (!res.ok) throw new Error(updated.error || "Couldn't delete the note");
      setNotes((n) => ({ ...n, [key]: updated }));
      flash("Note deleted");
    } catch (err) {
      flash((err as Error).message);
    }
  }

  // A staged change is to one policy's value of a setting, so two
  // policies setting the same thing can each be changed — the target key
  // is the pair. ruleId is "manual" for a freeform edit with no baseline
  // rule behind it; the server never required a real rule id.
  //
  // `source` is the existing policy whose value is being changed — or null
  // to stage the setting into a policy that doesn't exist yet, created
  // under `newPolicyName`. A setting can be staged into several new
  // policies (the same setting in two policies is normal: they get
  // assigned to different groups). Each such staging has its own key,
  // which doesn't contain the name — so renaming the policy never changes
  // it — and staging again for the same name replaces that one.
  async function stageChange(entry: SettingIndexEntry, source: SettingIndexSource | null, { ruleId, from, to, toStructured, reason, newPolicyName }: StageInput) {
    const sameNewPolicy = Object.values(changes).find(
      (c) => c.targetKind === "new" && c.settingKey === entry.key && c.policyName === newPolicyName,
    );
    const newKey = sameNewPolicy?.targetKey ?? entry.key + "::new::" + Date.now().toString(36);
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetKey: source ? entry.key + "::policy::" + source.policyId : newKey,
          targetName: entry.name,
          settingKey: entry.key,
          policyId: source ? source.policyId : "",
          policyName: source ? source.policyName : newPolicyName,
          targetKind: source ? "existing" : "new",
          ruleId,
          from,
          to,
          toStructured,
          reason,
        }),
      });
      const change = (await res.json()) as Change & ApiError;
      if (!res.ok) throw new Error(change.error || "Couldn't stage the change");
      setChanges((c) => ({ ...c, [change.targetKey]: change }));
      flash("Change staged");
    } catch (err) {
      flash((err as Error).message);
    }
  }

  async function updateChangeField(id: number, field: ChangeField, value: string) {
    try {
      const res = await fetch("/api/changes/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const change = (await res.json()) as Change & ApiError;
      if (!res.ok) throw new Error(change.error || "Couldn't update the change");
      setChanges((c) => ({ ...c, [change.targetKey]: change }));
    } catch (err) {
      flash((err as Error).message);
    }
  }

  // Writes a staged change to the tenant. Resolves to nothing on success, or to the reason it wasn't
  // pushed — shown where the button is, since a refusal can take a sentence to explain.
  async function pushChange(change: Change): Promise<string | undefined> {
    try {
      const res = await fetch("/api/changes/" + change.id + "/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await res.json()) as { closed?: string[]; report?: Report; created?: boolean; policyName?: string } & ApiError;
      if (!res.ok) return body.error || "Couldn't push the change";
      setChanges((current) => {
        const next = { ...current };
        for (const key of body.closed ?? []) delete next[key];
        return next;
      });
      const pushed = body.report;
      if (pushed) setReport(pushed);
      setPushes((n) => n + 1);
      flash(body.created ? "Created " + body.policyName + " · not assigned" : "Pushed to " + body.policyName);
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  }

  async function revertEntryChange(id: number, targetKey: string) {
    try {
      const res = await fetch("/api/changes/" + id, { method: "DELETE" });
      const body = (await res.json()) as ApiError;
      if (!res.ok) throw new Error(body.error || "Couldn't revert the change");
      setChanges((c) => {
        const next = { ...c };
        delete next[targetKey];
        return next;
      });
      flash("Change reverted");
    } catch (err) {
      flash((err as Error).message);
    }
  }

  const nav: Array<{ id: View; label: string; icon: ComponentType<{ weight?: "bold"; className?: string }>; count?: number }> = [
    { id: "overview", label: "Overview", icon: SquaresFour },
    { id: "configuration", label: "Settings", icon: Sliders, count: configurationSettings.length },
    { id: "compliance", label: "Compliance", icon: ShieldCheck, count: complianceSettings.length },
    { id: "enrollment", label: "Enrollment", icon: DeviceMobile, count: enrollmentConfigurations.length },
    { id: "changes", label: "Changes", icon: ListChecks, count: Object.keys(changes).length },
    { id: "baselines", label: "Baselines", icon: Stack, count: (report.baselinePacks ?? []).length },
  ];

  // A setting is opened from what the current page shows; one opened from the change log may not be
  // part of the chosen group's view at all (the change log isn't narrowed), so the whole tenant backs it up.
  const findSetting = (key: string) => settingIndex.find((e) => e.key === key) ?? wholeTenant.find((e) => e.key === key);
  const openSetting = open?.type === "setting" ? findSetting(open.key) : null;
  const openEnrollment = open?.type === "enrollment" ? enrollmentConfigurations.find((p) => p.id === open.id) : null;

  return (
    <div className="flex min-h-screen w-full flex-col bg-stone-50 text-stone-900 lg:flex-row">
      {/* Reserves the icon-strip's width in the flex flow while the rail
          itself goes `lg:fixed` below — the hover/pinned flyout then
          overlays this gap instead of reflowing `main`. */}
      {railCollapsed && <div className="hidden shrink-0 lg:block lg:w-16" aria-hidden="true" />}

      <aside
        ref={railRef}
        onMouseEnter={onRailMouseEnter}
        onMouseLeave={onRailMouseLeave}
        className={
          "keep-brand flex shrink-0 flex-col bg-teal-900 transition-[width] duration-150 ease-out " +
          (railCollapsed
            // The collapse is a wide-screen thing only — on a phone this is the top bar, which must not clip the menus hanging from it.
            ? "lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:overflow-hidden " +
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
        {/* The icon-strip shows the logo where the wordmark sits; the
            two cross-fade in place as the rail opens. */}
        <div className="relative flex items-center gap-2.5 py-4 pl-[20px] pr-4">
          {railCollapsed && (
            <svg
              viewBox="0 0 100 100"
              fill="currentColor"
              aria-hidden="true"
              className={
                "absolute left-[22px] top-1/2 hidden h-5 w-5 -translate-y-1/2 text-white transition-opacity duration-150 lg:block " +
                (railWide ? "opacity-0" : "opacity-100")
              }
            >
              {/* The logo — assets/logo.svg at the repo root is the source. */}
              <path fillRule="evenodd" d="M10 18A11 11 0 0 1 32 18V86.2A1.5 1.5 0 0 1 29.7 87.5A40 40 0 0 1 10 53ZM39 30A11 11 0 0 1 54.2 19.8L83.2 31.8A11 11 0 0 1 90 42V53A40 40 0 0 1 70.3 87.5A1.5 1.5 0 0 1 68 86.2V68.5A1.5 1.5 0 0 0 66.5 67H62.5A1.5 1.5 0 0 0 61 68.5V90.3A1.5 1.5 0 0 1 59.9 91.8A40 40 0 0 1 40.1 91.8A1.5 1.5 0 0 1 39 90.3ZM63.1 47.3L67.1 49A1.5 1.5 0 0 1 68 50.4V57.5A1.5 1.5 0 0 1 66.5 59H62.5A1.5 1.5 0 0 1 61 57.5V48.7A1.5 1.5 0 0 1 63.1 47.3Z" />
            </svg>
          )}
          {/* Something is due: a dot on the logo, the one thing the icon strip shows up here. */}
          {railCollapsed && dueReminders > 0 && (
            <span
              aria-hidden="true"
              className={
                "absolute left-[38px] top-[calc(50%-12px)] hidden h-2 w-2 rounded-full bg-amber-400 ring-2 ring-teal-900 transition-opacity duration-150 lg:block " +
                (railWide ? "opacity-0" : "opacity-100")
              }
            />
          )}
          <div className={"min-w-0 transition-opacity duration-150 " + railDim()}>
            <div className="whitespace-nowrap font-heading text-xl font-semibold leading-none tracking-tight text-white">
              IntuneAtlas
            </div>
            <div className="mt-0.5 truncate text-xs leading-tight text-teal-300" title={report.tenant}>
              {report.tenantName || report.tenant || "no tenant"}
            </div>
          </div>

          {/* narrow layouts: the sidebar collapses into a top bar, so these ride along here */}
          {session && (
            <div className="ml-auto flex shrink-0 items-center gap-1 lg:hidden">
              <ReminderBell reminders={reminders} canEdit={canNote} onOpen={(key) => setOpen({ type: "setting", key })} onDone={completeReminder} onSnooze={snoozeReminder} placement="bar" />
              <SyncControl syncing={syncing} syncedAgo={syncedAgo} onSync={resync} canSync={canScan} compact />
              <AccountMenu session={session} tenant={report.tenantName || report.tenant} />
            </div>
          )}

          <ReminderBell
            reminders={reminders}
            canEdit={canNote}
            onOpen={(key) => setOpen({ type: "setting", key })}
            onDone={completeReminder}
            onSnooze={snoozeReminder}
            onOpenChange={pinRailWhileOpen}
            className={"ml-auto hidden transition-opacity duration-150 lg:block " + railDim()}
          />
          <button
            onClick={toggleRailCollapsed}
            title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={"hidden shrink-0 rounded-md p-1.5 text-teal-300 transition-opacity duration-150 hover:bg-teal-800 hover:text-teal-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-300 lg:block " + railDim()}
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
                onClick={() => go(n.id)}
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
            <SyncControl syncing={syncing} syncedAgo={syncedAgo} onSync={resync} canSync={canScan} compact />
          </div>
          <div className={railCollapsed && !syncFullShown ? "hidden" : ""}>
            <SyncControl syncing={syncing} syncedAgo={syncedAgo} onSync={resync} statusVisible={syncStatusVisible} canSync={canScan} />
          </div>
          {session && (
            <div className="mt-3 border-t border-teal-800 pt-3">
              <AccountMenu
                session={session}
                tenant={report.tenantName || report.tenant}
                up
                full
                textClassName={railDim()}
                onOpenChange={pinRailWhileOpen}
              />
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {/* Keyed on the view so switching pages re-runs the fade. Opacity
            only — a transform here would skew the virtualized settings
            list's position measurements while it plays. */}
        <div key={view} className="mx-auto max-w-6xl animate-fade-in px-4 py-6 sm:px-6 lg:py-8">
          {/* Shown in place of everything else the scan holds — see scan/visibility.ts on the server. */}
          {report.visibilityError && (
            <p role="alert" className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {report.visibilityError}
            </p>
          )}
          {view === "overview" && (
            <Overview
              settingIndex={settingIndex}
              compliancePolicies={compliancePolicies}
              enrollmentConfigurations={enrollmentConfigurations}
              changes={changes}
              onGo={go}
              onOpen={(key) => setOpen({ type: "setting", key })}
              scope={scope}
            />
          )}

          {view === "configuration" && (
            <SettingsView
              entries={configurationSettings}
              initialState={arriveWith}
              changes={changes}
              scope={scope}
              notes={notes}
              {...searchOf("configuration")}
              platform={platform}
              setPlatform={setPlatform}
              onOpen={(key) => setOpen({ type: "setting", key })}
            />
          )}

          {view === "compliance" && (
            <SettingsView
              title="Compliance"
              searchPlaceholder="Search by name or category"
              conflicts={false}
              entries={complianceSettings}
              changes={changes}
              scope={scope}
              notes={notes}
              {...searchOf("compliance")}
              platform={compliancePlatform}
              setPlatform={setCompliancePlatform}
              onOpen={(key) => setOpen({ type: "setting", key })}
            />
          )}

          {view === "enrollment" && (
            <SimplePolicyList
              kindLabel="Enrollment"
              items={enrollmentConfigurations}
              scope={scope}
              {...searchOf("enrollment")}
              onOpen={(id) => setOpen({ type: "enrollment", id })}
            />
          )}

          {view === "baselines" && (
            <Baselines
              packs={report.baselinePacks ?? []}
              activePacks={report.activeBaselinePacks ?? null}
              settingIndex={settingIndex}
              folder={report.baselineFolder}
              scope={scope}
              viewer={session}
              onUpdateSelection={updateBaselineSelection}
              // No folder means the server reads baselines from somewhere that isn't the app's to manage.
              onAdd={report.baselineFolder ? (input) => manageBaselines("POST", input, "Baseline added") : undefined}
              onRename={(pack, name) => manageBaselines("PATCH", { pack, name }, "Baseline renamed")}
              onRemove={(pack) => manageBaselines("DELETE", { pack }, "Baseline removed")}
            />
          )}

          {view === "changes" && (
            <ChangeLog
              changes={changes}
              onUpdateField={updateChangeField}
              onRevert={revertEntryChange}
              onPush={pushChange}
              viewer={session}
              onOpen={(key) => setOpen({ type: "setting", key })}
              canOpen={(key) => Boolean(findSetting(key))}
              historyStamp={historyStamp}
              {...searchOf("changes")}
            />
          )}
        </div>
      </main>

      {openSetting && (
        <SettingDrawer
          scannedAt={report.scannedAt}
          entry={openSetting}
          notes={notes[openSetting.key] || []}
          reminders={reminders.filter((r) => r.targetKey === openSetting.key)}
          onAddReminder={(input) => addReminder(openSetting, input)}
          onCompleteReminder={completeReminder}
          onSnoozeReminder={snoozeReminder}
          onDeleteReminder={deleteReminder}
          onAddNote={(text) => addNote(openSetting.key, text)}
          onDeleteNote={(id) => deleteNote(openSetting.key, id)}
          onClose={() => setOpen(null)}
          changes={Object.values(changes).filter((c) => c.settingKey === openSetting.key || c.targetKey === openSetting.key)}
          groups={report.groups}
          onStage={(source, change) => stageChange(openSetting, source, change)}
          onStageNew={(change) => stageChange(openSetting, null, change)}
          onRevert={(change) => revertEntryChange(change.id, change.targetKey)}
          viewer={session}
        />
      )}
      {openEnrollment && (
        <SimplePolicyDrawer
          item={openEnrollment}
          kindLabel="Enrollment"
          notes={notes[openEnrollment.id] || []}
          onAddNote={(text) => addNote(openEnrollment.id, text)}
          onDeleteNote={(id) => deleteNote(openEnrollment.id, id)}
          onClose={() => setOpen(null)}
          viewer={session}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="animate-toast rounded-md bg-stone-900 px-4 py-2 text-sm text-white shadow-lg dark:text-stone-50">{toast}</div>
        </div>
      )}
    </div>
  );
}
