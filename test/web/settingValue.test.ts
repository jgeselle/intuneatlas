import assert from "node:assert/strict";
import { test } from "node:test";
import { renderNode as serverRenderNode } from "../../src/scan/settingValue.js";
import type { SettingSchema, SettingValueNode } from "../../src/scan/types.js";
import { applyExpected, defaultNode, nodeFromText, normalizeNode, renderNode, validateNode } from "../../web/src/lib/settingValue.js";

const simple = (definitionId: string, value: string | number | boolean): SettingValueNode => ({ kind: "simple", definitionId, name: definitionId, value });
const choice = (definitionId: string, optionId: string, label: string, children?: SettingValueNode[]): SettingValueNode => ({
  kind: "choice",
  definitionId,
  name: definitionId,
  optionId,
  label,
  ...(children ? { children } : {}),
});

// One of every kind, nested the ways real policies nest them.
const EVERY_KIND: SettingValueNode[] = [
  simple("a", "text"),
  simple("b", 42),
  simple("c", true),
  choice("d", "d_1", "Enabled"),
  choice("e", "e_1", "Enabled", [simple("e_child", 5), choice("e_sub", "e_sub_0", "Block", [simple("deep", "x\ny")])]),
  { kind: "simpleCollection", definitionId: "f", name: "f", items: ["one", 2, false] },
  { kind: "choiceCollection", definitionId: "g", name: "g", items: [{ optionId: "g_1", label: "First" }, { optionId: "g_2", label: "Second" }] },
  { kind: "group", definitionId: "h", name: "h", children: [simple("h1", "x"), choice("h2", "h2_0", "Off")] },
  { kind: "groupCollection", definitionId: "i", name: "i", groups: [[simple("i1", "only")]] },
  { kind: "groupCollection", definitionId: "j", name: "j", groups: [[simple("j1", "first")], [simple("j1", "second"), simple("j2", 3)]] },
  { kind: "unknown", definitionId: "k", name: "k" },
];

test("renderNode gives exactly the server's text for every kind of value", () => {
  // A staged change's "from" is the server's rendering and its "to" the browser's: an edit is found by comparing them.
  for (const node of EVERY_KIND) assert.equal(renderNode(node), serverRenderNode(node), node.definitionId);
});

test("renderNode prefixes each line of a multi-line child with the child's name", () => {
  assert.equal(renderNode(EVERY_KIND[4]), "Enabled\ne_child: 5\ne_sub: Block\ne_sub: deep: x\ne_sub: deep: y");
  assert.equal(renderNode(EVERY_KIND[9]), "[1] j1: first\n[2] j1: second\n[2] j2: 3");
});

test("defaultNode starts from the definition's default option or value", () => {
  const options = [
    { id: "x_0", label: "Off" },
    { id: "x_1", label: "On" },
  ];
  assert.deepEqual(defaultNode({ definitionId: "x", name: "X", kind: "choice", options, defaultOptionId: "x_1" }), { ...choice("x", "x_1", "On"), name: "X" });
  assert.deepEqual(defaultNode({ definitionId: "x", name: "X", kind: "choice", options }), { ...choice("x", "x_0", "Off"), name: "X" });
  // A choice with no options to pick from can only be typed in.
  assert.deepEqual(defaultNode({ definitionId: "x", name: "X", kind: "choice" }), { kind: "simple", definitionId: "x", name: "X", value: "" });
  assert.deepEqual(defaultNode({ definitionId: "n", name: "N", kind: "simple", valueType: "integer", min: 3 }), { kind: "simple", definitionId: "n", name: "N", value: 3 });
  assert.deepEqual(defaultNode({ definitionId: "n", name: "N", kind: "simple", defaultValue: "hi" }), { kind: "simple", definitionId: "n", name: "N", value: "hi" });
  assert.deepEqual(defaultNode({ definitionId: "g", name: "G", kind: "groupCollection" }), { kind: "groupCollection", definitionId: "g", name: "G", groups: [[]] });
});

test("nodeFromText makes one field of a single line, and nothing of several", () => {
  assert.deepEqual(nodeFromText("Enabled"), { kind: "simple", definitionId: "", name: "", value: "Enabled" });
  assert.equal(nodeFromText("one\ntwo"), null);
});

