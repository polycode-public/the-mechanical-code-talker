// viz.mjs — render a FOCUSED sub-graph of the typed code-map with Cytoscape.js.
// Deliberately NOT a whole-graph dump (that hangs the browser): we BFS an ego-network
// around a focus node to a small depth, stop expanding through high-degree hubs, and
// cap the node count.
//
// ONE viewer, three data channels. The viewer page (renderViewerHtml) contains no
// repo data; at boot it resolves its graph payload from, in order: a `?data=` query
// param, an embedded <script id="seonix-data"> block, a generated config pointer,
// or the sibling ./seonix-graph-data.json. The same page therefore serves:
//   - the website (seonix-graph.html + seonix-graph-data.json, both deployed),
//   - the portable single-file artifact (`viz --out f.html`, data embedded),
//   - the local live view (`viz --serve`, data served from the repo's own index).
//
// `buildSubgraph` and `buildViewerData` are pure and unit-tested; the CLI adds graph
// loading, file I/O, and the zero-dependency node:http server.

import { readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { parseEntities, resolveSymbol, relationKind, siteOf } from "./codegraph.mjs";
import { loadConfig } from "./config.mjs";
import * as source from "./source.mjs";
import { buildTemporalGraph, buildBrowserData, gitCommitOrder, gitCommitParents, renderBrowserHtml } from "./browser.mjs";
import { extractTimeline, renderTimelineHtml } from "./timeline.mjs";
import { winkBrowserBundle } from "./nlp-bundle.mjs";

// Portable single-file gate: above this serialized graph size, embedding the
// full raw graph inline yields an unopenable multi-hundred-MB HTML, so the
// portable branch writes the ask/graph payloads as sidecars instead. The env
// override SEONIX_VIZ_INLINE_MAX (bytes) lets an operator raise/lower it and
// doubles as the test hook; --force-inline forces embedding regardless.
export const INLINE_ASKDATA_MAX_BYTES = 32 * 1024 * 1024;

/** The gate threshold in bytes: env override when it parses as a number
 *  (including 0, which forces the gate on), otherwise the 32 MiB default. */
function inlineAskDataMaxBytes(env = process.env) {
  const parsed = parseInt(env.SEONIX_VIZ_INLINE_MAX ?? "", 10);
  return Number.isNaN(parsed) ? INLINE_ASKDATA_MAX_BYTES : parsed;
}

const here = dirname(fileURLToPath(import.meta.url));
const execFileP = promisify(execFile);

// Categorical type palette, CVD-validated as an ordered set against the dark canvas
// (#1a1b26): worst adjacent pair is Class↔Function ΔE 10.3 (protan) — floor-band,
// which is legal here because every node carries an outlined direct label and the
// legend chips + detail badge name the type. Red is deliberately absent so the
// white selection/focus ring and any status color can never impersonate a type.
const CLASS_COLOR = {
  Module: "#3987e5",
  Class: "#c98500",
  Function: "#008300",
  Method: "#d55181",
  Attribute: "#9085e9",
  GlobalVariable: "#d95926",
  Commit: "#199e70",
};

/** Build the adjacency + degree of every node across all typed relations. */
function adjacency(graph) {
  const adj = new Map(); // id -> [{id, rel}]
  const degree = new Map();
  const bump = (a, b, rel) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ id: b, rel });
    degree.set(a, (degree.get(a) || 0) + 1);
  };
  for (const g of graph.relations) {
    const rel = relationKind(g) || g.predicate || "rel";
    for (const e of g.edges) {
      if (!e.subject || !e.object) continue;
      bump(e.subject, e.object, rel);
      bump(e.object, e.subject, rel);
    }
  }
  return { adj, degree };
}

/** Highest-degree individual (Modules preferred) — the fallback focus when the
 *  caller names none, so `viz --serve` works out of the box in any indexed repo. */
export function defaultFocus(graph) {
  const { degree } = adjacency(graph);
  let best = null;
  for (const ind of graph.byId.values()) {
    const d = degree.get(ind.id) || 0;
    const score = d + (ind.class === "Module" ? 1e6 : 0); // any Module beats any non-Module
    if (!best || score > best.score) best = { id: ind.id, label: ind.label || ind.id, score };
  }
  return best;
}

/**
 * Focused ego-network around `focusId`: BFS to `depth`, not expanding through nodes
 * whose total degree exceeds `hubDegree` (so hubs appear but don't drag in the world),
 * capped at `maxNodes`. Pure — returns {nodes, edges, focusId, truncated}.
 */
