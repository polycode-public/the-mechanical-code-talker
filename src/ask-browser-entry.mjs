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
import { ask, parseQuery } from "./ask.mjs";
import {
  parseEntities, spiralExpand, mostRecentIndividual, derivedUpdatedAt, MEMORY_SPIRAL_EXPAND_KINDS,
  MEMORY_FACT_LINK_KINDS, buildVizNodesAndEdges, deriveFactTermGraph, pickLegendDimension, legendValueFor,
  edgeKindsFor, collapseToTopN,
} from "./codegraph.mjs";

// PLAN_VIZ_MEMORY.md Bug 2 fix + Controls port: deriveFactTermGraph/
// pickLegendDimension/legendValueFor/MEMORY_FACT_LINK_KINDS/edgeKindsFor/
// collapseToTopN are exported here (alongside the pre-existing traversal
// exports) so the viewer page's client-side recentre/edge-kind-toggle/
// dimension-switcher (a user double-clicking a node, changing which edge
// kinds the walk follows, or flipping the legend from "split by predicate"
// to "split by trust source") re-derives the SAME term graph, kind set, and
// legend the CLI's own generation-time computeVizGraph used — never a second
// hand-rolled copy that could drift.
globalThis.tmctViz = {
  ask, parseQuery, parseEntities, spiralExpand, mostRecentIndividual, derivedUpdatedAt,
  MEMORY_SPIRAL_EXPAND_KINDS, MEMORY_FACT_LINK_KINDS, buildVizNodesAndEdges,
  deriveFactTermGraph, pickLegendDimension, legendValueFor, edgeKindsFor, collapseToTopN,
};
