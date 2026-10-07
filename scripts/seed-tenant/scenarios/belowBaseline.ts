// A policy that sets "quality update deferral" to 14 days — a value a
// baseline expecting 7 days (or less) is not met by. No baseline ships
// with the app any more, so this needs one of your own to trip: an
// exported policy that sets the same setting to 7, with `compare: atMost`
// for it in the pack's baseline.yml.
//
// Searches by keyword and then filters to the definition whose computed
// cspPath (baseUri + offsetUri) is an exact match — the same cspPath
// computation src/scan/settingDefinitions.ts does.
import type { SeedClient } from "../client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../objects.js";
import { findSettingDefinitions, integerSettingInstance } from "../settingsCatalog.js";

// Chosen because a numeric upper bound has an unambiguous violating
// value, unlike an "enabled"/"disabled" expectation.
const TARGET_CSP_PATH = "./Device/Vendor/MSFT/Policy/Config/Update/DeferQualityUpdatesPeriodInDays";
const VIOLATING_VALUE = 14; // a baseline of "7 or less" is not met

export async function seedBelowBaseline(client: SeedClient, keyword = "Defer"): Promise<void> {
  const matches = await findSettingDefinitions(client, keyword);
  const definition = matches.find((d) => `${d.baseUri}${d.offsetUri}` === TARGET_CSP_PATH);
  if (!definition) {
    throw new Error(
      `No setting definition found matching keyword "${keyword}" with cspPath "${TARGET_CSP_PATH}". ` +
        `This tenant's catalog may expose it differently — worth checking by hand.`,
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
      `(above a baseline of 7 or less), assigned to "${group.displayName}".`,
  );
}
