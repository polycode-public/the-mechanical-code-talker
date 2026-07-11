// viz.mjs — `tmct viz`: a real, navigable, self-contained HTML graph view over
// the memory graph (PLAN_BREADTH_FIRST_NLU.md §5, design per PLAN_VIZ.md).
// Two pure halves, mirroring src/syllogise.mjs's shape:
//   - computeVizGraph(repoDir, {focus}) — I/O (loadMemory) + graph traversal,
//     reusing spiralExpand/mostRecentIndividual/MEMORY_SPIRAL_EXPAND_KINDS/
//     derivedUpdatedAt exactly as PLAN_VIZ.md's own traversal work already
//     generalized them for this. No new traversal logic here.
//   - renderVizHtml({nodes, edges, focus}) — a pure string-builder: one
//     complete <!doctype html> document, graph data JSON-embedded inline, no
//     external <script src>, no CDN, no fonts — opens and works offline.
//
// bin/tmct.mjs's `viz` mode wires these two together and writes the result.

import { loadMemory, CREATED_AT_PROP, UPDATED_AT_PROP } from "./memory/core.mjs";
import { parseEntities, spiralExpand, mostRecentIndividual, MEMORY_SPIRAL_EXPAND_KINDS, derivedUpdatedAt } from "./codegraph.mjs";

/** Load the memory graph under `repoDir`, walk it from a seed (an explicit
 *  `--focus <id>` override, or the most-recently-created individual by
 *  default) via spiralExpand over the real memory-graph edge-kind inventory,
 *  and enrich each walked node with the real label/class/timestamp data a
 *  renderer needs. Returns `{nodes, edges, focus}` — `focus` is the seed id
 *  actually used (null when the graph is empty and no seed could be picked).
 *  Never throws on a missing/empty memory dir: loadMemory's own ENOENT
 *  fallback (emptyMemory()) already degrades to zero individuals, which this
 *  function turns into `{nodes: [], edges: [], focus: null}`. */
