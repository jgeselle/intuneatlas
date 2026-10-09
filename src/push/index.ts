import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet, graphGetAll } from "../graph.js";
import { graphDefinitionId, inComplianceCatalog } from "../scan/complianceCatalog.js";
import { complianceSettingsOf, isComplianceDefinition, tenantComplianceSettingsOf } from "../scan/complianceSettings.js";
import { resolveSettingInstances } from "../scan/configurationPolicies.js";
import { definitionPath } from "../scan/settingDefinitions.js";
import type { GraphSettingInstance } from "../scan/settingValue.js";
import type { SettingSchema, SettingValueNode } from "../scan/types.js";
import { fetchComplianceScripts, fetchNotificationTemplates } from "../scan/compliancePolicies.js";
import { COMPLIANCE_ENUMS, COMPLIANCE_TYPES } from "../scan/complianceSchema.generated.js";
import { actionsToWrite, readActions, writeActions } from "./actions.js";
import { graphWrite } from "./graphWrite.js";
import { pushLegacySetting } from "./legacy.js";
import { scriptToWrite } from "./script.js";
import { fetchTemplateSlots, slotsOfInstance, withTemplateReferences, type TemplateSlot } from "./templates.js";
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
 * A policy created from a template (endpoint security, a security
 * baseline) is written the same way, with the changed setting's template
 * references put back — see templates.ts.
 *
 * A compliance policy's actions for noncompliance are written as the
 * whole list, through their own route — see actions.ts.
 *
 * A legacy device configuration profile is written where the tool reads
 * it at all — a few Device Restrictions switches; see legacy.ts.
 *
 * A compliance policy's custom compliance — its script and rules — is
 * written over the rules file the tenant holds; see script.ts.
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
  /**
   * Take the setting out of the policy instead of changing it — back to
   * "Not configured". `node` then only names the setting. In a Settings
   * Catalog policy the setting is left out of what is sent back; a typed
   * compliance policy's property is returned to its unset value.
   */
  remove?: boolean;
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

const ACTIONS = "scheduledActionsForRule";

const SCRIPT = "deviceCompliancePolicyScript";

/** What a policy being created can't be given from here. */
const NOT_IN_A_NEW_POLICY: Record<string, string> = {
  [SCRIPT]: "Custom compliance can't be set up in a new policy from here: its rules file, with the messages shown to users, is uploaded in Intune.",
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
  if (target === "tenant") {
    if (change.remove) throw new PushRefused("A tenant-wide compliance setting can't be removed, only changed.");
    return pushTenantSetting(token, change);
  }
  // Actions for noncompliance sit beside a compliance policy of either kind, and are written by a route of their own.
  if (target === "compliance" && typedProperty(change.definitionId)[1] === ACTIONS) {
    if (change.remove) throw new PushRefused("A compliance policy always has actions for noncompliance; they can be changed, not removed.");
    return pushActions(token, change);
  }
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
  const policy = await graphGet<GraphCatalogPolicy>(token, path, GRAPH_BETA_BASE).catch(async (error: unknown) => {
    if (!(error instanceof Error && /failed: (400|404)\b/.test(error.message))) throw error;
    // Not a Settings Catalog policy by that id: a legacy profile sets the same settings under its own.
    if (collection === "configurationPolicies" && !change.remove && (await pushLegacySetting(token, change))) return undefined;
    throw new PushRefused("This policy no longer exists.");
  });
  if (!policy) return;
  const settings = await graphGetAll<{ settingInstance: GraphSettingInstance }>(token, `${path}/settings`, GRAPH_BETA_BASE);
  const resolved = await resolveSettingInstances(token, collection, settings);
  const index = resolved.findIndex((setting) => setting.settingDefinitionId === change.definitionId);
  refuseIfDrifted(change.node.name, resolved[index]?.value, change.from);

  // A policy created from a template (endpoint security, a security baseline): the rebuilt setting has
  // to name its slots in that template again, or Intune would no longer know where it belongs.
  const templateId = policy.templateReference?.templateId ?? "";
  if (change.remove && settings.length === 1) {
    throw new PushRefused(`"${change.node.name}" is the only setting in "${policy.name}", and a policy can't be left empty. Delete the policy in Intune instead.`);
  }
  let replacement = change.remove ? {} : instanceFromNode(change.node, change.schemas);
  if (templateId && !change.remove) {
    const fromTemplate = await fetchTemplateSlots(token, templateId).catch(() => new Map<string, TemplateSlot>());
    // The template first — it knows slots this policy hasn't used yet; what the old instance names covers a template that can no longer be read.
    replacement = withTemplateReferences(replacement, new Map([...slotsOfInstance(settings[index].settingInstance), ...fromTemplate]));
  }

  await graphWrite(token, "PUT", path, {
    name: policy.name,
    description: policy.description ?? "",
    platforms: policy.platforms,
    technologies: policy.technologies,
    roleScopeTagIds: policy.roleScopeTagIds ?? ["0"],
    templateReference: { templateId },
    // Every setting goes back exactly as it came, but the one being changed — or, for a removal, without it.
    settings: settings
      .map((setting, i) => ({
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting",
        settingInstance: i === index ? replacement : setting.settingInstance,
      }))
      .filter((_, i) => !(change.remove && i === index)),
  });
}

