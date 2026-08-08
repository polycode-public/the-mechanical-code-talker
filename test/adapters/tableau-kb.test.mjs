// tableau-kb.test.mjs — buildTableauKb: mapping every stored row shape it
// reads onto a TBox axiom or an ABox assertion, telling an individual from a
// class (including the meta-vocabulary carve-out and the punning case), and
// skipping what an ALC-only KB can't yet represent rather than guessing at it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTableauKb, canonicalKey, proveEntailment, proveSubsumption, toNNF } from "../../src/domain/tableau.mjs";

const atom = (name) => ({ t: "atom", name });
const hasAxiom = (kb, sub, sup) => kb.axioms.some((a) => canonicalKey(a.sub) === canonicalKey(sub) && canonicalKey(a.sup) === canonicalKey(sup));
const hasAssertion = (kb, ind, expr) => kb.assertions.some((a) => a.ind === ind && canonicalKey(a.expr) === canonicalKey(expr));

test("A rdfs:subClassOf B, B a plain class, reads as A ⊑ B", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "heart", predicate: "rdfs:subClassOf", object: "organ" }]);
  assert.ok(hasAxiom(kb, atom("heart"), atom("organ")));
});

test("A rdfs:subClassOf R, R a someValuesFrom restriction, reads as A ⊑ ∃r.C", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "heart", predicate: "rdfs:subClassOf", object: "some-has-valve" },
    { id: "f2", subject: "some-has-valve", predicate: "owl:onProperty", object: "has" },
    { id: "f3", subject: "some-has-valve", predicate: "owl:someValuesFrom", object: "valve" },
  ]);
  assert.ok(hasAxiom(kb, atom("heart"), { t: "some", r: "has", c: atom("valve") }));
});

test("A rdfs:subClassOf R, R a min-cardinality-1 restriction, bridges to A ⊑ ∃r.C", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "bicycle", predicate: "rdfs:subClassOf", object: "min-1-wheel" },
    { id: "f2", subject: "min-1-wheel", predicate: "owl:onProperty", object: "has" },
    { id: "f3", subject: "min-1-wheel", predicate: "owl:onClass", object: "wheel" },
    { id: "f4", subject: "min-1-wheel", predicate: "owl:minCardinality", object: "1" },
  ]);
  assert.ok(hasAxiom(kb, atom("bicycle"), { t: "some", r: "has", c: atom("wheel") }));
});

test("A rdfs:subClassOf R, R a max-cardinality restriction, is skipped — not representable in ALC yet", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "bicycle", predicate: "rdfs:subClassOf", object: "max-0-engine" },
    { id: "f2", subject: "max-0-engine", predicate: "owl:onProperty", object: "has" },
    { id: "f3", subject: "max-0-engine", predicate: "owl:onClass", object: "engine" },
    { id: "f4", subject: "max-0-engine", predicate: "owl:maxCardinality", object: "0" },
  ]);
  assert.ok(!kb.axioms.some((a) => a.sub.name === "bicycle"), "a max-cardinality restriction must not mint an existential axiom");
});

test("A owl:disjointWith B, both classes, reads as A ⊑ ¬B", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "cat", predicate: "owl:disjointWith", object: "dog" }]);
  assert.ok(hasAxiom(kb, atom("cat"), toNNF({ t: "not", c: atom("dog") })));
});

test("x rdf:type C reads as C(x)", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "rex", predicate: "rdf:type", object: "dog" }]);
  assert.ok(hasAssertion(kb, "rex", atom("dog")));
});

test("x owl:disjointWith C, x an individual, reads as ¬C(x)", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "rex", predicate: "rdf:type", object: "pet" },
    { id: "f2", subject: "rex", predicate: "owl:disjointWith", object: "cat" },
  ]);
  assert.ok(hasAssertion(kb, "rex", toNNF({ t: "not", c: atom("cat") })));
});

