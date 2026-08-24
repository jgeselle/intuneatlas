import type { BaselineRule } from "./types.js";

export interface BaselinePack {
  /** e.g. "cis/windows-11-benchmark-l1" — the identifier used in a selection (see src/storage/baselineSelections.ts). */
  path: string;
  /** Prettified from the pack's top-level source folder, e.g. "cis" -> "Cis" — for grouping in the picker. */
  sourceLabel: string;
  /** The pack's own display name — the `source` its rules cite, since that's already a human-authored, correctly-capitalized description of the specific document (e.g. "CIS Microsoft Windows 11 Benchmark, L1"). */
  name: string;
  platforms: string[];
  ruleCount: number;
}

/** Groups a loaded rule set by pack, for the baseline-selection picker — always every discovered pack, regardless of any viewer's current selection. */
export function listBaselinePacks(rules: BaselineRule[]): BaselinePack[] {
  const groups = new Map<string, BaselineRule[]>();
  for (const rule of rules) {
    const group = groups.get(rule.pack);
    if (group) group.push(rule);
    else groups.set(rule.pack, [rule]);
  }

  return Array.from(groups.entries())
    .map(([path, groupRules]) => ({
      path,
      sourceLabel: prettifySegment(path.split("/")[0] ?? ""),
      name: groupRules[0].source,
      platforms: Array.from(new Set(groupRules.map((r) => r.platform))),
      ruleCount: groupRules.length,
    }))
    .sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel) || a.name.localeCompare(b.name));
}

function prettifySegment(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
