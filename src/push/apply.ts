import type { ViewerIdentity } from "../auth/webSession.js";
import { isComplianceDefinition } from "../scan/complianceSettings.js";
import { summarizeSources } from "../scan/index.js";
import type { GroupDirectory, SettingIndexEntry, SettingValueNode } from "../scan/types.js";
import { getAllChanges, getChangeById, revertChange, type StagedChange } from "../storage/changes.js";
import { recordPushedChange } from "../storage/history.js";
import { pushNewPolicy, pushToExistingPolicy, PushRefused } from "./index.js";

/** As much of the report in memory as a push reads and brings up to date. */
interface PushableReport {
  settings: SettingIndexEntry[];
  groups?: GroupDirectory;
}

/**
 * Pushes one staged change and does everything that goes with it, in this
 * order: write to the tenant; record it in the setting's history with who
 * and why; close the staged change. Nothing after the write can be left
 * undone by a refusal — a refusal always comes before it.
 *
 * A change to an existing policy is one setting. A setting staged into a
 * new policy is never pushed alone: the policy is created from every
 * setting staged under its name, so all of them have to be ready.
 *
 * Returns the staged changes it closed and, for a change to an existing
 * policy, the report with that policy's value brought up to date — the
 * tenant now holds the new value, and waiting for a scan to say so would
 * leave the page showing the old one. A new policy isn't added to the
 * report: only a scan reads what Intune made of it.
 */
export async function applyPush(
  id: number,
  writeToken: string,
  viewer: ViewerIdentity,
  report: unknown,
  tenant: string,
): Promise<{ closed: StagedChange[]; policyName: string; created: boolean; report?: unknown }> {
  const change = getChangeById(id);
  if (!change) throw new PushRefused("This change is no longer staged.");
  const current = report as PushableReport | null;

  if (change.targetKind !== "new") {
    const item = pushable(change, current);
    await pushToExistingPolicy(writeToken, { ...item, policyId: change.policyId, from: change.from });
    close(change, change.policyId, viewer, tenant);
    return { closed: [change], policyName: change.policyName, created: false, ...(current ? { report: withPushedValue(current, change, item.node) } : {}) };
  }

  const together = Object.values(getAllChanges()).filter((other) => other.targetKind === "new" && other.policyName === change.policyName);
  const notReady = together.filter((other) => !other.ready);
  if (notReady.length > 0) {
    throw new PushRefused(
      `"${change.policyName}" is created from all ${together.length} settings staged for it, and ${notReady.length} of them ${notReady.length === 1 ? "still needs" : "still need"} a reason and a reviewer.`,
    );
  }
  const items = together.map((other) => pushable(other, current));
  const { policyId } = await pushNewPolicy(writeToken, { name: change.policyName, platform: platformOf(change), settings: items });
  for (const other of together) close(other, policyId, viewer, tenant);
  return { closed: together, policyName: change.policyName, created: true };
}

/** The setting a change is about, by the key it has while a policy sets it — a Missing setting's own key says "uncovered". */
const settingKeyOf = (change: StagedChange) => (change.settingKey || change.targetKey).replace(/^uncovered::/, "");
/** A setting's key is its definition id and platform. */
const definitionIdOf = (change: StagedChange) => settingKeyOf(change).slice(0, settingKeyOf(change).lastIndexOf("::"));
const platformOf = (change: StagedChange) => settingKeyOf(change).slice(settingKeyOf(change).lastIndexOf("::") + 2);

function pushable(change: StagedChange, report: PushableReport | null) {
  if (!change.ready) throw new PushRefused("A change needs a reason and a reviewer before it can be pushed.");
  if (!change.toStructured) {
    throw new PushRefused(`The staged value of "${change.targetName}" has no structure to write — it was staged as plain text. Stage it again from the setting's panel.`);
  }
  const entry = report?.settings.find((e) => e.key === settingKeyOf(change));
  return { definitionId: definitionIdOf(change), node: change.toStructured as SettingValueNode, ...(entry?.schemas ? { schemas: entry.schemas } : {}) };
}

function close(change: StagedChange, policyId: string, viewer: ViewerIdentity, tenant: string): void {
  recordPushedChange({
    tenant,
    settingKey: settingKeyOf(change),
    policyId,
    policyName: change.policyName,
    // A setting put into a new policy had no value there before.
    ...(change.targetKind !== "new" ? { from: change.from } : {}),
    to: change.to,
    pushedBy: viewer.name,
    stagedBy: change.stagedByName,
    reviewedBy: change.reviewedBy,
    reason: change.reason,
  });
  revertChange(change.id);
}

function withPushedValue(report: PushableReport, change: StagedChange, node: SettingValueNode): PushableReport {
  return {
    ...report,
    settings: report.settings.map((entry) => {
      if (entry.key !== settingKeyOf(change) || !entry.sources.some((source) => source.policyId === change.policyId)) return entry;
      const sources = entry.sources.map((source) => (source.policyId === change.policyId ? { ...source, value: change.to, structured: node } : source));
      return { ...entry, sources, ...summarizeSources(sources, report.groups, { conflicts: !isComplianceDefinition(entry.definitionId) }) };
    }),
  };
}
