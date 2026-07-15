// concept.test.mjs — THE CONCEPT FORCE (concept.mjs + chat.mjs hook). A vague
// "what is a X" that names a known concept WITH instances composes three bands:
// the corpus/seon definition, real example instances, and 2-3 PRE-VALIDATED
// follow-up questions. These tests pin: the byte-exact target transcript, the
// follow-up validation guarantee (never offer a query that would miss), the
// examples/definition composition, memory-fact instances, and — critically —
// trigger discipline (a precise query and an instance-less/unknown concept are
// never hijacked).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEntities } from "../../src/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/schema-docs.mjs";
import { ask } from "../../src/ask.mjs";
import { composeConcept, composeRelation, CONCEPT_CLASS, RELATION_TERM } from "../../src/concept.mjs";
import { runTurn } from "../../src/chat.mjs";
import { clearCache } from "../../src/source.mjs";

const FIXTURE = new URL("../fixtures/entities.fixture.json", import.meta.url).pathname;

// FEATURE B (0.9.x): every runAsk-composed answer now carries an ALWAYS-ON
// trailing "\n\nGoal (inferred): …" line (chat.mjs's withGoalLine), optionally
// followed by a "\n\nCanonical: …" line (withCanonicalLine) — this suite pins
// the concept force's OWN byte-exact composition, orthogonal to both, so
// they're stripped (Canonical first, since it trails Goal when both are
// present) before the byte-exact comparisons below.
const GOAL_LINE_RE = /\n\nGoal \(inferred\):[^\n]*$/;
const CANONICAL_LINE_RE = /\n\nCanonical:[^\n]*$/;
const noGoal = (s) => String(s).replace(CANONICAL_LINE_RE, "").replace(GOAL_LINE_RE, "");

/** The fixture graph, run through the same writer pipeline a producer uses
 *  (ingestSchemaDocs before parse), as an ask-ready graph object. */
async function fixtureGraph() {
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  ingestSchemaDocs(payload);
  return parseEntities(payload);
}

/** A temp repo whose .tmct/graph.json IS that ingested fixture — for the
 *  end-to-end runTurn path (loads the graph from config, like the real shell). */
async function repoWithFixture() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-concept-"));
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  ingestSchemaDocs(payload);
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

const CLASS_DEF = "A class is a template that defines the structure and behaviour of objects; in code it groups methods and attributes under one type.";

test("composeConcept: the three bands for 'class' — definition + real examples + follow-ups", async () => {
  const graph = await fixtureGraph();
  const c = composeConcept(graph, "class", { definition: CLASS_DEF });
  assert.ok(c, "a known concept with instances composes");
  assert.equal(c.definition, "A class is a template that defines the structure and behaviour of objects.",
    "the FACT band is the lead clause (cut at the semicolon)");
  assert.equal(c.examples, "In this codebase, for example: Base, Widget and Button (3 classes).",
    "the EXAMPLES band names real individuals with the class total");
  assert.deepEqual(c.followupQueries,
    ["which classes inherit from Base", "what does Widget contain", "where is Button defined"],
    "the follow-ups are concrete, grounded in DIFFERENT real instances");
  assert.deepEqual(c.instances.map((i) => i.id), ["cls-base", "cls-widget", "cls-button"]);
});

test("composeConcept: EVERY generated follow-up actually resolves (pre-checked, never a miss)", async () => {
  const graph = await fixtureGraph();
  for (const term of ["class", "module", "function", "method"]) {
    const def = `a ${term} is a thing.`;
    const c = composeConcept(graph, term, { definition: def });
    assert.ok(c, `${term} composes`);
    for (const q of c.followupQueries) {
      const r = ask(graph, q);
      assert.equal(r.tmct_ask.miss, false, `follow-up "${q}" must not miss`);
      assert.ok((r.tmct_ask.matches || []).length > 0, `follow-up "${q}" must return results`);
    }
  }
});

test("composeConcept: declines (null) when the concept has NO instances anywhere", async () => {
  // a graph with a definition-bearing concept but zero individuals of that class,
  // and no memory facts → honest miss, not an empty three-band answer.
  const emptyGraph = parseEntities({ individuals: [], objectProperties: [] });
  assert.equal(composeConcept(emptyGraph, "class", { definition: CLASS_DEF }), null,
    "no code-graph instances and no memory facts → no concept force");
});

test("composeConcept: declines for an unknown / non-enumerable concept term", async () => {
  const graph = await fixtureGraph();
  assert.equal(CONCEPT_CLASS.cache, undefined, "'cache' has no enumerable graph class");
  assert.equal(composeConcept(graph, "cache", { definition: "a cache stores things." }), null);
  assert.equal(composeConcept(graph, "class", { definition: null }), null, "no definition → decline");
});

