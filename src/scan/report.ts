import { applyBaselines, findUncoveredEntries } from "../baselines/evaluate.js";
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
export async function buildReport(token: string, flow: string, tenant: string): Promise<ScanReport> {
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
  const settingIndex = buildSettingIndex([...policies, ...legacyPolicies]);

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
 * output, not raw) — strips any synthetic "Not covered" entries from a
 * prior run first. Those have no real value to re-derive anything from
 * (values: []), so feeding one back into applyBaselines would score it
 * against an empty string and misclassify it as "Below baseline" instead
 * of leaving coverage gaps for findUncoveredEntries below to recompute
 * fresh.
 */
export function applyBaselinesToReport(report: ScanReport, baselineRules: BaselineRule[]): ScanReport {
  const rawSettings = report.settings.filter((e) => e.state !== "Not covered");
  const evaluated = applyBaselines(rawSettings, baselineRules);
  // Synthetic "Not covered" entries for baseline rules with no matching
  // setting anywhere in the tenant — appended for display only, after
  // belowBaselineCount is computed from the real scanned entries, so that
  // count stays truthful to what was actually found in the tenant rather
  // than what the baseline merely wishes existed.
  const settingsWithGaps = [...evaluated, ...findUncoveredEntries(evaluated, baselineRules)];

  return {
    ...report,
    belowBaselineCount: evaluated.filter((e) => e.state === "Below baseline").length,
    settings: settingsWithGaps,
  };
}
