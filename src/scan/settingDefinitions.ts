import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet } from "../graph.js";
import { graphDefinitionId, inComplianceCatalog, toComplianceCatalogId } from "./complianceCatalog.js";
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
 * Remembered in memory and, where a store is set, on disk: many policies
 * reuse the same settingDefinitionId, and this is the highest-volume call
 * in a scan.
 */
const cache = new Map<string, { at: number; value: Promise<ResolvedDefinition> }>();
const categoryCache = new Map<string, { at: number; value: Promise<string> }>();

/**
 * Somewhere to keep what Graph said about a definition or a category
 * between runs — a first scan against a large baseline otherwise asks
 * for ~1,500 of them one by one, slowly enough to be throttled, every
 * time the process starts. What's kept is Intune's own catalog, the same
 * for every tenant; nothing a tenant configured. Graph's answer is kept
 * as it came, so a change to how it's read here needs no new fetch.
 */
export interface DefinitionStore {
  /** The kept answer for `key`, unless there is none or it's older than `maxAgeMs`. */
  get(key: string, maxAgeMs: number): string | undefined;
  set(key: string, json: string): void;
}

let store: DefinitionStore | undefined;

/**
 * Definitions Graph handed over alongside something else — a policy's
 * settings come with theirs when asked (see configurationPolicies.ts) —
 * so they needn't be asked for one by one. Kept for the life of the
 * process and passed on to the store.
 */
const primed = new Map<string, SettingDefinitionResponse>();

export function primeDefinitions(catalog: "configurationSettings" | "complianceSettings", definitions: unknown[]): void {
  for (const candidate of definitions) {
    const definition = candidate as Partial<SettingDefinitionResponse> | null;
    // Only what a lookup would have returned: anything less is left to be asked for properly.
    if (!definition || typeof definition.id !== "string" || typeof definition.categoryId !== "string" || typeof definition.baseUri !== "string") continue;
    const key = `${catalog}/${definition.id}`;
    primed.set(key, definition as SettingDefinitionResponse);
    // The same definition arrives with every policy that uses it — written once a day is plenty.
    let fresh = false;
    try {
      fresh = store?.get(key, KEEP_MISSING_MS) !== undefined && store.get(key, KEEP_MISSING_MS) !== JSON.stringify(MISSING);
    } catch {
      fresh = false;
    }
    if (!fresh) keep(key, definition);
  }
}

export function useDefinitionStore(next: DefinitionStore | undefined): void {
  store = next;
  primed.clear();
  cache.clear();
  categoryCache.clear();
}

// Microsoft does rename settings and add options, so nothing is trusted
// forever — in memory or on disk. An id Graph had nothing for is asked
// about again sooner: new settings do appear.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_MISSING_MS = 24 * 60 * 60 * 1000;
const MISSING = "missing";

/** Graph has nothing usable for this id — remembered from an earlier 400/404 rather than asked again. */
class KnownMissing extends Error {}

function kept(key: string): unknown {
  let json: string | undefined;
  try {
    json = store?.get(key, KEEP_MS);
    if (json === undefined) return undefined;
    return JSON.parse(json);
  } catch {
    // An unreadable store or entry is the same as none: ask Graph.
    return undefined;
  }
}

function keep(key: string, value: unknown): void {
  try {
    store?.set(key, JSON.stringify(value));
  } catch {
    // Not being able to remember must never fail a scan.
  }
}

/**
 * One lookup per id, however many callers want it at the same moment —
 * a scan resolves everything at once, and hundreds of settings share a
 * definition or a category. A failed lookup is forgotten so it can be
 * tried again.
 */
function once<T>(memory: Map<string, { at: number; value: Promise<T> }>, id: string, load: () => Promise<T>): Promise<T> {
  const held = memory.get(id);
  if (held && Date.now() - held.at < KEEP_MS) return held.value;
  const value = load();
  memory.set(id, { at: Date.now(), value });
  value.catch(() => {
    if (memory.get(id)?.value === value) memory.delete(id);
  });
  return value;
}

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
function resolveCategoryName(token: string, categoryId: string): Promise<string> {
  return once(categoryCache, categoryId, async () => {
    const key = `category/${categoryId}`;
    let category = kept(key) as CategoryResponse | undefined;
    if (!category) {
      category = await graphGet<CategoryResponse>(token, `/deviceManagement/configurationCategories/${categoryId}`, GRAPH_BETA_BASE);
      keep(key, category);
    }
    return category.displayName || category.description || categoryId;
  });
}

