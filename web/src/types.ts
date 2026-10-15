// What the server sends the browser, in the server's own types wherever it has them — so a change to
// a shape on the server is a type error here, not a blank field in the UI. The HTTP layer itself passes
// `unknown` (src/server/types.ts), so the response shapes it builds are described here.
import type { ViewerIdentity } from "../../src/auth/webSession.js";
import type { BaselinePack } from "../../src/baselines/packs.js";
import type { ViewerReport } from "../../src/commands/ui.js";
import type { SettingIndexEntry, SettingValueNode } from "../../src/scan/types.js";
import type { StagedChange } from "../../src/storage/changes.js";
import type { HistoryEntry } from "../../src/storage/history.js";

export type { AssignmentTarget, BaselineCheck, GroupDirectory, RawSimplePolicy, SettingIndexEntry, SettingIndexSource, SettingIndexState, SettingRecommendation, SettingSchema, SettingValueNode, ValueDifference } from "../../src/scan/types.js";
export type { Note } from "../../src/storage/notes.js";
export type { Reminder } from "../../src/storage/reminders.js";
export type { Role } from "../../src/auth/roles.js";
export type { BaselinePack, HistoryEntry };

/** Who is signed in, as put into the page. The visible-policy map stays on the server. */
export type Session = Omit<ViewerIdentity, "visiblePolicies">;

/** The report as served to one viewer: judged against their baselines, with notes and staged changes. */
export type Report = ViewerReport;

/** What a staged change takes a setting out of its policy with, in place of a value. */
export interface RemovedValue {
  kind: "removed";
  definitionId?: string;
  name: string;
}

/** A staged change, with its structured value as the UI reads it — stored as JSON, so `unknown` on the server. */
export type Change = Omit<StagedChange, "toStructured"> & { toStructured?: SettingValueNode | RemovedValue };

/** One row of the tenant-wide log on the Changes page — see getRecentHistory in src/storage/history.ts. */
export type LogEvent = HistoryEntry & { settingKey: string; settingName: string };

/** A page of that log, with how many of each kind there are in all. */
export interface HistoryPage {
  events: LogEvent[];
  next: number | null;
  counts: { pushed: number; seen: number };
}

/** Fresh baseline verdicts after the baselines or their selection change — see baselineVerdicts in src/server/baselines.ts. */
export interface VerdictPatch {
  verdicts: Record<string, Pick<SettingIndexEntry, "state" | "recs" | "checks">>;
  missing: SettingIndexEntry[];
  belowBaselineCount: number;
  baselinePacks: BaselinePack[];
  activeBaselinePacks: string[] | null;
  baselineFolder?: string;
}

/** Every JSON error answer from the API. */
export interface ApiError {
  error?: string;
}

/** An option of a Dropdown. */
export interface Option {
  value: string;
  label: string;
}

/** The group chooser shown in each page's subtitle. */
export interface Scope {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}

declare global {
  interface Window {
    __INTUNEATLAS_REPORT__?: Report | null;
    __INTUNEATLAS_SESSION__?: Session | null;
    __INTUNEATLAS_VERSION__?: string | null;
  }
}
