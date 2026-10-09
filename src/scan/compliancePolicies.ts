import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet, graphGetAll } from "../graph.js";
import { isDeployed, mapAssignmentTargets } from "./assignments.js";
import { complianceActionsSetting, complianceSettingsOf, TENANT_COMPLIANCE_PLATFORM, tenantComplianceSettingsOf } from "./complianceSettings.js";
import { fetchCatalogPolicies } from "./configurationPolicies.js";
import { mapSimplePolicy } from "./simplePolicy.js";
import type { RawPolicy, RawSimplePolicy } from "./types.js";

interface GraphCompliancePolicy {
  id: string;
  "@odata.type"?: string;
  displayName?: string;
  assignments?: Array<{ target: { "@odata.type": string; groupId?: string } }>;
  [property: string]: unknown;
}

export const NO_TEMPLATE = "00000000-0000-0000-0000-000000000000";

/** Optional reads: what a refusal or a missing route looks like. The scan goes on without the detail. */
const unavailable = (...statuses: number[]) => (error: unknown) => {
  if (error instanceof Error && new RegExp(`failed: (${statuses.join("|")})\\b`).test(error.message)) return undefined;
  throw error;
};

type Rules = Array<{ scheduledActionConfigurations?: Array<Record<string, unknown>> }>;
/** The actions for noncompliance of a policy, out of the rules Graph nests them in. */
export const actionConfigurations = (rules: unknown) => (Array.isArray(rules) ? (rules as Rules).flatMap((rule) => rule?.scheduledActionConfigurations ?? []) : []);

export const usesNotificationTemplate = (action: Record<string, unknown>) => Boolean(action.notificationTemplateId) && action.notificationTemplateId !== NO_TEMPLATE;

/** The tenant's notification message templates, id to name — undefined where they can't be read. */
export async function fetchNotificationTemplates(token: string): Promise<Map<string, string> | undefined> {
  const templates = await graphGetAll<{ id: string; displayName?: string }>(token, "/deviceManagement/notificationMessageTemplates?$select=id,displayName", GRAPH_BETA_BASE).catch(
    unavailable(400, 403, 404),
  );
  return templates && new Map(templates.map((template) => [template.id, template.displayName ?? template.id]));
}

/** The tenant's custom compliance scripts, id to name — undefined where they can't be read (it takes a permission of its own). */
export async function fetchComplianceScripts(token: string): Promise<Map<string, string> | undefined> {
  const scripts = await graphGetAll<{ id: string; displayName?: string }>(token, "/deviceManagement/deviceComplianceScripts?$select=id,displayName", GRAPH_BETA_BASE).catch(
    unavailable(400, 403, 404),
  );
  return scripts && new Map(scripts.map((script) => [script.id, script.displayName ?? script.id]));
}

/**
 * Gives each action that uses a notification template that template's
 * name, which is what the value shows in place of the id. A push reads a
 * policy through this too, so it sees an action exactly as a scan does.
 */
export function nameNotificationTemplates(actions: Array<Record<string, unknown>>, names: Map<string, string> | undefined): void {
  for (const action of actions) action.notificationTemplateName = names?.get(String(action.notificationTemplateId));
}

/**
 * Compliance policies, twice over: `policies` is each one's identity and
 * assignment (what the tool has always kept), `settings` the same
 * policies with what each one configures, ready for the setting index.
 * A policy that configures nothing readable is in the first and not the
 * second.
 *
 * Read from beta: several current policy types (Android Enterprise
 * fully managed and AOSP among them) exist only there.
 *
 * There are two kinds, in two places: the typed, one-per-platform
 * policies, and — for Linux — policies in the Settings Catalog format
 * (see complianceCatalog.ts). Both end up in the same two lists, and
 * with them, as the settings of one stand-in policy, the tenant-wide
 * compliance settings.
 *
 * Everything beyond the typed policies themselves is optional: the
 * actions for noncompliance (asked for along with the policies), the
 * Linux collection and its actions, the tenant-wide settings, and the
 * names of the notification templates and compliance scripts policies
 * refer to (script names need DeviceManagementScripts.Read.All, which
 * the tool doesn't otherwise ask for). Where Graph refuses one, the scan
 * goes on without it.
 */
