import { graphGetAll } from "../graph.js";
import { mapSimplePolicy } from "./simplePolicy.js";
import type { RawSimplePolicy } from "./types.js";

interface GraphCompliancePolicy {
  id: string;
  "@odata.type"?: string;
  displayName?: string;
  assignments?: Array<{ target: { "@odata.type": string; groupId?: string } }>;
}

export async function fetchCompliancePolicies(token: string): Promise<RawSimplePolicy[]> {
  const policies = await graphGetAll<GraphCompliancePolicy>(
    token,
    "/deviceManagement/deviceCompliancePolicies?$expand=Assignments",
  );

  return policies.map(mapSimplePolicy);
}
