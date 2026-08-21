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
    "Enabled (Block Flash Action: Block all activation)",
    "a choice setting's dependent child must not be silently dropped",
  );
});
