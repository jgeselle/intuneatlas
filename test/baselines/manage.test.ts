import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBaselines } from "../../src/baselines/loader.js";
import { addPack, BaselineInputError, removePack, renamePack } from "../../src/baselines/manage.js";

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  // One level down, so there is a real parent directory an escape attempt could land in.
  const outer = await mkdtemp(join(tmpdir(), "intuneatlas-manage-test-"));
  try {
    await run(join(outer, "baselines"));
    assert.deepEqual(
      (await import("node:fs/promises").then((fs) => fs.readdir(outer))).filter((n) => n !== "baselines"),
      [],
      "nothing may ever be written outside the baselines root",
    );
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const policy = (name: string, id: string) =>
  b64(JSON.stringify({ name, platforms: "windows10", settings: [{ settingInstance: { settingDefinitionId: id, choiceSettingValue: { value: `${id}_1`, children: [] } } }] }));

test("addPack: writes the exported policies under source/version and makes them loadable", async () => {
  await withRoot(async (root) => {
    const pack = await addPack(root, {
      source: "OIB",
      version: "Windows v4.0",
      name: "Open Intune Baseline – Windows v4.0",
      files: [
        { path: "SettingsCatalog/defender.json", contentBase64: policy("Defender", "tamper") },
        { path: "SettingsCatalog/bitlocker.json", contentBase64: policy("BitLocker", "encrypt") },
        { path: "README.md", contentBase64: b64("# docs") },
        { path: "Scripts/run.ps1", contentBase64: b64("Write-Host hi") },
      ],
    });
    assert.equal(pack, "oib/windows-v4.0", "free text becomes safe folder names");
    assert.equal(existsSync(join(root, "oib/windows-v4.0/SettingsCatalog/defender.json")), true);
    assert.equal(existsSync(join(root, "oib/windows-v4.0/README.md")), false, "only policy files and baseline.yml are kept");
    assert.equal(existsSync(join(root, "oib/windows-v4.0/Scripts")), false);

    const rules = await loadBaselines(root);
    assert.deepEqual(rules.map((r) => [r.pack, r.source, r.definitionId]).sort(), [
      ["oib/windows-v4.0", "Open Intune Baseline – Windows v4.0", "encrypt"],
      ["oib/windows-v4.0", "Open Intune Baseline – Windows v4.0", "tamper"],
    ]);
  });
});

test("addPack: paths that try to leave the pack are dropped, never written", async () => {
  await withRoot(async (root) => {
    await addPack(root, {
      source: "s",
      version: "v1",
      files: [
        { path: "ok.json", contentBase64: policy("OK", "a") },
        { path: "../escape.json", contentBase64: policy("Up", "b") },
        { path: "../../escape.json", contentBase64: policy("UpUp", "c") },
        { path: "sub/../../../escape.json", contentBase64: policy("Sneaky", "d") },
        { path: "C:\\Windows\\evil.json", contentBase64: policy("Drive", "e") },
        { path: "nul\u0000byte.json", contentBase64: policy("Nul", "f") },
      ],
    });
    assert.deepEqual((await loadBaselines(root)).map((r) => r.definitionId), ["a"]);
  });
});

test("addPack: refuses an upload with no Settings Catalog policy in it, and writes nothing", async () => {
  await withRoot(async (root) => {
    await assert.rejects(
      addPack(root, { source: "s", version: "v1", files: [{ path: "compliance.json", contentBase64: b64(JSON.stringify({ displayName: "C" })) }, { path: "broken.json", contentBase64: b64("{ nope") }] }),
      (err: unknown) => err instanceof BaselineInputError && /Settings Catalog policy/.test(err.message),
    );
    assert.equal(existsSync(join(root, "s")), false);
  });
});

test("addPack: refuses to overwrite an existing baseline, and requires a source and a version", async () => {
  await withRoot(async (root) => {
    const files = [{ path: "p.json", contentBase64: policy("P", "a") }];
    await addPack(root, { source: "s", version: "v1", files });
    await assert.rejects(addPack(root, { source: "S", version: "V1", files }), /already exists/);
    await assert.rejects(addPack(root, { source: "  ", version: "v2", files }), /Source is required/);
    await assert.rejects(addPack(root, { source: "s", version: "../..", files }), /Name and version is required/);
    await assert.rejects(addPack(root, { source: "s", version: "v3", files: [] }), /No files/);
  });
});

test("addPack: a baseline.yml at the top of the upload is kept; one deeper is not treated as annotations", async () => {
  await withRoot(async (root) => {
    await addPack(root, {
      source: "s",
      version: "v1",
      files: [
        { path: "p.json", contentBase64: policy("P", "a") },
        { path: "baseline.yml", contentBase64: b64("name: From the download\nsettings:\n  a:\n    severity: high\n") },
        { path: "nested/baseline.yml", contentBase64: b64("name: Not this\n") },
      ],
    });
    const [rule] = await loadBaselines(root);
    assert.equal(rule.source, "From the download");
    assert.equal(rule.severity, "high");
    assert.equal(existsSync(join(root, "s/v1/nested")), false);
  });
});

test("renamePack: sets the display name and keeps the setting annotations", async () => {
  await withRoot(async (root) => {
    await addPack(root, {
      source: "s",
      version: "v1",
      files: [
        { path: "p.json", contentBase64: policy("P", "a") },
        { path: "baseline.yml", contentBase64: b64("name: Old\nsettings:\n  a:\n    severity: critical\n    rationale: Because.\n") },
      ],
    });
    await renamePack(root, "s/v1", "  New name  ");
    const [rule] = await loadBaselines(root);
    assert.equal(rule.source, "New name");
    assert.equal(rule.severity, "critical");
    assert.equal(rule.rationale, "Because.");
    assert.match(await readFile(join(root, "s/v1/baseline.yml"), "utf8"), /^name: New name/);

    await assert.rejects(renamePack(root, "s/v1", "   "), /A name is required/);
    await assert.rejects(renamePack(root, "s/nope", "X"), /no baseline/);
  });
});

test("removePack: deletes exactly that baseline, tidies an emptied source folder, and can't be pointed elsewhere", async () => {
  await withRoot(async (root) => {
    const files = [{ path: "p.json", contentBase64: policy("P", "a") }];
    await addPack(root, { source: "s", version: "v1", files });
    await addPack(root, { source: "s", version: "v2", files });

    await removePack(root, "s/v1");
    assert.equal(existsSync(join(root, "s/v1")), false);
    assert.equal(existsSync(join(root, "s/v2")), true, "other versions under the same source are untouched");

    for (const bad of ["..", "../..", "s", "s/v2/sub", "s/..", "/etc", "s\\v2", ""]) {
      await assert.rejects(removePack(root, bad), BaselineInputError, `"${bad}" must be rejected`);
    }
    assert.equal(existsSync(join(root, "s/v2")), true);

    await removePack(root, "s/v2");
    assert.equal(existsSync(join(root, "s")), false, "the now-empty source folder goes too");
    assert.equal(existsSync(root), true);
  });
});
