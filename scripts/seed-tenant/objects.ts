// Generic create/assign/delete helpers for the tenant objects scenarios
// are built from (groups, Settings Catalog policies, assignments). Every
// object created here is named with taggedName() so teardown.ts can find
// exactly what this toolkit created and nothing else.
import { GRAPH_BETA_BASE, taggedName, type SeedClient } from "./client.js";

export interface CreatedGroup {
  id: string;
  displayName: string;
}

export async function createTestGroup(client: SeedClient, label: string): Promise<CreatedGroup> {
  const displayName = taggedName(label);
  const nickname = displayName.replace(/[^a-zA-Z0-9]/g, "");
  const created = await client.post<{ id: string }>("/groups", {
    displayName,
    mailEnabled: false,
    mailNickname: nickname,
    securityEnabled: true,
  });
  // In dry-run mode `post` never calls Graph, so there's no real id — a
  // placeholder lets scenario builders keep composing (e.g. passing this
  // into assignPolicy) without every caller special-casing dry-run.
  return { id: created?.id ?? "dry-run-group-id", displayName };
}

export interface CreatedPolicy {
  id: string;
  name: string;
}

interface PolicyOptions {
  name: string;
  description?: string;
  platforms: string;
  technologies?: string;
  settings: unknown[];
}

export async function createConfigurationPolicy(client: SeedClient, options: PolicyOptions): Promise<CreatedPolicy> {
  const name = taggedName(options.name);
  const created = await client.post<{ id: string }>(
    "/deviceManagement/configurationPolicies",
    {
      name,
      description: options.description ?? "",
      platforms: options.platforms,
      technologies: options.technologies ?? "mdm",
      settings: options.settings.map((settingInstance) => ({
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting",
        settingInstance,
      })),
    },
    GRAPH_BETA_BASE,
  );
  return { id: created?.id ?? "dry-run-policy-id", name };
}

export type AssignmentTarget =
  | { kind: "group"; groupId: string }
  | { kind: "allDevices" }
  | { kind: "allLicensedUsers" };

function toGraphTarget(target: AssignmentTarget) {
  return target.kind === "group"
    ? { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: target.groupId }
    : { "@odata.type": `#microsoft.graph.${target.kind}AssignmentTarget` };
}

export async function assignPolicy(client: SeedClient, policyId: string, targets: AssignmentTarget[]): Promise<void> {
  await client.post(
    `/deviceManagement/configurationPolicies/${policyId}/assign`,
    { assignments: targets.map((target) => ({ target: toGraphTarget(target) })) },
    GRAPH_BETA_BASE,
  );
}

export interface CreatedDeviceConfiguration {
  id: string;
  name: string;
}

/**
 * Creates a legacy (pre-Settings-Catalog) deviceConfigurations profile —
 * a stable v1.0 resource, not beta like configurationPolicies. `properties`
 * are the type-specific fields (e.g. cameraBlocked) alongside the
 * @odata.type discriminator.
 */
export async function createDeviceConfiguration(
  client: SeedClient,
  options: { name: string; odataType: string; properties: Record<string, unknown> },
): Promise<CreatedDeviceConfiguration> {
  const name = taggedName(options.name);
  const created = await client.post<{ id: string }>("/deviceManagement/deviceConfigurations", {
    "@odata.type": options.odataType,
    displayName: name,
    ...options.properties,
  });
  return { id: created?.id ?? "dry-run-deviceconfig-id", name };
}

export async function assignDeviceConfiguration(client: SeedClient, configId: string, targets: AssignmentTarget[]): Promise<void> {
  await client.post(`/deviceManagement/deviceConfigurations/${configId}/assign`, {
    assignments: targets.map((target) => ({ target: toGraphTarget(target) })),
  });
}

/** One action for noncompliance: what happens, and how many hours after a device falls out of compliance. */
export interface ComplianceAction {
  actionType: "block" | "retire" | "remoteLock" | "notification" | "pushNotification";
  gracePeriodHours: number;
}

// Graph refuses a compliance policy without its actions (at least "block" — marking the device
// noncompliant), and wants them wrapped in exactly one rule.
function toScheduledActions(actions: ComplianceAction[]) {
  return [
    {
      ruleName: "PasswordRequired",
      scheduledActionConfigurations: actions.map((action) => ({ ...action, notificationTemplateId: "", notificationMessageCCList: [] })),
    },
  ];
}

/**
 * Creates a typed compliance policy (one Graph type per platform, its
 * settings as properties) — what src/scan/complianceSettings.ts reads.
 */
export async function createCompliancePolicy(
  client: SeedClient,
  options: { name: string; odataType: string; properties: Record<string, unknown>; actions: ComplianceAction[] },
): Promise<CreatedPolicy> {
  const name = taggedName(options.name);
  const created = await client.post<{ id: string }>(
    "/deviceManagement/deviceCompliancePolicies",
    { "@odata.type": options.odataType, displayName: name, ...options.properties, scheduledActionsForRule: toScheduledActions(options.actions) },
    GRAPH_BETA_BASE,
  );
  return { id: created?.id ?? "dry-run-compliance-id", name };
}

export async function assignCompliancePolicy(client: SeedClient, policyId: string, targets: AssignmentTarget[]): Promise<void> {
  await client.post(
    `/deviceManagement/deviceCompliancePolicies/${policyId}/assign`,
    { assignments: targets.map((target) => ({ target: toGraphTarget(target) })) },
    GRAPH_BETA_BASE,
  );
}

/**
 * Creates a compliance policy in the Settings Catalog format — the kind
 * Intune uses for Linux, read by src/scan/complianceCatalog.ts. Same
 * shape as a configuration policy, in its own collection.
 */
export async function createCatalogCompliancePolicy(
  client: SeedClient,
  options: PolicyOptions & { actions: ComplianceAction[] },
): Promise<CreatedPolicy> {
  const name = taggedName(options.name);
  const created = await client.post<{ id: string }>(
    "/deviceManagement/compliancePolicies",
    {
      name,
      description: options.description ?? "",
      platforms: options.platforms,
      technologies: options.technologies ?? "linuxMdm",
      settings: options.settings.map((settingInstance) => ({
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting",
        settingInstance,
      })),
      scheduledActionsForRule: toScheduledActions(options.actions),
    },
    GRAPH_BETA_BASE,
  );
  return { id: created?.id ?? "dry-run-catalog-compliance-id", name };
}

export async function assignCatalogCompliancePolicy(client: SeedClient, policyId: string, targets: AssignmentTarget[]): Promise<void> {
  await client.post(
    `/deviceManagement/compliancePolicies/${policyId}/assign`,
    { assignments: targets.map((target) => ({ target: toGraphTarget(target) })) },
    GRAPH_BETA_BASE,
  );
}
