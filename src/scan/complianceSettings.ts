import { COMPLIANCE_ENUMS, COMPLIANCE_TYPES, type CompliancePropertyType } from "./complianceSchema.generated.js";
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
 * Not read: properties holding nested objects (restricted app lists, OS
 * build ranges, custom compliance scripts, WSL distributions) and the
 * actions for noncompliance. They aren't single values.
 */

const PREFIX = "compliance.";

/** Whether a setting definition id is a compliance policy property (as opposed to a Settings Catalog definition). */
export function isComplianceDefinition(definitionId: string | undefined): boolean {
  return Boolean(definitionId?.startsWith(PREFIX));
}

/** "#microsoft.graph.windows10CompliancePolicy" -> "windows10"; undefined for anything that isn't a compliance policy type. */
export function complianceTypeOf(odataType: unknown): string | undefined {
  return typeof odataType === "string" ? /^#microsoft\.graph\.(\w+)CompliancePolicy$/.exec(odataType)?.[1] : undefined;
}

/** Everything on the Graph resource that describes the policy rather than configuring a device. */
const NOT_SETTINGS = new Set(["id", "displayName", "description", "createdDateTime", "lastModifiedDateTime", "roleScopeTagIds", "version", "assignments", "scheduledActionsForRule", "conditionStatementId"]);

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
  if (/threatProtection|defender|antivirus|antiSpyware|^rtp|signature|firewall|gatekeeper/i.test(property)) return "Threat protection";
  if (/^workProfile|password|passcode/i.test(property)) return "Password";
  if (/version|patchLevel|^os[A-Z]|pendingSystemUpdates/i.test(property)) return "Operating system";
  return "Device health";
}

function typeOf(type: string, property: string, value: unknown): CompliancePropertyType | undefined {
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
 * What a property can be set to, in the terms the editor understands:
 * a switch is a choice between "Not configured" and requiring/blocking
 * (which word depends on what the property does), an enum a choice among
 * its members, the rest a number or text.
 */
function schemaOf(type: string, property: string, kind: CompliancePropertyType): SettingSchema {
  const definitionId = complianceDefinitionId(type, property);
  const base = { definitionId, name: humanize(property) };
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

/**
 * Graph reports every property on every policy; most hold "nothing set":
 * null, false, an empty string, or an enum's first member (deviceDefault,
 * none, unavailable, notConfigured — and deviceThreatProtectionLevel's
 * explicit notSet). Those are what Intune's portal shows as "Not
 * configured", and they are left out, so a policy contributes only what
 * it actually demands.
 */
function isConfigured(kind: CompliancePropertyType, value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") return false;
  if (typeof kind === "object") return value !== "notSet" && value !== COMPLIANCE_ENUMS[kind.enum]?.[0];
  return true;
}

function nodeOf(schema: SettingSchema, value: unknown): SettingValueNode {
  const { definitionId, name } = schema;
  if (schema.kind === "choice") {
    const optionId = `${definitionId}_${String(value)}`;
    // An enum member newer than the generated table still shows, by its own spelling.
    return { kind: "choice", definitionId, name, optionId, label: schema.options?.find((o) => o.id === optionId)?.label ?? humanize(String(value)) };
  }
  return { kind: "simple", definitionId, name, value: typeof value === "number" ? value : String(value) };
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
  for (const [property, value] of Object.entries(policy)) {
    if (NOT_SETTINGS.has(property) || property.includes("@")) continue;
    const kind = typeOf(type, property, value);
    if (!kind || !isConfigured(kind, value)) continue;
    const schema = schemaOf(type, property, kind);
    const structured = nodeOf(schema, value);
    settings.push({
      settingDefinitionId: schema.definitionId,
      name: schema.name,
      // Where the value lives in Graph — the closest thing a compliance setting has to a CSP path.
      cspPath: `${type}CompliancePolicy/${property}`,
      category: categoryOf(property),
      value: structured.kind === "choice" ? structured.label : String((structured as { value: unknown }).value),
      structured,
      schemas: { [schema.definitionId]: schema },
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
    for (const [property, kind] of Object.entries(properties)) {
      const schema = schemaOf(type, property, kind);
      known.schemas[schema.definitionId] = schema;
      known.info[schema.definitionId] = { cspPath: `${typeName}/${property}`, category: categoryOf(property) };
    }
  }
  return known;
}
