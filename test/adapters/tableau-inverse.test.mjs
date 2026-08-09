// tableau-inverse.test.mjs — owl:inverseOf: ACE pattern 17's triple
// emission, the inverse-aware ∃/∀/≤ rule handling, pairwise blocking
// (Horrocks & Sattler) terminating a mutually-referential loop that plain
// equality blocking would mishandle once a role and its inverse can both be
// walked, and the motivating example proved both through nominal merging
// and through a directly asserted ABox role edge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAce } from "../../src/domain/grammar/ace.mjs";
import { buildTableauKb, canonicalKey, isSatisfiable, proveEntailment, proveSubsumption, toNNF } from "../../src/domain/tableau.mjs";

const atom = (name) => ({ t: "atom", name });
const nom = (ind) => ({ t: "nom", ind });
const notE = (c) => ({ t: "not", c });
const andE = (cs) => ({ t: "and", cs });
const someE = (r, c) => ({ t: "some", r, c });
const allE = (r, c) => ({ t: "all", r, c });
const findNode = (model, id) => model.nodes.find((n) => n.id === id);
const hasLabel = (node, expr) => node.labels.some((l) => canonicalKey(l.expr) === canonicalKey(expr));

// ---- pattern 17's triple emission -------------------------------------------

test("pattern 17: 'V1 is the inverse of V2' emits owl:inverseOf in both directions", () => {
  const result = parseAce("containing is the inverse of belonging");
  assert.equal(result.pattern, "inverseRole");
  assert.deepEqual(result.triples, [
    { subject: "tmct:contains", predicate: "owl:inverseOf", object: "mgx:partOf", kind: "owl:inverseOf" },
    { subject: "mgx:partOf", predicate: "owl:inverseOf", object: "tmct:contains", kind: "owl:inverseOf" },
  ]);
});

test("pattern 17 accepts the 3sg surface on both sides, not just the gerund", () => {
  const gerund = parseAce("containing is the inverse of belonging");
  const thirdPerson = parseAce("contains is the inverse of belongs");
  assert.deepEqual(gerund.triples, thirdPerson.triples);
});

test("pattern 17 declines when either verb is undeclared", () => {
  const result = parseAce("floating is the inverse of sinking");
  assert.notEqual(result?.pattern, "inverseRole");
});

test("pattern 17 declines a sentence of the wrong shape entirely", () => {
  assert.equal(parseAce("containing is transitive")?.pattern, "transitiveRole");
  assert.equal(parseAce("every heart contains a valve")?.pattern, "bareExistential");
});

// ---- reading owl:inverseOf into the KB --------------------------------------

test("buildTableauKb reads owl:inverseOf symmetrically from ACE's own two-row emission", () => {
  const { triples } = parseAce("containing is the inverse of belonging");
  const rows = triples.map((t, i) => ({ id: `f${i + 1}`, ...t }));
  const kb = buildTableauKb(rows);
  assert.equal(kb.inverseOf.get("tmct:contains"), "mgx:partOf");
  assert.equal(kb.inverseOf.get("mgx:partOf"), "tmct:contains");
});

test("buildTableauKb symmetrizes a single stored owl:inverseOf row on its own", () => {
  const kb = buildTableauKb([{ id: "f1", subject: "contains", predicate: "owl:inverseOf", object: "part-of" }]);
  assert.equal(kb.inverseOf.get("contains"), "part-of");
  assert.equal(kb.inverseOf.get("part-of"), "contains");
});

// ---- the inverse-aware ∃/∀/≤ rules -----------------------------------------

const inverseKb = (extraRows = []) => buildTableauKb([
  { id: "i1", subject: "contains", predicate: "owl:inverseOf", object: "belongs" },
  ...extraRows,
]);

