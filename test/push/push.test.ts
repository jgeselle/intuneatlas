import assert from "node:assert/strict";
import { test } from "node:test";
import { pushNewPolicy, pushToExistingPolicy, PushRefused } from "../../src/push/index.js";
import { complianceSettingsOf, tenantComplianceSettingsOf } from "../../src/scan/complianceSettings.js";

const T = "#microsoft.graph.deviceManagementConfiguration";
const respond = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/** A tenant just big enough: answers reads from `reads`, records every write, accepts them all. */
function fakeGraph(t: { after: (fn: () => void) => void }, reads: Record<string, unknown>): Call[] {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const calls: Call[] = [];
  global.fetch = (async (input: string | URL, init?: RequestInit) => {
    const path = decodeURIComponent(String(input)).replace("https://graph.microsoft.com/beta", "");
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      calls.push({ method, path, body: JSON.parse(String(init?.body)) });
      return method === "POST" ? respond(201, { id: "new-policy-id" }) : respond(204, null);
    }
    const match = Object.keys(reads).find((key) => path.startsWith(key));
    return match ? respond(200, reads[match]) : respond(404, { error: { message: `unexpected ${path}` } });
  }) as typeof fetch;
  return calls;
}

const definition = (id: string, extra: object) => ({ id, displayName: id, baseUri: "./x", offsetUri: `/${id}`, categoryId: "cat", ...extra });
const DEFINITIONS = {
  "/deviceManagement/configurationCategories/cat": { id: "cat", displayName: "Category" },
  "/deviceManagement/configurationSettings/push_defer": definition("push_defer", {
    "@odata.type": `${T}SimpleSettingDefinition`,
    valueDefinition: { "@odata.type": `${T}IntegerSettingValueDefinition` },
    applicability: { platform: "windows10", technologies: "mdm" },
  }),
  "/deviceManagement/configurationSettings/push_camera": definition("push_camera", {
    "@odata.type": `${T}ChoiceSettingDefinition`,
    options: [
      { itemId: "push_camera_0", displayName: "Not allowed." },
      { itemId: "push_camera_1", displayName: "Allowed." },
    ],
  }),
};
const camera = { "@odata.type": `${T}ChoiceSettingInstance`, settingDefinitionId: "push_camera", settingInstanceTemplateReference: null, choiceSettingValue: { "@odata.type": `${T}ChoiceSettingValue`, value: "push_camera_0", children: [] } };
const defer = { "@odata.type": `${T}SimpleSettingInstance`, settingDefinitionId: "push_defer", simpleSettingValue: { "@odata.type": `${T}IntegerSettingValue`, value: 14 } };
const catalogPolicy = () => ({
  "/deviceManagement/configurationPolicies/p1/settings": { value: [{ id: "0", settingInstance: camera }, { id: "1", settingInstance: defer }] },
  "/deviceManagement/configurationPolicies/p1": { id: "p1", name: "Update ring", description: "Pilot", platforms: "windows10", technologies: "mdm", roleScopeTagIds: ["0", "7"], templateReference: { templateId: "" } },
});
const deferTo = (value: number) => ({ kind: "simple" as const, definitionId: "push_defer", name: "Defer", value });

test("push: a Settings Catalog policy is sent back whole, every other setting exactly as it was read", async (t) => {
  const calls = fakeGraph(t, { ...catalogPolicy(), ...DEFINITIONS });

  await pushToExistingPolicy("token", { policyId: "p1", definitionId: "push_defer", from: "14", node: deferTo(7) });

  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].method, calls[0].path], ["PUT", "/deviceManagement/configurationPolicies/p1"]);
  assert.deepEqual(calls[0].body, {
    name: "Update ring",
    description: "Pilot",
    platforms: "windows10",
    technologies: "mdm",
    roleScopeTagIds: ["0", "7"],
    templateReference: { templateId: "" },
    settings: [
      { "@odata.type": `${T}Setting`, settingInstance: camera },
      { "@odata.type": `${T}Setting`, settingInstance: { ...defer, simpleSettingValue: { "@odata.type": `${T}IntegerSettingValue`, value: 7 } } },
    ],
  });
});

