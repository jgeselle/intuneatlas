import assert from "node:assert/strict";
import { test } from "node:test";
import type { BaselineRule } from "../../src/baselines/types.js";
import { fetchCompliancePolicies } from "../../src/scan/compliancePolicies.js";
import { complianceSettingsOf } from "../../src/scan/complianceSettings.js";
import { buildSettingIndex } from "../../src/scan/index.js";
import { applyBaselinesToReport, type ScanReport } from "../../src/scan/report.js";
import { scopeToGroup } from "../../src/scan/scope.js";
import type { AssignmentTarget, RawPolicy } from "../../src/scan/types.js";

const WINDOWS = "#microsoft.graph.windows10CompliancePolicy";
const LENGTH = "compliance.windows10.passwordMinimumLength";
const BITLOCKER = "compliance.windows10.bitLockerEnabled";
const group = (groupId: string): AssignmentTarget => ({ kind: "group", groupId, excluded: false });

function compliancePolicy(id: string, assignments: AssignmentTarget[], properties: Record<string, unknown>): RawPolicy {
  return { id, name: id, platform: "windows10", assignments, settings: complianceSettingsOf({ "@odata.type": WINDOWS, ...properties }) };
}
function report(policies: RawPolicy[]): ScanReport {
  const settings = buildSettingIndex(policies, undefined, { conflicts: false });
  return {
    scannedAt: "2026-01-01T00:00:00.000Z",
    flow: "test",
    tenant: "contoso.onmicrosoft.com",
    policyCount: 0,
    legacyPolicyCount: 0,
    settingCount: settings.length,
    conflictCount: 0,
    belowBaselineCount: 0,
    settings,
    compliancePolicies: [],
    enrollmentConfigurations: [],
  };
}
function rule(definitionId: string, properties: Record<string, unknown>, compare: BaselineRule["compare"] = "exact"): BaselineRule {
  const expected = complianceSettingsOf({ "@odata.type": WINDOWS, ...properties }).find((s) => s.settingDefinitionId === definitionId)!.structured!;
  return { id: `b::${definitionId}`, pack: "b/v1", source: "Baseline", policyName: "Compliance", definitionId, platform: "windows10", expected, compare };
}

/** Everything read besides the typed policies (the Linux collection, the tenant-wide settings) — empty in the tests about those. */
const isCatalogList = (url: string | URL) => String(url).includes("/deviceManagement/compliancePolicies?") || String(url).endsWith("/deviceManagement/settings");
const emptyList = () => new Response(JSON.stringify({ value: [] }), { status: 200, headers: { "content-type": "application/json" } });

