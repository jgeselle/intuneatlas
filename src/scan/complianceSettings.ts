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
 * (Linux compliance policies are a different kind altogether — see
 * complianceCatalog.ts. Their ids share the prefix below.)
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
 * Left out of an action's value: the notification template is a tenant's
 * own object — its id means nothing in a baseline or another tenant.
 */
const NOT_COMPARED = new Set(["notificationTemplateId"]);

/** Abbreviations a plain split on capitals would lower-case. */
const ABBREVIATIONS = new Set(["os", "tpm", "rtp", "usb", "dma"]);

/** "passwordMinimumLength" -> "Password minimum length". Intune's portal has its own wording for each; Graph doesn't publish it. */
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

/** Display grouping only, by what the property's name starts with or mentions. */
function categoryOf(property: string): string {
  if (property === ACTIONS) return "Actions for noncompliance";
  if (/threatProtection|defender|antivirus|antiSpyware|^rtp|signature|firewall|gatekeeper/i.test(property)) return "Threat protection";
  if (/^workProfile|password|passcode/i.test(property)) return "Password";
  if (/version|patchLevel|^os[A-Z]|operatingSystem|pendingSystemUpdates/i.test(property)) return "Operating system";
  return "Device health";
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
function fieldSchema(definitionId: string, property: string, kind: ComplianceFieldType): SettingSchema {
  const base = { definitionId, name: property === "actionType" ? "Action" : humanize(property) };
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
const fieldsOf = (objectName: string) => Object.entries(COMPLIANCE_OBJECTS[objectName] ?? {}).filter(([field]) => !NOT_COMPARED.has(field));

/**
 * The schema of a property and — for one holding objects — of each field
 * inside it, keyed by definition id. A field's id is its property's plus
 * the field name.
 */
function schemasOf(type: string, property: string, kind: CompliancePropertyType): Record<string, SettingSchema> {
  const definitionId = complianceDefinitionId(type, property);
  if (!isObject(kind)) return { [definitionId]: fieldSchema(definitionId, property, kind) };

  const fields = fieldsOf(kind.object).map(([field, fieldKind]) => fieldSchema(`${definitionId}.${field}`, field, fieldKind));
  return {
    [definitionId]: {
      definitionId,
      name: property === ACTIONS ? "Actions for noncompliance" : humanize(property),
      kind: kind.list ? "groupCollection" : "group",
      childIds: fields.map((field) => field.definitionId),
    },
    ...Object.fromEntries(fields.map((field) => [field.definitionId, field])),
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
  return (schemas[parentId].childIds ?? []).flatMap((childId) => {
    const held = object[childId.slice(parentId.length + 1)];
    return held === null || held === undefined || held === "" || typeof held === "object" ? [] : [fieldNode(schemas[childId], held)];
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
    const value = property === ACTIONS ? actionsOf(raw) : raw;
    const kind = typeOf(type, property, value);
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
      category: categoryOf(property),
      value: renderNode(structured),
      structured,
      schemas,
    });
  }
  return settings;
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
      known.info[complianceDefinitionId(type, property)] = { cspPath: `${typeName}/${property}`, category: categoryOf(property) };
    }
  }
  return known;
}
