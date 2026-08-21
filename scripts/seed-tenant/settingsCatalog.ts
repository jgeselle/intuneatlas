// Settings Catalog schema knowledge lives here, isolated from the generic
// transport in client.ts — same split src/scan/ already makes between
// graph.ts (transport) and settingDefinitions.ts (schema). Kept minimal:
// enough to find real setting definitions and build valid instance
// payloads, not a full model of the catalog.
import { GRAPH_BETA_BASE, type SeedClient } from "./client.js";

const SIMPLE = "#microsoft.graph.deviceManagementConfigurationSimpleSettingDefinition";
const SIMPLE_COLLECTION = "#microsoft.graph.deviceManagementConfigurationSimpleSettingCollectionDefinition";
const CHOICE = "#microsoft.graph.deviceManagementConfigurationChoiceSettingDefinition";
const CHOICE_COLLECTION = "#microsoft.graph.deviceManagementConfigurationChoiceSettingCollectionDefinition";
// Confirmed against a real tenant's catalog — these are "SettingGroup",
// not "GroupSetting" (the word order doesn't match the *instance* types
// used when building a policy, e.g. deviceManagementConfiguration-
// GroupSettingCollectionInstance, which really is "GroupSetting"-first).
// Getting this backwards here made isGroup() match nothing.
const GROUP = "#microsoft.graph.deviceManagementConfigurationSettingGroupDefinition";
const GROUP_COLLECTION = "#microsoft.graph.deviceManagementConfigurationSettingGroupCollectionDefinition";

export interface SettingDefinition {
  id: string;
  displayName: string;
  "@odata.type": string;
  categoryId: string;
  rootDefinitionId?: string;
  baseUri: string;
  offsetUri: string;
  options?: Array<{ itemId: string; displayName: string }>;
  // Confirmed via Microsoft's schema doc: applicability.platform is a
  // free-form String (Graph's docs don't enumerate its exact flag-string
  // format, e.g. whether multi-platform settings are comma-joined) — used
  // only by the multiPlatform scenario's substring platform filter below.
  applicability?: { platform?: string; technologies?: string };
}

/**
 * Searches the live Settings Catalog by display name. Deliberately not
 * hardcoding settingDefinitionIds anywhere in this toolkit — this repo has
 * no way to confirm an id is current/correct without live tenant access,
 * so scenario builders look settings up by keyword at seed time instead.
 *
 * `contains()` filters on this Graph resource need the eventual-consistency
 * header, same as other Graph resources backed by an index that doesn't
 * guarantee immediate consistency.
 */
export async function findSettingDefinitions(client: SeedClient, keyword: string): Promise<SettingDefinition[]> {
  const escaped = keyword.replace(/'/g, "''");
  return client.getAll<SettingDefinition>(
    `/deviceManagement/configurationSettings?$filter=contains(displayName,'${escaped}')&$top=50`,
    GRAPH_BETA_BASE,
    { ConsistencyLevel: "eventual" },
  );
}

/** Every child setting definition nested under a group/group-collection definition. */
export async function findChildDefinitions(client: SeedClient, rootDefinitionId: string): Promise<SettingDefinition[]> {
  const escaped = rootDefinitionId.replace(/'/g, "''");
  return client.getAll<SettingDefinition>(
    `/deviceManagement/configurationSettings?$filter=rootDefinitionId eq '${escaped}'&$top=200`,
    GRAPH_BETA_BASE,
  );
}

export function isSimpleOrChoice(def: SettingDefinition): boolean {
  return [SIMPLE, SIMPLE_COLLECTION, CHOICE, CHOICE_COLLECTION].includes(def["@odata.type"]);
}

export function isGroup(def: SettingDefinition): boolean {
  return def["@odata.type"] === GROUP || def["@odata.type"] === GROUP_COLLECTION;
}

export function isChoice(def: SettingDefinition): boolean {
  return def["@odata.type"] === CHOICE || def["@odata.type"] === CHOICE_COLLECTION;
}

function matchesPlatform(def: SettingDefinition, platformToken: string): boolean {
  return (def.applicability?.platform ?? "").toLowerCase().includes(platformToken.toLowerCase());
}

/**
 * First simple or choice definition matching keyword, restricted to a
 * given platform. Required, not optional: a keyword like "Camera" matches
 * across every platform's catalog (Windows, iOS, macOS, ...), and a
 * platform-unfiltered lookup can silently hand back e.g. an Apple ADE
 * Setup Assistant setting for a policy declared `platforms: "windows10"`
 * — confirmed for real against the live catalog (`ade_setupassistant_
 * camerabutton` for keyword "Camera"), not just a theoretical risk.
 */
export async function findFirstSimpleOrChoice(
  client: SeedClient,
  keyword: string,
  platformToken: string,
): Promise<SettingDefinition> {
  const matches = await findSettingDefinitions(client, keyword);
  const match = matches.find((d) => isSimpleOrChoice(d) && matchesPlatform(d, platformToken));
  if (!match) {
    throw new Error(
      `No simple/choice setting definition found matching "${keyword}" applicable to platform "${platformToken}". ` +
        `Try a different keyword — run findSettingDefinitions() directly to see what's actually in this tenant's catalog.`,
    );
  }
  return match;
}

/** First group or group-collection definition matching keyword and platform, with its children resolved. */
export async function findFirstGroup(
  client: SeedClient,
  keyword: string,
  platformToken: string,
): Promise<{ definition: SettingDefinition; children: SettingDefinition[] }> {
  const matches = await findSettingDefinitions(client, keyword);
  const match = matches.find((d) => isGroup(d) && matchesPlatform(d, platformToken));
  if (!match) {
    throw new Error(
      `No group/group-collection setting definition found matching "${keyword}" applicable to platform "${platformToken}".`,
    );
  }
  const children = await findChildDefinitions(client, match.id);
  return { definition: match, children };
}

/** A simple string-valued setting instance, e.g. a free-text policy value. */
export function stringSettingInstance(definitionId: string, value: string) {
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
    settingDefinitionId: definitionId,
    simpleSettingValue: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationStringSettingValue",
      value,
    },
  };
}

/** A simple integer-valued setting instance. */
export function integerSettingInstance(definitionId: string, value: number) {
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
    settingDefinitionId: definitionId,
    simpleSettingValue: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue",
      value,
    },
  };
}

/** optionItemId is one of `definition.options[].itemId` — the opaque `{definitionId}_{index}` form. */
export function choiceSettingInstance(definitionId: string, optionItemId: string) {
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
    settingDefinitionId: definitionId,
    choiceSettingValue: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingValue",
      value: optionItemId,
      children: [] as unknown[],
    },
  };
}

/**
 * A group-collection instance, e.g. a compound/nested setting made of
 * several child settings under one instance. This is the shape finding #1
 * (`src/scan/configurationPolicies.ts`'s `extractValue()` falling back to
 * `"(group setting)"`) needs a real policy to exercise. Shape confirmed
 * against Microsoft's own schema doc (learn.microsoft.com, resource
 * deviceManagementConfigurationGroupSettingCollectionInstance):
 * groupSettingCollectionValue is an array of `{ children: [...] }`. Not
 * yet confirmed against a *live* tenant — a real create call may still
 * reject a specific child combination depending on that group's own
 * validation rules, which the schema doc doesn't fully capture.
 */
export function groupSettingCollectionInstance(definitionId: string, childInstances: unknown[]) {
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
    settingDefinitionId: definitionId,
    groupSettingCollectionValue: [{ children: childInstances }],
  };
}
