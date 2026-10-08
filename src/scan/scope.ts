import { isComplianceDefinition } from "./complianceSettings.js";
import { summarizeSources } from "./index.js";
import type { ScanReport } from "./report.js";
import { appliesToGroup } from "./targets.js";
import type { AssignmentTarget } from "./types.js";

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
  const real = report.settings.filter((entry) => entry.state !== "Missing");
  const settings = real
    .map((entry) => {
      const sources = entry.sources.filter((source) => source.targets && appliesToGroup(source.targets, groupId, report.groups));
      const summary = summarizeSources(sources, report.groups, { conflicts: !isComplianceDefinition(entry.definitionId) });
      return { ...entry, sources, ...summary, recs: [], checks: undefined };
    })
    .filter((entry) => entry.sources.length > 0);

  // A setting that drops out here may come back as "Missing" once a baseline is applied. The tenant
  // does know what it's called — some other group's policy sets it — so that knowledge is handed on
  // the same way as definitions looked up for the baselines, or it would show by its raw id.
  const kept = new Set(settings.map((entry) => entry.key));
  const definitions = { schemas: { ...report.baselineDefinitions?.schemas }, info: { ...report.baselineDefinitions?.info } };
  for (const entry of real) {
    if (kept.has(entry.key) || !entry.definitionId || !entry.schemas) continue;
    Object.assign(definitions.schemas, entry.schemas);
    definitions.info[entry.definitionId] = { cspPath: entry.cspPath, category: entry.category };
  }

  // The policy lists themselves (compliance and enrollment) aren't merged: a policy either reaches the group or it doesn't.
  const reaches = (policy: { targets?: AssignmentTarget[] }) => Boolean(policy.targets) && appliesToGroup(policy.targets!, groupId, report.groups);

  return {
    ...report,
    compliancePolicies: report.compliancePolicies.filter(reaches),
    enrollmentConfigurations: report.enrollmentConfigurations.filter(reaches),
    settings,
    settingCount: settings.length,
    conflictCount: settings.filter((e) => e.conflict).length,
    belowBaselineCount: 0,
    baselineDefinitions: definitions,
    scopedToGroup: groupId,
  };
}
