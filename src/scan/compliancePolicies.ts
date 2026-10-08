import { GRAPH_BETA_BASE } from "../config.js";
import { graphGetAll } from "../graph.js";
import { isDeployed, mapAssignmentTargets } from "./assignments.js";
import { complianceSettingsOf } from "./complianceSettings.js";
import { fetchCatalogPolicies } from "./configurationPolicies.js";
import { mapSimplePolicy } from "./simplePolicy.js";
import type { RawPolicy, RawSimplePolicy } from "./types.js";

interface GraphCompliancePolicy {
  id: string;
  "@odata.type"?: string;
  displayName?: string;
  assignments?: Array<{ target: { "@odata.type": string; groupId?: string } }>;
  [property: string]: unknown;
}

/**
 * Compliance policies, twice over: `policies` is each one's identity and
 * assignment (what the tool has always kept), `settings` the same
 * policies with what each one configures, ready for the setting index.
 * A policy that configures nothing readable is in the first and not the
 * second.
 *
 * Read from beta: several current policy types (Android Enterprise
 * fully managed and AOSP among them) exist only there.
 *
 * There are two kinds, in two places: the typed, one-per-platform
 * policies, and — for Linux — policies in the Settings Catalog format
 * (see complianceCatalog.ts). Both end up in the same two lists. A
 * tenant where the second collection can't be listed is scanned without
 * it.
 *
 * The actions for noncompliance are asked for along with the policies.
 * Should Graph refuse that nested expansion, the scan goes on without
 * them rather than failing: every other setting is still there.
 */
export async function fetchCompliancePolicies(token: string): Promise<{ policies: RawSimplePolicy[]; settings: RawPolicy[] }> {
  const list = (expand: string) => graphGetAll<GraphCompliancePolicy>(token, `/deviceManagement/deviceCompliancePolicies?$expand=${expand}`, GRAPH_BETA_BASE);
  const found = await list("assignments,scheduledActionsForRule($expand=scheduledActionConfigurations)").catch((error: unknown) => {
    if (error instanceof Error && /failed: 400\b/.test(error.message)) return list("assignments");
    throw error;
  });

  const policies = found.map(mapSimplePolicy);
  const settings = found
    .map((policy, i) => ({
      id: policy.id,
      name: policies[i].name,
      platform: policies[i].platform,
      assignments: mapAssignmentTargets(policy.assignments),
      settings: complianceSettingsOf(policy),
    }))
    .filter((policy) => policy.settings.length > 0);

  const catalog = await fetchCatalogPolicies(token, "compliancePolicies").catch((error: unknown) => {
    if (error instanceof Error && /failed: (400|404)\b/.test(error.message)) return [];
    throw error;
  });
  return {
    policies: [...policies, ...catalog.map((p) => ({ id: p.id, name: p.name, platform: p.platform, deployed: isDeployed(p.assignments), targets: p.assignments }))],
    settings: [...settings, ...catalog.filter((p) => p.settings.length > 0)],
  };
}
