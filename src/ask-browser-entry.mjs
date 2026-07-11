// ask-browser-entry.mjs — the esbuild entry for `tmct viz`'s embedded "Ask the
// graph" chat panel (PLAN_BREADTH_FIRST_NLU.md §5 follow-on, operator directive
// 2026-07-11: a real NL chat running client-side against the embedded graph,
// via tmct's OWN JS engine — not reimplemented, not a stub).
//
// Precedent: seonix's own `src/ask-browser-entry.mjs` (PLAN_CHAT_EXTRACTION.md
// Stage 5) proved this exact approach in production — esbuild + a Node-builtin
// stub plugin bundles tmct's real ask() into a single browser IIFE. This entry
// mirrors that pattern, adapted for tmct bundling its OWN ask.mjs directly
// (no external package import needed — we're already inside the source tree)
// and extended with the graph-traversal exports `tmct viz`'s own client-side
// re-focus/re-walk needs (spiralExpand etc. — seonix's code-graph viewer
// recomputes depth with its own hand-rolled client-side BFS; tmct's viewer
// reuses the real spiralExpand instead, so the browser walk is byte-identical
// to the CLI's).
//
// Bundled by scripts/build-ask-bundle.mjs into src/ask-browser.bundle.js (an
// IIFE), which viz.mjs inlines verbatim into the viewer page's own <script>.
// Runs adapter-less (no wink model in the browser — ask()'s lemma/POS tier
// degrades to its curated + fuzzy tiers, exactly the boundary
// test/ask-nlp.test.mjs's own "viewer bundle without wink" test proves stays
// answerable) and grammar-lite (no ACE/construction-grammar strategies, both
// fs-dependent — the plain grammar/keyword-spot/noise-strip strategies still
// answer every shape tmct viz's own memory-graph queries need).
import { ask, parseQuery } from "./ask.mjs";
import {
  parseEntities, spiralExpand, mostRecentIndividual, derivedUpdatedAt, MEMORY_SPIRAL_EXPAND_KINDS,
  buildVizNodesAndEdges,
} from "./codegraph.mjs";

globalThis.tmctViz = {
  ask, parseQuery, parseEntities, spiralExpand, mostRecentIndividual, derivedUpdatedAt,
  MEMORY_SPIRAL_EXPAND_KINDS, buildVizNodesAndEdges,
};
