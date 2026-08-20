// Injects the bundled app into a real node binary to produce a standalone
// executable — Node's Single Executable Applications (SEA) feature,
// classic postject-based flow (Node 22.x doesn't have the newer one-step
// --build-sea flag, that's 25.5+). Works the same way on Windows and
// Linux; only naming and the (Windows-only) signature-stripping step
// differ.
//
// UNTESTED ON WINDOWS FROM THIS REPO'S DEV SANDBOX (Linux) — the Windows
// path can only actually run on a real Windows machine or a
// `windows-latest` GitHub Actions runner (see
// .github/workflows/release.yml). The Linux path, unlike that, has
// actually been run and verified for real in this sandbox.
//
// Must run AFTER scripts/bundle.mjs (needs build/intuneatlas-bundle.cjs).
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync } from "node:fs";

const SUPPORTED_PLATFORMS = new Set(["win32", "linux"]);
if (!SUPPORTED_PLATFORMS.has(process.platform)) {
  console.error(`build-sea.mjs doesn't support ${process.platform} yet — only Windows and Linux.`);
  process.exit(1);
}

if (!existsSync("build/intuneatlas-bundle.cjs")) {
  console.error("build/intuneatlas-bundle.cjs not found — run `node scripts/bundle.mjs` first.");
  process.exit(1);
}

const EXE_PATH = process.platform === "win32" ? "build/intuneatlas.exe" : "build/intuneatlas";
// Fixed constant from Node's SEA docs — the runtime checks for this exact
// string to confirm it's genuinely running as a sealed executable. Not
// something to invent or change.
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

console.log("1/4 Generating the SEA blob from sea-config.json...");
execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], { stdio: "inherit" });

console.log(`2/4 Copying the current node binary as the base (${process.execPath})...`);
// Using process.execPath (the exact node binary running this script, e.g.
// the one GitHub Actions' setup-node just installed) rather than a
// separately downloaded copy — guarantees the blob and the injection
// target are the same Node version/build, which the Node docs
// specifically warn must match.
copyFileSync(process.execPath, EXE_PATH);

if (process.platform === "win32") {
  console.log("3/4 Stripping any existing signature from the copied node.exe...");
  try {
    execFileSync("signtool", ["remove", "/s", EXE_PATH], { stdio: "inherit" });
  } catch {
    // Best-effort — official Node node.exe builds aren't always signed, and
    // signtool may not be on PATH on every runner image. Not fatal either
    // way; postject can still inject into an unsigned binary.
    console.log("  (signtool not available or nothing to strip — continuing)");
  }
} else {
  console.log("3/4 (no signature-stripping step needed on Linux)");
}

console.log("4/4 Injecting the blob via postject...");
execFileSync(
  "npx",
  [
    "postject",
    EXE_PATH,
    "NODE_SEA_BLOB",
    "build/sea-prep.blob",
    "--sentinel-fuse",
    SENTINEL_FUSE,
    "--overwrite",
  ],
  { stdio: "inherit", shell: true },
);

if (process.platform !== "win32") {
  // postject rewrites the file in place — make sure the result is still
  // executable (seen the hard way: not always preserved).
  chmodSync(EXE_PATH, 0o755);
}

console.log(`\nDone: ${EXE_PATH}`);
if (process.platform === "win32") {
  console.log("Not signed — see the project plan for the signing-certificate follow-up.");
}
