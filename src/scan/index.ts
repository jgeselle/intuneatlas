import { isDeployed } from "./assignments.js";
import type { RawPolicy, SettingIndexEntry, SettingIndexSource, SettingIndexState, SettingSchema } from "./types.js";

interface IndexBucket {
  name: string;
  cspPath: string;
  category: string;
  platform: string;
  definitionId?: string;
  schemas?: Record<string, SettingSchema>;
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
          // The schema belongs to the definition, not to any one policy —
          // but which sub-settings it covers depends on what each policy's
          // value actually touches, so later policies add to it below.
          ...(setting.schemas ? { definitionId: setting.settingDefinitionId, schemas: { ...setting.schemas } } : {}),
          sources: [],
        });
      }
      const bucket = buckets.get(key)!;
      if (setting.schemas && bucket.schemas) Object.assign(bucket.schemas, setting.schemas);
      bucket.sources.push({
        policyId: policy.id,
        policyName: policy.name,
        value: setting.value,
        deployed,
        ...(setting.structured ? { structured: setting.structured } : {}),
      });
    }
  }

  return Array.from(buckets.entries())
    .map(([key, bucket]) => {
      const deployedSources = bucket.sources.filter((s) => s.deployed);
      const deployedValues = Array.from(new Set(deployedSources.map((s) => s.value)));
      // What reaches devices comes first — values[0] is read as the effective value everywhere —
      // followed by anything only an unassigned policy holds.
      const values = Array.from(new Set([...deployedValues, ...bucket.sources.map((s) => s.value)]));
      // Only policies that are assigned can disagree with each other: an unassigned one reaches nothing.
      const conflict = deployedValues.length > 1;

      let state: SettingIndexState = "Not checked";
      if (conflict) state = "Conflict";
      else if (deployedSources.length === 0) state = "Not assigned";

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
        ...(bucket.schemas ? { definitionId: bucket.definitionId, schemas: bucket.schemas } : {}),
        recs: [],
      };
    })
    .sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
    );
}
