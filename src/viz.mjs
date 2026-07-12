// viz.mjs — `tmct viz`: a real, navigable, self-contained HTML graph view over
// the memory graph (PLAN_BREADTH_FIRST_NLU.md §5, design per PLAN_VIZ.md), now
// with a real "Ask the graph" chat panel running tmct's OWN engine client-side
// (§5 follow-on, operator directive 2026-07-11 — precedent: seonix's own
// site/viz.mjs + scripts/build-ask-bundle.mjs, adapted here to bundle tmct's
// ask.mjs directly rather than an external package import).
//
// Three pure/impure-separated pieces, mirroring src/syllogise.mjs's shape:
//   - computeVizGraph(repoDir, {focus}) — I/O (loadMemory) + graph traversal,
//     reusing spiralExpand/mostRecentIndividual/MEMORY_SPIRAL_EXPAND_KINDS/
//     buildVizNodesAndEdges exactly as PLAN_VIZ.md's own traversal work
//     already generalized them for this. No new traversal logic here.
//   - renderVizHtml({nodes, edges, focus, payload, askBundle}) — a pure
//     string-builder: one complete <!doctype html> document, graph data
//     JSON-embedded inline, the real ask-engine bundle inlined verbatim, no
//     external <script src>, no CDN, no fonts — opens and works offline.
//   - readAskBundle() — the one bit of I/O renderVizHtml itself doesn't do:
//     reads the checked-in build artifact (scripts/build-ask-bundle.mjs's
//     output). bin/tmct.mjs's `viz` mode wires all three together.

import { loadMemory, CREATED_AT_PROP } from "./memory/core.mjs";
import { parseEntities, spiralExpand, mostRecentIndividual, MEMORY_SPIRAL_EXPAND_KINDS, buildVizNodesAndEdges } from "./codegraph.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Load the memory graph under `repoDir`, walk it from a seed (an explicit
 *  `--focus <id>` override, or the most-recently-created individual by
 *  default) via spiralExpand over the real memory-graph edge-kind inventory,
 *  and enrich each walked node with the real label/class/timestamp data a
 *  renderer needs. Returns `{nodes, edges, focus, payload}` — `focus` is the
 *  seed id actually used (null when the graph is empty and no seed could be
 *  picked); `payload` is the FULL raw graph (every individual, not just the
 *  walked subset) — the embedded "Ask the graph" panel queries the whole
 *  graph and can re-walk from a new focus, never just the initially rendered
 *  subgraph, mirroring seonix's own "never the depth-limited display
 *  sub-graph" precedent. Never throws on a missing/empty memory dir:
 *  loadMemory's own ENOENT fallback (emptyMemory()) already degrades to zero
 *  individuals, which this function turns into
 *  `{nodes: [], edges: [], focus: null, payload}`. */
export async function computeVizGraph(repoDir, { focus, depth, nodeLimit } = {}) {
  const payload = await loadMemory(repoDir);
  const graph = parseEntities(payload);
  if (!graph.individuals.length) return { nodes: [], edges: [], focus: null, payload };

  const seedId = focus || mostRecentIndividual(graph, CREATED_AT_PROP)?.id || null;
  if (!seedId) return { nodes: [], edges: [], focus: null, payload };

  const walked = spiralExpand(graph, [], {
    kinds: MEMORY_SPIRAL_EXPAND_KINDS,
    classPredicate: () => true,
    idNormalizer: (id) => id,
    seeds: [seedId],
    // depth = max arcs (hops) from the focus node; nodeLimit = spiral length
    // (total nodes walked) — both optional, spiralExpand's own defaults (3
    // hops, 12 nodes) apply when omitted, byte-identical to before this was
    // exposed as a CLI knob (`tmct viz --depth --limit`, bin/tmct.mjs).
    ...(depth != null ? { depth } : {}),
    ...(nodeLimit != null ? { nodeLimit } : {}),
  });

  const { nodes, edges } = buildVizNodesAndEdges(graph, walked);
  return { nodes, edges, focus: seedId, payload };
}

