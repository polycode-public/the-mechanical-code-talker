// graph-ask-browser-entry.mjs — the public, browser-safe entry point for
// tmct's CODE-graph query engine (`./ask-browser` package export).
//
// A plain re-export, zero side effects, zero `globalThis` assignment: unlike
// this directory's other *-browser-entry.mjs files (built into an IIFE and
// inlined into a specific tmct page), this one is meant to be imported by a
// DOWNSTREAM consumer's own bundler (e.g. seonix's website chat panel) as a
// genuine ESM module, not inlined by tmct's own build scripts.
//
// It exists because the package root (`src/services/index.mjs`, and its
// `.`/exports subpath) also runs Node-side composition wiring at module-load
// time — `setDefaultNlpAdapter(nlpAdapter)` from `../adapters/ask-nlp.mjs`
// (wink-nlp, a ~4MB model) and `setConstructionBanks(readConstructionFiles)`
// from `../adapters/corpus/construction-banks.mjs` (fs reads) — neither of
// which can run or bundle in a browser. This file imports only ask.mjs and
// graph-service.mjs directly, so none of that wiring is reachable from here.
//
// Verified with `esbuild --bundle --platform=browser --format=esm`
// (scripts/verify-ask-browser-entry.mjs). ask()'s optional strategies
// (ace.mjs, constructions.mjs) and the wink lemma/POS adapter are all reached
// through nlp-registry.mjs's `defaultNlp()` registry seam and each call
// site's own `typeof X !== "undefined"` guard, not a static import, so a
// consumer bundling this entry point alone never links wink-nlp or any
// fs-reading corpus module — none of the ask-nlp.mjs/ace.mjs/
// constructions.mjs/construction-banks.mjs/digest-bank.mjs family of stubs
// scripts/build-ask-bundle.mjs needs for chat.mjs is required here.
//
// One real gap remains: `createGraphService` pulls in source-slice.mjs,
// which imports `node:path` (join/resolve/sep) for span math, so a browser
// bundler with no Node shims will fail on that one specifier. Apply the
// same generic `stubNodeBuiltins` plugin scripts/lib/browser-bundle.mjs
// already exports for tmct's own bundles (or an equivalent node:path shim —
// e.g. esbuild's own `--define`/polyfill options, or a bundler that already
// ships a node:path shim, as most do). Re-run
// `node scripts/verify-ask-browser-entry.mjs` (clean) and
// `node scripts/verify-ask-browser-entry.mjs --with-stubs` (with the shim)
// after touching ask.mjs's or graph-service.mjs's import graph — if the
// no-stub run ever passes clean, or a new specifier shows up, update this
// comment to match what esbuild actually reports.
export { ask, resolveObject } from "../../domain/ask.mjs";
export { createGraphService } from "../../adapters/providers/graph-service.mjs";
