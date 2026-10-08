import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBaselines } from "../../src/baselines/loader.js";

async function withTempDir(files: Record<string, string | Buffer>, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "intuneatlas-baselines-test-"));
  try {
    for (const [relPath, contents] of Object.entries(files)) {
      const full = join(dir, relPath);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, contents);
    }
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A Settings Catalog policy the way Intune exports it, trimmed to what matters. */
const exportedPolicy = (name: string, settings: unknown[], platforms = "windows10") =>
  JSON.stringify({
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationPolicy",
    name,
    platforms,
    settings: settings.map((settingInstance, i) => ({ id: String(i), settingInstance })),
  });
const choiceInstance = (id: string, option: string, children: unknown[] = []) => ({
  "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
  settingDefinitionId: id,
  choiceSettingValue: { value: `${id}_${option}`, children },
});
const integerInstance = (id: string, value: number) => ({
  "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
  settingDefinitionId: id,
  simpleSettingValue: { "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue", value },
});

test("loadBaselines: each setting of each exported policy becomes a rule, value kept as a tree", async () => {
  await withTempDir(
    {
      "oib/windows-v4.0/SettingsCatalog/defender.json": exportedPolicy("Defender AV", [
        choiceInstance("defender_tamper", "1"),
        choiceInstance("bitlocker_startup", "1", [integerInstance("bitlocker_startup_pin", 6)]),
      ]),
    },
    async (dir) => {
      const rules = await loadBaselines(dir);
      assert.equal(rules.length, 2);
      assert.deepEqual(rules[0], {
        id: "oib/windows-v4.0::Defender AV::defender_tamper",
        pack: "oib/windows-v4.0",
        source: "Oib Windows V4.0",
        policyName: "Defender AV",
        definitionId: "defender_tamper",
        platform: "windows10",
        expected: { kind: "choice", definitionId: "defender_tamper", name: "defender_tamper", optionId: "defender_tamper_1", label: "defender_tamper_1" },
        compare: "exact",
      });
      assert.deepEqual(rules[1].expected, {
        kind: "choice",
        definitionId: "bitlocker_startup",
        name: "bitlocker_startup",
        optionId: "bitlocker_startup_1",
        label: "bitlocker_startup_1",
        children: [{ kind: "simple", definitionId: "bitlocker_startup_pin", name: "bitlocker_startup_pin", value: 6 }],
      });
    },
  );
});

test("loadBaselines: a baseline download can be dropped in whole — everything that isn't a policy with settings in it is skipped", async () => {
  await withTempDir(
    {
      "oib/windows-v4.0/SettingsCatalog/a.json": exportedPolicy("A", [choiceInstance("s1", "1")]),
      "oib/windows-v4.0/CompliancePolicies/compliance.json": JSON.stringify({ "@odata.type": "#microsoft.graph.windows10CompliancePolicy", displayName: "C" }),
      "oib/windows-v4.0/PolicyManifest.json": JSON.stringify({ manifestVersion: "1.0", policies: [] }),
      "oib/windows-v4.0/broken.json": "{ not json",
      "oib/windows-v4.0/README.md": "# docs",
      "oib/windows-v4.0/Scripts/thing.ps1": "Write-Host hi",
    },
    async (dir) => {
      assert.deepEqual((await loadBaselines(dir)).map((r) => r.definitionId), ["s1"]);
    },
  );
});

test("loadBaselines: reads UTF-8 with a BOM and UTF-16 exports — real baselines ship both", async () => {
  const json = (id: string) => exportedPolicy("Encoded", [choiceInstance(id, "1")]);
  await withTempDir(
    {
      "p/v1/utf8bom.json": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json("bom"), "utf8")]),
      "p/v1/utf16le.json": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json("le"), "utf16le")]),
      "p/v1/utf16be.json": Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(json("be"), "utf16le").swap16()]),
    },
    async (dir) => {
      assert.deepEqual((await loadBaselines(dir)).map((r) => r.definitionId).sort(), ["be", "bom", "le"]);
    },
  );
});

