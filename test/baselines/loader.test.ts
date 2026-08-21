import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBaselines } from "../../src/baselines/loader.js";

// The starter pack actually shipped in the repo/release, not a fixture —
// a typo in real YAML here would otherwise only surface the first time
// someone ran `scan` against a live tenant.
const SHIPPED_BASELINES_DIR = join(import.meta.dirname, "..", "..", "baselines");

async function withTempDir(files: Record<string, string>, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "intuneatlas-baselines-test-"));
  try {
    for (const [relPath, contents] of Object.entries(files)) {
      const full = join(dir, relPath);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, contents, "utf8");
    }
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadBaselines: parses a valid rule file", async () => {
  await withTempDir(
    {
      "rules.yml": `
- id: cis-bitlocker
  name: BitLocker required
  platform: windows
  path: ./x
  expect: "1"
  severity: critical
  rationale: Unencrypted disks are readable by anyone with physical access.
  source: CIS Windows 10 Benchmark
`,
    },
    async (dir) => {
      const rules = await loadBaselines(dir);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].id, "cis-bitlocker");
      assert.equal(rules[0].severity, "critical");
    },
  );
});

test("loadBaselines: recurses into subdirectories and aggregates every file", async () => {
  await withTempDir(
    {
      "windows/lock.yml": `
- id: rule-a
  name: A
  platform: windows
  path: ./a
  expect: "1"
  severity: low
  rationale: r
  source: s
`,
      "ios/passcode.yaml": `
- id: rule-b
  name: B
  platform: ios
  path: ./b
  expect: "1"
  severity: low
  rationale: r
  source: s
`,
    },
    async (dir) => {
      const rules = await loadBaselines(dir);
      assert.equal(rules.length, 2);
      assert.deepEqual(
        rules.map((r) => r.id).sort(),
        ["rule-a", "rule-b"],
      );
    },
  );
});

test("loadBaselines: a rule missing a required field throws with the file and rule number in the message", async () => {
  await withTempDir(
    {
      "bad.yml": `
- id: incomplete-rule
  name: Missing fields
  platform: windows
  path: ./x
`,
    },
    async (dir) => {
      await assert.rejects(() => loadBaselines(dir), /missing required field/);
    },
  );
});

test("loadBaselines: an invalid severity value throws", async () => {
  await withTempDir(
    {
      "bad.yml": `
- id: bad-severity
  name: Bad severity
  platform: windows
  path: ./x
  expect: "1"
  severity: catastrophic
  rationale: r
  source: s
`,
    },
    async (dir) => {
      await assert.rejects(() => loadBaselines(dir), /severity must be one of/);
    },
  );
});

test("loadBaselines: a non-array top-level document throws", async () => {
  await withTempDir(
    {
      "bad.yml": `
id: not-a-list
name: This is a map, not a list
`,
    },
    async (dir) => {
      await assert.rejects(() => loadBaselines(dir), /expected a YAML list of rules/);
    },
  );
});

test("loadBaselines: an empty directory produces an empty rule set, not an error", async () => {
  await withTempDir({}, async (dir) => {
    const rules = await loadBaselines(dir);
    assert.deepEqual(rules, []);
  });
});

test("loadBaselines: an expect object (min/max) round-trips correctly, not just string expectations", async () => {
  await withTempDir(
    {
      "rules.yml": `
- id: numeric-rule
  name: Numeric
  platform: windows
  path: ./x
  expect:
    min: 60
    max: 900
  severity: medium
  rationale: r
  source: s
`,
    },
    async (dir) => {
      const [rule] = await loadBaselines(dir);
      assert.deepEqual(rule.expect, { min: 60, max: 900 });
    },
  );
});

test("loadBaselines: the real starter pack shipped in the repo actually loads", async () => {
  const rules = await loadBaselines(SHIPPED_BASELINES_DIR);
  assert.ok(rules.length > 0, "expected at least one rule in baselines/");
  for (const rule of rules) {
    assert.ok(rule.id, "every shipped rule needs a non-empty id");
    assert.ok(rule.path.startsWith("./"), `rule "${rule.id}"'s path should be a CSP path starting with "./"`);
  }
  // ids are looked up by baseline recommendation, tenant-wide — a
  // duplicate would silently shadow one of the two rules.
  const ids = rules.map((r) => r.id);
  assert.deepEqual(ids, [...new Set(ids)], "shipped rule ids must be unique");
});
