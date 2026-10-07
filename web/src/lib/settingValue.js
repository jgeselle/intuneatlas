/**
 * Working with a setting's structured value (SettingValueNode in
 * src/scan/types.ts) in the browser: rendering it to text, building a
 * fresh one from a definition, validating an edited one.
 */

/**
 * The tree as plain text. MUST stay identical to renderNode in
 * src/scan/configurationPolicies.ts — a staged change's "from" is the
 * scan's text and its "to" is this one's, and an edit is detected by
 * comparing the two.
 */
function renderNode(node) {
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

function childLines(children) {
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
function defaultNode(schema) {
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
function nodeFromText(text) {
  if (String(text).includes("\n")) return null;
  return { kind: "simple", definitionId: "", name: "", value: text };
}

function scalarError(schema, value) {
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

function countError(schema, count, noun) {
  if (schema?.maxCount !== undefined && count > schema.maxCount) return "At most " + schema.maxCount + " " + noun + ".";
  if (schema?.minCount !== undefined && count < schema.minCount) return "At least " + schema.minCount + " " + noun + ".";
  return null;
}

/** The first thing wrong with an edited value, as "Sub-setting name: problem", or null if it can be staged. */
function validateNode(node, schemas) {
  const schema = schemas?.[node.definitionId];
  const inChildren = (children) => {
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
function normalizeNode(node, schemas) {
  const schema = schemas?.[node.definitionId];
  const scalar = (v) => (schema?.valueType === "integer" && /^-?\d+$/.test(String(v).trim()) ? Number(v) : v);
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

function withoutChildren(node) {
  const { children: _children, ...rest } = node;
  return rest;
}

export { renderNode, defaultNode, nodeFromText, validateNode, normalizeNode };
