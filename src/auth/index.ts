import { createClientCredentialsAuth } from "./clientCredentials.js";
import { createInteractiveAuth } from "./interactive.js";
import type { AuthProvider } from "./types.js";

export interface ResolveAuthOptions {
  tenant?: string;
  clientId?: string;
  clientSecret?: string;
  deviceCode?: boolean;
}

export function resolveAuth(options: ResolveAuthOptions): AuthProvider {
  const tenantId = options.tenant ?? process.env.INTUNEATLAS_TENANT_ID;
  if (!tenantId) {
    throw new Error("Missing tenant. Pass --tenant <id-or-domain> or set INTUNEATLAS_TENANT_ID.");
  }

  const clientId = options.clientId ?? process.env.INTUNEATLAS_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "Missing client ID. Register your own Entra app (see intuneatlas.com/docs) and pass " +
        "--client-id <id>, or set INTUNEATLAS_CLIENT_ID.",
    );
  }

  const clientSecret = options.clientSecret ?? process.env.INTUNEATLAS_CLIENT_SECRET;
  if (clientSecret) {
    return createClientCredentialsAuth({ tenantId, clientId, clientSecret });
  }

  return createInteractiveAuth({ tenantId, clientId, deviceCode: Boolean(options.deviceCode) });
}
