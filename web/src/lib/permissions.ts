// What the signed-in viewer may do, decided by the server's own rule (src/auth/roles.ts) rather than a
// copy of it: a button shows exactly where the request behind it would be allowed. The server still
// checks every request; this only keeps the UI from offering what it would refuse.
import { can, type Capability } from "../../../src/auth/roles.js";
import type { Change, Session } from "../types.js";

/** `ownerId`: who made the thing — what a Contributor may only do to what they made themselves. */
export function allows(viewer: Session | null, capability: Capability, ownerId?: string): boolean {
  return can(viewer?.role ?? null, capability, { ownerId, viewerId: viewer?.id });
}

/** Marking a change reviewed: editing it, and for a change you staged yourself, reviewing your own — see src/server/changes.ts. */
export function mayReview(viewer: Session | null, change: Pick<Change, "stagedBy">): boolean {
  return allows(viewer, "editChange", change.stagedBy) && (change.stagedBy !== viewer?.id || allows(viewer, "reviewOwnChange"));
}
