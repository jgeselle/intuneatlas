import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchConfigurationPolicies } from "../../src/scan/configurationPolicies.js";

/**
 * Covers two real bugs found by seeding an actual test tenant and running
 * a real scan against it (not hand-guessed): group/nested settings
 * rendering as the literal string "(group setting)"
 * (src/scan/configurationPolicies.ts), and categories rendering as a raw
 * GUID instead of a friendly name (src/scan/settingDefinitions.ts). Both
 * are exercised together here in one fixture shaped like the real
 * Attack Surface Reduction Rules policy that reproduced them live.
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const ROOT_DEF_ID = "device_vendor_msft_policy_config_defender_attacksurfacereductionrules";
const CHILD_DEF_ID = `${ROOT_DEF_ID}_blockabuseofexploitedvulnerablesigneddrivers`;
const CATEGORY_ID = "cat-1";

test("fetchConfigurationPolicies", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/deviceManagement/configurationPolicies?")) {
      return jsonResponse({
        value: [{ id: "policy-1", name: "ASR policy", platforms: "windows10", assignments: [] }],
      });
    }
    if (u.includes("/deviceManagement/configurationPolicies/policy-1/settings")) {
      return jsonResponse({
        value: [
          {
            settingInstance: {
              "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
              settingDefinitionId: ROOT_DEF_ID,
              groupSettingCollectionValue: [
                {
                  children: [
                    {
                      "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
                      settingDefinitionId: CHILD_DEF_ID,
                      choiceSettingValue: { value: `${CHILD_DEF_ID}_1` },
                    },
                  ],
                },
              ],
            },
          },
        ],
      });
    }
    // CHILD_DEF_ID is prefixed by ROOT_DEF_ID (real catalog naming
    // convention — confirmed live), so the more specific child match must
    // be checked first, or a plain .includes() on the root id's URL would
    // also match the child's.
    if (u.endsWith(`/deviceManagement/configurationSettings/${CHILD_DEF_ID}`)) {
      return jsonResponse({
        id: CHILD_DEF_ID,
        displayName: "Block abuse of exploited vulnerable signed drivers",
        baseUri: "./Device/Vendor/MSFT/Policy/Config/Defender/",
        offsetUri: "BlockAbuseOfExploitedVulnerableSignedDrivers",
        categoryId: CATEGORY_ID,
        options: [
          { itemId: `${CHILD_DEF_ID}_0`, displayName: "Not configured" },
          { itemId: `${CHILD_DEF_ID}_1`, displayName: "Block" },
        ],
      });
    }
    if (u.endsWith(`/deviceManagement/configurationSettings/${ROOT_DEF_ID}`)) {
      return jsonResponse({
        id: ROOT_DEF_ID,
        displayName: "Attack Surface Reduction Rules",
        baseUri: "./Device/Vendor/MSFT/Policy/Config/Defender/",
        offsetUri: "AttackSurfaceReductionRules",
        categoryId: CATEGORY_ID,
      });
    }
    if (u.includes(`/deviceManagement/configurationCategories/${CATEGORY_ID}`)) {
      // Confirmed against a live tenant: `name` is null on this resource,
      // `displayName` is the field that's actually populated.
      return jsonResponse({ id: CATEGORY_ID, name: null, displayName: "Attack surface reduction" });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;

  const policies = await fetchConfigurationPolicies("token");

  assert.equal(policies.length, 1);
  const [setting] = policies[0].settings;
  assert.equal(setting.name, "Attack Surface Reduction Rules");
  assert.equal(setting.category, "Attack surface reduction", "category should resolve to a friendly name, not the raw GUID");
  assert.equal(
    setting.value,
    "Block abuse of exploited vulnerable signed drivers: Block",
    "group settings should recurse into their children instead of showing a placeholder",
  );
});

/**
 * Covers a third real bug, found by replaying a real tenant's exported
 * policies against the live catalog: a choice setting's own dependent
 * child (nested in choiceSettingValue.children, a different mechanism
 * from a group's children) was silently dropped entirely — not even a
 * placeholder, just absent. Modeled on a real "Block Flash activation"
 * (parent) + "Block Flash Action" (dependent child) pair, confirmed live.
 */
