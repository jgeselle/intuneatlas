/**
 * The YAML-authored fields (id through source) match the schema already
 * documented publicly on the landing page — not free to redesign. `pack`
 * is different: the loader computes it from the file's own location
 * under the baselines directory (its first two path segments, e.g.
 * "cis/windows-11-benchmark-l1"), never something a rule's YAML sets
 * itself — see loadBaselines. It's how a rule is grouped for baseline
 * selection (src/baselines/packs.ts).
 */
export interface BaselineRule {
  id: string;
  name: string;
  platform: string;
  path: string;
  expect: string | { min?: number; max?: number };
  severity: "critical" | "high" | "medium" | "low";
  rationale: string;
  source: string;
  pack: string;
}
