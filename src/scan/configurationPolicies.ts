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
  // children here is a *dependent* setting — one that only exists because
  // this specific option was selected (e.g. "Block Flash: Enabled" with a
  // dependent "Block Flash Action: ..."), a different mechanism from
  // groupSettingValue below. Confirmed against a live tenant: the child's
  // own settingDefinitionId has rootDefinitionId pointing at this PARENT
  // choice definition, not at a group definition.
  choiceSettingValue?: { value: string; children?: GraphSettingInstance[] };
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
 * settings, plus a choice value's own dependent children (a distinct
 * mechanism from group settings — see the comment on
 * GraphSettingInstance.choiceSettingValue.children). Confirmed against a
 * live tenant (Attack Surface Reduction Rules for groups; a real
 * "Block Flash activation" + dependent "Block Flash Action" pair for
 * choice children) that both are a flat one-level-deep children array,
 * not arbitrarily nested, but the recursive call handles deeper nesting
 * too if a real tenant ever has it.
 *
 * Any compound value (a collection's items, a group's children, a
 * dependent child) is newline-joined rather than comma/semicolon-joined
 * or parenthesized. Confirmed against real data that this matters, not
 * just cosmetic: a group with several children easily runs well past a
 * thousand characters, and the web UI splits on "\n" to render each part
 * as its own line instead of one unreadable run-on string — the previous
 * comma/paren joining made that impossible to do downstream. Every level
 * of nesting still produces one line per child ("ChildName: value"), so
 * a child whose own value is itself multi-line doesn't collapse back
 * into an unreadable blob — each of its lines gets the child's name
 * prefixed too.
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
  if (instance.choiceSettingValue) {
    const resolved = resolveOption(instance.choiceSettingValue.value);
    const children = instance.choiceSettingValue.children;
    if (children?.length) return [resolved, ...(await childInstanceLines(token, children))].join("\n");
    return resolved;
  }
  if (instance.simpleSettingCollectionValue) {
    return instance.simpleSettingCollectionValue.map((v) => String(v.value)).join("\n");
  }
  if (instance.choiceSettingCollectionValue) {
    return instance.choiceSettingCollectionValue.map((v) => resolveOption(v.value)).join("\n");
  }
  if (instance.groupSettingValue) {
    return (await childInstanceLines(token, instance.groupSettingValue.children)).join("\n");
  }
  if (instance.groupSettingCollectionValue) {
    return summarizeGroupCollection(token, instance.groupSettingCollectionValue);
  }
  return "(unsupported setting type)";
}

/** One line per child, "ChildName: value" — a multi-line child value gets the name prefixed onto each of its own lines. */
async function childInstanceLines(token: string, children: GraphSettingInstance[]): Promise<string[]> {
  const perChild = await Promise.all(
    children.map(async (child) => {
      const childDefinition = await resolveSettingDefinition(token, child.settingDefinitionId);
      const childValue = await extractValue(token, child, childDefinition);
      return childValue.split("\n").map((line) => `${childDefinition.name}: ${line}`);
    }),
  );
  return perChild.flat();
}

async function summarizeGroupCollection(token: string, groups: Array<{ children: GraphSettingInstance[] }>): Promise<string> {
  if (groups.length === 1) {
    return (await childInstanceLines(token, groups[0].children)).join("\n");
  }
  // Multiple instances (e.g. several configured ASR rules) get numbered so
  // they're distinguishable rather than reading as one flat list.
  const numbered = await Promise.all(
    groups.map(async (group, i) => (await childInstanceLines(token, group.children)).map((line) => `[${i + 1}] ${line}`)),
  );
  return numbered.flat().join("\n");
}
