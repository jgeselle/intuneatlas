import assert from "node:assert/strict";
import { test } from "node:test";
import { complianceDefinitions, complianceSettingsOf, humanize, isComplianceDefinition } from "../../src/scan/complianceSettings.js";

const WINDOWS = "#microsoft.graph.windows10CompliancePolicy";

test("complianceSettingsOf", async (t) => {
  await t.test("turns each configured property into a setting, typed from Graph's metadata", () => {
    const settings = complianceSettingsOf({
      "@odata.type": WINDOWS,
      id: "p1",
      displayName: "Windows compliance",
      passwordMinimumLength: 12,
      bitLockerEnabled: true,
      osMinimumVersion: "10.0.22631.0",
      deviceThreatProtectionRequiredSecurityLevel: "medium",
    });

    const byId = Object.fromEntries(settings.map((s) => [s.settingDefinitionId, s]));
    assert.deepEqual(Object.keys(byId).sort(), [
      "compliance.windows10.bitLockerEnabled",
      "compliance.windows10.deviceThreatProtectionRequiredSecurityLevel",
      "compliance.windows10.osMinimumVersion",
      "compliance.windows10.passwordMinimumLength",
    ]);

    const length = byId["compliance.windows10.passwordMinimumLength"];
    assert.equal(length.name, "Password minimum length");
    assert.equal(length.value, "12");
    assert.equal(length.category, "Password");
    assert.equal(length.cspPath, "windows10CompliancePolicy/passwordMinimumLength");
    assert.deepEqual(length.structured, { kind: "simple", definitionId: "compliance.windows10.passwordMinimumLength", name: "Password minimum length", value: 12 });
    assert.equal(length.schemas?.["compliance.windows10.passwordMinimumLength"].valueType, "integer");

    const bitLocker = byId["compliance.windows10.bitLockerEnabled"];
    assert.equal(bitLocker.name, "BitLocker enabled");
    assert.equal(bitLocker.value, "Require");
    assert.deepEqual(
      bitLocker.schemas?.["compliance.windows10.bitLockerEnabled"].options?.map((o) => o.label),
      ["Not configured", "Require"],
    );

    const level = byId["compliance.windows10.deviceThreatProtectionRequiredSecurityLevel"];
    assert.equal(level.value, "Medium");
    assert.equal(level.structured?.kind === "choice" && level.structured.optionId, "compliance.windows10.deviceThreatProtectionRequiredSecurityLevel_medium");
    assert.deepEqual(
      level.schemas?.[level.settingDefinitionId].options?.map((o) => o.label),
      ["Unavailable", "Secured", "Low", "Medium", "High", "Not set"],
    );

    assert.equal(byId["compliance.windows10.osMinimumVersion"].schemas?.["compliance.windows10.osMinimumVersion"].valueType, "string");
  });

  await t.test("leaves out everything Intune shows as not configured", () => {
    const settings = complianceSettingsOf({
      "@odata.type": WINDOWS,
      passwordRequired: false,
      passwordMinimumLength: null,
      osMinimumVersion: "",
      passwordRequiredType: "deviceDefault", // the enum's first member
      deviceThreatProtectionRequiredSecurityLevel: "notSet",
    });
    assert.deepEqual(settings, []);
  });

  await t.test("skips what describes the policy", () => {
    const settings = complianceSettingsOf({
      "@odata.type": WINDOWS,
      id: "p1",
      displayName: "x",
      description: "y",
      version: 3,
      roleScopeTagIds: ["0"],
      "assignments@odata.context": "…",
      assignments: [],
      conditionStatementId: "abc",
    });
    assert.deepEqual(settings, []);
  });

  await t.test("reads a list of objects as a list of groups, one sub-setting per field that holds something", () => {
    const [ranges] = complianceSettingsOf({
      "@odata.type": WINDOWS,
      validOperatingSystemBuildRanges: [
        { "@odata.type": "#microsoft.graph.operatingSystemVersionRange", description: "Windows 11 23H2", lowestVersion: "10.0.22631.0", highestVersion: "10.0.22631.9999" },
        { description: "Windows 11 24H2", lowestVersion: "10.0.26100.0", highestVersion: null },
      ],
      wslDistributions: [],
    });
    const id = "compliance.windows10.validOperatingSystemBuildRanges";

    assert.equal(ranges.settingDefinitionId, id);
    assert.equal(ranges.name, "Valid operating system build ranges");
    assert.equal(ranges.structured?.kind, "groupCollection");
    assert.equal(
      ranges.value,
      ["[1] Description: Windows 11 23H2", "[1] Highest version: 10.0.22631.9999", "[1] Lowest version: 10.0.22631.0", "[2] Description: Windows 11 24H2", "[2] Lowest version: 10.0.26100.0"].join("\n"),
    );
    assert.equal(ranges.schemas?.[id].kind, "groupCollection");
    assert.deepEqual(ranges.schemas?.[id].childIds, [`${id}.description`, `${id}.highestVersion`, `${id}.lowestVersion`]);
    assert.equal(ranges.schemas?.[`${id}.lowestVersion`].name, "Lowest version");
  });

  await t.test("reads a single object as a group, and nothing when it is empty", () => {
    const script = (value: unknown) => complianceSettingsOf({ "@odata.type": WINDOWS, deviceCompliancePolicyScript: value });

    assert.deepEqual(script(null), []);
    assert.deepEqual(script({ deviceComplianceScriptId: null, rulesContent: null }), []);
    const [setting] = script({ deviceComplianceScriptId: "5f1c", rulesContent: "eyJydWxlcyI6W119" });
    assert.equal(setting.structured?.kind, "group");
    assert.equal(setting.value, "Device compliance script id: 5f1c"); // the rules themselves (binary content) aren't a value to show
  });

  await t.test("reads the actions for noncompliance as one setting, soonest first, without the tenant's own template ids", () => {
    const [actions] = complianceSettingsOf({
      "@odata.type": WINDOWS,
      scheduledActionsForRule: [
        {
          ruleName: "PasswordRequired",
          scheduledActionConfigurations: [
            { actionType: "retire", gracePeriodHours: 720, notificationTemplateId: "00000000-0000-0000-0000-000000000000", notificationMessageCCList: [] },
            { actionType: "notification", gracePeriodHours: 24, notificationTemplateId: "7a1c", notificationMessageCCList: ["x"] },
            { actionType: "block", gracePeriodHours: 0, notificationTemplateId: "00000000-0000-0000-0000-000000000000", notificationMessageCCList: [] },
          ],
        },
      ],
    });
    const id = "compliance.windows10.scheduledActionsForRule";

    assert.equal(actions.settingDefinitionId, id);
    assert.equal(actions.name, "Actions for noncompliance");
    assert.equal(actions.category, "Actions for noncompliance");
    assert.equal(
      actions.value,
      ["[1] Action: Block", "[1] Grace period hours: 0", "[2] Action: Notification", "[2] Grace period hours: 24", "[3] Action: Retire", "[3] Grace period hours: 720"].join("\n"),
    );
    assert.deepEqual(actions.schemas?.[id].childIds, [`${id}.actionType`, `${id}.gracePeriodHours`]);
    assert.deepEqual(
      actions.schemas?.[`${id}.actionType`].options?.map((o) => o.label),
      ["No action", "Notification", "Block", "Retire", "Wipe", "Remove resource access profiles", "Push notification", "Remote lock"],
    );
  });

  await t.test("has no actions setting when the policy came without them", () => {
    assert.deepEqual(complianceSettingsOf({ "@odata.type": WINDOWS, scheduledActionsForRule: [{ ruleName: "PasswordRequired" }] }), []);
    assert.deepEqual(complianceSettingsOf({ "@odata.type": WINDOWS, scheduledActionsForRule: [] }), []);
  });

  await t.test("says Block for switches that block, disable or prevent", () => {
    const [setting] = complianceSettingsOf({ "@odata.type": "#microsoft.graph.androidCompliancePolicy", securityBlockJailbrokenDevices: true });
    assert.equal(setting.value, "Block");
    assert.equal(setting.settingDefinitionId, "compliance.android.securityBlockJailbrokenDevices");
  });

  await t.test("still reads a property Graph's metadata doesn't list yet, by the value it holds", () => {
    const settings = complianceSettingsOf({ "@odata.type": WINDOWS, somethingNewRequired: true, somethingNewLimit: 5, somethingNewName: "abc", somethingNewList: ["a"] });
    assert.deepEqual(
      settings.map((s) => [s.settingDefinitionId, s.value]),
      [
        ["compliance.windows10.somethingNewRequired", "Require"],
        ["compliance.windows10.somethingNewLimit", "5"],
        ["compliance.windows10.somethingNewName", "abc"],
      ],
    );
  });

  await t.test("reads nothing from a resource that isn't a compliance policy", () => {
    assert.deepEqual(complianceSettingsOf({ "@odata.type": "#microsoft.graph.windows10GeneralConfiguration", passwordRequired: true }), []);
    assert.deepEqual(complianceSettingsOf({ passwordRequired: true }), []);
    // The Settings Catalog kind of compliance policy has a `settings` list, not properties.
    assert.deepEqual(complianceSettingsOf({ "@odata.type": "#microsoft.graph.deviceManagementCompliancePolicy", name: "Linux", platforms: "linux" }), []);
  });
});

