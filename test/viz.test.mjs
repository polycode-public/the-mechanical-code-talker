// viz.mjs tests (PLAN_BREADTH_FIRST_NLU.md §5 / PLAN_VIZ.md's rendering design):
// computeVizGraph's I/O + traversal wiring, and renderVizHtml's pure string
// output. Not re-testing spiralExpand/derivedUpdatedAt/mostRecentIndividual
// themselves — those are covered in test/codegraph.test.mjs; this file only
// covers the NEW wiring (seed selection, edge inclusion, empty-graph
// handling, and the HTML shell).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeVizGraph, renderVizHtml, edgeKindsFor,
  VIZ_NODE_LIMIT_DEFAULT, VIZ_HUB_DEGREE_DEFAULT, VIZ_DEPTH_DEFAULT,
} from "../src/viz.mjs";
import { appendUtterance, appendFact } from "../src/memory/core.mjs";

test("computeVizGraph: empty/missing memory dir -> {nodes: [], edges: [], focus: null, payload}, never throws", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-viz-empty-"));
  try {
    const result = await computeVizGraph(dir);
    assert.deepEqual(result.nodes, []);
    assert.deepEqual(result.edges, []);
    assert.equal(result.focus, null);
    assert.ok(result.payload, "payload (the full raw graph, for the embedded chat panel) is always present, even empty");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeVizGraph: default seed is mostRecentIndividual; --focus overrides it; nodes carry real label/class/timestamps; edges connect the walked node set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-viz-real-"));
  try {
    const SESSION = "01890000-0000-7000-8000-0000000000ff";
    const TS1 = "2026-07-10T10:00:00.000Z";
    const TS2 = "2026-07-11T10:00:00.000Z"; // newer — this utterance should win the default seed
    const { id: uttId1 } = await appendUtterance(dir, {
      role: "visitor", text: "what colour is the sky?", ts: TS1, sessionId: SESSION, sessionStarted: TS1,
    });
    const { id: uttId2 } = await appendUtterance(dir, {
      role: "visitor", text: "what colour is grass?", ts: TS2, sessionId: SESSION, sessionStarted: TS1,
    });
    // Explicit createdAt (earlier than TS2) so this fixture's "most recent individual" is
    // deterministic regardless of wall-clock time — appendFact defaults createdAt to "" (which
    // firstWriteCreatedAt would otherwise fill in with real "now", racing TS2 above).
    await appendFact(dir, {
      subject: "sky", predicate: "mgx:hasProperty", object: "blue", provenance: "corpus:conceptnet /r/HasProperty",
      createdAt: TS1,
    });

    // Default seed: mostRecentIndividual by mgx:createdAt -> the later utterance (uttId2).
    const byDefault = await computeVizGraph(dir);
    assert.equal(byDefault.focus, uttId2, "default seed is the most-recently-created individual");
    assert.ok(byDefault.nodes.length > 0, "the default walk reaches at least the seed node");
    const seedNode = byDefault.nodes.find((n) => n.id === uttId2);
    assert.ok(seedNode, "the seed itself is included in the returned node set");
    assert.equal(seedNode.hop, 0, "the seed is at hop 0");
    assert.equal(seedNode.label, "what colour is grass?", "the node carries the individual's real label");
    assert.equal(seedNode.class, "Utterance", "the node carries the individual's real class");
    assert.equal(seedNode.createdAt, TS2, "the node carries the individual's real createdAt");
    assert.ok(seedNode.updatedAt, "the node carries a derived updatedAt");

    // The seed's Session should be reached one hop away via saidInSession, and an edge should
    // connect the two in the returned edge set (both endpoints are in the walked node set).
    const sessId = `session:${SESSION}`;
    const sessionNode = byDefault.nodes.find((n) => n.id === sessId);
    assert.ok(sessionNode, "the walk reaches the seed's Session via saidInSession");
    const sessionEdge = byDefault.edges.find(
      (e) => (e.source === uttId2 && e.target === sessId) || (e.source === sessId && e.target === uttId2),
    );
    assert.ok(sessionEdge, "an edge connecting the seed and its Session is included in the output");

    // --focus overrides the default seed selection.
    const byFocus = await computeVizGraph(dir, { focus: uttId1 });
    assert.equal(byFocus.focus, uttId1, "--focus picks the given id as the seed, not mostRecentIndividual's pick");
    const focusSeedNode = byFocus.nodes.find((n) => n.id === uttId1);
    assert.ok(focusSeedNode, "the focused node is included");
    assert.equal(focusSeedNode.hop, 0, "the focused node is the hop-0 seed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeVizGraph: depth (max hops) and nodeLimit (spiral length) are optional overrides on spiralExpand's own defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-viz-spiral-"));
  try {
    const SESSION = "01890000-0000-7000-8000-0000000000aa";
    const START = Date.parse("2026-07-11T10:00:00.000Z");
    let prevId = null;
    let seedId = null;
    // A 20-long reply chain in one session — comfortably past default depth (3),
    // so depth's own cap is observable regardless of nodeLimit's (much larger,
    // VIZ_NODE_LIMIT_DEFAULT) value.
    for (let i = 0; i < 20; i += 1) {
      const ts = new Date(START + i * 1000).toISOString();
      const { id } = await appendUtterance(dir, {
        role: i % 2 === 0 ? "visitor" : "tmct", text: `turn ${i}`, ts,
        sessionId: SESSION, sessionStarted: "2026-07-11T10:00:00.000Z",
        replyTo: prevId,
      });
      prevId = id;
      seedId = id; // the LAST utterance (most recent) is the default seed
    }

    const byDefault = await computeVizGraph(dir);
    assert.equal(byDefault.focus, seedId);
    assert.ok(byDefault.nodes.length <= 21, `never reaches more than every node that exists (got ${byDefault.nodes.length})`);
    assert.ok(byDefault.nodes.every((n) => n.hop <= 3), "default depth caps every walked node's hop at 3");

    // Isolate nodeLimit's effect: hold depth generously wide in both calls so
    // depth is never the binding constraint, only nodeLimit varies.
    const narrow = await computeVizGraph(dir, { depth: 10, nodeLimit: 5 });
    const wider = await computeVizGraph(dir, { depth: 10, nodeLimit: 30 });
    assert.ok(narrow.nodes.length <= 6, `nodeLimit caps the walk near the requested count (got ${narrow.nodes.length})`);
    assert.ok(wider.nodes.length > narrow.nodes.length, "a larger nodeLimit reaches more of the same chain");

    // Isolate depth's effect: hold nodeLimit generously wide in both calls so
    // nodeLimit is never the binding constraint, only depth varies.
    const shallow = await computeVizGraph(dir, { depth: 1, nodeLimit: 100 });
    const deep = await computeVizGraph(dir, { depth: 5, nodeLimit: 100 });
    assert.ok(shallow.nodes.every((n) => n.hop <= 1), "an explicit depth override caps the walk's max hop");
    assert.ok(deep.nodes.length > shallow.nodes.length, "a deeper depth reaches more nodes than a shallow one");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const SAMPLE_GRAPH = {
  nodes: [
    { id: "utt:abc", hop: 0, label: "what colour is the sky?", class: "Utterance", createdAt: "2026-07-11T10:00:00.000Z", updatedAt: "2026-07-11T10:00:00.000Z" },
    { id: "session:xyz", hop: 1, label: "session xyz", class: "Session", createdAt: "2026-07-11T09:00:00.000Z", updatedAt: "2026-07-11T09:00:00.000Z" },
  ],
  edges: [{ source: "utt:abc", target: "session:xyz", kind: "saidInSession" }],
  focus: "utt:abc",
  payload: { individuals: [], objectProperties: [] },
};

test("renderVizHtml: valid self-contained HTML, no external refs, graph JSON embedded verbatim", () => {
  const html = renderVizHtml(SAMPLE_GRAPH);

  assert.match(html, /^<!doctype html>/i, "starts with a doctype");
  assert.match(html, /<html/i);
  assert.match(html, /<\/html>\s*$/i, "ends with a closed </html>");
  assert.match(html, /<style>/i, "styles are inline");
  assert.match(html, /<script>/i, "scripts are inline");

  // No external network dependency of any kind.
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i, "no external <script src=...>");
  assert.doesNotMatch(html, /https?:\/\//i, "no http(s) URL anywhere in the document");
  assert.doesNotMatch(html, /<link[^>]+href=/i, "no external stylesheet/font link");

  // The real graph data is embedded verbatim, not placeholder content.
  assert.match(html, /const GRAPH = /);
  assert.match(html, /const PAYLOAD = /, "the full raw graph payload is embedded too, for the chat panel");
  assert.ok(html.includes("utt:abc"), "a known node id is embedded verbatim");
  assert.ok(html.includes("what colour is the sky?"), "a known node label is embedded verbatim");
  assert.ok(html.includes("saidInSession"), "edge kind data is embedded verbatim");

  // The depth stepper + type-filter controls (operator directive) are present.
  assert.match(html, /id="depthdown"/);
  assert.match(html, /id="depthup"/);
  assert.match(html, /id="typefilters"/);

  // The "Ask the graph" chat panel is present, and honestly reports itself
  // unavailable when no bundle was supplied (no askBundle key here) — never a
  // silently broken input box.
  assert.match(html, /Ask the graph/);
  assert.match(html, /id="askq"[^>]*disabled/, "input is disabled when there's no engine bundle");
  assert.match(html, /chat unavailable/);

  // A node's raw id/label containing "</script>" can't break out of the embedding script tag.
  const hostile = renderVizHtml({
    nodes: [{ id: "x", hop: 0, label: "</script><script>evil()</script>", class: "", createdAt: "", updatedAt: "" }],
    edges: [],
    focus: "x",
    payload: { individuals: [], objectProperties: [] },
  });
  assert.doesNotMatch(hostile, /<\/script><script>evil\(\)/, "a hostile label cannot break out of the embedded <script> tag");
});

test("renderVizHtml: with a real askBundle, the chat panel is enabled and the bundle is inlined verbatim", () => {
  const fakeBundle = "/* fake bundle */ globalThis.tmctViz = { marker: 'REAL_BUNDLE_CONTENT_12345' };";
  const html = renderVizHtml({ ...SAMPLE_GRAPH, askBundle: fakeBundle });
  assert.ok(html.includes(fakeBundle), "the bundle's own JS text is inlined verbatim, not re-encoded/escaped");
  assert.doesNotMatch(html, /id="askq"[^>]*disabled/, "input is enabled once a bundle is supplied");
  assert.doesNotMatch(html, /id="asksubmit"[^>]*disabled/);
  assert.doesNotMatch(html, /chat unavailable/);
});

test("renderVizHtml: empty graph still renders valid self-contained HTML (no nodes to click, no throw)", () => {
  const html = renderVizHtml({ nodes: [], edges: [], focus: null, payload: { individuals: [], objectProperties: [] } });
  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /const GRAPH = /);
});

// ── PLAN_VIZ_MEMORY.md: Bug 2 (dual walk-kind), hubDegree/nodeLimit defaults, --term seeding ──

test("edgeKindsFor: meta/relation/both — meta is byte-identical to MEMORY_SPIRAL_EXPAND_KINDS alone; relation is the dynamic per-graph predicate list + the two fixed link kinds; both is the union", () => {
  const rel = ["mgx:hasA", "rdfs:subClassOf"];
  assert.deepEqual(edgeKindsFor("meta", rel), ["saidInSession", "inReplyTo", "statedBy", "canonicalisedFrom"]);
  assert.deepEqual(edgeKindsFor("relation", rel), ["mgx:hasA", "rdfs:subClassOf", "factSubjectTerm", "factObjectTerm"]);
  assert.deepEqual(edgeKindsFor("both", rel), [
    "saidInSession", "inReplyTo", "statedBy", "canonicalisedFrom",
    "mgx:hasA", "rdfs:subClassOf", "factSubjectTerm", "factObjectTerm",
  ]);
  assert.deepEqual(edgeKindsFor(undefined, rel), edgeKindsFor("both", rel), "an unrecognized/absent mode defaults to \"both\"");
});

test("computeVizGraph Bug 2 fix: seeded on a freshly-taught Fact, the default (both) walk reaches its own concept neighbourhood — the operator's original \"what is a dog\" complaint, reproduced and fixed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-viz-bug2-"));
  try {
    const TS = "2026-07-11T10:00:00.000Z";
    const { id: factId } = await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human", createdAt: TS });
    await appendFact(dir, { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:conceptnet /r/HasA", createdAt: TS });
    await appendFact(dir, { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:conceptnet /r/CapableOf", createdAt: TS });

    const result = await computeVizGraph(dir, { focus: factId, depth: 4, nodeLimit: 50 });
    const labels = result.nodes.map((n) => n.label);
    assert.ok(labels.includes("animal"), "reaches \"animal\" — structurally invisible before Bug 2's fix");
    assert.ok(labels.includes("tail"), "reaches \"tail\" (a DIFFERENT fact, only connected via the shared \"dog\" term)");
    assert.ok(labels.includes("bark"), "reaches \"bark\" too — the whole concept neighbourhood, not just the seed fact's own two terms");

    // meta-only reproduces today's exact (pre-fix) behavior: only the provenance
    // chain (here, the Fact's own statedBy Source) — never the concept terms.
    const metaOnly = await computeVizGraph(dir, { focus: factId, depth: 4, nodeLimit: 50, edgeKindMode: "meta" });
    const metaLabels = metaOnly.nodes.map((n) => n.label);
    assert.ok(!metaLabels.includes("animal") && !metaLabels.includes("tail") && !metaLabels.includes("bark"),
      "the meta-only toggle still reproduces the pre-Bug-2 provenance-only walk — no concept terms reachable, only provenance (e.g. the Fact's own statedBy Source)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeVizGraph: the raised nodeLimit default (VIZ_NODE_LIMIT_DEFAULT, not spiralExpand's own code-graph default of 12) actually applies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-viz-limit-"));
  try {
    assert.equal(VIZ_NODE_LIMIT_DEFAULT, 300);
    assert.equal(VIZ_HUB_DEGREE_DEFAULT, 40);
    assert.equal(VIZ_DEPTH_DEFAULT, 3);
    const TS = "2026-07-11T10:00:00.000Z";
    // 20 distinct one-hop facts off the SAME subject — comfortably past the OLD
    // 12-node default, well under the new 300 one, and each object is
    // one-hop-reachable (no hub-quantile pruning surprises like the reply-chain
    // fixture above), so the raised default is directly observable here.
    let seedId = null;
    for (let i = 0; i < 20; i++) {
      const { id } = await appendFact(dir, { subject: "dog", predicate: "mgx:relatedTo", object: `thing${i}`, provenance: "corpus:human", createdAt: TS });
      seedId = id;
    }
    const result = await computeVizGraph(dir, { focus: seedId });
    assert.ok(result.nodes.length > 12, `default nodeLimit reaches more than the OLD 12-node default (got ${result.nodes.length})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeVizGraph: hubDegree caps expansion THROUGH a common hypernym without hiding it, and is CLI/opt overridable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-viz-hubdegree-"));
  try {
    const TS = "2026-07-11T10:00:00.000Z";
    // "thing" is subClassOf-related from 50 distinct subjects — a common hypernym hub.
    for (let i = 0; i < 50; i++) {
      await appendFact(dir, { subject: `s${i}`, predicate: "rdfs:subClassOf", object: "thing", provenance: "corpus:human", createdAt: TS });
    }
    const { id: seedId } = await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "thing", provenance: "corpus:human", createdAt: TS });

    const uncapped = await computeVizGraph(dir, { focus: seedId, depth: 4, nodeLimit: 500, hubDegree: 1000 });
    const capped = await computeVizGraph(dir, { focus: seedId, depth: 4, nodeLimit: 500, hubDegree: 5 });
    assert.ok(uncapped.nodes.length > capped.nodes.length, "a low hubDegree cap reaches far fewer nodes than an effectively uncapped one");
    assert.ok(capped.nodes.some((n) => n.label === "thing"), "the hub itself (\"thing\") is still shown even when capped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeVizGraph --term: resolves via normFactTerm to the synthetic term node and seeds from there, reaching the SAME concept neighbourhood as a Fact-based seed; a non-matching term falls back to the default seed rather than a phantom node", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-viz-term-"));
  try {
    const TS = "2026-07-11T10:00:00.000Z";
    await appendFact(dir, { subject: "Dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human", createdAt: TS }); // capitalized — normFactTerm lowercases
    await appendFact(dir, { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:conceptnet /r/HasA", createdAt: TS });

    const byTerm = await computeVizGraph(dir, { term: "dog", depth: 3, nodeLimit: 50 });
    assert.equal(byTerm.focus, "term:dog", "seeds directly on the synthetic term node");
    const labels = byTerm.nodes.map((n) => n.label);
    assert.ok(labels.includes("animal") && labels.includes("tail"), "reaches the whole concept neighbourhood from the term seed");

    // --focus takes precedence when both are given (bin/tmct.mjs's own precedence, re-verified at
    // the computeVizGraph level too): a --term that would resolve to something else is ignored.
    const withBothGiven = await computeVizGraph(dir, { focus: "term:dog", term: "nonexistent-word-xyz" });
    assert.equal(withBothGiven.focus, "term:dog");

    // an unmatched --term falls through to the default seed (mostRecentIndividual), never a
    // lone phantom node for a word that names no Fact.
    const missTerm = await computeVizGraph(dir, { term: "nonexistent-word-xyz" });
    assert.notEqual(missTerm.focus, "term:nonexistent-word-xyz");
    assert.ok(missTerm.nodes.length > 0, "falls back to a real default seed, not an empty/phantom result");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeVizGraph: legend is pickLegendDimension's real output over the walked node set, and walkOpts carries the resolved depth/nodeLimit/hubDegree/edgeKindMode (even on an empty graph, for renderVizHtml's client-side re-walk to embed)", async () => {
  const empty = await mkdtemp(join(tmpdir(), "tmct-viz-legend-empty-"));
  try {
    const emptyResult = await computeVizGraph(empty);
    assert.equal(emptyResult.legend, null);
    assert.deepEqual(emptyResult.walkOpts, { depth: VIZ_DEPTH_DEFAULT, nodeLimit: VIZ_NODE_LIMIT_DEFAULT, hubDegree: VIZ_HUB_DEGREE_DEFAULT, edgeKindMode: "both" });
  } finally {
    await rm(empty, { recursive: true, force: true });
  }

  const dir = await mkdtemp(join(tmpdir(), "tmct-viz-legend-"));
  try {
    const TS = "2026-07-11T10:00:00.000Z";
    const { id: seedId } = await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human", createdAt: TS });
    await appendFact(dir, { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:conceptnet /r/HasA", createdAt: TS });
    const result = await computeVizGraph(dir, { focus: seedId, depth: 3, nodeLimit: 50, hubDegree: 7, edgeKindMode: "relation" });
    assert.ok(result.legend, "a non-empty walk always carries a computed legend");
    assert.ok(["class", "predicate", "provenance"].includes(result.legend.primary));
    assert.deepEqual(result.walkOpts, { depth: 3, nodeLimit: 50, hubDegree: 7, edgeKindMode: "relation" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── PLAN_VIZ_MEMORY.md Controls port + Bug 1's dual ask-engine bundling ──

test("renderVizHtml: BOTH ask-engine bundles inline verbatim and independently gate their own half of the panel's availability", () => {
  const askBundle = "/* code-graph engine */ globalThis.tmctViz = { marker: 'ASK_MARKER_1' };";
  const memoryAskBundle = "/* memory engine */ globalThis.tmctMemoryAsk = { marker: 'MEM_MARKER_2' };";

  const both = renderVizHtml({ ...SAMPLE_GRAPH, askBundle, memoryAskBundle });
  assert.ok(both.includes(askBundle) && both.includes(memoryAskBundle), "both bundles are inlined verbatim");
  assert.doesNotMatch(both, /id="askq"[^>]*disabled/, "the panel is enabled when EITHER engine is present");

  const memOnly = renderVizHtml({ ...SAMPLE_GRAPH, memoryAskBundle });
  assert.ok(!memOnly.includes("ASK_MARKER_1") && memOnly.includes("MEM_MARKER_2"));
  assert.doesNotMatch(memOnly, /id="askq"[^>]*disabled/, "the panel is enabled with ONLY the memory engine present");

  const neither = renderVizHtml({ ...SAMPLE_GRAPH });
  assert.match(neither, /id="askq"[^>]*disabled/, "disabled only when NEITHER engine is present");
  assert.match(neither, /chat unavailable/);
});

test("renderVizHtml: the Controls port (hub-hide, beam-prune, label mode, search, edge-kind toggle) and the legend-as-filter row are present in the markup, and LEGEND/WALK_OPTS are embedded", () => {
  const legend = { primary: "predicate", dimensions: { class: { score: 0.1, qualifies: true, buckets: [{ value: "Fact", count: 2 }] }, predicate: { score: 1, qualifies: true, buckets: [{ value: "mgx:hasA", count: 1 }, { value: "rdfs:subClassOf", count: 1 }] }, provenance: { score: 0, qualifies: false, buckets: [] } } };
  const walkOpts = { depth: 3, nodeLimit: 300, hubDegree: 40, edgeKindMode: "both" };
  const html = renderVizHtml({ ...SAMPLE_GRAPH, legend, walkOpts });

  assert.match(html, /id="hubhideon"/);
  assert.match(html, /id="hubhideval"/);
  assert.match(html, /id="beamon"/);
  assert.match(html, /id="beamval"/);
  assert.match(html, /id="labelmode"/);
  assert.match(html, /id="search"/);
  assert.match(html, /id="edgekind"/);
  assert.match(html, /id="legend"/);
  assert.match(html, /id="legenddim"/);
  assert.match(html, /const LEGEND = /);
  assert.match(html, /const WALK_OPTS = /);
  assert.ok(html.includes('"primary":"predicate"'), "the real legend payload is embedded, not a placeholder");
  assert.ok(html.includes('"hubDegree":40'));
});
