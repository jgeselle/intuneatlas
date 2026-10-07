import type { AssignmentTarget, GroupDirectory } from "./types.js";

/**
 * Reasoning about who policies are assigned to — at the level of groups,
 * never of individual devices or users. Two questions:
 *
 * - does this policy reach this group? (appliesToGroup)
 * - can these two policies reach the same group? (canOverlap)
 *
 * A group is reached by a policy assigned to it, to a group that contains
 * it (any number of levels up, when the scan could read group nesting),
 * or to all devices / all users — unless the policy excludes it, or a
 * group containing it.
 *
 * What this cannot see: a device that happens to be a member of two
 * unrelated groups. Deciding that needs every group's membership, which
 * the scan deliberately doesn't read.
 */

/** `group` itself plus every group that contains it. */
function withParents(group: string, groups: GroupDirectory | undefined): Set<string> {
  const result = new Set([group]);
  for (const [parent, children] of Object.entries(groups?.contains ?? {})) {
    if (children.includes(group)) result.add(parent);
  }
  return result;
}

interface Reach {
  everyone: boolean;
  includes: string[];
  excludes: string[];
}

function reach(targets: AssignmentTarget[]): Reach {
  return {
    everyone: targets.some((t) => t.kind !== "group"),
    includes: targets.filter((t): t is Extract<AssignmentTarget, { kind: "group" }> => t.kind === "group" && !t.excluded).map((t) => t.groupId),
    excludes: targets.filter((t): t is Extract<AssignmentTarget, { kind: "group" }> => t.kind === "group" && t.excluded).map((t) => t.groupId),
  };
}

/** Whether a policy with these targets reaches the given group. */
export function appliesToGroup(targets: AssignmentTarget[], group: string, groups?: GroupDirectory): boolean {
  const r = reach(targets);
  const lineage = withParents(group, groups);
  if (r.excludes.some((excluded) => lineage.has(excluded))) return false;
  return r.everyone || r.includes.some((included) => lineage.has(included));
}

/**
 * Whether two policies can reach the same group, going only by what
 * their assignments say: one group in common (directly or through
 * nesting), or either of them targeting everyone — after taking out what
 * the other excludes.
 */
export function canOverlap(a: AssignmentTarget[], b: AssignmentTarget[], groups?: GroupDirectory): boolean {
  const ra = reach(a);
  const rb = reach(b);
  // Every group either policy names is a place they could meet; so is "everyone", if both go there.
  const candidates = new Set([...ra.includes, ...rb.includes]);
  for (const group of [...candidates]) for (const child of groups?.contains[group] ?? []) candidates.add(child);
  for (const group of candidates) {
    if (appliesToGroup(a, group, groups) && appliesToGroup(b, group, groups)) return true;
  }
  // Both assigned to everyone: exclusions can carve groups out, but never everything.
  return ra.everyone && rb.everyone;
}

/** Every group id a set of targets mentions, included or excluded. */
export function groupIdsIn(targets: AssignmentTarget[]): string[] {
  return targets.filter((t): t is Extract<AssignmentTarget, { kind: "group" }> => t.kind === "group").map((t) => t.groupId).filter(Boolean);
}
