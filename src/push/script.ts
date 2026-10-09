import type { SettingValueNode } from "../scan/types.js";
import { PushRefused } from "./values.js";

/**
 * A compliance policy's custom compliance: which discovery script it
 * runs, and the rules its results are held against.
 *
 * Graph keeps this as one property — the script's id, and the rules as an
 * encoded JSON document, the file an admin uploaded. The value the tool
 * shows is less than that document: per rule the setting, the operator,
 * the type and the value to compare with, but not the link and the
 * messages a user is shown when the device fails it.
 *
 * So what is written is the tenant's own document with the staged value
 * laid over it: a rule that is still there keeps everything about it and
 * takes the staged operator, type and operand; a rule no longer in the
 * value is dropped. A rule that isn't in the tenant's document can't be
 * added from here — the tool has no messages to give it — and is refused.
 * The script is chosen by name among the tenant's scripts.
 */
interface StoredScript {
  deviceComplianceScriptId?: string | null;
  rulesContent?: string | null;
}

/** A group's sub-settings by field name (the last part of each definition id). */
function fieldsOf(children: SettingValueNode[]): Record<string, SettingValueNode> {
  return Object.fromEntries(children.map((child) => [child.definitionId.slice(child.definitionId.lastIndexOf(".") + 1), child]));
}
const text = (node: SettingValueNode | undefined) => (node?.kind === "simple" ? String(node.value) : undefined);

export function scriptToWrite(node: SettingValueNode, stored: StoredScript, scripts: Map<string, string> | undefined): { deviceComplianceScriptId: string; rulesContent: string } {
  if (node.kind !== "group") throw new PushRefused("The staged custom compliance isn't a script with rules.");
  const fields = fieldsOf(node.children);

  // The script: the one the policy has, unless the value names another.
  let deviceComplianceScriptId = stored.deviceComplianceScriptId ?? "";
  const name = text(fields.scriptName);
  if (name !== undefined && scripts && scripts.get(deviceComplianceScriptId) !== name) {
    const id = [...scripts].find(([, scriptName]) => scriptName === name)?.[0];
    if (!id) throw new PushRefused(`There is no compliance script named "${name}" in the tenant.`);
    deviceComplianceScriptId = id;
  }
  if (!deviceComplianceScriptId) throw new PushRefused("The policy has no compliance script to keep, and the value names none.");

  // The rules: the tenant's document, with the staged rules laid over it.
  let document: Record<string, unknown> = {};
  try {
    document = JSON.parse(Buffer.from(stored.rulesContent ?? "", "base64").toString("utf8").replace(/^﻿/, "")) as Record<string, unknown>;
  } catch {
    throw new PushRefused("The policy's rules file can't be read, so it can't be changed from here.");
  }
  const key = "Rules" in document || !("rules" in document) ? "Rules" : "rules";
  const current = (Array.isArray(document[key]) ? document[key] : []) as Array<Record<string, unknown>>;
  const staged = fields.rules?.kind === "groupCollection" ? fields.rules.groups.map(fieldsOf) : [];
  if (staged.length === 0) throw new PushRefused("Custom compliance needs at least one rule. To stop using it, remove the setting from the policy.");

  const rules = staged.map((rule) => {
    const settingName = text(rule.settingName);
    const was = current.find((existing) => existing.SettingName === settingName);
    if (!was) {
      throw new PushRefused(`"${settingName ?? "A rule"}" isn't a rule this policy has. A new rule needs the messages shown to users, which are part of the rules file — add it in Intune.`);
    }
    return {
      ...was,
      ...(text(rule.operator) !== undefined ? { Operator: text(rule.operator) } : {}),
      ...(text(rule.dataType) !== undefined ? { DataType: text(rule.dataType) } : {}),
      ...(text(rule.operand) !== undefined ? { Operand: text(rule.operand) } : {}),
    };
  });

  return { deviceComplianceScriptId, rulesContent: Buffer.from(JSON.stringify({ ...document, [key]: rules }), "utf8").toString("base64") };
}
