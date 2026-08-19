export const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

/**
 * Registered once as a shared, multi-tenant public client so users can
 * `intuneatlas login` without registering their own Entra app — see the
 * project plan for why a public client ID is safe to ship in open source.
 * --client-id / INTUNEATLAS_CLIENT_ID can still override this.
 */
export const DEFAULT_CLIENT_ID: string | undefined = "d0a404f2-0421-40bc-ad8b-866a5a2115b1";

export const DELEGATED_SCOPES = [
  "https://graph.microsoft.com/DeviceManagementConfiguration.Read.All",
  "https://graph.microsoft.com/DeviceManagementManagedDevices.Read.All",
  "https://graph.microsoft.com/Organization.Read.All",
];

// App-only (client-credentials) tokens are scoped by whatever application
// permissions were granted to the app registration, not by requested scopes.
export const APPLICATION_SCOPE = "https://graph.microsoft.com/.default";
