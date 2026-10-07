import { GRAPH_BETA_BASE } from "../config.js";
import { graphGetAll } from "../graph.js";
import { mapAssignmentTargets } from "./assignments.js";
import { resolveSettingDefinition, type ResolvedDefinition } from "./settingDefinitions.js";
import type { RawPolicy, RawSetting, SettingSchema, SettingValueNode } from "./types.js";

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
      const schemas: Record<string, SettingSchema> = {};
      const structured = await buildNode(token, settingInstance, definition, schemas);
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

/**
 * The tree as the plain text every reader has always worked with (the
 * index, conflict detection, baseline rules, the CSV export).
 *
 * Any compound value (a collection's items, a group's children, a
 * dependent child) is newline-joined rather than comma/semicolon-joined
 * or parenthesized. Confirmed against real data that this matters, not
 * just cosmetic: a group with several children easily runs well past a
 * thousand characters, and the web UI splits on "\n" to render each part
 * as its own line instead of one unreadable run-on string. Every level
 * of nesting still produces one line per child ("ChildName: value"), so
 * a child whose own value is itself multi-line doesn't collapse back
 * into an unreadable blob — each of its lines gets the child's name
 * prefixed too.
 */
export function renderNode(node: SettingValueNode): string {
  switch (node.kind) {
    case "simple":
      return String(node.value);
    case "choice":
      return node.children?.length ? [node.label, ...childLines(node.children)].join("\n") : node.label;
    case "simpleCollection":
      return node.items.map(String).join("\n");
    case "choiceCollection":
      return node.items.map((item) => item.label).join("\n");
    case "group":
      return childLines(node.children).join("\n");
    case "groupCollection":
      if (node.groups.length === 1) return childLines(node.groups[0]).join("\n");
      // Multiple instances (e.g. several configured ASR rules) get numbered so
      // they're distinguishable rather than reading as one flat list.
      return node.groups.flatMap((group, i) => childLines(group).map((line) => `[${i + 1}] ${line}`)).join("\n");
    default:
      return "(unsupported setting type)";
  }
}

/** One line per child, "ChildName: value" — a multi-line child value gets the name prefixed onto each of its own lines. */
function childLines(children: SettingValueNode[]): string[] {
  return children.flatMap((child) =>
    renderNode(child)
      .split("\n")
      .map((line) => `${child.name}: ${line}`),
  );
}
