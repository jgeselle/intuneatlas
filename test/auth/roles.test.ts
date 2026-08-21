import assert from "node:assert/strict";
import { test } from "node:test";
import { can, effectiveRole } from "../../src/auth/roles.js";

test("effectiveRole: no claim at all -> null", () => {
  assert.equal(effectiveRole(undefined), null);
  assert.equal(effectiveRole([]), null);
});

test("effectiveRole: unrecognized values are ignored", () => {
  assert.equal(effectiveRole(["some-other-app-role"]), null);
  assert.equal(effectiveRole(["some-other-app-role", "viewer"]), "viewer");
});

test("effectiveRole: case-insensitive", () => {
  assert.equal(effectiveRole(["Admin"]), "admin");
  assert.equal(effectiveRole(["CONTRIBUTOR"]), "contributor");
});

test("effectiveRole: highest-ranked recognized role wins when multiple are assigned", () => {
  assert.equal(effectiveRole(["viewer", "admin"]), "admin");
  assert.equal(effectiveRole(["contributor", "viewer"]), "contributor");
  assert.equal(effectiveRole(["admin", "contributor", "viewer"]), "admin");
});

test("can: no role -> false for every capability", () => {
  for (const capability of ["view", "note", "stage", "editChange", "revertChange", "scan"] as const) {
    assert.equal(can(null, capability), false);
  }
});

test("can: viewer -> view only", () => {
  assert.equal(can("viewer", "view"), true);
  assert.equal(can("viewer", "note"), false);
  assert.equal(can("viewer", "stage"), false);
  assert.equal(can("viewer", "scan"), false);
  assert.equal(can("viewer", "editChange", { stagedBy: "alice", viewerId: "alice" }), false);
});

test("can: contributor -> view/note/stage, but not scan", () => {
  assert.equal(can("contributor", "view"), true);
  assert.equal(can("contributor", "note"), true);
  assert.equal(can("contributor", "stage"), true);
  assert.equal(can("contributor", "scan"), false);
});

test("can: contributor editChange/revertChange only on their own staged changes", () => {
  assert.equal(can("contributor", "editChange", { stagedBy: "alice", viewerId: "alice" }), true);
  assert.equal(can("contributor", "editChange", { stagedBy: "bob", viewerId: "alice" }), false);
  assert.equal(can("contributor", "revertChange", { stagedBy: "alice", viewerId: "alice" }), true);
  assert.equal(can("contributor", "revertChange", { stagedBy: "bob", viewerId: "alice" }), false);
});

test("can: contributor editChange/revertChange with no context -> false", () => {
  assert.equal(can("contributor", "editChange"), false);
  assert.equal(can("contributor", "revertChange"), false);
});

test("can: contributor editChange/revertChange on a pre-migration row (stagedBy = '') is never owned", () => {
  assert.equal(can("contributor", "editChange", { stagedBy: "", viewerId: "alice" }), false);
  // Not even by someone whose own name happens to be empty-ish/unset.
  assert.equal(can("contributor", "editChange", { stagedBy: "", viewerId: "" }), false);
});

test("can: admin -> everything, including any change regardless of who staged it", () => {
  for (const capability of ["view", "note", "stage", "scan"] as const) {
    assert.equal(can("admin", capability), true);
  }
  assert.equal(can("admin", "editChange", { stagedBy: "bob", viewerId: "alice" }), true);
  assert.equal(can("admin", "revertChange", { stagedBy: "bob", viewerId: "alice" }), true);
  assert.equal(can("admin", "editChange"), true);
});
