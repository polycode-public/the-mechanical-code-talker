// tableau-cardinality.test.mjs — owl:minCardinality/maxCardinality/cardinality
// with owl:onClass: the ≥-rule generating pairwise-distinct successors, the
// ≤-rule merging surplus successors under the UNA-lite identity side-condition,
// and the min/max clash (E5, PLAN_SYLLOGIST_EL_DL.md) closing with both
// premises named.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTableauKb, canonicalKey, findTableauViolations, isSatisfiable, proveEntailment } from "../../src/domain/tableau.mjs";

const atom = (name) => ({ t: "atom", name });
const findNode = (model, id) => model.nodes.find((n) => n.id === id);
const hasLabel = (node, expr) => node.labels.some((l) => canonicalKey(l.expr) === canonicalKey(expr));

const bicycleWithWheels = (minN, maxN) => {
  const rows = [
    { id: "f1", subject: "beryl", predicate: "rdf:type", object: "bicycle" },
    { id: "f2", subject: "bicycle", predicate: "rdfs:subClassOf", object: "min-wheel" },
    { id: "f3", subject: "min-wheel", predicate: "owl:onProperty", object: "has" },
    { id: "f4", subject: "min-wheel", predicate: "owl:onClass", object: "wheel" },
    { id: "f5", subject: "min-wheel", predicate: "owl:minCardinality", object: String(minN) },
  ];
  if (maxN != null) {
    rows.push(
      { id: "f6", subject: "bicycle", predicate: "rdfs:subClassOf", object: "max-wheel" },
      { id: "f7", subject: "max-wheel", predicate: "owl:onProperty", object: "has" },
      { id: "f8", subject: "max-wheel", predicate: "owl:onClass", object: "wheel" },
      { id: "f9", subject: "max-wheel", predicate: "owl:maxCardinality", object: String(maxN) },
    );
  }
  return rows;
};

// ---- reading the store: min/max/exact + onClass into atLeast/atMost -------

test("owl:cardinality (exact) with onClass reads as BOTH ≥n and ≤n on the same role and filler", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "car", predicate: "rdfs:subClassOf", object: "exact-4-wheel" },
    { id: "f2", subject: "exact-4-wheel", predicate: "owl:onProperty", object: "has" },
    { id: "f3", subject: "exact-4-wheel", predicate: "owl:onClass", object: "wheel" },
    { id: "f4", subject: "exact-4-wheel", predicate: "owl:cardinality", object: "4" },
  ]);
  const hasAxiom = (sub, sup) => kb.axioms.some((a) => canonicalKey(a.sub) === canonicalKey(sub) && canonicalKey(a.sup) === canonicalKey(sup));
  assert.ok(hasAxiom(atom("car"), { t: "atLeast", n: 4, r: "has", c: atom("wheel") }));
  assert.ok(hasAxiom(atom("car"), { t: "atMost", n: 4, r: "has", c: atom("wheel") }));
});

// ---- the ≥-rule: n pairwise-distinct successors ----------------------------

test("the ≥-rule generates exactly n fresh, deterministically-named successors", () => {
  const result = isSatisfiable(buildTableauKb([]), [
    { ind: "x", expr: { t: "atLeast", n: 3, r: "has", c: atom("wheel") }, from: ["p1"] },
  ]);
  assert.equal(result.satisfiable, true);
  for (const suffix of [1, 2, 3]) {
    const succ = findNode(result.model, `x.${suffix}`);
    assert.ok(succ, `x.${suffix} must exist`);
    assert.ok(hasLabel(succ, atom("wheel")));
  }
  assert.ok(!findNode(result.model, "x.4"), "no more than n successors are generated");
});

test("the ≥-rule tops up existing witnesses rather than duplicating them", () => {
  // x already has one has-wheel successor (via a plain ∃); ≥2 should add
  // only one MORE, not two fresh ones.
  const query = { t: "and", cs: [{ t: "some", r: "has", c: atom("wheel") }, { t: "atLeast", n: 2, r: "has", c: atom("wheel") }] };
  const result = isSatisfiable(buildTableauKb([]), [{ ind: "x", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const wheelSuccessors = result.model.nodes.filter((n) => n.parent === "x" && hasLabel(n, atom("wheel")));
  assert.equal(wheelSuccessors.length, 2, `expected exactly 2 wheel successors, got ${wheelSuccessors.length}`);
});

test("a ≥-rule generating node never fires when blocked", () => {
  // A self-referential ≥1 chain must still terminate via blocking, exactly
  // like the ∃-rule's own termination test.
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "min-a" },
    { id: "f3", subject: "min-a", predicate: "owl:onProperty", object: "has" },
    { id: "f4", subject: "min-a", predicate: "owl:onClass", object: "a" },
    { id: "f5", subject: "min-a", predicate: "owl:minCardinality", object: "1" },
  ]);
  const result = isSatisfiable(kb, []);
  assert.equal(result.satisfiable, true);
  assert.ok(result.model.nodes.length <= 4, `blocking must cap the model size, got ${result.model.nodes.length} nodes`);
  assert.ok(result.steps < 200, `blocking must terminate quickly, took ${result.steps} steps`);
});

// ---- the ≤-rule: merging surplus successors --------------------------------

