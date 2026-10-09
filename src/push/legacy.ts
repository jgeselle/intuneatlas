import { graphGet } from "../graph.js";
import { GRAPH_BETA_BASE } from "../config.js";
import { LEGACY_MAPPINGS, WINDOWS10_GENERAL_CONFIGURATION } from "../scan/deviceConfigurations.js";
import type { SettingValueNode } from "../scan/types.js";
import { graphWrite } from "./graphWrite.js";
import { PushRefused } from "./values.js";

/**
 * Legacy (template-based, pre-Settings-Catalog) device configuration
 * profiles — as far as the tool reads them, which is a handful of
 * Device Restrictions switches (see src/scan/deviceConfigurations.ts).
 *
 * Each of those is one true/false property on the profile, shown as the
 * option the matching Settings Catalog setting has for it ("Not
 * allowed." for a blocked camera). A push turns the chosen option back
 * into that property and patches it alone.
 *
 * Returns false when the id isn't a legacy profile at all, so the caller
 * can say what it is not.
 */
export async function pushLegacySetting(token: string, change: { policyId: string; definitionId: string; from: string; node: SettingValueNode }): Promise<boolean> {
  const mapping = LEGACY_MAPPINGS.find((m) => m.settingDefinitionId === change.definitionId);
  const path = `/deviceManagement/deviceConfigurations/${change.policyId}`;
  const profile = await graphGet<Record<string, unknown>>(token, path, GRAPH_BETA_BASE).catch((error: unknown) => {
    if (error instanceof Error && /failed: (400|404)\b/.test(error.message)) return undefined;
    throw error;
  });
  if (!profile) return false;

  if (!mapping || profile["@odata.type"] !== WINDOWS10_GENERAL_CONFIGURATION) {
    throw new PushRefused(`"${String(profile.displayName ?? "This profile")}" is a legacy profile, and this setting in it isn't one the tool can write.`);
  }
  const label = change.node.kind === "choice" ? change.node.label : undefined;
  const blocked = label !== undefined && mapping.blockedOptionText(label) ? true : label !== undefined && mapping.allowedOptionText(label) ? false : undefined;
  if (blocked === undefined) throw new PushRefused(`"${change.node.name}" in a legacy profile can only be switched between its two options.`);

  // Held against what the change was staged from, the same way as everywhere: by what the value reads as.
  const current = profile[mapping.property];
  const was = mapping.blockedOptionText(change.from) ? true : mapping.allowedOptionText(change.from) ? false : undefined;
  if (typeof current !== "boolean") throw new PushRefused(`The profile no longer sets "${change.node.name}". Sync, then stage the change again.`);
  if (current !== was) throw new PushRefused(`"${change.node.name}" is no longer what it was when this change was staged. Sync, then stage the change again.`);

  await graphWrite(token, "PATCH", path, { "@odata.type": WINDOWS10_GENERAL_CONFIGURATION, [mapping.property]: blocked });
  return true;
}
