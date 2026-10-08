import { GRAPH_BETA_BASE } from "../config.js";
import { graphGetAll } from "../graph.js";
import { mapAssignmentTargets } from "./assignments.js";
import { complianceSettingsOf } from "./complianceSettings.js";
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
  return { policies, settings };
}
