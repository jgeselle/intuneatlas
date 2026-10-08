// Compliance policies of every kind the scan reads: typed policies for Windows, iOS, macOS and
// Android (settings as properties — single values, a list of objects, the actions for
// noncompliance), two Windows policies for the same group asking for different password lengths
// (compliance requirements add up; that is not a conflict), one left unassigned, and a Linux
// policy in the Settings Catalog format. Exercises src/scan/complianceSettings.ts and
// src/scan/complianceCatalog.ts against what Graph really returns.
import type { SeedClient } from "../client.js";
import { assignCatalogCompliancePolicy, assignCompliancePolicy, createCatalogCompliancePolicy, createCompliancePolicy, createTestGroup } from "../objects.js";
import { choiceSettingInstance } from "../settingsCatalog.js";

const simple = (settingDefinitionId: string, type: "Integer" | "String", value: number | string) => ({
  "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
  settingDefinitionId,
  simpleSettingValue: { "@odata.type": `#microsoft.graph.deviceManagementConfiguration${type}SettingValue`, value },
});

export async function seedCompliance(client: SeedClient): Promise<void> {
  const windows = await createTestGroup(client, "compliance target (Windows)");
  const mobile = await createTestGroup(client, "compliance target (mobile and Mac)");

  const baseline = await createCompliancePolicy(client, {
    name: "compliance - Windows - baseline",
    odataType: "#microsoft.graph.windows10CompliancePolicy",
    properties: {
      passwordRequired: true,
      passwordMinimumLength: 8,
      passwordRequiredType: "alphanumeric",
      bitLockerEnabled: true,
      secureBootEnabled: true,
      defenderEnabled: true,
      osMinimumVersion: "10.0.19045.0",
      validOperatingSystemBuildRanges: [
        { description: "Windows 11 23H2", lowestVersion: "10.0.22631.0", highestVersion: "10.0.22631.9999" },
        { description: "Windows 11 24H2", lowestVersion: "10.0.26100.0", highestVersion: "10.0.26100.9999" },
      ],
    },
    actions: [
      { actionType: "block", gracePeriodHours: 24 },
      { actionType: "retire", gracePeriodHours: 720 },
    ],
  });
  await assignCompliancePolicy(client, baseline.id, [{ kind: "group", groupId: windows.id }]);

  const stricter = await createCompliancePolicy(client, {
    name: "compliance - Windows - stricter password",
    odataType: "#microsoft.graph.windows10CompliancePolicy",
    properties: { passwordRequired: true, passwordMinimumLength: 14, tpmRequired: true },
    actions: [{ actionType: "block", gracePeriodHours: 0 }],
  });
  await assignCompliancePolicy(client, stricter.id, [{ kind: "group", groupId: windows.id }]);

  const ios = await createCompliancePolicy(client, {
    name: "compliance - iOS",
    odataType: "#microsoft.graph.iosCompliancePolicy",
    properties: {
      passcodeRequired: true,
      passcodeMinimumLength: 6,
      passcodeBlockSimple: true,
      securityBlockJailbrokenDevices: true,
      osMinimumVersion: "17.0",
      restrictedApps: [{ "@odata.type": "#microsoft.graph.appListItem", name: "Example blocked app", publisher: "Example", appId: "com.example.blocked" }],
    },
    actions: [{ actionType: "block", gracePeriodHours: 0 }],
  });
  await assignCompliancePolicy(client, ios.id, [{ kind: "group", groupId: mobile.id }]);

  const mac = await createCompliancePolicy(client, {
    name: "compliance - macOS",
    odataType: "#microsoft.graph.macOSCompliancePolicy",
    properties: { passwordRequired: true, passwordMinimumLength: 12, storageRequireEncryption: true, firewallEnabled: true, gatekeeperAllowedAppSource: "macAppStoreAndIdentifiedDevelopers" },
    actions: [{ actionType: "block", gracePeriodHours: 0 }],
  });
  await assignCompliancePolicy(client, mac.id, [{ kind: "group", groupId: mobile.id }]);

  // Deliberately left unassigned.
  const android = await createCompliancePolicy(client, {
    name: "compliance - Android work profile (unassigned)",
    odataType: "#microsoft.graph.androidWorkProfileCompliancePolicy",
    properties: { passwordRequired: true, passwordRequiredType: "numeric", passwordMinimumLength: 6, workProfilePasswordRequiredType: "atLeastNumeric", securityBlockJailbrokenDevices: true, storageRequireEncryption: true },
    actions: [{ actionType: "block", gracePeriodHours: 0 }],
  });

  // Definition ids and option ids as a live tenant's complianceSettings catalog lists them.
  const DISTROS = "linux_distribution_alloweddistros";
  const linux = await createCatalogCompliancePolicy(client, {
    name: "compliance - Linux",
    platforms: "linux",
    technologies: "linuxMdm",
    settings: [
      {
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
        settingDefinitionId: DISTROS,
        groupSettingCollectionValue: [
          {
            children: [
              choiceSettingInstance(`${DISTROS}_item_$type`, `${DISTROS}_item_$type_ubuntu`),
              simple(`${DISTROS}_item_minimumversion`, "String", "22.04"),
              simple(`${DISTROS}_item_maximumversion`, "String", "24.04"),
            ],
          },
        ],
      },
      simple("linux_passwordpolicy_minimumlength", "Integer", 12),
      choiceSettingInstance("linux_deviceencryption_required", "linux_deviceencryption_required_true"),
    ],
    actions: [{ actionType: "block", gracePeriodHours: 0 }],
  });
  await assignCatalogCompliancePolicy(client, linux.id, [{ kind: "group", groupId: mobile.id }]);

  console.log(
    `compliance: "${baseline.name}" and "${stricter.name}" both target "${windows.displayName}" (password length 8 and 14); ` +
      `"${ios.name}", "${mac.name}" and "${linux.name}" target "${mobile.displayName}"; "${android.name}" is unassigned.`,
  );
}
