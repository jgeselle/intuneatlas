// A real legacy Device Restrictions profile and a real Settings Catalog
// policy, disagreeing on the same setting, assigned to the same group —
// exercises exactly the gap src/scan/deviceConfigurations.ts exists to
// close: a classic template-based profile and a modern Settings Catalog
// policy writing the same underlying CSP is a real device-level conflict
// the merge engine couldn't see before that fix.
import type { SeedClient } from "../client.js";
import { assignDeviceConfiguration, assignPolicy, createConfigurationPolicy, createDeviceConfiguration, createTestGroup } from "../objects.js";
import { choiceSettingInstance, findFirstSimpleOrChoice } from "../settingsCatalog.js";

export async function seedLegacyConflict(client: SeedClient, keyword = "Camera"): Promise<void> {
  // "Allow Camera" — the same top-level windows10/mdm setting
  // src/scan/deviceConfigurations.ts maps cameraBlocked to.
  const definition = await findFirstSimpleOrChoice(client, keyword, "windows10", "mdm");
  const blocked = definition.options?.find((o) => o.displayName.startsWith("Not allowed"));
  const allowed = definition.options?.find((o) => o.displayName.startsWith("Allowed"));
  if (!blocked || !allowed) {
    throw new Error(`"${keyword}" didn't resolve to a setting with "Not allowed."/"Allowed." options — this scenario is built specifically around Allow Camera's shape.`);
  }

  const group = await createTestGroup(client, `legacy conflict target (${keyword})`);

  const legacy = await createDeviceConfiguration(client, {
    name: `legacy Device Restrictions (${keyword} blocked)`,
    odataType: "#microsoft.graph.windows10GeneralConfiguration",
    properties: { cameraBlocked: true },
  });
  await assignDeviceConfiguration(client, legacy.id, [{ kind: "group", groupId: group.id }]);

  const catalog = await createConfigurationPolicy(client, {
    name: `settings catalog (${keyword} = ${allowed.displayName})`,
    platforms: "windows10",
    settings: [choiceSettingInstance(definition.id, allowed.itemId)],
  });
  await assignPolicy(client, catalog.id, [{ kind: "group", groupId: group.id }]);

  console.log(
    `legacyConflict: group "${group.displayName}" targeted by legacy profile "${legacy.name}" (${keyword} blocked) ` +
      `and Settings Catalog policy "${catalog.name}" (${allowed.displayName}) — same real setting, disagreeing values, different Graph resource types.`,
  );
}