test("humanize", () => {
  assert.equal(humanize("osMinimumVersion"), "OS minimum version");
  assert.equal(humanize("mobileOsMaximumVersion"), "Mobile OS maximum version");
  assert.equal(humanize("tpmRequired"), "TPM required");
  assert.equal(humanize("securityDisableUsbDebugging"), "Security disable USB debugging");
  assert.equal(humanize("macAppStoreAndIdentifiedDevelopers"), "Mac app store and identified developers");
});

test("complianceDefinitions knows every compliance setting without asking Graph", () => {
  const { schemas, info } = complianceDefinitions();
  assert.equal(schemas["compliance.iOS.passcodeMinimumLength"], undefined); // Graph spells the type "ios"
  assert.equal(schemas["compliance.ios.passcodeMinimumLength"].name, "Passcode minimum length");
  assert.deepEqual(info["compliance.macOS.firewallEnabled"], { cspPath: "macOSCompliancePolicy/firewallEnabled", category: "Threat protection" });
  assert.ok(Object.keys(schemas).every(isComplianceDefinition));
  // Lists, and the actions, come with the sub-settings they are made of.
  assert.deepEqual(schemas["compliance.ios.restrictedApps"].childIds?.map((id) => schemas[id].name), ["App id", "App store url", "Name", "Publisher"]);
  assert.equal(schemas["compliance.macOS.scheduledActionsForRule"].kind, "groupCollection");
  assert.equal(info["compliance.macOS.scheduledActionsForRule"].category, "Actions for noncompliance");
  assert.equal(isComplianceDefinition("device_vendor_msft_policy_config_camera_allowcamera"), false);
  assert.equal(isComplianceDefinition(undefined), false);
});
