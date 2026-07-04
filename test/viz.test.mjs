// viz tests — pure ego-network + hub-strip logic, the viewer-data contract, the
// single shared viewer page, and the `--serve` HTTP handler. No browser needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../src/codegraph.mjs";
import {
  buildSubgraph,
  buildViewerData,
  cytoscapeSource,
  defaultFocus,
  renderHtml,
  renderViewerHtml,
  runVizCli,
  startVizServer,
} from "../src/viz.mjs";

const fixturePath = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const graph = parseEntities(fixture);

test("buildSubgraph: depth-1 ego-network around a class includes its typed neighbours", () => {
  const sg = buildSubgraph(graph, { focusId: "cls-widget", depth: 1 });
  const ids = new Set(sg.nodes.map((n) => n.id));
  assert.ok(ids.has("cls-widget"));
  // contains → members, inherits both directions, defines ← module
  for (const id of ["m-render", "a-name", "cls-base", "cls-button", "mod-b"]) assert.ok(ids.has(id), id);
  assert.equal(sg.nodes.find((n) => n.id === "cls-widget").depth, 0);
  assert.equal(sg.nodes.find((n) => n.id === "m-render").depth, 1);
  // edges only between included nodes; each carries a relation label
  assert.ok(sg.edges.every((e) => ids.has(e.source) && ids.has(e.target) && e.rel));
  assert.ok(sg.edges.some((e) => e.rel === "contains"));
});

test("buildSubgraph: maxNodes caps growth and flags truncation", () => {
  const sg = buildSubgraph(graph, { focusId: "mod-a", depth: 9, maxNodes: 3 });
  assert.ok(sg.nodes.length <= 3);
  assert.equal(sg.truncated, true);
});

test("buildSubgraph: hubDegree stops expansion THROUGH hubs (hub still shown)", () => {
  // mod-a is a hub (imported by b/c/e, defines fnAlpha, called by g). From mod-b at
  // depth 2 with hubDegree 1, mod-a is included (depth 1) but we don't expand through it.
  const sg = buildSubgraph(graph, { focusId: "mod-b", depth: 2, hubDegree: 1 });
  const byId = new Map(sg.nodes.map((n) => [n.id, n]));
  assert.ok(byId.has("mod-a"));
  // fn-alpha is only reachable by expanding through the hub mod-a → must be absent
  assert.ok(!byId.has("fn-alpha"));
});

test("buildSubgraph: unknown focus → empty", () => {
  const sg = buildSubgraph(graph, { focusId: "nope", depth: 2 });
  assert.deepEqual(sg.nodes, []);
  assert.deepEqual(sg.edges, []);
});

test("defaultFocus: highest-degree module wins — `viz --serve` needs no --focus", () => {
  const best = defaultFocus(graph);
  assert.equal(best.id, "mod-a"); // the fixture's hub module
  assert.ok(best.label);
});

test("buildViewerData: the runtime payload carries everything repo-specific", () => {
  const sg = buildSubgraph(graph, { focusId: "cls-widget", depth: 1 });
  const data = buildViewerData(sg, { focusLabel: "Widget", repoUrl: "https://gitlab.com/acme/proj/", repoRef: "dev", siteNav: true });
  assert.equal(data.focusId, "cls-widget");
  assert.equal(data.focusLabel, "Widget");
  assert.equal(data.repoUrl, "https://gitlab.com/acme/proj"); // trailing slash stripped
  assert.equal(data.repoRef, "dev");
  assert.equal(data.siteNav, true);
  assert.equal(data.maxDepth, 1);
  assert.equal(data.truncated, false);
  // plain nodes/edges — the viewer wraps them for cytoscape and assigns colors at boot
  assert.ok(data.nodes.every((n) => "id" in n && "cls" in n && "depth" in n && "degree" in n && !("color" in n)));
  assert.ok(data.edges.every((e) => "source" in e && "target" in e && "rel" in e));
  // defaults: no repo link base, no site nav (generic artifact)
  const bare = buildViewerData(sg, { focusLabel: "Widget" });
  assert.equal(bare.repoUrl, "");
  assert.equal(bare.siteNav, false);
});

