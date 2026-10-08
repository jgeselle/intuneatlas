import assert from "node:assert/strict";
import { test } from "node:test";
import { complianceSettingsOf } from "../../src/scan/complianceSettings.js";
import { rawNode } from "../../src/scan/settingValue.js";
import { complianceValueFromNode, instanceFromNode, PushRefused } from "../../src/push/values.js";

const T = "#microsoft.graph.deviceManagementConfiguration";

test("instanceFromNode: every kind of value goes back into the instance Graph stores", () => {
  // What Graph returns for a policy — and so what must come out again, reading it and writing it back unchanged.
  const instances = [
    { "@odata.type": `${T}SimpleSettingInstance`, settingDefinitionId: "defer", simpleSettingValue: { "@odata.type": `${T}IntegerSettingValue`, value: 7 } },
    { "@odata.type": `${T}SimpleSettingInstance`, settingDefinitionId: "homepage", simpleSettingValue: { "@odata.type": `${T}StringSettingValue`, value: "https://intranet" } },
    {
      "@odata.type": `${T}ChoiceSettingInstance`,
      settingDefinitionId: "bitlocker",
      choiceSettingValue: {
        "@odata.type": `${T}ChoiceSettingValue`,
        value: "bitlocker_1",
        children: [{ "@odata.type": `${T}SimpleSettingInstance`, settingDefinitionId: "bitlocker_pin", simpleSettingValue: { "@odata.type": `${T}IntegerSettingValue`, value: 6 } }],
      },
    },
    { "@odata.type": `${T}SimpleSettingCollectionInstance`, settingDefinitionId: "paths", simpleSettingCollectionValue: [{ "@odata.type": `${T}StringSettingValue`, value: "C:\\\\a" }, { "@odata.type": `${T}StringSettingValue`, value: "C:\\\\b" }] },
    { "@odata.type": `${T}ChoiceSettingCollectionInstance`, settingDefinitionId: "methods", choiceSettingCollectionValue: [{ "@odata.type": `${T}ChoiceSettingValue`, value: "methods_0", children: [] }] },
    {
      "@odata.type": `${T}GroupSettingCollectionInstance`,
      settingDefinitionId: "rules",
      groupSettingCollectionValue: [{ children: [{ "@odata.type": `${T}ChoiceSettingInstance`, settingDefinitionId: "rules_action", choiceSettingValue: { "@odata.type": `${T}ChoiceSettingValue`, value: "rules_action_1", children: [] } }] }],
    },
    { "@odata.type": `${T}GroupSettingInstance`, settingDefinitionId: "group", groupSettingValue: { children: [{ "@odata.type": `${T}SimpleSettingInstance`, settingDefinitionId: "group_n", simpleSettingValue: { "@odata.type": `${T}IntegerSettingValue`, value: 1 } }] } },
  ];
  for (const instance of instances) {
    assert.deepEqual(instanceFromNode(rawNode(instance)), instance, instance.settingDefinitionId);
  }
});

test("instanceFromNode: the definition decides integer or text; a number where a whole number belongs is refused", () => {
  const node = { kind: "simple" as const, definitionId: "version", name: "Version", value: "11" };
  // A string setting that happens to hold digits stays a string…
  assert.equal((instanceFromNode(node, { version: { definitionId: "version", name: "Version", kind: "simple", valueType: "string" } }).simpleSettingValue as { "@odata.type": string })["@odata.type"], `${T}StringSettingValue`);
  // …and an integer setting edited as text goes out as a number.
  assert.deepEqual(instanceFromNode(node, { version: { definitionId: "version", name: "Version", kind: "simple", valueType: "integer" } }).simpleSettingValue, { "@odata.type": `${T}IntegerSettingValue`, value: 11 });
  assert.throws(() => instanceFromNode({ ...node, value: "a lot" }, { version: { definitionId: "version", name: "Version", kind: "simple", valueType: "integer" } }), PushRefused);
  assert.throws(() => instanceFromNode({ kind: "unknown", definitionId: "x", name: "X" }), PushRefused);
});

test("instanceFromNode: a compliance catalog setting goes out under Graph's own definition id", () => {
  const node = { kind: "simple" as const, definitionId: "compliance.catalog.linux_passwordpolicy_minimumlength", name: "Minimum Length", value: 12 };
  assert.equal(instanceFromNode(node).settingDefinitionId, "linux_passwordpolicy_minimumlength");
});

test("complianceValueFromNode: back to the property a typed compliance policy holds", () => {
  const WINDOWS = "#microsoft.graph.windows10CompliancePolicy";
  const policy = {
    "@odata.type": WINDOWS,
    bitLockerEnabled: true,
    passwordMinimumLength: 12,
    osMinimumVersion: "10.0.22631.0",
    passwordRequiredType: "alphanumeric",
    validOperatingSystemBuildRanges: [{ description: "23H2", lowestVersion: "10.0.22631.0", highestVersion: "10.0.22631.9999" }],
  };
  // Read as a scan reads it, written back: the same values.
  for (const setting of complianceSettingsOf(policy)) {
    const property = setting.settingDefinitionId.split(".").pop()!;
    assert.deepEqual(complianceValueFromNode(setting.structured!), (policy as Record<string, unknown>)[property], property);
  }
  // A switch set back to "Not configured" is false.
  const [switchedOn] = complianceSettingsOf({ "@odata.type": WINDOWS, tpmRequired: true });
  const off = { ...switchedOn.structured!, optionId: `${switchedOn.settingDefinitionId}_false` } as typeof switchedOn.structured;
  assert.equal(complianceValueFromNode(off!), false);
});
