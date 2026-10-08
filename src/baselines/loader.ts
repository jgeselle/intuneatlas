import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { load } from "js-yaml";
import { resolveAppPath } from "../packagedPaths.js";
import { asComplianceInstance } from "../scan/complianceCatalog.js";
import { complianceSettingsOf, complianceTypeOf } from "../scan/complianceSettings.js";
import { rawNode, type GraphSettingInstance } from "../scan/settingValue.js";
import { platformFromODataType } from "../scan/simplePolicy.js";
import type { SettingValueNode } from "../scan/types.js";
import type { BaselineRule, CompareMode, Severity } from "./types.js";

/** Baselines that ship with the app — replaced wholesale by every update. */
export function bundledBaselinesDir(): string {
  return resolveAppPath("baselines", import.meta.url);
}

/**
 * The user's own baselines. Lives with the rest of the tool's local state
 * rather than in the install directory, which both installers delete and
 * recreate on every update.
 */
export function userBaselinesDir(): string {
  return join(homedir(), ".intuneatlas", "baselines");
}

/** Where baselines are read from: one explicit directory if given (`--baseline`), otherwise the bundled and the user's. */
export function baselineDirs(explicit?: string): string[] {
  return explicit ? [explicit] : [bundledBaselinesDir(), userBaselinesDir()];
}

export const ANNOTATIONS_FILE = "baseline.yml";
const SEVERITIES = new Set<string>(["critical", "high", "medium", "low"]);
const COMPARE_MODES = new Set<string>(["exact", "atMost", "atLeast"]);

/** What a pack's baseline.yml may say about one setting. */
interface SettingAnnotation {
  severity?: Severity;
  rationale?: string;
  reference?: string;
  compare?: CompareMode;
  /** Leave this setting out of the baseline altogether. */
  ignore?: boolean;
}

interface PackAnnotations {
  name?: string;
  settings: Record<string, SettingAnnotation>;
}

interface ExportedPolicy {
  "@odata.type"?: string;
  technologies?: string;
  name?: string;
  displayName?: string;
  platforms?: string;
  settings?: Array<{ settingInstance?: GraphSettingInstance }>;
}

/** An exported policy of either kind, reduced to what a rule is made of. */
interface BaselinePolicy {
  name?: string;
  platform: string;
  settings: Array<{ definitionId: string; expected: SettingValueNode }>;
}

/**
 * Reads every baseline pack under the given directories.
 *
 * A pack is a folder two levels down — `<source>/<name-and-version>/`,
 * e.g. `oib/windows-v4.0/` — holding, at any depth:
 *
 * - Settings Catalog policies and compliance policies exported from
 *   Intune as JSON, exactly as exported. Each setting in each policy
 *   becomes one rule. Anything else in the folder (scripts, a manifest,
 *   docs, other policy types) is skipped: a real baseline download is
 *   dropped in whole, not curated.
 * - optionally one `baseline.yml` at the pack's root, with a display
 *   `name` and per-setting annotations under `settings:`, keyed by
 *   definition id — severity, rationale, reference, compare, ignore.
 *
 * A directory that doesn't exist is fine (the user's folder usually
 * doesn't until they add something).
 */
export async function loadBaselines(dirs: string | string[]): Promise<BaselineRule[]> {
  const rules: BaselineRule[] = [];
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    if (!existsSync(dir)) continue;
    rules.push(...(await loadDirectory(dir)));
  }
  return rules;
}

/**
 * Parsed rules per directory, kept until something in it changes.
 * Baselines are re-read on every evaluation on purpose — an edit to a
 * file takes effect on the next request, no restart — but parsing a few
 * hundred exported policies each time a checkbox is ticked is waste.
 * Listing the files and their sizes/modified times is cheap, and is all
 * it takes to know whether the last parse still stands.
 */
const cache = new Map<string, { signature: string; rules: BaselineRule[] }>();

async function loadDirectory(dir: string): Promise<BaselineRule[]> {
  const files = (await findFiles(dir)).filter((f) => /\.json$/i.test(f) || basename(f) === ANNOTATIONS_FILE);
  const stats = await Promise.all(files.map((file) => stat(file)));
  const signature = files.map((file, i) => `${file}:${stats[i].size}:${stats[i].mtimeMs}`).join("|");
  const cached = cache.get(dir);
  if (cached?.signature === signature) return cached.rules;

  const rules = await parseDirectory(dir, files);
  cache.set(dir, { signature, rules });
  return rules;
}

async function parseDirectory(dir: string, files: string[]): Promise<BaselineRule[]> {
  const rules: BaselineRule[] = [];
  const annotations = new Map<string, PackAnnotations>();

  for (const file of files.filter((f) => basename(f) === ANNOTATIONS_FILE)) {
    // Only at a pack's own root — a stray baseline.yml deeper in a download isn't ours.
    if (relative(dir, dirname(file)).split(sep).filter(Boolean).length === 2) {
      annotations.set(packForFile(dir, file), await readAnnotations(file));
    }
  }

  for (const file of files.filter((f) => /\.json$/i.test(f))) {
    const policy = await readExportedPolicy(file);
    if (!policy) continue;
    const pack = packForFile(dir, file);
    const packAnnotations = annotations.get(pack);
    const policyName = policy.name ?? basename(file).replace(/\.json$/i, "");

    for (const { definitionId, expected } of policy.settings) {
      const annotation = packAnnotations?.settings[definitionId] ?? {};
      if (annotation.ignore) continue;
      rules.push({
        id: `${pack}::${policyName}::${definitionId}`,
        pack,
        source: packAnnotations?.name ?? prettifyPack(pack),
        policyName,
        definitionId,
        platform: policy.platform,
        expected,
        compare: annotation.compare ?? "exact",
        ...(annotation.severity ? { severity: annotation.severity } : {}),
        ...(annotation.rationale ? { rationale: annotation.rationale } : {}),
        ...(annotation.reference ? { reference: annotation.reference } : {}),
      });
    }
  }
  return rules;
}

