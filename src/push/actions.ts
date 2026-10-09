import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet, graphGetAll } from "../graph.js";
import { COMPLIANCE_TYPES } from "../scan/complianceSchema.generated.js";
import { actionConfigurations, fetchNotificationTemplates, nameNotificationTemplates, NO_TEMPLATE, usesNotificationTemplate } from "../scan/compliancePolicies.js";
import { complianceActionsSetting } from "../scan/complianceSettings.js";
import type { SettingValueNode } from "../scan/types.js";
import { graphWrite } from "./graphWrite.js";
import { PushRefused } from "./values.js";

/**
 * A compliance policy's actions for noncompliance.
 *
 * They aren't a property of the policy: Graph keeps them beside it and
 * takes them through an action of their own, as the whole list. And the
 * value the tool shows isn't everything Graph holds — a notification
 * action points at a message template by id and may copy other people,
 * and the value shows the template by name and nothing of the copies.
 *
 * So the list that is written is put together from both: what the staged
 * value says (which actions, after how long, which template by name) and,
 * for each action that was already there, what the tenant holds for it
 * (the template's id, who is copied). A template named in the value is
 * looked up among the tenant's templates; a name that matches none is
 * refused rather than sent without one.
 */
type ActionConfiguration = Record<string, unknown>;

/** Typed compliance policies have a Graph type per platform; anything else with actions is a Settings Catalog compliance policy (Linux). */
const isTyped = (type: string) => `${type}CompliancePolicy` in COMPLIANCE_TYPES;

/**
 * The two kinds of compliance policy keep their actions in the same shape
 * but hand them out, and take them back, by different routes — each
 * confirmed live, and neither works on the other kind: a typed policy
 * only expands them on the policy itself, a Settings Catalog one only
 * serves them from a route of their own.
 */
const routes = (type: string, policyId: string) =>
  isTyped(type)
    ? {
        read: async (token: string) =>
          (
            await graphGet<{ scheduledActionsForRule?: unknown }>(
              token,
              `/deviceManagement/deviceCompliancePolicies/${policyId}?$select=id&$expand=scheduledActionsForRule($expand=scheduledActionConfigurations)`,
              GRAPH_BETA_BASE,
            )
          ).scheduledActionsForRule,
        write: `/deviceManagement/deviceCompliancePolicies/${policyId}/scheduleActionsForRules`,
        body: (rules: unknown) => ({ deviceComplianceScheduledActionForRules: rules }),
      }
    : {
        read: (token: string): Promise<unknown> =>
          graphGetAll<unknown>(token, `/deviceManagement/compliancePolicies/${policyId}/scheduledActionsForRule?$expand=scheduledActionConfigurations`, GRAPH_BETA_BASE),
        write: `/deviceManagement/compliancePolicies/${policyId}/setScheduledActions`,
        body: (rules: unknown) => ({ scheduledActions: rules }),
      };

/** One staged action (a group of sub-settings), by field name. */
function fieldsOf(group: SettingValueNode[]): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {};
  for (const child of group) {
    const field = child.definitionId.slice(child.definitionId.lastIndexOf(".") + 1);
    if (child.kind === "simple") fields[field] = child.value;
    if (child.kind === "choice") fields[field] = child.optionId.slice(child.definitionId.length + 1);
  }
  return fields;
}

/**
 * The staged actions as Graph takes them. `current` is what the policy has
 * now (empty for a policy being created); `templates` the tenant's
 * notification templates, or undefined where they can't be read.
 */
export function actionsToWrite(node: SettingValueNode, current: ActionConfiguration[], templates: Map<string, string> | undefined): ActionConfiguration[] {
  if (node.kind !== "groupCollection") throw new PushRefused("The staged actions for noncompliance aren't a list of actions.");
  if (!templates && current.some(usesNotificationTemplate)) {
    throw new PushRefused("This policy's actions use a notification template, and the app can't read the tenant's notification templates — pushing would lose which one.");
  }
  const idByName = new Map([...(templates ?? [])].map(([id, name]) => [name, id]));

  return node.groups.map((group) => {
    const { actionType, gracePeriodHours, notificationTemplateName } = fieldsOf(group);
    if (!actionType) throw new PushRefused("Every action for noncompliance needs an action.");
    let notificationTemplateId = NO_TEMPLATE;
    if (notificationTemplateName !== undefined && String(notificationTemplateName).trim() !== "") {
      const id = idByName.get(String(notificationTemplateName));
      if (!id) throw new PushRefused(`There is no notification template named "${String(notificationTemplateName)}" in the tenant.`);
      notificationTemplateId = id;
    }
    // Who else is notified isn't part of the value; it is kept from the action this one replaces, if there is such a one.
    const was = current.find((action) => action.actionType === actionType && (action.notificationTemplateId ?? NO_TEMPLATE) === notificationTemplateId);
    return {
      actionType,
      gracePeriodHours: Number(gracePeriodHours ?? 0),
      notificationTemplateId: notificationTemplateId === NO_TEMPLATE ? "" : notificationTemplateId,
      notificationMessageCCList: Array.isArray(was?.notificationMessageCCList) ? was.notificationMessageCCList : [],
    };
  });
}

/** What the policy has now, and how a scan would show it — for holding against what the change was staged from. */
export async function readActions(token: string, type: string, policyId: string): Promise<{ current: ActionConfiguration[]; value: string | undefined; templates: Map<string, string> | undefined }> {
  const rules = await routes(type, policyId).read(token);
  const current = actionConfigurations(rules);
  const templates = await fetchNotificationTemplates(token);
  nameNotificationTemplates(current, templates);
  return { current, value: complianceActionsSetting(type, rules)?.value, templates };
}

export async function writeActions(token: string, type: string, policyId: string, actions: ActionConfiguration[]): Promise<void> {
  const route = routes(type, policyId);
  await graphWrite(token, "POST", route.write, route.body([{ ruleName: "PasswordRequired", scheduledActionConfigurations: actions }]));
}