export function buildSubgraph(graph, { focusId, depth = 2, hubDegree = 40, maxNodes = 200 } = {}) {
  if (!graph.byId.has(focusId)) return { nodes: [], edges: [], focusId, truncated: false };
  const { adj, degree } = adjacency(graph);
  const depthOf = new Map([[focusId, 0]]);
  let frontier = [focusId];
  let truncated = false;
  for (let d = 1; d <= depth && frontier.length; d += 1) {
    const next = [];
    for (const id of frontier) {
      // Stop expanding through a hub (but the hub itself is already included).
      if (id !== focusId && (degree.get(id) || 0) > hubDegree) continue;
      for (const { id: nb } of adj.get(id) || []) {
        if (depthOf.has(nb)) continue;
        if (depthOf.size >= maxNodes) { truncated = true; break; }
        depthOf.set(nb, d);
        next.push(nb);
      }
      if (depthOf.size >= maxNodes) { truncated = true; break; }
    }
    frontier = next;
  }
  const inSet = (id) => depthOf.has(id);
  const nodes = [];
  for (const [id, d] of depthOf) {
    const ind = graph.byId.get(id);
    const site = ind ? siteOf(ind) : null;
    nodes.push({
      id,
      label: ind?.label || id,
      cls: ind?.class || "Entity",
      site: site ? `${site.path}:${site.end > site.start ? `${site.start}-${site.end}` : site.start}` : "",
      depth: d,
      degree: degree.get(id) || 0,
    });
  }
  const seenEdge = new Set();
  const edges = [];
  for (const g of graph.relations) {
    const rel = relationKind(g) || g.predicate || "rel";
    for (const e of g.edges) {
      if (!inSet(e.subject) || !inSet(e.object)) continue;
      const key = `${e.subject}|${e.object}|${rel}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ source: e.subject, target: e.object, rel });
    }
  }
  return { nodes, edges, focusId, truncated };
}

/** The viewer's runtime payload — everything repo-specific lives here, nothing in
 *  the page. Pure; schema is part of the viewer contract (tests pin it). */
export function buildViewerData(subgraph, { focusLabel, repoUrl = "", repoRef = "main", siteNav = false, nav = null } = {}) {
  return {
    focusId: subgraph.focusId,
    focusLabel: focusLabel || subgraph.focusId,
    truncated: !!subgraph.truncated,
    maxDepth: subgraph.nodes.reduce((m, n) => Math.max(m, n.depth), 0),
    repoUrl: repoUrl.replace(/\/+$/, ""),
    repoRef,
    siteNav: !!siteNav, // legacy flag — stale deployed data keeps its absolute links
    ...(nav ? { nav } : {}), // {name: href} — the viewer rebuilds #sitenav from this
    nodes: subgraph.nodes,
    edges: subgraph.edges,
  };
}

/** Inline the Cytoscape dist so the HTML is one portable file (no sidecar, no CDN).
 *  Resolved via Node's own module resolution (createRequire), not a hardcoded
 *  relative-path guess — the guess only worked inside this monorepo's own dev
 *  layout (root-hoisted node_modules) and broke for a real npm-installed consumer,
 *  where cytoscape sits under the consumer's own node_modules, at a different
 *  depth from this file (`node_modules/@polycode-projects/seonix/src/…`). Node's
 *  resolution algorithm walks every parent node_modules correctly regardless of
 *  install topology (monorepo, flat install, nested install, pnpm symlinks). */
export async function cytoscapeSource() {
  try {
    const path = createRequire(import.meta.url).resolve("cytoscape/dist/cytoscape.min.js");
    return await readFile(path, "utf8");
  } catch {
    throw new Error("cytoscape not installed — reinstall @polycode-projects/seonix (cytoscape is a declared dependency)");
  }
}

/** The mechanical (zero-model-call) chat panel's engine, inlined into the viewer
 *  page — codegraph.mjs's parseEntities/relationKind (both zero-import, so the
 *  whole file inlines safely, same as temporal.mjs does for the code browser)
 *  in dependency order under ask-vocab.mjs's tables under ask.mjs's grammar/
 *  render logic. `export`/`import` lines stripped so the three files run as one
 *  plain <script> block; nothing here diverges from the node-tested source. */
async function askSource() {
  const [codegraph, vocab, ask] = await Promise.all(
    ["codegraph.mjs", "ask-vocab.mjs", "ask.mjs"].map((f) => readFile(join(here, f), "utf8")),
  );
  // Non-greedy up to the closing `";` (not `$`-anchored): ask.mjs's own import spans
  // multiple lines (a multi-name destructure), which a single-line `^...$` pattern
  // silently leaves in place — and unlike a stray declaration, a surviving `import`
  // is a hard SyntaxError in a classic (non-module) inlined <script>, not a quiet bug.
  const strip = (src) => src
    .replace(/^import\s[\s\S]*?from\s+"[^"]+";\s*$/gm, "")
    .replace(/^export (?=(function|const|async function))/gm, "");
  return [strip(codegraph), strip(vocab), strip(ask)].join("\n");
}

/** JSON safe to sit inside a <script> block (no </script> or comment-open breakouts). */
const inlineJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

/**
 * The ONE viewer page. Repo-agnostic: no graph data, no repo URL, no focus baked in.
 * `embedData` (portable single-file mode) and `dataPath` (generated pointer to a
 * non-default data file) are the only generation-time inserts for the DISPLAY
 * sub-graph; both are optional. `askEngine` (the inlined ask.mjs stack, from
 * askSource()) powers the chat panel — omit it and the panel still renders but
 * every query reports the engine as unavailable, never a silent no-op. `askData`/
 * `askDataPath` mirror `embedData`/`dataPath` but for the FULL raw graph payload
 * the chat panel queries — deliberately a SEPARATE, lazily-loaded channel from the
 * depth-limited display sub-graph: querying only what's currently drawn would
 * silently produce incomplete answers, which this project's honesty contract
 * doesn't allow (see the file-level comment's "ONE viewer, three data channels" —
 * this is a fourth, for the same one-viewer-many-modes reason).
 *
 * The OPTIONAL wink-nlp lemma tier (ask-nlp.mjs's browser twin, from nlp-bundle.mjs)
 * reaches the chat two ways: `nlpInline` inlines the ~4 MB bundle as its own <script>
 * so it registers `window.__seonixNlp` at page load (portable `viz --nlp`); `nlpPath`
 * points the page at a same-origin sibling asset the chat LAZY-loads on first ask
 * (the SITE build). Neither is present in the default local single-file — that viewer
 * stays lemma-off and fetches nothing, exactly as before, preserving its
 * no-external-fetch guarantee. ask() picks up whatever `window.__seonixNlp` is set,
 * or degrades to the adapter-less tiers when it's absent.
 */
export function renderViewerHtml({ cytoscape, askEngine = "", embedData = null, dataPath = null, askData = null, askDataPath = null, nlpInline = null, nlpPath = null } = {}) {
  const embedded = embedData ? `<script type="application/json" id="seonix-data">${inlineJson(embedData)}</script>\n` : "";
  const askEmbedded = askData ? `<script type="application/json" id="seonix-ask-data">${inlineJson(askData)}</script>\n` : "";
  const cfgObj = { ...(dataPath ? { data: dataPath } : {}), ...(askDataPath ? { ask: askDataPath } : {}), ...(nlpPath ? { nlp: nlpPath } : {}) };
  const cfg = Object.keys(cfgObj).length ? `<script type="application/json" id="seonix-cfg">${inlineJson(cfgObj)}</script>\n` : "";
  // Inline bundle: escape any literal </script inside the wink model data so the
  // block can't be closed early (harmless inside JS strings, impossible outside them).
  const nlpEmbedded = nlpInline ? `<script>${String(nlpInline).replace(/<\/script/gi, "<\\/script")}</script>\n` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>seon code-map</title>
<!-- generated by: seonix viz (see packages/seonix/src/viz.mjs) — one viewer, data loaded at runtime -->
<style>
  html,body{margin:0;height:100%;font:13px system-ui,sans-serif;background:#1a1b26;color:#c0caf5}
  body{display:flex;flex-direction:column}
  #bar{padding:6px 12px;background:#16161e;border-bottom:1px solid #2a2e42;display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:0 0 auto}
  #bar .grp{display:inline-flex;gap:8px;align-items:center;padding:0 10px;border-right:1px solid #2a2e42}
  #bar .grp:first-child{padding-left:0} #bar .grp:last-of-type,#bar .nav{border-right:0}
  #bar .nav{margin-left:auto} #bar .nav a{color:#7aa2f7;text-decoration:none;font-size:12px} #bar .nav a:hover{text-decoration:underline}
  #bar label,.lbl{color:#a9b1d6} #bar b{color:#7aa2f7}
  #bar button{background:#1a1b26;color:#c0caf5;border:1px solid #2a2e42;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit;line-height:1.2}
  #bar button:hover{border-color:#7aa2f7;color:#7aa2f7}
  #bar button:disabled{opacity:.4;cursor:default}
  #bar button:disabled:hover{border-color:#2a2e42;color:#c0caf5}
  #depthval{min-width:1.2em;text-align:center;display:inline-block;cursor:help}
  #hub,#beam{width:3.5em;background:#1a1b26;color:#c0caf5;border:1px solid #2a2e42;border-radius:4px;padding:1px 4px;font:inherit}
  #legend{padding:4px 12px 6px;background:#16161e;border-bottom:1px solid #2a2e42;display:flex;flex-wrap:wrap;gap:2px 12px;font-size:12px;flex:0 0 auto}
  /* Graph on top (full width, generous height); the chat + node-detail ride a
     full-width row BENEATH it (chat grows, detail a compact fixed column). On a
     narrow screen #below stacks so the body never scrolls sideways. */
  #main{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
  #cy{flex:1 1 auto;position:relative;min-height:260px}
  #below{flex:0 0 auto;display:flex;background:#16161e;border-top:1px solid #2a2e42;max-height:46vh;box-sizing:border-box}
  #ask{flex:1 1 auto;min-width:0;padding:14px 16px;overflow:auto;box-sizing:border-box;display:flex;flex-direction:column}
  #detail{flex:0 0 300px;padding:14px;overflow:auto;border-left:1px solid #2a2e42;box-sizing:border-box}
  @media(max-width:720px){#below{flex-direction:column;max-height:58vh;overflow:auto}#detail{flex:0 0 auto;border-left:0;border-top:1px solid #2a2e42}}
  .lg{white-space:nowrap;cursor:pointer;user-select:none;color:#a9b1d6}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:middle}.lg input{vertical-align:middle;margin:0 3px 0 0}
  .lg .cnt{color:#565f89;margin-left:3px;font-size:11px;font-variant-numeric:tabular-nums}
  select{background:#1a1b26;color:#c0caf5;border:1px solid #2a2e42;border-radius:4px;font:inherit}
  #detail h3{margin:2px 0 8px;color:#c0caf5;font-size:15px;word-break:break-all}
  #ask h4{margin:0 0 8px;color:#a9b1d6;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border:1px solid #2a2e42;border-radius:10px;font-size:11px;color:#a9b1d6}
  .badge i{width:8px;height:8px;border-radius:50%;display:inline-block}
  #detail dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:10px 0;font-size:12px;color:#c0caf5}
  #detail dt{color:#565f89}#detail dd{margin:0}
  .btn{display:inline-block;padding:4px 10px;border:1px solid #3b4261;border-radius:5px;color:#7aa2f7;background:#1a1b26;cursor:pointer;text-decoration:none;font:inherit;font-size:12px}
  .btn:hover{border-color:#7aa2f7}
  .row{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap}
  .hint{color:#565f89;font-size:11px;margin-top:10px}
  .empty{color:#a9b1d6;font-size:12px;line-height:1.7}
  code{color:#9aa5ce;word-break:break-all}
  .askrow{display:flex;gap:6px}
  #askq{flex:1;min-width:0;background:#1a1b26;color:#c0caf5;border:1px solid #2a2e42;border-radius:4px;padding:7px 10px;font:inherit;font-size:13px}
  #askq:focus{outline:none;border-color:#7aa2f7}
  .askresult{margin-top:10px;flex:1 1 auto;font-size:12.5px;line-height:1.6;color:#c0caf5;overflow:auto}
  .askresult.miss{color:#a9b1d6;font-style:italic}
  .askresult .askq-echo{color:#565f89;margin-bottom:4px;font-style:normal}
</style></head><body>
<div id="bar">
  <span class="grp"><b>seon</b> focus: <b id="focuslabel">…</b></span>
  <span class="grp"><span class="lbl">depth</span><button id="depthdown" title="shallower">−</button><b id="depthval"></b><button id="depthup" title="deeper">+</button></span>
  <span class="grp"><label title="hide nodes with more connections than this (hubs swamp the layout)"><input type="checkbox" id="hubon" checked> hide hubs deg&gt; <input id="hub" type="number" min="2" max="200" value="16"></label>
  <label title="beam-prune from the focus: at each hop keep only the top-N neighbours by degree (margin+cap prune) — a degree-scored analogue of the ask engine's beam search, NOT the same scorer"><input type="checkbox" id="beamon"> beam <input id="beam" type="number" min="1" max="32" value="8"></label></span>
  <span class="grp"><label>labels <select id="verb"><option value="smart">smart</option><option value="name">all names</option><option value="site">name+site</option><option value="none">none</option></select></label>
  <label>layout <select id="layout"><option value="cose">cose</option><option value="breadthfirst">tree</option><option value="concentric">concentric</option></select></label></span>
  <span class="grp" id="view">
    <button id="fit" title="fit the whole graph in view (Esc)">fit</button>
    <button id="zoomout" title="zoom out">−</button>
    <button id="zoomin" title="zoom in">+</button>
    <button id="reset" title="restore the boot view: default filters, all types shown, original focus">reset</button>
  </span>
  <span class="grp nav" id="sitenav" hidden><a href="/">home</a><a href="/code-browser.html">browser</a><a href="/timeline.html">timeline</a></span>
</div>
<div id="legend"></div>
<div id="main">
  <div id="cy"></div>
  <div id="below">
    <div id="ask">
      <h4>Ask the graph</h4>
      <div class="askrow"><input id="askq" type="text" autocomplete="off" placeholder='ask e.g. "what calls this"'><button class="btn" id="asksubmit">ask</button></div>
      <div id="askresult" class="askresult"></div>
    </div>
    <div id="detail"></div>
  </div>
</div>
${embedded}${askEmbedded}${cfg}<script>${cytoscape}</script>
<script>${askEngine}</script>
${nlpEmbedded}<script>
// Type palette (see the CVD note in viz.mjs) — viewer styling, identical for every repo.
const COLORS={Module:'#3987e5',Class:'#c98500',Function:'#008300',Method:'#d55181',Attribute:'#9085e9',GlobalVariable:'#d95926',Commit:'#199e70'};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// Data resolution order: ?data= query param > embedded block (portable single-file
// artifact) > generated config pointer > the site/serve default sibling JSON.
async function loadData(){
  const q=new URLSearchParams(location.search).get('data');
  if(!q){
    const emb=document.getElementById('seonix-data');
    if(emb) return JSON.parse(emb.textContent);
  }
  const cfgEl=document.getElementById('seonix-cfg');
  const url=q||(cfgEl?JSON.parse(cfgEl.textContent).data:'./seonix-graph-data.json');
  const r=await fetch(url);
  if(!r.ok) throw new Error('HTTP '+r.status+' loading '+url);
  return r.json();
}
// The chat panel's data is a SEPARATE, lazily-loaded channel from the display
// sub-graph above — the FULL raw graph, fetched/parsed only on the first ask
// (never on page load), same resolution order as loadData() minus the ?data=
// override (that param is reserved for the display graph). Cached after the
// first call; parseEntities/ask come from the inlined ask engine (askSource()).
let _askGraphPromise=null;
function loadAskData(){
  if(_askGraphPromise) return _askGraphPromise;
  _askGraphPromise=(async()=>{
    const emb=document.getElementById('seonix-ask-data');
    let raw;
    if(emb){
      raw=JSON.parse(emb.textContent);
    }else{
      const cfgEl=document.getElementById('seonix-cfg');
      const url=(cfgEl&&JSON.parse(cfgEl.textContent).ask)||'./seonix-ask-data.json';
      const r=await fetch(url);
      if(!r.ok) throw new Error('HTTP '+r.status+' loading '+url);
      raw=await r.json();
    }
    return parseEntities(raw);
  })();
  return _askGraphPromise;
}
// The OPTIONAL wink-nlp lemma adapter (window.__seonixNlp — see nlp-bundle.mjs).
// An inlined bundle registers it at page load; the site build ships it as a
// same-origin sibling this injects LAZILY on the first ask (never at boot), so the
// ~4 MB model is only paid for when the chat is actually used. With neither present
// (the default local single-file) this resolves to undefined and the chat runs
// adapter-less — ask() then falls back to its curated + fuzzy tiers, exactly as
// before, and NOTHING is fetched, keeping the no-external-fetch guarantee intact.
let _nlpPromise=null;
function loadNlp(){
  if(window.__seonixNlp) return Promise.resolve(window.__seonixNlp);
  if(_nlpPromise) return _nlpPromise;
  const cfgEl=document.getElementById('seonix-cfg');
  const url=cfgEl?JSON.parse(cfgEl.textContent).nlp:null;
  if(!url) return Promise.resolve(undefined);
  _nlpPromise=new Promise(res=>{
    const s=document.createElement('script');
    s.src=url;
    s.onload=()=>res(window.__seonixNlp);
    s.onerror=()=>res(undefined); // a failed asset degrades to lemma-off, never a broken chat
    document.head.appendChild(s);
  });
  return _nlpPromise;
}
function init(G){
  document.title='seon code-map — '+G.focusLabel;
  $('focuslabel').textContent=G.focusLabel;
  // nav rides the data payload ({name: href}, hrefs relative to THIS page);
  // G.siteNav is the legacy flag — stale deployed data keeps its absolute links.
  if(G.nav){$('sitenav').innerHTML=Object.entries(G.nav).map(([k,h])=>'<a href="'+esc(h)+'">'+esc(k)+'</a>').join('');$('sitenav').hidden=false;}
  else if(G.siteNav)$('sitenav').hidden=false;
  // Legend doubles as a node-type filter: a checkbox chip per type GROUP —
  // Function/Method share a chip (legend-only merge; node fills stay distinct),
  // with a live visible/loaded count summed across the group.
  const GROUPS=[['Module'],['Class'],['Function','Method'],['Attribute'],['GlobalVariable'],['Commit']];
  $('legend').innerHTML=GROUPS
    .map(g=>'<label class="lg" title="show/hide '+g.join('/')+' nodes"><input type="checkbox" class="typechk" data-cls="'+g.join(',')+'" checked>'+g.map(k=>'<i style="background:'+COLORS[k]+'"></i>').join('')+g.join('/')+'<span class="cnt" data-cnt="'+g.join(',')+'"></span></label>')
    .join(' ');
  // depth is a − [N] + stepper clamped to the DATA's max depth (no dead buttons), default 2
  const maxDepth=Math.max(1,G.maxDepth);
  let depthVal=Math.min(2,maxDepth);
  $('depthval').title='captured to depth '+maxDepth+' — regenerate with --depth for more';
  function syncDepthUi(){$('depthval').textContent=depthVal;$('depthdown').disabled=depthVal<=1;$('depthup').disabled=depthVal>=maxDepth;}
  syncDepthUi();
  const INITIAL_FOCUS=G.focusId;
  const cy=cytoscape({container:document.getElementById('cy'),
    // depth0 caches the boot depth per node BEFORE any recentre mutates data('depth') — the reset button restores from it
    elements:[...G.nodes.map(n=>({data:{...n,depth0:n.depth,color:COLORS[n.cls]||'#8a8f98'}})),...G.edges.map((e,i)=>({data:{id:'e'+i,...e}}))],
    style:[
      // black text outline keeps white labels readable over node fills and the dark canvas;
      // node size encodes degree (bounded) so hubs read as hubs at a glance.
      {selector:'node',style:{'background-color':'data(color)','label':'','color':'#fff','font-size':10,'min-zoomed-font-size':7,'text-outline-color':'#000','text-outline-width':2,'text-wrap':'wrap','text-max-width':120,'width':'mapData(degree,1,40,16,34)','height':'mapData(degree,1,40,16,34)'}},
      // focus + selection wear a white ring — white is no type's hue, so attention never impersonates identity
      {selector:'node.focus',style:{'width':34,'height':34,'border-width':3,'border-color':'#fff'}},
      {selector:'node.sel',style:{'border-width':3,'border-color':'#fff'}},
      {selector:'.faded',style:{'opacity':0.15}},
      // edge type labels only on hover/tap — painted everywhere they bury the graph
      {selector:'edge',style:{'width':1,'line-color':'#3b4261','target-arrow-color':'#3b4261','target-arrow-shape':'triangle','curve-style':'bezier'}},
      {selector:'edge.hl',style:{'width':2,'line-color':'#7aa2f7','target-arrow-color':'#7aa2f7'}},
      {selector:'edge.showrel',style:{'label':'data(rel)','font-size':8,'color':'#c0caf5','text-outline-color':'#000','text-outline-width':2,'text-rotation':'autorotate','line-color':'#7aa2f7','target-arrow-color':'#7aa2f7'}}
    ],
    layout:{name:'cose',animate:false},
    wheelSensitivity:0.2});
  cy.on('mouseover','edge',e=>e.target.addClass('showrel'));
  cy.on('mouseout','edge',e=>e.target.removeClass('showrel'));
  cy.on('tap','edge',e=>{cy.edges('.showrel').removeClass('showrel');e.target.addClass('showrel');});
  let selId=null;
  function enabledTypes(){
    const on=new Set();
    document.querySelectorAll('.typechk').forEach(c=>{if(c.checked)c.dataset.cls.split(',').forEach(t=>on.add(t));});
    return on;
  }
  function curDepth(){return depthVal;}
  function curHub(){return $('hubon').checked ? +$('hub').value : Infinity;}
  const NODE=new Map(G.nodes.map(n=>[n.id,n]));
  // Beam mode: BFS from the focus over the loaded adjacency, pruning each node's
  // candidate neighbours (those passing hub+type filters) to the top-width by
  // DEGREE with margin deg >= best*0.5 — mirrors BEAM_MARGIN_FRAC=0.5 in
  // codegraph.mjs, but degree-scored: an analogue of the ask engine's beam
  // search, not the same scorer.
  function beamSet(width,h,types){
    const pass=id=>{const n=NODE.get(id);return !!n&&(id===G.focusId||n.degree<=h)&&types.has(n.cls);};
    const seen=new Set([G.focusId]);
    let frontier=[G.focusId];
    while(frontier.length){
      const next=[];
      for(const id of frontier){
        const cand=(ADJ[id]||[]).filter(nb=>!seen.has(nb)&&pass(nb))
          .sort((a,b)=>NODE.get(b).degree-NODE.get(a).degree);
        const best=cand.length?NODE.get(cand[0]).degree:0;
        for(const nb of cand.slice(0,width)){
          if(NODE.get(nb).degree>=best*0.5){seen.add(nb);next.push(nb);}
        }
      }
      frontier=next;
    }
    return seen;
  }
  function applyFilters(){
    const d=curDepth(), h=curHub(), types=enabledTypes();
    const beam=$('beamon').checked?beamSet(Math.max(1,Math.min(32,+$('beam').value||8)),h,types):null;
    const vis={}, tot={};
    cy.batch(()=>cy.nodes().forEach(n=>{
      const cls=n.data('cls');
      tot[cls]=(tot[cls]||0)+1;
      const v = beam ? beam.has(n.id())
        : n.data('depth')<=d && (n.id()===G.focusId || n.data('degree')<=h) && types.has(cls);
      if(v) vis[cls]=(vis[cls]||0)+1;
      n.style('display', v?'element':'none');
    }));
    // live per-group counts: visible/loaded summed across the group's classes
    document.querySelectorAll('.cnt').forEach(s=>{
      const ks=s.dataset.cnt.split(',');
      const v=ks.reduce((a,k)=>a+(vis[k]||0),0), t=ks.reduce((a,k)=>a+(tot[k]||0),0);
      s.textContent=v+'/'+t;
      s.title=v+' visible of '+t+' loaded '+ks.join('/')+' node(s) at depth '+d+(isFinite(h)?', hide deg>'+h:'');
    });
    applyLabels();
  }
  const labelText=(n,withSite)=>n.data('label')+(withSite&&n.data('site')?'\\n'+n.data('site'):'');
  // smart labels (default): a label budget instead of label soup — the focus node, the
  // selection + its neighbours, and the top visible nodes by degree; everything else
  // labels on hover. "all names"/"name+site" restore the old paint-everything modes.
  const LABEL_BUDGET=20;
  function applyLabels(){
    const v=$('verb').value;
    if(v==='none'){cy.nodes().forEach(n=>n.style('label',''));return;}
    let show=null;
    if(v==='smart'){
      show=new Set([G.focusId]);
      if(selId){show.add(selId);cy.getElementById(selId).closedNeighborhood('node').forEach(n=>show.add(n.id()));}
      const vis=cy.nodes().filter(n=>n.style('display')!=='none');
      vis.sort((a,b)=>b.data('degree')-a.data('degree')).slice(0,LABEL_BUDGET).forEach(n=>show.add(n.id()));
    }
    cy.nodes().forEach(n=>n.style('label',(!show||show.has(n.id()))?labelText(n,v==='site'):''));
  }
  cy.on('mouseover','node',e=>{if($('verb').value==='smart')e.target.style('label',labelText(e.target,false));});
  cy.on('mouseout','node',e=>{if($('verb').value==='smart')applyLabels();});
  const stepDepth=dir=>{const d=Math.min(maxDepth,Math.max(1,depthVal+dir));if(d===depthVal)return;depthVal=d;syncDepthUi();applyFilters();};
  $('depthdown').addEventListener('click',()=>stepDepth(-1));
  $('depthup').addEventListener('click',()=>stepDepth(1));
  $('hubon').addEventListener('change',applyFilters);
  $('hub').addEventListener('input',applyFilters);
  $('beamon').addEventListener('change',applyFilters);
  $('beam').addEventListener('input',applyFilters);
  document.querySelectorAll('.typechk').forEach(c=>c.addEventListener('change',applyFilters));
  $('verb').addEventListener('change',applyLabels);
  $('layout').addEventListener('change',()=>cy.layout({name:$('layout').value,animate:false}).run());
  const ZF=1.2;
  const zoomBy=(f)=>cy.zoom({level:cy.zoom()*f,renderedPosition:{x:cy.width()/2,y:cy.height()/2}});
  $('fit').addEventListener('click',()=>{cy.fit(undefined,30);});
  $('zoomin').addEventListener('click',()=>zoomBy(ZF));
  $('zoomout').addEventListener('click',()=>zoomBy(1/ZF));
  // real reset: back to the boot view — defaults, all types on, depths from
  // depth0 (the pre-recentre capture), focus ring on the boot focus.
  $('reset').addEventListener('click',()=>{
    if($('layout').value!=='cose'){$('layout').value='cose';cy.layout({name:'cose',animate:false}).run();}
    $('verb').value='smart';
    $('hubon').checked=true;$('hub').value=16;
    $('beamon').checked=false;$('beam').value=8;
    depthVal=Math.min(2,maxDepth);syncDepthUi();
    document.querySelectorAll('.typechk').forEach(c=>{c.checked=true;});
    cy.getElementById(G.focusId).removeClass('focus');
    G.focusId=INITIAL_FOCUS;
    cy.batch(()=>cy.nodes().forEach(n=>n.data('depth',n.data('depth0'))));
    cy.getElementById(INITIAL_FOCUS).addClass('focus');
    $('focuslabel').textContent=G.focusLabel;
    applyFilters();
    select(null);
    cy.fit(undefined,30);
  });
  // Deep link into the source host (GitLab URL layout) when the data carries a
  // repoUrl: Commit nodes -> /-/commit/<sha>, anything with a file site ->
  // /-/blob/<ref>/<path>#L<lines>, bare Modules -> the file blob.
  function nodeUrl(d){
    if(!G.repoUrl) return null;
    if(d.cls==='Commit'&&d.id.startsWith('commit:')) return G.repoUrl+'/-/commit/'+d.id.slice(7);
    if(d.site){
      const i=d.site.lastIndexOf(':');
      return G.repoUrl+'/-/blob/'+G.repoRef+'/'+d.site.slice(0,i)+'#L'+d.site.slice(i+1);
    }
    if(d.id.startsWith('mod:')) return G.repoUrl+'/-/blob/'+G.repoRef+'/'+d.id.slice(4);
    return null;
  }
  function renderDetail(d){
    const url=nodeUrl(d);
    $('detail').innerHTML='<h3>'+esc(d.label)+'</h3>'
      +'<span class="badge"><i style="background:'+d.color+'"></i>'+esc(d.cls)+'</span>'
      +'<dl><dt>depth</dt><dd>'+d.depth+'</dd><dt>degree</dt><dd>'+d.degree+'</dd>'
      +(d.site?'<dt>site</dt><dd><code>'+esc(d.site)+'</code></dd>':'')+'</dl>'
      +'<div class="row">'
      +(url?'<a class="btn" href="'+url+'" target="_blank" rel="noopener">open in GitLab ↗</a>':'')
      +'<button class="btn" id="recentrebtn">re-centre here</button></div>'
      +'<div class="hint">id <code>'+esc(d.id)+'</code></div>';
    $('recentrebtn').addEventListener('click',()=>recentre(d.id));
  }
  function renderDetailEmpty(){
    $('detail').innerHTML='<p class="empty">Click a node to inspect it.<br>Double-click a node to re-centre on it.<br>Drag to pan · scroll to zoom · Esc fits all.</p>'
      +'<p class="hint">'+G.nodes.length+' nodes · '+G.edges.length+' edges loaded'+(G.truncated?' (capped)':'')+'.</p>';
  }
  // selection: dim everything outside the tapped node's neighbourhood so the local
  // structure reads instantly; background tap or Esc clears.
  function select(node){
    cy.elements().removeClass('faded sel hl');
    selId=node?node.id():null;
    if(node){
      cy.elements().not(node.closedNeighborhood()).addClass('faded');
      node.addClass('sel');
      node.connectedEdges().addClass('hl');
      renderDetail(node.data());
    } else renderDetailEmpty();
    applyLabels();
  }
  cy.on('tap','node',e=>select(e.target));
  cy.on('tap',e=>{if(e.target===cy)select(null);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){select(null);cy.fit(undefined,30);}});
  // re-centre: recompute node depths client-side (BFS over the LOADED sub-graph — an
  // honest approximation; deeper structure than the data carries stays absent)
  // and move the focus ring; double-click or the panel button.
  const ADJ={};
  G.edges.forEach(e=>{(ADJ[e.source]??=[]).push(e.target);(ADJ[e.target]??=[]).push(e.source);});
  function recentre(id){
    const depth={[id]:0};const q=[id];
    while(q.length){const cur=q.shift();for(const nb of ADJ[cur]||[]){if(!(nb in depth)){depth[nb]=depth[cur]+1;q.push(nb);}}}
    cy.getElementById(G.focusId).removeClass('focus');
    G.focusId=id;
    cy.batch(()=>cy.nodes().forEach(n=>n.data('depth', depth[n.id()] ?? 99)));
    const f=cy.getElementById(id);
    f.addClass('focus');
    $('focuslabel').textContent=f.data('label');
    applyFilters();
    select(f);
    cy.fit(cy.nodes().filter(n=>n.style('display')!=='none'),30);
  }
  cy.on('dbltap','node',e=>recentre(e.target.id()));
  cy.getElementById(G.focusId).addClass('focus');
  applyFilters();select(null);
  cy.fit(undefined,30); // land fitted to the whole depth-2 neighbourhood, not zoomed into label soup
  // Mechanical (zero-model-call) chat panel: queries the FULL raw graph (loadAskData,
  // lazy — never the depth-limited display sub-graph above, so an answer is never
  // silently incomplete), with the current selection as pronoun context ("this"/"it").
  // Highlighting is honest about the display/query mismatch: matches that AREN'T among
  // the currently-loaded nodes are named in the answer text but can't be spotlighted —
  // stated plainly rather than pretending the view moved.
  function highlightAsk(ids){
    cy.elements().removeClass('faded sel hl');
    selId=null;
    const eles=cy.collection();
    ids.forEach(id=>{const n=cy.getElementById(id);if(n.nonempty())eles.merge(n);});
    if(eles.nonempty()){
      cy.elements().not(eles).addClass('faded');
      eles.addClass('sel');
      cy.fit(eles,50);
    }
    applyLabels();
    return eles.length;
  }
  function runAsk(query){
    const out=$('askresult');
    out.classList.remove('miss');
    if(typeof ask!=='function'){
      out.classList.add('miss');
      out.textContent='the ask engine did not load with this page.';
      return;
    }
    out.textContent='thinking…';
    // Load the graph and (if configured) the wink lemma adapter together, then run
    // the mechanical ask. An undefined nlp makes ask() degrade to its adapter-less tiers.
    Promise.all([loadAskData(),loadNlp()]).then(([askGraph,nlp])=>{
      const {content,seonix_ask}=ask(askGraph,query,{contextId:selId,nlp});
      const total=(seonix_ask.matches||[]).length;
      const shown=total?highlightAsk(seonix_ask.matches.map(m=>m.id)):0;
      out.classList.toggle('miss',!!seonix_ask.miss);
      let note='';
      if(total&&shown<total) note=' <span class="hint">('+shown+' of '+total+' match(es) are in the currently loaded view)</span>';
      else if(total&&!shown) note=' <span class="hint">(not shown — outside the currently loaded view)</span>';
      out.innerHTML='<div class="askq-echo">"'+esc(query)+'"</div>'+esc(content)+note;
    }).catch(err=>{
      out.classList.add('miss');
      out.textContent='could not load the graph for this query: '+err.message;
    });
  }
  $('askresult').innerHTML='<span class="hint">try: "what calls this" (after selecting a node) · "which functions import X" · "does A import B"</span>';
  $('asksubmit').addEventListener('click',()=>{const q=$('askq').value.trim();if(q)runAsk(q);});
  $('askq').addEventListener('keydown',e=>{if(e.key==='Enter'){const q=$('askq').value.trim();if(q)runAsk(q);}});
  window.cy=cy; // scripted checks (playwright) drive the instance directly
}
loadData().then(init).catch(err=>{
  $('detail').innerHTML='<p class="empty">Failed to load graph data: '+esc(err.message)
    +'</p><p class="hint">Serve a seonix-graph-data.json next to this page, pass ?data=&lt;url&gt;, or regenerate with seonix viz.</p>';
});
</script></body></html>`;
}

/** Compat wrapper: the portable single-file artifact (viewer + embedded data). */
export function renderHtml({ subgraph, focusLabel, cytoscape, askEngine = "", askData = null, repoUrl = "", repoRef = "main", siteNav = false }) {
  const data = buildViewerData(subgraph, { focusLabel, repoUrl, repoRef, siteNav });
  return renderViewerHtml({ cytoscape, askEngine, embedData: data, askData });
}

/** Best-effort GitLab base URL from the repo's `origin` remote; empty when the
 *  remote is absent or not GitLab-shaped (the viewer then renders no dead links). */
export async function repoUrlFromGit(cwd) {
  try {
    const { stdout } = await execFileP("git", ["remote", "get-url", "origin"], { cwd });
    const raw = stdout.trim();
    const m = raw.match(/^(?:git@|ssh:\/\/git@)([^:/]+)[:/](.+?)(?:\.git)?$/) || raw.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (!m) return "";
    const [, host, path] = m;
    if (!/gitlab/i.test(host)) return ""; // the deep-link layout is GitLab's
    return `https://${host}/${path}`;
  } catch {
    return "";
  }
}

/** The literal `git rev-parse HEAD` (P3 live re-annotate's cheap change signal —
 *  independent of the temporal graph's own commit list, which only carries
 *  commits that touched a tracked symbol). Empty string on any git failure. */
async function gitHeadOf(cwd) {
  try {
    const { stdout } = await execFileP("git", ["-C", cwd, "rev-parse", "HEAD"], {});
    return stdout.trim();
  } catch {
    return "";
  }
}

async function loadGraph(values) {
  const config = loadConfig(values.graph ? { ...process.env, SEONIX_GRAPH_FILE: resolve(values.graph) } : process.env);
  const raw = await source.fetchEntities(config);
  const graph = parseEntities(raw);
  // Serialized on-disk size drives the portable-branch large-graph gate (the real
  // failure mode). 0 on any stat failure so a missing/unstattable file never gates.
  let graphBytes = 0;
  try {
    graphBytes = (await stat(config.graphFile)).size;
  } catch {
    graphBytes = 0;
  }
  return { config, graph, raw, graphBytes };
}

function resolveFocus(graph, focusArg) {
  if (focusArg) {
    const { match } = resolveSymbol(graph, focusArg);
    return match ? { id: match.id, label: match.label, defaulted: false } : null;
  }
  const best = defaultFocus(graph);
  return best ? { id: best.id, label: best.label, defaulted: true } : null;
}

/**
 * `viz --serve`: the site experience against the LOCAL repo's index. Serves the one
 * viewer at `/` and rebuilds `/seonix-graph-data.json` from the graph file on every
 * request, so a re-index shows up on refresh without restarting. The Chronograph
 * code browser rides along at `/code-browser.html` (alias `/browser`) with a live
 * temporal payload — the local equivalent of the site's browser section.
 */
export async function startVizServer({ values, cytoscape, askEngine = "", nlpBundle = null, log = () => {} }) {
  const port = Math.max(0, parseInt(values.port, 10) || 0);
  const repoUrl = values["repo-url"] || (await repoUrlFromGit(process.cwd()));
  // With --nlp the local live view gets the same lemma tier as the site: the bundle
  // is served in-process at /seonix-nlp.js and the viewer lazy-loads it on first ask.
  const viewer = renderViewerHtml({ cytoscape, askEngine, nlpPath: nlpBundle ? "/seonix-nlp.js" : null });
  const browserPage = await renderBrowserHtml({ cytoscape });
  // nav = the routes this server itself serves; injected into every payload/page
  const nav = { home: "/", graph: "/seonix-graph.html", browser: "/code-browser.html", timeline: "/timeline.html" };
  const buildData = async () => {
    const { graph } = await loadGraph(values);
    const focus = resolveFocus(graph, values.focus);
    if (!focus) throw new Error(values.focus ? `no entity matching "${values.focus}"` : "graph has no entities");
    const subgraph = buildSubgraph(graph, {
      focusId: focus.id,
      depth: Math.max(1, parseInt(values.depth, 10) || 2),
      hubDegree: Math.max(2, parseInt(values.hub, 10) || 40),
      maxNodes: Math.max(2, parseInt(values.max, 10) || 200),
    });
    return buildViewerData(subgraph, { focusLabel: focus.label, repoUrl, repoRef: values.ref, nav });
  };
  // The chat panel's own channel — the FULL raw graph (not the depth-limited display
  // sub-graph above), rebuilt fresh per request so a re-index shows up without a
  // restart, same invariant as buildData().
  const buildAskData = async () => {
    const { raw } = await loadGraph(values);
    return raw;
  };
  const buildBrowserPayload = async () => {
    const config = loadConfig(values.graph ? { ...process.env, SEONIX_GRAPH_FILE: resolve(values.graph) } : process.env);
    const raw = await source.fetchEntities(config);
    const commitIds = (raw.individuals || []).filter((i) => i.class === "Commit").map((i) => i.id);
    const [order, parentsBySha] = await Promise.all([
      gitCommitOrder(process.cwd(), commitIds),
      gitCommitParents(process.cwd()), // P3 ghost-branch merges
    ]);
    const tg = buildTemporalGraph(raw, order, { scope: values.scope, parentsBySha });
    return buildBrowserData(tg, { repoUrl, repoRef: values.ref, live: true, gitHead: await gitHeadOf(process.cwd()), nav });
  };
  const buildTimelinePage = async () => {
    const { raw } = await loadGraph(values);
    return renderTimelineHtml({
      commits: extractTimeline(raw),
      repoUrl,
      repoRef: values.ref,
      generatedAt: raw.generated_at || "",
      nav,
    });
  };
  await buildData(); // fail fast (missing graph, bad focus) before binding the port
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/" || path === "/index.html" || path === "/seonix-graph.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(viewer);
    } else if (path === "/browser" || path === "/code-browser.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(browserPage);
    } else if (path === "/timeline" || path === "/timeline.html") {
      // rendered from a fresh graph load, same re-index-shows-on-refresh invariant
      try {
        const page = await buildTimelinePage();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page);
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(`failed to render the timeline: ${String(err.message || err)}`);
      }
    } else if (path === "/seonix-graph-data.json") {
      try {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(await buildData()));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      }
    } else if (path === "/seonix-ask-data.json") {
      try {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(await buildAskData()));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      }
    } else if (path === "/code-browser-data.json") {
      try {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(await buildBrowserPayload()));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      }
    } else if (path === "/code-browser-version") {
      // P3 live re-annotate: a CHEAP poll target (one git call, no graph rebuild)
      // so the client can notice HEAD moved without re-fetching the full payload
      // every few seconds.
      try {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ head: await gitHeadOf(process.cwd()) }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      }
    } else if (path === "/seonix-nlp.js" && nlpBundle) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(nlpBundle);
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}/`;
  log(`seonix viz: serving the code-map viewer on ${url} (code browser at ${url}code-browser.html; Ctrl-C to stop)\n`);
  return { server, url, port: server.address().port };
}

export async function runVizCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      focus: { type: "string" },
      depth: { type: "string", default: "2" },
      hub: { type: "string", default: "40" },
      max: { type: "string", default: "200" },
      out: { type: "string", default: "seon-graph.html" },
      "data-out": { type: "string" },
      graph: { type: "string" },
      "repo-url": { type: "string", default: "" },
      ref: { type: "string", default: "main" },
      "site-nav": { type: "boolean", default: false },
      serve: { type: "boolean", default: false },
      port: { type: "string", default: "0" },
      // Chronograph (code browser) + timeline artifacts — generated next to --out
      // by default; --graph-only suppresses both. See src/browser.mjs, src/timeline.mjs.
      "browser-out": { type: "string" },
      "browser-data-out": { type: "string" },
      "timeline-out": { type: "string" },
      "graph-only": { type: "boolean", default: false },
      scope: { type: "string", default: "product" },
      // Include the OPTIONAL wink-nlp lemma tier in the chat (see nlp-bundle.mjs).
      // Site mode (--data-out): written as a same-origin sibling the page lazy-loads.
      // Portable/serve mode: inlined (single-file) / served in-process. Off by default,
      // so the local single-file stays lean and lemma-off exactly as before.
      nlp: { type: "boolean", default: false },
      // Portable branch only: embed the full graph inline even past the size gate
      // (INLINE_ASKDATA_MAX_BYTES). Off by default — over-threshold graphs write
      // sidecars instead of an unopenable multi-hundred-MB single file.
      "force-inline": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const cytoscape = await cytoscapeSource();
  const askEngine = await askSource();
  // Build the wink lemma bundle once, only when --nlp asked for it (~4 MB; skip the
  // work entirely otherwise). Wired below as a sibling asset (site) or inline (portable).
  const nlpBundle = values.nlp ? await winkBrowserBundle() : null;
  if (values.serve) {
    await startVizServer({ values, cytoscape, askEngine, nlpBundle, log: (s) => process.stderr.write(s) });
    return; // keeps serving until Ctrl-C
  }
  const { config, graph, raw, graphBytes } = await loadGraph(values);
  const focus = resolveFocus(graph, values.focus);
  if (!focus) {
    process.stderr.write(values.focus
      ? `seonix viz: no entity matching "${values.focus}" in ${config.graphFile}\n`
      : `seonix viz: graph has no entities in ${config.graphFile}\n`);
    process.exit(1);
  }
  if (focus.defaulted) process.stderr.write(`seonix viz: no --focus given — defaulting to "${focus.label}" (highest-degree module)\n`);
  const subgraph = buildSubgraph(graph, {
    focusId: focus.id,
    depth: Math.max(1, parseInt(values.depth, 10) || 2),
    hubDegree: Math.max(2, parseInt(values.hub, 10) || 40),
    maxNodes: Math.max(2, parseInt(values.max, 10) || 200),
  });
  const out = resolve(values.out);
  // Siblings by default: the code browser and the commit timeline land next to
  // --out unless --graph-only. Nav hrefs are computed from the ACTUAL output
  // paths (filenames vary: seon-graph.html locally, seonix-graph.html on site);
  // --site-nav additionally adds the site's absolute home entry.
  const browserOut = values["graph-only"] ? null : resolve(values["browser-out"] || join(dirname(out), "code-browser.html"));
  const timelineOut = values["graph-only"] ? null : resolve(values["timeline-out"] || join(dirname(out), "timeline.html"));
  const relHref = (from, to) => {
    const r = relative(dirname(from), to);
    return r.startsWith(".") ? r : `./${r}`;
  };
  const navFor = (from) => ({
    ...(values["site-nav"] ? { home: "/" } : {}),
    graph: relHref(from, out),
    browser: relHref(from, browserOut),
    timeline: relHref(from, timelineOut),
  });
  const data = buildViewerData(subgraph, {
    focusLabel: focus.label,
    repoUrl: values["repo-url"],
    repoRef: values.ref,
    siteNav: values["site-nav"],
    nav: values["graph-only"] ? null : navFor(out),
  });
  // Split viewer: the page + its two sibling data files (display graph + full ask
  // graph), the page pointing at them rather than embedding. Shared by --data-out
  // (site build) and the portable large-graph gate below so the sidecar layout can
  // never drift between them. `dataOut` is the display-graph sidecar path; the ask
  // sidecar is always seonix-ask-data.json next to --out. Returns the resolved paths.
  const writeSplitViewer = async (dataOut) => {
    const rel = relative(dirname(out), dataOut) || "seonix-graph-data.json";
    const askDataOut = resolve(dirname(out), "seonix-ask-data.json");
    const askRel = relative(dirname(out), askDataOut) || "seonix-ask-data.json";
    // The wink lemma bundle rides the same sibling-asset convention as the data
    // files — a same-origin ./seonix-nlp.js the page lazy-loads on first ask.
    let nlpPath = null;
    if (nlpBundle) {
      const nlpOut = resolve(dirname(out), "seonix-nlp.js");
      await writeFile(nlpOut, nlpBundle);
      nlpPath = "./seonix-nlp.js";
    }
    await Promise.all([writeFile(dataOut, JSON.stringify(data)), writeFile(askDataOut, JSON.stringify(raw))]);
    await writeFile(out, renderViewerHtml({
      cytoscape, askEngine,
      dataPath: rel === "seonix-graph-data.json" ? null : rel,
      askDataPath: askRel === "seonix-ask-data.json" ? null : askRel,
      nlpPath,
    }));
    return { dataOut, askDataOut, nlpPath };
  };
  if (values["data-out"]) {
    // site mode: viewer page + sibling data file (data updates don't touch the page).
    // The chat panel's full-graph channel rides the same sibling-file convention,
    // written next to the display data file rather than embedded in the page.
    const { dataOut, askDataOut, nlpPath } = await writeSplitViewer(resolve(values["data-out"]));
    process.stderr.write(
      `seonix viz: ${subgraph.nodes.length} nodes, ${subgraph.edges.length} edges around "${focus.label}" ` +
        `(depth ${values.depth})${subgraph.truncated ? " [capped]" : ""} → ${out} + ${dataOut} + ${askDataOut}` +
        `${nlpPath ? ` + ${resolve(dirname(out), "seonix-nlp.js")} (wink lemma tier)` : ""}\n`,
    );
  } else if (graphBytes > inlineAskDataMaxBytes() && !values["force-inline"]) {
    // portable mode, but the graph is too big to embed: an estate-scale full-graph
    // inlined as a single file produces an unopenable multi-hundred-MB HTML. Write
    // the same sidecars as the site build (next to --out) and point the page at
    // them. file:// pages can't fetch siblings, so this needs `viz --serve`;
    // --force-inline overrides and embeds anyway.
    const { dataOut, askDataOut } = await writeSplitViewer(resolve(dirname(out), "seonix-graph-data.json"));
    const mb = Math.round(graphBytes / (1024 * 1024));
    process.stderr.write(
      `seonix viz: large graph (${mb} MB > 32 MB) — data written as sidecars next to ${out}; ` +
        "file:// pages cannot fetch siblings, open via `seonix viz --serve` (or pass --force-inline to embed anyway)\n",
    );
    process.stderr.write(
      `seonix viz: ${subgraph.nodes.length} nodes, ${subgraph.edges.length} edges around "${focus.label}" ` +
        `(depth ${values.depth})${subgraph.truncated ? " [capped]" : ""} → ${out} + ${dataOut} + ${askDataOut}\n`,
    );
  } else {
    // portable mode: one self-contained file, both channels embedded (+ inline wink
    // bundle when --nlp; otherwise lemma-off, no external fetch, exactly as before)
    await writeFile(out, renderViewerHtml({ cytoscape, askEngine, embedData: data, askData: raw, nlpInline: nlpBundle }));
    process.stderr.write(
      `seonix viz: ${subgraph.nodes.length} nodes, ${subgraph.edges.length} edges around "${focus.label}" ` +
        `(depth ${values.depth})${subgraph.truncated ? " [capped]" : ""} → ${out}\n`,
    );
  }

  // Sibling artifacts (code browser + commit timeline) — best-effort: a missing
  // git history (or any other failure here) warns but never kills the graph
  // artifact already written above.
  if (browserOut || timelineOut) {
    try {
      const repoUrl = values["repo-url"] || (await repoUrlFromGit(process.cwd()));
      if (browserOut) {
        const commitIds = (raw.individuals || []).filter((i) => i.class === "Commit").map((i) => i.id);
        const [order, parentsBySha] = await Promise.all([
          gitCommitOrder(process.cwd(), commitIds),
          gitCommitParents(process.cwd()), // P3 ghost-branch merges — static data, no polling here
        ]);
        const tg = buildTemporalGraph(raw, order, { scope: values.scope, parentsBySha });
        const browserData = buildBrowserData(tg, {
          repoUrl,
          repoRef: values.ref,
          siteNav: values["site-nav"],
          nav: navFor(browserOut),
        });
        if (values["browser-data-out"]) {
          const bDataOut = resolve(values["browser-data-out"]);
          const rel = relative(dirname(browserOut), bDataOut) || "code-browser-data.json";
          await writeFile(bDataOut, JSON.stringify(browserData));
          await writeFile(browserOut, await renderBrowserHtml({ cytoscape, dataPath: rel === "code-browser-data.json" ? null : rel }));
          process.stderr.write(
            `seonix viz: chronograph ${tg.nodes.length} nodes, ${tg.edges.length} edges, ${tg.commits.length} commits ` +
              `(scope ${values.scope}) → ${browserOut} + ${bDataOut}\n`,
          );
        } else {
          await writeFile(browserOut, await renderBrowserHtml({ cytoscape, embedData: browserData }));
          process.stderr.write(
            `seonix viz: chronograph ${tg.nodes.length} nodes, ${tg.edges.length} edges, ${tg.commits.length} commits ` +
              `(scope ${values.scope}) → ${browserOut}\n`,
          );
        }
      }
      if (timelineOut) {
        const commits = extractTimeline(raw);
        await writeFile(timelineOut, renderTimelineHtml({
          commits,
          repoUrl,
          repoRef: values.ref,
          generatedAt: raw.generated_at || "",
          nav: navFor(timelineOut),
        }));
        process.stderr.write(`seonix viz: timeline ${commits.length} commits → ${timelineOut}\n`);
      }
    } catch (err) {
      process.stderr.write(`seonix viz: warning — sibling pages (browser/timeline) failed: ${String(err.message || err)}; the graph artifact is intact\n`);
    }
  }
}
