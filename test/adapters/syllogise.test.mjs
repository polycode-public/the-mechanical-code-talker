// syllogise.test.mjs — the speculative-inference engine (Phase 9 /
// archive/PLAN_SPECULATIVE_INFERENCE.md): the pure forward-chaining kernel, the
// materialising pass (entailed provenance + low trust, never outranks a stated
// fact), and the HONEST KILL CRITERION — does a pre-derived transitive fact flip
// a real subclass-chain miss to a hit, measured on the DEFAULT W3 bootstrap seed
// (not a hand fixture, not the whole corpus)?
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, appendFacts, loadMemory, readFactRows, removeFacts } from "../../src/adapters/memory/core.mjs";
import {
  deriveSubClassClosure, deriveTypePropagation, deriveDisjointViolations,
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

// ---- buildCardinalityRestrictions: pattern-5 reconstruction (PLAN_INFERENCE_TESTING.md INF-C1) ----

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

// ---- proveCardinalityAtLeast: cardinality monotonicity (PLAN_INFERENCE_TESTING.md INF-C1, "confirmed OUTSIDE OWL 2 RL's own profile") ----

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
// ---- (PLAN_INFERENCE_TESTING.md INF-B2's worked "chat.mjs imports parse.test.mjs" -
// ---- example — deliberately stops at "x is a some-imports-test" restriction ----
// ---- membership, NOT the further "x is a suite" intersection step, see this ----
// ---- module's own header comment) -----------------------------------------------

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

// ---- findConsistencyViolations (PLAN_INFERENCE_TESTING.md INF-C2, stage 5) ----

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

// ---- retractSubClassOf: PLAN_SYLLOGIST.md §3's first real retraction slice —
// JTMS-style dependency-directed removal for scm-sco, VERIFIED (not assumed)
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
