// viz.mjs — `tmct viz`: a real, navigable, self-contained HTML graph view over
// the memory graph, with a real "Ask the graph" chat panel running tmct's OWN
// engine client-side (adapted to bundle tmct's ask.mjs directly rather than
// an external package import).
//
// Three pure/impure-separated pieces, mirroring src/syllogise.mjs's shape:
//   - computeVizGraph(repoDir, {focus}) — I/O (loadMemory) + graph traversal,
//     reusing spiralExpand/mostRecentIndividual/MEMORY_SPIRAL_EXPAND_KINDS/
//     buildVizNodesAndEdges. No new traversal logic here.
//   - renderVizHtml({nodes, edges, focus, payload, askBundle}) — a pure
//     string-builder: one complete <!doctype html> document, graph data
//     JSON-embedded inline, the real ask-engine bundle inlined verbatim, no
//     external <script src>, no CDN, no fonts — opens and works offline.
//   - readAskBundle() — the one bit of I/O renderVizHtml itself doesn't do:
//     reads the checked-in build artifact (scripts/build-ask-bundle.mjs's
//     output). bin/tmct.mjs's `viz` mode wires all three together.

import { loadMemory, CREATED_AT_PROP, normFactTerm } from "./memory/core.mjs";
import {
  parseEntities, spiralExpand, mostRecentIndividual, MEMORY_SPIRAL_EXPAND_KINDS, MEMORY_FACT_LINK_KINDS,
  buildVizNodesAndEdges, deriveFactTermGraph, pickLegendDimension, edgeKindsFor,
} from "./codegraph.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The page-size strategy: a three-cap default (200 base, tuned up to 300 here),
// raised from the code-graph-only SPIRAL_NODE_LIMIT_DEFAULT (12 — a MID-tier
// digest breadth, not a graph-viewer breadth) now that real concept-relation
// edges are walkable.
export const VIZ_NODE_LIMIT_DEFAULT = 300;
export const VIZ_HUB_DEGREE_DEFAULT = 40;
export const VIZ_DEPTH_DEFAULT = 3; // mirrors spiralExpand's own SPIRAL_DEPTH_DEFAULT

// edgeKindsFor lives in codegraph.mjs; re-exported here so the browser bundle's
// client-side re-walk (which can't import this fs-touching module) can share it.
export { edgeKindsFor };

/** Load the memory graph under `repoDir`, walk it from a seed, and enrich each walked node
 *  with the real label/class/timestamp data a renderer needs.
 *  Seed precedence: `--focus <id>`, then `--term <word>` (via deriveFactTermGraph's
 *  synthetic `term:<word>` node, reaching the term's whole concept neighbourhood), then
 *  `mostRecentIndividual`.
 *  `edgeKindMode`: "both" (default) walks meta/provenance kinds AND real concept-relation
 *  kinds together; "meta" is provenance-only; "relation" isolates the concept view.
 *  `hubDegree`: stop expanding THROUGH a node with more connections than this (still shows
 *  the hub itself), so a common hypernym can't swallow the whole node budget in one hop.
 *  Returns `{nodes, edges, focus, payload, legend}` — `payload` is the FULL raw graph (the
 *  "Ask the graph" panel can re-walk from a new focus over it). Never throws on a
 *  missing/empty memory dir. */
export async function computeVizGraph(repoDir, { focus, term, depth, nodeLimit, hubDegree, edgeKindMode = "both" } = {}) {
  const payload = await loadMemory(repoDir);
  const graph = parseEntities(payload);
  // Always resolved (defaults filled in), so renderVizHtml can embed it for a
  // client-side re-walk to stay consistent with how this page was generated.
  const walkOpts = {
    depth: depth != null ? depth : VIZ_DEPTH_DEFAULT,
    nodeLimit: nodeLimit != null ? nodeLimit : VIZ_NODE_LIMIT_DEFAULT,
    hubDegree: hubDegree != null ? hubDegree : VIZ_HUB_DEGREE_DEFAULT,
    edgeKindMode,
  };
  if (!graph.individuals.length) return { nodes: [], edges: [], focus: null, payload, legend: null, walkOpts };

  const { graph: augmented, factRelationKinds } = deriveFactTermGraph(graph);

  let seedId = focus || null;
  if (!seedId && term) {
    const termId = `term:${normFactTerm(term)}`;
    if (augmented.byId.has(termId)) seedId = termId;
    // no match: falls through to the default seed below, exactly as if
    // --term had never been given — an honest miss never seeds a phantom node.
  }
  if (!seedId) seedId = mostRecentIndividual(graph, CREATED_AT_PROP)?.id || null;
  if (!seedId) return { nodes: [], edges: [], focus: null, payload, legend: null, walkOpts };

  const walked = spiralExpand(augmented, [], {
    kinds: edgeKindsFor(edgeKindMode, factRelationKinds),
    classPredicate: () => true,
    idNormalizer: (id) => id,
    seeds: [seedId],
    depth: walkOpts.depth,
    nodeLimit: walkOpts.nodeLimit,
    hubDegree: walkOpts.hubDegree,
  });

  const { nodes, edges } = buildVizNodesAndEdges(augmented, walked);
  const legend = pickLegendDimension(augmented, nodes);
  return { nodes, edges, focus: seedId, payload, legend, walkOpts };
}

/** Read the checked-in browser ask-engine bundle (`src/ask-browser.bundle.js`). Returns
 *  `""`, never throws, if the bundle hasn't been built — renderVizHtml then renders a
 *  graph-only page with an honest "chat unavailable" note. */
export async function readAskBundle() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return await readFile(join(here, "ask-browser.bundle.js"), "utf8");
  } catch {
    return "";
  }
}

/** Read the checked-in browser memory-ask-engine bundle (`src/memory-ask-browser.bundle.js`)
 *  — the real memory-graph answer engine (chat.mjs's factAnswer). Same never-throws
 *  contract as readAskBundle(). */
export async function readMemoryAskBundle() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return await readFile(join(here, "memory-ask-browser.bundle.js"), "utf8");
  } catch {
    return "";
  }
}

/** Escape untrusted text for safe placement inside HTML content/attributes. */
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** JSON-embed graph data into a `<script>` tag safely — escape `</` so a
 *  label/id containing "</script>" can't break out of the tag, and escape
 *  U+2028/U+2029 (valid in JSON strings, invalid unescaped in JS source). */