test("loadBaselines: baseline.yml names the pack and annotates settings without touching their values", async () => {
  await withTempDir(
    {
      "contoso/2026.1/policy.json": exportedPolicy("Updates", [integerInstance("defer_days", 7), choiceInstance("cortana", "0"), choiceInstance("plain", "1")]),
      "contoso/2026.1/baseline.yml": `
name: Contoso baseline 2026.1
settings:
  defer_days:
    compare: atMost
    severity: high
    rationale: Patches should not wait longer than a week.
    reference: CIS 87.1
  cortana:
    ignore: true
`,
    },
    async (dir) => {
      const rules = await loadBaselines(dir);
      assert.deepEqual(rules.map((r) => r.definitionId), ["defer_days", "plain"], "an ignored setting is left out entirely");
      const [defer, plain] = rules;
      assert.equal(defer.source, "Contoso baseline 2026.1");
      assert.equal(defer.compare, "atMost");
      assert.equal(defer.severity, "high");
      assert.equal(defer.rationale, "Patches should not wait longer than a week.");
      assert.equal(defer.reference, "CIS 87.1");
      assert.deepEqual(defer.expected, { kind: "simple", definitionId: "defer_days", name: "defer_days", value: 7 });
      assert.equal(plain.compare, "exact");
      assert.equal("severity" in plain, false);
    },
  );
});

test("loadBaselines: an invalid severity or compare in baseline.yml throws, naming the file and setting", async () => {
  for (const [field, value] of [
    ["severity", "catastrophic"],
    ["compare", "roughly"],
  ]) {
    await withTempDir(
      { "p/v1/x.json": exportedPolicy("X", [choiceInstance("s1", "1")]), "p/v1/baseline.yml": `settings:\n  s1:\n    ${field}: ${value}\n` },
      async (dir) => {
        await assert.rejects(loadBaselines(dir), new RegExp(`baseline\\.yml: settings\\.s1\\.${field}`));
      },
    );
  }
});

test("loadBaselines: a baseline.yml deeper inside a pack is not treated as its annotations", async () => {
  await withTempDir(
    { "p/v1/x.json": exportedPolicy("X", [choiceInstance("s1", "1")]), "p/v1/nested/baseline.yml": "name: Not this one\n" },
    async (dir) => {
      assert.equal((await loadBaselines(dir))[0].source, "P V1");
    },
  );
});

test("loadBaselines: pack is the file's first two path segments, forward-slash-joined regardless of platform", async () => {
  await withTempDir(
    {
      "cis/windows-11-l1/a/b/c.json": exportedPolicy("Deep", [choiceInstance("s1", "1")]),
      "loose.json": exportedPolicy("Loose", [choiceInstance("s2", "1")]),
    },
    async (dir) => {
      const rules = await loadBaselines(dir);
      assert.equal(rules.find((r) => r.definitionId === "s1")!.pack, "cis/windows-11-l1");
      assert.equal(rules.find((r) => r.definitionId === "s2")!.pack, "");
    },
  );
});

test("loadBaselines: several directories are read together; a missing one is not an error", async () => {
  await withTempDir({ "a/v1/x.json": exportedPolicy("X", [choiceInstance("s1", "1")]) }, async (first) => {
    await withTempDir({ "b/v1/y.json": exportedPolicy("Y", [choiceInstance("s2", "1")]) }, async (second) => {
      const rules = await loadBaselines([first, join(first, "does-not-exist"), second]);
      assert.deepEqual(rules.map((r) => r.pack), ["a/v1", "b/v1"]);
    });
  });
});

test("loadBaselines: an empty directory produces an empty rule set, not an error", async () => {
  await withTempDir({}, async (dir) => {
    assert.deepEqual(await loadBaselines(dir), []);
  });
});

test("loadBaselines: a directory is parsed once and reused until one of its files changes", async () => {
  await withTempDir({ "p/v1/x.json": exportedPolicy("X", [choiceInstance("s1", "1")]) }, async (dir) => {
    const first = await loadBaselines(dir);
    assert.equal(await loadBaselines(dir).then((r) => r[0]), first[0], "unchanged files give back the very same parsed rules");

    // A changed value (same length, so only the modified time gives it away), a new file, a new annotation.
    await writeFile(join(dir, "p/v1/x.json"), exportedPolicy("X", [choiceInstance("s1", "0")]));
    await utimes(join(dir, "p/v1/x.json"), new Date(), new Date(Date.now() + 5000));
    assert.equal(((await loadBaselines(dir))[0].expected as { optionId: string }).optionId, "s1_0");

    await writeFile(join(dir, "p/v1/y.json"), exportedPolicy("Y", [choiceInstance("s2", "1")]));
    assert.equal((await loadBaselines(dir)).length, 2);

    await writeFile(join(dir, "p/v1/baseline.yml"), "name: Renamed\n");
    assert.equal((await loadBaselines(dir))[0].source, "Renamed");

    await rm(join(dir, "p/v1/y.json"));
    assert.equal((await loadBaselines(dir)).length, 1);
  });
});

