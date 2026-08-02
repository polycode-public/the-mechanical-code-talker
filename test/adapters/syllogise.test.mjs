// syllogise.test.mjs — the speculative-inference engine: the pure
// forward-chaining kernel, the materialising pass (entailed provenance + low trust, never outranks a stated
// fact), and the HONEST KILL CRITERION — does a pre-derived transitive fact flip
// a real subclass-chain miss to a hit, measured on the DEFAULT W3 bootstrap seed
// (not a hand fixture, not the whole corpus)?
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFact, appendFacts, loadMemory, readFactRows, removeFacts,
  loadSyllogiseState, saveSyllogiseState, factRecordIdForTag, readRetractions,
} from "../../src/adapters/memory/core.mjs";
import {
  deriveSubClassClosure, deriveSubClassClosureDelta, buildRelevanceFrontier,
  deriveTypePropagation, deriveDisjointViolations,
  deriveSomeValuesFromApplication, findConsistencyViolations, findIsaChain, syllogise as syllogiseSeam,
  ENTAILED_PROVENANCE, SUBCLASS_PREDICATE, ENTAILED_TYPE_PROVENANCE, TYPE_PREDICATE,
  ENTAILED_DISJOINT_PROVENANCE, DISJOINT_PREDICATE, CAX_DW_RULE, CAX_DW_RULE_CONFIDENCE,
  ENTAILED_SVF1_PROVENANCE, ON_PROPERTY_PREDICATE, SOME_VALUES_FROM_PREDICATE,
  CLS_SVF1_RULE, CLS_SVF1_RULE_CONFIDENCE,
  buildCardinalityRestrictions, deriveSomeValuesFromSubsumption,
  proveCardinalityAtLeast, proveMaxCardinalityZeroDenial,
  ENTAILED_SCM_SVF_PROVENANCE, SCM_SVF_RULE, SCM_SVF_RULE_CONFIDENCE,
  CARDINALITY_RULE_CONFIDENCE, CAX_MAXC0_RULE_CONFIDENCE, entailedTrustFrom,
  retractSubClassOf as retractSubClassOfSeam,
} from "../../src/domain/syllogise.mjs";
import { assertSentence as assertSentenceSeam } from "../../src/domain/grammar/assert.mjs";
import { factIdForTriple } from "../../src/domain/hash.mjs";
import { freshConceptNetRepo } from "../helpers/seeded-fixture.mjs";

// The persisting seams take the store's read/write functions injected; every
// call in this file wires the real memory/core.mjs implementations once here.
const STORE = { loadMemory, readFactRows, appendFacts, removeFacts };
const syllogise = (dir, opts = {}) => syllogiseSeam(dir, { store: STORE, ...opts });
const retractSubClassOf = (dir, subj, obj, opts = {}) => retractSubClassOfSeam(dir, subj, obj, { store: STORE, ...opts });
const assertSentence = (dir, sentence, opts = {}) => assertSentenceSeam(dir, sentence, { appendFact, ...opts });

const mkRepo = () => mkdtemp(join(tmpdir(), "tmct-syllog-"));
const subClassRows = (rows) => rows.filter((r) => r.predicate === SUBCLASS_PREDICATE);
const typeRows = (rows) => rows.filter((r) => r.predicate === TYPE_PREDICATE);
const disjointRows = (rows) => rows.filter((r) => r.predicate === DISJOINT_PREDICATE);
const hasEdge = (rows, s, o) => subClassRows(rows).some((r) => r.subject === s && r.object === o);
const hasType = (rows, s, o) => typeRows(rows).some((r) => r.subject === s && r.object === o);
const hasDisjoint = (rows, s, o) => disjointRows(rows).some((r) => r.subject === s && r.object === o);
const round6 = (n) => Number(n.toFixed(6)); // mirrors memory/trust.mjs's own `round`

// ---- the pure kernel: bounded, screened, focus-filtered, deterministic -------

test("deriveSubClassClosure: transitivity — (a⊑b),(b⊑c) ⊨ (a⊑c)", () => {
  const d = deriveSubClassClosure([["a", "b"], ["b", "c"]]);
  assert.deepEqual(d, [{ subject: "a", object: "c", via: "b" }]);
});

