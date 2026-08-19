import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { load } from "js-yaml";
import { resolveAppPath } from "../packagedPaths.js";
import type { BaselineRule } from "./types.js";

export function defaultBaselinesDir(): string {
  return resolveAppPath("baselines", import.meta.url);
}

const REQUIRED_FIELDS: Array<keyof BaselineRule> = [
  "id",
  "name",
  "platform",
  "path",
  "expect",
  "severity",
  "rationale",
  "source",
];
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);

/** Recursively reads every *.yml/*.yaml file under `dir` and collects their rules. */
export async function loadBaselines(dir: string): Promise<BaselineRule[]> {
  const files = await findYamlFiles(dir);
  const rules: BaselineRule[] = [];

  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const parsed = load(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${file}: expected a YAML list of rules at the top level.`);
    }
    parsed.forEach((rule, i) => rules.push(validateRule(rule, `${file} (rule #${i + 1})`)));
  }

  return rules;
}

async function findYamlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findYamlFiles(fullPath)));
    } else if (/\.ya?ml$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function validateRule(rule: unknown, context: string): BaselineRule {
  if (typeof rule !== "object" || rule === null) {
    throw new Error(`${context}: rule must be an object.`);
  }

  const r = rule as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (r[field] === undefined) {
      throw new Error(`${context}: missing required field "${field}".`);
    }
  }
  if (!SEVERITIES.has(r.severity as string)) {
    throw new Error(`${context}: severity must be one of critical, high, medium, low.`);
  }
  const expect = r.expect;
  const validExpect =
    typeof expect === "string" ||
    (typeof expect === "object" && expect !== null && ("min" in expect || "max" in expect));
  if (!validExpect) {
    throw new Error(`${context}: expect must be a string, or an object with min/max.`);
  }

  return r as unknown as BaselineRule;
}
