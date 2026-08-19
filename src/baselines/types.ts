/** Matches the schema already documented publicly on the landing page — not free to redesign. */
export interface BaselineRule {
  id: string;
  name: string;
  platform: string;
  path: string;
  expect: string | { min?: number; max?: number };
  severity: "critical" | "high" | "medium" | "low";
  rationale: string;
  source: string;
}
