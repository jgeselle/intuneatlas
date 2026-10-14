import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// The database lives under HOME — a scratch one, set before anything opens it.
const home = mkdtempSync(join(tmpdir(), "intuneatlas-changes-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { getDb } = await import("../../src/storage/db.js");
const { getChangeById, stageChange, updateReason, updateReviewer } = await import("../../src/storage/changes.js");

after(() => {
  getDb().close();
  rmSync(home, { recursive: true, force: true });
});

const stage = (key: string, reason?: string) =>
  stageChange({ targetKey: key, targetName: "Allow Camera", settingKey: "cam::windows10", policyId: "p1", policyName: "P1", ruleId: "manual", from: "Block", to: "Allow", ...(reason !== undefined ? { reason } : {}) }, "oid", "Alex");

test("review: nothing is marked reviewed before it has a reason", () => {
  const change = stage("cam::windows10::p1");
  assert.throws(() => updateReviewer(change.id, "Sam"), (err: Error) => err.name === "ChangeRefused" && /Add a reason/.test(err.message));
  assert.equal(getChangeById(change.id)!.reviewedBy, "");

  updateReason(change.id, "Kiosks need the camera");
  assert.equal(updateReviewer(change.id, "Sam").ready, true);
  // Taking a review back needs no reason.
  assert.equal(updateReviewer(change.id, "").reviewedBy, "");
});

test("review: clearing the reason takes the review with it", () => {
  const change = stage("cam::windows10::p2", "Because");
  updateReviewer(change.id, "Sam");
  const cleared = updateReason(change.id, "  ");
  assert.deepEqual([cleared.reviewedBy, cleared.ready], ["", false]);
});
