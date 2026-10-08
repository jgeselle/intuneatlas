import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet, graphGetAll } from "../graph.js";
import { graphDefinitionId, inComplianceCatalog } from "../scan/complianceCatalog.js";
import { complianceSettingsOf, isComplianceDefinition, tenantComplianceSettingsOf } from "../scan/complianceSettings.js";
import { resolveSettingInstances } from "../scan/configurationPolicies.js";
import { definitionPath } from "../scan/settingDefinitions.js";
import type { GraphSettingInstance } from "../scan/settingValue.js";
import type { SettingSchema, SettingValueNode } from "../scan/types.js";
import { graphWrite } from "./graphWrite.js";
import { complianceValueFromNode, instanceFromNode, PushRefused } from "./values.js";

export { PushRefused } from "./values.js";

/**
 * Writing a staged change to the tenant.
 *
 * Two operations, and nothing else in the tool writes to Intune:
 *
 * - pushToExistingPolicy: one setting's value, in the policy that holds it.
 * - pushNewPolicy: a new policy made of the settings staged for it —
 *   created unassigned, so it reaches no device until someone assigns it.
 *
 * Four kinds of thing can be written, told apart by the setting's
 * definition id, each the way Graph takes it (all confirmed against a
 * live tenant):
 *
 * - a Settings Catalog configuration policy, and a Linux compliance
 *   policy (the same format): Graph has no "change one setting" — the
 *   policy is sent back whole, every other setting exactly as it was read
 *   a moment before, with the one instance replaced;
 * - a typed compliance policy: a PATCH of the one property;
 * - the tenant-wide compliance settings: a PATCH of the one field.
 *
 * Before anything is written the current value is read from the tenant
 * and held against the value the change was staged from. If they differ,
 * someone changed it in the meantime and the push is refused: the person
 * who reviewed the change reviewed a different one.
 *
 * Refused outright, for now: policies created from a template (endpoint
 * security and friends — their settings carry template references this
 * doesn't reproduce), a compliance policy's actions for noncompliance
 * (the notification templates they point to aren't part of the value
 * here, and would be lost) and its custom script.
 */
export interface PushItem {
  definitionId: string;
  /** The value to write, as the tool holds values. */
  node: SettingValueNode;
  schemas?: Record<string, SettingSchema>;
}

export interface ExistingPolicyPush extends PushItem {
  policyId: string;
  /** The policy's value when the change was staged — what its reviewer saw as "before". */
  from: string;
}

type Target = "configuration" | "complianceCatalog" | "compliance" | "tenant";
type Collection = "configurationPolicies" | "compliancePolicies";

const TENANT_PREFIX = "compliance.tenant.";

function targetOf(definitionId: string): Target {
  if (definitionId.startsWith(TENANT_PREFIX)) return "tenant";
  if (inComplianceCatalog(definitionId)) return "complianceCatalog";
  if (isComplianceDefinition(definitionId)) return "compliance";
  return "configuration";
}

/** "compliance.windows10.passwordMinimumLength" -> ["windows10", "passwordMinimumLength"]. */
function typedProperty(definitionId: string): [type: string, property: string] {
  const [, type, ...rest] = definitionId.split(".");
  return [type, rest.join(".")];
}

const NOT_WRITABLE: Record<string, string> = {
  scheduledActionsForRule: "Actions for noncompliance can't be pushed yet: the notification templates they use aren't part of the value here and would be lost.",
  deviceCompliancePolicyScript: "A custom compliance script can't be pushed: its rules are a file uploaded in Intune.",
};

function refuseIfDrifted(name: string, current: string | undefined, from: string): void {
  if (current === undefined) throw new PushRefused(`The policy no longer sets "${name}". Sync, then stage the change again.`);
  if (current !== from) {
    throw new PushRefused(`"${name}" is no longer what it was when this change was staged (it was "${from}", it is now "${current}"). Sync, then stage the change again.`);
  }
}

const notFound = (what: string) => (error: unknown) => {
  if (error instanceof Error && /failed: (400|404)\b/.test(error.message)) throw new PushRefused(what);
  throw error;
};

export async function pushToExistingPolicy(token: string, change: ExistingPolicyPush): Promise<void> {
  const target = targetOf(change.definitionId);
  if (target === "tenant") return pushTenantSetting(token, change);
  if (target === "compliance") return pushComplianceProperty(token, change);
  return pushCatalogSetting(token, target === "complianceCatalog" ? "compliancePolicies" : "configurationPolicies", change);
}

interface GraphCatalogPolicy {
  name: string;
  description?: string | null;
  platforms: string;
  technologies: string;
  roleScopeTagIds?: string[];
  templateReference?: { templateId?: string | null } | null;
}

async function pushCatalogSetting(token: string, collection: Collection, change: ExistingPolicyPush): Promise<void> {
  const path = `/deviceManagement/${collection}/${change.policyId}`;
  const policy = await graphGet<GraphCatalogPolicy>(token, path, GRAPH_BETA_BASE).catch(
    notFound("This policy isn't a Settings Catalog policy, or no longer exists. Only Settings Catalog and compliance policies can be pushed to."),
  );
  if (policy.templateReference?.templateId) {
    throw new PushRefused(`"${policy.name}" was created from a template. Pushing to template-based policies isn't supported yet.`);
  }

  const settings = await graphGetAll<{ settingInstance: GraphSettingInstance }>(token, `${path}/settings`, GRAPH_BETA_BASE);
  const resolved = await resolveSettingInstances(token, collection, settings);
  const index = resolved.findIndex((setting) => setting.settingDefinitionId === change.definitionId);
  refuseIfDrifted(change.node.name, resolved[index]?.value, change.from);

  await graphWrite(token, "PUT", path, {
    name: policy.name,
    description: policy.description ?? "",
    platforms: policy.platforms,
    technologies: policy.technologies,
    roleScopeTagIds: policy.roleScopeTagIds ?? ["0"],
    templateReference: { templateId: "" },
    // Every setting goes back exactly as it came, but the one being changed.
    settings: settings.map((setting, i) => ({
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting",
      settingInstance: i === index ? instanceFromNode(change.node, change.schemas) : setting.settingInstance,
    })),
  });
}

