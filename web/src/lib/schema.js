/**
 * Helpers over a setting's definition schema (see SettingSchema in
 * src/scan/types.ts) — what Intune itself says the setting can hold.
 */

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

export { matchOption, rangeLabel };