test("push: refused — and nothing written — when the tenant no longer holds what the change was staged from", async (t) => {
  const calls = fakeGraph(t, { ...catalogPolicy(), ...DEFINITIONS });

  // Staged when the value was 30; someone has since made it 14.
  await assert.rejects(pushToExistingPolicy("token", { policyId: "p1", definitionId: "push_defer", from: "30", node: deferTo(7) }), (err: Error) => err instanceof PushRefused && /it was "30", it is now "14"/.test(err.message));
  // The policy stopped setting it altogether.
  await assert.rejects(pushToExistingPolicy("token", { policyId: "p1", definitionId: "push_gone", from: "1", node: { kind: "simple", definitionId: "push_gone", name: "Gone", value: 2 } }), PushRefused);
  // The policy itself is gone, or was never a Settings Catalog policy (a legacy profile).
  await assert.rejects(pushToExistingPolicy("token", { policyId: "nope", definitionId: "push_defer", from: "14", node: deferTo(7) }), PushRefused);
  assert.deepEqual(calls, []);
});

test("push: in a policy created from a template the changed setting gets its template references back", async (t) => {
  const TEMPLATE = "804339ad-1553-4478-a742-138fb5807418_1";
  // As a live tenant returns them: the stored instance names its slots, and so does the template.
  const stored = {
    ...defer,
    settingInstanceTemplateReference: { settingInstanceTemplateId: "slot-defer" },
    simpleSettingValue: { ...defer.simpleSettingValue, settingValueTemplateReference: { settingValueTemplateId: "value-defer", useTemplateDefault: false } },
  };
  const reads = {
    "/deviceManagement/configurationPolicies/p1/settings": { value: [{ id: "0", settingInstance: camera }, { id: "1", settingInstance: stored }] },
    "/deviceManagement/configurationPolicies/p1": { id: "p1", name: "Antivirus", description: "", platforms: "windows10", technologies: "mdm,microsoftSense", templateReference: { templateId: TEMPLATE, templateFamily: "endpointSecurityAntivirus" } },
    [`/deviceManagement/configurationPolicyTemplates/${TEMPLATE}/settingTemplates`]: {
      value: [{ settingInstanceTemplate: { settingInstanceTemplateId: "slot-defer", settingDefinitionId: "push_defer", simpleSettingValueTemplate: { settingValueTemplateId: "value-defer" } } }],
    },
    ...DEFINITIONS,
  };
  const calls = fakeGraph(t, reads);

  await pushToExistingPolicy("token", { policyId: "p1", definitionId: "push_defer", from: "14", node: deferTo(7) });

  const body = calls[0].body as { templateReference: unknown; technologies: string; settings: Array<{ settingInstance: Record<string, unknown> }> };
  assert.deepEqual(body.templateReference, { templateId: TEMPLATE });
  assert.equal(body.technologies, "mdm,microsoftSense");
  assert.deepEqual(body.settings[1].settingInstance, {
    "@odata.type": `${T}SimpleSettingInstance`,
    settingDefinitionId: "push_defer",
    settingInstanceTemplateReference: { settingInstanceTemplateId: "slot-defer" },
    simpleSettingValue: { "@odata.type": `${T}IntegerSettingValue`, value: 7, settingValueTemplateReference: { settingValueTemplateId: "value-defer" } },
  });

  // A template that can no longer be read (retired): what the stored instance names is enough.
  calls.length = 0;
  delete (reads as Record<string, unknown>)[`/deviceManagement/configurationPolicyTemplates/${TEMPLATE}/settingTemplates`];
  await pushToExistingPolicy("token", { policyId: "p1", definitionId: "push_defer", from: "14", node: deferTo(3) });
  const again = (calls[0].body as typeof body).settings[1].settingInstance;
  assert.deepEqual(again.settingInstanceTemplateReference, { settingInstanceTemplateId: "slot-defer" });
  assert.deepEqual((again.simpleSettingValue as Record<string, unknown>).settingValueTemplateReference, { settingValueTemplateId: "value-defer" });
});

test("push: a typed compliance policy gets only the one property", async (t) => {
  const WINDOWS = "#microsoft.graph.windows10CompliancePolicy";
  const calls = fakeGraph(t, { "/deviceManagement/deviceCompliancePolicies/c1": { "@odata.type": WINDOWS, id: "c1", displayName: "Compliance", passwordMinimumLength: 8, bitLockerEnabled: true } });
  const node = (n: number) => complianceSettingsOf({ "@odata.type": WINDOWS, passwordMinimumLength: n })[0].structured!;
  const LEN = "compliance.windows10.passwordMinimumLength";

  await pushToExistingPolicy("token", { policyId: "c1", definitionId: LEN, from: "8", node: node(14) });
  assert.deepEqual(calls, [{ method: "PATCH", path: "/deviceManagement/deviceCompliancePolicies/c1", body: { "@odata.type": WINDOWS, passwordMinimumLength: 14 } }]);

  calls.length = 0;
  await assert.rejects(pushToExistingPolicy("token", { policyId: "c1", definitionId: LEN, from: "12", node: node(14) }), PushRefused);
  // The parts of a compliance policy that can't be written faithfully are refused before anything is read.
  await assert.rejects(
    pushToExistingPolicy("token", { policyId: "c1", definitionId: "compliance.windows10.scheduledActionsForRule", from: "x", node: { kind: "groupCollection", definitionId: "compliance.windows10.scheduledActionsForRule", name: "Actions", groups: [] } }),
    PushRefused,
  );
  assert.deepEqual(calls, []);
});

