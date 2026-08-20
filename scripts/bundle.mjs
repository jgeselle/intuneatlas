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
  // keytar (native OS-keychain binding, pulled in by both
  // @azure/identity-cache-persistence AND @azure/msal-node-extensions) ships
  // a .node binary esbuild can't bundle as JS. @azure/msal-node-extensions
  // itself also pulls in @azure/msal-node-runtime, which ships its own
  // platform-specific .node binaries (native broker support) resolved via
  // path logic that breaks once hoisted into a single bundled file — so the
  // whole package is left external, not just keytar, to keep esbuild from
  // ever trying to inline it. At runtime this means require('keytar') /
  // require('@azure/msal-node-extensions') resolve against node_modules,
  // which the packaged exe doesn't ship, so both throw. That's fine:
  // src/auth/interactive.ts and src/auth/webSession.ts (via
  // createMsalCachePlugin in tokenCache.ts) both wrap cache setup in a
  // try/catch and fall back to no persistent cache (same graceful
  // degradation already built for Linux, which lacks a compatible keychain
  // backend). Persistent caching just won't work in the packaged Windows
  // exe until this is revisited — documented, not a silent gap or a crash
  // risk.
  external: ["keytar", "@azure/msal-node-extensions"],
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
