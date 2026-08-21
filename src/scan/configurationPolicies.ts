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
  // A group is one compound instance made of several child settings; a
  // group-collection is one or more such instances (e.g. one per
  // configured Attack Surface Reduction rule). Confirmed against a live
  // tenant: children is a flat array of further settingInstance objects
  // (same recursive shape as this interface itself).
  groupSettingValue?: { children: GraphSettingInstance[] };
  groupSettingCollectionValue?: Array<{ children: GraphSettingInstance[] }>;
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
        value: await extractValue(token, settingInstance, definition),
      };
    }),
  );
}

/**
 * Value extraction covering simple, choice, and group/group-collection
 * settings. Group settings recurse: each child is itself a full setting
 * instance with its own definition to resolve and its own value to
 * extract, same as the top-level call — confirmed against a live tenant
 * (Attack Surface Reduction Rules) that this is a flat one-level-deep
 * children array per group, not arbitrarily nested, but the recursive
 * call handles deeper nesting too if a real tenant ever has it.
 *
 * Choice values come back from Graph as opaque `{definitionId}_{index}`
 * strings, not human-readable text — resolved through the definition's
 * options map when available, falling back to the raw id otherwise (never
 * crashes on an unresolvable value; baseline rules just won't match it).
 */
async function extractValue(
  token: string,
  instance: GraphSettingInstance,
  definition: ResolvedDefinition,
): Promise<string> {
  const resolveOption = (itemId: string) => definition.options?.get(itemId) ?? itemId;

  if (instance.simpleSettingValue) return String(instance.simpleSettingValue.value);
  if (instance.choiceSettingValue) return resolveOption(instance.choiceSettingValue.value);
  if (instance.simpleSettingCollectionValue) {
    return instance.simpleSettingCollectionValue.map((v) => String(v.value)).join(", ");
  }
  if (instance.choiceSettingCollectionValue) {
    return instance.choiceSettingCollectionValue.map((v) => resolveOption(v.value)).join(", ");
  }
  if (instance.groupSettingValue) {
    return summarizeGroups(token, [instance.groupSettingValue]);
  }
  if (instance.groupSettingCollectionValue) {
    return summarizeGroups(token, instance.groupSettingCollectionValue);
  }
  return "(unsupported setting type)";
}

async function summarizeGroups(token: string, groups: Array<{ children: GraphSettingInstance[] }>): Promise<string> {
  const groupSummaries = await Promise.all(
    groups.map(async (group) => {
      const parts = await Promise.all(
        group.children.map(async (child) => {
          const childDefinition = await resolveSettingDefinition(token, child.settingDefinitionId);
          const childValue = await extractValue(token, child, childDefinition);
          return `${childDefinition.name}: ${childValue}`;
        }),
      );
      return parts.join(", ");
    }),
  );
  // Multiple instances (e.g. several configured ASR rules) get numbered so
  // they don't read as one run-on value.
  return groupSummaries.length === 1
    ? groupSummaries[0]
    : groupSummaries.map((s, i) => `[${i + 1}] ${s}`).join("; ");
}
