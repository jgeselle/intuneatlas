import { renderNode } from "../scan/settingValue.js";
import type { SettingValueNode } from "../scan/types.js";
import type { CompareMode } from "./types.js";

/** One place a tenant's value falls short of the baseline's. */
export interface Difference {
  /** The sub-setting it concerns, outermost first — empty for the setting itself. */
  path: string[];
  expected: string;
  /** What the tenant has there instead; null when it has nothing. */
  actual: string | null;
}

const same = (a: unknown, b: unknown) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Holds a tenant's value against a baseline's and lists every shortfall;
 * an empty list means the baseline is met.
 *
 * The baseline is a floor, not a mirror: everything it specifies must be
 * there, and what the tenant configures beyond it is not its business.
 * So a sub-setting the baseline sets must be set the same way, an item it
 * lists must be in the tenant's list, and an instance it describes must
 * exist — but extra sub-settings, extra list items and extra instances
 * are fine.
 *
 * `mode` relaxes only the setting's own value, and only for numbers.
 */
export function compareValues(expected: SettingValueNode, actual: SettingValueNode | undefined, mode: CompareMode = "exact"): Difference[] {
  return diff(expected, actual, [], mode);
}

function diff(expected: SettingValueNode, actual: SettingValueNode | undefined, path: string[], mode: CompareMode): Difference[] {
  if (!actual) return [{ path, expected: renderNode(expected), actual: null }];
  if (actual.kind !== expected.kind) return [{ path, expected: renderNode(expected), actual: renderNode(actual) }];

  switch (expected.kind) {
    case "simple": {
      const a = actual as typeof expected;
      if (same(expected.value, a.value)) return [];
      const want = Number(expected.value);
      const have = Number(a.value);
      const numeric = String(a.value).trim() !== "" && !Number.isNaN(want) && !Number.isNaN(have);
      if (numeric && mode === "atMost" && have <= want) return [];
      if (numeric && mode === "atLeast" && have >= want) return [];
      const label = mode === "atMost" ? `${expected.value} or less` : mode === "atLeast" ? `${expected.value} or more` : String(expected.value);
      return [{ path, expected: label, actual: String(a.value) }];
    }
    case "choice": {
      const a = actual as typeof expected;
      // A different option makes its sub-settings moot — report the option, not each child under it.
      if (expected.optionId !== a.optionId) return [{ path, expected: expected.label, actual: a.label }];
      return children(expected.children ?? [], a.children ?? [], path);
    }
    case "simpleCollection": {
      const a = actual as typeof expected;
      return expected.items
        .filter((item) => !a.items.some((other) => same(item, other)))
        .map((item) => ({ path, expected: String(item), actual: null }));
    }
    case "choiceCollection": {
      const a = actual as typeof expected;
      return expected.items
        .filter((item) => !a.items.some((other) => other.optionId === item.optionId))
        .map((item) => ({ path, expected: item.label, actual: null }));
    }
    case "group":
      return children(expected.children, (actual as typeof expected).children, path);
    case "groupCollection": {
      const a = actual as typeof expected;
      // Each instance the baseline describes is held against whichever of the tenant's comes closest.
      return expected.groups.flatMap((group) => {
        const candidates = a.groups.map((other) => children(group, other, path));
        if (candidates.length === 0) return children(group, [], path);
        return candidates.reduce((best, c) => (c.length < best.length ? c : best));
      });
    }
    default:
      return [];
  }
}

function children(expected: SettingValueNode[], actual: SettingValueNode[], path: string[]): Difference[] {
  return expected.flatMap((child) =>
    diff(
      child,
      actual.find((other) => other.definitionId === child.definitionId),
      [...path, child.name],
      "exact",
    ),
  );
}
