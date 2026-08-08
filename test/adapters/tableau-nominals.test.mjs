// tableau-nominals.test.mjs — owl:oneOf as a closed class of singleton
// (nominal) concepts, and the nominal-merge rule that identifies two nodes
// forced into the same nominal — reusing 4d's merge machinery. E6
// (PLAN_SYLLOGIST_EL_DL.md): "is teal a primary colour" becomes a provable
// no under UNA-lite once an enumeration is stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTableauKb, canonicalKey, isSatisfiable, proveEntailment, toNNF } from "../../src/domain/tableau.mjs";

const atom = (name) => ({ t: "atom", name });
const nom = (ind) => ({ t: "nom", ind });
const notE = (c) => ({ t: "not", c });
const findNode = (model, id) => model.nodes.find((n) => n.id === id);
const hasLabel = (node, expr) => node.labels.some((l) => canonicalKey(l.expr) === canonicalKey(expr));

const primaryColours = () => [
  { id: "f1", subject: "primary-colour", predicate: "owl:oneOf", object: "red" },
  { id: "f2", subject: "primary-colour", predicate: "owl:oneOf", object: "yellow" },
  { id: "f3", subject: "primary-colour", predicate: "owl:oneOf", object: "blue" },
  { id: "f4", subject: "red", predicate: "rdf:type", object: "primary-colour" },
  { id: "f5", subject: "yellow", predicate: "rdf:type", object: "primary-colour" },
  { id: "f6", subject: "blue", predicate: "rdf:type", object: "primary-colour" },
  { id: "f7", subject: "red", predicate: "owl:differentFrom", object: "yellow" },
  { id: "f8", subject: "red", predicate: "owl:differentFrom", object: "blue" },
  { id: "f9", subject: "yellow", predicate: "owl:differentFrom", object: "blue" },
];

// ---- reading owl:oneOf into nominal axioms ---------------------------------

test("owl:oneOf reads as a closed union of nominals, plus each member subsumed back into the class", () => {
  const kb = buildTableauKb(primaryColours());
  const hasAxiom = (sub, sup) => kb.axioms.some((a) => canonicalKey(a.sub) === canonicalKey(sub) && canonicalKey(a.sup) === canonicalKey(sup));
  const closed = toNNF({ t: "or", cs: [nom("red"), nom("yellow"), nom("blue")] });
  assert.ok(hasAxiom(atom("primary-colour"), closed), "the class is subsumed by the union of its members' nominals");
  assert.ok(hasAxiom(nom("red"), atom("primary-colour")));
  assert.ok(hasAxiom(nom("yellow"), atom("primary-colour")));
  assert.ok(hasAxiom(nom("blue"), atom("primary-colour")));
});

test("kb.nominalIndividuals carries every oneOf member with its declaring fact id", () => {
  const kb = buildTableauKb(primaryColours());
  assert.deepEqual(kb.nominalIndividuals.get("red"), ["f1"]);
  assert.deepEqual(kb.nominalIndividuals.get("yellow"), ["f2"]);
  assert.deepEqual(kb.nominalIndividuals.get("blue"), ["f3"]);
});

test("each nominal individual gets its own self-label at branch-init, with no rule application needed", () => {
  const kb = buildTableauKb(primaryColours());
  const result = isSatisfiable(kb, []);
  assert.equal(result.satisfiable, true);
  const red = findNode(result.model, "red");
  assert.ok(hasLabel(red, nom("red")), "red must carry its own nominal from the start");
});

// ---- the nominal-merge rule -------------------------------------------------

test("an ∃-created successor forced into a nominal merges onto the real named individual", () => {
  // "x has a red" creates a synthetic ∃-successor labelled nom(red); the
  // nominal-merge rule identifies it with the REAL red node (self-labelled
  // at branch-init because red is a declared oneOf member), redirecting
  // x's has-edge onto red directly.
  const kb = buildTableauKb([
    ...primaryColours(),
    { id: "f10", subject: "red", predicate: "rdf:type", object: "hue" },
  ]);
  const query = { t: "some", r: "has", c: nom("red") };
  const result = isSatisfiable(kb, [{ ind: "x", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const red = findNode(result.model, "red");
  assert.ok(red, "the real red node must survive the merge");
  assert.ok(hasLabel(red, atom("hue")), "the merged node keeps its own original labels");
  assert.ok(!findNode(result.model, "x.1"), "the synthetic successor no longer exists — it WAS red");
  assert.ok(result.model.edges.some((e) => e.from === "x" && e.to === "red" && e.r === "has"), "x's has-edge now points directly at the real red node");
});

// ---- E6: the enumeration closes the class, teal provably is not one -------

test("E6: is teal a primary colour — provably no, under UNA-lite", () => {
  const kb = buildTableauKb(primaryColours());
  const result = proveEntailment(kb, "teal", notE(atom("primary-colour")));
  assert.equal(result.status, "proved", "the KB must entail that teal is NOT a primary colour");
});

test("E6: the positive half needs no nominal reasoning at all — red is already directly typed", () => {
  const kb = buildTableauKb(primaryColours());
  const result = proveEntailment(kb, "red", atom("primary-colour"));
  assert.equal(result.status, "proved");
  assert.deepEqual(result.premises, ["f4"]);
});

test("E6: without the enumeration's pairwise differentFrom rows, teal is still not a primary colour", () => {
  // Pattern 13 always mints the pairwise inequalities, but the nominal-merge
  // block doesn't actually need them — UNA-lite treats every two distinct
  // declared names as inequal on its own.
  const rows = primaryColours().filter((r) => r.predicate !== "owl:differentFrom");
  const kb = buildTableauKb(rows);
  const result = proveEntailment(kb, "teal", notE(atom("primary-colour")));
  assert.equal(result.status, "proved");
});

test("E6: findTableauViolations reports nothing — teal was never asserted a primary colour, only asked about", () => {
  const kb = buildTableauKb(primaryColours());
  assert.deepEqual(kb.individuals.includes("teal"), false, "teal has no stored assertion at all");
});

test("a genuine member survives entailment as a primary colour without any UNA-lite clash", () => {
  const kb = buildTableauKb(primaryColours());
  const result = proveEntailment(kb, "yellow", atom("primary-colour"));
  assert.equal(result.status, "proved");
});

// ---- order-independence and budgets ----------------------------------------

test("order-independence: E6's proof is byte-identical across two input orders", () => {
  const rowsA = primaryColours();
  const rowsB = [...rowsA].reverse();
  const resultA = proveEntailment(buildTableauKb(rowsA), "teal", notE(atom("primary-colour")));
  const resultB = proveEntailment(buildTableauKb(rowsB), "teal", notE(atom("primary-colour")));
  assert.deepEqual(resultA, resultB);
});

test("budget: a step ceiling too small for the enumeration's own case split reports exhausted, never a guess", () => {
  const kb = buildTableauKb(primaryColours());
  const result = proveEntailment(kb, "teal", notE(atom("primary-colour")), { maxSteps: 1 });
  assert.equal(result.status, "exhausted");
  assert.equal(result.reason, "steps");
});

test("budget: a branch ceiling too small for the three-way nominal split reports exhausted", () => {
  const kb = buildTableauKb(primaryColours());
  const result = proveEntailment(kb, "teal", notE(atom("primary-colour")), { maxBranches: 1 });
  assert.equal(result.status, "exhausted");
  assert.equal(result.reason, "branches");
});