export function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Render one complete, self-contained `<!doctype html>` document for
 *  `{nodes, edges, focus, payload, askBundle}` (computeVizGraph's return shape, plus the
 *  ask-engine bundle text from readAskBundle()): graph data JSON-embedded inline, the real
 *  ask.mjs engine inlined verbatim, inline <style>, inline vanilla-JS implementing a
 *  concentric ring layout keyed on hop, pan/zoom, click-a-node details, visibility filters,
 *  and a real "Ask the graph" chat panel (focus-follows-answer). Pure string building — no
 *  fs/network, no external <script src>, no CDN, no fonts. */
export function renderVizHtml({ nodes, edges, focus, payload, askBundle, memoryAskBundle, legend, walkOpts }) {
  const graphJson = embedJson({ nodes, edges, focus });
  const payloadJson = embedJson(payload || { individuals: [], objectProperties: [] });
  const legendJson = embedJson(legend || null);
  const walkOptsJson = embedJson(walkOpts || { depth: VIZ_DEPTH_DEFAULT, nodeLimit: VIZ_NODE_LIMIT_DEFAULT, hubDegree: VIZ_HUB_DEGREE_DEFAULT, edgeKindMode: "both" });
  const title = `tmct viz — ${nodes.length} node${nodes.length === 1 ? "" : "s"}${focus ? ` (seed: ${escapeHtml(focus)})` : ""}`;
  const hasChat = Boolean(askBundle);
  const hasMemChat = Boolean(memoryAskBundle);
  const hasAnyChat = hasChat || hasMemChat;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; height: 100%; background: #0b0d12; color: #e7e9ee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  #wrap { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
  canvas.grabbing { cursor: grabbing; }
  #hud { position: absolute; top: 12px; left: 12px; max-width: 34ch; background: rgba(20,22,30,0.82); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; line-height: 1.45; pointer-events: none; }
  #hud b { color: #fff; }
  #hud .muted { color: #9aa1b0; display: block; margin: 4px 0 8px; }
  #hud button { pointer-events: auto; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #e7e9ee; border-radius: 5px; padding: 3px 9px; font-size: 12px; cursor: pointer; }
  #hud button:hover { background: rgba(255,255,255,0.18); }
  #controls { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: center; background: rgba(20,22,30,0.88); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 7px 12px; font-size: 12.5px; flex-wrap: wrap; max-width: min(86vw, 900px); }
  #controls .grp { display: flex; align-items: center; gap: 5px; }
  #controls button { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #e7e9ee; border-radius: 5px; width: 22px; height: 22px; line-height: 1; cursor: pointer; font-size: 13px; }
  #controls button:hover:not(:disabled) { background: rgba(255,255,255,0.18); }
  #controls button:disabled { opacity: 0.35; cursor: default; }
  #controls .depthval { min-width: 1.4em; text-align: center; display: inline-block; }
  #controls label.typechk { display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
  #controls label.typechk:hover { background: rgba(255,255,255,0.08); }
  #controls .swatch { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  #controls select, #controls input[type="number"], #controls input[type="text"].search { background: #14161e; color: #e7e9ee; border: 1px solid #2a2e42; border-radius: 5px; padding: 2px 5px; font: inherit; font-size: 12px; }
  #controls input[type="number"] { width: 3.6em; }
  #controls input[type="text"].search { width: 9em; }
  #controls .sep { width: 1px; align-self: stretch; background: rgba(255,255,255,0.14); margin: 0 2px; }
  #legend { position: absolute; bottom: 12px; left: 12px; display: none; flex-wrap: wrap; gap: 6px; align-items: center; background: rgba(20,22,30,0.88); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 6px 10px; font-size: 11.5px; max-width: min(60vw, 640px); }
  #legend.show { display: flex; }
  #legend select { background: #14161e; color: #e7e9ee; border: 1px solid #2a2e42; border-radius: 5px; padding: 1px 4px; font: inherit; font-size: 11px; }
  #legend .chip { display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 2px 6px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.16); }
  #legend .chip.off { opacity: 0.4; }
  #legend .chip .swatch { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  #legend .chip .n { color: #9aa1b0; }
  #panel { position: absolute; top: 12px; right: 404px; width: 280px; max-width: calc(100vw - 428px); background: rgba(20,22,30,0.92); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 12px 14px; font-size: 13px; line-height: 1.5; display: none; }
  #panel.show { display: block; }
  #panel h2 { margin: 0 0 6px; font-size: 14px; word-break: break-word; }
  #panel dl { margin: 8px 0 0; }
  #panel dt { color: #9aa1b0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 6px; }
  #panel dd { margin: 0; word-break: break-word; }
  #panel dd a, #panel dd button.lnk { color: #7aa2f7; text-decoration: none; cursor: pointer; background: none; border: none; padding: 0; font: inherit; }
  #panel dd a:hover, #panel dd button.lnk:hover { text-decoration: underline; }
  #panel .row { display: flex; gap: 8px; margin-top: 10px; }
  #panel button.act { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); color: #e7e9ee; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
  #panel button.act:hover { background: rgba(255,255,255,0.16); }
  #empty { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; text-align: center; padding: 24px; }
  #empty.show { display: flex; }
  #empty div { max-width: 46ch; color: #9aa1b0; }
  #empty b { color: #e7e9ee; }
  #ask { position: absolute; top: 12px; bottom: 12px; right: 12px; width: 380px; max-width: calc(100vw - 24px); background: rgba(20,22,30,0.92); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; display: flex; flex-direction: column; }
  #ask h3 { margin: 0 0 6px; font-size: 12.5px; color: #9aa1b0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; flex: 0 0 auto; }
  #ask .row { display: flex; gap: 6px; flex: 0 0 auto; }
  #askq { flex: 1; min-width: 0; background: #14161e; color: #e7e9ee; border: 1px solid #2a2e42; border-radius: 5px; padding: 6px 9px; font: inherit; font-size: 12.5px; }
  #askq:focus { outline: none; border-color: #7aa2f7; }
  #askq:disabled { opacity: 0.6; }
  #asksubmit { background: rgba(122,162,247,0.18); border: 1px solid #7aa2f7; color: #cfe0ff; border-radius: 5px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; }
  #asksubmit:hover { background: rgba(122,162,247,0.3); }
  #askresult { margin-top: 8px; flex: 1 1 auto; min-height: 0; overflow: auto; line-height: 1.55; color: #c0caf5; white-space: pre-wrap; }
  #askresult .q { color: #565f89; font-style: normal; margin-bottom: 3px; }
  #askresult.miss { color: #a9b1d6; font-style: italic; }
  #askresult .canon { margin-top: 6px; color: #6b7189; font-size: 11px; font-style: normal; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 5px; }
  #askresult .src { margin-top: 4px; color: #565f89; font-size: 10.5px; }
  #ask .hint { color: #6b7189; font-size: 11px; flex: 0 0 auto; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="c"></canvas>
  <div id="hud"><b>tmct viz</b><span class="muted">drag to pan &middot; scroll to zoom &middot; click a node for details &middot; double-click to re-centre</span><button id="resetview" title="reset pan/zoom to fit the current view">reset view</button></div>
  <div id="controls">
    <span class="grp"><span class="muted">depth</span><button id="depthdown" title="shallower">&minus;</button><b class="depthval" id="depthval"></b><button id="depthup" title="deeper">+</button></span>
    <span class="grp" id="typefilters"></span>
    <span class="sep"></span>
    <span class="grp"><span class="muted">edges</span><select id="edgekind" title="which kinds of edge the walk follows">
      <option value="both">both (default)</option>
      <option value="relation">concept relations</option>
      <option value="meta">provenance only</option>
    </select></span>
    <span class="grp"><label title="hide nodes above N connections outright"><input type="checkbox" id="hubhideon"> hub-hide &gt;</label><input type="number" id="hubhideval" min="1"></span>
    <span class="grp"><label title="keep only the top-N neighbours by degree per hop"><input type="checkbox" id="beamon"> beam-prune</label><input type="number" id="beamval" min="1"></span>
    <span class="grp"><span class="muted">labels</span><select id="labelmode">
      <option value="smart">smart</option>
      <option value="all">all names</option>
      <option value="name-source">name + source</option>
      <option value="none">none</option>
    </select></span>
    <span class="sep"></span>
    <span class="grp"><input type="text" class="search" id="search" placeholder="search labels&hellip;" autocomplete="off"><b id="searchcount" class="muted"></b></span>
  </div>
  <div id="legend"><span class="muted">legend</span><select id="legenddim"></select><span id="legendchips"></span></div>
  <div id="panel"></div>
  <div id="empty"><div><b>No graph data.</b><br>This repo has no <code>.tmct/memory/graph.json</code> yet (or the requested <code>--focus</code>/<code>--term</code> wasn't found). Run <code>tmct chat</code> in that repo first, then re-run <code>tmct viz</code>.</div></div>
  <div id="ask">
    <h3>Ask the graph</h3>
    <div class="row"><input id="askq" type="text" autocomplete="off" placeholder='ask e.g. "what is a dog"'${hasAnyChat ? "" : " disabled"}><button id="asksubmit"${hasAnyChat ? "" : " disabled"}>ask</button></div>
    <div id="askresult">${hasAnyChat
      ? '<span class="hint">running the real tmct engine(s), client-side, right here &mdash; try &quot;what is X&quot; or &quot;where is X mentioned&quot;. Answers re-centre the graph on what they resolve.</span>'
      : '<span class="hint">chat unavailable &mdash; run <code>npm run build:ask-bundle</code> and re-generate this page.</span>'}</div>
  </div>
</div>
<script>
const GRAPH = ${graphJson};
const PAYLOAD = ${payloadJson};
const LEGEND = ${legendJson};
const WALK_OPTS = ${walkOptsJson};
</script>
${hasChat ? `<script>\n${askBundle}\n</script>` : ""}
${hasMemChat ? `<script>\n${memoryAskBundle}\n</script>` : ""}
<script>
(function () {
  "use strict";

  var emptyEl = document.getElementById("empty");
  if (!GRAPH.nodes.length) { emptyEl.classList.add("show"); return; }

  var hasEngine = typeof tmctViz !== "undefined";
  var hasMemEngine = typeof tmctMemoryAsk !== "undefined";
  var FULL_GRAPH = hasEngine ? tmctViz.parseEntities(PAYLOAD) : null;
  // The term-relation view over the FULL graph, computed once —
  // recentre()/edge-kind-toggle re-walks reuse it rather than re-deriving it
  // per click. hasEngine-gated: the walk/legend exports only exist in the
  // ask-browser bundle, not the memory-ask one.
  var TERM_GRAPH = hasEngine ? tmctViz.deriveFactTermGraph(FULL_GRAPH) : null;
  // kindsForMode reuses the bundled tmctViz.edgeKindsFor — the SAME function
  // the CLI's own computeVizGraph calls server-side — rather than a second
  // hand-rolled copy of the meta/relation/both combination logic.
  function kindsForMode(mode) {
    return tmctViz.edgeKindsFor(mode, TERM_GRAPH ? TERM_GRAPH.factRelationKinds : []);
  }
  var edgeKindMode = WALK_OPTS.edgeKindMode || "both";
  document.getElementById("edgekind").value = edgeKindMode;

  // ---- palette: one hue per class, stable across recentres --------------
  var PALETTE = ["#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#f7768e", "#73daca", "#c0caf5"];
  var classColor = new Map();
  function colorFor(cls) {
    if (!classColor.has(cls)) classColor.set(cls, PALETTE[classColor.size % PALETTE.length]);
    return classColor.get(cls);
  }
  // seed the palette + type-filter checkboxes from every class in the FULL
  // graph (not just the currently-walked subset), so filters stay stable
  // across a recentre that reveals a class not in the initial view.
  var allClasses = [];
  (function () {
    var seen = new Set();
    (FULL_GRAPH ? FULL_GRAPH.individuals : GRAPH.nodes).forEach(function (n) {
      var cls = n.class || (n.cls || "");
      if (cls && !seen.has(cls)) { seen.add(cls); allClasses.push(cls); }
    });
    allClasses.sort();
    allClasses.forEach(colorFor);
  })();

  var enabledTypes = new Set(allClasses);
  var typeFiltersEl = document.getElementById("typefilters");
  function renderTypeFilters() {
    typeFiltersEl.innerHTML = allClasses.map(function (cls) {
      return '<label class="typechk" data-cls="' + cls + '" title="show/hide ' + cls + ' nodes">'
        + '<input type="checkbox" checked><span class="swatch" style="background:' + colorFor(cls) + '"></span>' + cls
        + '</label>';
    }).join("");
    typeFiltersEl.querySelectorAll("label.typechk").forEach(function (lbl) {
      lbl.querySelector("input").addEventListener("change", function (ev) {
        var cls = lbl.dataset.cls;
        if (ev.target.checked) enabledTypes.add(cls); else enabledTypes.delete(cls);
        applyFilters();
      });
    });
  }
  renderTypeFilters();

  // ---- legend-as-filter: LEGEND.primary names the server's auto-picked dimension
  // (class/predicate/provenance, scored by normalized Shannon entropy over
  // the INITIAL walk); the dropdown lets a user switch dimension without
  // regenerating the page. Bucket COUNTS are always recomputed live over the
  // CURRENTLY visible walk (never the stale initial-generation counts) via
  // the same legendValueFor derivation the CLI's own pickLegendDimension
  // uses — one shared source of truth, never a second hand-rolled copy. ----
  var legendEl = document.getElementById("legend");
  var legendDimEl = document.getElementById("legenddim");
  var legendChipsEl = document.getElementById("legendchips");
  var legendDim = (LEGEND && LEGEND.primary) || "class";
  var legendEnabled = null; // null = no legend filter active (every value passes)
  // collapseBuckets reuses the bundled tmctViz.collapseToTopN (same top-15 +
  // "Other" rule pickLegendDimension uses server-side) rather than a second
  // hand-rolled copy; a tiny inline fallback covers the (untested-in-practice)
  // no-engine case so the legend never hard-crashes if the bundle is absent.
  function collapseBuckets(buckets) {
    if (hasEngine) return tmctViz.collapseToTopN(buckets);
    if (buckets.length <= 20) return buckets;
    var sorted = buckets.slice().sort(function (a, b) { return b.count - a.count; });
    var kept = sorted.slice(0, 15);
    var restCount = sorted.slice(15).reduce(function (s, b) { return s + b.count; }, 0);
    return restCount ? kept.concat([{ value: "Other", count: restCount }]) : kept;
  }
  function legendValueOf(node, dim) {
    if (!hasEngine) return dim === "class" ? (node.class || "(none)") : null;
    return tmctViz.legendValueFor(FULL_GRAPH, node, dim);
  }
  function computeLegendBuckets(dim) {
    var counts = new Map();
    GRAPH.nodes.forEach(function (n) {
      var v = legendValueOf(n, dim);
      if (v == null || v === "") return;
      counts.set(v, (counts.get(v) || 0) + 1);
    });
    var buckets = Array.from(counts.entries()).map(function (e) { return { value: e[0], count: e[1] }; });
    buckets.sort(function (a, b) { return b.count - a.count; });
    return collapseBuckets(buckets);
  }
  function renderLegend() {
    if (!LEGEND) { legendEl.classList.remove("show"); return; }
    var dims = Object.keys(LEGEND.dimensions || { class: 1 });
    legendDimEl.innerHTML = dims.map(function (d) {
      var info = LEGEND.dimensions[d];
      var tag = info && info.qualifies ? "" : " (low signal)";
      return '<option value="' + d + '"' + (d === legendDim ? " selected" : "") + '>' + d + tag + '</option>';
    }).join("");
    var buckets = computeLegendBuckets(legendDim);
    if (!legendEnabled) legendEnabled = new Set(buckets.map(function (b) { return b.value; }));
    legendEl.classList.toggle("show", buckets.length > 0);
    legendChipsEl.innerHTML = buckets.map(function (b) {
      var on = legendEnabled.has(b.value);
      return '<span class="chip' + (on ? "" : " off") + '" data-v="' + esc(b.value) + '" title="click to toggle">'
        + '<span class="swatch" style="background:' + colorFor(legendDim === "class" ? b.value : "__" + legendDim) + '"></span>'
        + esc(b.value) + '<span class="n">' + b.count + '</span></span>';
    }).join("");
    legendChipsEl.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var v = chip.dataset.v;
        if (legendEnabled.has(v)) legendEnabled.delete(v); else legendEnabled.add(v);
        renderLegend();
        applyFilters();
      });
    });
  }
  legendDimEl.addEventListener("change", function () {
    legendDim = legendDimEl.value;
    legendEnabled = null; // fresh "all on" set for the newly selected dimension
    renderLegend();
    applyFilters();
  });
  renderLegend();

  // ---- hub-hide / beam-prune / search state --------------------------------
  var hubHideOn = false, hubHideVal = WALK_OPTS.hubDegree || 40;
  var beamOn = false, beamVal = 8;
  var labelMode = "smart";
  var searchTerm = "";
  var hubHideOnEl = document.getElementById("hubhideon");
  var hubHideValEl = document.getElementById("hubhideval");
  var beamOnEl = document.getElementById("beamon");
  var beamValEl = document.getElementById("beamval");
  var labelModeEl = document.getElementById("labelmode");
  var searchEl = document.getElementById("search");
  var searchCountEl = document.getElementById("searchcount");
  hubHideValEl.value = hubHideVal;
  beamValEl.value = beamVal;
  hubHideOnEl.addEventListener("change", function () { hubHideOn = hubHideOnEl.checked; applyFilters(); });
  hubHideValEl.addEventListener("change", function () { hubHideVal = Number(hubHideValEl.value) || hubHideVal; applyFilters(); });
  beamOnEl.addEventListener("change", function () { beamOn = beamOnEl.checked; applyFilters(); });
  beamValEl.addEventListener("change", function () { beamVal = Number(beamValEl.value) || beamVal; applyFilters(); });
  labelModeEl.addEventListener("change", function () { labelMode = labelModeEl.value; draw(); });
  searchEl.addEventListener("input", function () { searchTerm = searchEl.value.trim().toLowerCase(); applyFilters(); });

  // degree over the CURRENTLY displayed edge set (hub-hide/beam-prune are
  // display-time filters, distinct from the generation-time hubDegree cap
  // which only stops the WALK expanding through a hub — both useful).
  // Memoized: draw() runs on every
  // pan/zoom/hover mousemove, and both draw() and visibleNodeIds() (which
  // draw() itself calls) each need it — recomputing an O(edges) map twice per
  // frame during a drag is real, avoidable per-frame cost. Invalidated by
  // relayout() (the ONLY place GRAPH.nodes/edges are mutated, on init and on
  // every recentre()), so a stale cache can never survive a graph change.
  var degCache = null;
  function currentDegrees() {
    if (!degCache) {
      degCache = new Map();
      GRAPH.edges.forEach(function (e) {
        degCache.set(e.source, (degCache.get(e.source) || 0) + 1);
        degCache.set(e.target, (degCache.get(e.target) || 0) + 1);
      });
    }
    return degCache;
  }

  // ---- layout: concentric rings keyed on hop, seed at the centre, RE-runnable on recentre ----
  var RING_GAP = 110;
  var pos = new Map();
  var byHopMax = 0;
  function relayout() {
    degCache = null; // GRAPH.nodes/edges just changed (initial load or recentre()) — invalidate
    pos = new Map();
    var byHop = new Map();
    GRAPH.nodes.forEach(function (n) {
      if (!byHop.has(n.hop)) byHop.set(n.hop, []);
      byHop.get(n.hop).push(n);
    });
    byHop.forEach(function (list) { list.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }); });
    byHop.forEach(function (list, hop) {
      var r = hop * RING_GAP, n = list.length;
      list.forEach(function (node, i) {
        if (r === 0) { pos.set(node.id, { x: 0, y: 0 }); return; }
        var angle = (2 * Math.PI * i) / n + hop * 0.35;
        pos.set(node.id, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
      });
    });
    byHopMax = 0;
    GRAPH.nodes.forEach(function (n) { if (n.hop > byHopMax) byHopMax = n.hop; });
  }
  relayout();

  // ---- depth stepper: hides nodes with hop > depthVal (client-side visibility only,
  // no re-walk needed — spiralExpand already computed every hop up to the walk's own depth) ----
  var depthVal = byHopMax;
  function syncDepthUi() {
    document.getElementById("depthval").textContent = depthVal;
    document.getElementById("depthdown").disabled = depthVal <= 0;
    document.getElementById("depthup").disabled = depthVal >= byHopMax;
  }
  function visibleNodeIds() {
    var deg = (hubHideOn || beamOn) ? currentDegrees() : null;
    var vis = new Set();
    GRAPH.nodes.forEach(function (n) {
      if (n.hop > depthVal || !enabledTypes.has(n.class)) return;
      if (legendEnabled) {
        var v = legendValueOf(n, legendDim);
        if (v != null && v !== "" && !legendEnabled.has(v)) return;
      }
      if (hubHideOn && deg && (deg.get(n.id) || 0) > hubHideVal) return;
      vis.add(n.id);
    });
    // beam-prune: BFS-order pruning — per hop (> 0), keep only the top-N
    // (by CURRENT degree) neighbours; hop 0 (the seed(s)) is always kept.
    if (beamOn && deg) {
      var byHop = new Map();
      vis.forEach(function (id) {
        var n = GRAPH.nodes.find(function (x) { return x.id === id; });
        if (!n || n.hop === 0) return;
        if (!byHop.has(n.hop)) byHop.set(n.hop, []);
        byHop.get(n.hop).push(n);
      });
      byHop.forEach(function (list) {
        list.sort(function (a, b) { return (deg.get(b.id) || 0) - (deg.get(a.id) || 0); });
        list.slice(beamVal).forEach(function (n) { vis.delete(n.id); });
      });
    }
    if (searchTerm) {
      var hits = new Set();
      GRAPH.nodes.forEach(function (n) { if (vis.has(n.id) && String(n.label).toLowerCase().indexOf(searchTerm) !== -1) hits.add(n.id); });
      searchCountEl.textContent = hits.size ? (hits.size + " match" + (hits.size === 1 ? "" : "es")) : "no match";
      // search NARROWS visibility to matches + their direct neighbours, so the
      // hit's own context stays legible instead of collapsing to lone dots.
      var withNeighbours = new Set(hits);
      GRAPH.edges.forEach(function (e) {
        if (hits.has(e.source) && vis.has(e.target)) withNeighbours.add(e.target);
        if (hits.has(e.target) && vis.has(e.source)) withNeighbours.add(e.source);
      });
      vis = new Set(Array.from(vis).filter(function (id) { return withNeighbours.has(id); }));
    } else {
      searchCountEl.textContent = "";
    }
    return vis;
  }
  function applyFilters() { syncDepthUi(); draw(); }
  document.getElementById("depthdown").addEventListener("click", function () { if (depthVal > 0) { depthVal--; applyFilters(); } });
  document.getElementById("depthup").addEventListener("click", function () { if (depthVal < byHopMax) { depthVal++; applyFilters(); } });

  // ---- depth encoding: paint-order-by-hop + lightness/opacity falloff -----
  function styleForHop(hop, cls) {
    var t = byHopMax > 0 ? hop / byHopMax : 0;
    var alpha = 1 - t * 0.55;
    var radius = Math.max(4, 9 - t * 5);
    return { fill: colorFor(cls), alpha: alpha, radius: radius };
  }

  // ---- canvas + view transform (pan/zoom) ----------------------------------
  var canvas = document.getElementById("c");
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  var view = { scale: 1, x: 0, y: 0 };
  var selectedId = null;
  // The full set of node ids a query answer actually resolved to (not just
  // the single "primary" selectedId) — draw() rings every one of them so a
  // multi-fact answer shows ALL the nodes it came from, not just one.
  var highlightIds = new Set();

  function resize() {
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    draw();
  }
  window.addEventListener("resize", resize);

  function worldToScreen(p) {
    var cx = canvas.width / 2 + view.x * dpr, cy = canvas.height / 2 + view.y * dpr;
    return { x: cx + p.x * view.scale * dpr, y: cy + p.y * view.scale * dpr };
  }
  function screenToWorld(sx, sy) {
    var cx = canvas.width / 2 + view.x * dpr, cy = canvas.height / 2 + view.y * dpr;
    return { x: (sx * dpr - cx) / (view.scale * dpr), y: (sy * dpr - cy) / (view.scale * dpr) };
  }

  // Label-density modes: "smart" (the default) draws a label only for the
  // focus/selection/direct-neighbours/top-20-by-degree; everything else
  // labels on hover only. "all"/"name-source" always draw (name-source
  // appends the Fact's own provenance prefix — trust tier is a first-class
  // concept here). "none" draws no labels at all.
  var hoverId = null;
  canvas.addEventListener("mousemove", function (ev) {
    if (labelMode !== "smart" || dragging) return;
    var rect = canvas.getBoundingClientRect();
    var w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    var best = null, bestDist = Infinity;
    GRAPH.nodes.forEach(function (n) {
      var p = pos.get(n.id);
      if (!p) return;
      var dx = p.x - w.x, dy = p.y - w.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { best = n.id; bestDist = d; }
    });
    var next = bestDist < 24 / view.scale ? best : null;
    if (next !== hoverId) { hoverId = next; draw(); }
  });
  function topDegreeIds(vis, deg, n) {
    var ranked = Array.from(vis).sort(function (a, b) { return (deg.get(b) || 0) - (deg.get(a) || 0); });
    return new Set(ranked.slice(0, n));
  }
  function labelFor(n) {
    var text = String(n.label).slice(0, 40);
    if (labelMode !== "name-source") return text;
    var prov = hasEngine ? tmctViz.legendValueFor(FULL_GRAPH, n, "provenance") : null;
    return prov ? text + "  [" + prov + "]" : text;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(1, 1 * dpr);
    var vis = visibleNodeIds();
    var deg = currentDegrees();
    var smartLabelIds = labelMode === "smart" ? topDegreeIds(vis, deg, 20) : null;
    var searchHits = searchTerm
      ? new Set(GRAPH.nodes.filter(function (n) { return vis.has(n.id) && String(n.label).toLowerCase().indexOf(searchTerm) !== -1; }).map(function (n) { return n.id; }))
      : null;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    GRAPH.edges.forEach(function (e) {
      if (!vis.has(e.source) || !vis.has(e.target)) return;
      var a = pos.get(e.source), b = pos.get(e.target);
      if (!a || !b) return;
      var sa = worldToScreen(a), sb = worldToScreen(b);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    });
    var order = GRAPH.nodes.filter(function (n) { return vis.has(n.id); }).sort(function (a, b) { return a.hop - b.hop; });
    order.forEach(function (n) {
      var p = pos.get(n.id);
      if (!p) return;
      var sp = worldToScreen(p);
      var st = styleForHop(n.hop, n.class);
      var r = st.radius * view.scale * dpr;
      ctx.globalAlpha = st.alpha;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(1.5, r), 0, Math.PI * 2);
      ctx.fillStyle = st.fill; ctx.fill();
      ctx.globalAlpha = 1;
      if (n.id === selectedId) {
        ctx.lineWidth = Math.max(1.5, 2 * dpr); ctx.strokeStyle = "#fff"; ctx.stroke();
      }
      if (n.id === GRAPH.focus) {
        ctx.lineWidth = Math.max(1.5, 2.5 * dpr); ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(1.5, r) + 3 * dpr, 0, Math.PI * 2); ctx.stroke();
      }
      if (searchHits && searchHits.has(n.id)) {
        ctx.lineWidth = Math.max(1.5, 2 * dpr); ctx.strokeStyle = "#e0af68";
        ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(1.5, r) + 5 * dpr, 0, Math.PI * 2); ctx.stroke();
      }
      // Every node the last "ask the graph" answer actually resolved to
      // (frameQueryResult below) — a distinct green ring so a multi-fact
      // answer's whole result set reads as one highlighted group, not just
      // the single primary node selectedId/focus already mark.
      if (highlightIds.has(n.id) && n.id !== selectedId) {
        ctx.lineWidth = Math.max(1.5, 2 * dpr); ctx.strokeStyle = "#9ece6a";
        ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(1.5, r) + 4 * dpr, 0, Math.PI * 2); ctx.stroke();
      }
      var showLabel = view.scale > 0.55 && labelMode !== "none" && (
        labelMode !== "smart"
        || n.id === selectedId || n.id === GRAPH.focus || n.id === hoverId
        || (smartLabelIds && smartLabelIds.has(n.id))
      );
      if (showLabel) {
        ctx.font = (11 * dpr) + "px -apple-system, sans-serif";
        ctx.fillStyle = "rgba(231,233,238," + Math.min(1, 0.55 + view.scale * 0.3) + ")";
        ctx.textBaseline = "middle";
        ctx.fillText(labelFor(n), sp.x + Math.max(6, r + 4), sp.y);
      }
    });
  }

  // ---- pan (drag) -----------------------------------------------------------
  var dragging = false, dragMoved = false, dragStart = null, viewStart = null;
  canvas.addEventListener("mousedown", function (ev) {
    dragging = true; dragMoved = false;
    dragStart = { x: ev.clientX, y: ev.clientY }; viewStart = { x: view.x, y: view.y };
    canvas.classList.add("grabbing");
  });
  window.addEventListener("mousemove", function (ev) {
    if (!dragging) return;
    var dx = ev.clientX - dragStart.x, dy = ev.clientY - dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
    view.x = viewStart.x + dx; view.y = viewStart.y + dy;
    draw();
  });
  window.addEventListener("mouseup", function () { dragging = false; canvas.classList.remove("grabbing"); });

  // ---- zoom (wheel), anchored at the pointer --------------------------------
  canvas.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    var before = screenToWorld(mx, my);
    var factor = Math.exp(-ev.deltaY * 0.001);
    view.scale = Math.min(8, Math.max(0.08, view.scale * factor));
    var after = screenToWorld(mx, my);
    view.x += (after.x - before.x) * view.scale; view.y += (after.y - before.y) * view.scale;
    draw();
  }, { passive: false });

  // Shared bounding-box fit — pan/zoom so every position in "points" is framed
  // with padding. fitToVisible/fitToIds are both thin wrappers naming WHICH
  // positions to fit; the math itself lives here once.
  function fitToPositions(points) {
    if (!points.length) return;
    var minX = Math.min.apply(null, points.map(function (p) { return p.x; })), maxX = Math.max.apply(null, points.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, points.map(function (p) { return p.y; })), maxY = Math.max.apply(null, points.map(function (p) { return p.y; }));
    var w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    view.scale = Math.min(4, Math.max(0.1, Math.min(canvas.width / dpr / (w + 160), canvas.height / dpr / (h + 160))));
    view.x = -(minX + maxX) / 2 * view.scale; view.y = -(minY + maxY) / 2 * view.scale;
  }
  function fitToVisible() {
    fitToPositions(Array.from(visibleNodeIds()).map(function (id) { return pos.get(id); }).filter(Boolean));
  }
  // Fit specifically to a query answer's own result set (not just "whatever
  // recentre's re-walk happened to make visible") — a multi-fact answer's
  // nodes can be spread wider than the default depth/nodeLimit view, so this
  // is the precision framing step frameQueryResult calls after recentre.
  function fitToIds(ids) {
    fitToPositions(ids.map(function (id) { return pos.get(id); }).filter(Boolean));
  }
  document.getElementById("resetview").addEventListener("click", function () { fitToVisible(); draw(); });

  // ---- recentre: RE-WALK the FULL graph (via TERM_GRAPH — the augmented
  // view, so a recentre reaches real concept-relation edges the same way
  // generation-time computeVizGraph does) from a new seed via the real,
  // bundled spiralExpand (byte-identical to the CLI's own walk — never a
  // hand-rolled client-side BFS) and rebuild via the real buildVizNodesAndEdges.
  // Used for double-click-to-recentre, focus-follows-chat-answer, AND the
  // edge-kind toggle (re-walks the SAME seed under a new kind set). Reuses
  // WALK_OPTS (this page's own generation-time depth/nodeLimit/hubDegree) so a
  // client-side re-walk never silently falls back to spiralExpand's smaller
  // code-graph defaults. -------------------------------------------------
  function walkGraph() { return TERM_GRAPH ? TERM_GRAPH.graph : FULL_GRAPH; }
  function recentre(id) {
    if (!hasEngine || !FULL_GRAPH || !walkGraph().byId.has(id)) return false;
    var walked = tmctViz.spiralExpand(walkGraph(), [], {
      kinds: kindsForMode(edgeKindMode),
      classPredicate: function () { return true; }, idNormalizer: function (i) { return i; }, seeds: [id],
      depth: WALK_OPTS.depth, nodeLimit: WALK_OPTS.nodeLimit, hubDegree: WALK_OPTS.hubDegree,
    });
    var built = tmctViz.buildVizNodesAndEdges(walkGraph(), walked);
    GRAPH.nodes = built.nodes; GRAPH.edges = built.edges; GRAPH.focus = id;
    // classes newly reached that weren't in the initial palette still resolve
    // via colorFor()'s own on-demand assignment; the checkbox row itself was
    // already seeded from the FULL graph's classes above, so no rebuild needed.
    relayout();
    depthVal = byHopMax;
    legendEnabled = null; // re-derive "all on" for the new node set's own buckets
    renderLegend();
    fitToVisible();
    return true;
  }

  // Focus the graph on a QUERY ANSWER's own result set — every node it
  // actually resolved to, not just one. Re-walks from the first valid id
  // (recentre's existing mechanism, which already reaches most/all closely
  // related result nodes), then fitToIds() precisely frames the full
  // requested set — any id recentre's walk didn't reach simply has no
  // position and drops out of the fit, an honest degrade, never a guess.
  // Sets highlightIds so draw() rings every result node, not just the
  // primary one selectedId/GRAPH.focus already mark.
  function frameQueryResult(ids) {
    var real = (ids || []).filter(function (id) { return walkGraph().byId.has(id); });
    if (!real.length) return false;
    if (!recentre(real[0])) return false;
    fitToIds(real);
    highlightIds = new Set(real);
    selectedId = real[0];
    return true;
  }
  document.getElementById("edgekind").addEventListener("change", function (ev) {
    edgeKindMode = ev.target.value;
    var seed = GRAPH.focus;
    if (seed) recentre(seed);
    draw();
  });

  // ---- click-to-inspect ------------------------------------------------------
  var panel = document.getElementById("panel");
  function fmtTs(v) { return v ? String(v) : "(none)"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showPanel(n) {
    selectedId = n.id;
    panel.innerHTML =
      "<h2>" + esc(n.label) + "</h2>" +
      "<dl>" +
      "<dt>id</dt><dd>" + esc(n.id) + "</dd>" +
      "<dt>class</dt><dd>" + (n.class
        ? '<button class="lnk" id="classLink" title="isolate this class in the view, and ask the graph where the term appears">' + esc(n.class) + "</button>"
        : "(none)") + "</dd>" +
      "<dt>hop</dt><dd>" + n.hop + "</dd>" +
      "<dt>created</dt><dd>" + esc(fmtTs(n.createdAt)) + "</dd>" +
      "<dt>updated</dt><dd>" + esc(fmtTs(n.updatedAt)) + "</dd>" +
      "</dl>" +
      '<div class="row">' +
      '<button class="act" id="labelLink" title="ask the graph where this specific label is mentioned">search this</button>' +
      '<button class="act" id="panelClose">close</button>' +
      "</div>";
    panel.classList.add("show");
    document.getElementById("panelClose").addEventListener("click", function () {
      panel.classList.remove("show"); selectedId = null; draw();
    });
    // Class badge: a click-to-query affordance — isolate this class in the
    // type-filter row (a REAL "show all of that kind currently in view"
    // action; ask.mjs has no generic "list all X of class Y" shape for
    // memory-graph classes — that richer machinery lives in chat.mjs's
    // factAnswer cascade, out of this bundle's ask.mjs-only scope) AND fire a
    // real "where is X mentioned" query on the class name — an honest
    // attempt, may miss, never faked.
    var classLink = document.getElementById("classLink");
    if (classLink) classLink.addEventListener("click", function () {
      typeFiltersEl.querySelectorAll("label.typechk").forEach(function (lbl) {
        var on = lbl.dataset.cls === n.class;
        lbl.querySelector("input").checked = on;
        if (on) enabledTypes.add(lbl.dataset.cls); else enabledTypes.delete(lbl.dataset.cls);
      });
      applyFilters();
      askAndPopulate('where is "' + n.class + '" mentioned');
    });
    document.getElementById("labelLink").addEventListener("click", function () {
      askAndPopulate('where is "' + n.label + '" mentioned');
    });
    draw();
  }

  canvas.addEventListener("click", function (ev) {
    if (dragMoved) return;
    var rect = canvas.getBoundingClientRect();
    var w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    var vis = visibleNodeIds();
    var best = null, bestDist = Infinity;
    GRAPH.nodes.forEach(function (n) {
      if (!vis.has(n.id)) return;
      var p = pos.get(n.id);
      if (!p) return;
      var dx = p.x - w.x, dy = p.y - w.y, d = Math.sqrt(dx * dx + dy * dy);
      var st = styleForHop(n.hop, n.class);
      var hitR = Math.max(st.radius, 10) / view.scale;
      if (d <= hitR && d < bestDist) { best = n; bestDist = d; }
    });
    if (best) showPanel(best);
  });
  canvas.addEventListener("dblclick", function (ev) {
    var rect = canvas.getBoundingClientRect();
    var w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    var vis = visibleNodeIds();
    var best = null, bestDist = Infinity;
    GRAPH.nodes.forEach(function (n) {
      if (!vis.has(n.id)) return;
      var p = pos.get(n.id);
      if (!p) return;
      var dx = p.x - w.x, dy = p.y - w.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { best = n; bestDist = d; }
    });
    if (best && recentre(best.id)) { selectedId = best.id; showPanel(GRAPH.nodes.filter(function (n) { return n.id === best.id; })[0]); }
  });

  // ---- Ask the graph: TWO real engines over the FULL graph, never just the
  // currently-displayed subgraph — tried in order per query:
  //  1. tmctMemoryAsk.factAnswer (src/chat.mjs's REAL memory-graph answer
  //     engine, the same one 'npm run chat' uses) — a Fact/definition-shaped
  //     question ("what is a dog", "what is a horse used for") answers HERE,
  //     which the code-graph engine below cannot. Given an in-memory
  //     Backend-B handle carrying the page's own embedded PAYLOAD — ZERO fs
  //     I/O (see memory-ask-browser-entry.mjs's own doc comment) — and
  //     envelope:null/miss:true, the exact documented "no parse pipeline
  //     available" bootstrap path that arms factAnswer's own bare-question
  //     regex fallbacks.
  //  2. tmctViz.ask (tmct's code-graph query engine) — generic "where is X
  //     mentioned" navigation and code-graph queries. Only reached when (1)
  //     is unavailable or didn't hit.
  // A resolved answer's own target re-centres the view — focus follows the
  // answer — for EITHER engine. --------------------------------------------
  var askInput = document.getElementById("askq");
  var askBtn = document.getElementById("asksubmit");
  var askOut = document.getElementById("askresult");
  var memHandle = hasMemEngine ? tmctMemoryAsk.createInMemoryStore() : null;
  if (memHandle) memHandle.payload = PAYLOAD;

  // Placeholder is a real term from THIS graph, picked once per page load, so
  // the hint stays honest ("what is X" where X actually resolves here) instead
  // of a static example that may not exist in a given repo's graph. Native
  // <input placeholder> behaviour (disappears on focus/typing, reappears when
  // blank) is untouched — this only changes what text it starts with.
  if (hasEngine && FULL_GRAPH) {
    var termLabels = [];
    walkGraph().byId.forEach(function (ind, id) {
      if (id.indexOf("term:") === 0 && ind.label) termLabels.push(ind.label);
    });
    if (termLabels.length) {
      askInput.placeholder = 'what is ' + termLabels[Math.floor(Math.random() * termLabels.length)];
    }
  }

  // Best-effort focus-follow for a memory-engine hit: factAnswer returns
  // rendered TEXT, not a list of resolved entity ids (unlike ask.mjs's
  // envelope/matches). Two passes, both real-graph-checked, never a guessed
  // id that doesn't exist:
  //  1. every term node whose label appears in the ANSWER text — this is
  //     "the nodes that come back," e.g. "dog is a kind of animal" surfaces
  //     BOTH term:dog and term:animal, not just the one the question asked
  //     about, so a multi-fact answer highlights its whole result set.
  //  2. if that finds nothing (e.g. a phrasing that doesn't echo a bare term
  //     label), fall back to stripping the QUESTION's own crust and trying
  //     the remainder as a single term id — the previous behaviour, kept as
  //     a fallback rather than replaced.
  function findAnsweredTermIds(query, answerText) {
    if (!hasEngine || !hasMemEngine) return [];
    var hay = " " + String(answerText).toLowerCase() + " ";
    var found = [];
    walkGraph().byId.forEach(function (ind, id) {
      if (id.indexOf("term:") !== 0) return;
      var label = String(ind.label || "").toLowerCase();
      if (label.length < 3) return; // skip too-short/noisy labels (dedupe/precision, not a real cap)
      if (hay.indexOf(" " + label) !== -1 || hay.indexOf(label + " ") !== -1) found.push(id);
    });
    if (found.length) return found;
    var stripped = String(query).toLowerCase()
      .replace(/^(what|where|who|which|does|do|is|are)\b/, "")
      .replace(/\b(is|are|used for|do|does|mean|means|a|an|the)\b/g, " ")
      .replace(/[?.!]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!stripped) return [];
    var id = "term:" + tmctMemoryAsk.normFactTerm(stripped);
    return walkGraph().byId.has(id) ? [id] : [];
  }

  function runAsk(query) {
    askOut.classList.remove("miss");
    (async function () {
      if (memHandle) {
        var fact = null;
        try { fact = await tmctMemoryAsk.factAnswer(memHandle, query, null, true, {}); } catch { fact = null; }
        if (fact && fact.text) {
          askOut.innerHTML = '<div class="q">&quot;' + esc(query) + '&quot;</div>' + esc(fact.text)
            + '<div class="src">answered from the full embedded memory graph (not just what\\'s currently drawn)</div>';
          frameQueryResult(findAnsweredTermIds(query, fact.text));
          draw();
          return;
        }
      }
      if (!hasEngine) {
        askOut.classList.add("miss");
        askOut.innerHTML = '<div class="q">&quot;' + esc(query) + '&quot;</div>no answer engine available.';
        return;
      }
      var t = tmctViz.ask(FULL_GRAPH, query, { contextId: selectedId });
      var envelope = t.tmct_ask || {};
      askOut.classList.toggle("miss", !!envelope.miss);
      var canon = envelope.canonical
        ? '<div class="canon">read as: ' + esc(envelope.canonical.english) + "</div>"
        : "";
      askOut.innerHTML = '<div class="q">&quot;' + esc(query) + '&quot;</div>' + esc(t.content) + canon;
      // Focus-follows-answer: frame EVERY real match this answer resolved to
      // (envelope.matches is already the full candidate list ask.mjs itself
      // ranked), never a guess beyond what the engine itself actually returned.
      var targetIds = (envelope.matches || []).map(function (m) { return m.id; }).filter(Boolean);
      frameQueryResult(targetIds);
      draw();
    })();
  }
  function askAndPopulate(query) {
    askInput.value = query;
    runAsk(query);
  }
  if (hasEngine || hasMemEngine) {
    askBtn.addEventListener("click", function () { var q = askInput.value.trim(); if (q) runAsk(q); });
    askInput.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { var q = askInput.value.trim(); if (q) runAsk(q); } });
  }

  syncDepthUi();
  resize();
  draw();
})();
</script>
</body>
</html>
`;
}
