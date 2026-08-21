#!/usr/bin/env node
// Deliberately tiny, and deliberately the only thing that runs before the
// warning filter below is registered — everything else (commander, all the
// command modules, and transitively src/storage/db.ts's `node:sqlite`
// import) lives in ./cliMain.ts instead, loaded via a dynamic import.
//
// That split matters: ESM's static import graph is resolved asynchronously
// even for "static" `import` statements — Node's own module loader (not
// user code) is what calls node:sqlite's emitExperimentalWarning, during
// graph resolution, before any imported module's top-level body runs at
// all. A warning-suppression listener registered in a normal top-level
// statement here — even textually placed after the imports — was too late
// in practice (confirmed by testing: the warning still printed). A dynamic
// `import()` is a real async boundary the synchronous code below is
// guaranteed to run before, regardless of how deep or wide the graph
// behind it is.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && warning.message.includes("SQLite")) return;
  console.error(warning);
});

// Not awaited — nothing here needs to run after cliMain loads, and
// top-level await isn't supported by the CJS bundle the SEA packaging step
// produces (scripts/bundle.mjs). Errors during cliMain's own module-load
// (as opposed to errors it handles itself once running) are rare enough
// (a genuinely broken build) that a plain surfaced failure is fine here.
import("./cliMain.js").catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