export async function computeVizGraph(repoDir, { focus } = {}) {
  const payload = await loadMemory(repoDir);
  const graph = parseEntities(payload);
  if (!graph.individuals.length) return { nodes: [], edges: [], focus: null };

  const seedId = focus || mostRecentIndividual(graph, CREATED_AT_PROP)?.id || null;
  if (!seedId) return { nodes: [], edges: [], focus: null };

  const walked = spiralExpand(graph, [], {
    kinds: MEMORY_SPIRAL_EXPAND_KINDS,
    classPredicate: () => true,
    idNormalizer: (id) => id,
    seeds: [seedId],
  });

  const nodeIds = new Set(walked.map((w) => w.id));
  const nodes = walked.map(({ id, hop }) => {
    const ind = graph.byId.get(id) || null;
    const attrs = ind?.attributes || [];
    const createdAt = attrs.find((a) => a?.prop === CREATED_AT_PROP)?.value || "";
    return {
      id,
      hop,
      label: ind?.label || id,
      class: ind?.class || "",
      createdAt,
      updatedAt: derivedUpdatedAt(graph, ind, { createdAtProp: CREATED_AT_PROP, updatedAtProp: UPDATED_AT_PROP }),
    };
  });

  // Edges connecting the returned node set — every relation group, not just
  // MEMORY_SPIRAL_EXPAND_KINDS, so any incidental edge between two walked
  // nodes (e.g. a kind the walk didn't traverse through but that still
  // happens to connect two nodes it reached another way) still renders.
  const edges = [];
  const seen = new Set(); // de-dup (subject,object,predicate) across relation groups
  for (const group of graph.relations) {
    for (const e of group.edges) {
      if (!nodeIds.has(e.subject) || !nodeIds.has(e.object)) continue;
      const key = `${e.subject} ${e.object} ${group.predicate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: e.subject, target: e.object, kind: group.predicate });
    }
  }

  return { nodes, edges, focus: seedId };
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
 *  `{nodes, edges, focus}` (computeVizGraph's return shape): the graph data
 *  JSON-embedded inline, inline <style>, inline vanilla-JS implementing a
 *  concentric ring layout keyed on hop (PLAN_VIZ.md §4 — seed/newest at the
 *  centre, each ring one hop further out), paint-order-by-hop with a
 *  lightness/opacity falloff for the depth read, pan (drag) + zoom (wheel),
 *  and click-a-node to show its real label/class/timestamps. Pure string
 *  building — no fs/network, no external <script src>, no CDN, no fonts. */
export function renderVizHtml({ nodes, edges, focus }) {
  const graphJson = embedJson({ nodes, edges, focus });
  const title = `tmct viz — ${nodes.length} node${nodes.length === 1 ? "" : "s"}${focus ? ` (seed: ${escapeHtml(focus)})` : ""}`;

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
  #panel { position: absolute; top: 12px; right: 12px; width: 280px; max-width: calc(100vw - 24px); background: rgba(20,22,30,0.92); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 12px 14px; font-size: 13px; line-height: 1.5; display: none; }
  #panel.show { display: block; }
  #panel h2 { margin: 0 0 6px; font-size: 14px; word-break: break-word; }
  #panel dl { margin: 8px 0 0; }
  #panel dt { color: #9aa1b0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 6px; }
  #panel dd { margin: 0; word-break: break-word; }
  #panel button { margin-top: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); color: #e7e9ee; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
  #panel button:hover { background: rgba(255,255,255,0.16); }
  #empty { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; text-align: center; padding: 24px; }
  #empty.show { display: flex; }
  #empty div { max-width: 46ch; color: #9aa1b0; }
  #empty b { color: #e7e9ee; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="c"></canvas>
  <div id="hud"><b>tmct viz</b><br><span class="muted">drag to pan &middot; scroll to zoom &middot; click a node for details</span></div>
  <div id="panel"></div>
  <div id="empty"><div><b>No graph data.</b><br>This repo has no <code>.tmct/memory/graph.json</code> yet (or the requested <code>--focus</code> id wasn't found). Run <code>tmct chat</code> in that repo first, then re-run <code>tmct viz</code>.</div></div>
</div>
<script>
const GRAPH = ${graphJson};
</script>
<script>
(function () {
  "use strict";
  var nodesById = new Map();
  GRAPH.nodes.forEach(function (n) { nodesById.set(n.id, n); });

  var emptyEl = document.getElementById("empty");
  if (!GRAPH.nodes.length) { emptyEl.classList.add("show"); return; }

  // ---- layout: concentric rings keyed on hop, seed at the centre ----------
  var RING_GAP = 110;         // px between hop rings at scale=1
  var byHop = new Map();      // hop -> [node,...]
  GRAPH.nodes.forEach(function (n) {
    if (!byHop.has(n.hop)) byHop.set(n.hop, []);
    byHop.get(n.hop).push(n);
  });
  byHop.forEach(function (list) { list.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }); });

  var pos = new Map(); // id -> {x, y} in world space
  byHop.forEach(function (list, hop) {
    var r = hop * RING_GAP;
    var n = list.length;
    list.forEach(function (node, i) {
      if (r === 0) { pos.set(node.id, { x: 0, y: 0 }); return; }
      // Small per-ring angular offset so successive rings don't align their
      // spokes exactly radially — purely cosmetic, keeps a dense graph legible.
      var angle = (2 * Math.PI * i) / n + hop * 0.35;
      pos.set(node.id, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
    });
  });

  var maxHop = 0;
  GRAPH.nodes.forEach(function (n) { if (n.hop > maxHop) maxHop = n.hop; });

  // ---- depth encoding: paint-order-by-hop + lightness/opacity falloff -----
  var HUE = 205; // a single hue family; depth is read via lightness/opacity/size, not colour variety
  function styleForHop(hop) {
    var t = maxHop > 0 ? hop / maxHop : 0;      // 0 (seed) .. 1 (furthest ring)
    var light = 78 - t * 40;                     // newer/closer = lighter, older/further = darker
    var alpha = 1 - t * 0.55;                     // newer/closer = more opaque
    var radius = Math.max(4, 9 - t * 5);          // newer/closer = slightly larger
    return { fill: "hsla(" + HUE + ", 70%, " + light + "%, " + alpha + ")", radius: radius };
  }

  // ---- canvas + view transform (pan/zoom) ----------------------------------
  var canvas = document.getElementById("c");
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  var view = { scale: 1, x: 0, y: 0 }; // world (0,0) maps to screen centre + (view.x, view.y)
  var selectedId = null;

  function resize() {
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    draw();
  }
  window.addEventListener("resize", resize);

  function worldToScreen(p) {
    var cx = canvas.width / 2 + view.x * dpr;
    var cy = canvas.height / 2 + view.y * dpr;
    return { x: cx + p.x * view.scale * dpr, y: cy + p.y * view.scale * dpr };
  }
  function screenToWorld(sx, sy) {
    var cx = canvas.width / 2 + view.x * dpr;
    var cy = canvas.height / 2 + view.y * dpr;
    return { x: (sx * dpr - cx) / (view.scale * dpr), y: (sy * dpr - cy) / (view.scale * dpr) };
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(1, 1 * dpr);
    // edges first, always beneath every node
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    GRAPH.edges.forEach(function (e) {
      var a = pos.get(e.source), b = pos.get(e.target);
      if (!a || !b) return;
      var sa = worldToScreen(a), sb = worldToScreen(b);
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    });
    // nodes, painted in ascending hop order (older/further first, seed/newest
    // last) so newer nodes read as "in front" — PLAN_VIZ.md's depth read.
    var order = GRAPH.nodes.slice().sort(function (a, b) { return a.hop - b.hop; });
    order.forEach(function (n) {
      var p = pos.get(n.id);
      if (!p) return;
      var sp = worldToScreen(p);
      var st = styleForHop(n.hop);
      var r = st.radius * view.scale * dpr;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(1.5, r), 0, Math.PI * 2);
      ctx.fillStyle = st.fill;
      ctx.fill();
      if (n.id === selectedId) {
        ctx.lineWidth = Math.max(1.5, 2 * dpr);
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
      // labels: only once zoomed in enough to stay legible, budget-free since
      // spiralExpand's own nodeLimit already bounds the node count.
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
    dragStart = { x: ev.clientX, y: ev.clientY };
    viewStart = { x: view.x, y: view.y };
    canvas.classList.add("grabbing");
  });
  window.addEventListener("mousemove", function (ev) {
    if (!dragging) return;
    var dx = ev.clientX - dragStart.x, dy = ev.clientY - dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
    view.x = viewStart.x + dx;
    view.y = viewStart.y + dy;
    draw();
  });
  window.addEventListener("mouseup", function () {
    dragging = false;
    canvas.classList.remove("grabbing");
  });

  // ---- zoom (wheel), anchored at the pointer --------------------------------
  canvas.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    var before = screenToWorld(mx, my);
    var factor = Math.exp(-ev.deltaY * 0.001);
    view.scale = Math.min(8, Math.max(0.08, view.scale * factor));
    var after = screenToWorld(mx, my);
    view.x += (after.x - before.x) * view.scale;
    view.y += (after.y - before.y) * view.scale;
    draw();
  }, { passive: false });

  // ---- click-to-inspect ------------------------------------------------------
  var panel = document.getElementById("panel");

  function fmtTs(v) { return v ? String(v) : "(none)"; }
  function escapeHtmlLocal(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showPanel(n) {
    selectedId = n.id;
    panel.innerHTML =
      "<h2>" + escapeHtmlLocal(n.label) + "</h2>" +
      "<dl>" +
      "<dt>id</dt><dd>" + escapeHtmlLocal(n.id) + "</dd>" +
      "<dt>class</dt><dd>" + escapeHtmlLocal(n.class || "(none)") + "</dd>" +
      "<dt>hop</dt><dd>" + n.hop + "</dd>" +
      "<dt>created</dt><dd>" + escapeHtmlLocal(fmtTs(n.createdAt)) + "</dd>" +
      "<dt>updated</dt><dd>" + escapeHtmlLocal(fmtTs(n.updatedAt)) + "</dd>" +
      "</dl>" +
      "<button id=\\"panelClose\\">close</button>";
    panel.classList.add("show");
    document.getElementById("panelClose").addEventListener("click", function () {
      panel.classList.remove("show");
      selectedId = null;
      draw();
    });
    draw();
  }

  canvas.addEventListener("click", function (ev) {
    if (dragMoved) return; // a drag, not a click
    var rect = canvas.getBoundingClientRect();
    var w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    var best = null, bestDist = Infinity;
    GRAPH.nodes.forEach(function (n) {
      var p = pos.get(n.id);
      if (!p) return;
      var dx = p.x - w.x, dy = p.y - w.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var st = styleForHop(n.hop);
      var hitR = Math.max(st.radius, 10) / view.scale; // generous hit target regardless of zoom
      if (d <= hitR && d < bestDist) { best = n; bestDist = d; }
    });
    if (best) showPanel(best);
  });

  resize();
  draw();
})();
</script>
</body>
</html>
`;
}
