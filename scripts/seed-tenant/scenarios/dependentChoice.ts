// A choice setting with a dependent child (e.g. "Block Flash activation:
// Enabled" with a dependent "Block Flash Action: ..."), a different
// mechanism from a group's children — confirmed live that the child's own
// rootDefinitionId points at this PARENT choice definition, not a group
// definition. Exercises the fix in src/scan/configurationPolicies.ts:
// this used to be silently dropped entirely — not even a placeholder,
// just absent from the scan result.
import type { SeedClient } from "../client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../objects.js";
import { choiceSettingInstance, findFirstChoiceWithDependentChild } from "../settingsCatalog.js";

export async function seedDependentChoice(client: SeedClient, keyword = "Flash"): Promise<void> {
  const { definition, child } = await findFirstChoiceWithDependentChild(client, keyword, "windows10");
  const parentOption = definition.options?.[definition.options.length - 1]; // last option, usually "Enabled"/the on-state
  const childOption = child.options?.[0];
  if (!parentOption || !childOption) {
    throw new Error(`"${keyword}" resolved a parent/child pair without usable options on both.`);
  }

  const group = await createTestGroup(client, `dependent choice target (${keyword})`);

  const childInstance = choiceSettingInstance(child.id, childOption.itemId);
  const parentInstance = choiceSettingInstance(definition.id, parentOption.itemId, [childInstance]);

  const policy = await createConfigurationPolicy(client, {
    name: `dependent choice (${definition.displayName} = ${parentOption.displayName})`,
    platforms: "windows10",
    settings: [parentInstance],
  });
  await assignPolicy(client, policy.id, [{ kind: "group", groupId: group.id }]);

  console.log(
    `dependentChoice: policy "${policy.name}" (child "${child.displayName}" = "${childOption.displayName}") ` +
      `assigned to "${group.displayName}".`,
  );
}
