// tableau-role-hierarchy.test.mjs — rdfs:subPropertyOf: an edge on a
// narrower role reads as an edge on every role above it, for both the
// existential witness check and the universal rule, through a role closure
// precomputed once per KB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTableauKb, canonicalKey, isSatisfiable, proveEntailment } from "../../src/domain/tableau.mjs";
import { parseAce } from "../../src/domain/grammar/ace.mjs";

const atom = (name) => ({ t: "atom", name });
const someE = (r, c) => ({ t: "some", r, c });
const allE = (r, c) => ({ t: "all", r, c });
const andE = (cs) => ({ t: "and", cs });
const findNode = (model, id) => model.nodes.find((n) => n.id === id);
const hasLabel = (node, expr) => node.labels.some((l) => canonicalKey(l.expr) === canonicalKey(expr));

const hierarchyKb = () => buildTableauKb([{ id: "h0", subject: "owning", predicate: "rdfs:subPropertyOf", object: "has" }]);

test("the ∃-rule accepts an existing edge on a sub-role as a witness for the wider role", () => {
  // The role expansion order follows sortedLabelEntries' canonicalKey sort,
  // not source order, so "aardvark" (the sub-role) is always the one whose
  // existential fires first here — its edge must then already satisfy the
  // wider role's own existential with no second successor.
  const kb = buildTableauKb([{ id: "h0", subject: "aardvark", predicate: "rdfs:subPropertyOf", object: "has" }]);
  const query = andE([someE("aardvark", atom("valve")), someE("has", atom("valve"))]);
  const result = isSatisfiable(kb, [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const children = result.model.nodes.filter((n) => n.parent === "heart");
  assert.equal(children.length, 1, "a sub-role edge must satisfy the wider role's existential with no fresh successor");
  assert.ok(hasLabel(children[0], atom("valve")));
});

test("the ∃-rule does NOT let a super-role edge witness the narrower role", () => {
  const query = andE([someE("has", atom("valve")), someE("owning", atom("valve"))]);
  const result = isSatisfiable(hierarchyKb(), [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  // "has" is above "owning" in the hierarchy, so a has-edge does not
  // satisfy ∃owning.valve — two distinct successors must be created.
  const children = result.model.nodes.filter((n) => n.parent === "heart");
  assert.equal(children.length, 2, "a has-edge must not witness the narrower ∃owning.valve on its own");
});

test("the ∀-rule propagates through a sub-role edge onto the wider role's filler", () => {
  const query = andE([someE("owning", atom("valve")), allE("has", atom("moving-part"))]);
  const result = isSatisfiable(hierarchyKb(), [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const successor = result.model.nodes.find((n) => n.parent === "heart");
  assert.ok(successor, "the ∃-rule must have created an owning-successor");
  assert.ok(hasLabel(successor, atom("moving-part")), "∀has.C must reach an owning-successor, since owning is below has");
});

test("the ∀-rule never propagates the other way, from the wider role down to the narrower one", () => {
  const query = andE([someE("has", atom("valve")), allE("owning", atom("moving-part"))]);
  const result = isSatisfiable(hierarchyKb(), [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const successor = result.model.nodes.find((n) => n.parent === "heart");
  assert.ok(successor);
  assert.ok(!hasLabel(successor, atom("moving-part")), "∀owning.C must not reach a plain has-successor");
});

test("role closure chains transitively through more than one subPropertyOf hop", () => {
  const kb = buildTableauKb([
    { id: "h1", subject: "a-inner", predicate: "rdfs:subPropertyOf", object: "m-mid" },
    { id: "h2", subject: "m-mid", predicate: "rdfs:subPropertyOf", object: "z-outer" },
  ]);
  // "a-inner" sorts alphabetically first, so its existential's edge is the
  // one already on the branch when "z-outer"'s existential is checked.
  const query = andE([someE("a-inner", atom("valve")), someE("z-outer", atom("valve"))]);
  const result = isSatisfiable(kb, [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const children = result.model.nodes.filter((n) => n.parent === "heart");
  assert.equal(children.length, 1, "a two-hop sub-role edge must still witness the role two levels above it");
});

test("proveEntailment closes through a role hierarchy read entirely from stored axioms", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "heart", predicate: "rdfs:subClassOf", object: "some-owning-valve" },
    { id: "f2", subject: "some-owning-valve", predicate: "owl:onProperty", object: "owning" },
    { id: "f3", subject: "some-owning-valve", predicate: "owl:someValuesFrom", object: "valve" },
    { id: "f4", subject: "owning", predicate: "rdfs:subPropertyOf", object: "has" },
    { id: "f5", subject: "x", predicate: "rdf:type", object: "heart" },
  ]);
  const result = proveEntailment(kb, "x", someE("has", atom("valve")));
  assert.equal(result.status, "proved");
});

test("blocking is unaffected by a role hierarchy: the equality-blocking termination test still terminates", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "some-owning-a" },
    { id: "f3", subject: "some-owning-a", predicate: "owl:onProperty", object: "owning" },
    { id: "f4", subject: "some-owning-a", predicate: "owl:someValuesFrom", object: "a" },
    { id: "f5", subject: "owning", predicate: "rdfs:subPropertyOf", object: "has" },
  ]);
  const result = isSatisfiable(kb, []);
  assert.equal(result.satisfiable, true);
  assert.ok(result.model.nodes.length <= 4, `blocking must still cap the model size, got ${result.model.nodes.length} nodes`);
  assert.ok(result.steps < 200, `blocking must still terminate quickly, took ${result.steps} steps`);
});

test("order-independence: role-hierarchy propagation is byte-identical across two input orders", () => {
  const rowsA = [
    { id: "f1", subject: "heart", predicate: "rdfs:subClassOf", object: "some-owning-valve" },
    { id: "f2", subject: "some-owning-valve", predicate: "owl:onProperty", object: "owning" },
    { id: "f3", subject: "some-owning-valve", predicate: "owl:someValuesFrom", object: "valve" },
    { id: "f4", subject: "owning", predicate: "rdfs:subPropertyOf", object: "has" },
    { id: "f5", subject: "x", predicate: "rdf:type", object: "heart" },
  ];
  const rowsB = [...rowsA].reverse();
  const resultA = proveEntailment(buildTableauKb(rowsA), "x", someE("has", atom("valve")));
  const resultB = proveEntailment(buildTableauKb(rowsB), "x", someE("has", atom("valve")));
  assert.deepEqual(resultA, resultB);
});

test("a role with no declared hierarchy still matches only itself, exactly as before role hierarchies existed", () => {
  const kb = buildTableauKb([]);
  const query = andE([someE("has", atom("valve")), someE("owning", atom("valve"))]);
  const result = isSatisfiable(kb, [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const children = result.model.nodes.filter((n) => n.parent === "heart");
  assert.equal(children.length, 2, "with no declared subPropertyOf, has and owning stay two distinct roles");
});

// ---- ACE pattern 19's taught row, read by the same KB reader --------------

test("a taught ACE pattern-19 row ('containing implies touching') produces the same roleClosure shape as the hand-built subPropertyOf fixture", () => {
  const taught = parseAce("containing implies touching");
  const rows = taught.triples.map((t, i) => ({ id: `t${i}`, ...t }));
  const kb = buildTableauKb(rows);
  assert.deepEqual(kb.roleClosure.get("tmct:touches"), new Set(["tmct:touches", "tmct:contains"]));
  assert.deepEqual(kb.roleClosure.get("tmct:contains"), new Set(["tmct:contains"]));
});

test("the taught pattern-19 row lets a taught contains-edge satisfy an existential over touches, the same way the hand-built fixture does", () => {
  const taught = parseAce("containing implies touching");
  const kb = buildTableauKb(taught.triples.map((t, i) => ({ id: `t${i}`, ...t })));
  const query = andE([someE("tmct:contains", atom("valve")), someE("tmct:touches", atom("valve"))]);
  const result = isSatisfiable(kb, [{ ind: "heart", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const children = result.model.nodes.filter((n) => n.parent === "heart");
  assert.equal(children.length, 1, "a contains-edge must satisfy the wider touches existential with no fresh successor");
});