test("the ∃-rule accepts an existing INCOMING edge, read through its inverse, as a witness", () => {
  // x is itself labelled "origin" and has an outgoing "contains" edge to a
  // successor that also needs ∃belongs.origin — the successor's own
  // incoming "contains" edge, read backwards through its inverse, already
  // witnesses that: x itself IS origin, so no fresh successor is needed.
  const query = andE([atom("origin"), someE("contains", andE([atom("valve"), someE("belongs", atom("origin"))]))]);
  const result = isSatisfiable(inverseKb(), [{ ind: "x", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const successor = findNode(result.model, "x.1");
  assert.ok(successor, "the ∃-rule must still create the one real contains-successor");
  assert.ok(hasLabel(successor, atom("valve")));
  assert.ok(!findNode(result.model, "x.1.1"), "no fresh successor for belongs — the reversed contains edge already witnesses it");
});

test("the ∀-rule reads a role edge in reverse through its declared inverse", () => {
  // heart has ∃contains.(valve ⊓ ∀belongs.origin); the ∀belongs.origin lives
  // on the SUCCESSOR, and must reach back onto heart itself by reading the
  // contains edge backwards as a belongs edge.
  const query = someE("contains", andE([atom("valve"), allE("belongs", atom("origin"))]));
  const result = isSatisfiable(inverseKb(), [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const heart = findNode(result.model, "heart");
  assert.ok(hasLabel(heart, atom("origin")), "the successor's ∀belongs.origin must reach back onto heart via contains' inverse");
});

test("a role with no declared inverse still reads forward only, exactly as before", () => {
  const query = someE("contains", andE([atom("valve"), allE("belongs", atom("origin"))]));
  const result = isSatisfiable(buildTableauKb([]), [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const heart = findNode(result.model, "heart");
  assert.ok(!hasLabel(heart, atom("origin")), "with no inverse declared, nothing reaches back onto heart");
});

test("the ≤-rule counts an inverse-read witness alongside a forward one", () => {
  // x has one forward "contains" edge to a wheel successor (x.1). A second,
  // separate named individual y is wheel-typed and asserts ∃belongs.{x} —
  // through the nominal merge that edge lands as y --belongs--> x directly,
  // which reads as a SECOND contains-witness of x via belongs' inverse. An
  // atMost(1, contains, wheel) on x must then force x.1 to merge with y.
  const kb = buildTableauKb([
    { id: "i1", subject: "contains", predicate: "owl:inverseOf", object: "belongs" },
    { id: "f1", subject: "x-choice", predicate: "owl:oneOf", object: "x" },
    { id: "f2", subject: "x", predicate: "rdf:type", object: "x-choice" },
  ]);
  const xQuery = andE([
    someE("contains", andE([atom("wheel"), atom("front")])),
    { t: "atMost", n: 1, r: "contains", c: atom("wheel") },
  ]);
  const yQuery = andE([atom("wheel"), atom("back"), someE("belongs", nom("x"))]);
  const result = isSatisfiable(kb, [
    { ind: "x", expr: xQuery, from: ["p1"] },
    { ind: "y", expr: yQuery, from: ["p2"] },
  ]);
  assert.equal(result.satisfiable, true);
  const y = findNode(result.model, "y");
  assert.ok(hasLabel(y, atom("front")), "y absorbed x.1's labels — the two wheel witnesses merged into one");
  assert.ok(!findNode(result.model, "x.1"), "x.1 no longer exists as its own node — it merged into y");
});

// ---- pairwise blocking: the mutually-referential loop -----------------------

test("termination: pairwise blocking terminates a mutually-referential loop (A ⊑ ∃r.A, r owl:inverseOf invR, a backward-reading ∀invR on the root)", () => {
  // The self-referential existential chain from the plain-ALC and
  // transitive-role termination tests (A ⊑ ∃r.A), now with r's inverse
  // declared AND a ∀invR obligation asserted on the root that reads back
  // through it — this is what actually activates pairwise blocking (any
  // declared inverse anywhere in the KB switches every isBlocked call over
  // to it) rather than the plain equality check the same chain terminates
  // under everywhere else. A candidate successor's own incoming-edge role
  // set must match its blocking ancestor's, not just its concept labels.
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "some-r-a" },
    { id: "f3", subject: "some-r-a", predicate: "owl:onProperty", object: "r" },
    { id: "f4", subject: "some-r-a", predicate: "owl:someValuesFrom", object: "a" },
    { id: "f5", subject: "r", predicate: "owl:inverseOf", object: "invr" },
  ]);
  const result = isSatisfiable(kb, [{ ind: "x", expr: allE("invr", atom("marker")), from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  assert.ok(result.model.nodes.length <= 4, `pairwise blocking must cap the model size, got ${result.model.nodes.length} nodes`);
  assert.ok(result.steps < 500, `pairwise blocking must terminate, took ${result.steps} steps`);
});

test("kb.inverseOf being non-empty makes blocking pairwise: a node whose incoming-edge role differs from its label-equal ancestor's is not blocked by it alone", () => {
  const kb = inverseKb();
  // x has no incoming edges; x.1 (created by the ∃-rule) has one incoming
  // "contains" edge from x. Even if their labels end up identical, pairwise
  // blocking must not equate them on labels alone.
  const query = someE("contains", atom("a"));
  const result = isSatisfiable(kb, [{ ind: "x", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const x = findNode(result.model, "x");
  const x1 = findNode(result.model, "x.1");
  assert.ok(x && x1);
});

// ---- the motivating example, proved -----------------------------------------

test("motivating example: an asserted 'contains' edge between two named individuals answers 'is X part of Y' through the recorded inverse alone", () => {
  // Two nominal individuals stand in for named "myHeart"/"myValve" — the
  // only mechanism this KB shape has for pinning a role edge onto a SPECIFIC
  // named individual (buildTableauKb has no direct ABox relation reading).
  // myHeart is asserted to contain myValve; the query then asks, from
  // myValve's own side, whether it is NOT mgx:partOf myHeart — if the KB
  // can only make that consistent by contradicting itself, the inverse
  // edge alone proved the positive.
  const kb = buildTableauKb([
    { id: "f1", subject: "heart-choice", predicate: "owl:oneOf", object: "myHeart" },
    { id: "f2", subject: "myHeart", predicate: "rdf:type", object: "heart-choice" },
    { id: "f3", subject: "valve-choice", predicate: "owl:oneOf", object: "myValve" },
    { id: "f4", subject: "myValve", predicate: "rdf:type", object: "valve-choice" },
    { id: "f5", subject: "contains", predicate: "owl:inverseOf", object: "mgx:partOf" },
  ]);
  const result = isSatisfiable(kb, [
    { ind: "myHeart", expr: someE("contains", nom("myValve")), from: ["p1"] },
    { ind: "myValve", expr: toNNF(notE(someE("mgx:partOf", nom("myHeart")))), from: ["p2"] },
  ]);
  assert.equal(result.satisfiable, false, "myValve cannot consistently NOT be mgx:partOf myHeart once myHeart contains it");
});

test("the 4e motivating example, proved from a directly asserted relation rather than through nominals: teach one contains edge, declare the inverse, and the belongs direction reads off it", () => {
  // The motivating example above needed owl:oneOf to pin an edge onto two
  // SPECIFIC named individuals, because buildTableauKb had no ABox relation
  // reader yet — the only way to plant "myHeart contains myValve" was to
  // fake it through nominal merging. Now the edge comes straight from a
  // stored role-assertion row, no oneOf trick needed to create it.
  const kb = buildTableauKb([
    { id: "f1", subject: "myHeart", predicate: "rdf:type", object: "heart" },
    { id: "f2", subject: "myValve", predicate: "rdf:type", object: "valve" },
    { id: "f3", subject: "myHeart", predicate: "contains", object: "myValve" },
    { id: "f4", subject: "contains", predicate: "owl:inverseOf", object: "mgx:partOf" },
  ]);
  assert.deepEqual(kb.roleAssertions, [{ a: "myHeart", r: "contains", b: "myValve", from: ["f3"] }]);
  const result = proveEntailment(kb, "myValve", someE("mgx:partOf", atom("heart")));
  assert.equal(result.status, "proved", "myValve must be provably part of SOME heart, read entirely off the reversed contains edge");
});

// ---- order-independence and budgets ----------------------------------------

test("order-independence: the inverse-aware ∀-rule's propagation is byte-identical across two input orders", () => {
  const rowsA = [{ id: "i1", subject: "contains", predicate: "owl:inverseOf", object: "belongs" }];
  const rowsB = [...rowsA].reverse();
  const query = someE("contains", andE([atom("valve"), allE("belongs", atom("origin"))]));
  const resultA = isSatisfiable(buildTableauKb(rowsA), [{ ind: "heart", expr: query, from: ["p1"] }]);
  const resultB = isSatisfiable(buildTableauKb(rowsB), [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.deepEqual(resultA, resultB);
});

test("budget: a step ceiling too small to finish the inverse-aware chase reports exhausted, never a guess", () => {
  const kb = inverseKb();
  const query = someE("contains", andE([atom("valve"), allE("belongs", atom("origin"))]));
  const result = isSatisfiable(kb, [{ ind: "heart", expr: query, from: ["p1"] }], { maxSteps: 1 });
  assert.equal(result.satisfiable, null);
  assert.equal(result.exhausted, "steps");
});

test("proveSubsumption stays honest: an inverse declaration alone does not entail that every valve is part of a heart", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "heart", predicate: "rdfs:subClassOf", object: "some-contains-valve" },
    { id: "f2", subject: "some-contains-valve", predicate: "owl:onProperty", object: "contains" },
    { id: "f3", subject: "some-contains-valve", predicate: "owl:someValuesFrom", object: "valve" },
    { id: "f4", subject: "contains", predicate: "owl:inverseOf", object: "mgx:partOf" },
  ]);
  const result = proveSubsumption(kb, "valve", { t: "some", r: "mgx:partOf", c: atom("heart") });
  assert.equal(result.status, "disproved", "a class-level inverse consequence must not be fabricated from an individual-only fact");
});
