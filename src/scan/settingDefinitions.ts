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

interface CategoryResponse {
  id: string;
  displayName: string;
  description?: string;
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
const categoryCache = new Map<string, string>();

/**
 * Resolves a category id to its friendly display name (e.g. "Windows
 * Update For Business"). Confirmed against a live tenant: the
 * deviceManagementConfigurationCategory resource's `name` property is
 * null — `displayName` is the one that's actually populated, same
 * convention as every other setting-catalog resource in this file.
 * BUT confirmed against a much larger real-world corpus (importing ~1500
 * real settings from a real tenant's exported policies) that displayName
 * itself is sometimes empty too — every ADMX-derived leaf category seen
 * so far (Group Policy templates imported into the catalog) has an empty
 * displayName but a real, useful `description` ("Administrative
 * Templates"). Falls back through both before giving up to the raw id,
 * never a blank string. Cached per process, same reasoning as
 * resolveSettingDefinition below: many settings share a category.
 */
async function resolveCategoryName(token: string, categoryId: string): Promise<string> {
  const cached = categoryCache.get(categoryId);
  if (cached) return cached;

  const category = await graphGet<CategoryResponse>(
    token,
    `/deviceManagement/configurationCategories/${categoryId}`,
    GRAPH_BETA_BASE,
  );

  const name = category.displayName || category.description || categoryId;
  categoryCache.set(categoryId, name);
  return name;
}

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
    category: await resolveCategoryName(token, definition.categoryId),
    ...(definition.options
      ? { options: new Map(definition.options.map((o) => [o.itemId, o.displayName])) }
      : {}),
  };

  cache.set(settingDefinitionId, resolved);
  return resolved;
}