test("deriveSubClassClosure: closes a long chain across rounds (a⊑…⊑e)", () => {
  const d = deriveSubClassClosure([["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]]);
  const pairs = new Set(d.map((x) => `${x.subject}->${x.object}`));
  // every non-adjacent pair in the chain is entailed
  for (const [s, o] of [["a", "c"], ["a", "d"], ["a", "e"], ["b", "d"], ["b", "e"], ["c", "e"]]) {
    assert.ok(pairs.has(`${s}->${o}`), `${s}⊑${o} should be derived`);
  }
  assert.equal(d.length, 6);
});

test("deriveSubClassClosure: tautology screen — never emits a⊑a (cycle a⊑b,b⊑a)", () => {
  const d = deriveSubClassClosure([["a", "b"], ["b", "a"]]);
  assert.deepEqual(d, [], "reflexive conclusions are screened, and both direct edges already exist");
});

test("deriveSubClassClosure: dedup/novelty screen — a⊑c already present is not re-derived", () => {
  const d = deriveSubClassClosure([["a", "b"], ["b", "c"], ["a", "c"]]);
  assert.deepEqual(d, []);
});

test("deriveSubClassClosure: focus-connection — a derivation must touch focus (one step out)", () => {
  const edges = [["a", "b"], ["b", "c"]];
  assert.deepEqual(deriveSubClassClosure(edges, { focus: new Set(["z"]) }), [], "unrelated focus → nothing");
  // focus on the PIVOT b still admits a⊑c (b is one step out from both ends)
  assert.deepEqual(deriveSubClassClosure(edges, { focus: new Set(["b"]) }), [{ subject: "a", object: "c", via: "b" }]);
  assert.deepEqual(deriveSubClassClosure(edges, { focus: new Set(["a"]) }), [{ subject: "a", object: "c", via: "b" }]);
});

test("deriveSubClassClosure: hard budget caps derivations, deterministically", () => {
  // a star + chain giving many closures; budget 3 truncates a sorted candidate set
  const edges = [["a", "b"], ["b", "c"], ["b", "d"], ["b", "e"], ["c", "f"]];
  const d = deriveSubClassClosure(edges, { budget: 3 });
  assert.equal(d.length, 3);
  const again = deriveSubClassClosure(edges, { budget: 3 });
  assert.deepEqual(d, again, "same inputs → same truncation (deterministic)");
});

// ---- cax-sco: rdf:type propagation across a subClassOf chain -----------------

test("deriveTypePropagation: (x:C),(C⊑D) ⊨ (x:D)", () => {
  const d = deriveTypePropagation([["redis.mjs", "cache"]], [["cache", "component"]]);
  assert.deepEqual(d, [{ subject: "redis.mjs", object: "component", via: "cache" }]);
});

test("deriveTypePropagation: propagates across a MULTI-hop taught ⊑-chain in one call (no fixpoint rounds needed)", () => {
  const d = deriveTypePropagation(
    [["redis.mjs", "cache"]],
    [["cache", "store"], ["store", "component"], ["component", "artifact"]],
  );
  const pairs = new Set(d.map((x) => `${x.subject}->${x.object}`));
  for (const o of ["store", "component", "artifact"]) {
    assert.ok(pairs.has(`redis.mjs->${o}`), `redis.mjs:${o} should be derived`);
  }
  assert.equal(d.length, 3);
});

test("deriveTypePropagation: tautology screen — never emits x:x, and a class is never typed as itself", () => {
  const d = deriveTypePropagation([["a", "b"]], [["b", "a"]]); // b⊑a would close a:a
  assert.deepEqual(d, [], "reflexive x:x conclusions are screened");
});

test("deriveTypePropagation: dedup/novelty screen — x:D already present is not re-derived", () => {
  const d = deriveTypePropagation([["x", "c"], ["x", "d"]], [["c", "d"]]);
  assert.deepEqual(d, [], "x:d is already a stated type edge");
});

test("deriveTypePropagation: focus-connection — a derivation must touch focus (one step out)", () => {
  const typeEdges = [["x", "c"]];
  const subClassEdges = [["c", "d"]];
  assert.deepEqual(deriveTypePropagation(typeEdges, subClassEdges, { focus: new Set(["z"]) }), [], "unrelated focus → nothing");
  assert.deepEqual(
    deriveTypePropagation(typeEdges, subClassEdges, { focus: new Set(["c"]) }),
    [{ subject: "x", object: "d", via: "c" }],
    "focus on the pivot class still admits x:d",
  );
  assert.deepEqual(
    deriveTypePropagation(typeEdges, subClassEdges, { focus: new Set(["x"]) }),
    [{ subject: "x", object: "d", via: "c" }],
  );
});

test("deriveTypePropagation: hard budget caps derivations, deterministically", () => {
  const typeEdges = [["x", "c"]];
  const subClassEdges = [["c", "d1"], ["c", "d2"], ["c", "d3"]];
  const d = deriveTypePropagation(typeEdges, subClassEdges, { budget: 2 });
  assert.equal(d.length, 2);
  const again = deriveTypePropagation(typeEdges, subClassEdges, { budget: 2 });
  assert.deepEqual(d, again, "same inputs → same truncation (deterministic)");
});

// ---- cax-dw: disjointness violations — x:C1, C1 disjointWith C2 ⊨ x∉C2 -------

test("deriveDisjointViolations: direct member — x:C1, C1 disjointWith C2 ⊨ x is NOT C2", () => {
  const d = deriveDisjointViolations([["redis.mjs", "cache"]], [], [["cache", "queue"]]);
  assert.deepEqual(d, [{ subject: "redis.mjs", object: "queue", viaType: "cache", viaClass: "cache" }]);
});

test("deriveDisjointViolations: disjointWith is symmetric — the taught direction doesn't matter", () => {
  const d = deriveDisjointViolations([["redis.mjs", "cache"]], [], [["queue", "cache"]]); // reverse of the above
  assert.deepEqual(d, [{ subject: "redis.mjs", object: "queue", viaType: "cache", viaClass: "cache" }]);
});

test("deriveDisjointViolations: the ⊑-lift — x∈mock, mock⊑fixture, fixture disjointWith test ⊨ x∉test", () => {
  const d = deriveDisjointViolations(
    [["e01.mjs", "mock"]],
    [["mock", "fixture"]],
    [["fixture", "test"]],
  );
  assert.deepEqual(d, [{ subject: "e01.mjs", object: "test", viaType: "mock", viaClass: "fixture" }]);
});

test("deriveDisjointViolations: a MULTI-hop ⊑-lift also reaches the disjoint ancestor (mock⊑fixture⊑asset)", () => {
  const d = deriveDisjointViolations(
    [["e01.mjs", "mock"]],
    [["mock", "fixture"], ["fixture", "asset"]],
    [["asset", "test"]],
  );
  assert.deepEqual(d, [{ subject: "e01.mjs", object: "test", viaType: "mock", viaClass: "asset" }]);
});

test("deriveDisjointViolations: an unrelated pair is NEVER asserted — no connecting disjointness, nothing derived "
  + "(the honest 'cannot be proven' floor is the CALLER's job, not a fabricated 'no' here)", () => {
  const d = deriveDisjointViolations([["e02.mjs", "widget"]], [], [["cache", "queue"]]);
  assert.deepEqual(d, [], "widget has no stated disjointness with anything — silence, never a guessed no");
});

test("deriveDisjointViolations: no disjointWith facts at all ⊨ nothing derived", () => {
  assert.deepEqual(deriveDisjointViolations([["x", "c"]], [], []), []);
});

test("deriveDisjointViolations: dedup/novelty screen — an already-known instance-level disjointWith is not re-derived "
  + "(this is ALSO syllogise()'s idempotency mechanism: a prior pass's own entailed rows feed back in as disjointEdges)", () => {
  const d = deriveDisjointViolations(
    [["redis.mjs", "cache"]],
    [],
    [["cache", "queue"], ["redis.mjs", "queue"]], // the conclusion is already present
  );
  assert.deepEqual(d, []);
});

test("deriveDisjointViolations: focus-connection — a derivation must touch focus (one step out)", () => {
  const typeEdges = [["redis.mjs", "cache"]];
  const disjointEdges = [["cache", "queue"]];
  assert.deepEqual(deriveDisjointViolations(typeEdges, [], disjointEdges, { focus: new Set(["z"]) }), [], "unrelated focus → nothing");
  assert.deepEqual(
    deriveDisjointViolations(typeEdges, [], disjointEdges, { focus: new Set(["cache"]) }),
    [{ subject: "redis.mjs", object: "queue", viaType: "cache", viaClass: "cache" }],
  );
  assert.deepEqual(
    deriveDisjointViolations(typeEdges, [], disjointEdges, { focus: new Set(["redis.mjs"]) }),
    [{ subject: "redis.mjs", object: "queue", viaType: "cache", viaClass: "cache" }],
  );
});

test("deriveDisjointViolations: hard budget caps derivations, deterministically", () => {
  const typeEdges = [["x", "c"]];
  const disjointEdges = [["c", "d1"], ["c", "d2"], ["c", "d3"]];
  const d = deriveDisjointViolations(typeEdges, [], disjointEdges, { budget: 2 });
  assert.equal(d.length, 2);
  const again = deriveDisjointViolations(typeEdges, [], disjointEdges, { budget: 2 });
  assert.deepEqual(d, again, "same inputs → same truncation (deterministic)");
});

// ---- cls-svf1: someValuesFrom application — x P y, y:C2, R onProperty P, ----
// ---- R someValuesFrom C2 ⊨ x:R (the restriction CLASS itself) --------------

test("deriveSomeValuesFromApplication: x P y, y:C2, R onProperty P, R someValuesFrom C2 ⊨ x:R", () => {
  const d = deriveSomeValuesFromApplication(
    [["chat.mjs", "tmct:imports", "parse.test.mjs"]],
    [["parse.test.mjs", "test"]],
    [],
    [{ restriction: "some-imports-test", property: "imports", target: "test" }],
  );
  assert.deepEqual(d, [{
    subject: "chat.mjs", object: "some-imports-test",
    viaProperty: "tmct:imports", viaPropertyKey: "imports",
    viaValue: "parse.test.mjs", viaType: "test", viaTarget: "test",
  }]);
});

test("deriveSomeValuesFromApplication: no restriction declared over the property at all ⊨ nothing derived", () => {
  const d = deriveSomeValuesFromApplication(
    [["chat.mjs", "tmct:imports", "parse.test.mjs"]],
    [["parse.test.mjs", "test"]],
    [], [],
  );
  assert.deepEqual(d, []);
});

test("deriveSomeValuesFromApplication: the ⊑-lift — y's type is a SUBCLASS of the restriction's declared target "
  + "(y:mock, mock⊑fixture, R someValuesFrom fixture ⊨ x:R)", () => {
  const d = deriveSomeValuesFromApplication(
    [["x", "tmct:uses", "e01.mjs"]],
    [["e01.mjs", "mock"]],
    [["mock", "fixture"]],
    [{ restriction: "some-uses-fixture", property: "uses", target: "fixture" }],
  );
  assert.deepEqual(d, [{
    subject: "x", object: "some-uses-fixture",
    viaProperty: "tmct:uses", viaPropertyKey: "uses",
    viaValue: "e01.mjs", viaType: "mock", viaTarget: "fixture",
  }]);
});

test("deriveSomeValuesFromApplication: an unmatched property/type pair is NEVER asserted — silence, not a guess", () => {
  const d = deriveSomeValuesFromApplication(
    [["chat.mjs", "tmct:imports", "widget.mjs"]],
    [["widget.mjs", "widget"]],
    [],
    [{ restriction: "some-imports-test", property: "imports", target: "test" }],
  );
  assert.deepEqual(d, [], "widget.mjs is not a test — no restriction matches, nothing derived");
});

test("deriveSomeValuesFromApplication: dedup/novelty screen — x:R already present is not re-derived", () => {
  const d = deriveSomeValuesFromApplication(
    [["chat.mjs", "tmct:imports", "parse.test.mjs"]],
    [["parse.test.mjs", "test"], ["chat.mjs", "some-imports-test"]],
    [],
    [{ restriction: "some-imports-test", property: "imports", target: "test" }],
  );
  assert.deepEqual(d, []);
});

test("deriveSomeValuesFromApplication: raw vs. normalized predicate spelling converge — a stored fact's RAW "
  + "predicate (e.g. 'tmct:imports') matches an owl:onProperty row's normFactTerm'd object ('imports')", () => {
  const d = deriveSomeValuesFromApplication(
    [["chat.mjs", "TMCT:Imports", "parse.test.mjs"]], // deliberately odd casing — normFactTerm lowercases
    [["parse.test.mjs", "test"]],
    [],
    [{ restriction: "some-imports-test", property: "imports", target: "test" }],
  );
  assert.equal(d.length, 1, "the raw predicate normalizes to the same key the restriction was declared under");
});

test("deriveSomeValuesFromApplication: focus-connection — a derivation must touch focus (one step out)", () => {
  const propertyEdges = [["chat.mjs", "tmct:imports", "parse.test.mjs"]];
  const typeEdges = [["parse.test.mjs", "test"]];
  const restrictionEdges = [{ restriction: "some-imports-test", property: "imports", target: "test" }];
  assert.deepEqual(
    deriveSomeValuesFromApplication(propertyEdges, typeEdges, [], restrictionEdges, { focus: new Set(["z"]) }),
    [], "unrelated focus → nothing",
  );
  assert.deepEqual(
    deriveSomeValuesFromApplication(propertyEdges, typeEdges, [], restrictionEdges, { focus: new Set(["parse.test.mjs"]) }),
    [{
      subject: "chat.mjs", object: "some-imports-test",
      viaProperty: "tmct:imports", viaPropertyKey: "imports",
      viaValue: "parse.test.mjs", viaType: "test", viaTarget: "test",
    }],
  );
});

test("deriveSomeValuesFromApplication: hard budget caps derivations, deterministically", () => {
  const propertyEdges = [["x1", "tmct:imports", "y"], ["x2", "tmct:imports", "y"], ["x3", "tmct:imports", "y"]];
  const typeEdges = [["y", "test"]];
  const restrictionEdges = [{ restriction: "some-imports-test", property: "imports", target: "test" }];
  const d = deriveSomeValuesFromApplication(propertyEdges, typeEdges, [], restrictionEdges, { budget: 2 });
  assert.equal(d.length, 2);
  const again = deriveSomeValuesFromApplication(propertyEdges, typeEdges, [], restrictionEdges, { budget: 2 });
  assert.deepEqual(d, again, "same inputs → same truncation (deterministic)");
});

// ---- buildCardinalityRestrictions: pattern-5 reconstruction ----

const CARD_ROWS = [
  { subject: "exactly-3-test", predicate: "rdf:type", object: "restriction" },
  { subject: "exactly-3-test", predicate: "owl:onProperty", object: "has" },
  { subject: "exactly-3-test", predicate: "owl:cardinality", object: "3" },
  { subject: "exactly-3-test", predicate: "owl:onClass", object: "test" },
  { subject: "min-2-fixture", predicate: "owl:onProperty", object: "has" },
  { subject: "min-2-fixture", predicate: "owl:minCardinality", object: "2" },
  { subject: "min-2-fixture", predicate: "owl:onClass", object: "fixture" },
  { subject: "max-0-queue", predicate: "owl:onProperty", object: "has" },
  { subject: "max-0-queue", predicate: "owl:maxCardinality", object: "0" },
  { subject: "max-0-queue", predicate: "owl:onClass", object: "queue" },
];

test("buildCardinalityRestrictions: reconstructs exactly/min/max records, joined by restriction id", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  assert.deepEqual(recs, [
    { restriction: "exactly-3-test", kind: "exactly", n: 3, onClass: "test" },
    { restriction: "max-0-queue", kind: "max", n: 0, onClass: "queue" },
    { restriction: "min-2-fixture", kind: "min", n: 2, onClass: "fixture" },
  ]);
});

test("buildCardinalityRestrictions: a someValuesFrom restriction's onProperty (a REAL verb, not \"has\") "
  + "is never mistaken for a cardinality restriction, even scanned in the SAME row set", () => {
  const mixedRows = [
    ...CARD_ROWS,
    { subject: "some-imports-test", predicate: "owl:onProperty", object: "imports" },
    { subject: "some-imports-test", predicate: "owl:someValuesFrom", object: "test" },
  ];
  const recs = buildCardinalityRestrictions(mixedRows);
  assert.equal(recs.length, 3, "the someValuesFrom restriction contributes no cardinality record at all");
  assert.ok(!recs.some((r) => r.restriction === "some-imports-test"));
});

test("buildCardinalityRestrictions: a restriction missing owl:onClass is never returned", () => {
  const rows = [
    { subject: "exactly-3-x", predicate: "owl:onProperty", object: "has" },
    { subject: "exactly-3-x", predicate: "owl:cardinality", object: "3" },
  ];
  assert.deepEqual(buildCardinalityRestrictions(rows), []);
});

test("buildCardinalityRestrictions: no rows at all is a fast, honest empty", () => {
  assert.deepEqual(buildCardinalityRestrictions([]), []);
});

// ---- deriveSomeValuesFromSubsumption: scm-svf1 (W3C OWL 2 RL Table 9) ----

test("deriveSomeValuesFromSubsumption: two restrictions, SAME property, ⊑-related fillers ⊨ restriction ⊑ restriction", () => {
  const restrictionEdges = [
    { restriction: "some-imports-test", property: "imports", target: "test" },
    { restriction: "some-imports-fixture", property: "imports", target: "fixture" },
  ];
  const d = deriveSomeValuesFromSubsumption(restrictionEdges, [["test", "fixture"]]);
  assert.deepEqual(d, [{
    subject: "some-imports-test", object: "some-imports-fixture", viaY1: "test", viaY2: "fixture",
  }]);
});

test("deriveSomeValuesFromSubsumption: the ⊑-lift — a MULTI-hop filler chain (test⊑mock⊑fixture) still connects", () => {
  const restrictionEdges = [
    { restriction: "some-imports-test", property: "imports", target: "test" },
    { restriction: "some-imports-fixture", property: "imports", target: "fixture" },
  ];
  const subClassEdges = [["test", "mock"], ["mock", "fixture"]];
  const d = deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges);
  assert.deepEqual(d, [{
    subject: "some-imports-test", object: "some-imports-fixture", viaY1: "test", viaY2: "fixture",
  }]);
});

test("deriveSomeValuesFromSubsumption: DIFFERENT properties are never compared, even with ⊑-related fillers", () => {
  const restrictionEdges = [
    { restriction: "some-imports-test", property: "imports", target: "test" },
    { restriction: "some-uses-fixture", property: "uses", target: "fixture" },
  ];
  const d = deriveSomeValuesFromSubsumption(restrictionEdges, [["test", "fixture"]]);
  assert.deepEqual(d, []);
});

test("deriveSomeValuesFromSubsumption: only ONE restriction declared over a property ⊨ nothing to compare", () => {
  const restrictionEdges = [{ restriction: "some-imports-test", property: "imports", target: "test" }];
  assert.deepEqual(deriveSomeValuesFromSubsumption(restrictionEdges, [["test", "fixture"]]), []);
});

test("deriveSomeValuesFromSubsumption: unrelated fillers (no ⊑ either way) ⊨ nothing derived — silence, not a guess", () => {
  const restrictionEdges = [
    { restriction: "some-imports-test", property: "imports", target: "test" },
    { restriction: "some-imports-widget", property: "imports", target: "widget" },
  ];
  const d = deriveSomeValuesFromSubsumption(restrictionEdges, []);
  assert.deepEqual(d, []);
});

test("deriveSomeValuesFromSubsumption: dedup/novelty screen — an already-known restriction⊑restriction edge is not re-derived", () => {
  const restrictionEdges = [
    { restriction: "some-imports-test", property: "imports", target: "test" },
    { restriction: "some-imports-fixture", property: "imports", target: "fixture" },
  ];
  const subClassEdges = [["test", "fixture"], ["some-imports-test", "some-imports-fixture"]];
  const d = deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges);
  assert.deepEqual(d, []);
});

test("deriveSomeValuesFromSubsumption: focus-connection — a derivation must touch focus (one step out)", () => {
  const restrictionEdges = [
    { restriction: "some-imports-test", property: "imports", target: "test" },
    { restriction: "some-imports-fixture", property: "imports", target: "fixture" },
  ];
  const subClassEdges = [["test", "fixture"]];
  assert.deepEqual(
    deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges, { focus: new Set(["z"]) }),
    [], "unrelated focus → nothing",
  );
  assert.equal(
    deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges, { focus: new Set(["some-imports-fixture"]) }).length,
    1,
  );
});

test("deriveSomeValuesFromSubsumption: hard budget caps derivations, deterministically", () => {
  const restrictionEdges = [
    { restriction: "some-imports-test", property: "imports", target: "test" },
    { restriction: "some-imports-fixture", property: "imports", target: "fixture" },
    { restriction: "some-imports-mock", property: "imports", target: "mock" },
  ];
  const subClassEdges = [["test", "fixture"], ["test", "mock"]];
  const d = deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges, { budget: 1 });
  assert.equal(d.length, 1);
  const again = deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges, { budget: 1 });
  assert.deepEqual(d, again, "same inputs → same truncation (deterministic)");
});

// ---- proveCardinalityAtLeast: cardinality monotonicity (confirmed OUTSIDE OWL 2 RL's own profile) ----

