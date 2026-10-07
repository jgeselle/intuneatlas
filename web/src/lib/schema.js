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
  if (kind === "choice") return matchOption(schema, value) ? null : "Pick one of the listed options.";
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
  if (kind === "choice") return matchOption(schema, expected)?.label ?? null;
  if (kind === "integer") return validationError(schema, expected) ? null : String(expected).trim();
  return expected;
}

export { rootSchema, editorKind, matchOption, rangeLabel, validationError, usableValue };