export async function fetchCompliancePolicies(token: string): Promise<{ policies: RawSimplePolicy[]; settings: RawPolicy[] }> {
  const ACTIONS = "scheduledActionsForRule($expand=scheduledActionConfigurations)";
  const list = (expand: string) => graphGetAll<GraphCompliancePolicy>(token, `/deviceManagement/deviceCompliancePolicies?$expand=${expand}`, GRAPH_BETA_BASE);
  const found = await list(`assignments,${ACTIONS}`).catch((error: unknown) => {
    if (error instanceof Error && /failed: 400\b/.test(error.message)) return list("assignments");
    throw error;
  });

  const [catalog, tenantSettings] = await Promise.all([
    fetchCatalogPolicies(token, "compliancePolicies").catch(unavailable(400, 404)),
    graphGet<Record<string, unknown>>(token, "/deviceManagement/settings", GRAPH_BETA_BASE).catch(unavailable(400, 403, 404)),
  ]);
  // A Linux policy's actions have to be asked for policy by policy: confirmed live that expanding them
  // on the collection — or on the policy itself — comes back empty, while the policy's own
  // scheduledActionsForRule route returns them.
  const catalogActions = await Promise.all(
    (catalog ?? []).map(async (policy) => ({
      id: policy.id,
      scheduledActionsForRule: await graphGetAll<unknown>(
        token,
        `/deviceManagement/compliancePolicies/${policy.id}/scheduledActionsForRule?$expand=scheduledActionConfigurations`,
        GRAPH_BETA_BASE,
      ).catch(unavailable(400, 404)),
    })),
  );

  // Names for the tenant's own objects that policies point at by id — looked up only when something points at one.
  const actions = [...found, ...catalogActions].flatMap((policy) => actionConfigurations(policy.scheduledActionsForRule));
  if (actions.some(usesNotificationTemplate)) nameNotificationTemplates(actions, await fetchNotificationTemplates(token));
  const scripts = found.map((policy) => policy.deviceCompliancePolicyScript as { deviceComplianceScriptId?: string; scriptName?: string } | null | undefined).filter((script) => script?.deviceComplianceScriptId);
  if (scripts.length > 0) {
    const names = await fetchComplianceScripts(token);
    for (const script of scripts) script!.scriptName = names?.get(script!.deviceComplianceScriptId!);
  }

  const policies = found.map(mapSimplePolicy);
  const settings = found
    .map((policy, i) => ({
      id: policy.id,
      name: policies[i].name,
      platform: policies[i].platform,
      assignments: mapAssignmentTargets(policy.assignments),
      settings: complianceSettingsOf(policy),
    }))
    .filter((policy) => policy.settings.length > 0);

  const linux = (catalog ?? []).map((policy) => {
    const actionsSetting = complianceActionsSetting(policy.platform, catalogActions.find((p) => p.id === policy.id)?.scheduledActionsForRule);
    return actionsSetting ? { ...policy, settings: [...policy.settings, actionsSetting] } : policy;
  });

  const tenantWide = tenantSettings ? tenantComplianceSettingsOf(tenantSettings) : [];
  return {
    policies: [...policies, ...linux.map((p) => ({ id: p.id, name: p.name, platform: p.platform, deployed: isDeployed(p.assignments), targets: p.assignments }))],
    settings: [
      ...settings,
      ...linux.filter((p) => p.settings.length > 0),
      // Not a policy: it reaches every device, has no platform, and isn't counted among the compliance policies.
      ...(tenantWide.length ? [{ id: TENANT_COMPLIANCE_POLICY_ID, name: "Compliance policy settings", platform: TENANT_COMPLIANCE_PLATFORM, assignments: [{ kind: "allDevices" as const }], settings: tenantWide }] : []),
    ],
  };
}

export const TENANT_COMPLIANCE_POLICY_ID = "tenant-compliance-settings";
