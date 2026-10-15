import assert from "node:assert/strict";
import { test } from "node:test";
import type { Role } from "../../src/auth/roles.js";
import { allows, mayReview } from "../../web/src/lib/permissions.js";
import type { Session } from "../../web/src/types.js";

const as = (role: Role | null, id = "me"): Session => ({ id, name: "Someone", email: "someone@example.com", role });
const ROLES = [null, "viewer", "contributor", "admin"] as const;

/** Each role against something they made, something someone else made, and something made before ownership was kept. */
function table(decide: (viewer: Session, ownerId: string) => boolean): Record<string, [boolean, boolean, boolean]> {
  return Object.fromEntries(ROLES.map((role) => [String(role), [decide(as(role), "me"), decide(as(role), "someone-else"), decide(as(role), "")]]));
}

test("what each role is offered across the app", () => {
  const expected: Record<string, Record<string, boolean>> = {
    null: { note: false, stage: false, scan: false, push: false, manageBaselines: false },
    viewer: { note: false, stage: false, scan: false, push: false, manageBaselines: false },
    contributor: { note: true, stage: true, scan: false, push: false, manageBaselines: false },
    admin: { note: true, stage: true, scan: true, push: true, manageBaselines: true },
  };
  for (const role of ROLES) {
    for (const [capability, allowed] of Object.entries(expected[String(role)])) {
      assert.equal(allows(as(role), capability as "note"), allowed, `${role} ${capability}`);
    }
  }
  // Nobody signed in (the UI on its own, under vite dev) is offered nothing.
  assert.equal(allows(null, "view"), false);
});

test("editing, reverting and deleting: your own as a Contributor, anything as an Admin", () => {
  for (const capability of ["editChange", "revertChange", "deleteNote"] as const) {
    assert.deepEqual(
      table((viewer, ownerId) => allows(viewer, capability, ownerId)),
      {
        null: [false, false, false],
        viewer: [false, false, false],
        // Something made before ownership was kept is no one's own.
        contributor: [true, false, false],
        admin: [true, true, true],
      },
      capability,
    );
  }
});

test("a note's author whose role no longer allows notes isn't offered deleting it", () => {
  // Was a Contributor when they wrote it, is a Viewer now — the server refuses, so the UI doesn't offer.
  assert.equal(allows(as("viewer"), "deleteNote", "me"), false);
});

test("reviewing: someone else's change, or your own as an Admin", () => {
  assert.deepEqual(
    table((viewer, stagedBy) => mayReview(viewer, { stagedBy })),
    {
      null: [false, false, false],
      viewer: [false, false, false],
      // A Contributor may only edit their own changes, and may not review their own: never.
      contributor: [false, false, false],
      admin: [true, true, true],
    },
  );
  assert.equal(mayReview(null, { stagedBy: "me" }), false);
});
