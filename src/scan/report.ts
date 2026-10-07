import { applyBaselines, findUncoveredEntries, type BaselineDefinitions } from "../baselines/evaluate.js";
import { resolveBaselineDefinitions } from "./settingDefinitions.js";
import { definitionIdsIn } from "./settingValue.js";
import { fetchGroupDirectory } from "./groups.js";
import { groupIdsIn } from "./targets.js";
import type { GroupDirectory } from "./types.js";
import { normalizeState } from "./states.js";
import type { BaselineRule } from "../baselines/types.js";
import { fetchCompliancePolicies } from "./compliancePolicies.js";
import { fetchConfigurationPolicies } from "./configurationPolicies.js";
import { fetchLegacyDeviceConfigurations } from "./deviceConfigurations.js";
import { fetchEnrollmentConfigurations } from "./enrollmentConfigurations.js";
import { buildSettingIndex } from "./index.js";
import { fetchTenantDisplayName } from "./organization.js";

export interface ScanReport {
  scannedAt: string;
  flow: string;
  tenant: string;
  /** Friendly "Org Name (domain.onmicrosoft.com)" for display — `tenant` above stays the raw --tenant value used for auth/storage lookups. Undefined if Graph didn't return one (never blocks a scan over it). */
  tenantName?: string;
  policyCount: number;
  /** Legacy deviceConfigurations profiles that contributed at least one mapped setting — see src/scan/deviceConfigurations.ts for exactly what's covered. */
  legacyPolicyCount: number;
  settingCount: number;
  conflictCount: number;
  /**
   * 0 on a report straight out of buildReport() — baseline judgment isn't
   * a tenant fact, so scanning alone can't produce it. Real once
   * applyBaselinesToReport() has run.
   */
  belowBaselineCount: number;
  settings: ReturnType<typeof buildSettingIndex>;
  compliancePolicies: Awaited<ReturnType<typeof fetchCompliancePolicies>>;
  enrollmentConfigurations: Awaited<ReturnType<typeof fetchEnrollmentConfigurations>>;
  /**
   * Definitions the loaded baselines mention that no policy in the tenant
   * uses, looked up during the scan so a "Missing" setting has a name, a
   * path and readable values. Tenant-independent facts about Intune's
   * catalog — not a judgment — which is why a scan may carry them.
   */
  baselineDefinitions?: BaselineDefinitions;
  /** Names and nesting of the groups policies are assigned to — absent on scans stored before this was read. */
  groups?: GroupDirectory;
}

/**
 * Pulls raw tenant facts from Graph and merges them — nothing baseline-
 * related. What a setting's value is, who sets it, whether it conflicts,
 * whether it's deployed: all real, live tenant state. Whether that state
 * satisfies some baseline rule isn't a tenant fact at all — it's a purely
 * local judgment call over rules you chose to load, which is exactly why
 * it doesn't belong in here (see applyBaselinesToReport below). Keeping
 * scanning and evaluation apart means changing which baselines are active
 * never needs a rescan: it's just re-running a pure, local function over
 * facts already on disk.
 */
export async function buildReport(token: string, flow: string, tenant: string, baselineDefinitionIds: string[] = []): Promise<ScanReport> {
  const [policies, legacyPolicies, compliancePolicies, enrollmentConfigurations, tenantName] = await Promise.all([
    fetchConfigurationPolicies(token),
    fetchLegacyDeviceConfigurations(token),
    fetchCompliancePolicies(token),
    fetchEnrollmentConfigurations(token),
    fetchTenantDisplayName(token),
  ]);
  // Legacy profiles fold into the same merge — a Settings Catalog policy and
  // a legacy Device Restrictions profile writing the same real setting need
  // to land in the same bucket to be conflict-checked against each other.
  // Group names and nesting, for the groups any of those policies name. Optional: without
  // Group.Read.All this comes back unavailable and everything works on group ids alone.
  const groups = await fetchGroupDirectory(token, [...policies, ...legacyPolicies].flatMap((p) => groupIdsIn(p.assignments)));
  const settingIndex = buildSettingIndex([...policies, ...legacyPolicies], groups);
  const known = new Set(settingIndex.flatMap((e) => Object.keys(e.schemas ?? {})));
  const unknown = baselineDefinitionIds.filter((id) => !known.has(id));
  const baselineDefinitions = unknown.length > 0 ? await resolveBaselineDefinitions(token, unknown) : undefined;

  return {
    scannedAt: new Date().toISOString(),
    flow,
    tenant,
    tenantName,
    policyCount: policies.length,
    legacyPolicyCount: legacyPolicies.length,
    settingCount: settingIndex.length,
    conflictCount: settingIndex.filter((e) => e.conflict).length,
    belowBaselineCount: 0,
    settings: settingIndex,
    compliancePolicies,
    enrollmentConfigurations,
    ...(baselineDefinitions ? { baselineDefinitions } : {}),
    groups,
  };
}

/**
 * The other half of what buildReport used to do in one step — judges a
 * raw report against whichever baseline rules are currently active. Pure
 * and local: no Graph calls, safe to re-run any time the active baseline
 * selection changes, independent of when the tenant was last actually
 * scanned. settingCount/conflictCount and everything else about the raw
 * tenant facts stays untouched — only settings and belowBaselineCount
 * reflect the baseline judgment.
 *
 * Safe to call on an already-evaluated report too (e.g. `--report` can
 * point at whatever a previous `scan --out` wrote, which is evaluated
 * output, not raw, and possibly from a version with the older state
 * names) — maps legacy names forward and strips any synthetic "Missing" entries from a
 * prior run first. Those have no real value to re-derive anything from
 * (values: []), so feeding one back into applyBaselines would score it
 * against an empty string and misclassify it as "Below baseline" instead
 * of leaving coverage gaps for findUncoveredEntries below to recompute
 * fresh.
 *
 * `activePacks` narrows which loaded rules actually get evaluated, by
 * BaselineRule.pack — undefined means every loaded rule is active
 * (nothing customized yet); an explicit array (even empty) is filtered to
 * exactly those packs. Lets a per-viewer baseline selection change what
 * gets judged without touching which rules were loaded at all.
 */
export function applyBaselinesToReport(report: ScanReport, baselineRules: BaselineRule[], activePacks?: string[]): ScanReport {
  const activeRules = activePacks ? baselineRules.filter((r) => activePacks.includes(r.pack)) : baselineRules;
  const rawSettings = report.settings
    .map((e) => ({ ...e, state: normalizeState(e.state) }))
    .filter((e) => e.state !== "Missing");
  const evaluated = applyBaselines(rawSettings, activeRules, report.baselineDefinitions);
  // Synthetic "Missing" entries for baseline rules with no matching
  // setting anywhere in the tenant — appended for display only, after
  // belowBaselineCount is computed from the real scanned entries, so that
  // count stays truthful to what was actually found in the tenant rather
  // than what the baseline merely wishes existed.
  const settingsWithGaps = [...evaluated, ...findUncoveredEntries(evaluated, activeRules, report.baselineDefinitions)];

  return {
    ...report,
    belowBaselineCount: evaluated.filter((e) => e.state === "Below baseline").length,
    settings: settingsWithGaps,
  };
}

/** Every definition id the given baseline rules mention, sub-settings included — what buildReport should be able to describe. */
export function baselineDefinitionIds(rules: BaselineRule[]): string[] {
  return Array.from(new Set(rules.flatMap((rule) => definitionIdsIn(rule.expected))));
}
