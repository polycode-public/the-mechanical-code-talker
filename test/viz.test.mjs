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
import { computeVizGraph, renderVizHtml } from "../src/viz.mjs";
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
