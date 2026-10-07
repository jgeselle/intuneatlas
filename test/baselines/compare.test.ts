import assert from "node:assert/strict";
import { test } from "node:test";
import { compareValues } from "../../src/baselines/compare.js";
import type { SettingValueNode } from "../../src/scan/types.js";

const simple = (id: string, value: string | number): SettingValueNode => ({ kind: "simple", definitionId: id, name: id, value });
const choice = (id: string, option: string, children?: SettingValueNode[]): SettingValueNode => ({
  kind: "choice",
  definitionId: id,
  name: id,
  optionId: `${id}_${option}`,
  label: option,
  ...(children ? { children } : {}),
});

test("compareValues: identical values have no differences", () => {
  assert.deepEqual(compareValues(choice("a", "on"), choice("a", "on")), []);
  assert.deepEqual(compareValues(simple("n", 7), simple("n", "7")), [], "a number and the same number as text are the same value");
});

test("compareValues: nothing configured at all is one difference, with no actual value", () => {
  assert.deepEqual(compareValues(choice("a", "on"), undefined), [{ path: [], expected: "on", actual: null }]);
});

test("compareValues: a different option is reported once — not once per sub-setting under it", () => {
  const expected = choice("a", "on", [simple("a_len", 14), simple("a_age", 30)]);
  assert.deepEqual(compareValues(expected, choice("a", "off")), [{ path: [], expected: "on", actual: "off" }]);
});

test("compareValues: the baseline is a floor — sub-settings it sets must match, extra ones in the tenant are fine", () => {
  const expected = choice("a", "on", [simple("a_len", 14)]);
  const actual = choice("a", "on", [simple("a_len", 8), simple("a_extra", "anything")]);
  assert.deepEqual(compareValues(expected, actual), [{ path: ["a_len"], expected: "14", actual: "8" }]);
  assert.deepEqual(compareValues(expected, choice("a", "on")), [{ path: ["a_len"], expected: "14", actual: null }]);
});

test("compareValues: atMost / atLeast relax a number — and only a number", () => {
  assert.deepEqual(compareValues(simple("n", 7), simple("n", 3), "atMost"), []);
  assert.deepEqual(compareValues(simple("n", 7), simple("n", 9), "atMost"), [{ path: [], expected: "7 or less", actual: "9" }]);
  assert.deepEqual(compareValues(simple("n", 7), simple("n", 9), "atLeast"), []);
  assert.deepEqual(compareValues(simple("n", 7), simple("n", 3), "atLeast"), [{ path: [], expected: "7 or more", actual: "3" }]);
  assert.equal(compareValues(simple("n", 7), simple("n", "soon"), "atMost").length, 1, "text never satisfies a numeric bound");
});

test("compareValues: a list must contain every item the baseline lists; more is fine", () => {
  const list = (items: string[]): SettingValueNode => ({ kind: "simpleCollection", definitionId: "l", name: "l", items });
  assert.deepEqual(compareValues(list(["a", "b"]), list(["B", "c", "a"])), []);
  assert.deepEqual(compareValues(list(["a", "b"]), list(["a"])), [{ path: [], expected: "b", actual: null }]);
});

test("compareValues: a multi-select must include every option the baseline ticks", () => {
  const picks = (ids: string[]): SettingValueNode => ({ kind: "choiceCollection", definitionId: "m", name: "m", items: ids.map((id) => ({ optionId: id, label: id.toUpperCase() })) });
  assert.deepEqual(compareValues(picks(["x"]), picks(["x", "y"])), []);
  assert.deepEqual(compareValues(picks(["x", "y"]), picks(["y"])), [{ path: [], expected: "X", actual: null }]);
});

test("compareValues: a group collection is held instance by instance against the closest one", () => {
  const rules = (groups: SettingValueNode[][]): SettingValueNode => ({ kind: "groupCollection", definitionId: "g", name: "g", groups });
  const expected = rules([[choice("r1", "block"), choice("r2", "audit")]]);
  assert.deepEqual(compareValues(expected, rules([[choice("r1", "block"), choice("r2", "audit"), choice("r3", "off")]])), []);
  assert.deepEqual(compareValues(expected, rules([[choice("r1", "block"), choice("r2", "off")]])), [{ path: ["r2"], expected: "audit", actual: "off" }]);
  assert.deepEqual(compareValues(expected, rules([])), [
    { path: ["r1"], expected: "block", actual: null },
    { path: ["r2"], expected: "audit", actual: null },
  ]);
});

test("compareValues: a value of a different shape entirely is one difference", () => {
  assert.deepEqual(compareValues(simple("a", 1), choice("a", "on")), [{ path: [], expected: "1", actual: "on" }]);
});
