import { isDeployed } from "./assignments.js";
import type { RawPolicy, SettingIndexEntry, SettingIndexSource, SettingIndexState } from "./types.js";

interface IndexBucket {
  name: string;
  cspPath: string;
  category: string;
  platform: string;
  sources: SettingIndexSource[];
}

/**
 * Flattens every configuration policy's settings into one tenant-wide
 * index keyed by `settingDefinitionId::platform`, and flags a conflict
 * when ≥2 deployed sources disagree on the value. The merge/conflict
 * mechanic here has diverged from intuneatlas.jsx's original
 * buildSettingIndex (lines 616-669, keyed on `name::platform`) in the
 * one respect that matters most — this is no longer a straight port.
 * Baseline-derived states ("Below baseline" / "Staged" / "Dismissed")
 * don't exist yet — that's phase 3.
 *
 * Keyed on settingDefinitionId, not cspPath or name: a display name
 * isn't guaranteed unique (confirmed against a live tenant's catalog),
 * and neither is cspPath — Graph's definition-level cspPath is a
 * template (`{0}`/`[{0}]` placeholders for collection items), so
 * distinct sibling definitions in a parameterized group can share the
 * literal same displayed path string (confirmed live: 16 real
 * collisions between different, fully-populated settingDefinitionIds in
 * a ~2,000-definition sample, e.g. an app-level and a Safari-specific
 * camera-permission setting both rendering as
 * "Privacy/PermissionDefaults/{0}/Camera"). settingDefinitionId is the
 * one field Graph actually guarantees unique per setting — it's the
 * literal id used to look the definition up — and it's always populated
 * on RawSetting, no empty-field risk the way cspPath has (~20% of a
 * live sample, mostly macOS/iOS preference-domain settings, had an
 * empty baseUri). cspPath stays on the index purely for display.
 */
export function buildSettingIndex(policies: RawPolicy[]): SettingIndexEntry[] {
  const buckets = new Map<string, IndexBucket>();

  for (const policy of policies) {
    const deployed = isDeployed(policy.assignments);

    for (const setting of policy.settings) {
      const key = `${setting.settingDefinitionId}::${policy.platform}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          name: setting.name,
          cspPath: setting.cspPath,
          category: setting.category,
          platform: policy.platform,
          sources: [],
        });
      }
      buckets.get(key)!.sources.push({
        policyId: policy.id,
        policyName: policy.name,
        value: setting.value,
        deployed,
      });
    }
  }

  return Array.from(buckets.entries())
    .map(([key, bucket]) => {
      const values = Array.from(new Set(bucket.sources.map((s) => s.value)));
      const deployedSources = bucket.sources.filter((s) => s.deployed);
      const conflict = values.length > 1 && deployedSources.length > 1;

      let state: SettingIndexState = "Baseline";
      if (conflict) state = "Conflict";
      else if (deployedSources.length === 0) state = "Not deployed";

      return {
        key,
        name: bucket.name,
        cspPath: bucket.cspPath,
        category: bucket.category,
        platform: bucket.platform,
        values,
        sources: bucket.sources,
        conflict,
        state,
      };
    })
    .sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
    );
}
