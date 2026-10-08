import { portalNameOf } from "./complianceNames.js";
import { COMPLIANCE_ENUMS, COMPLIANCE_OBJECTS, COMPLIANCE_TYPES, type ComplianceFieldType, type CompliancePropertyType } from "./complianceSchema.generated.js";
import { renderNode } from "./settingValue.js";
import type { RawSetting, SettingSchema, SettingValueNode } from "./types.js";

/**
 * Compliance policies as settings.
 *
 * A compliance policy is a typed Graph resource — one type per platform,
 * each with a fixed set of properties (`passwordMinimumLength`,
 * `bitLockerEnabled`, ...) — not a list of setting instances the way a
 * Settings Catalog policy is. Each property that is configured becomes
 * one setting here, in the same shape a catalog setting has, so the rest
 * of the tool (the index, baselines, the editor) treats both alike.
 *
 * What each property may hold comes from Graph's own metadata (see
 * complianceSchema.generated.ts), not from guesses. A property the
 * metadata doesn't list — Graph adds them over time — is still read,
 * with its type taken from the value it holds.
 *
 * Most properties hold one value. A few hold an object or a list of
 * them (restricted apps, valid OS build ranges, WSL distributions, a
 * custom compliance script); those become a group of sub-settings, or a
 * list of such groups, one sub-setting per field. The actions for
 * noncompliance, which hang off the policy rather than sitting on it,
 * are read the same way, as one setting listing each action.
 *
 * Two more things are compliance settings without being a typed
 * policy's property: the tenant-wide compliance settings (below), and
 * everything in a Linux compliance policy — a different kind altogether,
 * see complianceCatalog.ts. All share the prefix below.
 */

const PREFIX = "compliance.";

/** Whether a setting definition id belongs to a compliance policy — a typed policy's property, or a compliance catalog setting — rather than a configuration policy. */
export function isComplianceDefinition(definitionId: string | undefined): boolean {
  return Boolean(definitionId?.startsWith(PREFIX));
}

/** "#microsoft.graph.windows10CompliancePolicy" -> "windows10"; undefined for anything that isn't a compliance policy type. */
export function complianceTypeOf(odataType: unknown): string | undefined {
  const type = typeof odataType === "string" ? /^#microsoft\.graph\.(\w+)CompliancePolicy$/.exec(odataType)?.[1] : undefined;
  // "deviceManagementCompliancePolicy" is the other kind — Settings Catalog format, no properties to read (see complianceCatalog.ts).
  return type === "deviceManagement" ? undefined : type;
}

/** Everything on the Graph resource that describes the policy rather than configuring a device. */
const NOT_SETTINGS = new Set(["id", "displayName", "description", "createdDateTime", "lastModifiedDateTime", "roleScopeTagIds", "version", "assignments", "conditionStatementId"]);

/** The actions for noncompliance: not a property with a type of its own in the table, so described here. */
const ACTIONS = "scheduledActionsForRule";
const ACTIONS_TYPE = { object: "deviceComplianceActionItem", list: true } as const;
/**
 * Left out of a value: ids of a tenant's own objects — a notification
 * template, a compliance script — mean nothing in a baseline or another
 * tenant. Where the scan can read the object's name it shows that
 * instead (see the `…Name` fields below, filled in by the scan).
 */
const NOT_COMPARED = new Set(["notificationTemplateId", "deviceComplianceScriptId"]);

type Field = ComplianceFieldType | { list: Record<string, ComplianceFieldType> };

/**
 * Fields the metadata doesn't have: the names the scan looks up for the
 * ids above, and a custom compliance script's rules — which Graph holds
 * as one encoded JSON document (`rulesContent`) and are read out into a
 * list, one entry per rule (see withRules).
 */
const EXTRA_FIELDS: Record<string, Record<string, Field>> = {
  deviceComplianceActionItem: { notificationTemplateName: "string" },
  deviceCompliancePolicyScript: { scriptName: "string", rules: { list: { settingName: "string", operator: "string", dataType: "string", operand: "string" } } },
};
const isList = (field: Field): field is { list: Record<string, ComplianceFieldType> } => typeof field === "object" && "list" in field;

