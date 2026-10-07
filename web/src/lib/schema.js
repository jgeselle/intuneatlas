/**
 * Helpers over a setting's definition schema (see SettingSchema in
 * src/scan/types.ts) — what Intune itself says the setting can hold.
 * Everything here tolerates a missing schema: legacy device configuration
 * profiles, and scans stored before schemas were kept, don't have one and
 * fall back to free text.
 */

/** The schema of the setting itself (as opposed to any of its sub-settings). */
function rootSchema(entry) {
  return entry.definitionId ? entry.schemas?.[entry.definitionId] : undefined;
}

/** Which control edits this setting's value. */
function editorKind(schema) {
  if (schema?.kind === "choice" && schema.options?.length) return "choice";
  if (schema?.kind === "simple" && schema.valueType === "integer") return "integer";
  return "text";
}

/**
 * Whether one policy's value of this setting can be edited as a single
 * field. A value spanning several lines is several things at once (a
 * list's items, a group's children, a choice plus its sub-settings) —
 * but one line isn't proof of the opposite: a list with one item, or a
 * group with one child, renders as a single line too (found on a live
 * tenant: a one-rule Attack Surface Reduction policy). So the
 * definition's kind decides whenever there is one.
 */
function isSingleValue(schema, value) {
  if (String(value).includes("\n")) return false;
  return !schema || schema.kind === "choice" || schema.kind === "simple" || schema.kind === "unknown";
}

/** An option that brings sub-settings with it can't be picked until those can be filled in too. */
function needsSubSettings(option) {
  return Boolean(option.childIds?.length);
}

/** The option a piece of text refers to — baseline rules and stored values use labels, not always in the same case. */
function matchOption(schema, text) {
  const wanted = String(text ?? "").trim().toLowerCase();
  return schema?.options?.find((o) => o.label.trim().toLowerCase() === wanted);
}

/** "0 to 30", "0 or more", "30 or less" — or null when the definition sets no bounds. */
function rangeLabel(schema) {
  const { min, max } = schema ?? {};
  if (min !== undefined && max !== undefined) return min + " to " + max;
  if (min !== undefined) return min + " or more";
  if (max !== undefined) return max + " or less";
  return null;
}

/** Why `value` can't be staged for this setting, or null if it can. */
function validationError(schema, value) {
  const kind = editorKind(schema);
  if (kind === "choice") {
    const option = matchOption(schema, value);
    if (!option) return "Pick one of the listed options.";
    return needsSubSettings(option) ? "This option has sub-settings, which can’t be edited here yet." : null;
  }
  if (kind === "integer") {
    if (!/^-?\d+$/.test(String(value).trim())) return "Enter a whole number.";
    const n = Number(value);
    if ((schema.min !== undefined && n < schema.min) || (schema.max !== undefined && n > schema.max)) {
      return "Must be " + rangeLabel(schema) + ".";
    }
    return null;
  }
  if (schema?.maxLength !== undefined && String(value).length > schema.maxLength) {
    return "At most " + schema.maxLength + " characters.";
  }
  return null;
}

/**
 * A baseline's expectation as a value that could actually be staged, or
 * null when it can't be used as one: an expectation like "7 or less"
 * isn't a value, and on a choice setting only one of the real options is.
 * Without a schema there's nothing to check against, so it passes through.
 */
function usableValue(schema, expected) {
  const kind = editorKind(schema);
  if (kind === "choice") {
    const option = matchOption(schema, expected);
    return option && !needsSubSettings(option) ? option.label : null;
  }
  if (kind === "integer") return validationError(schema, expected) ? null : String(expected).trim();
  return expected;
}

export { rootSchema, editorKind, isSingleValue, needsSubSettings, matchOption, rangeLabel, validationError, usableValue };
