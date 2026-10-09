import { GRAPH_BETA_BASE } from "../config.js";
import { graphGetAll } from "../graph.js";

/**
 * Template references, for policies created from a template — the
 * endpoint security policies (Antivirus, Firewall, Disk encryption, ...)
 * and security baselines.
 *
 * Such a policy is a Settings Catalog policy whose every setting says
 * which slot of the template it fills: the instance carries a
 * `settingInstanceTemplateReference`, its value a
 * `settingValueTemplateReference` (confirmed on a live tenant's Defender
 * Antivirus policy). A value rebuilt from what the tool holds has
 * neither, so before it is written they are put back — taken from the
 * template itself, which lists every slot including ones the policy
 * hasn't used yet (a sub-setting being added, say), and failing that
 * from the instance being replaced.
 */
export interface TemplateSlot {
  instanceTemplateId: string;
  /** Not every kind of value has one — the items of a simple list don't. */
  valueTemplateId?: string;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every slot of a template, by setting definition id — nested ones (a group's sub-settings) included. */
export async function fetchTemplateSlots(token: string, templateId: string): Promise<Map<string, TemplateSlot>> {
  const templates = await graphGetAll<Json>(token, `/deviceManagement/configurationPolicyTemplates/${templateId}/settingTemplates`, GRAPH_BETA_BASE);
  const slots = new Map<string, TemplateSlot>();
  collectSlots(templates, slots);
  return slots;
}

/**
 * Walks whatever shape the template has. A slot is any object naming both
 * a definition and an instance template; its value template is in the one
 * property named after its kind ("choiceSettingValueTemplate",
 * "groupSettingCollectionValueTemplate" — an object, or a list of one).
 */
export function collectSlots(node: unknown, slots: Map<string, TemplateSlot>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSlots(item, slots);
    return;
  }
  if (!isObject(node)) return;
  if (typeof node.settingDefinitionId === "string" && typeof node.settingInstanceTemplateId === "string") {
    const valueTemplate = Object.entries(node).find(([key]) => key.endsWith("ValueTemplate"))?.[1];
    const first = Array.isArray(valueTemplate) ? valueTemplate[0] : valueTemplate;
    const valueTemplateId = isObject(first) && typeof first.settingValueTemplateId === "string" ? first.settingValueTemplateId : undefined;
    slots.set(node.settingDefinitionId, { instanceTemplateId: node.settingInstanceTemplateId, ...(valueTemplateId ? { valueTemplateId } : {}) });
  }
  for (const value of Object.values(node)) collectSlots(value, slots);
}

/** The slots a stored instance already names — what there is to go on when the template itself can't be read. */
export function slotsOfInstance(instance: unknown, slots = new Map<string, TemplateSlot>()): Map<string, TemplateSlot> {
  if (Array.isArray(instance)) {
    for (const item of instance) slotsOfInstance(item, slots);
    return slots;
  }
  if (!isObject(instance)) return slots;
  const reference = instance.settingInstanceTemplateReference;
  if (typeof instance.settingDefinitionId === "string" && isObject(reference) && typeof reference.settingInstanceTemplateId === "string") {
    const value = Object.entries(instance).find(([key]) => /SettingValue$|SettingCollectionValue$/.test(key))?.[1];
    const first = Array.isArray(value) ? value[0] : value;
    const valueReference = isObject(first) ? first.settingValueTemplateReference : undefined;
    slots.set(instance.settingDefinitionId, {
      instanceTemplateId: reference.settingInstanceTemplateId,
      ...(isObject(valueReference) && typeof valueReference.settingValueTemplateId === "string" ? { valueTemplateId: valueReference.settingValueTemplateId } : {}),
    });
  }
  for (const value of Object.values(instance)) slotsOfInstance(value, slots);
  return slots;
}

/**
 * A rebuilt setting instance with its template references filled in, at
 * every level. A single value, and each instance of a group, gets its
 * value reference; the items of a simple or choice list don't have one.
 */
export function withTemplateReferences(instance: Json, slots: Map<string, TemplateSlot>): Json {
  const slot = typeof instance.settingDefinitionId === "string" ? slots.get(instance.settingDefinitionId) : undefined;
  const valueReference = slot?.valueTemplateId ? { settingValueTemplateReference: { settingValueTemplateId: slot.valueTemplateId } } : {};
  const children = (value: Json) => (Array.isArray(value.children) ? { children: value.children.map((child) => withTemplateReferences(child as Json, slots)) } : {});
  const result: Json = { ...instance, ...(slot ? { settingInstanceTemplateReference: { settingInstanceTemplateId: slot.instanceTemplateId } } : {}) };

  if (isObject(instance.simpleSettingValue)) result.simpleSettingValue = { ...instance.simpleSettingValue, ...valueReference };
  if (isObject(instance.choiceSettingValue)) result.choiceSettingValue = { ...instance.choiceSettingValue, ...children(instance.choiceSettingValue), ...valueReference };
  if (isObject(instance.groupSettingValue)) result.groupSettingValue = { ...instance.groupSettingValue, ...children(instance.groupSettingValue), ...valueReference };
  if (Array.isArray(instance.groupSettingCollectionValue)) {
    result.groupSettingCollectionValue = instance.groupSettingCollectionValue.map((group) => ({ ...(group as Json), ...children(group as Json), ...valueReference }));
  }
  return result;
}
