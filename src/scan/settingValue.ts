import type { SettingSchema, SettingValueNode } from "./types.js";

/**
 * A setting instance exactly as Graph returns it — from a live tenant's
 * policy, or from a policy someone exported to a JSON file. Both are the
 * same shape, which is what lets an exported policy serve as a baseline
 * with no conversion.
 */
export interface GraphSettingInstance {
  "@odata.type"?: string;
  settingDefinitionId: string;
  simpleSettingValue?: { value: unknown } | null;
  // children here is a *dependent* setting — one that only exists because
  // this specific option was selected (e.g. "Block Flash: Enabled" with a
  // dependent "Block Flash Action: ..."), a different mechanism from
  // groupSettingValue below. Confirmed against a live tenant: the child's
  // own settingDefinitionId has rootDefinitionId pointing at this PARENT
  // choice definition, not at a group definition.
  choiceSettingValue?: { value: string; children?: GraphSettingInstance[] | null } | null;
  simpleSettingCollectionValue?: Array<{ value: unknown }> | null;
  choiceSettingCollectionValue?: Array<{ value: string }> | null;
  // A group is one compound instance made of several child settings; a
  // group-collection is one or more such instances (e.g. one per
  // configured Attack Surface Reduction rule). Confirmed against a live
  // tenant: children is a flat array of further settingInstance objects
  // (same recursive shape as this interface itself).
  groupSettingValue?: { children: GraphSettingInstance[] } | null;
  groupSettingCollectionValue?: Array<{ children: GraphSettingInstance[] }> | null;
}

function scalar(value: unknown): string | number | boolean {
  return typeof value === "number" || typeof value === "boolean" ? value : String(value);
}

/**
 * The instance as a value tree using only what the instance itself holds:
 * ids. Every `name` is the definition id and every choice `label` the
 * option id until hydrateNode fills in the real ones — which needs the
 * definitions, and a baseline file doesn't come with those.
 */
export function rawNode(instance: GraphSettingInstance): SettingValueNode {
  const definitionId = instance.settingDefinitionId;
  const base = { definitionId, name: definitionId };

  if (instance.simpleSettingValue) return { kind: "simple", ...base, value: scalar(instance.simpleSettingValue.value) };
  if (instance.choiceSettingValue) {
    const children = instance.choiceSettingValue.children ?? [];
    return {
      kind: "choice",
      ...base,
      optionId: instance.choiceSettingValue.value,
      label: instance.choiceSettingValue.value,
      ...(children.length ? { children: children.map(rawNode) } : {}),
    };
  }
  if (instance.simpleSettingCollectionValue) {
    return { kind: "simpleCollection", ...base, items: instance.simpleSettingCollectionValue.map((v) => scalar(v.value)) };
  }
  if (instance.choiceSettingCollectionValue) {
    return { kind: "choiceCollection", ...base, items: instance.choiceSettingCollectionValue.map((v) => ({ optionId: v.value, label: v.value })) };
  }
  if (instance.groupSettingValue) return { kind: "group", ...base, children: instance.groupSettingValue.children.map(rawNode) };
  if (instance.groupSettingCollectionValue) {
    return { kind: "groupCollection", ...base, groups: instance.groupSettingCollectionValue.map((group) => group.children.map(rawNode)) };
  }
  return { kind: "unknown", ...base };
}

/** Fills in real names and option labels wherever `schemas` knows the definition; anything it doesn't know keeps its id. */
export function hydrateNode(node: SettingValueNode, schemas: Record<string, SettingSchema> | undefined): SettingValueNode {
  const schema = schemas?.[node.definitionId];
  const name = schema?.name ?? node.name;
  const label = (optionId: string, fallback: string) => schema?.options?.find((o) => o.id === optionId)?.label ?? fallback;
  const each = (children: SettingValueNode[]) => children.map((child) => hydrateNode(child, schemas));

  switch (node.kind) {
    case "choice":
      return { ...node, name, label: label(node.optionId, node.label), ...(node.children ? { children: each(node.children) } : {}) };
    case "choiceCollection":
      return { ...node, name, items: node.items.map((item) => ({ optionId: item.optionId, label: label(item.optionId, item.label) })) };
    case "group":
      return { ...node, name, children: each(node.children) };
    case "groupCollection":
      return { ...node, name, groups: node.groups.map(each) };
    default:
      return { ...node, name };
  }
}

/** Every definition id a value tree mentions, itself included. */
export function definitionIdsIn(node: SettingValueNode): string[] {
  const ids = [node.definitionId];
  const children = node.kind === "choice" ? (node.children ?? []) : node.kind === "group" ? node.children : node.kind === "groupCollection" ? node.groups.flat() : [];
  for (const child of children) ids.push(...definitionIdsIn(child));
  return ids;
}

/**
 * The tree as the plain text every reader has always worked with (the
 * index, conflict detection, the CSV export).
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
 *
 * web/src/lib/settingValue.js carries a copy of this for the browser;
 * the two must stay identical.
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