test("proveCardinalityAtLeast: exactly n ⊨ at least m, whenever m ≤ n", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  const w = proveCardinalityAtLeast([["suite", "exactly-3-test"]], recs, "suite", "test", 2);
  assert.deepEqual(w, {
    subject: "suite", object: "test", m: 2, n: 3, kind: "exactly", viaClass: "suite", viaRestriction: "exactly-3-test",
  });
});

test("proveCardinalityAtLeast: min n ⊨ at least m too, whenever m ≤ n", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  const w = proveCardinalityAtLeast([["fixture-suite", "min-2-fixture"]], recs, "fixture-suite", "fixture", 1);
  assert.equal(w.kind, "min");
});

test("proveCardinalityAtLeast: a queried m > n is NEVER proven — silence, not a guess", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  assert.equal(proveCardinalityAtLeast([["suite", "exactly-3-test"]], recs, "suite", "test", 4), null);
});

test("proveCardinalityAtLeast: a max-kind restriction never licenses an \"at least\" claim", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  assert.equal(proveCardinalityAtLeast([["cache", "max-0-queue"]], recs, "cache", "queue", 1), null);
});

test("proveCardinalityAtLeast: the ⊑-lift — an inherited restriction (fixture-suite ⊑ suite ⊑ exactly-3-test) still proves", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  const subClassEdges = [["fixture-suite", "suite"], ["suite", "exactly-3-test"]];
  const w = proveCardinalityAtLeast(subClassEdges, recs, "fixture-suite", "test", 2);
  assert.equal(w.viaClass, "suite");
});

test("proveCardinalityAtLeast: an unrelated onClass is never proven", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  assert.equal(proveCardinalityAtLeast([["suite", "exactly-3-test"]], recs, "suite", "widget", 1), null);
});

test("proveCardinalityAtLeast: no declared restriction at all is a fast, honest null", () => {
  assert.equal(proveCardinalityAtLeast([], [], "suite", "test", 1), null);
});

// ---- proveMaxCardinalityZeroDenial: cax-maxc0, grounded in cls-maxc1 via universal generalization ----

test("proveMaxCardinalityZeroDenial: a declared max-0 restriction proves a class-level \"no\"", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  const w = proveMaxCardinalityZeroDenial([["cache", "max-0-queue"]], recs, "cache", "queue");
  assert.deepEqual(w, { subject: "cache", object: "queue", viaClass: "cache", viaRestriction: "max-0-queue" });
});

test("proveMaxCardinalityZeroDenial: an exactly/min restriction never licenses a denial", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  assert.equal(proveMaxCardinalityZeroDenial([["suite", "exactly-3-test"]], recs, "suite", "test"), null);
});

test("proveMaxCardinalityZeroDenial: the ⊑-lift — an inherited max-0 restriction still denies", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  const subClassEdges = [["redis.mjs", "cache"], ["cache", "max-0-queue"]];
  const w = proveMaxCardinalityZeroDenial(subClassEdges, recs, "redis.mjs", "queue");
  assert.equal(w.viaClass, "cache");
});

test("proveMaxCardinalityZeroDenial: NEVER infers \"no\" from absence — a subject with no declared restriction is null", () => {
  assert.equal(proveMaxCardinalityZeroDenial([], [], "widget", "queue"), null);
});

test("proveMaxCardinalityZeroDenial: an unrelated onClass is never denied", () => {
  const recs = buildCardinalityRestrictions(CARD_ROWS);
  assert.equal(proveMaxCardinalityZeroDenial([["cache", "max-0-queue"]], recs, "cache", "widget"), null);
});

// ---- findIsaChain: a bounded, ROOTED proof search (not a third rule) ---------

test("findIsaChain: scm-sco — a taught ⊑-chain of length 2 is found, shortest-first", () => {
  const chain = findIsaChain("a", new Set(["c"]), [], [["a", "b"], ["b", "c"]]);
  assert.deepEqual(chain, [
    { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b" },
    { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c" },
  ]);
});

test("findIsaChain: cax-sco — a taught type + one taught ⊑-edge is found", () => {
  const chain = findIsaChain("redis.mjs", new Set(["component"]), [["redis.mjs", "cache"]], [["cache", "component"]]);
  assert.deepEqual(chain, [
    { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "cache" },
    { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "component" },
  ]);
});

test("findIsaChain: no path within maxHops → null (honest miss, never a guess)", () => {
  assert.equal(findIsaChain("a", new Set(["z"]), [], [["a", "b"], ["b", "c"]]), null);
  assert.equal(findIsaChain("a", new Set(["c"]), [], []), null, "no edges at all");
});

test("findIsaChain: ROOTED at subj only — an unrelated flood of edges elsewhere never steals the search "
  + "(the whole-graph-closure+budget bug this function replaces: a large fact store must never make a real "
  + "2-hop chain unreachable)", () => {
  // hundreds of edges that touch "class" as PIVOT or OBJECT but have nothing to
  // do with the class->migration->promise chain under test — a whole-graph
  // closure with a small shared budget can get flooded by these; a rooted
  // search from "class" must not be.
  const noise = [];
  for (let i = 0; i < 300; i += 1) {
    noise.push([`corpus-term-${i}`, "class"]); // X ⊑ class (touches "class" as object)
  }
  const subClassEdges = [["class", "migration"], ["migration", "promise"], ...noise];
  const chain = findIsaChain("class", new Set(["promise"]), [], subClassEdges);
  assert.deepEqual(chain, [
    { subject: "class", predicate: SUBCLASS_PREDICATE, object: "migration" },
    { subject: "migration", predicate: SUBCLASS_PREDICATE, object: "promise" },
  ]);
});

test("findIsaChain: hop budget — a chain longer than maxHops is not found, exactly at the boundary", () => {
  // a->b->c->d->e is a 4-EDGE chain from a to e.
  const edges = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]];
  assert.equal(findIsaChain("a", new Set(["e"]), [], edges, { maxHops: 2 }), null, "e is 4 hops away, budget 2 — not found");
  assert.equal(findIsaChain("a", new Set(["e"]), [], edges, { maxHops: 3 }), null, "e is 4 hops away, budget 3 — NOT found either (no off-by-one)");
  const chain = findIsaChain("a", new Set(["e"]), [], edges, { maxHops: 4 });
  assert.equal(chain?.length, 4, "budget 4 exactly reaches e — found, no more no less");
  // a shorter target within the SAME graph is found even at a small budget
  assert.deepEqual(
    findIsaChain("a", new Set(["b"]), [], edges, { maxHops: 1 }),
    [{ subject: "a", predicate: SUBCLASS_PREDICATE, object: "b" }],
  );
});

// ---- the materialising pass: entailed provenance, low trust, never outranks --