test("renderViewerHtml: repo-agnostic page — no data baked in, fetches the sibling JSON", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /<title>seon code-map<\/title>/); // focus label arrives with the data
  assert.match(html, /\.\/seonix-graph-data\.json/); // default data URL
  assert.match(html, /URLSearchParams\(location\.search\)\.get\('data'\)/); // ?data= override
  assert.doesNotMatch(html, /id="seonix-data"/); // nothing embedded
  assert.match(html, /\/\*CY\*\//); // the (stub) cytoscape source is inlined
});

test("renderViewerHtml: embedData → portable single file; dataPath → generated pointer", () => {
  const sg = buildSubgraph(graph, { focusId: "cls-widget", depth: 1 });
  const data = buildViewerData(sg, { focusLabel: "Widget" });
  const emb = renderViewerHtml({ cytoscape: "/*CY*/", embedData: data });
  assert.match(emb, /<script type="application\/json" id="seonix-data">/);
  assert.match(emb, /"focusId":"cls-widget"/);
  assert.doesNotMatch(emb, /<script type="application\/json" id="seonix-data">[^]*<\/script><script>[^]*<\/script[^>]*>[^]*<\/script>\s*<\/head>/); // sanity: structure intact
  // '<' is escaped inside the JSON block so labels can never break out of the script tag
  const evil = buildViewerData({ ...sg, nodes: [{ ...sg.nodes[0], label: "</script><b>x" }] }, { focusLabel: "W" });
  assert.doesNotMatch(renderViewerHtml({ cytoscape: "/*CY*/", embedData: evil }), /<\/script><b>x/);
  const cfg = renderViewerHtml({ cytoscape: "/*CY*/", dataPath: "custom-data.json" });
  assert.match(cfg, /<script type="application\/json" id="seonix-cfg">\{"data":"custom-data\.json"\}<\/script>/);
});

test("chat panel: markup + inlined ask engine present, honest when the engine is omitted", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /id="askq"/);
  assert.match(html, /id="asksubmit"/);
  assert.match(html, /id="askresult"/);
  assert.match(html, /typeof ask!=='function'/); // honest miss when no engine was inlined
  assert.doesNotMatch(html, /id="seonix-ask-data"/); // nothing embedded by default
});

test("chat panel: askEngine is inlined verbatim as its own <script> block", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/", askEngine: "function ask(){return 42;}" });
  assert.match(html, /<script>function ask\(\)\{return 42;\}<\/script>/);
});

test("chat panel: askData embeds; askDataPath generates a config pointer alongside the display one", () => {
  const emb = renderViewerHtml({ cytoscape: "/*CY*/", askData: { individuals: [], objectProperties: [] } });
  assert.match(emb, /<script type="application\/json" id="seonix-ask-data">/);
  const cfg = renderViewerHtml({ cytoscape: "/*CY*/", dataPath: "d.json", askDataPath: "a.json" });
  assert.match(cfg, /"data":"d\.json"/);
  assert.match(cfg, /"ask":"a\.json"/);
});

test("chat panel: lazy-loads the full graph (never fetched at page boot, only on first ask)", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /function loadAskData\(/);
  assert.match(html, /\.\/seonix-ask-data\.json/); // default sibling, mirrors loadData()'s convention
  // loadData() (the display graph) is invoked eagerly at the bottom of the script;
  // loadAskData() must NOT be called anywhere outside runAsk's lazy call site.
  const eager = html.match(/loadData\(\)\.then\(init\)/);
  assert.ok(eager, "the display graph still loads eagerly");
});

test("chat panel: highlighting reuses the existing white selection ring, dims non-matches, and is honest about matches outside the loaded view", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /function highlightAsk\(/);
  assert.match(html, /eles\.addClass\('sel'\)/); // same visual language as a manual node selection
  assert.match(html, /cy\.elements\(\)\.not\(eles\)\.addClass\('faded'\)/);
  assert.match(html, /outside the currently loaded view/); // stated plainly, never a silent gap
});

test("chat panel: the selected node is threaded as pronoun context (\"this\"/\"it\"), plus the optional nlp adapter", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /ask\(askGraph,query,\{contextId:selId,nlp\}\)/);
});

