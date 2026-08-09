// tableau-kb.test.mjs — buildTableauKb: mapping every stored row shape it
// reads onto a TBox axiom, an ABox assertion or an ABox role edge, telling an
// individual from a class (including the meta-vocabulary carve-out and the
// punning case), and skipping what an ALC-only KB can't yet represent rather
// than guessing at it.
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

test("A rdfs:subClassOf R, R an allValuesFrom restriction, reads as A ⊑ ∀r.C, citing all three fact ids", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "heart", predicate: "rdfs:subClassOf", object: "all-contains-valve" },
    { id: "f2", subject: "all-contains-valve", predicate: "owl:onProperty", object: "contains" },
    { id: "f3", subject: "all-contains-valve", predicate: "owl:allValuesFrom", object: "valve" },
  ]);
  assert.ok(hasAxiom(kb, atom("heart"), { t: "all", r: "contains", c: atom("valve") }));
  const ax = kb.axioms.find((a) => canonicalKey(a.sub) === canonicalKey(atom("heart")));
  assert.deepEqual(ax.from, ["f1", "f2", "f3"]);
});

test("a restriction with neither someValuesFrom nor allValuesFrom nor a qualified cardinality is skipped rather than guessed at", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "heart", predicate: "rdfs:subClassOf", object: "mystery-restriction" },
    { id: "f2", subject: "mystery-restriction", predicate: "owl:onProperty", object: "contains" },
  ]);
  assert.ok(!kb.axioms.some((a) => a.sub.name === "heart"), "an unrepresentable restriction must not mint an axiom");
});

test("A rdfs:subClassOf R, R a min-cardinality restriction with onClass, reads as A ⊑ ≥n r.C", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "bicycle", predicate: "rdfs:subClassOf", object: "min-2-wheel" },
    { id: "f2", subject: "min-2-wheel", predicate: "owl:onProperty", object: "has" },
    { id: "f3", subject: "min-2-wheel", predicate: "owl:onClass", object: "wheel" },
    { id: "f4", subject: "min-2-wheel", predicate: "owl:minCardinality", object: "2" },
  ]);
  assert.ok(hasAxiom(kb, atom("bicycle"), { t: "atLeast", n: 2, r: "has", c: atom("wheel") }));
});

test("A rdfs:subClassOf R, R a max-cardinality restriction with onClass, reads as A ⊑ ≤n r.C", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "bicycle", predicate: "rdfs:subClassOf", object: "max-0-engine" },
    { id: "f2", subject: "max-0-engine", predicate: "owl:onProperty", object: "has" },
    { id: "f3", subject: "max-0-engine", predicate: "owl:onClass", object: "engine" },
    { id: "f4", subject: "max-0-engine", predicate: "owl:maxCardinality", object: "0" },
  ]);
  assert.ok(hasAxiom(kb, atom("bicycle"), { t: "atMost", n: 0, r: "has", c: atom("engine") }));
});

test("A rdfs:subClassOf R, R a cardinality restriction with no onClass, is skipped — unqualified, not guessed at", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "bicycle", predicate: "rdfs:subClassOf", object: "min-2-wheel" },
    { id: "f2", subject: "min-2-wheel", predicate: "owl:onProperty", object: "has" },
    { id: "f3", subject: "min-2-wheel", predicate: "owl:minCardinality", object: "2" },
  ]);
  assert.ok(!kb.axioms.some((a) => a.sub.name === "bicycle"), "an unqualified cardinality restriction must not mint an axiom");
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

// ---- ABox role assertions ---------------------------------------------------

test("an asserted relation between two individuals reads as a role assertion citing its fact id", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "chat.mjs", predicate: "tmct:dependsOn", object: "sessions.mjs" },
  ]);
  assert.deepEqual(kb.roleAssertions, [
    { a: "chat.mjs", r: "tmct:dependsOn", b: "sessions.mjs", from: ["f1"] },
  ]);
  assert.deepEqual(kb.individuals, ["chat.mjs", "sessions.mjs"]);
});

test("a class-level relation, neither side a named individual, does not read as a role assertion", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "human", predicate: "mgx:capableOf", object: "think" }]);
  assert.deepEqual(kb.roleAssertions, []);
});

test("a relation naming one individual and one class does not read as a role assertion", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "chat.mjs", predicate: "tmct:dependsOn", object: "module" }]);
  assert.deepEqual(kb.roleAssertions, []);
});

test("the roleAssertions cap truncates deterministically, keeping the sorted-first rows", () => {
  const rows = [];
  for (let i = 0; i < 300; i += 1) {
    const n = String(i).padStart(3, "0");
    rows.push({ id: `f${i}`, subject: `node-${n}.mjs`, predicate: "tmct:linksTo", object: "hub.mjs" });
  }
  const kb = buildTableauKb(rows);
  assert.equal(kb.roleAssertions.length, 256);
  assert.equal(kb.roleAssertions[0].a, "node-000.mjs");
  assert.equal(kb.roleAssertions[255].a, "node-255.mjs");
});

test("order-independence: two input orders of role-assertion rows give byte-identical roleAssertions", () => {
  const rowsA = [
    { id: "f1", subject: "chat.mjs", predicate: "tmct:dependsOn", object: "sessions.mjs" },
    { id: "f2", subject: "sessions.mjs", predicate: "tmct:dependsOn", object: "hash.mjs" },
  ];
  const rowsB = [...rowsA].reverse();
  assert.deepEqual(buildTableauKb(rowsA).roleAssertions, buildTableauKb(rowsB).roleAssertions);
});
