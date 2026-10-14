import { X509Certificate } from "node:crypto";
import { graphGetAll } from "../graph.js";
import { mapAssignmentTargets } from "./assignments.js";
import { resolveSettingDefinition } from "./settingDefinitions.js";
import type { RawPolicy, RawSetting } from "./types.js";

/**
 * Scans the legacy `deviceConfigurations` endpoint — template-based profiles
 * created before the Settings Catalog existed (Device Restrictions, Endpoint
 * Protection, and friends). Plenty of tenants still run these alongside
 * Settings Catalog policies, and both can write the same underlying CSP —
 * without this, that's a real device-level conflict the tool structurally
 * couldn't see.
 *
 * Scope, deliberately narrow rather than guessed: only
 * `windows10GeneralConfiguration` (Device Restrictions), and only the five
 * properties below. Each was verified against a live tenant's real Settings
 * Catalog — the CSP each one corresponds to, confirmed by searching the
 * live catalog for the matching top-level choice setting, not assumed from
 * memory or Microsoft's docs alone. Everything else on this profile type
 * (and every other legacy profile type — Endpoint Protection, VPN, Wi-Fi,
 * ...) isn't mapped yet and won't show up in the merge; extend MAPPINGS the
 * same way — search the live catalog, confirm the exact option text, don't
 * guess a settingDefinitionId.
 */
export interface LegacyMapping {
  /** Property name on the windows10GeneralConfiguration Graph resource. */
  property: string;
  /** Confirmed live against a real tenant's Settings Catalog. */
  settingDefinitionId: string;
  /** Matches the resolved definition's real option display text — confirmed live, not guessed. */
  blockedOptionText: (text: string) => boolean;
  allowedOptionText: (text: string) => boolean;
}

export const LEGACY_MAPPINGS: LegacyMapping[] = [
  {
    property: "cameraBlocked",
    settingDefinitionId: "device_vendor_msft_policy_config_camera_allowcamera",
    blockedOptionText: (t) => t.startsWith("Not allowed"),
    allowedOptionText: (t) => t.startsWith("Allowed"),
  },
  {
    property: "bluetoothBlocked",
    settingDefinitionId: "device_vendor_msft_policy_config_connectivity_allowbluetooth",
    blockedOptionText: (t) => t.startsWith("Disallow Bluetooth"),
    allowedOptionText: (t) => t.startsWith("Allow Bluetooth"),
  },
  {
    property: "cortanaBlocked",
    settingDefinitionId: "device_vendor_msft_policy_config_experience_allowcortana",
    blockedOptionText: (t) => t === "Block",
    allowedOptionText: (t) => t === "Allow",
  },
  {
    property: "screenCaptureBlocked",
    settingDefinitionId: "device_vendor_msft_policy_config_experience_allowscreencapture",
    blockedOptionText: (t) => t.startsWith("Not allowed"),
    allowedOptionText: (t) => t.startsWith("Allowed"),
  },
  {
    property: "usbBlocked",
    settingDefinitionId: "device_vendor_msft_policy_config_connectivity_allowusbconnection",
    blockedOptionText: (t) => t.startsWith("Not allowed"),
    allowedOptionText: (t) => t.startsWith("Allowed"),
  },
];

export const WINDOWS10_GENERAL_CONFIGURATION = "#microsoft.graph.windows10GeneralConfiguration";
export const WINDOWS10_CUSTOM_CONFIGURATION = "#microsoft.graph.windows10CustomConfiguration";

/** Where a custom OMA-URI row's settings are keyed: by the path itself, which is all that identifies it. */
export const OMA_URI_PREFIX = "omauri:";

interface GraphOmaSetting {
  "@odata.type": string;
  displayName?: string | null;
  omaUri?: string | null;
  value?: unknown;
  isEncrypted?: boolean | null;
  fileName?: string | null;
}

interface GraphDeviceConfiguration {
  id: string;
  displayName: string;
  "@odata.type": string;
  assignments?: Array<{ target: { "@odata.type": string; groupId?: string } }>;
  [property: string]: unknown;
}

function findOptionItemId(options: Map<string, string> | undefined, matches: (text: string) => boolean): string | undefined {
  if (!options) return undefined;
  for (const [itemId, displayName] of options) {
    if (matches(displayName)) return itemId;
  }
  return undefined;
}

