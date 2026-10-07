import { GRAPH_BETA_BASE } from "../config.js";
import { graphGetAll } from "../graph.js";
import { mapAssignmentTargets } from "./assignments.js";
import { resolveDeclaredSchemas, resolveSettingDefinition, type ResolvedDefinition } from "./settingDefinitions.js";
import { renderNode, type GraphSettingInstance } from "./settingValue.js";
import type { RawPolicy, RawSetting, SettingSchema, SettingValueNode } from "./types.js";

interface GraphPolicy {
  id: string;
  name: string;
  platforms: string;
  assignments?: Array<{ target: { "@odata.type": string; groupId?: string } }>;
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
      const schemas: Record<string, SettingSchema> = {};
      const structured = await buildNode(token, settingInstance, definition, schemas);
      await resolveDeclaredSchemas(token, schemas);
      return {
        settingDefinitionId: settingInstance.settingDefinitionId,
        name: definition.name,
        cspPath: definition.cspPath,
        category: definition.category,
        value: renderNode(structured),
        structured,
        schemas,
      };
    }),
  );
}

/**
 * Turns Graph's setting instance into a SettingValueNode tree — simple,
 * choice, collection and group/group-collection settings, plus a choice
 * value's own dependent children (a distinct mechanism from group
 * settings — see the comment on
 * GraphSettingInstance.choiceSettingValue.children). Confirmed against a
 * live tenant (Attack Surface Reduction Rules for groups; a real
 * "Block Flash activation" + dependent "Block Flash Action" pair for
 * choice children) that both are a flat one-level-deep children array,
 * not arbitrarily nested, but the recursion handles deeper nesting too
 * if a real tenant ever has it.
 *
 * Choice values come back from Graph as opaque `{definitionId}_{index}`
 * strings, not human-readable text — resolved through the definition's
 * options map when available, falling back to the raw id otherwise (never
 * crashes on an unresolvable value; baseline rules just won't match it).
 *
 * Every definition touched along the way lands in `schemas`, so whoever
 * holds the tree also holds what each node in it is allowed to be.
 */
async function buildNode(
  token: string,
  instance: GraphSettingInstance,
  definition: ResolvedDefinition,
  schemas: Record<string, SettingSchema>,
): Promise<SettingValueNode> {
  const definitionId = instance.settingDefinitionId;
  const name = definition.name;
  const option = (itemId: string) => ({ optionId: itemId, label: definition.options?.get(itemId) ?? itemId });
  const children = (instances: GraphSettingInstance[]) =>
    Promise.all(
      instances.map(async (child) => buildNode(token, child, await resolveSettingDefinition(token, child.settingDefinitionId), schemas)),
    );
  const done = (node: SettingValueNode): SettingValueNode => {
    // A definition that didn't declare its own shape takes it from the value it actually holds.
    schemas[definitionId] = definition.schema.kind === "unknown" ? { ...definition.schema, kind: node.kind } : definition.schema;
    return node;
  };

  if (instance.simpleSettingValue) {
    return done({ kind: "simple", definitionId, name, value: scalar(instance.simpleSettingValue.value) });
  }
  if (instance.choiceSettingValue) {
    const nested = instance.choiceSettingValue.children;
    return done({
      kind: "choice",
      definitionId,
      name,
      ...option(instance.choiceSettingValue.value),
      ...(nested?.length ? { children: await children(nested) } : {}),
    });
  }
  if (instance.simpleSettingCollectionValue) {
    return done({ kind: "simpleCollection", definitionId, name, items: instance.simpleSettingCollectionValue.map((v) => scalar(v.value)) });
  }
  if (instance.choiceSettingCollectionValue) {
    return done({ kind: "choiceCollection", definitionId, name, items: instance.choiceSettingCollectionValue.map((v) => option(v.value)) });
  }
  if (instance.groupSettingValue) {
    return done({ kind: "group", definitionId, name, children: await children(instance.groupSettingValue.children) });
  }
  if (instance.groupSettingCollectionValue) {
    return done({
      kind: "groupCollection",
      definitionId,
      name,
      groups: await Promise.all(instance.groupSettingCollectionValue.map((group) => children(group.children))),
    });
  }
  return done({ kind: "unknown", definitionId, name });
}

function scalar(value: unknown): string | number | boolean {
  return typeof value === "number" || typeof value === "boolean" ? value : String(value);
}

// Kept as this module's export too: it's where every caller has always found it.
export { renderNode };
