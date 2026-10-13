import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// The database lives under HOME — a scratch one, set before anything opens it.
const home = mkdtempSync(join(tmpdir(), "intuneatlas-definitions-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { getDb } = await import("../../src/storage/db.js");
const { definitionStore } = await import("../../src/storage/definitions.js");

after(() => {
  getDb().close();
  rmSync(home, { recursive: true, force: true });
});

test("definitionStore: keeps an answer, replaces it, and stops returning it once it's too old", () => {
  assert.equal(definitionStore.get("configurationSettings/a", 1000), undefined);
  definitionStore.set("configurationSettings/a", '{"v":1}');
  definitionStore.set("configurationSettings/a", '{"v":2}');
  assert.equal(definitionStore.get("configurationSettings/a", 60_000), '{"v":2}');
  assert.equal(definitionStore.get("configurationSettings/a", 0), undefined);
});