test("fetchConfigurationPolicies — a choice setting's dependent child", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const PARENT_ID = "device_vendor_msft_policy_config_secguide_block_flash";
  const CHILD_ID = `${PARENT_ID}_pol_secguide_block_flash`;
  const CATEGORY_ID = "cat-2";

  global.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/deviceManagement/configurationPolicies?")) {
      return jsonResponse({
        value: [{ id: "policy-2", name: "Block Flash policy", platforms: "windows10", assignments: [] }],
      });
    }
    if (u.includes("/deviceManagement/configurationPolicies/policy-2/settings")) {
      return jsonResponse({
        value: [
          {
            settingInstance: {
              "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
              settingDefinitionId: PARENT_ID,
              choiceSettingValue: {
                value: `${PARENT_ID}_1`,
                children: [
                  {
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
                    settingDefinitionId: CHILD_ID,
                    choiceSettingValue: { value: `${CHILD_ID}_block_all` },
                  },
                ],
              },
            },
          },
        ],
      });
    }
    if (u.endsWith(`/deviceManagement/configurationSettings/${CHILD_ID}`)) {
      return jsonResponse({
        id: CHILD_ID,
        displayName: "Block Flash Action",
        baseUri: "./Device/Vendor/MSFT/Policy/Config/SecGuide/",
        offsetUri: "BlockFlashAction",
        categoryId: CATEGORY_ID,
        options: [{ itemId: `${CHILD_ID}_block_all`, displayName: "Block all activation" }],
      });
    }
    if (u.endsWith(`/deviceManagement/configurationSettings/${PARENT_ID}`)) {
      return jsonResponse({
        id: PARENT_ID,
        displayName: "Block Flash activation",
        baseUri: "./Device/Vendor/MSFT/Policy/Config/SecGuide/",
        offsetUri: "BlockFlash",
        categoryId: CATEGORY_ID,
        options: [
          { itemId: `${PARENT_ID}_0`, displayName: "Disabled" },
          { itemId: `${PARENT_ID}_1`, displayName: "Enabled" },
        ],
      });
    }
    if (u.endsWith(`/deviceManagement/configurationCategories/${CATEGORY_ID}`)) {
      return jsonResponse({ id: CATEGORY_ID, name: null, displayName: "MS Security Guide" });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;

  const policies = await fetchConfigurationPolicies("token");

  const [setting] = policies[0].settings;
  assert.equal(setting.name, "Block Flash activation");
  assert.equal(
    setting.value,
    "Enabled\nBlock Flash Action: Block all activation",
    "a choice setting's dependent child must not be silently dropped",
  );
});

/**
 * Covers a fourth real bug, found by importing ~1500 real settings from a
 * real tenant's exported policies: displayName isn't always populated on
 * a category even when it resolves successfully — every ADMX-derived
 * (Group Policy template) leaf category seen live has an empty
 * displayName but a real, useful description ("Administrative
 * Templates"). Previously rendered as a blank category with no fallback.
 */
test("fetchConfigurationPolicies — a category with an empty displayName falls back to description", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const DEF_ID = "device_vendor_msft_policy_config_admx_printing2_registerspoolerremoterpcendpoint";
  const CATEGORY_ID = "cat-admx";

  global.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/deviceManagement/configurationPolicies?")) {
      return jsonResponse({ value: [{ id: "policy-3", name: "Printing policy", platforms: "windows10", assignments: [] }] });
    }
    if (u.includes("/deviceManagement/configurationPolicies/policy-3/settings")) {
      return jsonResponse({
        value: [
          {
            settingInstance: {
              "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
              settingDefinitionId: DEF_ID,
              choiceSettingValue: { value: `${DEF_ID}_0` },
            },
          },
        ],
      });
    }
    if (u.endsWith(`/deviceManagement/configurationSettings/${DEF_ID}`)) {
      return jsonResponse({
        id: DEF_ID,
        displayName: "Allow Print Spooler to accept client connections",
        baseUri: "./Device/Vendor/MSFT/Policy/Config/ADMX_Printing2/",
        offsetUri: "RegisterSpoolerRemoteRpcEndPoint",
        categoryId: CATEGORY_ID,
        options: [{ itemId: `${DEF_ID}_0`, displayName: "Disabled" }],
      });
    }
    if (u.endsWith(`/deviceManagement/configurationCategories/${CATEGORY_ID}`)) {
      // Confirmed live: displayName empty, description populated — not
      // both empty, and not the more common "both populated" case.
      return jsonResponse({ id: CATEGORY_ID, name: null, displayName: "", description: "Administrative Templates" });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;

  const policies = await fetchConfigurationPolicies("token");
  assert.equal(policies[0].settings[0].category, "Administrative Templates");
});

/**
 * The structured side of a scan: the value kept as a tree (not just the
 * rendered text), and each definition's schema — options, which option
 * reveals which sub-setting, integer ranges. Definition shapes here follow
 * Microsoft's documented beta resource types
 * (deviceManagementConfigurationChoiceSettingDefinition,
 * ...SimpleSettingDefinition with an IntegerSettingValueDefinition,
 * ...SimpleSettingCollectionDefinition). Confirmed against a live tenant
 * (139 policies, 1,384 definitions): every definition declared its kind,
 * every integer had both bounds, every string a maximum length, and every
 * dependent child found in a value was listed by its parent option's
 * dependedOnBy.
 */
