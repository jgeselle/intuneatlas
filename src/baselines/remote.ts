import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { ANNOTATIONS_FILE } from "./loader.js";

/**
 * A baseline from a URL.
 *
 * A baseline is a folder of exported policies, and on the web a folder is
 * one of three things: a folder in a GitHub repository (what someone
 * copies from their browser's address bar), an archive of one (.tar.gz or
 * .zip, from anywhere — a release asset, another forge's "download"
 * link), or, at its smallest, a single exported policy. All three are
 * taken; which one a URL is, is told from what comes back, not from how
 * the URL is spelled.
 *
 * Only what a baseline is made of is kept — .json files and a
 * baseline.yml — and nothing is written outside the folder given: an
 * archive is someone else's content, and its paths are not trusted.
 */
export interface RemoteBaseline {
  /** What to call it, from the URL: "OpenIntuneBaseline WINDOWS". */
  name: string;
  /** How many files were written. */
  files: number;
}

/** Enough for any real baseline many times over; a wrong URL shouldn't fill a disk. */
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;

interface Source {
  /** URLs to try in order — a GitHub ref can contain slashes, so where it ends isn't always knowable up front. */
  candidates: Array<{ url: string; subpath: string }>;
  /** Archives from GitHub wrap everything in one top folder ("repo-ref/"). */
  stripTopFolder: boolean;
  name: string;
}

/** Turns what was pasted into what to download. Anything that isn't a GitHub page is fetched as it is. */
export function resolveBaselineUrl(input: string): Source {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`"${input}" is neither a folder on this machine nor a URL.`);
  }
  const lastSegment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? url.hostname).replace(/\.(tar\.gz|tgz|zip|json)$/i, "");

  if (url.hostname === "github.com") {
    const [owner, repo, kind, ...rest] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (owner && repo && !kind) {
      return { candidates: [{ url: `https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`, subpath: "" }], stripTopFolder: true, name: repo };
    }
    if (owner && repo && kind === "tree" && rest.length > 0) {
      // "tree/<ref>/<path>": the ref is usually one segment (main, v4.0) but may be several (release/2026).
      const candidates = rest.slice(0, 3).map((_, i) => ({
        url: `https://codeload.github.com/${owner}/${repo}/tar.gz/${rest.slice(0, i + 1).map(encodeURIComponent).join("/")}`,
        subpath: rest.slice(i + 1).join("/"),
      }));
      return { candidates, stripTopFolder: true, name: [repo, rest[rest.length - 1]].filter((part, i) => i === 0 || rest.length > 1).join(" ") };
    }
    if (owner && repo && kind === "blob" && rest.length > 1) {
      return { candidates: [{ url: `https://raw.githubusercontent.com/${owner}/${repo}/${rest.map(encodeURIComponent).join("/")}`, subpath: "" }], stripTopFolder: false, name: lastSegment };
    }
  }
  return { candidates: [{ url: url.toString(), subpath: "" }], stripTopFolder: false, name: lastSegment };
}

async function download(url: string): Promise<Buffer | undefined> {
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "intuneatlas" } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Couldn't download ${url}: ${response.status} ${response.statusText}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error(`${url} is ${Math.round(declared / 1024 / 1024)} MB — too large to be a baseline.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error(`${url} is too large to be a baseline.`);
  return bytes;
}

interface ArchiveEntry {
  path: string;
  data: Buffer;
}

/** The files of a .tar — plain, with a ustar prefix, a GNU long name, or a pax path, which between them cover what forges produce. */
export function readTar(tar: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  const text = (start: number, length: number, block: Buffer) => {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? length : end).toString("utf8");
  };
  let longName: string | undefined;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(text(124, 12, header).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = data.toString("utf8").replace(/\0+$/, "");
    } else if (type === "x") {
      // pax records: "<length> key=value\n"
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"))?.[1];
      if (path) longName = path;
    } else if (type === "0" || type === "\0") {
      const prefix = text(345, 155, header);
      entries.push({ path: longName ?? (prefix ? `${prefix}/` : "") + text(0, 100, header), data: Buffer.from(data) });
      longName = undefined;
    } else if (type !== "g") {
      longName = undefined;
    }
  }
  return entries;
}

/** The files of a .zip, stored or deflated — read from its central directory. */
export function readZip(zip: Buffer): ArchiveEntry[] {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("That .zip file is damaged or incomplete.");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  if (offset === 0xffffffff) throw new Error("That .zip file is in a format for very large archives, which isn't supported — use a .tar.gz instead.");

  const entries: ArchiveEntry[] = [];
  for (let i = 0; i < count && zip.readUInt32LE(offset) === 0x02014b50; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const path = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/")) continue;

    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) continue; // a compression nobody uses for this; the file is simply not read
    entries.push({ path, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
  }
  return entries;
}

/** What a downloaded thing is, by its first bytes. */
function entriesOf(bytes: Buffer, fileName: string): ArchiveEntry[] {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return readTar(gunzipSync(bytes));
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readZip(bytes);
  const start = bytes.subarray(0, 64).toString("utf8").replace(/^﻿/, "").trimStart();
  // UTF-16 exports start with a byte-order mark; the loader decodes them.
  if (start.startsWith("{") || (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return [{ path: `${fileName}.json`, data: bytes }];
  if (/^<(!doctype|html)/i.test(start)) {
    throw new Error("That URL is a web page, not a baseline. Give a GitHub folder URL, a link to a .zip or .tar.gz archive, or a link to an exported policy's .json file.");
  }
  throw new Error("That URL isn't a .zip or .tar.gz archive or an exported policy's .json file.");
}

/**
 * Downloads the baseline at `url` into `destination` (created if need
 * be). Throws if the URL leads to nothing a baseline could be made of.
 */
export async function fetchBaseline(url: string, destination: string): Promise<RemoteBaseline> {
  const source = resolveBaselineUrl(url);
  for (const candidate of source.candidates) {
    const bytes = await download(candidate.url);
    if (!bytes) continue;

    let written = 0;
    for (const entry of entriesOf(bytes, source.name)) {
      const segments = entry.path.split(/[\\/]+/).filter(Boolean);
      if (source.stripTopFolder) segments.shift();
      const path = segments.join("/");
      const wanted = candidate.subpath ? path.startsWith(candidate.subpath + "/") : true;
      const relative = (candidate.subpath ? path.slice(candidate.subpath.length + 1) : path).split("/");
      const fileName = relative[relative.length - 1] ?? "";
      // Only the two kinds of file a baseline has, and never a path that leaves the folder.
      if (!wanted || !(/\.json$/i.test(fileName) || fileName === ANNOTATIONS_FILE) || relative.some((part) => part === ".." || part === "." || part.includes(":"))) continue;
      const target = join(destination, ...relative);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.data);
      written++;
    }
    if (written === 0) throw new Error(`Nothing at ${url} looks like a baseline: no .json files${candidate.subpath ? ` under "${candidate.subpath}"` : ""}.`);
    return { name: source.name, files: written };
  }
  throw new Error(`Nothing found at ${url} (404). Check the URL — for GitHub, the branch or tag and the folder's path.`);
}
