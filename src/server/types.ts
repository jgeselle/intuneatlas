import type { ViewerIdentity, WebSessionManager } from "../auth/webSession.js";
import type { AddPackInput } from "../baselines/manage.js";

export interface NoteRequestBody {
  targetKey: string;
  text: string;
}

export interface StageChangeRequestBody {
  targetKey: string;
  targetName: string;
  settingKey?: string;
  policyId?: string;
  policyName?: string;
  targetKind?: "existing" | "new";
  ruleId: string;
  from: string;
  to: string;
  toStructured?: unknown;
  reason?: string;
}

export interface UpdateChangeRequestBody {
  reason?: string;
  /** Any non-empty value marks the change reviewed by the signed-in viewer (the name sent is never trusted); "" takes the review back. */
  reviewedBy?: string;
  /** Renames the policy a change staged to a *new* policy is to be created in. */
  policyName?: string;
}

export interface WithTargetKey {
  targetKey: string;
}

export interface StartServerOptions {
  /** null means "nothing scanned yet" — the UI shows its connect screen. */
  report: unknown | null;
  /** The app's own version, shown in the UI — so a hosted instance can be told apart from the code it is supposed to run. */
  version?: string;
  startPort?: number;
  /** Interface to bind to. Defaults to loopback-only; anything else is a shared/team deployment. */
  host?: string;
  /**
   * There's exactly one way in: a real per-browser Entra sign-in (see
   * src/auth/webSession.ts), gating every route — including the page itself
   * — whether this is running solo on a laptop or exposed for a team. What
   * differs between those two is only `host` above and whether sign-in can
   * happen silently from a cached account (see WebSessionManager.trySilentLogin).
   */
  session: WebSessionManager;
  /** Backs the browser's "scan now" action — the token comes from the caller's own session, there's nothing else to pass in. */
  onScanRequest?: (graphToken: string) => Promise<unknown>;
  /** Backs the note-adding UI; returns the updated note list for that key. */
  onNoteRequest?: (body: NoteRequestBody, viewer: ViewerIdentity) => unknown[];
  /** Deletes a note; returns its targetKey and the remaining notes for that key, or undefined if it didn't exist. */
  onDeleteNote?: (id: number) => { targetKey: string; notes: unknown[] } | undefined;
  /** Looks up who wrote a note, for the deleteNote ownership check — undefined if the id doesn't exist. */
  getNoteById?: (id: number) => { authorId: string } | undefined;
  /** Reminders on settings (see storage/reminders.ts) — absent where they can't be kept. */
  reminders?: ReminderStore;
  /**
   * Which policies a viewer may see, asked of Graph with their own token
   * (see scan/visibility.ts). With it, everything a viewer is sent is
   * narrowed to those; without it, every viewer sees the whole scan.
   */
  policyVisibility?: (graphToken: string) => Promise<ReadonlyMap<string, string>>;
  /** Stages a change; must return the created record including its targetKey. */
  onStageChange?: (body: StageChangeRequestBody, viewer: ViewerIdentity) => WithTargetKey;
  /** Updates reason/reviewer on a staged change; must return the updated record including its targetKey. */
  onUpdateChange?: (id: number, body: UpdateChangeRequestBody, viewer: ViewerIdentity) => WithTargetKey;
  /** Reverts a staged change; returns the targetKey that was removed, or undefined if it didn't exist. */
  onRevertChange?: (id: number) => string | undefined;
  /**
   * Writes a staged change to the tenant (see src/push). `writeToken` is
   * the pushing Admin's own Graph token with the write permission.
   * Returns the changes this closed — one, or every setting of a new
   * policy — and, where the report in memory could be brought up to date
   * without a scan, that report. Throws PushRefused when it declines to
   * write; that is an answer for the person, not a fault.
   */
  onPushChange?: (
    id: number,
    writeToken: string,
    viewer: ViewerIdentity,
    report: unknown,
  ) => Promise<{ closed: Array<{ targetKey: string }>; policyName: string; created: boolean; report?: unknown }>;
  /** Looks up who staged a change, for the editChange/revertChange ownership check — undefined if the id doesn't exist. */
  getChangeById?: (id: number) => { stagedBy: string } | undefined;
  /**
   * `report` (and whatever onScanRequest returns) is raw — no baseline
   * judgment applied yet. This judges it for one specific viewer, using
   * their own active-baseline selection, every time a report is actually
   * served (initial page load, after a scan, after the selection itself
   * changes) — never stored back, so the same held report can be judged
   * differently per viewer without ever needing a rescan.
   */
  onEvaluateForViewer?: (report: unknown, viewer: ViewerIdentity) => Promise<unknown>;
  /** Persists which baseline packs are active for this viewer — null means "every pack", the default before anyone customizes it. */
  onSetBaselineSelection?: (viewerId: string, packs: string[] | null) => void;
  /**
   * Adding, renaming and removing baselines in the user's baselines
   * folder — absent when the server reads baselines from an explicit
   * `--baseline` directory instead, which is then not the app's to manage.
   * Each throws BaselineInputError for anything wrong with the request.
   */
  /**
   * The raw report narrowed to the policies that reach one group (see
   * scopeToGroup). The server then judges it for the viewer like any
   * report. Throws BaselineInputError for a group the scan doesn't know.
   */
  onScopeReport?: (report: unknown, groupId: string) => unknown | Promise<unknown>;
  /** One setting's history — what scans have seen change in it — newest first. Asked for when a setting is opened, not sent with the report. */
  onHistoryRequest?: (settingKey: string) => unknown[] | Promise<unknown[]>;
  /**
   * Every setting's history in one list, newest first — the log on the Changes page — a page at a
   * time, narrowed by kind, words and the policies the viewer may see; with the counts per kind.
   */
  onRecentHistory?: (query: RecentHistoryQuery) => RecentHistoryAnswer | Promise<RecentHistoryAnswer>;
  baselines?: {
    add: (input: AddPackInput) => Promise<string>;
    rename: (pack: string, name: string) => Promise<void>;
    remove: (pack: string) => Promise<void>;
  };
}

export interface RecentHistoryQuery {
  limit: number;
  offset: number;
  kind?: "pushed" | "seen";
  words: string[];
  policyIds?: string[];
}
export interface RecentHistoryAnswer {
  events: unknown[];
  counts: { pushed: number; seen: number };
}

export interface ReminderStore {
  list(): unknown[];
  get(id: number): { createdById: string; targetKey?: string } | undefined;
  add(input: { targetKey: string; targetName: string; note: string; dueOn: string; repeatMonths: number | null }, viewer: ViewerIdentity): unknown[];
  complete(id: number): unknown[];
  snooze(id: number): unknown[];
  remove(id: number): unknown[];
}
