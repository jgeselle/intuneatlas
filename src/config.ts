export const GRAPH_V1_BASE = "https://graph.microsoft.com/v1.0";

// Only for the specific calls that have no v1.0 equivalent yet: setting
// definition resolution (src/scan/settingDefinitions.ts) and Settings
// Catalog configuration policies (src/scan/configurationPolicies.ts) — the
// latter confirmed live against a real tenant to still 404 on v1.0 despite
// docs suggesting otherwise ("Resource not found for the segment
// 'configurationPolicies'").
export const GRAPH_BETA_BASE = "https://graph.microsoft.com/beta";

export const DELEGATED_SCOPES = [
  "https://graph.microsoft.com/DeviceManagementConfiguration.Read.All",
  "https://graph.microsoft.com/DeviceManagementManagedDevices.Read.All",
  "https://graph.microsoft.com/Organization.Read.All",
  // deviceEnrollmentConfigurations reads need this specifically — it's not
  // covered by DeviceManagementConfiguration.Read.All above.
  "https://graph.microsoft.com/DeviceManagementServiceConfig.Read.All",
];

/**
 * What pushing a staged change needs, on top of the above — and nothing
 * else in the tool does. Never asked for at sign-in: a token with it is
 * requested only at the moment an Admin pushes, and only succeeds if the
 * app registration was given the permission. An install that never adds
 * it cannot write to the tenant at all.
 */
export const WRITE_SCOPES = ["https://graph.microsoft.com/DeviceManagementConfiguration.ReadWrite.All"];

// App-only (client-credentials) tokens are scoped by whatever application
// permissions were granted to the app registration, not by requested scopes.
export const APPLICATION_SCOPE = "https://graph.microsoft.com/.default";
