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
  technology: string; // must match the resolved setting's own required technology
}

// Confirmed against a live tenant that a single keyword+technology
// doesn't generalize across platforms: "Camera" resolves nothing usable
// for iOS/macOS/android at all (Apple's Camera-related settings are
// deeply nested, not top-level; Android's aren't tagged "mdm"), and
// iOS's top-level catalog is almost entirely "enrollment"-technology
// (ADE/Setup Assistant) settings rather than "mdm" ones — so its policy
// here is a real, different *kind* of policy than the other three, not
// an artifact of picking the wrong keyword.
const ENTRIES: PlatformEntry[] = [
  { platforms: "windows10", applicabilityToken: "windows10", keyword: "Camera", technology: "mdm" },
  { platforms: "iOS", applicabilityToken: "iOS", keyword: "Passcode", technology: "enrollment" },
  { platforms: "macOS", applicabilityToken: "macOS", keyword: "Diagnostic", technology: "mdm" },
  { platforms: "androidEnterprise", applicabilityToken: "androidEnterprise", keyword: "App", technology: "android" },
];

export async function seedMultiPlatform(client: SeedClient): Promise<void> {
  for (const entry of ENTRIES) {
    try {
      const definition = await findFirstSimpleOrChoice(client, entry.keyword, entry.applicabilityToken, entry.technology);
      if (!definition.options?.length) {
        console.log(`multiPlatform: "${entry.platforms}" — "${definition.displayName}" has no choice options, skipped.`);
        continue;
      }
      const group = await createTestGroup(client, `multiplatform target (${entry.platforms})`);
      const policy = await createConfigurationPolicy(client, {
        name: `multiplatform (${entry.platforms}: ${definition.displayName})`,
        platforms: entry.platforms,
        technologies: entry.technology,
        settings: [choiceSettingInstance(definition.id, definition.options[0].itemId)],
      });
      await assignPolicy(client, policy.id, [{ kind: "group", groupId: group.id }]);
      console.log(`multiPlatform: "${entry.platforms}" — policy "${policy.name}" assigned to "${group.displayName}".`);
    } catch (err) {
      console.log(`multiPlatform: "${entry.platforms}" — skipped (${err instanceof Error ? err.message : err})`);
    }
  }
}