test("viewer layout: chat + node-detail sit BELOW the graph in a full-width #below row, not a right side column", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  // #cy on top, #below beneath it inside #main; #ask (chat) and #detail (inspect)
  // are the two panes of #below — the old fixed right-hand #side column is gone.
  assert.match(html, /<div id="main">\s*<div id="cy"><\/div>\s*<div id="below">/);
  assert.match(html, /<div id="below">\s*<div id="ask">/);
  assert.match(html, /<div id="ask">[\s\S]*<\/div>\s*<div id="detail"><\/div>\s*<\/div>/);
  assert.doesNotMatch(html, /id="side"/);
  // #main is a vertical stack; #cy is a flex child (not absolutely positioned into a
  // right-inset box); #below caps its height and stacks on narrow screens.
  assert.match(html, /#main\{flex:1 1 auto;display:flex;flex-direction:column/);
  assert.match(html, /#cy\{flex:1 1 auto;position:relative/);
  assert.doesNotMatch(html, /#cy\{position:absolute;top:0;left:0;right:300px/);
  assert.match(html, /#below\{flex:0 0 auto;display:flex/);
  assert.match(html, /@media\(max-width:720px\)\{#below\{flex-direction:column/);
  // the chat still has its input + button + result, and node-detail is still usable
  for (const id of ["askq", "asksubmit", "askresult", "detail"]) assert.match(html, new RegExp(`id="${id}"`), id);
});

test("chat panel: the OPTIONAL wink lemma adapter — default has none (no fetch), inline embeds it, site build points at a same-origin sibling", () => {
  // default local single-file: no adapter, no fetch, no cfg pointer — the
  // no-external-fetch guarantee is intact, exactly as before.
  const bare = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(bare, /function loadNlp\(/); // the hook is always present
  assert.match(bare, /window\.__seonixNlp/);
  assert.doesNotMatch(bare, /"nlp":/); // no cfg pointer → loadNlp resolves undefined, fetches nothing
  assert.doesNotMatch(bare, /seonix-nlp\.js/);
  // inline mode: the bundle rides its own <script> so it registers at load
  const inline = renderViewerHtml({ cytoscape: "/*CY*/", nlpInline: "window.__seonixNlp={lemma:function(w){return w;}};" });
  assert.match(inline, /<script>window\.__seonixNlp=\{lemma:function\(w\)\{return w;\}\};<\/script>/);
  // site mode: a same-origin sibling asset the page lazy-loads (cfg "nlp" pointer)
  const site = renderViewerHtml({ cytoscape: "/*CY*/", nlpPath: "./seonix-nlp.js" });
  assert.match(site, /id="seonix-cfg">[^<]*"nlp":"\.\/seonix-nlp\.js"/);
  // lazy, not eager: loadNlp only runs from runAsk (never at page boot)
  assert.match(site, /Promise\.all\(\[loadAskData\(\),loadNlp\(\)\]\)/);
});

test("renderHtml (compat): self-contained artifact = shared viewer + embedded data", () => {
  const sg = buildSubgraph(graph, { focusId: "cls-widget", depth: 1 });
  const html = renderHtml({ subgraph: sg, focusLabel: "Widget", cytoscape: "/*CY*/" });
  assert.match(html, /id="seonix-data"/);
  assert.match(html, /"focusId":"cls-widget"/);
  assert.match(html, /"focusLabel":"Widget"/);
  assert.match(html, /cytoscape\(\{container/);
});

test("viewer: default filter thresholds — depth stepper clamped to the data's max depth, hub toggle at deg>16", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  // depth is a − [N] + stepper: clamp 1..max(1, G.maxDepth) — a maxDepth-1 graph
  // must NOT grow a dead depth-2 button (the old segmented control's bug)
  assert.match(html, /id="depthdown"/);
  assert.match(html, /id="depthval"/);
  assert.match(html, /id="depthup"/);
  assert.match(html, /Math\.max\(1,G\.maxDepth\)/);
  assert.doesNotMatch(html, /Math\.max\(2,G\.maxDepth\)/);
  assert.doesNotMatch(html, /id="depthseg"/);
  assert.match(html, /Math\.min\(2,maxDepth\)/); // initial depth
  assert.match(html, /\$\('depthdown'\)\.disabled=depthVal<=1/); // − dead at the floor
  assert.match(html, /\$\('depthup'\)\.disabled=depthVal>=maxDepth/); // + dead at the data's edge
  assert.match(html, /captured to depth '\+maxDepth\+' — regenerate with --depth for more/);
  // hub filter is a checked toggle with an editable threshold, default 16
  assert.match(html, /id="hubon" checked/);
  assert.match(html, /id="hub" type="number"[^>]*value="16"/);
});

test("viewer: beam control — a degree-scored analogue of the ask engine's beam search, honest about not being the same scorer", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /id="beamon"/); // off by default (no `checked`)
  assert.doesNotMatch(html, /id="beamon" checked/);
  assert.match(html, /id="beam" type="number" min="1" max="32" value="8"/);
  assert.match(html, /NOT the same scorer/); // the title says so plainly
  // margin+cap prune over the loaded adjacency, mirroring BEAM_MARGIN_FRAC=0.5
  assert.match(html, /function beamSet\(/);
  assert.match(html, /degree>=best\*0\.5/);
  assert.match(html, /\.slice\(0,width\)/);
  // both inputs re-filter live
  assert.match(html, /\$\('beamon'\)\.addEventListener\('change',applyFilters\)/);
  assert.match(html, /\$\('beam'\)\.addEventListener\('input',applyFilters\)/);
});

test("viewer: legend chips per type GROUP — Function/Method merged (legend-only), counts summed across the group", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  // node fills stay distinct: every type keeps its own colour in the COLORS map
  for (const cls of ["Module", "Class", "Function", "Method", "Attribute", "GlobalVariable", "Commit"]) {
    assert.match(html, new RegExp(`${cls}:'#[0-9a-f]{6}'`), cls);
  }
  // the chip build is GROUPS-driven: Function+Method share one chip, the rest are singular
  assert.match(html, /GROUPS=\[\['Module'\],\['Class'\],\['Function','Method'\],\['Attribute'\],\['GlobalVariable'\],\['Commit'\]\]/);
  assert.match(html, /data-cls="'\+g\.join\(','\)\+'" checked/); // e.g. data-cls="Function,Method"
  assert.match(html, /g\.map\(k=>'<i style="background:'\+COLORS\[k\]\+'"><\/i>'\)\.join\(''\)/); // one swatch per class in the group
  assert.match(html, /'\+g\.join\('\/'\)\+'/); // chip label joins names with '/'
  // enabledTypes splits the comma-joined group back into individual classes
  assert.match(html, /c\.dataset\.cls\.split\(','\)\.forEach\(t=>on\.add\(t\)\)/);
  // the filter pass tallies visible + loaded per class, then SUMS across the group per chip
  assert.match(html, /vis\[cls\]=\(vis\[cls\]\|\|0\)\+1/);
  assert.match(html, /const ks=s\.dataset\.cnt\.split\(','\)/);
  assert.match(html, /ks\.reduce\(\(a,k\)=>a\+\(vis\[k\]\|\|0\),0\)/);
  assert.match(html, /const cls=n\.data\('cls'\)/);
  assert.match(html, /types\.has\(cls\)/);
  assert.match(html, /querySelectorAll\('\.typechk'\)[\s\S]*addEventListener\('change',applyFilters\)/);
});

test("viewer: GitLab deep links ride the DATA's repoUrl (commits, sites, modules)", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /if\(!G\.repoUrl\) return null/); // no repoUrl → no dead links
  assert.match(html, /\/-\/commit\/'\+d\.id\.slice\(7\)/); // Commit → /-/commit/<full sha>
  assert.match(html, /\/-\/blob\/'\+G\.repoRef\+'\//); // site/module → /-/blob/<ref>/<path>
  assert.match(html, /open in GitLab/);
});

test("viewer: labels outlined, edge labels hover-only, viewport fitted on load", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /'text-outline-color':'#000'/); // readable over fills + dark canvas
  // the base edge style paints no label; the rel only appears on hover/tap
  assert.match(html, /selector:'edge\.showrel',style:\{'label':'data\(rel\)'/);
  assert.match(html, /mouseover','edge'/);
  assert.match(html, /cy\.fit\(undefined,30\)/); // land fitted, not zoomed into label soup
});

test("viewer: view controls — fit, zoom, and a REAL reset; panning is drag, not buttons", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  for (const id of ["fit", "zoomin", "zoomout", "reset"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // fit stays a plain viewport fit…
  assert.match(html, /\$\('fit'\)\.addEventListener\('click',\(\)=>\{cy\.fit\(undefined,30\);\}\)/);
  // …while reset restores the boot view: cached focus, depths from depth0, defaults
  assert.match(html, /const INITIAL_FOCUS=G\.focusId/);
  assert.match(html, /depth0:n\.depth/); // boot depth cached before any recentre mutates data('depth')
  assert.match(html, /n\.data\('depth',n\.data\('depth0'\)\)/);
  assert.match(html, /G\.focusId=INITIAL_FOCUS/);
  assert.match(html, /\$\('beamon'\)\.checked=false/); // reset covers the beam control too
  // the four directional pan buttons are gone — drag pans natively
  assert.doesNotMatch(html, /id="panleft"/);
  assert.doesNotMatch(html, /cy\.panBy\(/);
  assert.match(html, /cy\.zoom\(\{level/); // zoom buttons
  assert.match(html, /key==='Escape'/); // Esc clears selection and fits
});

test("viewer: smart labels by default — a budget, not label soup", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /<option value="smart">smart<\/option>/); // first = default
  assert.match(html, /LABEL_BUDGET=20/); // top visible nodes by degree get labels
  assert.match(html, /'label':''/); // base style paints no label; applyLabels decides
  assert.match(html, /mouseover','node'/); // hovering labels a node in smart mode
});

test("viewer: selection dims non-neighbours; dbltap re-centres within the loaded sub-graph", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /addClass\('faded'\)/);
  assert.match(html, /closedNeighborhood/);
  assert.match(html, /dbltap','node'/);
  assert.match(html, /function recentre\(/);
  assert.match(html, /re-centre here/); // panel button mirrors the gesture
});

test("viewer: degree-sized nodes and a white (type-neutral) focus/selection ring", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /mapData\(degree,1,40,16,34\)/); // hubs read as hubs, bounded
  assert.match(html, /node\.focus',style:\{[^}]*'border-color':'#fff'/);
  assert.match(html, /node\.sel',style:\{[^}]*'border-color':'#fff'/);
  // the CVD-validated palette is in force (Method magenta), the old near-identical
  // green pair is gone
  assert.match(html, /#d55181/);
  assert.doesNotMatch(html, /#9ece6a/);
});

test("viewer: site nav is data-driven — rebuilt from G.nav, legacy G.siteNav fallback intact", () => {
  const html = renderViewerHtml({ cytoscape: "/*CY*/" });
  assert.match(html, /id="sitenav" hidden/); // present but inert in every artifact
  // nav rides the data payload: anchors rebuilt from {name: href} entries…
  assert.match(html, /if\(G\.nav\)\{\$\('sitenav'\)\.innerHTML=Object\.entries\(G\.nav\)/);
  // …and stale deployed data (siteNav flag only) keeps the legacy absolute links
  assert.match(html, /else if\(G\.siteNav\)\$\('sitenav'\)\.hidden=false/);
  assert.match(html, /<a href="\/">home<\/a><a href="\/code-browser\.html">browser<\/a><a href="\/timeline\.html">timeline<\/a>/);
  const sg = buildSubgraph(graph, { focusId: "cls-widget", depth: 1 });
  assert.match(renderHtml({ subgraph: sg, focusLabel: "W", cytoscape: "/*CY*/", siteNav: true }), /"siteNav":true/);
  assert.match(renderHtml({ subgraph: sg, focusLabel: "W", cytoscape: "/*CY*/" }), /"siteNav":false/);
});

test("buildViewerData: optional nav rides the payload; omitted → absent (old payloads byte-stable)", () => {
  const sg = buildSubgraph(graph, { focusId: "cls-widget", depth: 1 });
  const nav = { graph: "./seon-graph.html", browser: "./code-browser.html", timeline: "./timeline.html" };
  assert.deepEqual(buildViewerData(sg, { focusLabel: "W", nav }).nav, nav);
  assert.ok(!("nav" in buildViewerData(sg, { focusLabel: "W" })));
});

test("code browser page: inlines the node-tested temporal core, no data baked in", async () => {
  const { renderBrowserHtml } = await import("../src/browser.mjs");
  const html = await renderBrowserHtml({ cytoscape: "/*CY*/" });
  // the page's diff/narration/query/URL logic IS src/temporal.mjs, inlined
  for (const fn of ["structuralDiff", "narrateCommit", "narrateRange", "matchQuery", "resolveCursor", "encodeViewState", "decodeViewState"]) {
    assert.match(html, new RegExp(`function ${fn}\\(`), fn);
  }
  assert.doesNotMatch(html, /^export /m); // exports stripped for inline use
  assert.match(html, /\.\/code-browser-data\.json/); // default sibling data URL
  assert.doesNotMatch(html, /id="seonix-data"/); // nothing embedded by default
  assert.match(html, /history\.replaceState/); // query-as-URL: the view is the link
  assert.match(html, /id="cmp"/); // two-cursor compare toggle
  assert.match(html, /diff-added/); // diff status classes ride borders
  assert.match(html, /id="narr"/); // the narration panel
  assert.match(html, /'text-outline-color':'#000'/); // designer conventions carried over
});

test("code browser page: embedData → portable single file; dataPath → pointer", async () => {
  const { renderBrowserHtml, buildTemporalGraph, buildBrowserData } = await import("../src/browser.mjs");
  const tg = buildTemporalGraph({ individuals: [], objectProperties: [] }, []);
  const data = buildBrowserData(tg, { repoUrl: "https://gitlab.example/a/b" });
  const emb = await renderBrowserHtml({ cytoscape: "/*CY*/", embedData: data });
  assert.match(emb, /<script type="application\/json" id="seonix-data">/);
  const cfg = await renderBrowserHtml({ cytoscape: "/*CY*/", dataPath: "custom.json" });
  assert.match(cfg, /id="seonix-cfg">\{"data":"custom\.json"\}/);
});

test("viz --serve: one viewer + live data from the local index over HTTP", async () => {
  const values = {
    focus: undefined, // exercises the defaultFocus fallback
    depth: "2", hub: "40", max: "200",
    graph: fixturePath,
    "repo-url": "https://gitlab.example/acme/proj",
    ref: "main",
    port: "0",
  };
  const { server, url } = await startVizServer({ values, cytoscape: "/*CY*/" });
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    const html = await page.text();
    assert.match(html, /seonix-graph-data\.json/); // the served page fetches, nothing embedded
    assert.doesNotMatch(html, /id="seonix-data"/);
    const dataRes = await fetch(new URL("/seonix-graph-data.json", url));
    assert.equal(dataRes.status, 200);
    const data = await dataRes.json();
    assert.equal(data.focusId, "mod-a"); // defaultFocus picked the hub module
    assert.equal(data.repoUrl, "https://gitlab.example/acme/proj");
    assert.ok(data.nodes.length > 0 && data.edges.length > 0);
    // nav rides the served payload: home + the routes this server itself serves
    assert.deepEqual(data.nav, { home: "/", graph: "/seonix-graph.html", browser: "/code-browser.html", timeline: "/timeline.html" });
    const missing = await fetch(new URL("/nope", url));
    assert.equal(missing.status, 404);
    // the Chronograph code browser rides along: same server, live temporal payload
    const bPage = await fetch(new URL("/code-browser.html", url));
    assert.equal(bPage.status, 200);
    assert.match(await bPage.text(), /seon chronograph/);
    const bAlias = await fetch(new URL("/browser", url));
    assert.equal(bAlias.status, 200);
    const bData = await fetch(new URL("/code-browser-data.json", url));
    assert.equal(bData.status, 200);
    const tg = await bData.json();
    assert.ok(Array.isArray(tg.commits) && Array.isArray(tg.nodes) && Array.isArray(tg.edges));
    assert.equal(tg.repoUrl, "https://gitlab.example/acme/proj");
    assert.deepEqual(tg.nav, { home: "/", graph: "/seonix-graph.html", browser: "/code-browser.html", timeline: "/timeline.html" });
    // the commit timeline rides along too, rendered from a fresh graph load
    const tlPage = await fetch(new URL("/timeline.html", url));
    assert.equal(tlPage.status, 200);
    const tlHtml = await tlPage.text();
    assert.match(tlHtml, /commit timeline/);
    assert.match(tlHtml, /1 commits/); // the fixture's single commit
    assert.match(tlHtml, /<a href="\/code-browser\.html">browser<\/a>/); // nav from the server's routes
    const tlAlias = await fetch(new URL("/timeline", url));
    assert.equal(tlAlias.status, 200);
    // the chat panel's own channel: the FULL raw graph.json payload, not the
    // depth-limited display sub-graph served above at /seonix-graph-data.json
    const askRes = await fetch(new URL("/seonix-ask-data.json", url));
    assert.equal(askRes.status, 200);
    const raw = await askRes.json();
    assert.ok(Array.isArray(raw.individuals) && Array.isArray(raw.objectProperties));
    assert.ok(raw.individuals.length > data.nodes.length, "the full graph carries more than the depth-limited view");
  } finally {
    server.close();
  }
});

test("runVizCli: siblings by default — graph + code browser + timeline land next to --out, nav hrefs relative to the ACTUAL filenames", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "seonix-viz-cli-"));
  try {
    await runVizCli(["--graph", fixturePath, "--out", join(tmp, "seon-graph.html")]);
    for (const f of ["seon-graph.html", "code-browser.html", "timeline.html"]) {
      assert.ok(existsSync(join(tmp, f)), `${f} generated`);
    }
    const html = readFileSync(join(tmp, "seon-graph.html"), "utf8");
    // local output: graph/browser/timeline entries, ./-relative, no home entry
    assert.match(html, /"nav":\{"graph":"\.\/seon-graph\.html","browser":"\.\/code-browser\.html","timeline":"\.\/timeline\.html"\}/);
    const tl = readFileSync(join(tmp, "timeline.html"), "utf8");
    assert.match(tl, /<a href="\.\/seon-graph\.html">graph<\/a>/);
    assert.match(tl, /<a href="\.\/code-browser\.html">browser<\/a>/);
    assert.doesNotMatch(tl, /<a href="\/">/); // no home entry without --site-nav
    const br = readFileSync(join(tmp, "code-browser.html"), "utf8");
    assert.match(br, /"nav":\{"graph":"\.\/seon-graph\.html"/); // embedded browser payload carries nav too
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("runVizCli: --graph-only yields only the graph artifact, no nav payload", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "seonix-viz-cli-go-"));
  try {
    await runVizCli(["--graph", fixturePath, "--out", join(tmp, "seon-graph.html"), "--graph-only"]);
    assert.deepEqual(await readdir(tmp), ["seon-graph.html"]);
    assert.doesNotMatch(readFileSync(join(tmp, "seon-graph.html"), "utf8"), /"nav":\{/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---- portable large-graph gate (A2): the single-file --out branch stops
// embedding the full raw graph once it grows past a size threshold, writing
// sidecars instead of an unopenable multi-hundred-MB HTML. --force-inline and
// small graphs keep the byte-identical inline behaviour. ------------------------

function captureStderr() {
  const orig = process.stderr.write.bind(process.stderr);
  let buf = "";
  process.stderr.write = (s) => { buf += s; return true; };
  return { get: () => buf, restore: () => { process.stderr.write = orig; } };
}

test("runVizCli portable gate: small graph stays inline (ask-data embedded, no sidecars)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "seonix-viz-gate-small-"));
  const cap = captureStderr();
  try {
    await runVizCli(["--graph", fixturePath, "--out", join(tmp, "seon-graph.html"), "--graph-only"]);
    const html = readFileSync(join(tmp, "seon-graph.html"), "utf8");
    assert.match(html, /id="seonix-ask-data"/); // full graph embedded inline
    assert.ok(!existsSync(join(tmp, "seonix-ask-data.json")), "no ask sidecar for a small graph");
    assert.ok(!existsSync(join(tmp, "seonix-graph-data.json")), "no display sidecar for a small graph");
  } finally {
    cap.restore();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("runVizCli portable gate: over-threshold graph writes sidecars, drops inline ask-data, warns to use --serve", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "seonix-viz-gate-big-"));
  const cap = captureStderr();
  const prev = process.env.SEONIX_VIZ_INLINE_MAX;
  process.env.SEONIX_VIZ_INLINE_MAX = "10"; // fixture (~8 KB) blows past this → gate fires
  try {
    await runVizCli(["--graph", fixturePath, "--out", join(tmp, "seon-graph.html"), "--graph-only"]);
    const html = readFileSync(join(tmp, "seon-graph.html"), "utf8");
    assert.doesNotMatch(html, /id="seonix-ask-data"/); // NOT embedded — page points at the sidecar
    assert.ok(existsSync(join(tmp, "seonix-ask-data.json")), "ask sidecar written next to --out");
    assert.ok(existsSync(join(tmp, "seonix-graph-data.json")), "display sidecar written next to --out");
    assert.match(cap.get(), /large graph .*--serve/);
  } finally {
    if (prev === undefined) delete process.env.SEONIX_VIZ_INLINE_MAX;
    else process.env.SEONIX_VIZ_INLINE_MAX = prev;
    cap.restore();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("runVizCli portable gate: --force-inline embeds anyway even past the threshold", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "seonix-viz-gate-force-"));
  const cap = captureStderr();
  const prev = process.env.SEONIX_VIZ_INLINE_MAX;
  process.env.SEONIX_VIZ_INLINE_MAX = "10";
  try {
    await runVizCli(["--graph", fixturePath, "--out", join(tmp, "seon-graph.html"), "--graph-only", "--force-inline"]);
    const html = readFileSync(join(tmp, "seon-graph.html"), "utf8");
    assert.match(html, /id="seonix-ask-data"/); // inline restored by --force-inline
    assert.ok(!existsSync(join(tmp, "seonix-ask-data.json")), "no sidecar when forced inline");
    assert.ok(!existsSync(join(tmp, "seonix-graph-data.json")), "no sidecar when forced inline");
  } finally {
    if (prev === undefined) delete process.env.SEONIX_VIZ_INLINE_MAX;
    else process.env.SEONIX_VIZ_INLINE_MAX = prev;
    cap.restore();
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---- cytoscapeSource: resolved via Node module resolution, not a path guess ----
// Bug (found live, 2026-07-02): the old implementation checked two hardcoded
// relative paths tuned only for THIS monorepo's dev layout (root-hoisted
// node_modules). It happened to work here — which is exactly why the existing
// suite above, which stubs cytoscape content directly everywhere
// (`{cytoscape: "/*CY*/"}"`), never exercised the real resolution path at all —
// but broke for a real `npm i @polycode-projects/seonix` consumer, where this
// file lives at `node_modules/@polycode-projects/seonix/src/viz.mjs` and
// cytoscape sits as a sibling at the consumer's own `node_modules/cytoscape`, a
// different relative depth than either hardcoded guess expected.

test("cytoscapeSource: resolves real cytoscape content in this repo (the positive-path sanity check the old code also passed)", async () => {
  const src = await cytoscapeSource();
  assert.ok(src.length > 1000, "expected real, non-trivial cytoscape dist content");
  assert.match(src, /cytoscape/i);
});

test("cytoscapeSource's resolution MECHANISM works at a scoped-dependency install depth (the exact shape that broke) — not just this monorepo's own layout", async () => {
  // Simulate `<consumer>/node_modules/@scope/pkg/src/probe.mjs` resolving a
  // sibling top-level dependency `<consumer>/node_modules/fake-dep/...` — the
  // same depth pattern as a real `npm i @polycode-projects/seonix` install.
  // The OLD hardcoded-relative-path code would have missed both its candidates
  // here (candidate 1 wants a NESTED fake-dep under @scope/pkg; candidate 2's
  // "three-up-then-descend-into-node_modules-again" lands one level too deep).
  // createRequire-based resolution (what cytoscapeSource now uses) finds it
  // correctly regardless — this test proves the MECHANISM, independent of the
  // real cytoscape package, so it can't accidentally pass via this repo's own
  // hoisting the way the original bug's own dev-environment testing did.
  const tmp = await mkdtemp(join(tmpdir(), "seonix-viz-resolve-"));
  try {
    const consumerNodeModules = join(tmp, "node_modules");
    const pkgSrc = join(consumerNodeModules, "@scope", "pkg", "src");
    const depDist = join(consumerNodeModules, "fake-dep", "dist");
    await mkdir(pkgSrc, { recursive: true });
    await mkdir(depDist, { recursive: true });
    await writeFile(join(consumerNodeModules, "fake-dep", "package.json"), JSON.stringify({ name: "fake-dep", version: "1.0.0" }));
    await writeFile(join(depDist, "fake-dep.min.js"), "/* real dependency content */");
    const probePath = join(pkgSrc, "probe.mjs");
    await writeFile(
      probePath,
      [
        "import { createRequire } from \"node:module\";",
        "import { readFile } from \"node:fs/promises\";",
        "export async function probe() {",
        "  const path = createRequire(import.meta.url).resolve(\"fake-dep/dist/fake-dep.min.js\");",
        "  return readFile(path, \"utf8\");",
        "}",
      ].join("\n"),
    );
    const { probe } = await import(new URL(`file://${probePath}`));
    const content = await probe();
    assert.equal(content, "/* real dependency content */");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