async function pushComplianceProperty(token: string, change: ExistingPolicyPush): Promise<void> {
  const [, property] = typedProperty(change.definitionId);
  if (NOT_WRITABLE[property]) throw new PushRefused(NOT_WRITABLE[property]);

  const path = `/deviceManagement/deviceCompliancePolicies/${change.policyId}`;
  const policy = await graphGet<Record<string, unknown>>(token, path, GRAPH_BETA_BASE).catch(notFound("This compliance policy no longer exists."));
  const current = complianceSettingsOf(policy).find((setting) => setting.settingDefinitionId === change.definitionId);
  refuseIfDrifted(change.node.name, current?.value, change.from);

  // Graph needs the type to know which kind of policy the property belongs to; nothing else is sent, so nothing else changes.
  await graphWrite(token, "PATCH", path, { "@odata.type": policy["@odata.type"], [property]: complianceValueFromNode(change.node) });
}

async function pushTenantSetting(token: string, change: ExistingPolicyPush): Promise<void> {
  const property = change.definitionId.slice(TENANT_PREFIX.length);
  const settings = await graphGet<Record<string, unknown>>(token, "/deviceManagement/settings", GRAPH_BETA_BASE);
  const current = tenantComplianceSettingsOf(settings).find((setting) => setting.settingDefinitionId === change.definitionId);
  refuseIfDrifted(change.node.name, current?.value, change.from);

  // Only the one field: sending the whole object back is rejected while the validity period is unset (0).
  await graphWrite(token, "PATCH", "/deviceManagement", { settings: { [property]: complianceValueFromNode(change.node) } });
}

/**
 * Creates a policy holding the given settings and returns its id. The
 * policy is not assigned to anyone. All settings must be of one kind and,
 * for typed compliance policies, one platform — a policy is one thing in
 * Intune.
 */
export async function pushNewPolicy(token: string, policy: { name: string; platform: string; settings: PushItem[] }): Promise<{ policyId: string }> {
  if (policy.settings.length === 0) throw new PushRefused("There is nothing staged for this policy.");
  const targets = new Set(policy.settings.map((setting) => targetOf(setting.definitionId)));
  if (targets.size > 1) throw new PushRefused(`"${policy.name}" mixes configuration and compliance settings. A policy in Intune is one or the other — stage them under different names.`);
  const [target] = targets;
  if (target === "tenant") throw new PushRefused("The tenant-wide compliance settings don't live in a policy.");

  // Every compliance policy must say what happens to a device that fails it; marking it noncompliant at once is Intune's own default.
  const blockAtOnce = [{ ruleName: "PasswordRequired", scheduledActionConfigurations: [{ actionType: "block", gracePeriodHours: 0, notificationTemplateId: "", notificationMessageCCList: [] }] }];

  if (target === "compliance") {
    const types = new Set(policy.settings.map((setting) => typedProperty(setting.definitionId)[0]));
    if (types.size > 1) throw new PushRefused(`"${policy.name}" has compliance settings for more than one platform (${[...types].join(", ")}). A compliance policy is for one.`);
    const properties: Record<string, unknown> = {};
    for (const setting of policy.settings) {
      const [, property] = typedProperty(setting.definitionId);
      if (NOT_WRITABLE[property]) throw new PushRefused(NOT_WRITABLE[property]);
      properties[property] = complianceValueFromNode(setting.node);
    }
    const created = await graphWrite<{ id: string }>(token, "POST", "/deviceManagement/deviceCompliancePolicies", {
      "@odata.type": `#microsoft.graph.${[...types][0]}CompliancePolicy`,
      displayName: policy.name,
      ...properties,
      scheduledActionsForRule: blockAtOnce,
    });
    return { policyId: created!.id };
  }

  // Settings Catalog format. Which platform and technology a policy is for comes from its settings' own
  // definitions — the first one's stands for the policy.
  const catalog = target === "complianceCatalog" ? "complianceSettings" : "configurationSettings";
  const definition = await graphGet<{ applicability?: { platform?: string; technologies?: string } }>(
    token,
    definitionPath(graphDefinitionId(policy.settings[0].definitionId), catalog),
    GRAPH_BETA_BASE,
  );
  const created = await graphWrite<{ id: string }>(token, "POST", `/deviceManagement/${target === "complianceCatalog" ? "compliancePolicies" : "configurationPolicies"}`, {
    name: policy.name,
    description: "",
    platforms: definition.applicability?.platform ?? policy.platform,
    technologies: definition.applicability?.technologies ?? "mdm",
    settings: policy.settings.map((setting) => ({
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting",
      settingInstance: instanceFromNode(setting.node, setting.schemas),
    })),
    ...(target === "complianceCatalog" ? { scheduledActionsForRule: blockAtOnce } : {}),
  });
  return { policyId: created!.id };
}
