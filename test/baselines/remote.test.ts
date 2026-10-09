import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, gzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBaselinePack } from "../../src/baselines/loader.js";
import { fetchBaseline, readTar, readZip, resolveBaselineUrl } from "../../src/baselines/remote.js";

const policy = (name: string, definitionId: string) =>
  JSON.stringify({ name, platforms: "windows10", settings: [{ settingInstance: { settingDefinitionId: definitionId, simpleSettingValue: { value: 7 } } }] });

/** A .tar the way forges write one: 512-byte headers, a pax "path" record for a long name. */
function tar(files: Array<[path: string, content: string]>): Buffer {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, type: string) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0);
    h.write(size.toString(8).padStart(11, "0") + "\0", 124);
    h.write(type, 156);
    return h;
  };
  const padded = (data: Buffer) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
  for (const [path, content] of files) {
    const data = Buffer.from(content);
    if (path.length > 100) {
      const record = ` path=${path}\n`;
      const pax = Buffer.from(`${record.length + String(record.length + 2).length}${record}`);
      blocks.push(header("PaxHeader", pax.length, "x"), padded(pax));
    }
    blocks.push(header(path.slice(0, 100), data.length, "0"), padded(data));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** A .zip with one deflated and one stored entry. */
function zip(files: Array<[path: string, content: string]>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  files.forEach(([path, content], i) => {
    const raw = Buffer.from(content);
    const method = i % 2 === 0 ? 8 : 0;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(path);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  });
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Serves `routes` in place of the network; anything else is a 404. */
function fakeWeb(t: { after: (fn: () => void) => void }, routes: Record<string, Buffer | string>): string[] {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const asked: string[] = [];
  global.fetch = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    const body = routes[url];
    return body === undefined ? new Response("Not Found", { status: 404 }) : new Response(body);
  }) as typeof fetch;
  return asked;
}

