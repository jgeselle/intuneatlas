import assert from "node:assert/strict";
import { test } from "node:test";
import { mapAssignmentTargets } from "../../src/scan/assignments.js";
import { appliesToGroup, canOverlap, groupIdsIn } from "../../src/scan/targets.js";
import type { AssignmentTarget, GroupDirectory } from "../../src/scan/types.js";

const group = (groupId: string, excluded = false): AssignmentTarget => ({ kind: "group", groupId, excluded });
const everyone: AssignmentTarget = { kind: "allDevices" };
// "windows" contains "finance", which contains "finance-emea" — stored flattened, as the scan reads it.
const NESTED: GroupDirectory = { available: true, names: {}, contains: { windows: ["finance", "finance-emea"], finance: ["finance-emea"] } };

test("appliesToGroup: assigned to the group itself, to everyone, or not at all", () => {
  assert.equal(appliesToGroup([group("pilot")], "pilot"), true);
  assert.equal(appliesToGroup([everyone], "pilot"), true);
  assert.equal(appliesToGroup([{ kind: "allLicensedUsers" }], "pilot"), true);
  assert.equal(appliesToGroup([group("prod")], "pilot"), false);
  assert.equal(appliesToGroup([], "pilot"), false);
});

test("appliesToGroup: an exclusion wins — over a direct assignment and over 'everyone'", () => {
  assert.equal(appliesToGroup([everyone, group("pilot", true)], "pilot"), false);
  assert.equal(appliesToGroup([everyone, group("pilot", true)], "prod"), true);
  assert.equal(appliesToGroup([group("pilot"), group("pilot", true)], "pilot"), false);
});

test("appliesToGroup: a policy for a parent group reaches the groups inside it, at any depth — when nesting is known", () => {
  assert.equal(appliesToGroup([group("windows")], "finance", NESTED), true);
  assert.equal(appliesToGroup([group("windows")], "finance-emea", NESTED), true);
  assert.equal(appliesToGroup([group("finance")], "windows", NESTED), false, "nesting runs downward only");
  assert.equal(appliesToGroup([group("windows")], "finance"), false, "without nesting information nothing relates the two");
});

test("appliesToGroup: excluding a parent group excludes the groups inside it", () => {
  assert.equal(appliesToGroup([everyone, group("windows", true)], "finance-emea", NESTED), false);
  assert.equal(appliesToGroup([group("finance-emea"), group("windows", true)], "finance-emea", NESTED), false);
});

test("canOverlap: same group, or either one reaching everyone", () => {
  assert.equal(canOverlap([group("a")], [group("a")]), true);
  assert.equal(canOverlap([group("a"), group("b")], [group("b"), group("c")]), true);
  assert.equal(canOverlap([group("a")], [everyone]), true);
  assert.equal(canOverlap([everyone], [{ kind: "allLicensedUsers" }]), true);
});

test("canOverlap: different groups don't, and neither does anything with an unassigned policy", () => {
  assert.equal(canOverlap([group("pilot")], [group("prod")]), false);
  assert.equal(canOverlap([group("pilot")], []), false);
  assert.equal(canOverlap([group("pilot")], [group("pilot", true)]), false, "a policy made only of exclusions reaches no one");
});

test("canOverlap: exclusions keep two policies apart", () => {
  assert.equal(canOverlap([everyone, group("kiosks", true)], [group("kiosks")]), false);
  assert.equal(canOverlap([everyone, group("kiosks", true)], [group("kiosks"), group("office")]), true, "they still meet in the other group");
  assert.equal(canOverlap([everyone, group("a", true)], [everyone, group("b", true)]), true, "two 'everyone' policies always share someone");
});

test("canOverlap: a parent group and a group inside it overlap; siblings don't", () => {
  const siblings: GroupDirectory = { available: true, names: {}, contains: { windows: ["finance", "sales"] } };
  assert.equal(canOverlap([group("windows")], [group("finance")], siblings), true);
  assert.equal(canOverlap([group("finance")], [group("sales")], siblings), false);
  assert.equal(canOverlap([group("windows")], [group("finance")]), false, "unknown nesting is not assumed");
});

test("groupIdsIn: every group named, included or excluded", () => {
  assert.deepEqual(groupIdsIn([everyone, group("a"), group("b", true)]), ["a", "b"]);
});

test("mapAssignmentTargets: notes an assignment filter, and doesn't mistake 'no filter' for one", () => {
  const targets = mapAssignmentTargets([
    { target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g1", deviceAndAppManagementAssignmentFilterId: "f1", deviceAndAppManagementAssignmentFilterType: "include" } },
    { target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g2", deviceAndAppManagementAssignmentFilterId: null, deviceAndAppManagementAssignmentFilterType: "none" } },
    { target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget", deviceAndAppManagementAssignmentFilterId: "f2", deviceAndAppManagementAssignmentFilterType: "exclude" } },
    { target: { "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget", groupId: "g3" } },
  ]);
  assert.deepEqual(targets, [
    { kind: "group", groupId: "g1", excluded: false, filtered: true },
    { kind: "group", groupId: "g2", excluded: false },
    { kind: "allDevices", filtered: true },
    { kind: "group", groupId: "g3", excluded: true },
  ]);
});
