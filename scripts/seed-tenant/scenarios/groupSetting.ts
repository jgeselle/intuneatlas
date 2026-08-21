// A policy built from a real group/nested setting definition — reproduces
// finding #1 against real data: src/scan/configurationPolicies.ts's
// extractValue() has no case for group settings and falls back to the
// literal string "(group setting)". The payload shape is confirmed
// against Microsoft's schema docs (see the comment on
// groupSettingCollectionInstance in settingsCatalog.ts); what's not yet
// confirmed is whether this scenario's guessed child values pass that
// specific group definition's own validation on a live tenant.
import type { SeedClient } from "../client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../objects.js";
import {
  choiceSettingInstance,
  findFirstGroup,
  groupSettingCollectionInstance,
  isChoice,
  stringSettingInstance,
  type SettingDefinition,
} from "../settingsCatalog.js";

function buildChildInstance(child: SettingDefinition): unknown {
  if (isChoice(child) && (child.options?.length ?? 0) > 0) {
    return choiceSettingInstance(child.id, child.options![0].itemId);
  }
  // Best-effort default for non-choice children — a real run may need to
  // special-case a particular child by name if this guess doesn't fit.
  return stringSettingInstance(child.id, "1");
}

// "BitLocker" resolves plenty of settings in a real catalog, but none are
// group-type — confirmed against a live tenant. "Attack Surface" reliably
// hits "Attack Surface Reduction Rules", a real
// deviceManagementConfigurationSettingGroupCollectionDefinition.
export async function seedGroupSetting(client: SeedClient, keyword = "Attack Surface"): Promise<void> {
  const { definition, children } = await findFirstGroup(client, keyword, "windows10");
  if (children.length === 0) {
    throw new Error(`Group setting "${definition.displayName}" resolved with no child definitions found.`);
  }

  const group = await createTestGroup(client, `group setting target (${keyword})`);
  const childInstances = children.slice(0, 3).map(buildChildInstance);

  const policy = await createConfigurationPolicy(client, {
    name: `group setting (${definition.displayName})`,
    platforms: "windows10",
    settings: [groupSettingCollectionInstance(definition.id, childInstances)],
  });

  await assignPolicy(client, policy.id, [{ kind: "group", groupId: group.id }]);

  console.log(
    `groupSetting: policy "${policy.name}" using group definition "${definition.displayName}" ` +
      `(${children.length} children found, ${childInstances.length} used) assigned to "${group.displayName}".`,
  );
}
