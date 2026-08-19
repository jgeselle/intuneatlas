import { isDeployed, mapAssignmentTargets } from "./assignments.js";
import type { RawSimplePolicy } from "./types.js";

interface GraphSimplePolicy {
  id: string;
  "@odata.type": string;
  displayName?: string;
  name?: string;
  priority?: number;
  assignments?: Array<{ target: { "@odata.type": string; groupId?: string } }>;
}

/**
 * Compliance policies and enrollment configurations are flat, typed-per-kind
 * resources — the @odata.type string itself is the closest thing to a
 * platform/kind label. Strips the common wrapper so
 * "#microsoft.graph.windows10CompliancePolicy" -> "windows10", and
 * "#microsoft.graph.deviceEnrollmentPlatformRestrictionsConfiguration" ->
 * "deviceEnrollmentPlatformRestrictions". For enrollment configs this is a
 * config *kind*, not a device platform — expected, not a bug.
 */
export function platformFromODataType(odataType: string): string {
  return odataType
    .replace(/^#microsoft\.graph\./, "")
    .replace(/CompliancePolicy$/, "")
    .replace(/Configuration$/, "");
}

export function mapSimplePolicy(item: GraphSimplePolicy): RawSimplePolicy {
  const assignments = mapAssignmentTargets(item.assignments);
  return {
    id: item.id,
    name: item.displayName ?? item.name ?? item.id,
    platform: platformFromODataType(item["@odata.type"]),
    deployed: isDeployed(assignments),
    ...(item.priority !== undefined ? { priority: item.priority } : {}),
  };
}
