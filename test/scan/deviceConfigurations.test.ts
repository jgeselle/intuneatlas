import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchLegacyDeviceConfigurations } from "../../src/scan/deviceConfigurations.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const CAMERA_DEF_ID = "device_vendor_msft_policy_config_camera_allowcamera";
const CATEGORY_ID = "cat-camera";

function cameraDefinitionResponse() {
  return {
    id: CAMERA_DEF_ID,
    displayName: "Allow Camera",
    baseUri: "./Device/Vendor/MSFT/Policy",
    offsetUri: "/Config/Camera/AllowCamera",
    categoryId: CATEGORY_ID,
    options: [
      { itemId: `${CAMERA_DEF_ID}_0`, displayName: "Not allowed." },
      { itemId: `${CAMERA_DEF_ID}_1`, displayName: "Allowed." },
    ],
  };
}

test("fetchLegacyDeviceConfigurations", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  await t.test("maps cameraBlocked: true to the Allow Camera setting's blocked option", async () => {
    global.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/deviceManagement/deviceConfigurations?")) {
        return jsonResponse({
          value: [
            {
              id: "legacy-1",
              displayName: "Device Restrictions",
              "@odata.type": "#microsoft.graph.windows10GeneralConfiguration",
              cameraBlocked: true,
              assignments: [{ target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } }],
            },
          ],
        });
      }
      if (u.endsWith(`/deviceManagement/configurationSettings/${CAMERA_DEF_ID}`)) {
        return jsonResponse(cameraDefinitionResponse());
      }
      if (u.endsWith(`/deviceManagement/configurationCategories/${CATEGORY_ID}`)) {
        return jsonResponse({ id: CATEGORY_ID, name: null, displayName: "Camera" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as typeof fetch;

    const policies = await fetchLegacyDeviceConfigurations("token");

    assert.equal(policies.length, 1);
    assert.equal(policies[0].platform, "windows10");
    assert.deepEqual(policies[0].assignments, [{ kind: "allDevices" }]);
    assert.equal(policies[0].settings.length, 1);
    assert.equal(policies[0].settings[0].settingDefinitionId, CAMERA_DEF_ID);
    assert.equal(policies[0].settings[0].value, "Not allowed.", "cameraBlocked: true should resolve to the blocked option");
  });

  await t.test("maps cameraBlocked: false to the allowed option", async () => {
    global.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/deviceManagement/deviceConfigurations?")) {
        return jsonResponse({
          value: [
            {
              id: "legacy-2",
              displayName: "Device Restrictions (Allow)",
              "@odata.type": "#microsoft.graph.windows10GeneralConfiguration",
              cameraBlocked: false,
              assignments: [],
            },
          ],
        });
      }
      if (u.endsWith(`/deviceManagement/configurationSettings/${CAMERA_DEF_ID}`)) {
        return jsonResponse(cameraDefinitionResponse());
      }
      if (u.endsWith(`/deviceManagement/configurationCategories/${CATEGORY_ID}`)) {
        return jsonResponse({ id: CATEGORY_ID, name: null, displayName: "Camera" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as typeof fetch;

    const policies = await fetchLegacyDeviceConfigurations("token");
    assert.equal(policies[0].settings[0].value, "Allowed.");
  });

  await t.test("a profile with no mapped property set produces no policy at all", async () => {
    global.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/deviceManagement/deviceConfigurations?")) {
        return jsonResponse({
          value: [
            {
              id: "legacy-3",
              displayName: "Unrelated Device Restrictions",
              "@odata.type": "#microsoft.graph.windows10GeneralConfiguration",
              // None of the five mapped properties are present — real
              // profiles usually only set a handful of the ~150 available.
              somethingUnmapped: true,
              assignments: [{ target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } }],
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as typeof fetch;

    const policies = await fetchLegacyDeviceConfigurations("token");
    assert.deepEqual(policies, []);
  });

  await t.test("a non-windows10GeneralConfiguration profile is ignored entirely", async () => {
    global.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/deviceManagement/deviceConfigurations?")) {
        return jsonResponse({
          value: [
            {
              id: "legacy-4",
              displayName: "A VPN Profile",
              "@odata.type": "#microsoft.graph.windowsVpnConfiguration",
              cameraBlocked: true, // shouldn't be read even if somehow present
              assignments: [],
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as typeof fetch;

    const policies = await fetchLegacyDeviceConfigurations("token");
    assert.deepEqual(policies, []);
  });
});
