// Many policies/settings, for scale and UI testing — how the Settings
// view, search, and category grouping hold up against hundreds of rows
// instead of the handful hand-written fixtures ever produce.
import type { SeedClient } from "../client.js";
import { assignPolicy, createConfigurationPolicy, createTestGroup } from "../objects.js";
import { choiceSettingInstance, findFirstSimpleOrChoice } from "../settingsCatalog.js";

// A handful of keywords likely to resolve to distinct choice settings —
// varying which one backs each policy gives volume some real category/CSP
// path spread instead of hundreds of copies of one setting.
const KEYWORDS = ["Camera", "Bluetooth", "Cortana", "Copy Paste", "Location", "Microphone", "NFC", "USB"];

export async function seedVolume(client: SeedClient, count = 200): Promise<void> {
  const group = await createTestGroup(client, `volume target (${count})`);

  const definitions = [];
  for (const keyword of KEYWORDS) {
    try {
      definitions.push(await findFirstSimpleOrChoice(client, keyword, "windows10"));
    } catch {
      // Keyword didn't resolve in this tenant's catalog — skip it, the
      // remaining keywords are enough for volume purposes.
    }
  }
  if (definitions.length === 0) {
    throw new Error("None of the volume scenario's keywords resolved to a setting in this tenant's catalog.");
  }

  // Cycling through every option value (not just the first) is deliberate
  // — it spreads volume across more distinct values. Options that need a
  // sub-setting of their own are left out of the cycle: this toolkit
  // doesn't build those, and Graph refuses the policy without them
  // (confirmed for real: a Chrome content-setting option rejected with
  // "doesnt contain required dependent settings"). Anything else that
  // fails is skipped and counted rather than thrown — volume's job is a
  // lot of policies, not every attempted one succeeding.
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < count; i++) {
    const definition = definitions[i % definitions.length];
    const usable = (definition.options ?? []).filter((o) => !(o.dependedOnBy ?? []).some((d) => d.required));
    if (!usable.length) continue;
    const option = usable[i % usable.length];
    try {
      const policy = await createConfigurationPolicy(client, {
        name: `volume ${i + 1}/${count} (${definition.displayName})`,
        platforms: "windows10",
        settings: [choiceSettingInstance(definition.id, option.itemId)],
      });
      await assignPolicy(client, policy.id, [{ kind: "group", groupId: group.id }]);
      created++;
    } catch (err) {
      skipped++;
      console.log(`volume ${i + 1}/${count}: skipped (${err instanceof Error ? err.message.split("\n")[0] : err})`);
    }
  }

  console.log(
    `volume: created ${created} policies (${skipped} skipped) across ${definitions.length} settings, assigned to "${group.displayName}".`,
  );
}
