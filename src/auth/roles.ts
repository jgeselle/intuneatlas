export type Role = "viewer" | "contributor" | "admin";

export type Capability = "view" | "note" | "stage" | "editChange" | "revertChange" | "deleteNote" | "scan";

const RANK: Record<Role, number> = { viewer: 0, contributor: 1, admin: 2 };
const KNOWN_ROLES: Role[] = ["viewer", "contributor", "admin"];

const CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  viewer: new Set(["view"]),
  contributor: new Set(["view", "note", "stage", "editChange", "revertChange", "deleteNote"]),
  admin: new Set(["view", "note", "stage", "editChange", "revertChange", "deleteNote", "scan"]),
};

const OWNER_GATED: ReadonlySet<Capability> = new Set(["editChange", "revertChange", "deleteNote"]);

/**
 * Highest-ranked recognized role out of the raw `roles` ID token claim.
 * Case-insensitive; unrecognized values (a typo'd App Role name, an app
 * role defined for something unrelated) are silently ignored rather than
 * throwing. `null` means no capabilities at all — the "signed in, but no
 * role assigned in Entra" case, which is intentional and not a fallback
 * to full access.
 */
export function effectiveRole(claim: string[] | undefined): Role | null {
  let best: Role | null = null;
  for (const raw of claim ?? []) {
    const lower = raw.toLowerCase();
    if (!KNOWN_ROLES.includes(lower as Role)) continue;
    const role = lower as Role;
    if (best === null || RANK[role] > RANK[best]) best = role;
  }
  return best;
}

/**
 * The single enforcement point — call this server-side before any
 * mutating action. `ctx.ownerId`/`ctx.viewerId` are only consulted for the
 * owner-gated capabilities (editChange/revertChange/deleteNote), to
 * implement "a contributor can only touch things they created themselves";
 * admins bypass that check. Both must be stable identifiers (Entra object
 * IDs, `ViewerIdentity.id`) — never display names, which aren't unique or
 * stable, and would let two users who happen to share a name (or one
 * renamed user) touch each other's staged changes or notes.
 */
export function can(role: Role | null, capability: Capability, ctx?: { ownerId?: string; viewerId?: string }): boolean {
  if (role === null) return false;
  if (!CAPABILITIES[role].has(capability)) return false;
  if (OWNER_GATED.has(capability) && role === "contributor") {
    // Empty ownerId (pre-migration rows, see src/storage/db.ts's guarded
    // ALTERs) must never match — it can't be "owned" by anyone, including
    // someone whose own id is somehow also empty.
    return Boolean(ctx?.ownerId) && ctx?.ownerId === ctx?.viewerId;
  }
  return true;
}
