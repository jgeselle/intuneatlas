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
  defaultValue?: { value?: unknown } | null;
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
  const defaultValue = definition.defaultValue?.value;
  if (typeof defaultValue === "number" || (typeof defaultValue === "string" && defaultValue !== "")) schema.defaultValue = defaultValue;
  if (definition.childIds?.length) schema.childIds = definition.childIds;
  const minCount = num(definition.minimumCount);
  const maxCount = num(definition.maximumCount);
  if (minCount !== undefined) schema.minCount = minCount;
  if (maxCount !== undefined) schema.maxCount = maxCount;
  return schema;
}

/**
 * Fills `schemas` out to every sub-setting its definitions declare — a
 * choice option's dependents, a group's children — recursively, whether
 * or not any policy's value configures them. Without this an editor could
 * show what is set but never offer what could be added.
 *
 * A declared id Graph has no definition for is skipped: confirmed live
 * that definitions do name children that 404 (66 of 701 declared ids in
 * one tenant, e.g. most of DMClient's "Provider ID" group). The setting
 * just can't offer that one sub-setting. Any other failure still fails
 * the scan — silently dropping definitions over a throttling or auth
 * error would look exactly the same and be wrong.
 */
export async function resolveDeclaredSchemas(token: string, schemas: Record<string, SettingSchema>): Promise<void> {
  let pending = declaredIds(Object.values(schemas)).filter((id) => !(id in schemas));
  while (pending.length > 0) {
    const resolved = await Promise.all(
      pending.map(async (id) => {
        try {
          return (await resolveSettingDefinition(token, id)).schema;
        } catch (err) {
          if (err instanceof Error && /failed: 404\b/.test(err.message)) return undefined;
          throw err;
        }
      }),
    );
    const added = resolved.filter((schema): schema is SettingSchema => schema !== undefined);
    for (const schema of added) schemas[schema.definitionId] = schema;
    // Ids that failed stay out of `schemas`; only what was just added can declare anything new.
    const failed = new Set(pending.filter((_, i) => resolved[i] === undefined));
    pending = declaredIds(added).filter((id) => !(id in schemas) && !failed.has(id));
  }
}

function declaredIds(list: SettingSchema[]): string[] {
  const ids = new Set<string>();
  for (const schema of list) {
    for (const id of schema.childIds ?? []) ids.add(id);
    for (const option of schema.options ?? []) for (const id of option.childIds ?? []) ids.add(id);
  }
  return [...ids];
}

/**
 * Looks up definitions a baseline mentions that no policy in the tenant
 * uses — without them a "Missing" setting could only be shown by its raw
 * id. Returns their schemas (and their declared sub-settings') plus where
 * each lives. Ids Graph has no definition for are left out.
 */
export async function resolveBaselineDefinitions(
  token: string,
  definitionIds: string[],
): Promise<{ schemas: Record<string, SettingSchema>; info: Record<string, { cspPath: string; category: string }> }> {
  const schemas: Record<string, SettingSchema> = {};
  const info: Record<string, { cspPath: string; category: string }> = {};
  await Promise.all(
    Array.from(new Set(definitionIds)).map(async (id) => {
      try {
        const definition = await resolveSettingDefinition(token, id);
        schemas[id] = definition.schema;
        info[id] = { cspPath: definition.cspPath, category: definition.category };
      } catch (err) {
        if (!(err instanceof Error && /failed: 404\b/.test(err.message))) throw err;
      }
    }),
  );
  await resolveDeclaredSchemas(token, schemas);
  return { schemas, info };
}
