import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet } from "../graph.js";

interface SettingDefinitionOption {
  itemId: string;
  displayName: string;
}

interface SettingDefinitionResponse {
  id: string;
  displayName: string;
  baseUri: string;
  offsetUri: string;
  categoryId: string;
  options?: SettingDefinitionOption[];
}

export interface ResolvedDefinition {
  name: string;
  cspPath: string;
  category: string;
  /**
   * Choice-type settings only. Graph returns opaque `{definitionId}_{index}`
   * strings for choiceSettingValue.value, not human-readable text — this
   * maps those ids back to their real display name (e.g. "Enabled").
   */
  options?: Map<string, string>;
}

/**
 * Resolves a Settings Catalog setting's human name, CSP/OMA-URI path, and
 * (for choice-type settings) its option display names. This is the one call
 * in the whole codebase that has no v1.0 equivalent —
 * deviceManagementConfigurationSettingDefinition is beta-only. Isolated here
 * so a future breaking change is a single-file fix.
 *
 * Cached per process (i.e. per `scan` run): many policies reuse the same
 * settingDefinitionId, and this is the highest-volume call in a scan.
 */
const cache = new Map<string, ResolvedDefinition>();

export async function resolveSettingDefinition(
  token: string,
  settingDefinitionId: string,
): Promise<ResolvedDefinition> {
  const cached = cache.get(settingDefinitionId);
  if (cached) return cached;

  const definition = await graphGet<SettingDefinitionResponse>(
    token,
    `/deviceManagement/configurationSettings/${settingDefinitionId}`,
    GRAPH_BETA_BASE,
  );

  const resolved: ResolvedDefinition = {
    name: definition.displayName,
    cspPath: `${definition.baseUri}${definition.offsetUri}`,
    // Friendly category names need a second beta lookup
    // (deviceManagementConfigurationCategory) — deferred, use the raw id.
    category: definition.categoryId,
    ...(definition.options
      ? { options: new Map(definition.options.map((o) => [o.itemId, o.displayName])) }
      : {}),
  };

  cache.set(settingDefinitionId, resolved);
  return resolved;
}