test("fetchCompliancePolicies: keeps each policy's identity, and its configured settings alongside", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  let requested = "";
  global.fetch = (async (url: string | URL) => {
    if (isCatalogList(url)) return emptyList();
    requested = String(url);
    return new Response(
      JSON.stringify({
        value: [
          {
            "@odata.type": WINDOWS,
            id: "c1",
            displayName: "Windows compliance",
            passwordRequired: true,
            passwordMinimumLength: 12,
            bitLockerEnabled: false,
            assignments: [{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g1" } }],
          },
          { "@odata.type": "#microsoft.graph.iosCompliancePolicy", id: "c2", displayName: "Empty iOS policy", passcodeRequired: false, assignments: [] },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const { policies, settings } = await fetchCompliancePolicies("token");

  assert.match(requested, /\/beta\/deviceManagement\/deviceCompliancePolicies\?/);
  assert.deepEqual(
    policies.map((p) => [p.id, p.name, p.platform, p.deployed]),
    [
      ["c1", "Windows compliance", "windows10", true],
      ["c2", "Empty iOS policy", "ios", false],
    ],
  );
  // The policy that configures nothing has no settings to contribute.
  assert.equal(settings.length, 1);
  assert.equal(settings[0].id, "c1");
  assert.equal(settings[0].platform, "windows10");
  assert.deepEqual(settings[0].assignments, [{ kind: "group", groupId: "g1", excluded: false }]);
  assert.deepEqual(
    settings[0].settings.map((s) => [s.settingDefinitionId, s.value]),
    [
      ["compliance.windows10.passwordRequired", "Require"],
      [LENGTH, "12"],
    ],
  );
});

test("compliance settings: differing values for the same group are not a conflict — Intune applies each policy on its own", () => {
  const policies = [compliancePolicy("a", [group("g1")], { passwordMinimumLength: 8 }), compliancePolicy("b", [group("g1")], { passwordMinimumLength: 12 })];

  const [entry] = report(policies).settings;
  assert.equal(entry.key, `${LENGTH}::windows10`);
  assert.equal(entry.conflict, false);
  assert.equal(entry.state, "Not checked");
  assert.deepEqual(entry.values, ["8", "12"]);

  // The same pair as configuration settings would be one.
  assert.equal(buildSettingIndex(policies)[0].state, "Conflict");
  // And narrowing to the group works it out again the same way.
  assert.equal(scopeToGroup(report(policies), "g1").settings[0].state, "Not checked");
});

test("compliance settings: judged against a baseline like any other setting — every assigned value has to meet it", () => {
  const scanned = report([
    compliancePolicy("a", [group("g1")], { passwordMinimumLength: 8, bitLockerEnabled: true }),
    compliancePolicy("b", [group("g2")], { passwordMinimumLength: 14 }),
  ]);
  const judged = applyBaselinesToReport(scanned, [rule(LENGTH, { passwordMinimumLength: 12 }, "atLeast"), rule(BITLOCKER, { bitLockerEnabled: true })]);
  const byId = Object.fromEntries(judged.settings.map((e) => [e.definitionId, e]));

  assert.equal(byId[BITLOCKER].state, "Meets baseline");
  assert.equal(byId[LENGTH].state, "Below baseline"); // one of the two policies asks for only 8
  assert.equal(byId[LENGTH].recs[0].recommended, "12");

  const g2 = applyBaselinesToReport(scopeToGroup(scanned, "g2"), [rule(LENGTH, { passwordMinimumLength: 12 }, "atLeast"), rule(BITLOCKER, { bitLockerEnabled: true })]);
  const forG2 = Object.fromEntries(g2.settings.map((e) => [e.definitionId, e]));
  assert.equal(forG2[LENGTH].state, "Meets baseline");
  assert.equal(forG2[BITLOCKER].state, "Missing"); // g2's policy doesn't ask for it
});

test("compliance settings: add up — a policy that meets the baseline makes up for one, for the same devices, that asks for less", () => {
  const atLeast12 = [rule(LENGTH, { passwordMinimumLength: 12 }, "atLeast")];
  const stateOf = (r: ScanReport) => applyBaselinesToReport(r, atLeast12).settings[0].state;

  // Both for the same group: a device there must satisfy both, so 14 is what holds.
  assert.equal(stateOf(report([compliancePolicy("a", [group("g1")], { passwordMinimumLength: 8 }), compliancePolicy("b", [group("g1")], { passwordMinimumLength: 14 })])), "Meets baseline");

  // Different groups: g1's devices are only asked for 8.
  const rings = report([compliancePolicy("a", [group("g1")], { passwordMinimumLength: 8 }), compliancePolicy("b", [group("g2")], { passwordMinimumLength: 14 })]);
  assert.equal(stateOf(rings), "Below baseline");

  // Narrowed to a group that gets both (one via everyone, one directly), the stricter one holds.
  const layered = report([compliancePolicy("a", [{ kind: "allDevices" }], { passwordMinimumLength: 8 }), compliancePolicy("b", [group("g2")], { passwordMinimumLength: 14 })]);
  assert.equal(stateOf(layered), "Below baseline"); // tenant-wide: devices outside g2 are only asked for 8
  assert.equal(stateOf(scopeToGroup(layered, "g2")), "Meets baseline");
  assert.equal(stateOf(scopeToGroup(layered, "g3")), "Below baseline");

  // Configuration settings don't add up: every assigned value has to meet the baseline.
  const asConfiguration = (value: number) => ({ settingDefinitionId: "x", name: "x", cspPath: "", category: "C", value: String(value), structured: { kind: "simple" as const, definitionId: "x", name: "x", value }, schemas: { x: { definitionId: "x", name: "x", kind: "simple" as const, valueType: "integer" as const } } });
  const configuration = { ...report([]), settings: buildSettingIndex([{ id: "a", name: "a", platform: "windows10", assignments: [group("g1")], settings: [asConfiguration(8)] }, { id: "b", name: "b", platform: "windows10", assignments: [group("g2")], settings: [asConfiguration(14)] }]) };
  const xRule: BaselineRule = { id: "b::x", pack: "b/v1", source: "Baseline", policyName: "P", definitionId: "x", platform: "windows10", expected: { kind: "simple", definitionId: "x", name: "x", value: 12 }, compare: "atLeast" };
  assert.equal(applyBaselinesToReport(configuration, [xRule]).settings[0].state, "Below baseline");
});

test("compliance settings: one a baseline expects and no policy has is Missing, already named — no Graph lookup needed", () => {
  const judged = applyBaselinesToReport(report([]), [rule("compliance.windows10.secureBootEnabled", { secureBootEnabled: true })]);

  assert.equal(judged.settings.length, 1);
  const [missing] = judged.settings;
  assert.equal(missing.state, "Missing");
  assert.equal(missing.name, "Secure boot enabled");
  assert.equal(missing.category, "Device health");
  assert.equal(missing.cspPath, "windows10CompliancePolicy/secureBootEnabled");
  assert.equal(missing.checks?.[0].expected, "Require");
  assert.deepEqual(Object.keys(missing.schemas ?? {}), ["compliance.windows10.secureBootEnabled"]);
});

test("fetchCompliancePolicies: asks for the actions for noncompliance, and goes on without them if Graph refuses", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const requested: string[] = [];
  const policy = { "@odata.type": WINDOWS, id: "c1", displayName: "Windows compliance", passwordRequired: true, assignments: [] };
  const withActions = { ...policy, scheduledActionsForRule: [{ ruleName: "PasswordRequired", scheduledActionConfigurations: [{ actionType: "block", gracePeriodHours: 12 }] }] };
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  global.fetch = (async (url: string | URL) => {
    if (isCatalogList(url)) return emptyList();
    requested.push(decodeURIComponent(String(url)));
    return respond(200, { value: [withActions] });
  }) as typeof fetch;
  const first = await fetchCompliancePolicies("token");
  assert.match(requested[0], /\$expand=assignments,scheduledActionsForRule\(\$expand=scheduledActionConfigurations\)/);
  assert.deepEqual(first.settings[0].settings.map((s) => s.value), ["Require", "Action: Block\nGrace period hours: 12"]);

  requested.length = 0;
  global.fetch = (async (url: string | URL) => {
    if (isCatalogList(url)) return emptyList();
    requested.push(decodeURIComponent(String(url)));
    return String(url).includes("scheduledActionsForRule") ? respond(400, { error: { message: "nested expand not supported" } }) : respond(200, { value: [policy] });
  }) as typeof fetch;
  const second = await fetchCompliancePolicies("token");
  assert.equal(requested.length, 2);
  assert.match(requested[1], /\$expand=assignments$/);
  assert.deepEqual(second.settings[0].settings.map((s) => s.value), ["Require"]);

  // Anything other than a refusal of the request itself still fails the scan.
  global.fetch = (async () => respond(403, { error: { message: "Forbidden" } })) as typeof fetch;
  await assert.rejects(fetchCompliancePolicies("token"), /403/);
});

test("compliance settings: a baseline's actions for noncompliance are a floor — each has to be there, extra ones are fine", () => {
  const ACTIONS = "compliance.windows10.scheduledActionsForRule";
  const actions = (...items: Array<[string, number]>) => ({ scheduledActionsForRule: [{ ruleName: "PasswordRequired", scheduledActionConfigurations: items.map(([actionType, gracePeriodHours]) => ({ actionType, gracePeriodHours })) }] });
  const baseline = [rule(ACTIONS, actions(["block", 0], ["retire", 720]))];
  const judge = (...items: Array<[string, number]>) => applyBaselinesToReport(report([compliancePolicy("a", [group("g1")], actions(...items))]), baseline).settings[0];

  assert.equal(judge(["block", 0], ["notification", 24], ["retire", 720]).state, "Meets baseline");
  const late = judge(["block", 24], ["retire", 720]);
  assert.equal(late.state, "Below baseline");
  assert.deepEqual(late.checks?.[0].differences, [{ path: ["Grace period hours"], expected: "0", actual: "24" }]);
});

test("fetchCompliancePolicies: reads Linux compliance policies too — Settings Catalog format, definitions from the compliance catalog", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const DISTROS = "linux_distribution_alloweddistros";
  // Shapes as returned by a live tenant's complianceSettings.
  const definitions: Record<string, unknown> = {
    linux_passwordpolicy_minimumlength: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingDefinition",
      id: "linux_passwordpolicy_minimumlength",
      displayName: "Minimum Length",
      baseUri: "com.microsoft.manage.LinuxMdm",
      offsetUri: "/PasswordPolicy/MinimumLength",
      categoryId: "cat-password",
      valueDefinition: { "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValueDefinition", minimumValue: 1, maximumValue: 127 },
    },
    [DISTROS]: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSettingGroupCollectionDefinition",
      id: DISTROS,
      displayName: "Allowed Distros",
      baseUri: "com.microsoft.manage.LinuxMdm",
      offsetUri: "/Distribution/AllowedDistros",
      categoryId: "cat-distros",
      childIds: [`${DISTROS}_item_$type`, `${DISTROS}_item_minimumversion`],
    },
    [`${DISTROS}_item_$type`]: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingDefinition",
      id: `${DISTROS}_item_$type`,
      displayName: "Type",
      baseUri: "com.microsoft.manage.LinuxMdm",
      offsetUri: "/Distribution/AllowedDistros/{0}/$type",
      categoryId: "cat-distros",
      options: [
        { itemId: `${DISTROS}_item_$type_ubuntu`, displayName: "Ubuntu" },
        { itemId: `${DISTROS}_item_$type_rhel`, displayName: "RHEL" },
      ],
    },
    [`${DISTROS}_item_minimumversion`]: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingDefinition",
      id: `${DISTROS}_item_minimumversion`,
      displayName: "Minimum OS Version",
      baseUri: "com.microsoft.manage.LinuxMdm",
      offsetUri: "/Distribution/AllowedDistros/{0}/MinimumVersion",
      categoryId: "cat-distros",
      valueDefinition: { "@odata.type": "#microsoft.graph.deviceManagementConfigurationStringSettingValueDefinition" },
    },
  };
  const asked: string[] = [];
  global.fetch = (async (input: string | URL) => {
    const url = decodeURIComponent(String(input));
    asked.push(url);
    if (url.includes("/deviceManagement/deviceCompliancePolicies?")) return respond(200, { value: [] });
    // Only the policy's own route returns its actions (as a live tenant does).
    if (url.includes("/deviceManagement/compliancePolicies/lx1/scheduledActionsForRule?$expand=scheduledActionConfigurations")) {
      return respond(200, { value: [{ id: "lx1", ruleName: null, scheduledActionConfigurations: [{ actionType: "block", gracePeriodHours: 48, notificationTemplateId: "00000000-0000-0000-0000-000000000000" }] }] });
    }
    if (url.includes("/deviceManagement/compliancePolicies?")) {
      return respond(200, {
        value: [{ id: "lx1", name: "Linux compliance", platforms: "linux", technologies: "linuxMdm", assignments: [{ target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } }] }],
      });
    }
    if (url.includes("/deviceManagement/compliancePolicies/lx1/settings")) {
      return respond(200, {
        value: [
          { settingInstance: { settingDefinitionId: "linux_passwordpolicy_minimumlength", simpleSettingValue: { value: 12 } } },
          {
            settingInstance: {
              settingDefinitionId: DISTROS,
              groupSettingCollectionValue: [
                {
                  children: [
                    { settingDefinitionId: `${DISTROS}_item_$type`, choiceSettingValue: { value: `${DISTROS}_item_$type_ubuntu`, children: [] } },
                    { settingDefinitionId: `${DISTROS}_item_minimumversion`, simpleSettingValue: { value: "22.04" } },
                  ],
                },
              ],
            },
          },
        ],
      });
    }
    const category = /\/configurationCategories\/(cat-\w+)/.exec(url);
    if (category) return respond(200, { id: category[1], displayName: category[1] === "cat-password" ? "Password Policy" : "Allowed Distributions" });
    const definition = /\/complianceSettings(?:\/|\(')([^?')]+)/.exec(url);
    if (definition && definitions[definition[1]]) return respond(200, definitions[definition[1]]);
    return respond(404, { error: { message: `unexpected ${url}` } });
  }) as typeof fetch;

  const { policies, settings } = await fetchCompliancePolicies("token");

  assert.deepEqual(policies, [{ id: "lx1", name: "Linux compliance", platform: "linux", deployed: true, targets: [{ kind: "allDevices" }] }]);
  assert.equal(settings.length, 1);
  const [length, distros, actions] = settings[0].settings;

  // Its actions for noncompliance are read like a typed policy's.
  assert.equal(actions.settingDefinitionId, "compliance.linux.scheduledActionsForRule");
  assert.equal(actions.value, "Action: Block\nGrace period hours: 48");

  // Never asked of the configuration catalog — a live tenant answers 404 there.
  assert.equal(asked.some((url) => url.includes("/configurationSettings")), false);

  assert.equal(length.settingDefinitionId, "compliance.catalog.linux_passwordpolicy_minimumlength");
  assert.equal(length.name, "Minimum Length");
  assert.equal(length.category, "Password Policy");
  assert.equal(length.value, "12");
  assert.deepEqual(length.schemas?.[length.settingDefinitionId], {
    definitionId: "compliance.catalog.linux_passwordpolicy_minimumlength",
    name: "Minimum Length",
    kind: "simple",
    valueType: "integer",
    min: 1,
    max: 127,
  });

  assert.equal(distros.value, "Type: Ubuntu\nMinimum OS Version: 22.04");
  const schema = distros.schemas?.[`compliance.catalog.${DISTROS}`];
  assert.deepEqual(schema?.childIds, [`compliance.catalog.${DISTROS}_item_$type`, `compliance.catalog.${DISTROS}_item_minimumversion`]);
  // What a value stores — the option id — stays Graph's own.
  assert.deepEqual(distros.schemas?.[`compliance.catalog.${DISTROS}_item_$type`].options?.map((o) => o.id), [`${DISTROS}_item_$type_ubuntu`, `${DISTROS}_item_$type_rhel`]);

  // In the index they are compliance settings like the rest.
  const [entry] = buildSettingIndex(settings, undefined, { conflicts: false }).filter((e) => e.name === "Minimum Length");
  assert.equal(entry.key, "compliance.catalog.linux_passwordpolicy_minimumlength::linux");
});