test("push: a tenant-wide compliance setting gets only the one field", async (t) => {
  const calls = fakeGraph(t, { "/deviceManagement/settings": { secureByDefault: false, enhancedJailBreak: false, deviceComplianceCheckinThresholdDays: 0, enableLogCollection: true } });
  const [secure] = tenantComplianceSettingsOf({ secureByDefault: true, enhancedJailBreak: false });

  await pushToExistingPolicy("token", { policyId: "tenant-compliance-settings", definitionId: secure.settingDefinitionId, from: "Compliant", node: secure.structured! });

  assert.deepEqual(calls, [{ method: "PATCH", path: "/deviceManagement", body: { settings: { secureByDefault: true } } }]);
});

test("push: a new Settings Catalog policy is created from its settings, for the platform their definition names", async (t) => {
  const calls = fakeGraph(t, DEFINITIONS);

  const { policyId } = await pushNewPolicy("token", {
    name: "Baseline – Updates",
    platform: "windows10",
    settings: [
      { definitionId: "push_defer", node: deferTo(7) },
      { definitionId: "push_camera", node: { kind: "choice", definitionId: "push_camera", name: "Camera", optionId: "push_camera_1", label: "Allowed." } },
    ],
  });

  assert.equal(policyId, "new-policy-id");
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].method, calls[0].path], ["POST", "/deviceManagement/configurationPolicies"]);
  const body = calls[0].body!;
  assert.deepEqual([body.name, body.platforms, body.technologies], ["Baseline – Updates", "windows10", "mdm"]);
  assert.deepEqual((body.settings as Array<{ settingInstance: { settingDefinitionId: string } }>).map((s) => s.settingInstance.settingDefinitionId), ["push_defer", "push_camera"]);
  // Nothing in what is sent assigns it to anyone.
  assert.equal("assignments" in body, false);
});

test("push: a new compliance policy is one type, with the action Intune requires of every compliance policy", async (t) => {
  const calls = fakeGraph(t, {});
  const settings = (policy: Record<string, unknown>) => complianceSettingsOf(policy).map((s) => ({ definitionId: s.settingDefinitionId, node: s.structured! }));
  const windows = settings({ "@odata.type": "#microsoft.graph.windows10CompliancePolicy", bitLockerEnabled: true, passwordMinimumLength: 12 });

  await pushNewPolicy("token", { name: "Baseline – Compliance", platform: "windows10", settings: windows });

  assert.deepEqual(calls, [
    {
      method: "POST",
      path: "/deviceManagement/deviceCompliancePolicies",
      body: {
        "@odata.type": "#microsoft.graph.windows10CompliancePolicy",
        displayName: "Baseline – Compliance",
        bitLockerEnabled: true,
        passwordMinimumLength: 12,
        scheduledActionsForRule: [{ ruleName: "PasswordRequired", scheduledActionConfigurations: [{ actionType: "block", gracePeriodHours: 0, notificationTemplateId: "", notificationMessageCCList: [] }] }],
      },
    },
  ]);

  calls.length = 0;
  const ios = settings({ "@odata.type": "#microsoft.graph.iosCompliancePolicy", passcodeRequired: true });
  await assert.rejects(pushNewPolicy("token", { name: "Mixed platforms", platform: "windows10", settings: [...windows, ...ios] }), (err: Error) => err instanceof PushRefused && /more than one platform/.test(err.message));
  await assert.rejects(pushNewPolicy("token", { name: "Mixed kinds", platform: "windows10", settings: [...windows, { definitionId: "push_defer", node: deferTo(7) }] }), (err: Error) => err instanceof PushRefused && /mixes/.test(err.message));
  await assert.rejects(pushNewPolicy("token", { name: "Empty", platform: "windows10", settings: [] }), PushRefused);
  assert.deepEqual(calls, []);
});