test("composeConcept: remembered isa facts add example instances", async () => {
  const graph = await fixtureGraph();
  const factRows = [
    { predicate: "rdf:type", subject: "PaymentGateway", object: "class" },
    { predicate: "rdfs:subClassOf", subject: "widget", object: "class" }, // subclass, NOT an instance — ignored
  ];
  const c = composeConcept(graph, "class", { definition: CLASS_DEF, factRows });
  assert.match(c.examples, /You've also told me PaymentGateway is a class\./,
    "an rdf:type fact contributes a remembered instance");
  assert.doesNotMatch(c.examples, /subClassOf|widget is a class/i,
    "a subclass fact is not an instance and is not listed");
});

test("end-to-end: 'what is a class' composes the byte-exact target transcript", async () => {
  const dir = await repoWithFixture();
  try {
    clearCache();
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const { answer, record } = await runTurn("what is a class", { config });
    assert.equal(noGoal(answer),
      "A class is a template that defines the structure and behaviour of objects.\n"
      + "In this codebase, for example: Base, Widget and Button (3 classes).\n"
      + "Want to go deeper? Try:\n"
      + "  • which classes inherit from Base\n"
      + "  • what does Widget contain\n"
      + "  • where is Button defined");
    assert.equal(record.miss, false);
    assert.equal(record.via, "corpus/seon", "the definition is cited to corpus/seon");
    assert.deepEqual(record.answeredIds, ["cls-base", "cls-widget", "cls-button"],
      "the real example instances are recorded as what the turn asked about");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("end-to-end: module/function/method each define + exemplify + guide (was a dead-end/schema-doc)", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    for (const [q, defLead, ex] of [
      ["what is a module", "A module is a source file.", /In this codebase, for example: app\/lib\/a\.mjs.*\(8 modules\)\./],
      ["what is a function", "A function is a named, reusable block", /In this codebase, for example: fnAlpha \(1 function\)\./],
      ["what is a method", "A method is a function that belongs to a class", /In this codebase, for example: Widget\.render \(1 method\)\./],
    ]) {
      clearCache();
      const { answer, record } = await runTurn(q, { config });
      assert.ok(answer.startsWith(defLead), `${q}: leads with the corpus/seon definition`);
      assert.match(answer, ex, `${q}: names real instances`);
      assert.match(answer, /Want to go deeper\? Try:/, `${q}: offers guided follow-ups`);
      assert.equal(record.miss, false, `${q}: not a miss`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("trigger discipline: a precise query is untouched (no definition/examples/follow-ups appended)", async () => {
  const dir = await repoWithFixture();
  try {
    clearCache();
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const { answer } = await runTurn("which modules import a.mjs", { config });
    assert.equal(noGoal(answer), "app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.",
      "a precise query keeps its exact answer — the concept force never fires on it");
    assert.doesNotMatch(answer, /Want to go deeper|In this codebase, for example/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("cap 32 + 'more' pagination: a >32-instance concept lists 32, holds the rest, pages on 'more'", async () => {
  // 40 classes → the examples band shows 32 and offers "…and 8 more — say 'more' to
  // see them."; a follow-up bare "more" renders the held remainder.
  const individuals = [];
  for (let i = 0; i < 40; i += 1) {
    individuals.push({ id: `cls-${i}`, label: `Class${String(i).padStart(2, "0")}`, class: "Class", attributes: [] });
  }
  const graph = parseEntities({ individuals, objectProperties: [] });
  const c = composeConcept(graph, "class", { definition: CLASS_DEF });
  assert.match(c.examples, /\(40 classes\)\. …and 8 more — say 'more' to see them\./,
    "shows 32, cites the total, and offers the remainder");
  assert.equal(c.remainder.length, 8, "8 instances held for pagination");
  assert.equal(c.instances.length, 32, "detail carries the 32 shown");

  // end-to-end: the 'more' turn pages the remainder held on last.detail.pending.
  const dir = await mkdtemp(join(tmpdir(), "tmct-more-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify({ individuals, objectProperties: [] }));
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const first = await runTurn("what is a class", { config });
    assert.match(first.answer, /…and 8 more — say 'more' to see them\./);
    assert.ok(first.last.detail.pending, "the remainder is held on last.detail.pending");
    const more = await runTurn("more", { config, last: first.last });
    assert.match(more.answer, /Class3[2-9]/, "the 'more' turn shows the held remainder");
    assert.doesNotMatch(more.answer, /say 'more'/, "nothing left to page after the last batch");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- THE RELATION CONCEPT FORCE (composeRelation) — the same three bands over
// EDGE kinds. A vague touch on a relation ("what about imports") gets the curated
// relation definition, real example edges, and pre-validated follow-ups. ----

const IMPORTS_DEF = "To import is to bring another module's definitions into the current one.";

test("composeRelation: the three bands for 'imports' — definition + real example edges + follow-ups", async () => {
  const graph = await fixtureGraph();
  const c = composeRelation(graph, "imports", { definition: IMPORTS_DEF });
  assert.ok(c, "a known relation with edges composes");
  assert.equal(c.definition, IMPORTS_DEF, "the FACT band is the relation definition (one sentence, no cut needed)");
  assert.equal(c.examples,
    "In this codebase, for example: app/lib/b.mjs imports app/lib/a.mjs, app/lib/c.mjs imports app/lib/a.mjs "
    + "and app/functions/d/handler.mjs imports app/lib/b.mjs (7 import edges). …and 4 more — say 'more' to see them.",
    "the EXAMPLES band renders real edges as sentences with the edge count");
  assert.deepEqual(c.followupQueries,
    ["which modules import app/lib/a.mjs", "what does app/lib/b.mjs import"],
    "the follow-ups are grounded in real edge endpoints, both sides");
  assert.equal(c.remainder.length, 4, "the un-shown edges are held for 'more' pagination");
  assert.equal(c.noun, "import edges");
});

test("composeRelation: EVERY generated follow-up actually resolves (pre-checked, never a miss)", async () => {
  const graph = await fixtureGraph();
  const defs = {
    imports: IMPORTS_DEF, calls: "A call is one function invoking another.",
    contains: "Containment is a class holding a member.",
    inherits: "Inheritance is one class deriving from another.",
    tests: "A test exercises another unit.", defines: "A definition introduces a name.",
    touches: "A touch is a commit changing a file.",
  };
  for (const [term, def] of Object.entries(defs)) {
    const c = composeRelation(graph, term, { definition: def });
    assert.ok(c, `${term} composes`);
    for (const q of c.followupQueries) {
      const r = ask(graph, q);
      assert.equal(r.tmct_ask.miss, false, `follow-up "${q}" must not miss`);
      assert.ok((r.tmct_ask.matches || []).length > 0, `follow-up "${q}" must return results`);
    }
  }
});

test("composeRelation: gerund/synonym terms collapse to the same edge concept", async () => {
  const graph = await fixtureGraph();
  assert.equal(RELATION_TERM.importing, "imports");
  assert.equal(RELATION_TERM.calling, "calls");
  assert.equal(RELATION_TERM.inheritance, "inherits");
  assert.equal(RELATION_TERM.extends, "inherits");
  const a = composeRelation(graph, "importing", { definition: IMPORTS_DEF });
  const b = composeRelation(graph, "imports", { definition: IMPORTS_DEF });
  assert.deepEqual(a.examples, b.examples, "'importing' enumerates the same edges as 'imports'");
});

test("composeRelation: declines (null) for an unknown relation or no definition; degrades (not null) for a KNOWN relation with NO edges of that kind", async () => {
  const graph = await fixtureGraph();
  assert.equal(RELATION_TERM.frobnicate, undefined);
  assert.equal(composeRelation(graph, "frobnicate", { definition: "x." }), null, "unknown relation → decline");
  assert.equal(composeRelation(graph, "imports", { definition: null }), null, "no definition → decline");
  // a graph that has only import edges → asking for 'calls' finds no edges of that kind.
  // This is NOT the same as an unrecognized term: composeRelation must still degrade to
  // an honest, ON-TOPIC two-band answer (definition + "no X edges in the index"), never
  // null — null here would let the caller's raw grammar attempt at the vague-touch text
  // ("what about calls") fall through to an unrelated, garbled object search (found live:
  // an advisor tick on the 0.9.14 Tier-2 playtest cycle, reexports on examples/mini-webapp,
  // which has zero reexports edges — the realistic case for most repos).
  const importsOnly = parseEntities({
    individuals: [],
    objectProperties: [{ predicate: "imports", prop: "mgx:importsNamespace", count: 1,
      examples: [{ subject: "a.mjs", object: "b.mjs", subjectLabel: "a.mjs", objectLabel: "b.mjs" }] }],
  });
  const zeroEdges = composeRelation(importsOnly, "calls", { definition: "a call." });
  assert.ok(zeroEdges, "a known relation with no edges of that kind still composes (never null)");
  assert.equal(zeroEdges.empty, true, "flagged as the zero-edge degrade, not a real edge set");
  assert.equal(zeroEdges.definition, "a call.");
  assert.equal(zeroEdges.examples, "This codebase has no call edges in the index.",
    "an honest, on-topic miss — never a fabricated edge, never the caller's unrelated object-search text");
  assert.equal(zeroEdges.followups, "", "no edges to seed a validated follow-up from");
  assert.deepEqual(zeroEdges.followupQueries, []);
  assert.deepEqual(zeroEdges.remainder, []);
  assert.ok(composeRelation(importsOnly, "imports", { definition: IMPORTS_DEF }), "the present kind still composes");
});

test("trigger discipline: a specific-entity 'what is Widget' and an unknown concept are not hijacked", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    // "what is a widget" — a real individual, not one of the enumerable CONCEPT kinds:
    // the concept force declines and the ordinary (honest-miss) surface stands.
    const w = await runTurn("what is a widget", { config });
    assert.doesNotMatch(w.answer, /Want to go deeper|In this codebase, for example/);
    clearCache();
    // "what is a cache" — a general-vocabulary concept with no graph class → no three bands.
    const c = await runTurn("what is a cache", { config });
    assert.doesNotMatch(c.answer, /Want to go deeper|In this codebase, for example/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
