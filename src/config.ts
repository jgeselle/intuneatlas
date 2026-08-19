export const GRAPH_V1_BASE = "https://graph.microsoft.com/v1.0";

// Only for the specific calls that have no v1.0 equivalent yet — see
// src/scan/settingDefinitions.ts for the one place this is used and why.
export const GRAPH_BETA_BASE = "https://graph.microsoft.com/beta";

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
