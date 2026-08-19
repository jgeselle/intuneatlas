import type { AssignmentTarget } from "./types.js";

interface GraphAssignmentTarget {
  "@odata.type": string;
  groupId?: string;
}

interface GraphAssignment {
  target: GraphAssignmentTarget;
}

export function mapAssignmentTargets(assignments: GraphAssignment[] = []): AssignmentTarget[] {
  return assignments.map(({ target }) => {
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