/**
 * A rule's pack is its file's first two path segments under `dir` — e.g.
 * baselines/oib/windows-v4.0/SettingsCatalog/x.json -> "oib/windows-v4.0".
 * Always forward-slash-joined regardless of platform, so it's a stable
 * identifier to persist and compare against (see
 * src/storage/baselineSelections.ts), not a real filesystem path. A file
 * with fewer than two folders above it gets what there is ("" for one
 * sitting directly under `dir`).
 */
function packForFile(dir: string, file: string): string {
  const rel = relative(dir, dirname(file));
  return rel.split(sep).filter(Boolean).slice(0, 2).join("/");
}

/** "oib/windows-v4.0" -> "Oib Windows V4.0" — only the fallback when baseline.yml gives no name. */
function prettifyPack(pack: string): string {
  return pack
    .split("/")
    .flatMap((segment) => segment.split("-"))
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Real exports come in more than one encoding (confirmed on a published
 * baseline: most files UTF-8 with a BOM, some UTF-16) — the BOM decides.
 */
function decode(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString("utf8");
  return bytes.toString("utf8");
}

/** Whether these bytes are a policy export a baseline can be made of — what an upload is checked with before anything is written. */
export function isExportedPolicy(bytes: Buffer): boolean {
  return parseExportedPolicy(bytes) !== undefined;
}

/** The file as an exported policy, or undefined if it's anything else — including JSON that doesn't parse. */
async function readExportedPolicy(file: string): Promise<BaselinePolicy | undefined> {
  return parseExportedPolicy(await readFile(file));
}

/**
 * Three kinds of export are understood: a Settings Catalog policy (a
 * `settings` list of setting instances), a typed compliance policy (a
 * resource with its settings as properties), and a compliance policy in
 * the Settings Catalog format, as Intune uses for Linux — told from a
 * configuration policy by its type or, in an export that dropped the
 * type, by its Linux technology. A policy with nothing configured in it
 * is not a baseline policy.
 */
function parseExportedPolicy(bytes: Buffer): BaselinePolicy | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decode(bytes));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

  if (complianceTypeOf((parsed as Record<string, unknown>)["@odata.type"])) {
    const policy = parsed as Record<string, unknown>;
    const settings = complianceSettingsOf(policy).map((setting) => ({ definitionId: setting.settingDefinitionId, expected: setting.structured! }));
    if (settings.length === 0) return undefined;
    return {
      ...(typeof policy.displayName === "string" ? { name: policy.displayName } : {}),
      platform: platformFromODataType(String(policy["@odata.type"])),
      settings,
    };
  }

  const catalog = parsed as ExportedPolicy;
  if (!Array.isArray(catalog.settings)) return undefined;
  const compliance = catalog["@odata.type"] === "#microsoft.graph.deviceManagementCompliancePolicy" || /linuxMdm/i.test(catalog.technologies ?? "");
  const settings = catalog.settings
    .map((s) => s?.settingInstance)
    .filter((instance): instance is GraphSettingInstance => Boolean(instance?.settingDefinitionId))
    .map((instance) => (compliance ? asComplianceInstance(instance) : instance))
    .map((instance) => ({ definitionId: instance.settingDefinitionId, expected: rawNode(instance) }));
  if (settings.length === 0) return undefined;
  const name = catalog.name ?? catalog.displayName;
  return { ...(name ? { name } : {}), platform: catalog.platforms ?? "", settings };
}

async function readAnnotations(file: string): Promise<PackAnnotations> {
  const parsed = load(decode(await readFile(file)));
  if (parsed === null || parsed === undefined) return { settings: {} };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file}: expected a mapping with optional "name" and "settings".`);
  }
  const { name, settings } = parsed as { name?: unknown; settings?: unknown };
  if (settings !== undefined && (settings === null || typeof settings !== "object" || Array.isArray(settings))) {
    throw new Error(`${file}: "settings" must map setting definition ids to their annotations.`);
  }

  const result: PackAnnotations = { settings: {} };
  if (typeof name === "string" && name.trim()) result.name = name.trim();
  for (const [definitionId, raw] of Object.entries((settings ?? {}) as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${file}: settings.${definitionId} must be a mapping.`);
    }
    const a = raw as Record<string, unknown>;
    if (a.severity !== undefined && !SEVERITIES.has(String(a.severity))) {
      throw new Error(`${file}: settings.${definitionId}.severity must be one of critical, high, medium, low (got "${String(a.severity)}").`);
    }
    if (a.compare !== undefined && !COMPARE_MODES.has(String(a.compare))) {
      throw new Error(`${file}: settings.${definitionId}.compare must be one of exact, atMost, atLeast (got "${String(a.compare)}").`);
    }
    result.settings[definitionId] = {
      ...(a.severity !== undefined ? { severity: a.severity as Severity } : {}),
      ...(typeof a.rationale === "string" && a.rationale.trim() ? { rationale: a.rationale.trim() } : {}),
      ...(typeof a.reference === "string" && a.reference.trim() ? { reference: a.reference.trim() } : {}),
      ...(a.compare !== undefined ? { compare: a.compare as CompareMode } : {}),
      ...(a.ignore === true ? { ignore: true } : {}),
    };
  }
  return result;
}

async function findFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await findFiles(fullPath)));
    else files.push(fullPath);
  }
  return files;
}