test("validateNode holds a value to its definition's limits", () => {
  const schemas: Record<string, SettingSchema> = {
    n: { definitionId: "n", name: "Length", kind: "simple", valueType: "integer", min: 4, max: 14 },
    s: { definitionId: "s", name: "Text", kind: "simple", valueType: "string", maxLength: 3 },
    c: { definitionId: "c", name: "Mode", kind: "choice", options: [{ id: "c_0", label: "Off" }] },
    l: { definitionId: "l", name: "List", kind: "simpleCollection", valueType: "integer", maxCount: 2 },
    g: { definitionId: "g", name: "Group", kind: "group", childIds: ["n"] },
  };
  assert.equal(validateNode(simple("n", "8"), schemas), null);
  assert.equal(validateNode(simple("n", ""), schemas), "Enter a value.");
  assert.equal(validateNode(simple("n", "8.5"), schemas), "Enter a whole number.");
  assert.equal(validateNode(simple("n", "20"), schemas), "Must be 4 to 14.");
  assert.equal(validateNode(simple("s", "abcd"), schemas), "At most 3 characters.");
  assert.equal(validateNode(choice("c", "c_9", "Gone"), schemas), "Pick one of the listed options.");
  assert.equal(validateNode({ kind: "simpleCollection", definitionId: "l", name: "List", items: ["1", "x"] }, schemas), "Enter a whole number.");
  assert.equal(validateNode({ kind: "simpleCollection", definitionId: "l", name: "List", items: ["1", "2", "3"] }, schemas), "At most 2 items.");
  // A sub-setting's problem is named after the sub-setting.
  assert.equal(validateNode({ kind: "group", definitionId: "g", name: "Group", children: [{ ...simple("n", "2"), name: "Length" }] }, schemas), "Length: Must be 4 to 14.");
  // Without a schema there is nothing to hold it to but being filled in.
  assert.equal(validateNode(simple("unknown", "anything"), undefined), null);
});

test("normalizeNode turns typed whole numbers back into numbers and drops empty sub-settings", () => {
  const schemas: Record<string, SettingSchema> = {
    n: { definitionId: "n", name: "N", kind: "simple", valueType: "integer" },
    l: { definitionId: "l", name: "L", kind: "simpleCollection", valueType: "integer" },
  };
  assert.deepEqual(normalizeNode(simple("n", " 12 "), schemas), simple("n", 12));
  assert.deepEqual(normalizeNode(simple("n", "12a"), schemas), simple("n", "12a"));
  assert.deepEqual(normalizeNode({ kind: "simpleCollection", definitionId: "l", name: "L", items: ["1", "2"] }, schemas), { kind: "simpleCollection", definitionId: "l", name: "L", items: [1, 2] });
  assert.deepEqual(normalizeNode(choice("c", "c_1", "On", []), schemas), choice("c", "c_1", "On"));
  assert.deepEqual(normalizeNode(choice("c", "c_1", "On", [simple("n", "7")]), schemas), choice("c", "c_1", "On", [simple("n", 7)]));
});

test("applyExpected brings a draft up to a baseline and keeps what the baseline doesn't mention", () => {
  // A different kind of value is replaced outright.
  assert.deepEqual(applyExpected(simple("x", "a"), choice("x", "x_1", "On")), choice("x", "x_1", "On"));
  assert.deepEqual(applyExpected(null, simple("x", 1)), simple("x", 1));

  // A group: the baseline's children are set, the draft's other children stay.
  const draft: SettingValueNode = { kind: "group", definitionId: "g", name: "g", children: [simple("keep", "mine"), simple("fix", "old")] };
  const expected: SettingValueNode = { kind: "group", definitionId: "g", name: "g", children: [simple("fix", "new"), simple("add", "theirs")] };
  assert.deepEqual(applyExpected(draft, expected), { kind: "group", definitionId: "g", name: "g", children: [simple("keep", "mine"), simple("fix", "new"), simple("add", "theirs")] });

  // A list: missing items are added, matched without regard to case or spaces.
  assert.deepEqual(
    applyExpected({ kind: "simpleCollection", definitionId: "l", name: "l", items: ["A", "b"] }, { kind: "simpleCollection", definitionId: "l", name: "l", items: [" a", "c"] }),
    { kind: "simpleCollection", definitionId: "l", name: "l", items: ["A", "b", "c"] },
  );

  // A choice keeps its sub-settings only while the option stays the same.
  assert.deepEqual(applyExpected(choice("c", "c_1", "On", [simple("s", 1)]), choice("c", "c_1", "On")), choice("c", "c_1", "On", [simple("s", 1)]));
  assert.deepEqual(applyExpected(choice("c", "c_0", "Off", [simple("s", 1)]), choice("c", "c_1", "On")), choice("c", "c_1", "On"));

  // A group collection: instance by instance, with any extra instances of the draft kept.
  const mine: SettingValueNode = { kind: "groupCollection", definitionId: "gc", name: "gc", groups: [[simple("a", 1)], [simple("a", 2)]] };
  const theirs: SettingValueNode = { kind: "groupCollection", definitionId: "gc", name: "gc", groups: [[simple("b", 9)]] };
  assert.deepEqual(applyExpected(mine, theirs), { kind: "groupCollection", definitionId: "gc", name: "gc", groups: [[simple("a", 1), simple("b", 9)], [simple("a", 2)]] });
});
