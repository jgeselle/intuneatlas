import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet } from "../graph.js";

interface SettingDefinitionResponse {
  id: string;
  displayName: string;
  baseUri: string;
  offsetUri: string;
  categoryId: string;
}

export interface ResolvedDefinition {
  name: string;
  cspPath: string;
  category: string;
}

/**
 * Resolves a Settings Catalog setting's human name and CSP/OMA-URI path.
 * This is the one call in the whole codebase that has no v1.0 equivalent —
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
  };

  cache.set(settingDefinitionId, resolved);
  return resolved;
}