test("the ≤-rule merges two anonymous successors down to the threshold when nothing forbids it", () => {
  const query = {
    t: "and",
    cs: [
      { t: "some", r: "has", c: { t: "and", cs: [atom("wheel"), atom("front")] } },
      { t: "some", r: "has", c: { t: "and", cs: [atom("wheel"), atom("back")] } },
      { t: "atMost", n: 1, r: "has", c: atom("wheel") },
    ],
  };
  const result = isSatisfiable(buildTableauKb([]), [{ ind: "x", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const wheelSuccessors = result.model.nodes.filter((n) => n.parent === "x" && hasLabel(n, atom("wheel")));
  assert.equal(wheelSuccessors.length, 1, "the two wheel successors must have merged into one");
  assert.ok(hasLabel(wheelSuccessors[0], atom("front")), "the merged node keeps both sides' other labels");
  assert.ok(hasLabel(wheelSuccessors[0], atom("back")));
});

test("kb.differentFrom reads owl:differentFrom rows, sorted, one direction as stored", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "red", predicate: "owl:differentFrom", object: "blue" },
  ]);
  assert.deepEqual(kb.differentFrom, [{ a: "red", b: "blue", from: ["f1"] }]);
});

// ---- E5: the min/max clash, both premises named ----------------------------

test("E5: a min/max cardinality clash on the same restricted property makes the store inconsistent", () => {
  const kb = buildTableauKb(bicycleWithWheels(2, 0));
  const result = proveEntailment(kb, "beryl", { t: "not", c: atom("bicycle") });
  assert.equal(result.status, "proved", "the KB must be inconsistent, so beryl provably is NOT a bicycle either way");
});

test("E5: findTableauViolations reports the clash with both the min and the max restriction named", () => {
  const kb = buildTableauKb(bicycleWithWheels(2, 0));
  const violations = findTableauViolations(kb, ["beryl"]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].subject, "beryl");
  // f2-f5 name the ≥2 restriction, f6-f9 name the ≤0 restriction, f1 names
  // beryl's own membership — "both premises named" means both restrictions'
  // own fact ids show up, not just one side of the clash.
  assert.ok(violations[0].premises.includes("f5"), "the min-cardinality fact must be named");
  assert.ok(violations[0].premises.includes("f9"), "the max-cardinality fact must be named");
});

test("a min cardinality alone, with no conflicting max, stays perfectly consistent", () => {
  const kb = buildTableauKb(bicycleWithWheels(2, null));
  assert.deepEqual(findTableauViolations(kb, ["beryl"]), []);
});

test("a min/max pair that does NOT overlap in role or filler stays consistent", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "beryl", predicate: "rdf:type", object: "bicycle" },
    { id: "f2", subject: "bicycle", predicate: "rdfs:subClassOf", object: "min-wheel" },
    { id: "f3", subject: "min-wheel", predicate: "owl:onProperty", object: "has" },
    { id: "f4", subject: "min-wheel", predicate: "owl:onClass", object: "wheel" },
    { id: "f5", subject: "min-wheel", predicate: "owl:minCardinality", object: "2" },
    { id: "f6", subject: "bicycle", predicate: "rdfs:subClassOf", object: "max-engine" },
    { id: "f7", subject: "max-engine", predicate: "owl:onProperty", object: "has" },
    { id: "f8", subject: "max-engine", predicate: "owl:onClass", object: "engine" },
    { id: "f9", subject: "max-engine", predicate: "owl:maxCardinality", object: "0" },
  ]);
  assert.deepEqual(findTableauViolations(kb, ["beryl"]), []);
});

// ---- determinism ------------------------------------------------------------

test("order-independence: E5's clash is byte-identical across two input orders", () => {
  const rowsA = bicycleWithWheels(2, 0);
  const rowsB = [...rowsA].reverse();
  const resultA = findTableauViolations(buildTableauKb(rowsA), ["beryl"]);
  const resultB = findTableauViolations(buildTableauKb(rowsB), ["beryl"]);
  assert.deepEqual(resultA, resultB);
});

// ---- budgets: honest exhaustion, never a guessed verdict -------------------

test("budget: a step ceiling too small for the ≥-rule to finish reports exhausted, not a verdict", () => {
  const result = isSatisfiable(buildTableauKb([]), [
    { ind: "x", expr: { t: "atLeast", n: 5, r: "has", c: atom("wheel") }, from: ["p1"] },
  ], { maxSteps: 1 });
  assert.equal(result.satisfiable, null);
  assert.equal(result.exhausted, "steps");
});

test("budget: a branch ceiling too small for the ≤-rule's merge choice reports exhausted", () => {
  // Two independently ∃-created wheel successors (not the ≥-rule's own
  // forced-distinct pair) give the ≤-rule exactly one mergeable candidate —
  // opening that one branch alone already exceeds a ceiling of 1.
  const query = {
    t: "and",
    cs: [
      { t: "some", r: "has", c: { t: "and", cs: [atom("wheel"), atom("front")] } },
      { t: "some", r: "has", c: { t: "and", cs: [atom("wheel"), atom("back")] } },
      { t: "atMost", n: 1, r: "has", c: atom("wheel") },
    ],
  };
  const result = isSatisfiable(buildTableauKb([]), [{ ind: "x", expr: query, from: ["p1"] }], { maxBranches: 1 });
  assert.equal(result.satisfiable, null);
  assert.equal(result.exhausted, "branches");
});

test("budget: findTableauViolations omits a subject whose check exhausts, rather than reporting it clean", () => {
  const kb = buildTableauKb(bicycleWithWheels(2, 0));
  assert.equal(findTableauViolations(kb, ["beryl"], { maxSteps: 1 }).length, 0);
});
