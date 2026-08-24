import assert from "node:assert/strict";
import { test } from "node:test";
import { listBaselinePacks } from "../../src/baselines/packs.js";
import type { BaselineRule } from "../../src/baselines/types.js";

function rule(overrides: Partial<BaselineRule>): BaselineRule {
  return {
    id: "r",
    name: "R",
    platform: "windows",
    path: "./x",
    expect: "1",
    severity: "low",
    rationale: "why",
    source: "Source",
    pack: "pack",
    ...overrides,
  };
}

test("listBaselinePacks: groups rules by pack, one entry per pack", () => {
  const packs = listBaselinePacks([
    rule({ id: "r1", pack: "cis/windows-11-benchmark-l1", source: "CIS Microsoft Windows 11 Benchmark, L1" }),
    rule({ id: "r2", pack: "cis/windows-11-benchmark-l1", source: "CIS Microsoft Windows 11 Benchmark, L1" }),
    rule({ id: "r3", pack: "microsoft/defender-hardening-guidance", source: "Microsoft Defender for Endpoint hardening guidance" }),
  ]);

  assert.equal(packs.length, 2);
  const cis = packs.find((p) => p.path === "cis/windows-11-benchmark-l1")!;
  assert.equal(cis.ruleCount, 2);
  assert.equal(cis.name, "CIS Microsoft Windows 11 Benchmark, L1");
  assert.equal(cis.sourceLabel, "Cis");
});

test("listBaselinePacks: platforms lists every distinct platform within the pack, not just the first rule's", () => {
  const [pack] = listBaselinePacks([
    rule({ id: "r1", pack: "vendor/pack", platform: "windows" }),
    rule({ id: "r2", pack: "vendor/pack", platform: "iOS" }),
    rule({ id: "r3", pack: "vendor/pack", platform: "windows" }),
  ]);

  assert.deepEqual(pack.platforms.sort(), ["iOS", "windows"]);
});

test("listBaselinePacks: sourceLabel prettifies a hyphenated folder segment into words", () => {
  const [pack] = listBaselinePacks([rule({ pack: "open-intune-baseline/v3.6" })]);
  assert.equal(pack.sourceLabel, "Open Intune Baseline");
});

test("listBaselinePacks: no rules -> no packs", () => {
  assert.deepEqual(listBaselinePacks([]), []);
});
