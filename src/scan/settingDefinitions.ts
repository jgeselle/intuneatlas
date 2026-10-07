import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet } from "../graph.js";
import type { SettingKind, SettingSchema } from "./types.js";

interface SettingDefinitionOption {
  itemId: string;
  displayName: string;
  description?: string | null;
  /** Sub-settings that only apply while this option is selected. */
  dependedOnBy?: Array<{ dependedOnBy: string; required?: boolean }> | null;
}

interface SettingValueDefinition {
  "@odata.type"?: string;
  minimumValue?: number | null;
  maximumValue?: number | null;
  minimumLength?: number | null;
  maximumLength?: number | null;
  format?: string | null;
  isSecret?: boolean | null;
}

interface SettingDefinitionResponse {
  "@odata.type"?: string;
  id: string;
  displayName: string;
  description?: string | null;
  baseUri: string;
  offsetUri: string;
  categoryId: string;
  options?: SettingDefinitionOption[];
  defaultOptionId?: string | null;
  valueDefinition?: SettingValueDefinition | null;
  childIds?: string[] | null;
  minimumCount?: number | null;
  maximumCount?: number | null;
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
  /** Everything the definition says about what the setting can hold — see SettingSchema. */
  schema: SettingSchema;
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
    schema: toSchema(definition),
  };

  cache.set(settingDefinitionId, resolved);
  return resolved;
}

/**
 * Graph names the definition's shape in its @odata.type. Collection
 * variants are checked first — their names contain the plain variant's.
 * A definition with no @odata.type at all still counts as a choice if it
 * lists options; anything else is left "unknown" and the value's own
 * instance type decides how it's read.
 */
function kindOf(definition: SettingDefinitionResponse): SettingKind {
  const type = definition["@odata.type"] ?? "";
  if (type.endsWith("ChoiceSettingCollectionDefinition")) return "choiceCollection";
  if (type.endsWith("ChoiceSettingDefinition")) return "choice";
  if (type.endsWith("SimpleSettingCollectionDefinition")) return "simpleCollection";
  if (type.endsWith("SimpleSettingDefinition")) return "simple";
  if (type.endsWith("SettingGroupCollectionDefinition")) return "groupCollection";
  if (type.endsWith("SettingGroupDefinition")) return "group";
  if (definition.options?.length) return "choice";
  return "unknown";
}

/** Graph sends explicit nulls for most unset fields — only real values make it into the schema. */
function toSchema(definition: SettingDefinitionResponse): SettingSchema {
  const value = definition.valueDefinition ?? undefined;
  const valueType = value?.["@odata.type"]?.includes("Integer")
    ? ("integer" as const)
    : value?.["@odata.type"]?.includes("String")
      ? ("string" as const)
      : undefined;
  const num = (n: number | null | undefined) => (typeof n === "number" ? n : undefined);

  const schema: SettingSchema = {
    definitionId: definition.id,
    name: definition.displayName,
    kind: kindOf(definition),
  };
  if (definition.description) schema.description = definition.description;
  if (definition.options?.length) {
    schema.options = definition.options.map((o) => {
      const childIds = (o.dependedOnBy ?? []).map((d) => d.dependedOnBy).filter(Boolean);
      return {
        id: o.itemId,
        label: o.displayName,
        ...(o.description ? { description: o.description } : {}),
        ...(childIds.length ? { childIds } : {}),
      };
    });
  }
  if (definition.defaultOptionId) schema.defaultOptionId = definition.defaultOptionId;
  if (valueType) schema.valueType = valueType;
  if (valueType === "integer") {
    const min = num(value?.minimumValue);
    const max = num(value?.maximumValue);
    if (min !== undefined) schema.min = min;
    if (max !== undefined) schema.max = max;
  }
  if (valueType === "string") {
    const minLength = num(value?.minimumLength);
    const maxLength = num(value?.maximumLength);
    if (minLength !== undefined) schema.minLength = minLength;
    if (maxLength !== undefined) schema.maxLength = maxLength;
    if (value?.format) schema.format = value.format;
    if (value?.isSecret) schema.isSecret = true;
  }
  if (definition.childIds?.length) schema.childIds = definition.childIds;
  const minCount = num(definition.minimumCount);
  const maxCount = num(definition.maximumCount);
  if (minCount !== undefined) schema.minCount = minCount;
  if (maxCount !== undefined) schema.maxCount = maxCount;
  return schema;
}