export function resolveSettingDefinition(token: string, settingDefinitionId: string): Promise<ResolvedDefinition> {
  return once(cache, settingDefinitionId, async () => {
    // A compliance catalog setting (see complianceCatalog.ts) is asked for in its own catalog, by Graph's
    // own id, and comes back with every id it mentions marked the same way. Categories are shared.
    const compliance = inComplianceCatalog(settingDefinitionId);
    const catalog = compliance ? "complianceSettings" : "configurationSettings";
    const graphId = graphDefinitionId(settingDefinitionId);
    const key = `${catalog}/${graphId}`;

    let definition = primed.get(key) ?? (kept(key) as SettingDefinitionResponse | typeof MISSING | undefined);
    if (definition === MISSING) {
      // Remembered for a shorter time than a real answer.
      if (store?.get(key, KEEP_MISSING_MS) !== undefined) throw new KnownMissing(`No definition for ${settingDefinitionId}`);
      definition = undefined;
    }
    if (!definition) {
      try {
        definition = await graphGet<SettingDefinitionResponse>(token, definitionPath(graphId, catalog), GRAPH_BETA_BASE);
      } catch (err) {
        if (isUnresolvable(err)) keep(key, MISSING);
        throw err;
      }
      keep(key, definition);
    }
    const schema = compliance ? asComplianceSchema(toSchema(definition)) : toSchema(definition);

    return {
      name: definition.displayName,
      cspPath: `${definition.baseUri}${definition.offsetUri}`,
      category: await resolveCategoryName(token, definition.categoryId),
      ...(definition.options ? { options: new Map(definition.options.map((o) => [o.itemId, o.displayName])) } : {}),
      schema,
    };
  });
}

/**
 * The Graph path for one setting definition. Most ids are plain
 * `lower_case_words` and go in as a path segment, the way they always
 * have. Not all, though: macOS preference-domain ids embed an app's file
 * name — spaces, parentheses and all (seen live:
 * "..._applications_microsoft teams (work or school).app"). As a path
 * segment those get "400 Bad Request - Error in query syntax" however
 * they're percent-encoded (confirmed live); what Graph accepts is OData
 * key syntax, `configurationSettings('<id>')`, with the id
 * percent-encoded and any single quote in it doubled.
 */
export function definitionPath(id: string, catalog: "configurationSettings" | "complianceSettings" = "configurationSettings"): string {
  const base = `/deviceManagement/${catalog}`;
  if (/^[A-Za-z0-9._~{}-]+$/.test(id)) return `${base}/${id}`;
  // encodeURIComponent leaves ( ) ' ! * alone; inside a quoted key they must not be left for Graph to interpret.
  const encoded = encodeURIComponent(id.replace(/'/g, "''")).replace(/[()'!*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${base}('${encoded}')`;
}

/**
 * Whether a failed definition lookup means "Graph has nothing usable for
 * this id" (it answered 400 or 404) rather than something being wrong
 * with the scan itself (throttling, auth, an outage).
 */
function isUnresolvable(err: unknown): boolean {
  return err instanceof KnownMissing || (err instanceof Error && /failed: (400|404)\b/.test(err.message));
}

/**
 * For a setting a policy actually sets: its definition, or — when Graph
 * has nothing usable for the id — a stand-in that names it by the id
 * itself. One setting showing up by its raw id is a blemish; the whole
 * scan failing over it loses everything else in the tenant too.
 */
export async function resolveSettingDefinitionOrStandIn(token: string, settingDefinitionId: string): Promise<ResolvedDefinition> {
  try {
    return await resolveSettingDefinition(token, settingDefinitionId);
  } catch (err) {
    if (!isUnresolvable(err)) throw err;
    return {
      name: settingDefinitionId,
      cspPath: "",
      category: "Unknown",
      schema: { definitionId: settingDefinitionId, name: settingDefinitionId, kind: "unknown" },
    };
  }
}

/**
 * Graph names the definition's shape in its @odata.type. Collection
 * variants are checked first — their names contain the plain variant's.
 * A definition with no @odata.type at all still counts as a choice if it
 * lists options; anything else is left "unknown" and the value's own
 * instance type decides how it's read.
 */
function asComplianceSchema(schema: SettingSchema): SettingSchema {
  return {
    ...schema,
    definitionId: toComplianceCatalogId(schema.definitionId),
    ...(schema.childIds ? { childIds: schema.childIds.map(toComplianceCatalogId) } : {}),
    ...(schema.options
      ? { options: schema.options.map((o) => (o.childIds ? { ...o, childIds: o.childIds.map(toComplianceCatalogId) } : o)) }
      : {}),
  };
}

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
 * A declared id Graph has nothing usable for is skipped: confirmed live
 * that definitions do name children that 404 (66 of 701 declared ids in
 * one tenant, e.g. most of DMClient's "Provider ID" group), and that an
 * id can make Graph answer 400 outright. The setting just can't offer
 * that one sub-setting. Any other failure still fails the scan —
 * silently dropping definitions over a throttling or auth error would
 * look exactly the same and be wrong.
 */
export async function resolveDeclaredSchemas(token: string, schemas: Record<string, SettingSchema>): Promise<void> {
  let pending = declaredIds(Object.values(schemas)).filter((id) => !(id in schemas));
  while (pending.length > 0) {
    const resolved = await Promise.all(
      pending.map(async (id) => {
        try {
          return (await resolveSettingDefinition(token, id)).schema;
        } catch (err) {
          if (isUnresolvable(err)) return undefined;
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
        if (!isUnresolvable(err)) throw err;
      }
    }),
  );
  await resolveDeclaredSchemas(token, schemas);
  return { schemas, info };
}
