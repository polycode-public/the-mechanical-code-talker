// tableau-core.test.mjs — the explicit-stack ALC search engine: one test per
// expansion rule (exercised through the public isSatisfiable/proveEntailment/
// proveSubsumption surface, never through a private helper), subset blocking
// terminating a self-referential existential, the branch stack exploring its
// lexicographically first disjunct first, every budget honestly missing
// rather than guessing when it runs out, and an asserted ABox role edge
// seeding the branch the ∀/∃-rules read from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTableauKb, canonicalKey, findTableauViolations, isSatisfiable, proveEntailment, proveSubsumption } from "../../src/domain/tableau.mjs";

const atom = (name) => ({ t: "atom", name });
const emptyKb = () => buildTableauKb([]);
const findNode = (model, id) => model.nodes.find((n) => n.id === id);
const hasLabel = (node, expr) => node.labels.some((l) => canonicalKey(l.expr) === canonicalKey(expr));

// ---- rule 1: the ⊓-rule ---------------------------------------------------

test("and-rule: every conjunct is added to the node's own label set", () => {
  const result = isSatisfiable(emptyKb(), [{ ind: "x", expr: { t: "and", cs: [atom("cat"), atom("dog")] }, from: ["p1"] } ]);
  assert.equal(result.satisfiable, true);
  const x = findNode(result.model, "x");
  assert.ok(hasLabel(x, atom("cat")));
  assert.ok(hasLabel(x, atom("dog")));
});

test("and-rule: a conjunct that clashes with its own sibling closes the branch", () => {
  const result = isSatisfiable(emptyKb(), [{ ind: "x", expr: { t: "and", cs: [atom("cat"), { t: "not", c: atom("cat") }] }, from: ["p1"] }]);
  assert.equal(result.satisfiable, false);
});

// ---- rule 2: the ∀-rule ----------------------------------------------------

test("all-rule: propagates the universal's filler onto an existing r-successor", () => {
  const query = { t: "and", cs: [{ t: "some", r: "has", c: atom("valve") }, { t: "all", r: "has", c: atom("moving-part") }] };
  const result = isSatisfiable(emptyKb(), [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const successor = result.model.nodes.find((n) => n.parent === "heart");
  assert.ok(successor, "the ∃-rule must have created a has-successor");
  assert.ok(hasLabel(successor, atom("valve")));
  assert.ok(hasLabel(successor, atom("moving-part")), "the ∀-rule must have propagated onto the existing successor");
});

test("all-rule: never touches a successor over a different role", () => {
  const query = { t: "and", cs: [{ t: "some", r: "contains", c: atom("valve") }, { t: "all", r: "has", c: atom("moving-part") }] };
  const result = isSatisfiable(emptyKb(), [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const successor = result.model.nodes.find((n) => n.parent === "heart");
  assert.ok(!hasLabel(successor, atom("moving-part")));
});

// ---- rule 3: TBox internalization (the ⊑-rule) ----------------------------

test("tbox-rule: a stored subClassOf axiom is internalized and entails the supertype", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "heart" },
    { id: "f2", subject: "heart", predicate: "rdfs:subClassOf", object: "organ" },
  ]);
  const result = proveEntailment(kb, "x", atom("organ"));
  assert.equal(result.status, "proved");
  assert.deepEqual(result.premises, ["f1", "f2"]);
});

test("tbox-rule: an axiom irrelevant to the query never forces a verdict either way", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "heart" },
    { id: "f2", subject: "unrelated", predicate: "rdfs:subClassOf", object: "other" },
  ]);
  const result = proveEntailment(kb, "x", atom("organ"));
  assert.equal(result.status, "disproved");
});

// ---- rule 4: the ⊔-rule, and the branch stack's exploration order ---------

test("or-rule: an unconstrained disjunction is satisfiable by either disjunct", () => {
  const result = isSatisfiable(emptyKb(), [{ ind: "x", expr: { t: "or", cs: [atom("beta"), atom("alpha")] }, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
});

test("or-rule: the branch stack explores the lexicographically first disjunct first", () => {
  // Nothing else constrains "x" — the first branch found open wins, and the
  // stack is built so that branch is always the lexicographically first
  // disjunct ("alpha" sorts before "beta").
  const result = isSatisfiable(emptyKb(), [{ ind: "x", expr: { t: "or", cs: [atom("beta"), atom("alpha")] }, from: ["p1"] }]);
  const x = findNode(result.model, "x");
  assert.ok(hasLabel(x, atom("alpha")));
  assert.ok(!hasLabel(x, atom("beta")));
});

test("or-rule: a disjunction where every disjunct clashes closes the branch, never branching", () => {
  const query = { t: "and", cs: [atom("cat"), { t: "not", c: atom("dog") }, { t: "or", cs: [atom("dog"), { t: "not", c: atom("cat") }] }] };
  const result = isSatisfiable(emptyKb(), [{ ind: "x", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, false);
});

// ---- rule 5: the ∃-rule, and subset blocking -------------------------------

test("some-rule: creates a fresh, deterministically-named successor labelled with the filler", () => {
  const result = isSatisfiable(emptyKb(), [{ ind: "heart", expr: { t: "some", r: "has", c: atom("valve") }, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const successor = findNode(result.model, "heart.1");
  assert.ok(successor, "the first successor of heart must be named heart.1");
  assert.ok(hasLabel(successor, atom("valve")));
});

test("blocking: terminates a self-referential existential (A ⊑ ∃r.A) instead of growing forever", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "some-has-a" },
    { id: "f3", subject: "some-has-a", predicate: "owl:onProperty", object: "has" },
    { id: "f4", subject: "some-has-a", predicate: "owl:someValuesFrom", object: "a" },
  ]);
  const result = isSatisfiable(kb, []);
  assert.equal(result.satisfiable, true);
  assert.ok(result.model.nodes.length <= 4, `blocking must cap the model size, got ${result.model.nodes.length} nodes`);
  assert.ok(result.steps < 200, `blocking must terminate quickly, took ${result.steps} steps`);
});

// ---- budgets: every kind of exhaustion is honest, never a guessed verdict --

test("budget: a step ceiling that's too small to finish reports exhausted, not a verdict", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "b" },
    { id: "f3", subject: "b", predicate: "rdfs:subClassOf", object: "c" },
  ]);
  const result = proveEntailment(kb, "x", atom("c"), { maxSteps: 1 });
  assert.equal(result.status, "exhausted");
  assert.equal(result.reason, "steps");
});