test("x mgxneg:subClassOf C reads as ¬C(x)", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "rex", predicate: "rdf:type", object: "pet" },
    { id: "f2", subject: "rex", predicate: "mgxneg:subClassOf", object: "cat" },
  ]);
  assert.ok(hasAssertion(kb, "rex", toNNF({ t: "not", c: atom("cat") })));
});

test("U owl:unionOf A, U owl:unionOf B mints both subsumption directions", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "cat-or-dog", predicate: "owl:unionOf", object: "cat" },
    { id: "f2", subject: "cat-or-dog", predicate: "owl:unionOf", object: "dog" },
  ]);
  const union = toNNF({ t: "or", cs: [atom("cat"), atom("dog")] });
  assert.ok(hasAxiom(kb, atom("cat-or-dog"), union));
  assert.ok(hasAxiom(kb, union, atom("cat-or-dog")));
});

test("N owl:complementOf A mints both subsumption directions", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "not-aquatic", predicate: "owl:complementOf", object: "aquatic" }]);
  const notAquatic = toNNF({ t: "not", c: atom("aquatic") });
  assert.ok(hasAxiom(kb, atom("not-aquatic"), notAquatic));
  assert.ok(hasAxiom(kb, notAquatic, atom("not-aquatic")));
});

// ---- telling an individual from a class ------------------------------------

test("the meta-vocabulary carve-out: a role marked transitive is never read as an individual", () => {
  // Rows here are already-normalized STORED rows (readFactRows strips the CURIE
  // prefix and lowercases before this module ever sees them) — "transitiveproperty",
  // not "owl:TransitiveProperty".
  const kb = buildTableauKb([{ id: "f1", subject: "contains", predicate: "rdf:type", object: "transitiveproperty" }]);
  assert.ok(!kb.individuals.includes("contains"));
  assert.equal(kb.assertions.length, 0);
});

test("the meta-vocabulary carve-out: a restriction node's own type tag is never read as an individual", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "heart", predicate: "rdfs:subClassOf", object: "some-has-valve" },
    { id: "f2", subject: "some-has-valve", predicate: "rdf:type", object: "restriction" },
    { id: "f3", subject: "some-has-valve", predicate: "owl:onProperty", object: "has" },
    { id: "f4", subject: "some-has-valve", predicate: "owl:someValuesFrom", object: "valve" },
  ]);
  assert.ok(!kb.individuals.includes("some-has-valve"));
  assert.ok(!kb.assertions.some((a) => a.ind === "some-has-valve"));
});

test("a code-ref-shaped subject reads as an individual even with no rdf:type row", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "src/domain/ask.mjs", predicate: "owl:disjointWith", object: "test-file" }]);
  assert.ok(hasAssertion(kb, "src/domain/ask.mjs", toNNF({ t: "not", c: atom("test-file") })));
});

test("punning: a term used as an individual in one row and a class in another resolves correctly in each position", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "red", predicate: "rdf:type", object: "primary-colour" }, // red-the-individual
    { id: "f2", subject: "red", predicate: "rdfs:subClassOf", object: "colour" },  // red-the-class
  ]);
  assert.ok(hasAssertion(kb, "red", atom("primary-colour")));
  assert.ok(hasAxiom(kb, atom("red"), atom("colour")));
});

// ---- end to end through the two proof shapes -------------------------------

test("an individual assertion plus a subClassOf chain proves an individual entailment", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "rex", predicate: "rdf:type", object: "dog" },
    { id: "f2", subject: "dog", predicate: "rdfs:subClassOf", object: "mammal" },
  ]);
  const result = proveEntailment(kb, "rex", atom("mammal"));
  assert.equal(result.status, "proved");
});

test("a class-level disjointness plus complement proves a class subsumption", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "not-aquatic", predicate: "owl:complementOf", object: "aquatic" },
    { id: "f2", subject: "not-aquatic", predicate: "rdfs:subClassOf", object: "terrestrial" },
    { id: "f3", subject: "stone", predicate: "owl:disjointWith", object: "aquatic" },
  ]);
  const result = proveSubsumption(kb, "stone", "terrestrial");
  assert.equal(result.status, "proved");
});
