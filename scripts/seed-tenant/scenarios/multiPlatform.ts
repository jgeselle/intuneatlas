// Windows/iOS/macOS/Android policies side by side, each assigned to their
// own group — exercises platform grouping/filtering in the Settings view
// against real per-platform catalog data instead of fixtures that only
// ever cover Windows.
import type { SeedClient } from "../client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../objects.js";
import { choiceSettingInstance, findFirstSimpleOrChoice } from "../settingsCatalog.js";

interface PlatformEntry {
  platforms: string; // value expected by POST /deviceManagement/configurationPolicies
  applicabilityToken: string; // substring to match against a definition's applicability.platform
  keyword: string;
}

// "Camera" doesn't resolve any android-platform setting in a real
// catalog — confirmed against a live tenant, android entries use a
// different keyword than the other three platforms as a result.
const ENTRIES: PlatformEntry[] = [
  { platforms: "windows10", applicabilityToken: "windows10", keyword: "Camera" },
  { platforms: "iOS", applicabilityToken: "iOS", keyword: "Camera" },
  { platforms: "macOS", applicabilityToken: "macOS", keyword: "Camera" },
  { platforms: "androidEnterprise", applicabilityToken: "androidEnterprise", keyword: "Location" },
];

export async function seedMultiPlatform(client: SeedClient): Promise<void> {
  for (const entry of ENTRIES) {
    try {
      const definition = await findFirstSimpleOrChoice(client, entry.keyword, entry.applicabilityToken);
      if (!definition.options?.length) {
        console.log(`multiPlatform: "${entry.platforms}" — "${definition.displayName}" has no choice options, skipped.`);
        continue;
      }
      const group = await createTestGroup(client, `multiplatform target (${entry.platforms})`);
      const policy = await createConfigurationPolicy(client, {
        name: `multiplatform (${entry.platforms}: ${definition.displayName})`,
        platforms: entry.platforms,
        settings: [choiceSettingInstance(definition.id, definition.options[0].itemId)],
      });
      await assignPolicy(client, policy.id, [{ kind: "group", groupId: group.id }]);
      console.log(`multiPlatform: "${entry.platforms}" — policy "${policy.name}" assigned to "${group.displayName}".`);
    } catch (err) {
      console.log(`multiPlatform: "${entry.platforms}" — skipped (${err instanceof Error ? err.message : err})`);
    }
  }
}
