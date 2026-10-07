import { hydrateNode, renderNode } from "../scan/settingValue.js";
import type { BaselineCheck, SettingIndexEntry, SettingSchema, SettingValueNode } from "../scan/types.js";
import { compareValues, type Difference } from "./compare.js";
import type { BaselineRule } from "./types.js";

/** What a scan knows about definitions that no policy in the tenant uses — looked up because a baseline mentions them. */
export interface BaselineDefinitions {
  schemas: Record<string, SettingSchema>;
  info: Record<string, { cspPath: string; category: string }>;
}

/**
 * Gives every setting its baseline verdict, matching rules to settings by
 * Intune's setting definition id (plus platform):
 *
 * - no rule matches              -> "Not checked"
 * - every baseline with a rule is met -> "Meets baseline"
 * - any baseline is not met      -> "Below baseline", with a recommendation
 *   per baseline that isn't (a setting can have several, from different
 *   baselines that may even disagree with each other)
 *
 * One baseline can set the same setting in several of its policies —
 * different values for different groups of devices. Those are
 * alternatives: matching any one of them meets that baseline.
 *
 * Precedence: Conflict > Not assigned > the verdict above. A conflicting
 * or unassigned setting doesn't get a verdict — there's no single
 * effective value to judge yet, or it isn't reaching any device — but
 * still carries what each baseline expects.
 *
 * The verdict is always recomputed from scratch (state, recs and checks),
 * never carried over from whatever the entry came in with.
 */
export function applyBaselines(entries: SettingIndexEntry[], rules: BaselineRule[], definitions?: BaselineDefinitions): SettingIndexEntry[] {
  const byDefinition = groupBy(rules, (rule) => rule.definitionId);

  return entries.map((entry) => {
    const matching = (entry.definitionId ? (byDefinition.get(entry.definitionId) ?? []) : []).filter((rule) =>
      platformMatches(rule.platform, entry.platform),
    );
    const schemas = { ...definitions?.schemas, ...entry.schemas };
    const perPack = Array.from(groupBy(matching, (rule) => rule.pack).values());
    const unjudged = entry.state === "Conflict" || entry.state === "Not assigned";

    if (unjudged) {
      return { ...entry, checks: perPack.map((alternatives) => toCheck(alternatives, alternatives[0], null, [], schemas)) };
    }
    if (matching.length === 0) return { ...entry, state: "Not checked" as const, recs: [], checks: [] };

    // The effective value: what the assigned policies set. They agree, or this would be a conflict.
    const actual = entry.sources.find((source) => source.deployed)?.structured;
    const current = entry.values[0] ?? "";

    const judged = perPack.map((alternatives) => {
      const outcomes = alternatives.map((rule) => ({
        rule,
        differences: compareValues(hydrateNode(rule.expected, schemas), actual, rule.compare),
      }));
      // Held against the alternative it comes closest to.
      const best = outcomes.reduce((a, b) => (b.differences.length < a.differences.length ? b : a));
      return { alternatives, ...best };
    });

    const checks = judged.map(({ alternatives, rule, differences }) => toCheck(alternatives, rule, differences.length === 0, differences, schemas));
    const recs = judged
      .filter(({ differences }) => differences.length > 0)
      .map(({ rule }) => ({
        ruleId: rule.id,
        current,
        recommended: renderNode(hydrateNode(rule.expected, schemas)),
        source: rule.source,
        ...(rule.severity ? { severity: rule.severity } : {}),
        ...(rule.rationale ? { why: rule.rationale } : {}),
      }));

    return { ...entry, state: recs.length === 0 ? ("Meets baseline" as const) : ("Below baseline" as const), recs, checks };
  });
}

function toCheck(
  alternatives: BaselineRule[],
  rule: BaselineRule,
  passed: boolean | null,
  differences: Difference[],
  schemas: Record<string, SettingSchema>,
): BaselineCheck {
  const expectedNode = hydrateNode(rule.expected, schemas);
  const expected = renderNode(expectedNode);
  const others = Array.from(new Set(alternatives.map((a) => renderNode(hydrateNode(a.expected, schemas))))).filter((text) => text !== expected);
  return {
    ruleId: rule.id,
    source: rule.source,
    pack: rule.pack,
    policyName: rule.policyName,
    expected,
    expectedNode,
    ...(others.length ? { alternatives: others } : {}),
    ...(rule.compare !== "exact" ? { compare: rule.compare } : {}),
    ...(rule.severity ? { severity: rule.severity } : {}),
    ...(rule.rationale ? { why: rule.rationale } : {}),
    ...(rule.reference ? { reference: rule.reference } : {}),
    passed,
    ...(differences.length ? { differences } : {}),
  };
}

/** Graph's platform strings aren't perfectly uniform ("windows10" on a policy; a baseline file says the same) — compared loosely, and a rule with none applies everywhere. */
function platformMatches(rulePlatform: string, entryPlatform: string): boolean {
  if (!rulePlatform) return true;
  const rule = rulePlatform.toLowerCase();
  const entry = entryPlatform.toLowerCase();
  return rule.split(",").some((p) => entry.startsWith(p.trim()) || p.trim().startsWith(entry));
}

/**
 * A rule whose setting no policy in the tenant configures isn't
 * evaluated by applyBaselines at all — there's no entry for it to match.
 * That's a stronger gap than "Not assigned" (which still has a real
 * policy, just not assigned to a group): nothing in the tenant even
 * attempts the setting. Synthesizes one "Missing" entry per such setting
 * and platform, carrying a check and a recommendation per baseline that
 * expects it. Entries in every other state count as covered.
 *
 * Its name, path and category come from `definitions` — what the scan
 * looked up for exactly this purpose — and fall back to the raw
 * definition id when the scan predates that or the lookup found nothing.
 */
export function findUncoveredEntries(entries: SettingIndexEntry[], rules: BaselineRule[], definitions?: BaselineDefinitions): SettingIndexEntry[] {
  const covered = new Set(entries.filter((e) => e.definitionId).map((e) => e.definitionId as string));
  const uncovered = rules.filter(
    (rule) => !covered.has(rule.definitionId) || !entries.some((e) => e.definitionId === rule.definitionId && platformMatches(rule.platform, e.platform)),
  );
  const schemas = definitions?.schemas ?? {};

  return Array.from(groupBy(uncovered, (rule) => `${rule.definitionId}::${rule.platform}`).entries()).map(([groupKey, groupRules]) => {
    const { definitionId, platform } = groupRules[0];
    const perPack = Array.from(groupBy(groupRules, (rule) => rule.pack).values());
    const expectedOf = (node: SettingValueNode) => renderNode(hydrateNode(node, schemas));
    return {
      key: `uncovered::${groupKey}`,
      name: schemas[definitionId]?.name ?? definitionId,
      cspPath: definitions?.info[definitionId]?.cspPath ?? "",
      category: "Missing from the tenant",
      platform,
      values: [],
      sources: [],
      conflict: false,
      state: "Missing" as const,
      definitionId,
      ...(schemas[definitionId] ? { schemas } : {}),
      recs: perPack.map(([rule]) => ({
        ruleId: rule.id,
        current: "Not configured",
        recommended: expectedOf(rule.expected),
        source: rule.source,
        ...(rule.severity ? { severity: rule.severity } : {}),
        ...(rule.rationale ? { why: rule.rationale } : {}),
      })),
      checks: perPack.map((alternatives) =>
        toCheck(alternatives, alternatives[0], false, [{ path: [], expected: expectedOf(alternatives[0].expected), actual: null }], schemas),
      ),
    };
  });
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