async function pushComplianceProperty(token: string, change: ExistingPolicyPush): Promise<void> {
  const [, property] = typedProperty(change.definitionId);

  const path = `/deviceManagement/deviceCompliancePolicies/${change.policyId}`;
  const policy = await graphGet<Record<string, unknown>>(token, path, GRAPH_BETA_BASE).catch(notFound("This compliance policy no longer exists."));
  // A custom script shows by name where the tenant's scripts can be read — the policy is read here as a scan reads it.
  const stored = policy[SCRIPT] as { deviceComplianceScriptId?: string; scriptName?: string } | null | undefined;
  const scripts = property === SCRIPT && stored?.deviceComplianceScriptId ? await fetchComplianceScripts(token) : undefined;
  if (stored && scripts) stored.scriptName = scripts.get(stored.deviceComplianceScriptId ?? "");
  const current = complianceSettingsOf(policy).find((setting) => setting.settingDefinitionId === change.definitionId);
  refuseIfDrifted(change.node.name, current?.value, change.from);

  if (property === SCRIPT && !change.remove) {
    await graphWrite(token, "PATCH", path, { "@odata.type": policy["@odata.type"], [SCRIPT]: scriptToWrite(change.node, stored ?? {}, scripts) });
    return;
  }

  // Graph needs the type to know which kind of policy the property belongs to; nothing else is sent, so nothing else changes.
  // A removal returns the property to what an unset one holds.
  const value = change.remove ? unsetComplianceValue(change.definitionId) : complianceValueFromNode(change.node);
  await graphWrite(token, "PATCH", path, { "@odata.type": policy["@odata.type"], [property]: value });
}

/** What Graph holds in a typed compliance policy's property that isn't configured: false for a switch, an enum's first member, an empty list, otherwise null. */
function unsetComplianceValue(definitionId: string): unknown {
  const [type, property] = typedProperty(definitionId);
  const kind = COMPLIANCE_TYPES[`${type}CompliancePolicy`]?.[property];
  if (kind === "boolean") return false;
  if (typeof kind === "object" && "enum" in kind) return COMPLIANCE_ENUMS[kind.enum]?.[0] ?? null;
  if (typeof kind === "object" && "object" in kind && kind.list) return [];
  return null;
}

async function pushActions(token: string, change: ExistingPolicyPush): Promise<void> {
  const [type] = typedProperty(change.definitionId);
  const { current, value, templates } = await readActions(token, type, change.policyId).catch(notFound("This compliance policy no longer exists."));
  refuseIfDrifted(change.node.name, value, change.from);
  await writeActions(token, type, change.policyId, actionsToWrite(change.node, current, templates));
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
    let actions: unknown = blockAtOnce;
    for (const setting of policy.settings) {
      const [, property] = typedProperty(setting.definitionId);
      if (NOT_IN_A_NEW_POLICY[property]) throw new PushRefused(NOT_IN_A_NEW_POLICY[property]);
      // Staged actions for noncompliance take the place of the default one.
      if (property === ACTIONS) actions = [{ ruleName: "PasswordRequired", scheduledActionConfigurations: actionsToWrite(setting.node, [], await fetchNotificationTemplates(token)) }];
      else properties[property] = complianceValueFromNode(setting.node);
    }
    const created = await graphWrite<{ id: string }>(token, "POST", "/deviceManagement/deviceCompliancePolicies", {
      "@odata.type": `#microsoft.graph.${[...types][0]}CompliancePolicy`,
      displayName: policy.name,
      ...properties,
      scheduledActionsForRule: actions,
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
