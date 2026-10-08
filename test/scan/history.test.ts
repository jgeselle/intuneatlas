import assert from "node:assert/strict";
import { test } from "node:test";
import { diffScans, type ScannedSetting } from "../../src/scan/history.js";

const source = (policyId: string, value: string, deployed = true) => ({ policyId, policyName: `Policy ${policyId}`, value, deployed });
const setting = (key: string, sources: ScannedSetting["sources"], definitionId = key): ScannedSetting => ({ key: `${key}::windows10`, definitionId, sources });

test("diffScans: nothing changed, nothing recorded", () => {
  const scan = [setting("a", [source("p1", "1"), source("p2", "2")]), setting("b", [source("p1", "x")])];
  assert.deepEqual(diffScans(scan, scan), []);
});

test("diffScans: a policy changing a value, starting to set a setting, and no longer setting one", () => {
  const before = [setting("a", [source("p1", "14"), source("p2", "2")]), setting("b", [source("p1", "x")])];
  const after = [setting("a", [source("p1", "7"), source("p3", "5")]), setting("b", [source("p1", "x")])];

  assert.deepEqual(diffScans(before, after), [
    { settingKey: "a::windows10", kind: "changed", policyId: "p1", policyName: "Policy p1", from: "14", to: "7" },
    { settingKey: "a::windows10", kind: "added", policyId: "p3", policyName: "Policy p3", to: "5" },
    { settingKey: "a::windows10", kind: "removed", policyId: "p2", policyName: "Policy p2", from: "2" },
  ]);
});

test("diffScans: a setting that appears or disappears altogether is its policies starting or stopping to set it", () => {
  const withB = [setting("a", [source("p1", "1")]), setting("b", [source("p1", "x"), source("p2", "y")])];
  const withoutB = [setting("a", [source("p1", "1")])];

  assert.deepEqual(diffScans(withoutB, withB).map((e) => [e.settingKey, e.kind, e.policyId, e.to]), [
    ["b::windows10", "added", "p1", "x"],
    ["b::windows10", "added", "p2", "y"],
  ]);
  assert.deepEqual(diffScans(withB, withoutB).map((e) => [e.settingKey, e.kind, e.policyId, e.from]), [
    ["b::windows10", "removed", "p1", "x"],
    ["b::windows10", "removed", "p2", "y"],
  ]);
});

test("diffScans: a policy gaining or losing its assignment is recorded on each setting it sets, apart from any change of value", () => {
  const before = [setting("a", [source("p1", "1", false)]), setting("b", [source("p2", "x", true)])];
  const after = [setting("a", [source("p1", "2", true)]), setting("b", [source("p2", "x", false)])];

  assert.deepEqual(diffScans(before, after).map((e) => [e.settingKey, e.kind]), [
    ["a::windows10", "changed"],
    ["a::windows10", "assigned"],
    ["b::windows10", "unassigned"],
  ]);
});

test("diffScans: the first scan that reads compliance settings doesn't record them all as newly set", () => {
  const before = [setting("a", [source("p1", "1")])];
  const after = [setting("a", [source("p1", "1")]), setting("compliance.windows10.bitLockerEnabled", [source("c1", "Require")])];
  // Nothing from compliance policies before: the tool started seeing them, the tenant didn't change.
  assert.deepEqual(diffScans(before, after), []);

  // Once it has seen some, a new one is news.
  const later = [...after, setting("compliance.windows10.tpmRequired", [source("c1", "Require")])];
  assert.deepEqual(diffScans(after, later).map((e) => [e.settingKey, e.kind]), [["compliance.windows10.tpmRequired::windows10", "added"]]);
});