test("fetchConfigurationPolicies — structured values and definition schemas", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const CHOICE_ID = "schema_test_startup_auth";
  const CHILD_ID = `${CHOICE_ID}_min_pin_length`;
  const LIST_ID = "schema_test_excluded_paths";
  const CATEGORY_ID = "cat-schema";
  const definitions: Record<string, unknown> = {
    [CHOICE_ID]: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingDefinition",
      id: CHOICE_ID,
      displayName: "Require additional authentication at startup",
      description: "Controls whether a PIN is needed.",
      baseUri: "./Device/Vendor/MSFT/BitLocker/",
      offsetUri: "SystemDrivesRequireStartupAuthentication",
      categoryId: CATEGORY_ID,
      defaultOptionId: `${CHOICE_ID}_0`,
      options: [
        { itemId: `${CHOICE_ID}_0`, displayName: "Disabled", description: null, dependedOnBy: [] },
        { itemId: `${CHOICE_ID}_1`, displayName: "Enabled", description: "Turns it on", dependedOnBy: [{ dependedOnBy: CHILD_ID, required: true }] },
      ],
    },
    [CHILD_ID]: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingDefinition",
      id: CHILD_ID,
      displayName: "Minimum PIN length",
      baseUri: "./Device/Vendor/MSFT/BitLocker/",
      offsetUri: "SystemDrivesMinimumPINLength",
      categoryId: CATEGORY_ID,
      valueDefinition: {
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValueDefinition",
        minimumValue: 4,
        maximumValue: 20,
      },
    },
    [LIST_ID]: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingCollectionDefinition",
      id: LIST_ID,
      displayName: "Excluded paths",
      baseUri: "./Device/Vendor/MSFT/Defender/",
      offsetUri: "ExcludedPaths",
      categoryId: CATEGORY_ID,
      maximumCount: 600,
      minimumCount: 0,
      valueDefinition: {
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationStringSettingValueDefinition",
        format: "none",
        maximumLength: 260,
        minimumLength: null,
        isSecret: false,
      },
    },
  };

  global.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/deviceManagement/configurationPolicies?")) {
      return jsonResponse({ value: [{ id: "policy-schema", name: "Schema policy", platforms: "windows10", assignments: [] }] });
    }
    if (u.includes("/deviceManagement/configurationPolicies/policy-schema/settings")) {
      return jsonResponse({
        value: [
          {
            settingInstance: {
              "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
              settingDefinitionId: CHOICE_ID,
              choiceSettingValue: {
                value: `${CHOICE_ID}_1`,
                children: [
                  {
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
                    settingDefinitionId: CHILD_ID,
                    simpleSettingValue: { value: 6 },
                  },
                ],
              },
            },
          },
          {
            settingInstance: {
              "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingCollectionInstance",
              settingDefinitionId: LIST_ID,
              simpleSettingCollectionValue: [{ value: "C:\\Temp" }, { value: "D:\\Build" }],
            },
          },
        ],
      });
    }
    const definitionId = Object.keys(definitions).find((id) => u.endsWith(`/deviceManagement/configurationSettings/${id}`));
    if (definitionId) return jsonResponse(definitions[definitionId]);
    if (u.endsWith(`/deviceManagement/configurationCategories/${CATEGORY_ID}`)) {
      return jsonResponse({ id: CATEGORY_ID, displayName: "Schema tests" });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;

  const [choice, list] = (await fetchConfigurationPolicies("token"))[0].settings;

  // The text every existing reader uses is unchanged, and now derived from the tree.
  assert.equal(choice.value, "Enabled\nMinimum PIN length: 6");
  assert.deepEqual(choice.structured, {
    kind: "choice",
    definitionId: CHOICE_ID,
    name: "Require additional authentication at startup",
    optionId: `${CHOICE_ID}_1`,
    label: "Enabled",
    children: [{ kind: "simple", definitionId: CHILD_ID, name: "Minimum PIN length", value: 6 }],
  });
  assert.deepEqual(choice.schemas, {
    [CHOICE_ID]: {
      definitionId: CHOICE_ID,
      name: "Require additional authentication at startup",
      kind: "choice",
      description: "Controls whether a PIN is needed.",
      options: [
        { id: `${CHOICE_ID}_0`, label: "Disabled" },
        { id: `${CHOICE_ID}_1`, label: "Enabled", description: "Turns it on", childIds: [CHILD_ID] },
      ],
      defaultOptionId: `${CHOICE_ID}_0`,
    },
    [CHILD_ID]: { definitionId: CHILD_ID, name: "Minimum PIN length", kind: "simple", valueType: "integer", min: 4, max: 20 },
  });

  assert.equal(list.value, "C:\\Temp\nD:\\Build");
  assert.deepEqual(list.structured, { kind: "simpleCollection", definitionId: LIST_ID, name: "Excluded paths", items: ["C:\\Temp", "D:\\Build"] });
  assert.deepEqual(list.schemas, {
    [LIST_ID]: {
      definitionId: LIST_ID,
      name: "Excluded paths",
      kind: "simpleCollection",
      valueType: "string",
      maxLength: 260,
      format: "none",
      minCount: 0,
      maxCount: 600,
    },
  });
});
