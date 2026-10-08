import { graphDefinitionId } from "../scan/complianceCatalog.js";
import type { SettingSchema, SettingValueNode } from "../scan/types.js";

/** Why a push didn't happen — a reason for the person pushing, not a fault. Nothing was written. */
export class PushRefused extends Error {}

const TYPE = "#microsoft.graph.deviceManagementConfiguration";

/**
 * A value as the tool holds it, turned back into the setting instance
 * Graph stores — the reverse of what a scan does (buildNode in
 * src/scan/configurationPolicies.ts). Definition ids go out as Graph
 * knows them (a compliance catalog setting's without its marker); option
 * ids were never changed and go out as they are.
 *
 * A number is sent as an integer value when the definition says integer
 * (or says nothing and the value is a number), otherwise as a string.
 */
export function instanceFromNode(node: SettingValueNode, schemas: Record<string, SettingSchema> = {}): Record<string, unknown> {
  const settingDefinitionId = graphDefinitionId(node.definitionId);
  const each = (children: SettingValueNode[]) => children.map((child) => instanceFromNode(child, schemas));
  const simpleValue = (value: string | number | boolean) => {
    const integer = schemas[node.definitionId]?.valueType === "integer" || (schemas[node.definitionId]?.valueType === undefined && typeof value === "number");
    if (integer && !Number.isInteger(Number(value))) throw new PushRefused(`"${node.name}" takes a whole number; "${String(value)}" isn't one.`);
    return integer ? { "@odata.type": `${TYPE}IntegerSettingValue`, value: Number(value) } : { "@odata.type": `${TYPE}StringSettingValue`, value: String(value) };
  };
  const choiceValue = (optionId: string, children: SettingValueNode[] = []) => ({ "@odata.type": `${TYPE}ChoiceSettingValue`, value: optionId, children: each(children) });

  switch (node.kind) {
    case "simple":
      return { "@odata.type": `${TYPE}SimpleSettingInstance`, settingDefinitionId, simpleSettingValue: simpleValue(node.value) };
    case "choice":
      return { "@odata.type": `${TYPE}ChoiceSettingInstance`, settingDefinitionId, choiceSettingValue: choiceValue(node.optionId, node.children) };
    case "simpleCollection":
      return { "@odata.type": `${TYPE}SimpleSettingCollectionInstance`, settingDefinitionId, simpleSettingCollectionValue: node.items.map(simpleValue) };
    case "choiceCollection":
      return { "@odata.type": `${TYPE}ChoiceSettingCollectionInstance`, settingDefinitionId, choiceSettingCollectionValue: node.items.map((item) => choiceValue(item.optionId)) };
    case "group":
      return { "@odata.type": `${TYPE}GroupSettingInstance`, settingDefinitionId, groupSettingValue: { children: each(node.children) } };
    case "groupCollection":
      return { "@odata.type": `${TYPE}GroupSettingCollectionInstance`, settingDefinitionId, groupSettingCollectionValue: node.groups.map((group) => ({ children: each(group) })) };
    default:
      throw new PushRefused(`"${node.name}" is a kind of setting this tool can't write.`);
  }
}

/**
 * A typed compliance policy's value, as the property it is in Graph:
 * a switch back to true/false, an enum to its member, a number or text as
 * it is, a list of groups to a list of objects (each sub-setting a field).
 *
 * The property and field names are the last part of the definition id —
 * that is how the ids were made (see complianceSettings.ts).
 */
export function complianceValueFromNode(node: SettingValueNode): unknown {
  const lastPart = (definitionId: string) => definitionId.slice(definitionId.lastIndexOf(".") + 1);
  const scalar = (child: SettingValueNode): unknown => {
    if (child.kind === "simple") return child.value;
    if (child.kind === "choice") {
      const member = child.optionId.slice(child.definitionId.length + 1);
      return member === "true" ? true : member === "false" ? false : member;
    }
    throw new PushRefused(`"${child.name}" is a kind of compliance setting this tool can't write.`);
  };
  if (node.kind === "groupCollection") return node.groups.map((group) => Object.fromEntries(group.map((child) => [lastPart(child.definitionId), scalar(child)])));
  return scalar(node);
}
