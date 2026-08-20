import { GRAPH_BETA_BASE } from "../config.js";
import { graphGetAll } from "../graph.js";
import { mapAssignmentTargets } from "./assignments.js";
import { resolveSettingDefinition, type ResolvedDefinition } from "./settingDefinitions.js";
import type { RawPolicy, RawSetting } from "./types.js";

interface GraphPolicy {
  id: string;
  name: string;
  platforms: string;
  assignments?: Array<{ target: { "@odata.type": string; groupId?: string } }>;
}

interface GraphSettingInstance {
  "@odata.type": string;
  settingDefinitionId: string;
  simpleSettingValue?: { value: unknown };
  choiceSettingValue?: { value: string };
  simpleSettingCollectionValue?: Array<{ value: unknown }>;
  choiceSettingCollectionValue?: Array<{ value: string }>;
}

interface GraphSetting {
  settingInstance: GraphSettingInstance;
}

export async function fetchConfigurationPolicies(token: string): Promise<RawPolicy[]> {
  // Confirmed live against a real tenant: this resource 404s on v1.0
  // ("Resource not found for the segment 'configurationPolicies'") — it's
  // still beta-only, same as setting-definition resolution below.
  const policies = await graphGetAll<GraphPolicy>(
    token,
    "/deviceManagement/configurationPolicies?$expand=Assignments",
    GRAPH_BETA_BASE,
  );

  return Promise.all(
    policies.map(async (policy) => ({
      id: policy.id,
      name: policy.name,
      platform: policy.platforms,
      assignments: mapAssignmentTargets(policy.assignments),
      settings: await fetchPolicySettings(token, policy.id),
    })),
  );
}

async function fetchPolicySettings(token: string, policyId: string): Promise<RawSetting[]> {
  const graphSettings = await graphGetAll<GraphSetting>(
    token,
    `/deviceManagement/configurationPolicies/${policyId}/settings`,
    GRAPH_BETA_BASE,
  );

  return Promise.all(
    graphSettings.map(async ({ settingInstance }) => {
      const definition = await resolveSettingDefinition(token, settingInstance.settingDefinitionId);
      return {
        settingDefinitionId: settingInstance.settingDefinitionId,
        name: definition.name,
        cspPath: definition.cspPath,
        category: definition.category,
        value: extractValue(settingInstance, definition),
      };
    }),
  );
}

/**
 * Best-effort value extraction covering simple and choice settings (the
 * common cases). Group/collection settings nest further settingInstances —
 * full recursion into those is a future refinement, not needed for conflict
 * detection at the top level, so they show a placeholder value for now.
 *
 * Choice values come back from Graph as opaque `{definitionId}_{index}`
 * strings, not human-readable text — resolved through the definition's
 * options map when available, falling back to the raw id otherwise (never
 * crashes on an unresolvable value; baseline rules just won't match it).
 */
function extractValue(instance: GraphSettingInstance, definition: ResolvedDefinition): string {
  const resolveOption = (itemId: string) => definition.options?.get(itemId) ?? itemId;

  if (instance.simpleSettingValue) return String(instance.simpleSettingValue.value);
  if (instance.choiceSettingValue) return resolveOption(instance.choiceSettingValue.value);
  if (instance.simpleSettingCollectionValue) {
    return instance.simpleSettingCollectionValue.map((v) => String(v.value)).join(", ");
  }
  if (instance.choiceSettingCollectionValue) {
    return instance.choiceSettingCollectionValue.map((v) => resolveOption(v.value)).join(", ");
  }
  return "(group setting)";
}