test("fetchCompliancePolicies: a tenant where the Linux collection can't be listed is scanned without it", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  global.fetch = (async (url: string | URL) =>
    isCatalogList(url) ? respond(404, { error: { message: "Resource not found for the segment 'compliancePolicies'" } }) : respond(200, { value: [] })) as typeof fetch;

  assert.deepEqual(await fetchCompliancePolicies("token"), { policies: [], settings: [] });
});

test("fetchCompliancePolicies: the tenant-wide compliance settings are settings of a stand-in policy that reaches everyone", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  // As a live tenant that never touched them returns it.
  let tenant: Record<string, unknown> = { deviceComplianceCheckinThresholdDays: 0, isScheduledActionEnabled: true, secureByDefault: false, enhancedJailBreak: false, derivedCredentialProvider: "notConfigured" };
  global.fetch = (async (url: string | URL) => (String(url).endsWith("/deviceManagement/settings") ? respond(200, tenant) : respond(200, { value: [] }))) as typeof fetch;

  const untouched = await fetchCompliancePolicies("token");
  assert.deepEqual(untouched.policies, []); // not counted among the compliance policies
  assert.deepEqual(
    untouched.settings.map((p) => [p.id, p.name, p.platform, p.assignments]),
    [["tenant-compliance-settings", "Compliance policy settings", "allPlatforms", [{ kind: "allDevices" }]]],
  );
  // Both switches always show — "compliant without a policy" is a choice. The validity period doesn't while Graph reports 0.
  assert.deepEqual(
    untouched.settings[0].settings.map((s) => [s.settingDefinitionId, s.name, s.value]),
    [
      ["compliance.tenant.secureByDefault", "Mark devices with no compliance policy assigned as", "Compliant"],
      ["compliance.tenant.enhancedJailBreak", "Enhanced jailbreak detection", "Disabled"],
    ],
  );

  tenant = { ...tenant, secureByDefault: true, deviceComplianceCheckinThresholdDays: 30 };
  const hardened = await fetchCompliancePolicies("token");
  assert.deepEqual(
    hardened.settings[0].settings.map((s) => s.value),
    ["Not compliant", "Disabled", "30"],
  );

  // Judged like any setting, for every group.
  const index = buildSettingIndex(untouched.settings, undefined, { conflicts: false });
  const scanned: ScanReport = { ...report([]), settings: index };
  const expectSecure: BaselineRule = {
    id: "b::secure",
    pack: "b/v1",
    source: "Baseline",
    policyName: "Compliance policy settings",
    definitionId: "compliance.tenant.secureByDefault",
    platform: "allPlatforms",
    expected: hardened.settings[0].settings[0].structured!,
    compare: "exact",
  };
  const judged = applyBaselinesToReport(scopeToGroup(scanned, "any-group"), [expectSecure]).settings.find((e) => e.definitionId === "compliance.tenant.secureByDefault");
  assert.equal(judged?.state, "Below baseline");
  assert.equal(judged?.recs[0].recommended, "Not compliant");
});

