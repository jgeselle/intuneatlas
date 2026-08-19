import { graphGetAll } from "../graph.js";
import { mapSimplePolicy } from "./simplePolicy.js";
import type { RawSimplePolicy } from "./types.js";

interface GraphEnrollmentConfiguration {
  id: string;
  "@odata.type": string;
  displayName?: string;
  priority?: number;
  assignments?: Array<{ target: { "@odata.type": string; groupId?: string } }>;
}

export async function fetchEnrollmentConfigurations(token: string): Promise<RawSimplePolicy[]> {
  const configs = await graphGetAll<GraphEnrollmentConfiguration>(
    token,
    "/deviceManagement/deviceEnrollmentConfigurations?$expand=Assignments",
  );

  return configs.map(mapSimplePolicy);
}
