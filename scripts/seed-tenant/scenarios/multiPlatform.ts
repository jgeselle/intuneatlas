// Windows/iOS/macOS/Android policies side by side, each assigned to their
// own group — exercises platform grouping/filtering in the Settings view
// against real per-platform catalog data instead of fixtures that only
// ever cover Windows.
import type { SeedClient } from "../client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../objects.js";
import { choiceSettingInstance, findFirstNestedChoice, findFirstSimpleOrChoice, groupSettingCollectionInstance } from "../settingsCatalog.js";

interface PlatformEntry {
  platforms: string; // value expected by POST /deviceManagement/configurationPolicies
  applicabilityToken: string; // substring to match against a definition's applicability.platform
  keyword: string;
  technology: string; // must match the resolved setting's own required technology
  nested?: boolean; // the setting sits inside a group collection, which the policy must carry too
}

// Confirmed against a live tenant that a single keyword+technology
// doesn't generalize across platforms: "Camera" resolves nothing usable
// for iOS/macOS/android at all (Apple's Camera-related settings are
// deeply nested, not top-level; Android's aren't tagged "mdm"), and
// iOS's top-level catalog is almost entirely "enrollment"-technology
// (ADE/Setup Assistant) settings, and those belong to enrollment profile
// templates: a plain policy holding one is refused with "Empty or invalid
// template reference" (confirmed for real). Its ordinary device settings
// all sit inside payload groups instead, so iOS's policy is built from
// one of those (`nested`): Allow Camera inside Restrictions.
const ENTRIES: PlatformEntry[] = [
  { platforms: "windows10", applicabilityToken: "windows10", keyword: "Camera", technology: "mdm" },
  { platforms: "iOS", applicabilityToken: "iOS", keyword: "Camera", technology: "mdm,appleRemoteManagement", nested: true },
  { platforms: "macOS", applicabilityToken: "macOS", keyword: "Diagnostic", technology: "mdm" },
  { platforms: "androidEnterprise", applicabilityToken: "androidEnterprise", keyword: "App", technology: "android" },
];

/** `only`: one platform (e.g. "iOS") instead of all four. */
export async function seedMultiPlatform(client: SeedClient, only?: string): Promise<void> {
  for (const entry of ENTRIES.filter((e) => !only || e.platforms.toLowerCase() === only.toLowerCase())) {
    try {
      if (entry.nested) {
        const { group: payload, choice } = await findFirstNestedChoice(client, entry.keyword, entry.applicabilityToken, entry.technology);
        const option = choice.options?.[0];
        if (!option) throw new Error(`"${choice.displayName}" has no options`);
        const group = await createTestGroup(client, `multiplatform target (${entry.platforms})`);
        const policy = await createConfigurationPolicy(client, {
          name: `multiplatform (${entry.platforms}: ${choice.displayName})`,
          platforms: entry.platforms,
          technologies: entry.technology,
          settings: [groupSettingCollectionInstance(payload.id, [choiceSettingInstance(choice.id, option.itemId)])],
        });
        await assignPolicy(client, policy.id, [{ kind: "group", groupId: group.id }]);
        console.log(`multiPlatform: "${entry.platforms}" — policy "${policy.name}" assigned to "${group.displayName}".`);
        continue;
      }
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
