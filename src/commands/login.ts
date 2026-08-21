import { resolveAuth, type ResolveAuthOptions } from "../auth/index.js";
import { graphGet } from "../graph.js";

interface OrganizationResponse {
  value: Array<{ id: string; displayName: string }>;
}

export async function runLogin(options: ResolveAuthOptions): Promise<void> {
  const auth = await resolveAuth(options);
  const token = await auth.getToken();

  const org = await graphGet<OrganizationResponse>(token, "/organization");
  const tenant = org.value[0];

  if (!tenant) {
    throw new Error("Signed in, but /organization returned no tenant details.");
  }

  console.log(`Signed in to ${tenant.displayName} (${tenant.id}) via ${auth.flow}.`);
}
