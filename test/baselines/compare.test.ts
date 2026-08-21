import assert from "node:assert/strict";
import { test } from "node:test";
import { describeExpectation, satisfiesExpectation } from "../../src/baselines/compare.js";

test("satisfiesExpectation", async (t) => {
  await t.test("string expectation — exact match", () => {
    assert.equal(satisfiesExpectation("1", "1"), true);
  });

  await t.test("string expectation — mismatch", () => {
    assert.equal(satisfiesExpectation("0", "1"), false);
  });

  await t.test("string expectation — case-insensitive", () => {
    assert.equal(satisfiesExpectation("Enabled", "enabled"), true);
  });

  await t.test("string expectation — whitespace-tolerant", () => {
    assert.equal(satisfiesExpectation("  enabled  ", "enabled"), true);
  });

  await t.test("numeric range — within min and max", () => {
    assert.equal(satisfiesExpectation("300", { min: 60, max: 900 }), true);
  });

  await t.test("numeric range — below min", () => {
    assert.equal(satisfiesExpectation("30", { min: 60, max: 900 }), false);
  });

  await t.test("numeric range — above max", () => {
    assert.equal(satisfiesExpectation("1200", { min: 60, max: 900 }), false);
  });

  await t.test("numeric range — only min set, value at the boundary passes", () => {
    assert.equal(satisfiesExpectation("60", { min: 60 }), true);
  });

  await t.test("numeric range — only max set, value above it fails", () => {
    assert.equal(satisfiesExpectation("901", { max: 900 }), false);
  });

  await t.test("numeric range — non-numeric actual value never satisfies", () => {
    assert.equal(satisfiesExpectation("not-a-number", { min: 0, max: 10 }), false);
  });
});

test("describeExpectation", async (t) => {
  await t.test("string expectation — returned as-is", () => {
    assert.equal(describeExpectation("1"), "1");
  });

  await t.test("min and max both set", () => {
    assert.equal(describeExpectation({ min: 60, max: 900 }), "between 60 and 900");
  });

  await t.test("only max set", () => {
    assert.equal(describeExpectation({ max: 900 }), "900 or less");
  });

  await t.test("only min set", () => {
    assert.equal(describeExpectation({ min: 60 }), "60 or more");
  });

  await t.test("neither set (defensive edge case) — empty string, not a crash", () => {
    assert.equal(describeExpectation({}), "");
  });
});
