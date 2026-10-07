import { summarizeSources } from "./index.js";
import type { ScanReport } from "./report.js";
import { appliesToGroup } from "./targets.js";

/**
 * The report as one group gets it: only the policies that reach that
 * group — assigned to it, to a group containing it, or to everyone, and
 * not excluding it — with every setting's values, conflict and state
 * worked out again from just those. A setting none of them sets drops
 * out, so a baseline applied afterwards reports it as Missing *for this
 * group*, which is exactly right.
 *
 * Raw in, raw out: baselines are applied to the result like to any
 * report. Policies whose targets weren't recorded (an older scan) can't
 * be placed and are left out.
 *
 * This is "what is aimed at this group", not "what a device in it ends
 * up with" — a device can be in other groups too.
 */
export function scopeToGroup(report: ScanReport, groupId: string): ScanReport {
  const settings = report.settings
    .filter((entry) => entry.state !== "Missing")
    .map((entry) => {
      const sources = entry.sources.filter((source) => source.targets && appliesToGroup(source.targets, groupId, report.groups));
      return { ...entry, sources, ...summarizeSources(sources, report.groups), recs: [], checks: undefined };
    })
    .filter((entry) => entry.sources.length > 0);

  return {
    ...report,
    settings,
    settingCount: settings.length,
    conflictCount: settings.filter((e) => e.conflict).length,
    belowBaselineCount: 0,
  };
}