/** Abbreviations a plain split on capitals would lower-case. */
const ABBREVIATIONS = new Set(["os", "tpm", "rtp", "usb", "dma"]);

/**
 * "passwordMinimumLength" -> "Password minimum length": a readable name from an identifier. Used for
 * enum members, the fields inside a list setting, and any property the portal names table doesn't cover.
 */
export function humanize(identifier: string): string {
  return identifier
    .replace(/bitLocker/i, "Bitlocker")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (ABBREVIATIONS.has(lower)) return lower.toUpperCase();
      if (lower === "bitlocker") return "BitLocker";
      return i === 0 ? word[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/**
 * The section a setting is listed under: the portal's, where known (see
 * complianceNames.ts); otherwise the portal section its property name
 * suggests.
 */
function categoryOf(type: string, property: string): string {
  if (property === ACTIONS) return "Actions for noncompliance";
  const portal = portalNameOf(type, property);
  if (portal) return portal.section;
  if (/password|passcode|firewall|defender|antivirus|antiSpyware|^rtp|signature|gatekeeper|encryption/i.test(property)) return "System Security";
  if (/version|patchLevel|^os[A-Z]|operatingSystem|pendingSystemUpdates/i.test(property)) return "Device Properties";
  return "Device Health";
}

/** A property's own name: the portal's where known, otherwise derived from the property name. */
function nameOf(type: string, property: string): string {
  if (property === ACTIONS) return "Actions for noncompliance";
  return portalNameOf(type, property)?.name ?? humanize(property);
}

function typeOf(type: string, property: string, value: unknown): CompliancePropertyType | undefined {
  if (property === ACTIONS) return ACTIONS_TYPE;
  const declared = COMPLIANCE_TYPES[`${type}CompliancePolicy`]?.[property];
  if (declared) return declared;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "integer";
  if (typeof value === "string") return "string";
  return undefined;
}

export function complianceDefinitionId(type: string, property: string): string {
  return `${PREFIX}${type}.${property}`;
}

/**
 * What a single value can be set to, in the terms the editor understands:
 * a switch is a choice between "Not configured" and requiring/blocking
 * (which word depends on what the property does), an enum a choice among
 * its members, the rest a number or text.
 */
function fieldSchema(definitionId: string, property: string, kind: ComplianceFieldType, name = property === "actionType" ? "Action" : humanize(property)): SettingSchema {
  const base = { definitionId, name };
  if (kind === "boolean") {
    const on = /block|disable|prevent/i.test(property) ? "Block" : "Require";
    return {
      ...base,
      kind: "choice",
      defaultOptionId: `${definitionId}_false`,
      options: [
        { id: `${definitionId}_false`, label: "Not configured" },
        { id: `${definitionId}_true`, label: on },
      ],
    };
  }
  if (typeof kind === "object") {
    const members = COMPLIANCE_ENUMS[kind.enum] ?? [];
    return {
      ...base,
      kind: "choice",
      ...(members.length ? { defaultOptionId: `${definitionId}_${members[0]}` } : {}),
      options: members.map((member) => ({ id: `${definitionId}_${member}`, label: humanize(member) })),
    };
  }
  return { ...base, kind: "simple", valueType: kind };
}

const isObject = (kind: CompliancePropertyType): kind is { object: string; list: boolean } => typeof kind === "object" && "object" in kind;
const fieldsOf = (objectName: string): Array<[string, Field]> =>
  Object.entries<Field>({ ...COMPLIANCE_OBJECTS[objectName], ...EXTRA_FIELDS[objectName] }).filter(([field]) => !NOT_COMPARED.has(field));

/**
 * The schema of a property and — for one holding objects — of each field
 * inside it, keyed by definition id. A field's id is its property's plus
 * the field name.
 */
function schemasOf(type: string, property: string, kind: CompliancePropertyType): Record<string, SettingSchema> {
  const definitionId = complianceDefinitionId(type, property);
  if (!isObject(kind)) return { [definitionId]: fieldSchema(definitionId, property, kind, nameOf(type, property)) };

  const schemas: Record<string, SettingSchema> = {};
  const childIds: string[] = [];
  for (const [field, fieldKind] of fieldsOf(kind.object)) {
    const fieldId = `${definitionId}.${field}`;
    childIds.push(fieldId);
    if (!isList(fieldKind)) {
      schemas[fieldId] = fieldSchema(fieldId, field, fieldKind);
      continue;
    }
    const inner = Object.entries(fieldKind.list).map(([name, innerKind]) => fieldSchema(`${fieldId}.${name}`, name, innerKind));
    schemas[fieldId] = { definitionId: fieldId, name: humanize(field), kind: "groupCollection", childIds: inner.map((i) => i.definitionId) };
    for (const i of inner) schemas[i.definitionId] = i;
  }
  return {
    [definitionId]: { definitionId, name: nameOf(type, property), kind: kind.list ? "groupCollection" : "group", childIds },
    ...schemas,
  };
}

/**
 * Graph reports every property on every policy; most hold "nothing set":
 * null, false, an empty string or list, or an enum's first member
 * (deviceDefault, none, unavailable, notConfigured — and
 * deviceThreatProtectionLevel's explicit notSet). Those are what Intune's
 * portal shows as "Not configured", and they are left out, so a policy
 * contributes only what it actually demands.
 */
function isConfigured(kind: CompliancePropertyType, value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") return false;
  if (isObject(kind)) return true; // decided once its fields have been read — see nodeOf
  if (typeof kind === "object") return value !== "notSet" && value !== COMPLIANCE_ENUMS[kind.enum]?.[0];
  return true;
}

function fieldNode(schema: SettingSchema, value: unknown): SettingValueNode {
  const { definitionId, name } = schema;
  if (schema.kind === "choice") {
    const optionId = `${definitionId}_${String(value)}`;
    // An enum member newer than the generated table still shows, by its own spelling.
    return { kind: "choice", definitionId, name, optionId, label: schema.options?.find((o) => o.id === optionId)?.label ?? humanize(String(value)) };
  }
  return { kind: "simple", definitionId, name, value: typeof value === "number" ? value : String(value) };
}

/** One object as its fields that hold something, in the table's order. */
function objectNodes(schemas: Record<string, SettingSchema>, parentId: string, value: unknown): SettingValueNode[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const object = value as Record<string, unknown>;
  return (schemas[parentId].childIds ?? []).flatMap((childId): SettingValueNode[] => {
    const held = object[childId.slice(parentId.length + 1)];
    const schema = schemas[childId];
    if (schema.kind === "groupCollection") {
      const groups = (Array.isArray(held) ? held : []).map((item) => objectNodes(schemas, childId, item)).filter((group) => group.length > 0);
      return groups.length ? [{ kind: "groupCollection", definitionId: childId, name: schema.name, groups }] : [];
    }
    return held === null || held === undefined || held === "" || typeof held === "object" ? [] : [fieldNode(schema, held)];
  });
}

/**
 * The actions for noncompliance as Graph nests them — rules, each with
 * its action configurations — flattened to the actions themselves, in a
 * fixed order (soonest first) so two policies with the same actions read
 * the same. Undefined when the policy came without them (they are only
 * there when asked for).
 */
function actionsOf(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const configured = value.flatMap((rule) => (Array.isArray(rule?.scheduledActionConfigurations) ? rule.scheduledActionConfigurations : []));
  if (configured.length === 0) return undefined;
  return configured.sort(
    (a, b) => (Number(a?.gracePeriodHours) || 0) - (Number(b?.gracePeriodHours) || 0) || String(a?.actionType).localeCompare(String(b?.actionType)),
  );
}

/**
 * A custom compliance script's rules, read out of `rulesContent`: base64
 * of the JSON rules file the admin uploaded — `{ "Rules": [{ SettingName,
 * Operator, DataType, Operand, ... }] }`. Anything that doesn't decode to
 * that shape yields no rules rather than an error.
 */
function withRules(value: unknown): unknown {
  if (!value || typeof value !== "object" || typeof (value as { rulesContent?: unknown }).rulesContent !== "string") return value;
  let rules: unknown[] = [];
  try {
    const parsed = JSON.parse(Buffer.from((value as { rulesContent: string }).rulesContent, "base64").toString("utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
    const list = parsed.Rules ?? parsed.rules;
    if (Array.isArray(list)) rules = list;
  } catch {
    // not a rules document
  }
  const text = (v: unknown) => (v === null || v === undefined || typeof v === "object" ? undefined : String(v));
  return {
    ...value,
    rules: rules
      .filter((rule): rule is Record<string, unknown> => Boolean(rule) && typeof rule === "object")
      .map((rule) => ({ settingName: text(rule.SettingName), operator: text(rule.Operator), dataType: text(rule.DataType), operand: text(rule.Operand) })),
  };
}

/** The value as a node, or undefined when — an object or list with nothing in it — there is nothing configured after all. */
function nodeOf(schemas: Record<string, SettingSchema>, definitionId: string, kind: CompliancePropertyType, value: unknown): SettingValueNode | undefined {
  const schema = schemas[definitionId];
  if (!isObject(kind)) return fieldNode(schema, value);
  const { name } = schema;
  if (!kind.list) {
    const children = objectNodes(schemas, definitionId, value);
    return children.length ? { kind: "group", definitionId, name, children } : undefined;
  }
  const groups = (Array.isArray(value) ? value : []).map((item) => objectNodes(schemas, definitionId, item)).filter((group) => group.length > 0);
  return groups.length ? { kind: "groupCollection", definitionId, name, groups } : undefined;
}

/**
 * The configured settings of one compliance policy, given its Graph
 * resource — the same object a scan gets back and an export writes to
 * disk, which is why baselines go through this too.
 */
export function complianceSettingsOf(policy: Record<string, unknown>): RawSetting[] {
  const type = complianceTypeOf(policy["@odata.type"]);
  if (!type) return [];

  const settings: RawSetting[] = [];
  for (const [property, raw] of Object.entries(policy)) {
    if (NOT_SETTINGS.has(property) || property.includes("@")) continue;
    const kind = typeOf(type, property, property === ACTIONS ? actionsOf(raw) : raw);
    const value = property === ACTIONS ? actionsOf(raw) : kind && isObject(kind) && kind.object === "deviceCompliancePolicyScript" ? withRules(raw) : raw;
    if (!kind || !isConfigured(kind, value)) continue;
    const schemas = schemasOf(type, property, kind);
    const definitionId = complianceDefinitionId(type, property);
    const structured = nodeOf(schemas, definitionId, kind, value);
    if (!structured) continue;
    settings.push({
      settingDefinitionId: definitionId,
      name: schemas[definitionId].name,
      // Where the value lives in Graph — the closest thing a compliance setting has to a CSP path.
      cspPath: `${type}CompliancePolicy/${property}`,
      category: categoryOf(type, property),
      value: renderNode(structured),
      structured,
      schemas,
    });
  }
  return settings;
}

/**
 * The actions for noncompliance of a policy that isn't a typed one — a
 * Linux compliance policy keeps them the same way — as the same setting.
 * `platform` stands where a typed policy's type does.
 */
export function complianceActionsSetting(platform: string, scheduledActionsForRule: unknown): RawSetting | undefined {
  const value = actionsOf(scheduledActionsForRule);
  if (!value) return undefined;
  const definitionId = complianceDefinitionId(platform, ACTIONS);
  const schemas = schemasOf(platform, ACTIONS, ACTIONS_TYPE);
  const structured = nodeOf(schemas, definitionId, ACTIONS_TYPE, value);
  if (!structured) return undefined;
  return { settingDefinitionId: definitionId, name: schemas[definitionId].name, cspPath: `compliancePolicies/${ACTIONS}`, category: categoryOf(platform, ACTIONS), value: renderNode(structured), structured, schemas };
}

/**
 * The tenant-wide compliance settings ("Compliance policy settings" in
 * the portal, `deviceManagement/settings` in Graph — confirmed live).
 * They belong to no policy and no platform; they are listed as settings
 * of one stand-in policy that reaches everyone.
 *
 * Unlike a policy's properties these are always set one way or the
 * other — "devices without a compliance policy are compliant" is a
 * choice, and the one a baseline is most likely to object to — so both
 * switches always show. The validity period is left out while Graph
 * reports 0 for it, which is what a tenant that never set it has.
 */
const TENANT = "tenant";
export const TENANT_COMPLIANCE_PLATFORM = "allPlatforms";
const TENANT_SETTINGS: Array<{ property: string; schema: (id: string) => SettingSchema }> = [
  {
    property: "secureByDefault",
    schema: (id) => ({
      definitionId: id,
      name: "Mark devices with no compliance policy assigned as",
      kind: "choice",
      options: [
        { id: `${id}_false`, label: "Compliant" },
        { id: `${id}_true`, label: "Not compliant" },
      ],
    }),
  },
  {
    property: "enhancedJailBreak",
    schema: (id) => ({
      definitionId: id,
      name: "Enhanced jailbreak detection",
      kind: "choice",
      options: [
        { id: `${id}_false`, label: "Disabled" },
        { id: `${id}_true`, label: "Enabled" },
      ],
    }),
  },
  {
    property: "deviceComplianceCheckinThresholdDays",
    schema: (id) => ({ definitionId: id, name: "Compliance status validity period (days)", kind: "simple", valueType: "integer", min: 1, max: 120 }),
  },
];

export function tenantComplianceSettingsOf(settings: Record<string, unknown>): RawSetting[] {
  return TENANT_SETTINGS.flatMap(({ property, schema: schemaFor }): RawSetting[] => {
    const value = settings[property];
    const schema = schemaFor(complianceDefinitionId(TENANT, property));
    if (schema.kind === "choice" ? typeof value !== "boolean" : typeof value !== "number" || value === 0) return [];
    const structured = fieldNode(schema, value);
    return [
      {
        settingDefinitionId: schema.definitionId,
        name: schema.name,
        cspPath: `deviceManagement/settings/${property}`,
        category: "Compliance policy settings",
        value: renderNode(structured),
        structured,
        schemas: { [schema.definitionId]: schema },
      },
    ];
  });
}

let known: { schemas: Record<string, SettingSchema>; info: Record<string, { cspPath: string; category: string }> } | undefined;

/**
 * Every compliance setting Graph defines, whether or not any policy in
 * the tenant uses it — so a baseline's setting that the tenant lacks
 * still has a name, a place in the list and readable values. Catalog
 * settings need a Graph lookup for this; these are known up front.
 */
export function complianceDefinitions(): { schemas: Record<string, SettingSchema>; info: Record<string, { cspPath: string; category: string }> } {
  if (known) return known;
  known = { schemas: {}, info: {} };
  for (const [typeName, properties] of Object.entries(COMPLIANCE_TYPES)) {
    const type = typeName.replace(/CompliancePolicy$/, "");
    for (const [property, kind] of [...Object.entries(properties), [ACTIONS, ACTIONS_TYPE] as const]) {
      Object.assign(known.schemas, schemasOf(type, property, kind));
      known.info[complianceDefinitionId(type, property)] = { cspPath: `${typeName}/${property}`, category: categoryOf(type, property) };
    }
  }
  Object.assign(known.schemas, schemasOf("linux", ACTIONS, ACTIONS_TYPE));
  known.info[complianceDefinitionId("linux", ACTIONS)] = { cspPath: `compliancePolicies/${ACTIONS}`, category: categoryOf("linux", ACTIONS) };
  for (const { property, schema } of TENANT_SETTINGS) {
    const id = complianceDefinitionId(TENANT, property);
    known.schemas[id] = schema(id);
    known.info[id] = { cspPath: `deviceManagement/settings/${property}`, category: "Compliance policy settings" };
  }
  return known;
}