test("fetchCompliancePolicies: shows notification templates and compliance scripts by name where it can read them", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const rules = { Rules: [{ SettingName: "BiosVersion", Operator: "GreaterEquals", DataType: "Version", Operand: "2.3", MoreInfoUrl: "https://example.com", RemediationStrings: [{ Language: "en_US", Title: "t", Description: "d" }] }] };
  const policy = {
    "@odata.type": WINDOWS,
    id: "c1",
    displayName: "Windows compliance",
    deviceCompliancePolicyScript: { deviceComplianceScriptId: "script-1", rulesContent: Buffer.from(JSON.stringify(rules)).toString("base64") },
    scheduledActionsForRule: [{ ruleName: null, scheduledActionConfigurations: [{ actionType: "notification", gracePeriodHours: 24, notificationTemplateId: "tpl-1", notificationMessageCCList: [] }] }],
    assignments: [],
  };
  let scriptsAllowed = true;
  global.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/deviceCompliancePolicies?")) return respond(200, { value: [structuredClone(policy)] });
    if (url.includes("/notificationMessageTemplates")) return respond(200, { value: [{ id: "tpl-1", displayName: "Fix your device" }] });
    if (url.includes("/deviceComplianceScripts")) return scriptsAllowed ? respond(200, { value: [{ id: "script-1", displayName: "BIOS check" }] }) : respond(403, { error: { message: "needs DeviceManagementScripts.Read.All" } });
    return respond(404, {});
  }) as typeof fetch;

  const values = async () => Object.fromEntries((await fetchCompliancePolicies("token")).settings[0].settings.map((s) => [s.name, s.value]));

  assert.deepEqual(await values(), {
    "Device compliance policy script": "Script name: BIOS check\nRules: Setting name: BiosVersion\nRules: Operator: GreaterEquals\nRules: Data type: Version\nRules: Operand: 2.3",
    "Actions for noncompliance": "Action: Notification\nGrace period hours: 24\nNotification template name: Fix your device",
  });

  // Without the extra permission the script's name is missing; its rules, which sit on the policy, are still there.
  scriptsAllowed = false;
  assert.equal((await values())["Device compliance policy script"], "Rules: Setting name: BiosVersion\nRules: Operator: GreaterEquals\nRules: Data type: Version\nRules: Operand: 2.3");
});
