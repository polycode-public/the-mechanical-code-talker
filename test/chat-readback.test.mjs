// Assert-recall READ-BACK (PLAN_CYCLE_4 tail): the via:fact path WROTE a declared
// fact but the superclass side was unqueryable — "every X is a Y" asserted, then
// "what is a Y" died as "'Y' isn't a term in this graph's own vocabulary". The
// reverse-membership reader (factReadBack, over readFactRows) makes declared facts
// queryable from either side, citing provenance; an un-asserted term still misses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
// The loaded graph lets forward membership resolve a graph INSTANCE to its class.
const GRAPH = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));

test("read-back: assert 'every X is a Y', then 'what is a Y' answers from the remembered fact, cited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-rb-"));
  try {
    const asserted = await runTurn("every function is a component", {
      config: CONFIG, memoryDir: dir, sessionId: "rb-session",
    });
    assert.match(asserted.answer, /remembered 1 fact: function rdfs:subClassOf component/);
    assert.equal(asserted.record.via, "assert");

    // The SUPERCLASS side — previously an honest miss ("'component' isn't a term …") —
    // now answers from the remembered fact, provenance verbatim. (Leading case is left
    // to the finish grammar pass, so we match the fact content, not the first letter.)
    const whatIsY = await runTurn("what is a component", { config: CONFIG, memoryDir: dir });
    assert.match(whatIsY.answer, /^[Yy]ou told me: function is a kind of component \(source: ace:chat:rb-session@/);
    assert.equal(whatIsY.record.via, "fact");
    assert.equal(whatIsY.record.miss, false);

    // The SUBCLASS side (factAnswer's existing subject match) still answers too.
    const whatIsX = await runTurn("what is a function", { config: CONFIG, memoryDir: dir });
    assert.match(whatIsX.answer, /^[Yy]ou told me: function is a kind of component \(source: ace:chat:/);
    assert.equal(whatIsX.record.via, "fact");

    // The yes/no form answers YES from the same fact.
    const isa = await runTurn("is a function a component", { config: CONFIG, memoryDir: dir });
    assert.match(isa.answer, /^[Yy]es — you told me: function is a kind of component \(source: ace:chat:/);
    assert.equal(isa.record.via, "fact");
    assert.equal(isa.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- cycle-005 lever 2: MULTI-TURN declare-then-recall shapes (B2/C1 assert) ----
// The graded assert-recall cells declare "every X is a Y" in an early turn, then
// query it back across turns in shapes the graph grammar can't parse: forward
// membership over a graph INSTANCE ("is <instance> a Y"), the "what kind of thing
// is an X" subject-side phrasing, and the "what did i tell you about X" recall.

test("multi-turn: declare 'every class is a component', then FORWARD membership over an instance and a class word both answer YES, cited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mt-fwd-"));
  try {
    const asserted = await runTurn("every class is a component", {
      config: CONFIG, graph: GRAPH, memoryDir: dir, sessionId: "mt-fwd",
    });
    assert.match(asserted.answer, /remembered 1 fact: class rdfs:subClassOf component/);

    // FORWARD over a graph INSTANCE — "Widget" is a Class individual, so "every
    // class is a component" makes it a component. This needs the loaded graph to
    // resolve Widget → its class-noun ("class"); leading case left to finish().
    const inst = await runTurn("is Widget a component", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(inst.answer, /^[Yy]es — you told me: class is a kind of component \(source: ace:chat:mt-fwd@/);
    assert.equal(inst.record.via, "fact");
    assert.equal(inst.record.miss, false);

    // FORWARD over the bare class WORD still answers (factAnswer's own isa path).
    const word = await runTurn("is a class a component", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(word.answer, /^[Yy]es — you told me: class is a kind of component/);
    assert.equal(word.record.via, "fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("multi-turn: 'what kind of thing is an X' recalls X's own remembered type (subject-side), cited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mt-kind-"));
  try {
    await runTurn("every class is a component", { config: CONFIG, graph: GRAPH, memoryDir: dir, sessionId: "mt-kind" });
    const kind = await runTurn("what kind of thing is a class", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(kind.answer, /^[Yy]ou told me: class is a kind of component \(source: ace:chat:mt-kind@/);
    assert.equal(kind.record.via, "fact");
    assert.equal(kind.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("multi-turn: 'what did i tell you about X' recalls every remembered fact mentioning X, cited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mt-told-"));
  try {
    await runTurn("every class is a component", { config: CONFIG, graph: GRAPH, memoryDir: dir, sessionId: "mt-told" });
    const told = await runTurn("what did i tell you about components", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(told.answer, /^1 remembered fact about component:/);
    assert.match(told.answer, /you told me: class is a kind of component \(source: ace:chat:mt-told@/);
    assert.equal(told.record.via, "fact");
    assert.equal(told.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- cycle-006 lever 3: whole-store recall + asserted-vocabulary count (C1 assert) ----

test("whole-recall: 'what facts do you know' / 'what did i tell you last time' list every remembered fact, cited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-wr-"));
  try {
    await runTurn("every class is a component", { config: CONFIG, graph: GRAPH, memoryDir: dir, sessionId: "wr" });
    for (const q of ["what facts do you know", "what did i tell you last time", "what do you remember"]) {
      const r = await runTurn(q, { config: CONFIG, graph: GRAPH, memoryDir: dir });
      assert.match(r.answer, /class is a kind of component \(source: ace:chat:wr@/, `"${q}" recalls the fact, cited`);
      assert.equal(r.record.via, "fact");
      assert.equal(r.record.miss, false);
    }
    // with NOTHING remembered the recall stays an honest miss (never a guess)
    const empty = await mkdtemp(join(tmpdir(), "tmct-wr-empty-"));
    try {
      const r = await runTurn("what facts do you know", { config: CONFIG, graph: GRAPH, memoryDir: empty });
      assert.equal(r.record.miss, true);
      assert.notEqual(r.record.via, "fact");
    } finally { await rm(empty, { recursive: true, force: true }); }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("asserted-vocabulary count: after 'every class is a X', 'how many Xs are there' equals the class count; a plain kind is untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-avc-"));
  try {
    await runTurn("every class is a component", { config: CONFIG, graph: GRAPH, memoryDir: dir, sessionId: "avc" });
    const n = await runTurn("how many components are there", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.equal(n.answer, "3 components.", "the asserted object noun inherits the class cardinality");
    assert.equal(n.record.via, "fact");
    // a real graph kind is answered by the header count, unchanged by the fact path
    const plain = await runTurn("how many classes are there", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.equal(plain.answer, "3 classes.");
    // an un-asserted object noun still honestly declines (names what it CAN count)
    const unknown = await runTurn("how many widgets are there", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(unknown.answer, /I can't count "widgets"/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("multi-turn: an un-asserted membership still honestly MISSES (byte-identical with and without memory)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mt-miss-"));
  try {
    // memory holds one UNRELATED fact, so the store is non-empty but silent on 'widget'
    await runTurn("every class is a component", { config: CONFIG, graph: GRAPH, memoryDir: dir, sessionId: "mt-miss" });
    for (const q of ["is Widget a widget", "what kind of thing is a doohickey", "what did i tell you about doohickeys"]) {
      const withMemory = await runTurn(q, { config: CONFIG, graph: GRAPH, memoryDir: dir });
      const bare = await runTurn(q, { config: CONFIG, graph: GRAPH });
      assert.equal(withMemory.answer, bare.answer, `un-asserted "${q}" unchanged by the read-back`);
      assert.equal(withMemory.record.miss, true);
      assert.notEqual(withMemory.record.via, "fact");
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("read-back: an un-asserted superclass term still honestly misses (byte-identical to no-memory, aside from the TEACH-OFFER)", async () => {
  // (0.8.2 WS1: "widget" now resolves via ask's meta fallback — the fixture's Class
  // Widget — so this pin uses a term matching neither memory, schema, nor a class.)
  const dir = await mkdtemp(join(tmpdir(), "tmct-rb-miss-"));
  try {
    // one unrelated fact remembered, so memory is non-empty but holds nothing about 'gizmo'
    await runTurn("every function is a component", { config: CONFIG, memoryDir: dir, sessionId: "rb-miss" });

    const withMemory = await runTurn("what is a gizmo", { config: CONFIG, memoryDir: dir });
    const bare = await runTurn("what is a gizmo", { config: CONFIG });
    // Tier-5 playtest fix (this session): a genuinely-unknown-everywhere "what
    // is X" miss now gets a TEACH-OFFER appended UNDER the unchanged wall text
    // — but ONLY when memoryDir exists (there's nowhere to write a taught fact
    // otherwise), so `withMemory` and `bare` now deliberately diverge on that
    // one trailing line; the WALL TEXT ITSELF (this test's own original point
    // — read-back never spuriously matches an unrelated term) stays identical.
    assert.equal(withMemory.answer.split("\n")[0], bare.answer.split("\n")[0], "the wall text itself is unchanged by the read-back");
    assert.match(withMemory.answer, /I don't know "gizmo" yet — teach me directly/);
    assert.doesNotMatch(bare.answer, /teach me directly/, "no memoryDir -> no teach-offer (nowhere to store it)");
    assert.equal(withMemory.record.miss, true);
    assert.notEqual(withMemory.record.via, "fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
