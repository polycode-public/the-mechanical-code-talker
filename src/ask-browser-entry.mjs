// ask-browser-entry.mjs — the esbuild entry for `tmct viz`'s embedded "Ask the
// graph" chat panel: a real NL chat running client-side against the embedded
// graph, via tmct's own JS engine (esbuild + a Node-builtin stub plugin
// bundles tmct's real ask() into a single browser IIFE).
//
import { ask, parseQuery } from "./ask.mjs";
import {
  parseEntities, spiralExpand, mostRecentIndividual, derivedUpdatedAt, MEMORY_SPIRAL_EXPAND_KINDS,
  MEMORY_FACT_LINK_KINDS, buildVizNodesAndEdges, deriveFactTermGraph, pickLegendDimension, legendValueFor,
  edgeKindsFor, collapseToTopN,
} from "./codegraph.mjs";

// Exported so the viewer page's client-side recentre/edge-kind-toggle/
// dimension-switcher reuses the same computation as the CLI, not a second copy.
globalThis.tmctViz = {
  ask, parseQuery, parseEntities, spiralExpand, mostRecentIndividual, derivedUpdatedAt,
  MEMORY_SPIRAL_EXPAND_KINDS, MEMORY_FACT_LINK_KINDS, buildVizNodesAndEdges,
  deriveFactTermGraph, pickLegendDimension, legendValueFor, edgeKindsFor, collapseToTopN,
};
