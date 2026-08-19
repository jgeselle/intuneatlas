import type { AssignmentTarget } from "./types.js";

interface GraphAssignmentTarget {
  "@odata.type": string;
  groupId?: string;
}

interface GraphAssignment {
  target: GraphAssignmentTarget;
}

/** RBAC scope tags, not a deployment target — filtered out, not mapped. */
const SCOPE_TAG_TARGET = "#microsoft.graph.scopeTagGroupAssignmentTarget";

export function mapAssignmentTargets(assignments: GraphAssignment[] = []): AssignmentTarget[] {
  return assignments
    .filter(({ target }) => target["@odata.type"] !== SCOPE_TAG_TARGET)
    .map(({ target }) => {
      switch (target["@odata.type"]) {
        case "#microsoft.graph.allDevicesAssignmentTarget":
          return { kind: "allDevices" };
        case "#microsoft.graph.allLicensedUsersAssignmentTarget":
          return { kind: "allLicensedUsers" };
        case "#microsoft.graph.exclusionGroupAssignmentTarget":
          return { kind: "group", groupId: target.groupId ?? "", excluded: true };
        case "#microsoft.graph.groupAssignmentTarget":
        default:
          return { kind: "group", groupId: target.groupId ?? "", excluded: false };
      }
    });
}

/** A set of assignments counts as deployed if it targets anything beyond pure exclusions. */
export function isDeployed(assignments: AssignmentTarget[]): boolean {
  return assignments.some((a) => a.kind !== "group" || !a.excluded);
}