async function withFolder(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "intuneatlas-remote-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const listed = async (dir: string) => ((await readdir(dir, { recursive: true, withFileTypes: true })) as Array<{ isFile(): boolean; parentPath: string; name: string }>)
  .filter((e) => e.isFile())
  .map((e) => join(e.parentPath, e.name).slice(dir.length + 1).split("\\").join("/"))
  .sort();

test("resolveBaselineUrl: a GitHub folder, repository or file as pasted from the address bar", () => {
  const folder = resolveBaselineUrl("https://github.com/SkipToTheEndpoint/OpenIntuneBaseline/tree/main/WINDOWS");
  assert.deepEqual(folder.candidates[0], { url: "https://codeload.github.com/SkipToTheEndpoint/OpenIntuneBaseline/tar.gz/main", subpath: "WINDOWS" });
  assert.equal(folder.name, "OpenIntuneBaseline WINDOWS");
  // A ref may itself contain a slash: where it ends is tried, not guessed.
  assert.deepEqual(resolveBaselineUrl("https://github.com/o/r/tree/release/2026/Windows").candidates.slice(0, 2), [
    { url: "https://codeload.github.com/o/r/tar.gz/release", subpath: "2026/Windows" },
    { url: "https://codeload.github.com/o/r/tar.gz/release/2026", subpath: "Windows" },
  ]);
  assert.deepEqual(resolveBaselineUrl("https://github.com/o/r").candidates, [{ url: "https://codeload.github.com/o/r/tar.gz/HEAD", subpath: "" }]);
  assert.equal(resolveBaselineUrl("https://github.com/o/r/blob/v1/policies/A.json").candidates[0].url, "https://raw.githubusercontent.com/o/r/v1/policies/A.json");
  // Anything else is fetched as it is.
  const other = resolveBaselineUrl("https://example.com/downloads/contoso-baseline.zip");
  assert.deepEqual([other.candidates[0].url, other.name, other.stripTopFolder], ["https://example.com/downloads/contoso-baseline.zip", "contoso-baseline", false]);
  assert.throws(() => resolveBaselineUrl("not a url"), /neither a folder on this machine nor a URL/);
});

test("fetchBaseline: a GitHub folder is that folder of the repository's archive — its policies and baseline.yml, nothing else", async (t) => {
  const archive = gzipSync(
    tar([
      ["OpenIntuneBaseline-main/README.md", "# docs"],
      ["OpenIntuneBaseline-main/WINDOWS/baseline.yml", "name: OIB Windows\n"],
      ["OpenIntuneBaseline-main/WINDOWS/SettingsCatalog/A.json", policy("A", "defer")],
      ["OpenIntuneBaseline-main/WINDOWS/Scripts/thing.ps1", "Write-Host hi"],
      [`OpenIntuneBaseline-main/WINDOWS/SettingsCatalog/${"a very long policy name ".repeat(6)}.json`, policy("Long", "camera")],
      ["OpenIntuneBaseline-main/MACOS/SettingsCatalog/M.json", policy("M", "filevault")],
    ]),
  );
  const asked = fakeWeb(t, { "https://codeload.github.com/SkipToTheEndpoint/OpenIntuneBaseline/tar.gz/main": archive });

  await withFolder(async (dir) => {
    const result = await fetchBaseline("https://github.com/SkipToTheEndpoint/OpenIntuneBaseline/tree/main/WINDOWS", dir);

    assert.deepEqual(result, { name: "OpenIntuneBaseline WINDOWS", files: 3 });
    assert.deepEqual(await listed(dir), ["SettingsCatalog/A.json", `SettingsCatalog/${"a very long policy name ".repeat(6)}.json`, "baseline.yml"]);
    assert.equal(asked.length, 1);
    // And it loads as one baseline, named by its baseline.yml.
    const rules = await loadBaselinePack(dir, result.name);
    assert.deepEqual(rules.map((r) => [r.source, r.pack, r.policyName, r.definitionId]).sort(), [
      ["OIB Windows", "check/OpenIntuneBaseline WINDOWS", "A", "defer"],
      ["OIB Windows", "check/OpenIntuneBaseline WINDOWS", "Long", "camera"],
    ]);
  });
});

test("fetchBaseline: a .zip, a .tar.gz and a single policy from any address — told apart by what comes back", async (t) => {
  fakeWeb(t, {
    "https://example.com/get?id=1": zip([["baseline/Defender.json", policy("Defender", "tamper")], ["baseline/Updates.json", policy("Updates", "defer")], ["baseline/notes.txt", "x"]]),
    "https://example.com/get?id=2": gzipSync(tar([["Updates.json", policy("Updates", "defer")]])),
    "https://example.com/policies/Camera.json": policy("Camera", "camera"),
    "https://example.com/page": "<!doctype html><html><body>Sign in</body></html>",
    "https://example.com/empty.zip": zip([["readme.txt", "nothing here"]]),
  });

  await withFolder(async (dir) => {
    assert.equal((await fetchBaseline("https://example.com/get?id=1", dir)).files, 2);
    assert.deepEqual(await listed(dir), ["baseline/Defender.json", "baseline/Updates.json"]);
    assert.equal(JSON.parse(await readFile(join(dir, "baseline/Defender.json"), "utf8")).name, "Defender");
  });
  await withFolder(async (dir) => {
    assert.equal((await fetchBaseline("https://example.com/get?id=2", dir)).files, 1);
  });
  await withFolder(async (dir) => {
    assert.deepEqual(await fetchBaseline("https://example.com/policies/Camera.json", dir), { name: "Camera", files: 1 });
    assert.deepEqual((await loadBaselinePack(dir, "Camera")).map((r) => r.definitionId), ["camera"]);
  });
  await withFolder(async (dir) => {
    await assert.rejects(fetchBaseline("https://example.com/page", dir), /web page, not a baseline/);
    await assert.rejects(fetchBaseline("https://example.com/empty.zip", dir), /no \.json files/);
    await assert.rejects(fetchBaseline("https://example.com/gone.zip", dir), /Nothing found .*404/);
  });
});

test("fetchBaseline: nothing in an archive is written outside the folder it was given", async (t) => {
  fakeWeb(t, { "https://example.com/evil.tar.gz": gzipSync(tar([["../../escaped.json", policy("Escaped", "x")], ["ok/../../also.json", policy("Also", "y")], ["fine/Good.json", policy("Good", "z")]])) });
  await withFolder(async (dir) => {
    const inner = join(dir, "inner");
    assert.equal((await fetchBaseline("https://example.com/evil.tar.gz", inner)).files, 1);
    assert.deepEqual(await listed(dir), ["inner/fine/Good.json"]);
  });
});

test("readTar and readZip read what was put in", () => {
  assert.deepEqual(readTar(tar([["a/b.json", "{}"]])).map((e) => [e.path, e.data.toString()]), [["a/b.json", "{}"]]);
  assert.deepEqual(readZip(zip([["a.json", "{\"deflated\":true}"], ["b.json", "{\"stored\":true}"]])).map((e) => [e.path, e.data.toString()]), [["a.json", "{\"deflated\":true}"], ["b.json", "{\"stored\":true}"]]);
  assert.throws(() => readZip(Buffer.from("PK not really a zip")), /damaged or incomplete/);
});
