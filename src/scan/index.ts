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
 * Ported from intuneatlas.jsx's buildSettingIndex (lines 616-669): flattens
 * every configuration policy's settings into one tenant-wide index keyed by
 * `cspPath::platform`, and flags a conflict when ≥2 deployed sources
 * disagree on the value. Baseline-derived states ("Below baseline" /
 * "Staged" / "Dismissed") don't exist yet — that's phase 3.
 *
 * Keyed on cspPath, not name: confirmed by inspecting every existing test
 * fixture that they all happened to pair name↔cspPath 1:1, which is why
 * this was keyed on `name::platform` for a while without anything
 * catching it — a display name isn't guaranteed unique the way a CSP
 * path is, so two genuinely different settings sharing a name could
 * merge into one (false) conflict, or the reverse.
 */
export function buildSettingIndex(policies: RawPolicy[]): SettingIndexEntry[] {
  const buckets = new Map<string, IndexBucket>();

  for (const policy of policies) {
    const deployed = isDeployed(policy.assignments);

    for (const setting of policy.settings) {
      const key = `${setting.cspPath}::${policy.platform}`;
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
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
