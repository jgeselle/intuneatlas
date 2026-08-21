// A policy whose value should trip one of the bundled baseline rules
// (baselines/windows/defender.yml). Baseline rules match on the setting's
// CSP path, not its display name, so this searches by keyword and then
// filters to the definition whose computed cspPath (baseUri + offsetUri)
// is an exact match for the rule this scenario targets — the same
// cspPath computation src/scan/settingDefinitions.ts does.
import type { SeedClient } from "../client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../objects.js";
import { findSettingDefinitions, integerSettingInstance } from "../settingsCatalog.js";

// Mirrors baselines/windows/defender.yml's `update.quality-deferral` rule
// (expect: { max: 7 }) — chosen because a numeric max bound has an
// unambiguous violating value, unlike an "enabled"/"disabled" expectation.
const TARGET_CSP_PATH = "./Device/Vendor/MSFT/Policy/Config/Update/DeferQualityUpdatesPeriodInDays";
const VIOLATING_VALUE = 14; // bundled rule expects max: 7

export async function seedBelowBaseline(client: SeedClient, keyword = "Defer"): Promise<void> {
  const matches = await findSettingDefinitions(client, keyword);
  const definition = matches.find((d) => `${d.baseUri}${d.offsetUri}` === TARGET_CSP_PATH);
  if (!definition) {
    throw new Error(
      `No setting definition found matching keyword "${keyword}" with cspPath "${TARGET_CSP_PATH}". ` +
        `The bundled baseline rule (baselines/windows/defender.yml, update.quality-deferral) may have ` +
        `drifted from what this tenant's catalog actually exposes — worth checking by hand.`,
    );
  }

  const group = await createTestGroup(client, "below-baseline target");
  const policy = await createConfigurationPolicy(client, {
    name: `below baseline (${definition.displayName} = ${VIOLATING_VALUE})`,
    platforms: "windows10",
    settings: [integerSettingInstance(definition.id, VIOLATING_VALUE)],
  });
  await assignPolicy(client, policy.id, [{ kind: "group", groupId: group.id }]);

  console.log(
    `belowBaseline: policy "${policy.name}" sets "${definition.displayName}" to ${VIOLATING_VALUE} ` +
      `(rule update.quality-deferral expects max 7), assigned to "${group.displayName}".`,
  );
}