export async function fetchLegacyDeviceConfigurations(token: string): Promise<RawPolicy[]> {
  const configs = await graphGetAll<GraphDeviceConfiguration>(token, "/deviceManagement/deviceConfigurations?$expand=Assignments");

  const relevant = configs.filter((c) => c["@odata.type"] === WINDOWS10_GENERAL_CONFIGURATION);

  const policies: RawPolicy[] = configs.filter((c) => c["@odata.type"] === WINDOWS10_CUSTOM_CONFIGURATION).flatMap(customProfile);
  for (const config of relevant) {
    const settings: RawSetting[] = [];

    for (const mapping of LEGACY_MAPPINGS) {
      const rawValue = config[mapping.property];
      if (typeof rawValue !== "boolean") continue; // not configured on this profile

      const definition = await resolveSettingDefinition(token, mapping.settingDefinitionId);
      const itemId = findOptionItemId(definition.options, rawValue ? mapping.blockedOptionText : mapping.allowedOptionText);
      if (!itemId) continue; // catalog's option text drifted from what MAPPINGS expects — skip rather than crash the scan

      // In the shape a Settings Catalog policy's value has for the same setting — so it is edited with the
      // same dropdown, held against a baseline the same way, and can be pushed (see src/push/legacy.ts).
      const label = definition.options!.get(itemId)!;
      settings.push({
        settingDefinitionId: mapping.settingDefinitionId,
        name: definition.name,
        cspPath: definition.cspPath,
        category: definition.category,
        value: label,
        structured: { kind: "choice", definitionId: mapping.settingDefinitionId, name: definition.name, optionId: itemId, label },
        schemas: { [mapping.settingDefinitionId]: definition.schema },
      });
    }

    if (settings.length === 0) continue; // nothing in our mapped set was actually configured on this profile

    policies.push({
      id: config.id,
      name: config.displayName,
      platform: "windows10",
      assignments: mapAssignmentTargets(config.assignments),
      settings,
    });
  }

  return policies;
}

/**
 * A custom profile: rows of OMA-URI path and value, set by hand — Office's
 * trusted publishers, say, one row per certificate with its thumbprint in
 * the path. Each row is a setting of its own, keyed by its path (in
 * lower case: Windows doesn't tell paths apart by case), so two profiles
 * writing the same path land on the same setting.
 *
 * Confirmed live: Intune encrypts text, XML and file values (a
 * certificate is a file value) and hands them back only to an app allowed
 * to change configuration — a read-only scan sees "****". Such a row is
 * shown with its file name or as encrypted; numbers and true/false come
 * back as they are. They can't be edited here.
 */
function customProfile(config: GraphDeviceConfiguration): RawPolicy[] {
  const rows = Array.isArray(config.omaSettings) ? (config.omaSettings as GraphOmaSetting[]) : [];
  const settings: RawSetting[] = rows
    .filter((row) => typeof row.omaUri === "string" && row.omaUri.trim() !== "")
    .map((row) => {
      const path = row.omaUri!.trim();
      return {
        settingDefinitionId: `${OMA_URI_PREFIX}${path.toLowerCase()}`,
        name: row.displayName?.trim() || path.split("/").filter(Boolean).pop() || path,
        cspPath: path,
        category: "Custom OMA-URI",
        value: omaValue(row),
      };
    });
  if (settings.length === 0) return [];
  return [{ id: config.id, name: config.displayName, platform: "windows10", assignments: mapAssignmentTargets(config.assignments), settings }];
}

/**
 * Beta says so in `isEncrypted`; v1.0, which the scan reads profiles
 * from, doesn't have the property and only sends the mask — "****", or
 * for a file value "****" in base64 (both confirmed live).
 */
function isMasked(row: GraphOmaSetting, file: boolean): boolean {
  if (row.isEncrypted) return true;
  if (typeof row.value !== "string") return false;
  return row.value === "****" || (file && Buffer.from(row.value, "base64").toString("latin1") === "****");
}

function omaValue(row: GraphOmaSetting): string {
  const file = row["@odata.type"].endsWith("omaSettingBase64") || row["@odata.type"].endsWith("omaSettingStringXml");
  if (isMasked(row, file)) return file && row.fileName ? `${row.fileName} (encrypted)` : "Encrypted";
  if (file && typeof row.value === "string") return certificateSummary(row.value) ?? (row.fileName || "File");
  return row.value === undefined || row.value === null ? "" : String(row.value);
}

/** A file value that is a certificate, by whom it's for and when it runs out. */
function certificateSummary(base64: string): string | undefined {
  try {
    const certificate = new X509Certificate(Buffer.from(base64, "base64"));
    const subject = /CN=([^\n,]+)/.exec(certificate.subject)?.[1] ?? certificate.subject;
    return `Certificate: ${subject}, expires ${new Date(certificate.validTo).toISOString().slice(0, 10)}`;
  } catch {
    return undefined;
  }
}
