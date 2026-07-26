// verify-ask-browser-entry.mjs — a throwaway-turned-reusable check that
// src/surfaces/web/graph-ask-browser-entry.mjs (the `./ask-browser` package
// export) actually bundles for a real browser consumer's own bundler, with
// NO tmct-authored stub plugins applied. Run it after touching ask.mjs's,
// graph-service.mjs's, or either's transitive import graph, to confirm the
// entry point still links clean (or to re-measure which stubs it needs, the
// same way scripts/build-ask-bundle.mjs's own stub list was measured: drop
// stubs and let esbuild name what's still unresolved).
//
// `node scripts/verify-ask-browser-entry.mjs` — clean, no plugins.
// `node scripts/verify-ask-browser-entry.mjs --with-stubs` — with the same
// node-builtin stub plugin scripts/lib/browser-bundle.mjs's other builders
// use, for comparison once a real regression needs one.
import { build } from "esbuild";
import { stubNodeBuiltins } from "./lib/browser-bundle.mjs";

const withStubs = process.argv.includes("--with-stubs");

const result = await build({
  entryPoints: ["src/surfaces/web/graph-ask-browser-entry.mjs"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  write: false,
  logLevel: "silent",
  plugins: withStubs ? [stubNodeBuiltins] : [],
}).catch((err) => ({ errors: err.errors || [{ text: String(err) }] }));

if (result.errors && result.errors.length) {
  console.error(`FAILED (${withStubs ? "with" : "no"} stub plugins) — ${result.errors.length} unresolved import(s):\n`);
  for (const err of result.errors) {
    const at = err.location ? `${err.location.file}:${err.location.line}` : "(unknown location)";
    console.error(`  ${err.text}\n    at ${at}`);
  }
  process.exit(1);
}

console.log(`clean bundle (${withStubs ? "with stubNodeBuiltins" : "no stubs"}) — ${result.outputFiles[0].contents.length} bytes (unminified esm)`);
