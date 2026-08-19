import type { BaselineRule } from "./types.js";

/** True if `actual` satisfies the rule's `expect` — i.e. the setting is compliant. */
export function satisfiesExpectation(actual: string, expect: BaselineRule["expect"]): boolean {
  if (typeof expect === "string") {
    return actual.trim().toLowerCase() === expect.trim().toLowerCase();
  }

  const numeric = Number.parseFloat(actual);
  if (Number.isNaN(numeric)) return false;
  if (expect.min !== undefined && numeric < expect.min) return false;
  if (expect.max !== undefined && numeric > expect.max) return false;
  return true;
}

/** How the rule's expectation reads as a display string, for the "recommended" side of a diff. */
export function describeExpectation(expect: BaselineRule["expect"]): string {
  if (typeof expect === "string") return expect;
  if (expect.min !== undefined && expect.max !== undefined) return `between ${expect.min} and ${expect.max}`;
  if (expect.max !== undefined) return `${expect.max} or less`;
  if (expect.min !== undefined) return `${expect.min} or more`;
  return "";
}
