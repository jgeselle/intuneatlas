// Bundles dist/cli.js (ESM, multi-file, relative imports) into a single CJS
// file — Node's Single Executable Applications feature wants one entry file,
// not a require()/import graph resolved against node_modules at runtime.
// This step is pure JS tooling — testable on any platform, unlike the actual
// SEA packaging step (scripts/build-sea.mjs), which is Windows-only.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("build", { recursive: true });

await build({
  entryPoints: ["dist/cli.js"],
  outfile: "build/intuneatlas-bundle.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // keytar (native OS-keychain binding, pulled in by
  // @azure/identity-cache-persistence) ships a .node binary esbuild can't
  // bundle as JS. Left external — at runtime this means require('keytar')
  // resolves against node_modules, which the packaged exe doesn't ship, so
  // it'll throw. That's fine: src/auth/interactive.ts already wraps cache
  // registration in a try/catch and falls back to a plain, uncached
  // credential (same graceful degradation already built for Linux, which
  // lacks a compatible keychain backend). Persistent token caching just
  // won't work in the packaged Windows exe until this is revisited —
  // documented, not a silent gap or a crash risk.
  external: ["keytar"],
  // esbuild empties every `import.meta.url` reference under CJS output —
  // confirmed the hard way: it broke a real file-path computation *inside
  // the bundled `open` package itself* (ESM-only, computes its own
  // __dirname from import.meta.url), not just our own code. Rather than
  // track down every bundled dependency that might do the same thing,
  // replace it globally with a real, correctly-computed file:// URL for
  // the actual running file — __filename is reliably real in CJS,
  // including once this runs inside a SEA-sealed executable.
  banner: {
    js: "const __intuneatlas_import_meta_url = require('node:url').pathToFileURL(__filename).href;",
  },
  define: { "import.meta.url": "__intuneatlas_import_meta_url" },
  logLevel: "info",
});
