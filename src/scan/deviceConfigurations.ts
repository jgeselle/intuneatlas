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
interface LegacyMapping {
  /** Property name on the windows10GeneralConfiguration Graph resource. */
  property: string;
  /** Confirmed live against a real tenant's Settings Catalog. */
  settingDefinitionId: string;
  /** Matches the resolved definition's real option display text — confirmed live, not guessed. */
  blockedOptionText: (text: string) => boolean;
  allowedOptionText: (text: string) => boolean;
}

const MAPPINGS: LegacyMapping[] = [
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

const WINDOWS10_GENERAL_CONFIGURATION = "#microsoft.graph.windows10GeneralConfiguration";

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

  const policies: RawPolicy[] = [];
  for (const config of relevant) {
    const settings: RawSetting[] = [];

    for (const mapping of MAPPINGS) {
      const rawValue = config[mapping.property];
      if (typeof rawValue !== "boolean") continue; // not configured on this profile

      const definition = await resolveSettingDefinition(token, mapping.settingDefinitionId);
      const itemId = findOptionItemId(definition.options, rawValue ? mapping.blockedOptionText : mapping.allowedOptionText);
      if (!itemId) continue; // catalog's option text drifted from what MAPPINGS expects — skip rather than crash the scan

      settings.push({
        settingDefinitionId: mapping.settingDefinitionId,
        name: definition.name,
        cspPath: definition.cspPath,
        category: definition.category,
        value: definition.options!.get(itemId)!,
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