test("syllogise: materializes a⊑c as an entailed, low-trust, retractable Fact", async () => {
  const dir = await mkRepo();
  try {
    // stated premises (corpus band, trust ≈ 0.7)
    await appendFact(dir, { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "store", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "store", predicate: SUBCLASS_PREDICATE, object: "component", provenance: "corpus:conceptnet /r/IsA" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(before, "cache", "component"), "cache⊑component is a MISS before the pass");

    const res = await syllogise(dir);
    assert.equal(res.count, 1);
    assert.deepEqual(res.derived.map((d) => [d.subject, d.object]), [["cache", "component"]]);

    const after = readFactRows(await loadMemory(dir));
    const derived = subClassRows(after).find((r) => r.subject === "cache" && r.object === "component");
    assert.ok(derived, "cache⊑component is now a stored Fact (miss → hit)");
    assert.match(derived.provenance, /entailed:subClassOf/, "carries entailed provenance");
    assert.ok(derived.sourceTypes.includes("entailed"), "backed by a first-class entailed Source");

    // never outranks a stated fact: entailed trust (prior 0.3) < stated corpus trust
    const stated = subClassRows(after).find((r) => r.subject === "cache" && r.object === "store");
    assert.ok(derived.trust < 0.5, `entailed trust is low (${derived.trust})`);
    assert.ok(derived.trust < stated.trust, "an entailed conclusion never outranks its stated premise");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: idempotent — a second pass derives nothing new (dedup on stored entailments)", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:conceptnet /r/IsA" });
    assert.equal((await syllogise(dir)).count, 1);
    assert.equal((await syllogise(dir)).count, 0, "closure already materialized → nothing to add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: materializes cax-sco (x:C) too, in the SAME pass as scm-sco, seeing its OWN scm-sco conclusions", async () => {
  const dir = await mkRepo();
  try {
    // taught: redis.mjs is a cache; every cache is a store; every store is a component
    await appendFact(dir, { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "cache", provenance: "ace:chat:s1@2026-07-08T00:00:00.000Z" });
    await appendFact(dir, { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "store", provenance: "ace:chat:s1@2026-07-08T00:00:01.000Z" });
    await appendFact(dir, { subject: "store", predicate: SUBCLASS_PREDICATE, object: "component", provenance: "ace:chat:s1@2026-07-08T00:00:02.000Z" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(before, "cache", "component"), "cache⊑component is a scm-sco MISS before the pass");
    assert.ok(!hasType(before, "redis.mjs", "store"), "redis.mjs:store is a cax-sco MISS before the pass");
    assert.ok(!hasType(before, "redis.mjs", "component"), "redis.mjs:component is a cax-sco MISS before the pass (needs cache⊑component too)");

    const res = await syllogise(dir);
    // scm-sco: cache⊑component. cax-sco: redis.mjs:store, redis.mjs:component (via the
    // ENLARGED subClassOf set this same pass just derived) — cax-sco reaches the WHOLE
    // chain in one call, no second `tmct syllogise` invocation needed.
    assert.equal(res.count, 3);
    assert.deepEqual(new Set(res.derived.map((d) => `${d.rule}:${d.subject}->${d.object}`)), new Set([
      "subClassOf:cache->component",
      "type:redis.mjs->store",
      "type:redis.mjs->component",
    ]));

    const after = readFactRows(await loadMemory(dir));
    assert.ok(hasEdge(after, "cache", "component"), "cache⊑component now stored (scm-sco)");
    assert.ok(hasType(after, "redis.mjs", "store"), "redis.mjs:store now stored (cax-sco)");
    assert.ok(hasType(after, "redis.mjs", "component"), "redis.mjs:component now stored (cax-sco over the enlarged closure)");

    const caxRow = typeRows(after).find((r) => r.subject === "redis.mjs" && r.object === "component");
    assert.match(caxRow.provenance, /entailed:type/, "carries entailed:type provenance");
    assert.ok(caxRow.sourceTypes.includes("entailed"), "backed by a first-class entailed Source");
    assert.ok(caxRow.trust < 0.5, `entailed trust is low (${caxRow.trust})`);

    // idempotent: a second pass derives nothing new
    assert.equal((await syllogise(dir)).count, 0, "closure already materialized (both rules) → nothing to add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- cax-dw: syllogise() materializes disjointness violations, a provable "no" -

test("syllogise: cax-dw materializes a direct disjoint-type violation as a provable 'no' Fact", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "cache", predicate: DISJOINT_PREDICATE, object: "queue", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "cache", provenance: "ace:chat:s1" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasDisjoint(before, "redis.mjs", "queue"), "'redis.mjs is not a queue' is a MISS before the pass");

    const res = await syllogise(dir);
    assert.ok(res.derived.some((d) => d.rule === CAX_DW_RULE && d.subject === "redis.mjs" && d.object === "queue"));

    const after = readFactRows(await loadMemory(dir));
    const derived = disjointRows(after).find((r) => r.subject === "redis.mjs" && r.object === "queue");
    assert.ok(derived, "'redis.mjs is not a queue' is now a stored, provable Fact (miss → hit)");
    assert.match(derived.provenance, /entailed:disjointWith/, "carries entailed:disjointWith provenance");
    assert.ok(derived.sourceTypes.includes("entailed"), "backed by a first-class entailed Source");

    // idempotent: a second pass derives nothing new
    assert.equal((await syllogise(dir)).count, 0, "the violation is already materialized → nothing to add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: cax-dw materializes the ⊑-LIFTED case — x∈mock, mock⊑fixture, fixture disjointWith test "
  + "(reuses deriveSubClassClosure's/deriveTypePropagation's ancestor-closure machinery, not a reimplementation)", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "fixture", predicate: DISJOINT_PREDICATE, object: "test", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "mock", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e01.mjs", predicate: TYPE_PREDICATE, object: "mock", provenance: "ace:chat:s1" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasDisjoint(before, "e01.mjs", "test"), "'e01.mjs is not a test' is a MISS before the pass");

    const res = await syllogise(dir);
    assert.ok(res.derived.some((d) => d.rule === CAX_DW_RULE && d.subject === "e01.mjs" && d.object === "test"));

    const after = readFactRows(await loadMemory(dir));
    assert.ok(hasDisjoint(after, "e01.mjs", "test"), "'e01.mjs is not a test' now stored, reached via the mock⊑fixture lift");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: cax-dw NEVER asserts a 'no' for an unrelated pair — silence, not a guessed no "
  + "(the 'cannot be proven' answer shape is chat.mjs's job, not this rule's)", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "cache", predicate: DISJOINT_PREDICATE, object: "queue", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e02.mjs", predicate: TYPE_PREDICATE, object: "widget", provenance: "ace:chat:s1" });

    const res = await syllogise(dir);
    assert.ok(!res.derived.some((d) => d.rule === CAX_DW_RULE), "widget has no stated disjointness — cax-dw derives nothing for it");

    const after = readFactRows(await loadMemory(dir));
    assert.equal(disjointRows(after).filter((r) => r.subject === "e02.mjs").length, 0, "no fabricated disjointWith fact for e02.mjs");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: cax-dw's entailed trust is PREMISE-DERIVED (min(premiseTrusts) × ruleConfidence), "
  + "not the bare 0.3 floor", async () => {
  const dir = await mkRepo();
  try {
    // Two DIFFERENT trust tiers so min() is meaningfully picking the weaker
    // premise: the type premise is operator-taught (prior 1.0), the
    // disjointness premise is corpus-sourced (prior 0.7). createdAt is
    // omitted on both (defaults to "now"), so recency is ~1.0 for both and
    // the arithmetic below is exact, not just approximately bounded.
    await appendFact(dir, { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "cache", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "cache", predicate: DISJOINT_PREDICATE, object: "queue", provenance: "corpus:conceptnet /r/IsA" });

    const before = readFactRows(await loadMemory(dir));
    const typeTrust = before.find((r) => r.predicate === TYPE_PREDICATE && r.subject === "redis.mjs" && r.object === "cache").trust;
    const dwTrust = before.find((r) => r.predicate === DISJOINT_PREDICATE && r.subject === "cache" && r.object === "queue").trust;
    assert.notEqual(typeTrust, dwTrust, "premises must sit at DIFFERENT trust tiers for min() to matter");

    await syllogise(dir);
    const after = readFactRows(await loadMemory(dir));
    const derived = disjointRows(after).find((r) => r.subject === "redis.mjs" && r.object === "queue");
    assert.ok(derived, "the violation was derived");

    const expected = round6(Math.min(typeTrust, dwTrust) * CAX_DW_RULE_CONFIDENCE);
    assert.equal(derived.trust, expected, `entailed trust is premise-derived: expected ${expected}, got ${derived.trust}`);
    assert.notEqual(derived.trust, 0.3, "not the bare entailed floor");
    assert.ok(derived.trust < Math.min(typeTrust, dwTrust), "still strictly below its weakest premise — never outranks a stated fact");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- cls-svf1: syllogise() materializes someValuesFrom restriction membership -
// ---- (the worked "chat.mjs imports parse.test.mjs" example — deliberately -------
// ---- stops at "x is a some-imports-test" restriction membership, NOT the ----
// ---- further "x is a suite" intersection step, see this module's own ----
// ---- header comment) -----------------------------------------------

test("syllogise: cls-svf1 materializes someValuesFrom restriction membership from THREE ACE-taught "
  + "sentences — 'every module that imports a test is a suite', 'chat.mjs imports parse.test.mjs', "
  + "'parse.test.mjs is a test' — no representational gap, pattern 4's own triples", async () => {
  const dir = await mkRepo();
  try {
    await assertSentence(dir, "every module that imports a test is a suite", { provenance: { source: "chat" } });
    await assertSentence(dir, "chat.mjs imports parse.test.mjs", { provenance: { source: "chat" } });
    await assertSentence(dir, "parse.test.mjs is a test", { provenance: { source: "chat" } });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasType(before, "chat.mjs", "some-imports-test"), "'chat.mjs is a some-imports-test' is a MISS before the pass");

    const res = await syllogise(dir);
    assert.ok(res.derived.some((d) => d.rule === CLS_SVF1_RULE && d.subject === "chat.mjs" && d.object === "some-imports-test"));

    const after = readFactRows(await loadMemory(dir));
    const derived = typeRows(after).find((r) => r.subject === "chat.mjs" && r.object === "some-imports-test");
    assert.ok(derived, "'chat.mjs is a some-imports-test' is now a stored Fact (miss → hit)");
    assert.match(derived.provenance, /entailed:someValuesFrom/, "carries entailed:someValuesFrom provenance");
    assert.ok(derived.sourceTypes.includes("entailed"), "backed by a first-class entailed Source");
    assert.ok(derived.trust < 1, "entailed trust never reaches the ACE-operator 1.0 ceiling its premises sit at");

    // idempotent: a second pass derives nothing new
    assert.equal((await syllogise(dir)).count, 0, "the restriction membership is already materialized → nothing to add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: cls-svf1's ⊑-lift — y's type is a SUBCLASS of the restriction's declared target class "
  + "(mirrors cax-dw's own lift)", async () => {
  const dir = await mkRepo();
  try {
    await assertSentence(dir, "every module that uses a fixture is a suite", { provenance: { source: "chat" } });
    await appendFact(dir, { subject: "e01.mjs", predicate: "tmct:uses", object: "e02.mjs", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e02.mjs", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" });
    // e02.mjs is never directly typed "fixture" — only a SUBCLASS "mock" of it.
    await appendFact(dir, { subject: "mock", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e03.mjs", predicate: TYPE_PREDICATE, object: "mock", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e01.mjs", predicate: "tmct:uses", object: "e03.mjs", provenance: "ace:chat:s1" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasType(before, "e01.mjs", "some-uses-fixture"), "MISS before the pass");

    await syllogise(dir);
    const after = readFactRows(await loadMemory(dir));
    assert.ok(hasType(after, "e01.mjs", "some-uses-fixture"), "reached via the mock⊑fixture lift on e03.mjs's type");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: cls-svf1 NEVER asserts membership for an unmatched property/type pair — silence, not a guess", async () => {
  const dir = await mkRepo();
  try {
    await assertSentence(dir, "every module that imports a test is a suite", { provenance: { source: "chat" } });
    await assertSentence(dir, "chat.mjs imports widget.mjs", { provenance: { source: "chat" } });
    await assertSentence(dir, "widget.mjs is a template", { provenance: { source: "chat" } });
    // the mismatch must be real, not vacuous: the value's type actually stored
    assert.ok(hasType(readFactRows(await loadMemory(dir)), "widget.mjs", "template"));

    const res = await syllogise(dir);
    assert.ok(!res.derived.some((d) => d.rule === CLS_SVF1_RULE), "widget.mjs is not a test — cax-svf1 derives nothing for it");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: cls-svf1's entailed trust is PREMISE-DERIVED (min(premiseTrusts) × ruleConfidence), "
  + "not the bare 0.3 floor — mirrors cax-dw's own exit criterion, closed here for cls-svf1", async () => {
  const dir = await mkRepo();
  try {
    // Different trust tiers so min() is meaningfully picking the weaker
    // premise: the restriction + property-edge premises are ACE-operator
    // (prior 1.0), the type premise is corpus-sourced (prior 0.7).
    await assertSentence(dir, "every module that imports a test is a suite", { provenance: { source: "chat" } });
    await assertSentence(dir, "chat.mjs imports parse.test.mjs", { provenance: { source: "chat" } });
    await appendFact(dir, { subject: "parse.test.mjs", predicate: TYPE_PREDICATE, object: "test", provenance: "corpus:conceptnet /r/IsA" });

    const before = readFactRows(await loadMemory(dir));
    const onPropTrust = before.find((r) => r.predicate === ON_PROPERTY_PREDICATE && r.subject === "some-imports-test").trust;
    const typeTrust = before.find((r) => r.predicate === TYPE_PREDICATE && r.subject === "parse.test.mjs" && r.object === "test").trust;
    assert.notEqual(onPropTrust, typeTrust, "premises must sit at DIFFERENT trust tiers for min() to matter");

    await syllogise(dir);
    const after = readFactRows(await loadMemory(dir));
    const derived = typeRows(after).find((r) => r.subject === "chat.mjs" && r.object === "some-imports-test");
    assert.ok(derived, "the restriction membership was derived");
    assert.ok(derived.trust < Math.min(onPropTrust, typeTrust), "strictly below its weakest premise — never outranks a stated fact");
    assert.notEqual(derived.trust, 0.3, "not the bare entailed floor");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- scm-svf1 joins syllogise()'s materializing batch pass (this session's ---
// ---- own trust-hook-gap fix — was LIVE-CHASE ONLY, see src/domain/syllogise.mjs's --
// ---- header comment for the "deferred, not merely" distinction) --------------

test("syllogise: scm-svf1 materializes restriction-to-restriction subsumption from TWO independently-taught "
  + "someValuesFrom restrictions over the SAME property, whose fillers are ⊑-related", async () => {
  const dir = await mkRepo();
  try {
    await assertSentence(dir, "every module that imports a method is a formatter", { provenance: { source: "chat" } });
    await assertSentence(dir, "every module that imports a fixture is a suite", { provenance: { source: "chat" } });
    await appendFact(dir, { subject: "method", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(before, "some-imports-method", "some-imports-fixture"), "MISS before the pass");

    const res = await syllogise(dir);
    assert.ok(res.derived.some((d) => d.rule === SCM_SVF_RULE && d.subject === "some-imports-method" && d.object === "some-imports-fixture"));

    const after = readFactRows(await loadMemory(dir));
    const derived = subClassRows(after).find((r) => r.subject === "some-imports-method" && r.object === "some-imports-fixture");
    assert.ok(derived, "'some-imports-method ⊑ some-imports-fixture' is now a stored Fact (miss → hit)");
    assert.match(derived.provenance, /entailed:someValuesFromSubsumption/);
    assert.ok(derived.sourceTypes.includes("entailed"), "backed by a first-class entailed Source");
    assert.ok(derived.trust < 1, "entailed trust never reaches the ACE-operator 1.0 ceiling its premises sit at");

    // idempotent: a second pass derives nothing new
    assert.equal((await syllogise(dir)).count, 0, "the restriction subsumption is already materialized → nothing to add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: scm-svf1 NEVER asserts subsumption for unrelated fillers — silence, not a guess", async () => {
  const dir = await mkRepo();
  try {
    await assertSentence(dir, "every module that imports a method is a formatter", { provenance: { source: "chat" } });
    await assertSentence(dir, "every module that imports a template is a suite", { provenance: { source: "chat" } });
    // no ⊑ relation taught between "method" and "template" at all — and BOTH
    // restrictions must really be stored, or the "nothing derives" assertion
    // below is vacuous (scm-svf1 needs two restrictions to compare at all)
    const stored = readFactRows(await loadMemory(dir));
    assert.ok(stored.some((r) => r.subject === "some-imports-method" && r.predicate === SOME_VALUES_FROM_PREDICATE));
    assert.ok(stored.some((r) => r.subject === "some-imports-template" && r.predicate === SOME_VALUES_FROM_PREDICATE));

    const res = await syllogise(dir);
    assert.ok(!res.derived.some((d) => d.rule === SCM_SVF_RULE), "unrelated fillers — scm-svf1 derives nothing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: scm-svf1's entailed trust is PREMISE-DERIVED (min(premiseTrusts) × ruleConfidence), "
  + "not the bare 0.3 floor — mirrors cax-dw/cls-svf1's own exit criterion, closed here for scm-svf1", async () => {
  const dir = await mkRepo();
  try {
    // Different trust tiers so min() is meaningfully picking the weaker
    // premise: the two restrictions' own scaffolding is ACE-operator (1.0),
    // the method⊑fixture lift premise is corpus-sourced (0.7).
    await assertSentence(dir, "every module that imports a method is a formatter", { provenance: { source: "chat" } });
    await assertSentence(dir, "every module that imports a fixture is a suite", { provenance: { source: "chat" } });
    await appendFact(dir, { subject: "method", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "corpus:conceptnet /r/IsA" });

    const before = readFactRows(await loadMemory(dir));
    const onPropTrust = before.find((r) => r.predicate === ON_PROPERTY_PREDICATE && r.subject === "some-imports-method").trust;
    const liftTrust = before.find((r) => r.predicate === SUBCLASS_PREDICATE && r.subject === "method" && r.object === "fixture").trust;
    assert.notEqual(onPropTrust, liftTrust, "premises must sit at DIFFERENT trust tiers for min() to matter");

    await syllogise(dir);
    const after = readFactRows(await loadMemory(dir));
    const derived = subClassRows(after).find((r) => r.subject === "some-imports-method" && r.object === "some-imports-fixture");
    assert.ok(derived, "the restriction subsumption was derived");
    assert.equal(derived.trust, round6(Math.min(onPropTrust, liftTrust) * SCM_SVF_RULE_CONFIDENCE));
    assert.ok(derived.trust < Math.min(onPropTrust, liftTrust), "strictly below its weakest premise — never outranks a stated fact");
    assert.notEqual(derived.trust, 0.3, "not the bare entailed floor");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- entailedTrustFrom: the live-chase trust hook (chat.mjs's scm-svf1/ -----
// ---- cardinality-monotonicity/cax-maxc0 call sites, which have no Fact/ -----
// ---- appendFacts call to delegate to — src/domain/syllogise.mjs's own doc comment) -

test("entailedTrustFrom: min(premiseTrusts) × ruleConfidence, rounded to 6dp", () => {
  assert.equal(entailedTrustFrom([1, 0.7, 0.95], CARDINALITY_RULE_CONFIDENCE), round6(0.7 * CARDINALITY_RULE_CONFIDENCE));
  assert.equal(entailedTrustFrom([0.9], CAX_MAXC0_RULE_CONFIDENCE), round6(0.9 * CAX_MAXC0_RULE_CONFIDENCE));
});

test("entailedTrustFrom: no numeric premise at all → null, never a magic default", () => {
  assert.equal(entailedTrustFrom([], SCM_SVF_RULE_CONFIDENCE), null);
  assert.equal(entailedTrustFrom([undefined, undefined], SCM_SVF_RULE_CONFIDENCE), null);
  assert.equal(entailedTrustFrom(null, SCM_SVF_RULE_CONFIDENCE), null);
});

test("entailedTrustFrom: clamped to [0,1] even if a caller hands a confidence > 1", () => {
  assert.equal(entailedTrustFrom([1], 2), 1);
});

test("entailedTrustFrom: never outranks its weakest premise (ruleConfidence < 1 strictly discounts)", () => {
  const t = entailedTrustFrom([1, 1], SCM_SVF_RULE_CONFIDENCE);
  assert.ok(t < 1);
  assert.equal(t, SCM_SVF_RULE_CONFIDENCE);
});

// ---- THE KILL CRITERION, on the real default seed ----------------------------
// Does pre-derivation flip a REAL subclass-chain miss? Measured against the
// DEFAULT W3 bootstrap seed (SEED_LIMIT=500, subClassOf-preferred — exactly what
// chat.mjs seeds a fresh repo with), not a hand fixture. If a bounded pass
// derives a chain-closure fact a subclass-chain query then answers (that missed
// before), this is YES with a concrete fact. If it derives nothing, this FAILS
// loudly — the honest STOP signal, never weakened to force a pass.

test("KILL CRITERION: on the default seed, a bounded pass flips a real subclass-chain miss to a hit", async () => {
  // Shared fixture (test/helpers/seeded-fixture.mjs): the seed's own parse+write
  // pass is built ONCE per process and copied here — this test consumes the
  // seeded material (its closure-worthy chains), it isn't testing the seed
  // pipeline itself.
  const { dir, seedResult: seeded } = await freshConceptNetRepo("tmct-syllog-");
  try {
    assert.ok(seeded.appended > 0, "the default seed wrote real material");

    const before = readFactRows(await loadMemory(dir));
    const statedChains = subClassRows(before);
    assert.ok(statedChains.length > 0, "the seed contains stated subClassOf facts");

    // What the closure SHOULD yield from exactly this seeded material (pure).
    const edges = statedChains.map((r) => [r.subject, r.object]);
    const expected = deriveSubClassClosure(edges); // default budget 50, whole-graph
    assert.ok(
      expected.length > 0,
      "the default seed must contain at least one transitive subclass chain to close — " +
        "if this ever fails, Phase 9 has drawn no blood on real material (the honest STOP)",
    );

    // Each expected conclusion is a genuine MISS in the seeded store.
    for (const e of expected) {
      assert.ok(!hasEdge(before, e.subject, e.object), `${e.subject}⊑${e.object} is a miss before the pass`);
    }

    const res = await syllogise(dir); // whole-graph, default budget — the real batch pass
    assert.ok(res.count > 0, "the bounded pass derived at least one closure fact");

    const after = readFactRows(await loadMemory(dir));
    // The concrete flip: the first expected conclusion now answers via the memory fact path.
    const flip = expected[0];
    assert.ok(
      hasEdge(after, flip.subject, flip.object),
      `KILL CRITERION MET: "${flip.subject} ⊑ ${flip.object}" (via ${flip.via}) was a MISS, now a stored, ` +
        "retrievable Fact after speculation",
    );
    const flipRow = subClassRows(after).find((r) => r.subject === flip.subject && r.object === flip.object);
    assert.match(flipRow.provenance, /entailed:subClassOf/, "the flipped fact is honestly marked entailed");
    assert.ok(flipRow.trust < 0.5, "and carries low, speculative trust");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- findConsistencyViolations ----

test("findConsistencyViolations: a subject taught two directly-disjoint types is a clash", () => {
  const typeEdges = [["e90.mjs", "event"], ["e90.mjs", "server"]];
  const disjointEdges = [["event", "server"]];
  const clashes = findConsistencyViolations(typeEdges, [], disjointEdges);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].subject, "e90.mjs");
  assert.deepEqual([clashes[0].classA, clashes[0].classB].sort(), ["event", "server"]);
  assert.deepEqual([clashes[0].viaA, clashes[0].viaB].sort(), ["event", "server"]);
});

test("findConsistencyViolations: the ⊑-lift — a clash via ancestor classes, not the direct types", () => {
  const typeEdges = [["x1", "mock"], ["x1", "test"]];
  const subClassEdges = [["mock", "fixture"]];
  const disjointEdges = [["fixture", "test"]];
  const clashes = findConsistencyViolations(typeEdges, subClassEdges, disjointEdges);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].subject, "x1");
  assert.deepEqual([clashes[0].classA, clashes[0].classB].sort(), ["mock", "test"]);
  assert.deepEqual([clashes[0].viaA, clashes[0].viaB].sort(), ["fixture", "test"]);
});

test("findConsistencyViolations: two compatible types (no disjointness between them) is not a clash", () => {
  const typeEdges = [["m1", "module"], ["m1", "component"]];
  const disjointEdges = [["cache", "queue"]]; // unrelated pair
  const clashes = findConsistencyViolations(typeEdges, [], disjointEdges);
  assert.deepEqual(clashes, []);
});

test("findConsistencyViolations: a subject with only ONE type never clashes with itself", () => {
  const typeEdges = [["m1", "module"]];
  const disjointEdges = [["module", "module"]]; // pathological self-pair, defensively ignored
  const clashes = findConsistencyViolations(typeEdges, [], disjointEdges);
  assert.deepEqual(clashes, []);
});

test("findConsistencyViolations: no disjointWith facts at all is a fast, honest empty", () => {
  const typeEdges = [["e1", "a"], ["e1", "b"]];
  assert.deepEqual(findConsistencyViolations(typeEdges, [], []), []);
});

test("findConsistencyViolations: a subject clashing on two DIFFERENT pairs reports both, deduped, deterministic order", () => {
  const typeEdges = [["e1", "a"], ["e1", "b"], ["e1", "c"]];
  const disjointEdges = [["a", "b"], ["a", "c"]];
  const clashes = findConsistencyViolations(typeEdges, [], disjointEdges);
  assert.equal(clashes.length, 2);
  const pairs = clashes.map((c) => [c.classA, c.classB].sort().join("+"));
  assert.deepEqual(pairs.sort(), ["a+b", "a+c"]);
  // deterministic: re-running produces byte-identical output
  assert.deepEqual(findConsistencyViolations(typeEdges, [], disjointEdges), clashes);
});

test("findConsistencyViolations: budget caps the number of reported clashes", () => {
  const typeEdges = [["e1", "a"], ["e1", "b"], ["e1", "c"], ["e1", "d"]];
  const disjointEdges = [["a", "b"], ["a", "c"], ["a", "d"]];
  const clashes = findConsistencyViolations(typeEdges, [], disjointEdges, { budget: 2 });
  assert.equal(clashes.length, 2);
});

test("findConsistencyViolations: focus excludes subjects outside the focus set", () => {
  const typeEdges = [["e1", "a"], ["e1", "b"], ["e2", "a"], ["e2", "b"]];
  const disjointEdges = [["a", "b"]];
  const clashes = findConsistencyViolations(typeEdges, [], disjointEdges, { focus: new Set(["e1"]) });
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].subject, "e1");
});

// ---- retractSubClassOf: JTMS-style dependency-directed removal for scm-sco,
// VERIFIED (not assumed)
// against the surviving graph each round, so a fact with a genuine second
// derivation path or an independent direct teaching is never wrongly swept
// up just because its stale, persisted justification broke. ----------------

test("retractSubClassOf: retracting the target itself removes it, an honest no-op when it was never stored", async () => {
  const dir = await mkRepo();
  try {
    const missing = await retractSubClassOf(dir, "ghost", "phantom");
    assert.deepEqual(missing, { retracted: [], count: 0, budget: 50, depth: 32, truncated: false, found: false });

    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    const res = await retractSubClassOf(dir, "a", "b");
    assert.equal(res.found, true);
    assert.equal(res.count, 1);
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(rows, "a", "b"), "the retracted fact is gone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: cascades — retracting a premise removes the entailed conclusion it justified", async () => {
  const dir = await mkRepo();
  try {
    const p1 = await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogise(dir);
    const before = readFactRows(await loadMemory(dir));
    assert.ok(hasEdge(before, "a", "c"), "a⊑c is entailed before retraction");
    const derivedId = subClassRows(before).find((r) => r.subject === "a" && r.object === "c").id;

    const res = await retractSubClassOf(dir, "a", "b");
    assert.equal(res.count, 2, "the premise itself + the ONE entailment it justified");
    assert.deepEqual(new Set(res.retracted), new Set([p1.id, derivedId]));

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(rows, "a", "b"), "a⊑b gone");
    assert.ok(!hasEdge(rows, "a", "c"), "a⊑c gone too — its only justification broke");
    assert.ok(hasEdge(rows, "b", "c"), "b⊑c is untouched — never depended on a⊑b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: cascades transitively across a multi-hop chain (a⊑b⊑c⊑d⊑e)", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await appendFact(dir, { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "d", predicate: SUBCLASS_PREDICATE, object: "e", provenance: "corpus:x" });
    await syllogise(dir, { depth: 32, budget: 50 });

    const res = await retractSubClassOf(dir, "a", "b");
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(subClassRows(rows).filter((r) => r.subject === "a").length, 0, "every a-rooted fact is gone");
    // downstream chain (never rooted at a) is completely untouched
    assert.ok(hasEdge(rows, "b", "c") && hasEdge(rows, "c", "d") && hasEdge(rows, "d", "e") && hasEdge(rows, "b", "e"));
    assert.equal(res.truncated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: a fact with a SECOND, independent derivation path survives — the known JTMS "
  + "over-retraction failure mode this slice's VERIFY step (not a bare justification walk) avoids", async () => {
  const dir = await mkRepo();
  try {
    // a⊑b⊑d AND a⊑c⊑d — two independent routes to a⊑d
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await appendFact(dir, { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await syllogise(dir);
    assert.ok(hasEdge(readFactRows(await loadMemory(dir)), "a", "d"), "a⊑d entailed before retraction");

    const res = await retractSubClassOf(dir, "a", "b");
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(rows, "a", "b"), "the retracted premise is gone");
    assert.ok(hasEdge(rows, "a", "d"), "a⊑d SURVIVES — still supported via a⊑c⊑d, an independent path");
    assert.ok(res.retracted.length === 1, "only the target itself was removed, nothing wrongly cascaded");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: a fact LATER independently taught survives even though its stale entailment "
  + "justification broke — never touches a higher-trust taught-only derivation", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogise(dir);
    // a⊑c was entailed; now an operator directly teaches the SAME triple too
    // (same (s,p,o) → same id → provenance union, appendFact's own contract).
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "ace:operator" });

    const res = await retractSubClassOf(dir, "a", "b");
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(rows, "a", "b"));
    assert.ok(hasEdge(rows, "a", "c"), "a⊑c survives — it is no longer PURELY entailed, independently taught too");
    assert.equal(res.retracted.length, 1, "only the target — the taught fact is never a candidate at all");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: budget bounds the cascade and is honestly flagged truncated", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await appendFact(dir, { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await syllogise(dir);

    const res = await retractSubClassOf(dir, "a", "b", { budget: 1 });
    assert.equal(res.truncated, true, "budget hit before the cascade reached a fixpoint");
    assert.equal(res.count, 1, "only the target itself fit in the budget");
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(rows, "a", "b"), "the target is still removed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: scm-sco conclusions persist a walkable justification (the two premise fact ids), "
  + "read back by readFactRows", async () => {
  const dir = await mkRepo();
  try {
    const p1 = await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    const p2 = await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogise(dir);
    const rows = readFactRows(await loadMemory(dir));
    const derived = subClassRows(rows).find((r) => r.subject === "a" && r.object === "c");
    assert.ok(derived, "a⊑c is entailed");
    assert.deepEqual(new Set(derived.justification), new Set([p1.id, p2.id]));
    // a plain taught/stated fact carries NO justification at all
    const stated = subClassRows(rows).find((r) => r.subject === "a" && r.object === "b");
    assert.deepEqual(stated.justification, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the retraction cascade beyond scm-sco: all four remaining rules persist
// a justification now, and retractSubClassOf's VERIFY step re-derives each
// candidate with the rule family that owns its predicate. -------------------

test("retractSubClassOf: retracting the ⊑ premise retracts the propagated rdf:type it justified, "
  + "while a propagation with a second independent ⊑ route survives the same retraction", async () => {
  const dir = await mkRepo();
  try {
    // store is reachable only through cache; archive through cache AND mirror
    await appendFact(dir, { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "cache", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "mirror", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "store", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "store", predicate: SUBCLASS_PREDICATE, object: "archive", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "mirror", predicate: SUBCLASS_PREDICATE, object: "archive", provenance: "ace:chat:s1" });
    await syllogise(dir);
    const before = readFactRows(await loadMemory(dir));
    assert.ok(hasType(before, "redis.mjs", "store") && hasType(before, "redis.mjs", "archive"), "both types propagate before retraction");
    const propagated = typeRows(before).find((r) => r.subject === "redis.mjs" && r.object === "store");
    assert.ok(propagated.justification.length, "the propagated type persists a walkable justification");

    await retractSubClassOf(dir, "cache", "store");
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(!hasType(rows, "redis.mjs", "store"), "redis.mjs:store retracts — its only ⊑ route broke");
    assert.ok(hasType(rows, "redis.mjs", "archive"), "redis.mjs:archive SURVIVES — still supported via mirror⊑archive");
    assert.ok(hasType(rows, "redis.mjs", "cache") && hasType(rows, "redis.mjs", "mirror"), "the stated types are untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: retracting the ⊑-lift premise retracts the derived disjointWith 'no', "
  + "while a violation still reachable through a second type route survives", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "e01.mjs", predicate: TYPE_PREDICATE, object: "cache", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e01.mjs", predicate: TYPE_PREDICATE, object: "mirror", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "volatile", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "mirror", predicate: SUBCLASS_PREDICATE, object: "volatile", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "fleeting", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "volatile", predicate: DISJOINT_PREDICATE, object: "persistent", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "fleeting", predicate: DISJOINT_PREDICATE, object: "durable", provenance: "ace:chat:s1" });
    await syllogise(dir);
    const before = readFactRows(await loadMemory(dir));
    assert.ok(hasDisjoint(before, "e01.mjs", "persistent") && hasDisjoint(before, "e01.mjs", "durable"), "both violations derive before retraction");
    const violation = disjointRows(before).find((r) => r.subject === "e01.mjs" && r.object === "durable");
    assert.ok(violation.justification.length, "the derived violation persists a walkable justification");

    // durable is reachable only through cache⊑fleeting — the violation retracts
    await retractSubClassOf(dir, "cache", "fleeting");
    const afterFirst = readFactRows(await loadMemory(dir));
    assert.ok(!hasDisjoint(afterFirst, "e01.mjs", "durable"), "e01.mjs's 'not a durable' retracts — its only lift broke");
    assert.ok(hasDisjoint(afterFirst, "e01.mjs", "persistent"), "the unrelated violation is untouched");

    // persistent stays reachable through mirror⊑volatile — the violation survives
    await retractSubClassOf(dir, "cache", "volatile");
    const afterSecond = readFactRows(await loadMemory(dir));
    assert.ok(hasDisjoint(afterSecond, "e01.mjs", "persistent"), "e01.mjs's 'not a persistent' SURVIVES — mirror⊑volatile still supports it");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: retracting the filler-type's ⊑-lift premise retracts the someValuesFrom "
  + "restriction membership, while a membership whose filler keeps a second ⊑ route survives", async () => {
  const dir = await mkRepo();
  try {
    await assertSentence(dir, "every module that uses a fixture is a suite", { provenance: { source: "chat" } });
    await assertSentence(dir, "every module that uses a helper is a formatter", { provenance: { source: "chat" } });
    await appendFact(dir, { subject: "e01.mjs", predicate: "tmct:uses", object: "e02.mjs", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e02.mjs", predicate: TYPE_PREDICATE, object: "mock", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e02.mjs", predicate: TYPE_PREDICATE, object: "stub", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "mock", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "stub", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "mock", predicate: SUBCLASS_PREDICATE, object: "helper", provenance: "ace:chat:s1" });
    await syllogise(dir);
    const before = readFactRows(await loadMemory(dir));
    assert.ok(hasType(before, "e01.mjs", "some-uses-fixture") && hasType(before, "e01.mjs", "some-uses-helper"), "both memberships derive before retraction");
    const membership = typeRows(before).find((r) => r.subject === "e01.mjs" && r.object === "some-uses-helper");
    assert.ok(membership.justification.length, "the derived membership persists a walkable justification");

    // helper is reachable from e02.mjs's types only through mock⊑helper
    await retractSubClassOf(dir, "mock", "helper");
    const afterFirst = readFactRows(await loadMemory(dir));
    assert.ok(!hasType(afterFirst, "e01.mjs", "some-uses-helper"), "the membership retracts — its only lift broke");
    assert.ok(hasType(afterFirst, "e01.mjs", "some-uses-fixture"), "the unrelated membership is untouched");

    // fixture stays reachable through stub⊑fixture — the membership survives
    await retractSubClassOf(dir, "mock", "fixture");
    const afterSecond = readFactRows(await loadMemory(dir));
    assert.ok(hasType(afterSecond, "e01.mjs", "some-uses-fixture"), "the membership SURVIVES — e02.mjs is still a stub, and stub⊑fixture holds");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: retracting the filler ⊑ premise retracts the restriction-to-restriction "
  + "subsumption, while one whose fillers stay ⊑-connected through a surviving chain survives", async () => {
  const dir = await mkRepo();
  try {
    await assertSentence(dir, "every module that imports a method is a formatter", { provenance: { source: "chat" } });
    await assertSentence(dir, "every module that imports a fixture is a suite", { provenance: { source: "chat" } });
    await assertSentence(dir, "every module that imports a helper is a suite", { provenance: { source: "chat" } });
    await appendFact(dir, { subject: "method", predicate: SUBCLASS_PREDICATE, object: "helper", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "method", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" });
    // a second, chained route keeps method⊑fixture true after the direct fact goes
    await appendFact(dir, { subject: "method", predicate: SUBCLASS_PREDICATE, object: "test", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "test", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" });
    await syllogise(dir);
    const before = readFactRows(await loadMemory(dir));
    assert.ok(hasEdge(before, "some-imports-method", "some-imports-helper"), "the helper subsumption derives before retraction");
    assert.ok(hasEdge(before, "some-imports-method", "some-imports-fixture"), "the fixture subsumption derives before retraction");
    const subsumption = subClassRows(before).find((r) => r.subject === "some-imports-method" && r.object === "some-imports-helper");
    assert.ok(subsumption.justification.length, "the derived subsumption persists a walkable justification");

    // method⊑helper is the ONLY filler relation behind the helper subsumption
    await retractSubClassOf(dir, "method", "helper");
    const afterFirst = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(afterFirst, "some-imports-method", "some-imports-helper"), "the subsumption retracts — its filler ⊑ premise broke");
    assert.ok(hasEdge(afterFirst, "some-imports-method", "some-imports-fixture"), "the unrelated subsumption is untouched");

    // method⊑fixture still holds via method⊑test⊑fixture — the subsumption survives
    await retractSubClassOf(dir, "method", "fixture");
    const afterSecond = readFactRows(await loadMemory(dir));
    assert.ok(hasEdge(afterSecond, "some-imports-method", "some-imports-fixture"), "the subsumption SURVIVES — the fillers stay ⊑-connected through test");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- environment sets: a fact with several independent derivations persists
// every premise set (bounded by maxEnvironments), retraction keeps it by set
// membership while ANY environment survives, and a survivor's justification
// is re-grounded so the NEXT retraction still sees it. ----------------------

const envId = (s, p, o) => factIdForTriple(s, p, o);

test("syllogise: a conclusion reachable through two premise sets persists BOTH environments, deterministically, "
  + "and a second pass adds nothing", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "d", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });

    const res = await syllogise(dir);
    assert.equal(res.count, 1, "one conclusion (a⊑c), however many routes reach it");
    assert.equal(res.environmentsAdded, 1, "the second route was recorded as an alternate environment");

    const rows = readFactRows(await loadMemory(dir));
    const derived = subClassRows(rows).find((r) => r.subject === "a" && r.object === "c");
    assert.deepEqual(derived.environments, [
      [envId("a", SUBCLASS_PREDICATE, "b"), envId("b", SUBCLASS_PREDICATE, "c")],
      [envId("a", SUBCLASS_PREDICATE, "d"), envId("d", SUBCLASS_PREDICATE, "c")],
    ], "both premise sets stored, derivation route first, alternates in enumeration order");
    assert.deepEqual(derived.justification, [
      envId("a", SUBCLASS_PREDICATE, "b"), envId("b", SUBCLASS_PREDICATE, "c"),
      envId("a", SUBCLASS_PREDICATE, "d"), envId("d", SUBCLASS_PREDICATE, "c"),
    ], "the flat justification stays the deduped union across environments");

    const again = await syllogise(dir);
    assert.equal(again.count, 0);
    assert.equal(again.environmentsAdded, 0, "everything already recorded — nothing accretes on a re-run");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: maxEnvironments caps the environment set deterministically — five routes, cap 2, "
  + "identical stores end byte-identical", async () => {
  const build = async (dir) => {
    for (const m of ["m1", "m2", "m3", "m4", "m5"]) {
      await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: m, provenance: "corpus:x" });
      await appendFact(dir, { subject: m, predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    }
    return syllogise(dir, { maxEnvironments: 2 });
  };
  const dir1 = await mkRepo();
  const dir2 = await mkRepo();
  try {
    const res1 = await build(dir1);
    const res2 = await build(dir2);
    assert.equal(res1.alternatesTruncated, true, "three of five routes fell to the cap, and that is reported");
    const envsOf = async (dir) => readFactRows(await loadMemory(dir))
      .find((r) => r.subject === "a" && r.predicate === SUBCLASS_PREDICATE && r.object === "c").environments;
    const envs1 = await envsOf(dir1);
    const envs2 = await envsOf(dir2);
    assert.equal(envs1.length, 2, "the cap holds");
    assert.deepEqual(envs1, envs2, "same inputs → same kept environments, same order");
    assert.deepEqual(envs1, [
      [envId("a", SUBCLASS_PREDICATE, "m1"), envId("m1", SUBCLASS_PREDICATE, "c")],
      [envId("a", SUBCLASS_PREDICATE, "m2"), envId("m2", SUBCLASS_PREDICATE, "c")],
    ], "kept in canonical enumeration order: derivation route, then the first alternates");
    assert.deepEqual(res1.derived.map((d) => [d.subject, d.object]), res2.derived.map((d) => [d.subject, d.object]));
  } finally {
    await rm(dir1, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
});

test("syllogise: a later pass records a newly-taught alternate premise set on an already-entailed fact", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogise(dir);
    assert.equal(
      readFactRows(await loadMemory(dir)).find((r) => r.subject === "a" && r.object === "c").environments.length,
      1, "one route taught, one environment stored",
    );

    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "d", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    const res = await syllogise(dir);
    assert.equal(res.environmentsAdded, 1, "the newly-taught route accretes onto the stored fact");
    const derived = readFactRows(await loadMemory(dir)).find((r) => r.subject === "a" && r.object === "c");
    assert.deepEqual(derived.environments, [
      [envId("a", SUBCLASS_PREDICATE, "b"), envId("b", SUBCLASS_PREDICATE, "c")],
      [envId("a", SUBCLASS_PREDICATE, "d"), envId("d", SUBCLASS_PREDICATE, "c")],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: a two-environment fact survives losing one route by set membership, and the "
  + "surviving environment becomes its whole justification (the broken one is pruned)", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await appendFact(dir, { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await syllogise(dir);
    assert.equal(
      readFactRows(await loadMemory(dir)).find((r) => r.subject === "a" && r.object === "d").environments.length,
      2, "both routes recorded before any retraction",
    );

    const res = await retractSubClassOf(dir, "a", "b");
    assert.equal(res.retracted.length, 1, "only the target went — the entailed fact kept a surviving environment");
    const survivor = readFactRows(await loadMemory(dir)).find((r) => r.subject === "a" && r.object === "d");
    assert.ok(survivor, "a⊑d survives");
    assert.deepEqual(survivor.environments, [
      [envId("a", SUBCLASS_PREDICATE, "c"), envId("c", SUBCLASS_PREDICATE, "d")],
    ], "the broken environment was pruned away, the surviving one persisted");
    assert.deepEqual(survivor.justification, [envId("a", SUBCLASS_PREDICATE, "c"), envId("c", SUBCLASS_PREDICATE, "d")]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: after surviving one retraction, retracting the OTHER route removes the fact — "
  + "the re-grounded justification keeps the survivor visible to the next cascade", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await appendFact(dir, { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await syllogise(dir);

    await retractSubClassOf(dir, "a", "b");
    assert.ok(hasEdge(readFactRows(await loadMemory(dir)), "a", "d"), "a⊑d survives the first retraction");

    const res = await retractSubClassOf(dir, "a", "c");
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(rows, "a", "c"), "the second route's premise is gone");
    assert.ok(!hasEdge(rows, "a", "d"), "a⊑d falls with its LAST surviving route — it does not linger on a stale citation");
    assert.equal(res.retracted.length, 2, "the target and the now-unsupported entailment");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: a multi-environment fact falls when ONE cascade breaks every environment it has", async () => {
  const dir = await mkRepo();
  try {
    // both routes to x⊑d pass through the single taught edge x⊑y
    await appendFact(dir, { subject: "x", predicate: SUBCLASS_PREDICATE, object: "y", provenance: "corpus:x" });
    await appendFact(dir, { subject: "y", predicate: SUBCLASS_PREDICATE, object: "a", provenance: "corpus:x" });
    await appendFact(dir, { subject: "y", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await syllogise(dir);
    const before = readFactRows(await loadMemory(dir));
    const target = subClassRows(before).find((r) => r.subject === "x" && r.object === "d");
    assert.ok(target.environments.length >= 2, "x⊑d carries several environments before the retraction");

    await retractSubClassOf(dir, "x", "y");
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(subClassRows(rows).filter((r) => r.subject === "x").length, 0,
      "every x-rooted fact falls — no environment survives a cascade that severs the only taught stem");
    assert.ok(hasEdge(rows, "y", "a") && hasEdge(rows, "a", "d") && hasEdge(rows, "y", "d"),
      "the y-rooted chain, including its own entailments, is untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: retracting a corpus-premised environment never disturbs a taught-only one, and the "
  + "survivor's trust re-derives from the surviving taught premises", async () => {
  const dir = await mkRepo();
  try {
    // env 1 (corpus, lifted): e05.mjs:cache, cache⊑volatile (corpus), volatile dw persistent (corpus)
    // env 2 (taught, direct):  e05.mjs:mirror, mirror dw persistent
    await appendFact(dir, { subject: "e05.mjs", predicate: TYPE_PREDICATE, object: "cache", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "volatile", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "volatile", predicate: DISJOINT_PREDICATE, object: "persistent", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "e05.mjs", predicate: TYPE_PREDICATE, object: "mirror", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "mirror", predicate: DISJOINT_PREDICATE, object: "persistent", provenance: "ace:chat:s1" });
    await syllogise(dir);

    const before = readFactRows(await loadMemory(dir));
    const violation = disjointRows(before).find((r) => r.subject === "e05.mjs" && r.object === "persistent");
    // three environments: the taught-direct mirror route (the derivation
    // route), the corpus ⊑-lift through cache, and the propagated
    // e05.mjs:volatile type this same pass materialised.
    assert.deepEqual(violation.environments, [
      [envId("e05.mjs", TYPE_PREDICATE, "mirror"), envId("mirror", DISJOINT_PREDICATE, "persistent")],
      [envId("e05.mjs", TYPE_PREDICATE, "cache"), envId("volatile", DISJOINT_PREDICATE, "persistent"), envId("cache", SUBCLASS_PREDICATE, "volatile")],
      [envId("e05.mjs", TYPE_PREDICATE, "volatile"), envId("volatile", DISJOINT_PREDICATE, "persistent")],
    ], "every derivation route is recorded, including one through a same-pass propagated type");
    const taughtTypeTrust = before.find((r) => r.predicate === TYPE_PREDICATE && r.subject === "e05.mjs" && r.object === "mirror").trust;
    const taughtDwTrust = before.find((r) => r.predicate === DISJOINT_PREDICATE && r.subject === "mirror" && r.object === "persistent").trust;

    await retractSubClassOf(dir, "cache", "volatile");
    const rows = readFactRows(await loadMemory(dir));
    const survivor = disjointRows(rows).find((r) => r.subject === "e05.mjs" && r.object === "persistent");
    assert.ok(survivor, "the violation survives on its taught-only environment");
    assert.deepEqual(survivor.environments, [[
      envId("e05.mjs", TYPE_PREDICATE, "mirror"),
      envId("mirror", DISJOINT_PREDICATE, "persistent"),
    ]], "only the taught environment remains");
    assert.ok(hasType(rows, "e05.mjs", "mirror") && hasDisjoint(rows, "mirror", "persistent"),
      "the taught premises themselves are untouched");
    assert.equal(
      survivor.trust,
      round6(Math.min(taughtTypeTrust, taughtDwTrust) * CAX_DW_RULE_CONFIDENCE),
      "trust re-derives from the surviving taught premises through the entailed hook",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: without appendFacts on the store, removal is still correct — the survivor just "
  + "keeps its stale environments", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await appendFact(dir, { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await syllogise(dir);

    const { appendFacts: _omitted, ...withoutAppend } = STORE;
    const res = await retractSubClassOfSeam(dir, "a", "b", { store: withoutAppend });
    assert.equal(res.retracted.length, 1, "removal is unchanged");
    const survivor = readFactRows(await loadMemory(dir)).find((r) => r.subject === "a" && r.object === "d");
    assert.ok(survivor, "a⊑d still survives via its second environment");
    assert.equal(survivor.environments.length, 2, "no re-ground happened — the broken environment stays, stale but inert");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- retractSubClassOf: sourceTags scopes the target to ONE party's own ----
// ---- record(s), the granularity /retract needs over the mesh --------------
const SCOPED_STORE = { ...STORE, factRecordIdForTag };
const retractScoped = (dir, subj, obj, opts) => retractSubClassOfSeam(dir, subj, obj, { store: SCOPED_STORE, ...opts });

test("retractSubClassOf: sourceTags scoped to the sole asserter removes the fact and its cascade, "
  + "exactly like the unscoped group-wide path", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "teach:chat:sess-a@2026-01-01T00:00:00.000Z" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogise(dir);
    assert.ok(hasEdge(readFactRows(await loadMemory(dir)), "a", "c"), "a⊑c entailed before retraction");

    const res = await retractScoped(dir, "a", "b", { sourceTags: ["teach:chat:sess-a"] });
    assert.equal(res.found, true);
    assert.equal(res.ownRecord, true);
    assert.equal(res.stillStands, false);
    assert.equal(res.count, 2, "the premise itself + the entailment it justified");
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(rows, "a", "b"), "a⊑b gone");
    assert.ok(!hasEdge(rows, "a", "c"), "a⊑c gone too — its only justification broke");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: two sources asserting the same triple — one's scoped retraction leaves the "
  + "fact standing, cited to the other, and never touches anything entailed from it", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "teach:chat:sess-a@2026-01-01T00:00:00.000Z" });
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "teach:chat:sess-b@2026-01-01T00:00:00.000Z" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogise(dir);
    const before = readFactRows(await loadMemory(dir)).find((r) => r.subject === "a" && r.object === "b");
    assert.equal(before.sourceIds.length, 2, "both sessions asserted it");

    const res = await retractScoped(dir, "a", "b", { sourceTags: ["teach:chat:sess-a"] });
    assert.equal(res.found, true);
    assert.equal(res.ownRecord, true);
    assert.equal(res.stillStands, true, "sess-b's record keeps the triple standing");
    assert.equal(res.count, 1, "only sess-a's own record went — no cascade, the premise never broke");

    const rows = readFactRows(await loadMemory(dir));
    const surviving = rows.find((r) => r.subject === "a" && r.object === "b");
    assert.ok(surviving, "a⊑b still stands");
    assert.deepEqual(surviving.sourceIds, ["src:teach-chat:sess-b"], "cited to sess-b alone now");
    assert.ok(hasEdge(rows, "a", "c"), "a⊑c is untouched — its premise never actually stopped holding");

    const wire = readRetractions(await loadMemory(dir));
    assert.equal(wire.length, 1, "the retraction is on record");
    assert.equal(wire[0].subject, `${before.id}@src:teach-chat:sess-a`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: sourceTags naming a party that never asserted the triple removes nothing "
  + "of theirs, and leaves the triple exactly as it stood", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "teach:chat:sess-a@2026-01-01T00:00:00.000Z" });

    const res = await retractScoped(dir, "a", "b", { sourceTags: ["teach:chat:sess-b"] });
    assert.equal(res.found, true);
    assert.equal(res.ownRecord, false);
    assert.equal(res.retracted.length, 0);
    assert.equal(res.count, 0);
    assert.ok(hasEdge(readFactRows(await loadMemory(dir)), "a", "b"), "sess-a's assertion is untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: a party's positive assertion can carry EITHER of two provenance tags "
  + "(the ACE-parsed lane and the free-form teach lane) — sourceTags names both, and either one "
  + "matching is enough to own the record", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "ace:chat:sess-a@2026-01-01T00:00:00.000Z" });

    const res = await retractScoped(dir, "a", "b", {
      sourceTags: ["teach:chat:sess-a", "ace:chat:sess-a"],
    });
    assert.equal(res.ownRecord, true);
    assert.equal(res.stillStands, false);
    assert.ok(!hasEdge(readFactRows(await loadMemory(dir)), "a", "b"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retractSubClassOf: with no sourceTags at all, retraction stays group-wide — every source's "
  + "record for the triple goes, the pre-existing behaviour every other caller keeps", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "teach:chat:sess-a@2026-01-01T00:00:00.000Z" });
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "teach:chat:sess-b@2026-01-01T00:00:00.000Z" });

    const res = await retractScoped(dir, "a", "b");
    assert.equal(res.ownRecord, undefined, "the field only appears when sourceTags scoping is used");
    assert.equal(res.stillStands, undefined);
    assert.ok(!hasEdge(readFactRows(await loadMemory(dir)), "a", "b"), "both sources' records are gone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- semi-naive delta evaluation: the watermark, the frontier, and the ------
// ---- delta ≡ full guarantee -------------------------------------------------

// The delta-capable store: STORE plus the watermark seam. Kept separate so
// every earlier test in this file stays on the state-less full path.
const STATE_STORE = { ...STORE, loadSyllogiseState, saveSyllogiseState };
const syllogiseDelta = (dir, opts = {}) => syllogiseSeam(dir, { store: STATE_STORE, ...opts });

const factRowKey = (r) => `${r.subject} | ${r.predicate} | ${r.object}`;
const comparableRows = async (dir) => readFactRows(await loadMemory(dir))
  .map((r) => ({ key: factRowKey(r), provenance: r.provenance, environments: r.environments }))
  .sort((a, b) => a.key.localeCompare(b.key));

test("syllogise delta: an unchanged store after a complete pass is a delta of nothing — mode delta, deltaSize 0, count 0", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    const first = await syllogiseDelta(dir);
    assert.equal(first.mode, "full", "no watermark yet — the first pass is full");
    assert.ok(await loadSyllogiseState(dir), "the complete pass recorded a watermark");

    const second = await syllogiseDelta(dir);
    assert.equal(second.mode, "delta");
    assert.equal(second.deltaSize, 0);
    assert.equal(second.count, 0);
    assert.equal(second.environmentsAdded, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise delta: a newly-taught alternate premise set accretes onto a stored entailment in DELTA mode too", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogiseDelta(dir);

    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "d", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    const res = await syllogiseDelta(dir);
    assert.equal(res.mode, "delta");
    assert.equal(res.deltaSize, 2, "exactly the two newly-taught rows");
    assert.equal(res.environmentsAdded, 1, "the new route accretes onto the stored a⊑c");
    const derived = readFactRows(await loadMemory(dir)).find((r) => r.subject === "a" && r.object === "c");
    assert.deepEqual(derived.environments, [
      [envId("a", SUBCLASS_PREDICATE, "b"), envId("b", SUBCLASS_PREDICATE, "c")],
      [envId("a", SUBCLASS_PREDICATE, "d"), envId("d", SUBCLASS_PREDICATE, "c")],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Differential harness: two identical repos take the same base facts and a
 *  complete pass; both then take the same delta facts; one runs the default
 *  (delta) pass, the twin a forced-full control. The stores must end
 *  identical in (s,p,o), provenance and environments. `teach` steps are
 *  either appendFact descriptors or { sentence } rows for assertSentence. */
async function assertDeltaEqualsFull(baseFacts, deltaFacts) {
  const dirDelta = await mkRepo();
  const dirFull = await mkRepo();
  try {
    const apply = async (dir, step) => {
      if (step.sentence) await assertSentence(dir, step.sentence, { provenance: { source: "chat" } });
      else await appendFact(dir, step);
    };
    for (const step of baseFacts) { await apply(dirDelta, step); await apply(dirFull, step); }
    await syllogiseDelta(dirDelta);
    await syllogiseDelta(dirFull);
    for (const step of deltaFacts) { await apply(dirDelta, step); await apply(dirFull, step); }
    const resDelta = await syllogiseDelta(dirDelta);
    const resFull = await syllogiseDelta(dirFull, { full: true });
    assert.equal(resDelta.mode, "delta", "the default second pass really ran delta evaluation");
    assert.equal(resFull.mode, "full", "the control really ran full evaluation");
    assert.deepEqual(await comparableRows(dirDelta), await comparableRows(dirFull),
      "delta and full evaluation end in identical stores — facts, provenance and environments");
    return { resDelta, resFull };
  } finally {
    await rm(dirDelta, { recursive: true, force: true });
    await rm(dirFull, { recursive: true, force: true });
  }
}

test("syllogise delta ≡ full: a mid-chain ⊑ edge joins two stored chain halves (scm-sco)", async () => {
  const { resDelta } = await assertDeltaEqualsFull([
    { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" },
    { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" },
  ], [
    { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" },
  ]);
  assert.equal(resDelta.count, 3, "the delta pass really derived the joined closure: a⊑c, b⊑d, a⊑d");
});

test("syllogise delta ≡ full: a new type edge AND a new ⊑ edge above an old type (cax-sco)", async () => {
  await assertDeltaEqualsFull([
    { subject: "x1", predicate: TYPE_PREDICATE, object: "cat", provenance: "ace:chat:s1" },
    { subject: "cat", predicate: SUBCLASS_PREDICATE, object: "feline", provenance: "ace:chat:s1" },
  ], [
    { subject: "x2", predicate: TYPE_PREDICATE, object: "cat", provenance: "ace:chat:s1" },
    { subject: "feline", predicate: SUBCLASS_PREDICATE, object: "animal", provenance: "ace:chat:s1" },
  ]);
});

test("syllogise delta ≡ full: a new disjointWith edge above an old type chain (cax-dw)", async () => {
  await assertDeltaEqualsFull([
    { subject: "e01.mjs", predicate: TYPE_PREDICATE, object: "mock", provenance: "ace:chat:s1" },
    { subject: "mock", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" },
  ], [
    { subject: "fixture", predicate: DISJOINT_PREDICATE, object: "test", provenance: "ace:chat:s1" },
  ]);
});

test("syllogise delta ≡ full: a new property edge AND a new restriction over old edges (cls-svf1)", async () => {
  await assertDeltaEqualsFull([
    { subject: "e01.mjs", predicate: "tmct:imports", object: "t1.mjs", provenance: "ace:chat:s1" },
    { subject: "t1.mjs", predicate: TYPE_PREDICATE, object: "test", provenance: "ace:chat:s1" },
  ], [
    { sentence: "every module that imports a test is a suite" },
    { subject: "e02.mjs", predicate: "tmct:imports", object: "t2.mjs", provenance: "ace:chat:s1" },
    { subject: "t2.mjs", predicate: TYPE_PREDICATE, object: "test", provenance: "ace:chat:s1" },
  ]);
});

test("syllogise delta ≡ full: a new filler ⊑ edge connects two old restrictions (scm-svf1)", async () => {
  await assertDeltaEqualsFull([
    { sentence: "every module that imports a method is a formatter" },
    { sentence: "every module that imports a fixture is a suite" },
  ], [
    { subject: "method", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" },
  ]);
});

test("syllogise delta: a retraction invalidates the watermark — the next pass is full and rebuilds it", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogiseDelta(dir);
    assert.ok(await loadSyllogiseState(dir));

    await retractSubClassOf(dir, "a", "b");
    const afterRetract = await syllogiseDelta(dir);
    assert.equal(afterRetract.mode, "full", "removed ids break the id-set diff — no delta on a shrunk store");

    const next = await syllogiseDelta(dir);
    assert.equal(next.mode, "delta", "the completing full pass rebuilt the watermark");
    assert.equal(next.deltaSize, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise delta: a truncated pass never advances the watermark, and the next default pass converges "
  + "with an untruncated control", async () => {
  const dir = await mkRepo();
  const control = await mkRepo();
  try {
    for (const d of [dir, control]) {
      await appendFact(d, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
      await appendFact(d, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
      await appendFact(d, { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
      await appendFact(d, { subject: "d", predicate: SUBCLASS_PREDICATE, object: "e", provenance: "corpus:x" });
    }
    const truncatedPass = await syllogiseDelta(dir, { budget: 2 });
    assert.equal(truncatedPass.truncated, true);
    assert.equal(await loadSyllogiseState(dir), null, "a truncated pass records no watermark");

    const finishing = await syllogiseDelta(dir);
    assert.equal(finishing.mode, "full", "with no watermark the next default pass is full");
    await syllogiseDelta(control);
    // Environment ORDER is stored-first by contract, so two different pass
    // histories may order the same environment set differently — converge on
    // the canonical set, not the order.
    const canonical = (rows) => rows.map((r) => ({
      ...r, environments: r.environments.map((e) => [...e].sort().join(" ")).sort(),
    }));
    assert.deepEqual(canonical(await comparableRows(dir)), canonical(await comparableRows(control)),
      "truncate-then-finish converges with the single untruncated control pass");
    assert.ok(await loadSyllogiseState(dir), "the finishing pass advanced the watermark");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(control, { recursive: true, force: true });
  }
});

test("syllogise delta: a focused pass never advances the watermark", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    const focused = await syllogiseDelta(dir, { focus: ["a"] });
    assert.equal(focused.mode, "full", "a focused pass never reads the watermark");
    assert.equal(await loadSyllogiseState(dir), null, "and never writes one");

    await syllogiseDelta(dir);
    const watermark = await loadSyllogiseState(dir);
    assert.ok(watermark);
    await appendFact(dir, { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await syllogiseDelta(dir, { focus: ["c"] });
    assert.deepEqual((await loadSyllogiseState(dir)).factIds, watermark.factIds,
      "a later focused pass leaves the standing watermark untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise delta: identical op sequences end in identical fact sets and identical watermark state", async () => {
  const run = async (dir) => {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:x" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogiseDelta(dir);
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "d", provenance: "corpus:x" });
    await appendFact(dir, { subject: "d", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:x" });
    await syllogiseDelta(dir);
    await retractSubClassOf(dir, "a", "b");
    await syllogiseDelta(dir);
  };
  const dir1 = await mkRepo();
  const dir2 = await mkRepo();
  try {
    await run(dir1);
    await run(dir2);
    assert.deepEqual(await comparableRows(dir1), await comparableRows(dir2));
    const [s1, s2] = [await loadSyllogiseState(dir1), await loadSyllogiseState(dir2)];
    assert.deepEqual(s1.factIds, s2.factIds, "the watermark id sets agree");
    assert.equal(s1.version, s2.version);
  } finally {
    await rm(dir1, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
});

// ---- deriveSubClassClosureDelta: the pure semi-naive kernel ----

test("deriveSubClassClosureDelta: over a closed base plus a delta, output equals the full kernel's novel output", () => {
  // base closed: a⊑b plus c⊑d⊑e with c⊑e materialised; delta joins the halves
  const base = [["a", "b"], ["c", "d"], ["d", "e"], ["c", "e"]];
  const delta = [["b", "c"]];
  const all = [...base, ...delta];
  const fullOut = deriveSubClassClosure(all);
  const deltaOut = deriveSubClassClosureDelta(all, delta);
  assert.deepEqual(deltaOut, fullOut, "same conclusions, same via pivots, same order");
  assert.ok(fullOut.length >= 5, `the joined chain really closed (${fullOut.length})`);
});

test("deriveSubClassClosureDelta: an empty delta derives nothing, whatever the base holds", () => {
  assert.deepEqual(deriveSubClassClosureDelta([["a", "b"], ["b", "c"]], []), []);
  assert.deepEqual(deriveSubClassClosureDelta([], []), []);
});

test("deriveSubClassClosureDelta: hard budget caps derivations, deterministically", () => {
  const base = [["b", "c"], ["b", "d"], ["b", "e"], ["c", "f"]];
  const delta = [["a", "b"]];
  const all = [...base, ...delta];
  const d1 = deriveSubClassClosureDelta(all, delta, { budget: 2 });
  assert.equal(d1.length, 2);
  assert.deepEqual(d1, deriveSubClassClosureDelta(all, delta, { budget: 2 }), "same inputs → same truncation");
});

test("deriveSubClassClosureDelta: tautology, dedup and focus screens match the full kernel's", () => {
  // tautology: the delta closes a cycle — a⊑a is never emitted
  assert.deepEqual(deriveSubClassClosureDelta([["a", "b"], ["b", "a"]], [["b", "a"]]), []);
  // dedup: the joined conclusion is already stored
  assert.deepEqual(deriveSubClassClosureDelta([["a", "b"], ["b", "c"], ["a", "c"]], [["b", "c"]]), []);
  // focus: an unrelated focus screens the conclusion out; a touching one admits it
  const all = [["a", "b"], ["b", "c"]];
  assert.deepEqual(deriveSubClassClosureDelta(all, [["b", "c"]], { focus: new Set(["z"]) }), []);
  assert.deepEqual(
    deriveSubClassClosureDelta(all, [["b", "c"]], { focus: new Set(["a"]) }),
    [{ subject: "a", object: "c", via: "b" }],
  );
});

// ---- buildRelevanceFrontier: forward relevance from a change's seed terms ----

test("buildRelevanceFrontier: seeds expand to ⊑-descendants, their typed instances, and restrictions over affected fillers", () => {
  const rows = [
    { subject: "poodle", predicate: SUBCLASS_PREDICATE, object: "dog" },
    { subject: "dog", predicate: SUBCLASS_PREDICATE, object: "animal" },
    { subject: "rex", predicate: TYPE_PREDICATE, object: "dog" },
    { subject: "unrelated.mjs", predicate: TYPE_PREDICATE, object: "widget" },
    { subject: "some-owns-dog", predicate: ON_PROPERTY_PREDICATE, object: "owns" },
    { subject: "some-owns-dog", predicate: SOME_VALUES_FROM_PREDICATE, object: "dog" },
    { subject: "half-declared", predicate: SOME_VALUES_FROM_PREDICATE, object: "dog" }, // no onProperty — not a declared restriction
  ];
  const f = buildRelevanceFrontier(rows, ["dog"]);
  assert.deepEqual([...f].sort(), ["dog", "poodle", "rex", "some-owns-dog"],
    "the seed, its descendant, its instance and the restriction over it — nothing else");
  assert.ok(!f.has("animal"), "an ANCESTOR of the seed is not pulled in by the descendant walk");
});

test("buildRelevanceFrontier: no rows at all leaves exactly the normalized seeds", () => {
  const f = buildRelevanceFrontier([], ["Dog", "the cat"]);
  assert.deepEqual([...f].sort(), ["cat", "dog"]);
});

test("buildRelevanceFrontier: deterministic — same rows and seeds, same set, same iteration order", () => {
  const rows = [
    { subject: "poodle", predicate: SUBCLASS_PREDICATE, object: "dog" },
    { subject: "rex", predicate: TYPE_PREDICATE, object: "poodle" },
  ];
  assert.deepEqual([...buildRelevanceFrontier(rows, ["dog"])], [...buildRelevanceFrontier(rows, ["dog"])]);
});

// ---- expandFocus: a caller focus run through the relevance frontier ----

test("syllogise expandFocus: a focus term's descendants and their instances come into scope — off by default", async () => {
  const seedFacts = async (dir) => {
    await appendFact(dir, { subject: "dog", predicate: SUBCLASS_PREDICATE, object: "animal", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "poodle", predicate: SUBCLASS_PREDICATE, object: "dog", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "rex", predicate: TYPE_PREDICATE, object: "poodle", provenance: "ace:chat:s1" });
  };
  const plainDir = await mkRepo();
  const expandedDir = await mkRepo();
  try {
    await seedFacts(plainDir);
    await seedFacts(expandedDir);
    // rex:dog's three terms (rex, poodle, dog) all sit BELOW the focus term,
    // so a plain focus screens the derivation out; the frontier reaches it.
    await syllogise(plainDir, { focus: ["animal"] });
    assert.ok(!hasType(readFactRows(await loadMemory(plainDir)), "rex", "dog"),
      "default off: the plain focused pass behaves exactly as before");
    await syllogise(expandedDir, { focus: ["animal"], expandFocus: true });
    const rows = readFactRows(await loadMemory(expandedDir));
    assert.ok(hasType(rows, "rex", "dog"), "the expanded focus admits the all-descendant-term derivation");
    assert.ok(hasType(rows, "rex", "animal") && hasEdge(rows, "poodle", "animal"),
      "everything the plain focus already reached still derives");
  } finally {
    await rm(plainDir, { recursive: true, force: true });
    await rm(expandedDir, { recursive: true, force: true });
  }
});

test("syllogise expandFocus: an expanded focus is still a focus — it never advances the watermark", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "poodle", predicate: SUBCLASS_PREDICATE, object: "dog", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "dog", predicate: SUBCLASS_PREDICATE, object: "animal", provenance: "ace:chat:s1" });
    const res = await syllogiseDelta(dir, { focus: ["animal"], expandFocus: true });
    assert.equal(res.mode, "full");
    assert.equal(await loadSyllogiseState(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
