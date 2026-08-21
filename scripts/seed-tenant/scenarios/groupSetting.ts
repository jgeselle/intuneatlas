// A policy built from a real group/nested setting definition — reproduces
// finding #1 against real data: src/scan/configurationPolicies.ts's
// extractValue() has no case for group settings and falls back to the
// literal string "(group setting)". The wrapping payload shape
// (groupSettingCollectionValue: [{ children: [...] }]) is confirmed
// against Microsoft's schema docs.
//
// Picking valid children is the hard part, confirmed the hard way: Attack
// Surface Reduction Rules' children are actually a flat set of independent
// (choice rule, optional collection-of-strings exclusions) sibling pairs,
// not one shared bag — a real create call rejected mixing two different
// rules' children together ("SettingGroupValues contains different
// setting group instances ... Expected setting group instance ..."). So
// this uses exactly one child (the first choice-type one, with its first
// option) rather than guessing how many/which children belong together —
// the smallest instance that's unambiguously valid.
import type { SeedClient } from "../client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../objects.js";
import { choiceSettingInstance, findFirstGroup, groupSettingCollectionInstance, isChoice } from "../settingsCatalog.js";

// "BitLocker" resolves plenty of settings in a real catalog, but none are
// group-type — confirmed against a live tenant. "Attack Surface" reliably
// hits "Attack Surface Reduction Rules", a real
// deviceManagementConfigurationSettingGroupCollectionDefinition.
export async function seedGroupSetting(client: SeedClient, keyword = "Attack Surface"): Promise<void> {
  const { definition, children } = await findFirstGroup(client, keyword, "windows10");
  const child = children.find((c) => isChoice(c) && (c.options?.length ?? 0) > 0);
  if (!child) {
    throw new Error(`Group setting "${definition.displayName}" has no choice-type child with options to use.`);
  }

  const group = await createTestGroup(client, `group setting target (${keyword})`);
  const childInstance = choiceSettingInstance(child.id, child.options![0].itemId);

  const policy = await createConfigurationPolicy(client, {
    name: `group setting (${definition.displayName})`,
    platforms: "windows10",
    settings: [groupSettingCollectionInstance(definition.id, [childInstance])],
  });

  await assignPolicy(client, policy.id, [{ kind: "group", groupId: group.id }]);

  console.log(
    `groupSetting: policy "${policy.name}" using group definition "${definition.displayName}" ` +
      `(child: "${child.displayName}"), assigned to "${group.displayName}".`,
  );
}
