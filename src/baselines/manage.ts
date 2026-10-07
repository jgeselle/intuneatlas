import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { dump, load } from "js-yaml";
import { ANNOTATIONS_FILE, isExportedPolicy } from "./loader.js";

/** One file of an uploaded baseline: where it sat inside the chosen folder, and its bytes. */
export interface UploadedFile {
  path: string;
  contentBase64: string;
}

export interface AddPackInput {
  /** Who publishes it — the first folder level, e.g. "oib". */
  source: string;
  /** Which baseline and version — the second level, e.g. "windows-v4.0". */
  version: string;
  /** Display name, written to baseline.yml. */
  name?: string;
  files: UploadedFile[];
}

/** Thrown for anything wrong with what the user asked for — shown to them as-is. */
export class BaselineInputError extends Error {}

const MAX_FILES = 2000;
const MAX_TOTAL_BYTES = 30_000_000;
const MAX_DEPTH = 8;

/** A folder name from free text: lower-case, spaces to dashes, nothing a filesystem could trip on. */
function slug(text: string, what: string): string {
  const s = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!s) throw new BaselineInputError(`${what} is required (letters, digits, dots and dashes).`);
  return s;
}

/**
 * An uploaded file's path as safe folder segments inside the pack, or
 * undefined if it can't be one. Nothing here may climb out of the pack:
 * no "..", no absolute paths, no drive letters, no characters Windows
 * forbids in names.
 */
function safeSegments(path: string): string[] | undefined {
  const segments = String(path).split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.length > MAX_DEPTH) return undefined;
  for (const segment of segments) {
    if (segment === "." || segment === ".." || /[\x00-\x1f<>:"|?*]/.test(segment) || segment.length > 200) return undefined;
  }
  return segments;
}

/** The pack's folder, guaranteed to be exactly two levels inside `root`. */
function packDir(root: string, pack: string): string {
  const segments = pack.split("/");
  if (segments.length !== 2 || segments.some((s) => !s || s === "." || s === ".." || /[\\/\x00-\x1f<>:"|?*]/.test(s))) {
    throw new BaselineInputError(`"${pack}" is not a baseline.`);
  }
  const dir = resolve(root, segments[0], segments[1]);
  if (!dir.startsWith(resolve(root) + sep)) throw new BaselineInputError(`"${pack}" is not a baseline.`);
  return dir;
}

/**
 * Adds a baseline to `root` from uploaded files: the exported policies
 * (any .json) and, if present at the top, a baseline.yml. Everything else
 * in the upload is left behind — a baseline download brings scripts and
 * docs this has no use for. Refuses to overwrite an existing baseline, and
 * refuses an upload without a single Settings Catalog policy in it.
 * Returns the new pack's path ("source/version").
 */
export async function addPack(root: string, input: AddPackInput): Promise<string> {
  const pack = `${slug(input.source, "Source")}/${slug(input.version, "Name and version")}`;
  const dir = packDir(root, pack);
  if (existsSync(dir)) throw new BaselineInputError(`A baseline "${pack}" already exists. Remove it first, or use a different name and version.`);
  if (!Array.isArray(input.files) || input.files.length === 0) throw new BaselineInputError("No files were uploaded.");
  if (input.files.length > MAX_FILES) throw new BaselineInputError(`Too many files (${input.files.length}; the limit is ${MAX_FILES}).`);

  const toWrite: Array<{ target: string; bytes: Buffer }> = [];
  let total = 0;
  let policies = 0;
  for (const file of input.files) {
    const segments = safeSegments(file.path);
    if (!segments) continue;
    const name = segments[segments.length - 1];
    const isAnnotations = segments.length === 1 && name === ANNOTATIONS_FILE;
    if (!/\.json$/i.test(name) && !isAnnotations) continue;

    const bytes = Buffer.from(String(file.contentBase64 ?? ""), "base64");
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new BaselineInputError(`The upload is too large (over ${MAX_TOTAL_BYTES / 1_000_000} MB of policy files).`);
    if (!isAnnotations && isExportedPolicy(bytes)) policies++;

    const target = resolve(dir, ...segments);
    if (!target.startsWith(dir + sep)) continue;
    toWrite.push({ target, bytes });
  }
  if (policies === 0) {
    throw new BaselineInputError("None of the uploaded files is a Settings Catalog policy exported from Intune.");
  }

  for (const { target, bytes } of toWrite) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  if (input.name?.trim()) await renamePack(root, pack, input.name);
  return pack;
}

/**
 * Sets the baseline's display name in its baseline.yml, creating the file
 * if there is none and leaving its setting annotations as they are.
 * (Comments in a hand-edited baseline.yml don't survive the rewrite.)
 */
export async function renamePack(root: string, pack: string, name: string): Promise<void> {
  const dir = packDir(root, pack);
  if (!existsSync(dir)) throw new BaselineInputError(`There is no baseline "${pack}".`);
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new BaselineInputError("A name is required.");
  if (trimmed.length > 120) throw new BaselineInputError("The name is too long (120 characters at most).");

  const file = join(dir, ANNOTATIONS_FILE);
  let existing: Record<string, unknown> = {};
  if (existsSync(file)) {
    const parsed = load(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
  }
  const { name: _old, ...rest } = existing;
  await writeFile(file, dump({ name: trimmed, ...rest }, { lineWidth: 100 }), "utf8");
}

/** Deletes the baseline's folder — and its source folder too, if that leaves it empty. */
export async function removePack(root: string, pack: string): Promise<void> {
  const dir = packDir(root, pack);
  if (!existsSync(dir)) throw new BaselineInputError(`There is no baseline "${pack}".`);
  await rm(dir, { recursive: true, force: true });
  await rmdir(dirname(dir)).catch(() => {
    // Not empty (other versions live there) — which is the usual case, and fine.
  });
}
