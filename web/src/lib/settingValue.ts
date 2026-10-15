/**
 * Working with a setting's structured value (SettingValueNode in
 * src/scan/types.ts) in the browser: rendering it to text, building a
 * fresh one from a definition, validating an edited one.
 */
import type { SettingSchema, SettingValueNode } from "../types.js";

type Schemas = Record<string, SettingSchema> | undefined;
type Scalar = string | number | boolean;
/** One kind of node, e.g. NodeOf<"choice">. */
type NodeOf<K extends SettingValueNode["kind"]> = Extract<SettingValueNode, { kind: K }>;

/**
 * The tree as plain text. MUST stay identical to renderNode in
 * src/scan/configurationPolicies.ts — a staged change's "from" is the
 * scan's text and its "to" is this one's, and an edit is detected by
 * comparing the two.
 */
function renderNode(node: SettingValueNode): string {
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
      return node.groups.flatMap((group, i) => childLines(group).map((line) => `[${i + 1}] ${line}`)).join("\n");
    default:
      return "(unsupported setting type)";
  }
}

function childLines(children: SettingValueNode[]): string[] {
  return children.flatMap((child) =>
    renderNode(child)
      .split("\n")
      .map((line) => `${child.name}: ${line}`),
  );
}

/**
 * A new value for a definition, as Intune would start it: the default
 * option or default value where the definition names one. Sub-settings
 * are never added on their own — every one of them is optional.
 */
function defaultNode(schema: SettingSchema): SettingValueNode {
  const base = { definitionId: schema.definitionId, name: schema.name };
  switch (schema.kind) {
    case "choice": {
      const option = schema.options?.find((o) => o.id === schema.defaultOptionId) ?? schema.options?.[0];
      return option ? { kind: "choice", ...base, optionId: option.id, label: option.label } : { kind: "simple", ...base, value: "" };
    }
    case "simpleCollection":
      return { kind: "simpleCollection", ...base, items: [] };
    case "choiceCollection":
      return { kind: "choiceCollection", ...base, items: [] };
    case "group":
      return { kind: "group", ...base, children: [] };
    case "groupCollection":
      return { kind: "groupCollection", ...base, groups: [[]] };
    default:
      return { kind: "simple", ...base, value: schema.defaultValue ?? (schema.valueType === "integer" ? (schema.min ?? 0) : "") };
  }
}

/**
 * A value that has no structure of its own (a legacy profile's, or one
 * from a scan stored before structure was kept), as an editable node —
 * or null if it holds several lines and so can't be one field.
 */
function nodeFromText(text: Scalar): SettingValueNode | null {
  if (String(text).includes("\n")) return null;
  return { kind: "simple", definitionId: "", name: "", value: text };
}

function scalarError(schema: SettingSchema | undefined, value: Scalar): string | null {
  const text = String(value).trim();
  if (text === "") return "Enter a value.";
  if (schema?.valueType === "integer") {
    if (!/^-?\d+$/.test(text)) return "Enter a whole number.";
    const n = Number(text);
    if (schema.min !== undefined && schema.max !== undefined && (n < schema.min || n > schema.max)) {
      return "Must be " + schema.min + " to " + schema.max + ".";
    }
    if (schema.min !== undefined && n < schema.min) return "Must be " + schema.min + " or more.";
    if (schema.max !== undefined && n > schema.max) return "Must be " + schema.max + " or less.";
  }
  if (schema?.valueType === "string") {
    if (schema.maxLength !== undefined && String(value).length > schema.maxLength) return "At most " + schema.maxLength + " characters.";
    if (schema.minLength !== undefined && String(value).length < schema.minLength) return "At least " + schema.minLength + " characters.";
  }
  return null;
}

function countError(schema: SettingSchema | undefined, count: number, noun: string): string | null {
  if (schema?.maxCount !== undefined && count > schema.maxCount) return "At most " + schema.maxCount + " " + noun + ".";
  if (schema?.minCount !== undefined && count < schema.minCount) return "At least " + schema.minCount + " " + noun + ".";
  return null;
}

