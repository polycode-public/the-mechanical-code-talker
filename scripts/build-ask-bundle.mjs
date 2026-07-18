// build-ask-bundle.mjs — bundle tmct's memory-graph answer engine for the
// ledger page's in-browser chat dock.
//
// Builds ONE IIFE bundle:
//   - src/surfaces/web/memory-ask-browser-entry.mjs -> src/surfaces/web/memory-ask-browser.bundle.js —
//     tmct's MEMORY-graph answer engine (chat.mjs's factAnswer/factReadBack,
//     the same ones `npm run chat` uses): "what is a dog", "who is the
//     grandfather of ishmael".
// It's inlined verbatim into the page by ledger-viz.mjs's renderLedgerHtml.
// Regenerate after touching src/services/chat.mjs and its dependents:
// `npm run build:ask-bundle`.
//
// Adapted directly from seonix's own scripts/build-ask-bundle.mjs (proven in
// production for its "Ask the graph" website panel) — same Node-builtin-stub
// approach, extended with tmct-specific stubs for the optional-adapter
// imports the source itself already documents as strip-compatible (see each
// file's own "inlined viewer bundle" comments): ask-nlp.mjs (wink — a ~4MB
// model tmct's own architecture deliberately keeps out of any browser bundle),
// grammar/strategies/ace.mjs and interpret/strategies/constructions.mjs (both
// fs-dependent — read a committed lexicon/template file at import time, never
// available in a browser). Each real call site already guards with a
// `typeof X !== "undefined"` check for exactly this degradation, so a stub
// exporting the binding as `undefined` reproduces the intended graceful
// fallback, not a crash or a silent behavior change.
//
// The memory-ask bundle pulls in nearly all of chat.mjs's own transitive
// import graph (it's a monolith — factAnswer shares the module with every
// other lane) — none of that extra code ever RUNS (factAnswer's only real I/O
// is loadMemory(memoryDir), and the dock always hands it an in-memory
// Backend-B handle already carrying the page's payload — see
// src/surfaces/web/memory-ask-browser-entry.mjs's own doc comment), it just has to
// LINK. The node-builtin stub (scripts/lib/browser-bundle.mjs) carries exactly
// the bindings that graph still references — measured by dropping each and
// letting esbuild name what breaks, so it shrinks as the monolith's link edges
// do.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { stubNodeBuiltins, makeOptionalAdapterStubs, buildBundle } from "./lib/browser-bundle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");
// The bundle lands under outDir. It defaults to the repo's own src/, which is
// what CI and a local `npm run build:ask-bundle` want. Set TMCT_ASK_BUNDLE_OUT
// to build into a directory of your own instead. The e2e tests do that so their
// run never rewrites the committed bundle while another test file reads it.
// Entry points always resolve against src/; only the output moves.
const outDir = process.env.TMCT_ASK_BUNDLE_OUT ? resolve(process.env.TMCT_ASK_BUNDLE_OUT) : srcDir;

// Optional-adapter modules tmct's own source already documents as
// strip-compatible (see each real import site's "inlined viewer bundle"
// comment in src/domain/ask.mjs / src/domain/interpret/pipeline.mjs). Stubbed as an explicit
// `undefined` export, not an empty module — the calling code's own
// `typeof X !== "undefined"` guards depend on the binding existing and being
// exactly `undefined`, not on the import simply failing to resolve.
const OPTIONAL_ADAPTER_STUBS = {
  "ask-nlp.mjs": "export const nlpAdapter = undefined;\n",
  "strategies/ace.mjs": "export const aceStrategy = undefined;\nexport const parseAceAmbiguous = undefined;\n",
  "strategies/constructions.mjs": "export const constructionsStrategy = undefined;\nexport const setConstructionBanks = () => {};\n",
  // the fs+TOML side of the construction banks — never read in the browser
  // (the strategy above is stubbed out entirely).
  "corpus/construction-banks.mjs": "export const CONSTRUCTIONS_DIR = \"\";\nexport const readConstructionFiles = () => ({ relations: [], constructions: [] });\n",
  // phrasing variety stays OFF in the dock — the browser answer is always the
  // base phrase, exactly as it was when the variants file couldn't be read.
  "answer-variants.mjs": "export const pickPhrase = (poolId, key, base) => base;\n",
};

await buildBundle({
  entryFile: "surfaces/web/memory-ask-browser-entry.mjs",
  outFile: "surfaces/web/memory-ask-browser.bundle.js",
  outDir,
  plugins: [makeOptionalAdapterStubs(OPTIONAL_ADAPTER_STUBS), stubNodeBuiltins],
});