/** Read the checked-in browser ask-engine bundle (scripts/build-ask-bundle.mjs's
 *  output, `src/ask-browser.bundle.js`) — the one I/O `renderVizHtml` itself
 *  stays free of, keeping it a pure string-builder. Returns `""` (never
 *  throws) if the bundle hasn't been built yet — `renderVizHtml` renders a
 *  graph-only page with an honest "chat unavailable" note in that case,
 *  rather than a broken page. */
export async function readAskBundle() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return await readFile(join(here, "ask-browser.bundle.js"), "utf8");
  } catch {
    return "";
  }
}

/** Escape untrusted text for safe placement inside HTML content/attributes. */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** JSON-embed graph data into a `<script>` tag safely — escape `</` so a
 *  label/id containing "</script>" can't break out of the tag, and escape
 *  U+2028/U+2029 (valid in JSON strings, invalid unescaped in JS source). */
function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Render one complete, self-contained `<!doctype html>` document for
 *  `{nodes, edges, focus, payload, askBundle}` (computeVizGraph's return
 *  shape, plus the ask-engine bundle text from readAskBundle()): the graph
 *  data JSON-embedded inline, the real ask.mjs engine inlined verbatim
 *  (`askBundle`, adapter-less — no wink model, ~220KB, still answers via the
 *  curated + bounded-fuzzy tiers, exactly test/ask-nlp.test.mjs's own proven
 *  "viewer bundle without wink" boundary), inline <style>, inline vanilla-JS
 *  implementing a concentric ring layout keyed on hop (PLAN_VIZ.md §4 —
 *  seed/newest at the centre, each ring one hop further out), paint-order-by-
 *  hop with a lightness/opacity falloff for the depth read, pan (drag) + zoom
 *  (wheel), click-a-node for details, a depth stepper + per-class visibility
 *  filters (operator directive, seonix precedent), and a real "Ask the graph"
 *  chat panel — a query resolves via the SAME ask() the CLI ships, re-walks
 *  the graph from the resolved entity (focus-follows-answer), and a node's
 *  class/label in the detail panel are click-to-query affordances. Pure
 *  string building — no fs/network, no external <script src>, no CDN, no
 *  fonts. */
