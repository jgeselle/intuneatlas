import { GRAPH_BETA_BASE } from "../config.js";
import { graphGet, graphGetAll } from "../graph.js";
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
 * Where a setting's human name, CSP/OMA-URI path, options and shape come
 * from: Intune's own catalog, the same for every tenant. This is the one
 * part of the codebase with no v1.0 equivalent —
 * deviceManagementConfigurationSettingDefinition is beta-only. Isolated
 * here so a future breaking change is a single-file fix.
 *
 * The catalog is fetched whole, never a definition at a time. Confirmed
 * live: listing configurationSettings with no paging options answers
 * with every definition at once (18,402 of them, 55 MB, about fifteen
 * seconds), each identical to what a lookup by id returns; the Linux
 * compliance catalog (21) and both lists of categories come the same
 * way. Asking per definition instead — which this file once did — meant
 * ~1,750 requests for a baseline of ~800 settings, and a scan throttled
 * by Graph before it finished. Other tools that compare a tenant with a
 * baseline fetch the catalog whole for the same reason.
 *
 * A definition the catalog doesn't hold is one Intune has nothing usable
 * for (baselines do name such ids), or one newer than the kept copy.
 * The second kind still resolves for anything a policy sets, because a
 * policy's settings arrive with their definitions (see primeDefinitions).
 */

/**
 * Somewhere to keep the catalog between runs, so it's fetched once a
 * week rather than every time the process starts. Nothing a tenant
 * configured is ever kept here.
 */
export interface DefinitionStore {
  /** The kept answer for `key`, unless there is none or it's older than `maxAgeMs`. */
  get(key: string, maxAgeMs: number): string | undefined;
  set(key: string, json: string): void;
  /** Many at once — the whole catalog is some 19,000 entries. */
  setMany(entries: Array<[key: string, json: string]>): void;
}

// Microsoft does rename settings and add options, so a kept catalog is replaced after a week.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const CATALOG_KEY = "catalog";
const CATALOG_TIMEOUT_MS = 5 * 60_000;

let store: DefinitionStore | undefined;
/** The catalog itself when there's no store to keep it in — a one-off run, or a test. */
let inMemory: Map<string, string> | undefined;
/** When the catalog this process works from was last known good, and the load in progress if there is one. */
let readyAt = 0;
let loading: Promise<void> | undefined;

const resolved = new Map<string, ResolvedDefinition>();
/** Definitions Graph handed over alongside a policy's settings — see primeDefinitions. */
const primed = new Map<string, SettingDefinitionResponse>();

export function useDefinitionStore(next: DefinitionStore | undefined): void {
  store = next;
  inMemory = undefined;
  readyAt = 0;
  loading = undefined;
  resolved.clear();
  primed.clear();
}

const KEPT_FIELDS = [
  "@odata.type",
  "id",
  "displayName",
  "description",
  "baseUri",
  "offsetUri",
  "categoryId",
  "options",
  "defaultOptionId",
  "valueDefinition",
  "defaultValue",
  "childIds",
  "minimumCount",
  "maximumCount",
] as const;

/** Only the fields read here are kept — about a third less than Graph sends. */
function slim(definition: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const field of KEPT_FIELDS) if (definition[field] !== undefined && definition[field] !== null) kept[field] = definition[field];
  if (Array.isArray(kept.options)) {
    kept.options = (kept.options as Array<Record<string, unknown>>).map((o) => ({
      itemId: o.itemId,
      displayName: o.displayName,
      ...(o.description ? { description: o.description } : {}),
      ...(Array.isArray(o.dependedOnBy) && o.dependedOnBy.length ? { dependedOnBy: o.dependedOnBy } : {}),
    }));
  }
  return kept;
}

function read(key: string): unknown {
  try {
    const json = inMemory ? inMemory.get(key) : store?.get(key, Infinity);
    return json === undefined ? undefined : JSON.parse(json);
  } catch {
    return undefined;
  }
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0] : String(err));

async function download(token: string): Promise<Array<[string, string]>> {
  const list = (path: string) => graphGetAll<Record<string, unknown>>(token, `/deviceManagement/${path}`, GRAPH_BETA_BASE, CATALOG_TIMEOUT_MS);
  const [settings, compliance, categories, complianceCategories] = await Promise.all([
    list("configurationSettings"),
    list("complianceSettings"),
    list("configurationCategories"),
    list("complianceCategories"),
  ]);

  const entries: Array<[string, string]> = [];
  const wanted = new Set<string>();
  for (const [catalog, definitions] of [["configurationSettings", settings], ["complianceSettings", compliance]] as const) {
    for (const d of definitions) {
      if (typeof d.id !== "string") continue;
      entries.push([`${catalog}/${d.id}`, JSON.stringify(slim(d))]);
      if (typeof d.categoryId === "string") wanted.add(d.categoryId);
    }
  }

  // Confirmed live: displayName is the populated field (`name` is null), and every ADMX-derived
  // category has an empty displayName but a useful description ("Administrative Templates").
  const names = new Map<string, string>();
  for (const c of [...categories, ...complianceCategories]) {
    const name = c.displayName || c.description;
    if (typeof c.id === "string" && typeof name === "string" && name) names.set(c.id, name);
  }
  // The lists leave some categories out (confirmed live: 26, behind 244 definitions — Apple
  // enrolment, quiet time). Those few are asked for by id, here, once, as part of the catalog.
  await Promise.all(
    [...wanted]
      .filter((id) => !names.has(id))
      .map(async (id) => {
        try {
          const c = await graphGet<CategoryResponse>(token, `/deviceManagement/configurationCategories/${id}`, GRAPH_BETA_BASE);
          const name = c.displayName || c.description;
          if (name) names.set(id, name);
        } catch (err) {
          // A category Graph has nothing for is shown by its id; anything else is the catalog failing.
          if (!/failed: (400|404)\b/.test(firstLine(err))) throw err;
        }
      }),
  );
  for (const [id, name] of names) entries.push([`category/${id}`, JSON.stringify(name)]);
  entries.push([CATALOG_KEY, JSON.stringify({ definitions: settings.length + compliance.length, categories: names.size })]);
  return entries;
}

