import { isComplianceDefinition } from "./complianceSettings.js";
import type { SettingIndexSource } from "./types.js";

/**
 * What happened to one setting in one policy between two scans.
 *
 * - added / removed: the policy started, or stopped, setting it (a policy
 *   that was created or deleted shows up as this for each of its settings)
 * - changed: the policy sets it to something else
 * - assigned / unassigned: the policy's value is the same, but the policy
 *   now reaches someone, or no longer does
 *
 * These are facts about the tenant, observed — nobody told the tool about
 * them, so a change made in the Intune portal is recorded like any other.
 * What is not here: baseline verdicts (they depend on which baselines a
 * viewer has active, not on the tenant) and anything that was staged and
 * then taken back.
 */
export type SettingEventKind = "added" | "removed" | "changed" | "assigned" | "unassigned";

export interface SettingEvent {
  settingKey: string;
  kind: SettingEventKind;
  policyId: string;
  policyName: string;
  /** The policy's value before (removed, changed) and after (added, changed). */
  from?: string;
  to?: string;
}

/** As much of a scanned setting as the comparison needs. */
export interface ScannedSetting {
  key: string;
  definitionId?: string;
  sources: Array<Pick<SettingIndexSource, "policyId" | "policyName" | "value" | "deployed">>;
}

const areaOf = (setting: ScannedSetting) => (isComplianceDefinition(setting.definitionId) ? "compliance" : "configuration");

/**
 * Every event between a scan and the one before it.
 *
 * One guard against false history: when the earlier scan has nothing at
 * all from an area the later one has (compliance settings, before the
 * tool read them), those settings didn't appear in the tenant — the tool
 * started seeing them. Nothing is recorded as "added" for that area.
 */
export function diffScans(previous: ScannedSetting[], current: ScannedSetting[]): SettingEvent[] {
  const before = new Map(previous.map((setting) => [setting.key, setting]));
  const seenBefore = new Set(previous.map(areaOf));
  const events: SettingEvent[] = [];

  for (const setting of current) {
    const was = new Map((before.get(setting.key)?.sources ?? []).map((source) => [source.policyId, source]));
    const firstSight = !seenBefore.has(areaOf(setting));
    for (const source of setting.sources) {
      const old = was.get(source.policyId);
      const base = { settingKey: setting.key, policyId: source.policyId, policyName: source.policyName };
      if (!old) {
        if (!firstSight) events.push({ ...base, kind: "added", to: source.value });
        continue;
      }
      if (old.value !== source.value) events.push({ ...base, kind: "changed", from: old.value, to: source.value });
      if (old.deployed !== source.deployed) events.push({ ...base, kind: source.deployed ? "assigned" : "unassigned" });
    }
  }

  const after = new Map(current.map((setting) => [setting.key, new Set(setting.sources.map((source) => source.policyId))]));
  for (const setting of previous) {
    for (const source of setting.sources) {
      if (after.get(setting.key)?.has(source.policyId)) continue;
      // The policy's last known name: it may be gone altogether.
      events.push({ settingKey: setting.key, kind: "removed", policyId: source.policyId, policyName: source.policyName, from: source.value });
    }
  }
  return events;
}