test("loadBaselines: an exported compliance policy becomes one rule per setting it configures", async () => {
  await withTempDir(
    {
      "oib/windows-v4.0/CompliancePolicies/health.json": JSON.stringify({
        "@odata.type": "#microsoft.graph.windows10CompliancePolicy",
        id: "c1",
        displayName: "Win - Compliance - Device Health",
        passwordRequired: false,
        passwordMinimumLength: null,
        bitLockerEnabled: true,
        osMinimumVersion: "10.0.22631.0",
        scheduledActionsForRule: [{ ruleName: "PasswordRequired" }],
      }),
      "oib/windows-v4.0/baseline.yml": "settings:\n  compliance.windows10.osMinimumVersion:\n    severity: high\n",
    },
    async (dir) => {
      const rules = await loadBaselines(dir);
      assert.deepEqual(
        rules.map((r) => [r.definitionId, r.platform, r.policyName, r.severity]),
        [
          ["compliance.windows10.bitLockerEnabled", "windows10", "Win - Compliance - Device Health", undefined],
          ["compliance.windows10.osMinimumVersion", "windows10", "Win - Compliance - Device Health", "high"],
        ],
      );
      assert.deepEqual(rules[0].expected, {
        kind: "choice",
        definitionId: "compliance.windows10.bitLockerEnabled",
        name: "BitLocker enabled",
        optionId: "compliance.windows10.bitLockerEnabled_true",
        label: "Require",
      });
    },
  );
});

test("loadBaselines: an exported Linux compliance policy keeps its settings apart from configuration settings of the same id", async () => {
  await withTempDir(
    {
      "house/linux-v1/linux.json": JSON.stringify({
        "@odata.type": "#microsoft.graph.deviceManagementCompliancePolicy",
        name: "Linux compliance",
        platforms: "linux",
        technologies: "linuxMdm",
        settings: [{ settingInstance: integerInstance("linux_passwordpolicy_minimumlength", 12) }],
      }),
      // The same export with the type stripped, as some export tools write it.
      "house/linux-v1/untyped.json": JSON.stringify({ name: "Linux encryption", platforms: "linux", technologies: "linuxMdm", settings: [{ settingInstance: choiceInstance("linux_deviceencryption_required", "true") }] }),
      "house/linux-v1/config.json": exportedPolicy("Windows config", [integerInstance("linux_passwordpolicy_minimumlength", 8)]),
    },
    async (dir) => {
      const rules = await loadBaselines(dir);
      assert.deepEqual(
        rules.map((r) => [r.policyName, r.definitionId, r.platform]).sort(),
        [
          ["Linux compliance", "compliance.catalog.linux_passwordpolicy_minimumlength", "linux"],
          ["Linux encryption", "compliance.catalog.linux_deviceencryption_required", "linux"],
          ["Windows config", "linux_passwordpolicy_minimumlength", "windows10"],
        ],
      );
      assert.equal(rules.find((r) => r.policyName === "Linux compliance")?.expected.definitionId, "compliance.catalog.linux_passwordpolicy_minimumlength");
    },
  );
});

test("loadBaselines: the tenant-wide compliance settings, saved as Graph returns them, are part of a baseline", async () => {
  await withTempDir(
    { "house/v1/compliance-policy-settings.json": JSON.stringify({ secureByDefault: true, enhancedJailBreak: false, deviceComplianceCheckinThresholdDays: 30, enableLogCollection: true }) },
    async (dir) => {
      const rules = await loadBaselines(dir);
      assert.deepEqual(
        rules.map((r) => [r.definitionId, r.platform, r.policyName, r.expected.kind === "choice" ? r.expected.label : r.expected.kind === "simple" ? r.expected.value : ""]),
        [
          ["compliance.tenant.secureByDefault", "allPlatforms", "Compliance policy settings", "Not compliant"],
          ["compliance.tenant.enhancedJailBreak", "allPlatforms", "Compliance policy settings", "Disabled"],
          ["compliance.tenant.deviceComplianceCheckinThresholdDays", "allPlatforms", "Compliance policy settings", 30],
        ],
      );
    },
  );
});
