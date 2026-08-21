import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeployed, mapAssignmentTargets } from "../../src/scan/assignments.js";

test("isDeployed", async (t) => {
  await t.test("no assignments at all — not deployed", () => {
    assert.equal(isDeployed([]), false);
  });

  await t.test("allDevices — deployed", () => {
    assert.equal(isDeployed([{ kind: "allDevices" }]), true);
  });

  await t.test("allLicensedUsers — deployed", () => {
    assert.equal(isDeployed([{ kind: "allLicensedUsers" }]), true);
  });

  await t.test("a real group inclusion — deployed", () => {
    assert.equal(isDeployed([{ kind: "group", groupId: "g1", excluded: false }]), true);
  });

  await t.test("a single group exclusion, nothing else — not deployed", () => {
    assert.equal(isDeployed([{ kind: "group", groupId: "g1", excluded: true }]), false);
  });

  await t.test("multiple exclusions only, still nothing included — not deployed", () => {
    assert.equal(
      isDeployed([
        { kind: "group", groupId: "g1", excluded: true },
        { kind: "group", groupId: "g2", excluded: true },
      ]),
      false,
    );
  });

  await t.test("an exclusion alongside a real target — deployed (the exclusion doesn't disqualify it)", () => {
    assert.equal(
      isDeployed([
        { kind: "allDevices" },
        { kind: "group", groupId: "g1", excluded: true },
      ]),
      true,
    );
  });
});

test("mapAssignmentTargets", async (t) => {
  await t.test("allDevicesAssignmentTarget", () => {
    assert.deepEqual(mapAssignmentTargets([{ target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } }]), [
      { kind: "allDevices" },
    ]);
  });

  await t.test("allLicensedUsersAssignmentTarget", () => {
    assert.deepEqual(mapAssignmentTargets([{ target: { "@odata.type": "#microsoft.graph.allLicensedUsersAssignmentTarget" } }]), [
      { kind: "allLicensedUsers" },
    ]);
  });

  await t.test("groupAssignmentTarget — a plain inclusion", () => {
    assert.deepEqual(
      mapAssignmentTargets([{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "abc-123" } }]),
      [{ kind: "group", groupId: "abc-123", excluded: false }],
    );
  });

  await t.test("exclusionGroupAssignmentTarget — marked excluded", () => {
    assert.deepEqual(
      mapAssignmentTargets([{ target: { "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget", groupId: "abc-123" } }]),
      [{ kind: "group", groupId: "abc-123", excluded: true }],
    );
  });

  await t.test("scopeTagGroupAssignmentTarget — filtered out entirely (RBAC scope, not a deployment target)", () => {
    assert.deepEqual(
      mapAssignmentTargets([
        { target: { "@odata.type": "#microsoft.graph.scopeTagGroupAssignmentTarget", groupId: "scope-1" } },
        { target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } },
      ]),
      [{ kind: "allDevices" }],
    );
  });

  await t.test("an unrecognized odata type falls back to a plain inclusion, not dropped or thrown", () => {
    assert.deepEqual(
      mapAssignmentTargets([{ target: { "@odata.type": "#microsoft.graph.someFutureAssignmentTarget", groupId: "abc-123" } }]),
      [{ kind: "group", groupId: "abc-123", excluded: false }],
    );
  });

  await t.test("missing groupId defaults to an empty string rather than undefined", () => {
    assert.deepEqual(mapAssignmentTargets([{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget" } }]), [
      { kind: "group", groupId: "", excluded: false },
    ]);
  });

  await t.test("no assignments — empty array in, empty array out", () => {
    assert.deepEqual(mapAssignmentTargets([]), []);
    assert.deepEqual(mapAssignmentTargets(), []);
  });
});
