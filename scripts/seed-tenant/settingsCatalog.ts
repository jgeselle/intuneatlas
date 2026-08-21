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
  // Both free-form Strings (Graph's docs don't enumerate their exact
  // flag-string format, e.g. how multi-value settings are joined —
  // confirmed comma-separated for platform, e.g. "iOS,macOS"). platform
  // is used by every scenario's platform filter; technologies by the
  // "usable with an mdm policy" filter below.
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

/**
 * Every descendant setting definition nested under a group/group-collection
 * definition — the whole subtree, not just direct children. Confirmed
 * against a live tenant: a top-level definition's own rootDefinitionId
 * equals its own id (see isTopLevel below), so it satisfies this same
 * filter and would otherwise come back as if it were its own child —
 * excluded here explicitly.
 */
export async function findChildDefinitions(client: SeedClient, rootDefinitionId: string): Promise<SettingDefinition[]> {
  const escaped = rootDefinitionId.replace(/'/g, "''");
  const results = await client.getAll<SettingDefinition>(
    `/deviceManagement/configurationSettings?$filter=rootDefinitionId eq '${escaped}'&$top=200`,
    GRAPH_BETA_BASE,
  );
  return results.filter((d) => d.id !== rootDefinitionId);
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
 * A policy's own `technologies` must match its settings' — confirmed for
 * real against a live tenant: an Edge setting needing "EdgeMAM" rejected
 * with "Setting with technology applicability EdgeMAM does not match
 * with the policy's technology applicability MDM", same for an iOS ADE
 * setting needing "enrollment". Every scenario defaults to "mdm" (most
 * Windows settings use it), but that's not universal — confirmed for
 * real that most of a live catalog's top-level iOS settings are
 * "enrollment"-only, and Android Enterprise settings are "android"-only.
 * Filtering by the actual required technology up front avoids picking a
 * setting the policy it's going into can never accept.
 */
function usableWithPolicyTechnology(def: SettingDefinition, technologyToken: string): boolean {
  return (def.applicability?.technologies ?? "").toLowerCase().includes(technologyToken.toLowerCase());
}

/**
 * True for a standalone, top-level setting definition — confirmed against
 * a live catalog that these self-reference (`rootDefinitionId === id`),
 * while a child setting's rootDefinitionId points at its parent instead.
 * Matters because a child setting can't be used alone: a real create call
 * against one rejects it with "Setting contains parent setting that are
 * not present in the policy" (confirmed for real, not theoretical) —
 * you'd have to also include its parent's instance in the same policy.
 */
function isTopLevel(def: SettingDefinition): boolean {
  return def.rootDefinitionId === def.id;
}

/**
 * First simple or choice definition matching keyword, restricted to a
 * given platform, and to top-level (parent-less) settings only. Platform
 * filtering is required, not optional: a keyword like "Camera" matches
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
  technologyToken = "mdm",
): Promise<SettingDefinition> {
  const matches = await findSettingDefinitions(client, keyword);
  const match = matches.find(
    (d) =>
      isSimpleOrChoice(d) &&
      matchesPlatform(d, platformToken) &&
      isTopLevel(d) &&
      usableWithPolicyTechnology(d, technologyToken),
  );
  if (!match) {
    throw new Error(
      `No top-level simple/choice setting definition found matching "${keyword}" applicable to platform ` +
        `"${platformToken}" and technology "${technologyToken}". Try a different keyword — run ` +
        `findSettingDefinitions() directly to see what's actually in this tenant's catalog.`,
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
  const match = matches.find((d) => isGroup(d) && matchesPlatform(d, platformToken) && usableWithPolicyTechnology(d, "mdm"));
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
/**
 * `children` here is the real mechanism for a *dependent* setting — a
 * child that only exists because this specific option was selected (e.g.
 * "Block Flash: Enabled" → dependent "Block Flash Action: ..."), distinct
 * from a group/group-collection's children. Confirmed against a live
 * tenant: the child is itself a full choiceSettingInstance with its own
 * settingDefinitionId whose rootDefinitionId points at the PARENT choice
 * definition, not a group definition.
 */
export function choiceSettingInstance(definitionId: string, optionItemId: string, children: unknown[] = []) {
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
    settingDefinitionId: definitionId,
    choiceSettingValue: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingValue",
      value: optionItemId,
      children,
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