/**
 * Makes sure there is a catalog to read from, fetching it when there is
 * none or the kept one is over a week old. Without a catalog a scan
 * can't name a single setting, so failing to get one fails the scan and
 * says why — unless an older copy is at hand, which is then used as is.
 */
export function loadCatalog(token: string, say: (message: string) => void = () => {}): Promise<void> {
  if (Date.now() - readyAt < KEEP_MS) return Promise.resolve();
  loading ??= (async () => {
    try {
      let kept = false;
      try {
        if (store?.get(CATALOG_KEY, KEEP_MS) !== undefined) kept = true;
      } catch {
        kept = false;
      }
      if (!kept) {
        say("Fetching Intune's settings catalog …");
        try {
          const entries = await download(token);
          resolved.clear();
          let saved = false;
          try {
            store?.setMany(entries);
            saved = store !== undefined;
          } catch (err) {
            say(`Couldn't save the settings catalog (${firstLine(err)}); it will be fetched again next time.`);
          }
          inMemory = saved ? undefined : new Map(entries);
        } catch (err) {
          let older = false;
          try {
            older = store?.get(CATALOG_KEY, Infinity) !== undefined;
          } catch {
            older = false;
          }
          if (!older) {
            throw new Error(
              `Couldn't download Intune's settings catalog from Microsoft Graph, and a scan can't name settings without it. Nothing in the tenant was changed — try again in a minute.\n${firstLine(err)}`,
              { cause: err },
            );
          }
          say(`Couldn't refresh the settings catalog (${firstLine(err)}); using the copy from an earlier scan.`);
        }
      }
      readyAt = Date.now();
    } finally {
      loading = undefined;
    }
  })();
  return loading;
}

/**
 * A policy's settings arrive with their definitions when asked (see
 * configurationPolicies.ts) — which is how a setting newer than the kept
 * catalog still gets its name. Anything the catalog didn't have is added
 * to it.
 */
export function primeDefinitions(catalog: "configurationSettings" | "complianceSettings", definitions: unknown[]): void {
  for (const candidate of definitions) {
    const definition = candidate as Partial<SettingDefinitionResponse> | null;
    if (!definition || typeof definition.id !== "string" || typeof definition.categoryId !== "string" || typeof definition.baseUri !== "string") continue;
    const key = `${catalog}/${definition.id}`;
    if (primed.has(key)) continue;
    primed.set(key, definition as SettingDefinitionResponse);
    try {
      if (store && !inMemory && store.get(key, Infinity) === undefined) store.set(key, JSON.stringify(slim(definition as Record<string, unknown>)));
    } catch {
      // Not being able to keep it must never fail a scan.
    }
  }
}

/** The catalog has no such definition. */
class NotInCatalog extends Error {}

export async function resolveSettingDefinition(token: string, settingDefinitionId: string): Promise<ResolvedDefinition> {
  await loadCatalog(token);
  const known = resolved.get(settingDefinitionId);
  if (known) return known;

  // A compliance catalog setting (see complianceCatalog.ts) lives in its own catalog, under Graph's
  // own id, and has every id it mentions marked the same way. Categories are shared.
  const compliance = inComplianceCatalog(settingDefinitionId);
  const key = `${compliance ? "complianceSettings" : "configurationSettings"}/${graphDefinitionId(settingDefinitionId)}`;
  const definition = (read(key) as SettingDefinitionResponse | undefined) ?? primed.get(key);
  if (!definition) throw new NotInCatalog(`Intune's settings catalog has no definition for ${settingDefinitionId}`);

  const schema = compliance ? asComplianceSchema(toSchema(definition)) : toSchema(definition);
  const category = read(`category/${definition.categoryId}`);
  const result: ResolvedDefinition = {
    name: definition.displayName,
    cspPath: `${definition.baseUri}${definition.offsetUri}`,
    // Never a blank string: a category with no name is shown by its id.
    category: typeof category === "string" && category ? category : definition.categoryId,
    ...(definition.options ? { options: new Map(definition.options.map((o) => [o.itemId, o.displayName])) } : {}),
    schema,
  };
  resolved.set(settingDefinitionId, result);
  return result;
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

/** The catalog has nothing for this id — as opposed to the catalog itself being out of reach. */
function isUnresolvable(err: unknown): boolean {
  return err instanceof NotInCatalog;
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
 * A declared id the catalog has nothing for is skipped: confirmed live
 * that definitions do name children that don't exist (66 of 701 declared
 * ids in one tenant, e.g. most of DMClient's "Provider ID" group). The
 * setting just can't offer that one sub-setting. The catalog itself being
 * out of reach still fails the scan.
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