export function renderVizHtml({ nodes, edges, focus, payload, askBundle }) {
  const graphJson = embedJson({ nodes, edges, focus });
  const payloadJson = embedJson(payload || { individuals: [], objectProperties: [] });
  const title = `tmct viz — ${nodes.length} node${nodes.length === 1 ? "" : "s"}${focus ? ` (seed: ${escapeHtml(focus)})` : ""}`;
  const hasChat = Boolean(askBundle);

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
  #hud { position: absolute; top: 12px; left: 12px; max-width: 42ch; background: rgba(20,22,30,0.82); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; line-height: 1.45; pointer-events: none; }
  #hud b { color: #fff; }
  #hud .muted { color: #9aa1b0; }
  #controls { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: center; background: rgba(20,22,30,0.88); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 7px 12px; font-size: 12.5px; flex-wrap: wrap; max-width: min(70vw, 640px); }
  #controls .grp { display: flex; align-items: center; gap: 5px; }
  #controls button { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #e7e9ee; border-radius: 5px; width: 22px; height: 22px; line-height: 1; cursor: pointer; font-size: 13px; }
  #controls button:hover:not(:disabled) { background: rgba(255,255,255,0.18); }
  #controls button:disabled { opacity: 0.35; cursor: default; }
  #controls .depthval { min-width: 1.4em; text-align: center; display: inline-block; }
  #controls label.typechk { display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
  #controls label.typechk:hover { background: rgba(255,255,255,0.08); }
  #controls .swatch { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  #panel { position: absolute; top: 12px; right: 12px; width: 280px; max-width: calc(100vw - 24px); background: rgba(20,22,30,0.92); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 12px 14px; font-size: 13px; line-height: 1.5; display: none; }
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
  #ask { position: absolute; bottom: 12px; right: 12px; width: 340px; max-width: calc(100vw - 24px); background: rgba(20,22,30,0.92); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; }
  #ask h3 { margin: 0 0 6px; font-size: 12.5px; color: #9aa1b0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  #ask .row { display: flex; gap: 6px; }
  #askq { flex: 1; min-width: 0; background: #14161e; color: #e7e9ee; border: 1px solid #2a2e42; border-radius: 5px; padding: 6px 9px; font: inherit; font-size: 12.5px; }
  #askq:focus { outline: none; border-color: #7aa2f7; }
  #askq:disabled { opacity: 0.6; }
  #asksubmit { background: rgba(122,162,247,0.18); border: 1px solid #7aa2f7; color: #cfe0ff; border-radius: 5px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; }
  #asksubmit:hover { background: rgba(122,162,247,0.3); }
  #askresult { margin-top: 8px; max-height: 32vh; overflow: auto; line-height: 1.55; color: #c0caf5; white-space: pre-wrap; }
  #askresult .q { color: #565f89; font-style: normal; margin-bottom: 3px; }
  #askresult.miss { color: #a9b1d6; font-style: italic; }
  #askresult .canon { margin-top: 6px; color: #6b7189; font-size: 11px; font-style: normal; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 5px; }
  #ask .hint { color: #6b7189; font-size: 11px; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="c"></canvas>
  <div id="hud"><b>tmct viz</b><br><span class="muted">drag to pan &middot; scroll to zoom &middot; click a node for details &middot; double-click to re-centre</span></div>
  <div id="controls">
    <span class="grp"><span class="muted">depth</span><button id="depthdown" title="shallower">&minus;</button><b class="depthval" id="depthval"></b><button id="depthup" title="deeper">+</button></span>
    <span class="grp" id="typefilters"></span>
  </div>
  <div id="panel"></div>
  <div id="empty"><div><b>No graph data.</b><br>This repo has no <code>.tmct/memory/graph.json</code> yet (or the requested <code>--focus</code> id wasn't found). Run <code>tmct chat</code> in that repo first, then re-run <code>tmct viz</code>.</div></div>
  <div id="ask">
    <h3>Ask the graph</h3>
    <div class="row"><input id="askq" type="text" autocomplete="off" placeholder='ask e.g. "where is X mentioned"'${hasChat ? "" : " disabled"}><button id="asksubmit"${hasChat ? "" : " disabled"}>ask</button></div>
    <div id="askresult">${hasChat
      ? '<span class="hint">running the real tmct engine, client-side, right here &mdash; try &quot;where is &lt;label&gt; mentioned&quot;. Answers re-centre the graph on what they resolve.</span>'
      : '<span class="hint">chat unavailable &mdash; run <code>npm run build:ask-bundle</code> and re-generate this page.</span>'}</div>
  </div>
</div>
<script>
const GRAPH = ${graphJson};
const PAYLOAD = ${payloadJson};
</script>
${hasChat ? `<script>\n${askBundle}\n</script>` : ""}
<script>
(function () {
  "use strict";

  var emptyEl = document.getElementById("empty");
  if (!GRAPH.nodes.length) { emptyEl.classList.add("show"); return; }

  var hasEngine = typeof tmctViz !== "undefined";
  var FULL_GRAPH = hasEngine ? tmctViz.parseEntities(PAYLOAD) : null;

  // ---- palette: one hue per class, stable across recentres --------------
  var PALETTE = ["#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#f7768e", "#73daca"];
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

  // ---- layout: concentric rings keyed on hop, seed at the centre, RE-runnable on recentre ----
  var RING_GAP = 110;
  var pos = new Map();
  var byHopMax = 0;
  function relayout() {
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
    var vis = new Set();
    GRAPH.nodes.forEach(function (n) {
      if (n.hop <= depthVal && enabledTypes.has(n.class)) vis.add(n.id);
    });
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

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(1, 1 * dpr);
    var vis = visibleNodeIds();
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
      if (view.scale > 0.55) {
        ctx.font = (11 * dpr) + "px -apple-system, sans-serif";
        ctx.fillStyle = "rgba(231,233,238," + Math.min(1, 0.55 + view.scale * 0.3) + ")";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.label).slice(0, 40), sp.x + Math.max(6, r + 4), sp.y);
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

  function fitToVisible() {
    var vis = Array.from(visibleNodeIds()).map(function (id) { return pos.get(id); }).filter(Boolean);
    if (!vis.length) return;
    var minX = Math.min.apply(null, vis.map(function (p) { return p.x; })), maxX = Math.max.apply(null, vis.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, vis.map(function (p) { return p.y; })), maxY = Math.max.apply(null, vis.map(function (p) { return p.y; }));
    var w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    view.scale = Math.min(4, Math.max(0.1, Math.min(canvas.width / dpr / (w + 160), canvas.height / dpr / (h + 160))));
    view.x = -(minX + maxX) / 2 * view.scale; view.y = -(minY + maxY) / 2 * view.scale;
  }

  // ---- recentre: RE-WALK the FULL graph from a new seed via the real,
  // bundled spiralExpand (byte-identical to the CLI's own walk — never a
  // hand-rolled client-side BFS) and rebuild via the real buildVizNodesAndEdges.
  // Used for double-click-to-recentre AND focus-follows-chat-answer. -------
  function recentre(id) {
    if (!hasEngine || !FULL_GRAPH || !FULL_GRAPH.byId.has(id)) return false;
    var walked = tmctViz.spiralExpand(FULL_GRAPH, [], {
      classPredicate: function () { return true; }, idNormalizer: function (i) { return i; }, seeds: [id],
    });
    var built = tmctViz.buildVizNodesAndEdges(FULL_GRAPH, walked);
    GRAPH.nodes = built.nodes; GRAPH.edges = built.edges; GRAPH.focus = id;
    // classes newly reached that weren't in the initial palette still resolve
    // via colorFor()'s own on-demand assignment; the checkbox row itself was
    // already seeded from the FULL graph's classes above, so no rebuild needed.
    relayout();
    depthVal = byHopMax;
    fitToVisible();
    return true;
  }

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
    // Class badge: a click-to-query affordance (operator directive) — isolate
    // this class in the type-filter row (a REAL "show all of that kind
    // currently in view" action; ask.mjs has no generic "list all X of class
    // Y" shape for memory-graph classes — that richer machinery lives in
    // chat.mjs's factAnswer cascade, out of this bundle's ask.mjs-only scope,
    // see PLAN_BREADTH_FIRST_NLU.md §5's own build notes) AND fire a real
    // "where is X mentioned" query on the class name — an honest attempt,
    // may miss, never faked.
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

  // ---- Ask the graph: a real ask()-powered chat panel over the FULL graph,
  // never just the currently-displayed subgraph. A resolved answer's own
  // objMatch/matches re-centre the view — focus follows the answer. ---------
  var askInput = document.getElementById("askq");
  var askBtn = document.getElementById("asksubmit");
  var askOut = document.getElementById("askresult");

  function runAsk(query) {
    if (!hasEngine) return;
    askOut.classList.remove("miss");
    var t = tmctViz.ask(FULL_GRAPH, query, { contextId: selectedId });
    var envelope = t.tmct_ask || {};
    askOut.classList.toggle("miss", !!envelope.miss);
    var canon = envelope.canonical
      ? '<div class="canon">read as: ' + esc(envelope.canonical.english) + "</div>"
      : "";
    askOut.innerHTML = '<div class="q">&quot;' + esc(query) + '&quot;</div>' + esc(t.content) + canon;
    // Focus-follows-answer: prefer the resolved objMatch (the term the
    // question was actually ABOUT), else the first real match — either way,
    // only if it's a genuine individual in the graph, never a guess.
    var targetId = (envelope.parsed && envelope.parsed.object && (envelope.matches || [])[0] && envelope.matches[0].id)
      || (envelope.matches && envelope.matches[0] && envelope.matches[0].id)
      || null;
    if (targetId && recentre(targetId)) { selectedId = targetId; }
    draw();
  }
  function askAndPopulate(query) {
    askInput.value = query;
    runAsk(query);
  }
  if (hasEngine) {
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
