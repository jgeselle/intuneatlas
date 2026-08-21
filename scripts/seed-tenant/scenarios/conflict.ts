// Two policies, same setting, different values, assigned to the same
// group — the base case a real conflict-detection run needs to find.
import type { SeedClient } from "../client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../objects.js";
import { choiceSettingInstance, findFirstSimpleOrChoice, isChoice } from "../settingsCatalog.js";

export async function seedConflict(client: SeedClient, keyword = "Camera"): Promise<void> {
  const definition = await findFirstSimpleOrChoice(client, keyword, "windows10");
  if (!isChoice(definition) || (definition.options?.length ?? 0) < 2) {
    throw new Error(
      `"${keyword}" resolved to a setting definition without at least two choice options — ` +
        `pick a different keyword. A conflict needs two distinct values for the same setting.`,
    );
  }
  const [optionA, optionB] = definition.options!;

  const group = await createTestGroup(client, `conflict target (${keyword})`);

  const policyA = await createConfigurationPolicy(client, {
    name: `conflict A (${keyword} = ${optionA.displayName})`,
    platforms: "windows10",
    settings: [choiceSettingInstance(definition.id, optionA.itemId)],
  });
  const policyB = await createConfigurationPolicy(client, {
    name: `conflict B (${keyword} = ${optionB.displayName})`,
    platforms: "windows10",
    settings: [choiceSettingInstance(definition.id, optionB.itemId)],
  });

  await assignPolicy(client, policyA.id, [{ kind: "group", groupId: group.id }]);
  await assignPolicy(client, policyB.id, [{ kind: "group", groupId: group.id }]);

  console.log(
    `conflict: group "${group.displayName}" targeted by both "${policyA.name}" (${optionA.displayName}) ` +
      `and "${policyB.name}" (${optionB.displayName}) on setting "${definition.displayName}".`,
  );
}
