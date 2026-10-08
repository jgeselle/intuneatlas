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

  await t.test("skips what describes the policy, and what isn't a single value", () => {
    const settings = complianceSettingsOf({
      "@odata.type": WINDOWS,
      id: "p1",
      displayName: "x",
      description: "y",
      version: 3,
      roleScopeTagIds: ["0"],
      "assignments@odata.context": "…",
      assignments: [],
      scheduledActionsForRule: [{ ruleName: "PasswordRequired" }],
      validOperatingSystemBuildRanges: [{ lowestVersion: "10.0.1", highestVersion: "10.0.2" }],
      deviceCompliancePolicyScript: { deviceComplianceScriptId: "s" },
    });
    assert.deepEqual(settings, []);
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
  assert.equal(isComplianceDefinition("device_vendor_msft_policy_config_camera_allowcamera"), false);
  assert.equal(isComplianceDefinition(undefined), false);
});