/** The first thing wrong with an edited value, as "Sub-setting name: problem", or null if it can be staged. */
function validateNode(node: SettingValueNode, schemas: Schemas): string | null {
  const schema = schemas?.[node.definitionId];
  const inChildren = (children: SettingValueNode[]) => {
    for (const child of children) {
      const error = validateNode(child, schemas);
      if (error) return child.name + ": " + error;
    }
    return null;
  };

  switch (node.kind) {
    case "simple":
      return scalarError(schema, node.value);
    case "choice":
      if (schema?.options?.length && !schema.options.some((o) => o.id === node.optionId)) return "Pick one of the listed options.";
      return inChildren(node.children ?? []);
    case "simpleCollection": {
      for (const item of node.items) {
        const error = scalarError(schema, item);
        if (error) return error;
      }
      return countError(schema, node.items.length, "items");
    }
    case "choiceCollection":
      return countError(schema, node.items.length, "options");
    case "group":
      return inChildren(node.children);
    case "groupCollection": {
      for (const group of node.groups) {
        const error = inChildren(group);
        if (error) return error;
      }
      return countError(schema, node.groups.length, "instances");
    }
    default:
      return null;
  }
}

/**
 * Whole numbers are typed as text while editing; this puts them back as
 * numbers (what Graph stores) before a value is staged.
 */
function normalizeNode(node: SettingValueNode, schemas: Schemas): SettingValueNode {
  const schema = schemas?.[node.definitionId];
  const scalar = (v: Scalar) => (schema?.valueType === "integer" && /^-?\d+$/.test(String(v).trim()) ? Number(v) : v);
  switch (node.kind) {
    case "simple":
      return { ...node, value: scalar(node.value) };
    case "choice":
      return node.children?.length ? { ...node, children: node.children.map((c) => normalizeNode(c, schemas)) } : withoutChildren(node);
    case "simpleCollection":
      return { ...node, items: node.items.map(scalar) };
    case "group":
      return { ...node, children: node.children.map((c) => normalizeNode(c, schemas)) };
    case "groupCollection":
      return { ...node, groups: node.groups.map((g) => g.map((c) => normalizeNode(c, schemas))) };
    default:
      return node;
  }
}

function withoutChildren(node: NodeOf<"choice">): NodeOf<"choice"> {
  const { children: _children, ...rest } = node;
  return rest;
}

/**
 * A draft brought up to a baseline's value. The baseline is a floor, so
 * this adds and corrects what the baseline specifies and leaves the rest
 * of the draft alone: its sub-settings are set, its list items and ticked
 * options are added, and anything else already there stays.
 */
function applyExpected(draft: SettingValueNode | null, expected: SettingValueNode): SettingValueNode {
  if (!draft || draft.kind !== expected.kind) return expected;
  // Same kind as `expected` from here on, which TypeScript can't follow through the switch below.
  const same = <K extends SettingValueNode["kind"]>(_: NodeOf<K>) => draft as NodeOf<K>;
  const overlay = (mine: SettingValueNode[], theirs: SettingValueNode[]): SettingValueNode[] => {
    const merged = mine.map((child) => {
      const match = theirs.find((t) => t.definitionId === child.definitionId);
      return match ? applyExpected(child, match) : child;
    });
    return [...merged, ...theirs.filter((t) => !mine.some((child) => child.definitionId === t.definitionId))];
  };

  switch (expected.kind) {
    case "simple":
      return { ...same(expected), value: expected.value };
    case "choice": {
      const mine = same(expected);
      // Sub-settings only carry over while the option stays the same.
      const kept = mine.optionId === expected.optionId ? (mine.children ?? []) : [];
      const children = overlay(kept, expected.children ?? []);
      const { children: _dropped, ...rest } = mine;
      return { ...rest, optionId: expected.optionId, label: expected.label, ...(children.length ? { children } : {}) };
    }
    case "simpleCollection": {
      const mine = same(expected);
      const has = (item: Scalar) => mine.items.some((mine) => String(mine).trim().toLowerCase() === String(item).trim().toLowerCase());
      return { ...mine, items: [...mine.items, ...expected.items.filter((item) => !has(item))] };
    }
    case "choiceCollection": {
      const mine = same(expected);
      return { ...mine, items: [...mine.items, ...expected.items.filter((item) => !mine.items.some((own) => own.optionId === item.optionId))] };
    }
    case "group": {
      const mine = same(expected);
      return { ...mine, children: overlay(mine.children, expected.children) };
    }
    case "groupCollection": {
      const mine = same(expected);
      const groups = expected.groups.map((group, i) => (mine.groups[i] ? overlay(mine.groups[i], group) : group));
      return { ...mine, groups: [...groups, ...mine.groups.slice(expected.groups.length)] };
    }
    default:
      return draft;
  }
}

export { renderNode, defaultNode, nodeFromText, validateNode, normalizeNode, applyExpected };