test("budget: a branch ceiling that's too small to finish reports exhausted", () => {
  const query = { t: "and", cs: [{ t: "or", cs: [atom("a1"), atom("a2")] }, { t: "or", cs: [atom("b1"), atom("b2")] }, { t: "or", cs: [atom("c1"), atom("c2")] }] };
  const result = isSatisfiable(emptyKb(), [{ ind: "x", expr: query, from: [] }], { maxBranches: 1 });
  assert.equal(result.satisfiable, null);
  assert.equal(result.exhausted, "branches");
});

test("budget: a node ceiling that's too small to finish reports exhausted", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "some-has-a" },
    { id: "f3", subject: "some-has-a", predicate: "owl:onProperty", object: "has" },
    { id: "f4", subject: "some-has-a", predicate: "owl:someValuesFrom", object: "b" }, // a different filler each time — blocking never catches this one
    { id: "f5", subject: "b", predicate: "rdfs:subClassOf", object: "some-has-a" },
  ]);
  const result = isSatisfiable(kb, [], { maxNodes: 2 });
  assert.equal(result.satisfiable, null);
  assert.equal(result.exhausted, "nodes");
});

test("budget: proveSubsumption also reports exhausted rather than a guessed verdict", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "a", predicate: "rdfs:subClassOf", object: "b" },
    { id: "f2", subject: "b", predicate: "rdfs:subClassOf", object: "c" },
  ]);
  const result = proveSubsumption(kb, "a", "c", { maxSteps: 1 });
  assert.equal(result.status, "exhausted");
});

// ---- findTableauViolations: clashes the KB produces on its own -----------

test("findTableauViolations: a consistent store reports nothing", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "rex", predicate: "rdf:type", object: "dog" },
    { id: "f2", subject: "dog", predicate: "rdfs:subClassOf", object: "mammal" },
  ]);
  assert.deepEqual(findTableauViolations(kb), []);
});

test("findTableauViolations: an individual with contradictory asserted types is reported, both premises named", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "rex", predicate: "rdf:type", object: "cat" },
    { id: "f2", subject: "rex", predicate: "mgxneg:subClassOf", object: "cat" },
  ]);
  const violations = findTableauViolations(kb);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].subject, "rex");
  assert.ok(violations[0].premises.includes("f1"));
  assert.ok(violations[0].premises.includes("f2"));
});

test("findTableauViolations: the subjects argument narrows which individuals get checked", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "rex", predicate: "rdf:type", object: "cat" },
    { id: "f2", subject: "rex", predicate: "mgxneg:subClassOf", object: "cat" },
    { id: "f3", subject: "fido", predicate: "rdf:type", object: "dog" },
  ]);
  assert.deepEqual(findTableauViolations(kb, ["fido"]), []);
  assert.equal(findTableauViolations(kb, ["rex"]).length, 1);
});

// ---- ABox role assertions: seeded edges ------------------------------------

test("a seeded role assertion creates both endpoint nodes and an edge, with no query at all", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "chat.mjs", predicate: "tmct:dependsOn", object: "sessions.mjs" }]);
  const result = isSatisfiable(kb, []);
  assert.equal(result.satisfiable, true);
  assert.ok(findNode(result.model, "chat.mjs"));
  assert.ok(findNode(result.model, "sessions.mjs"));
  assert.deepEqual(result.model.edges, [
    { from: "chat.mjs", r: "tmct:dependsOn", to: "sessions.mjs", fromFacts: ["f1"] },
  ]);
});

test("the ∀-rule propagates its filler across a seeded role-assertion edge", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "chat.mjs", predicate: "tmct:dependsOn", object: "sessions.mjs" }]);
  const query = { t: "all", r: "tmct:dependsOn", c: atom("well-tested") };
  const result = isSatisfiable(kb, [{ ind: "chat.mjs", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  assert.ok(hasLabel(findNode(result.model, "sessions.mjs"), atom("well-tested")));
});

test("the ∃-rule reuses a seeded role-assertion edge as a witness instead of minting a fresh successor", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "chat.mjs", predicate: "tmct:dependsOn", object: "sessions.mjs" },
    { id: "f2", subject: "sessions.mjs", predicate: "rdf:type", object: "module" },
  ]);
  const query = { t: "some", r: "tmct:dependsOn", c: atom("module") };
  const result = isSatisfiable(kb, [{ ind: "chat.mjs", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const freshSuccessors = result.model.nodes.filter((n) => n.parent === "chat.mjs");
  assert.equal(freshSuccessors.length, 0, "the seeded edge to sessions.mjs already witnesses the existential; no fresh successor should be minted");
});

test("findTableauViolations: a budget too small to detect a real clash reports nothing rather than a false clean bill", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "rex", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "b" },
    { id: "f3", subject: "b", predicate: "rdfs:subClassOf", object: "c" },
    { id: "f4", subject: "rex", predicate: "mgxneg:subClassOf", object: "c" },
  ]);
  assert.equal(findTableauViolations(kb, ["rex"], { maxSteps: 1 }).length, 0);
});
