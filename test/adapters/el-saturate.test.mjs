// el-saturate.test.mjs — saturateEl: the seven completion rules CR0-CR7, one
// positive and one control case per rule, order-independence, budget/round
// truncation, and the unsatisfiable report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeElTBox, saturateEl, TOP, BOT } from "../../src/domain/el-classify.mjs";

const row = (id, s, p, o) => ({ id: `fact:${id}`, subject: s, predicate: p, object: o, trust: 1 });
const has = (subsumers, a, x) => (subsumers.get(a) || new Set()).has(x);

test("CR0 — every concept name is seeded with itself and top", () => {
  const norm = normalizeElTBox([row("1", "cat", "rdfs:subClassOf", "mammal")]);
  const { subsumers } = saturateEl(norm);
  assert.ok(has(subsumers, "cat", "cat"));
  assert.ok(has(subsumers, "cat", TOP));
  assert.ok(has(subsumers, "mammal", "mammal"));
  assert.ok(has(subsumers, "mammal", TOP));
});

test("CR1 — A' in S(A), NF1 A'⊑B, entails B in S(A)", () => {
  const norm = normalizeElTBox([
    row("1", "cat", "rdfs:subClassOf", "mammal"),
    row("2", "mammal", "rdfs:subClassOf", "animal"),
  ]);
  const { subsumers, derivationOf } = saturateEl(norm);
  assert.ok(has(subsumers, "cat", "animal"), "CR1 chains through the intermediate");
  assert.deepEqual(derivationOf.get("cat␟animal"), ["fact:1", "fact:2"]);
});

test("CR1 control — no NF1 chain, no derived membership", () => {
  const norm = normalizeElTBox([row("1", "cat", "rdfs:subClassOf", "mammal")]);
  const { subsumers } = saturateEl(norm);
  assert.ok(!has(subsumers, "cat", "animal"));
});

test("CR2 — two conjuncts both in S(A), NF2 A1⊓A2⊑B, entails B in S(A)", () => {
  const norm = normalizeElTBox([
    row("1", "tabby", "rdfs:subClassOf", "cat"),
    row("2", "tabby", "rdfs:subClassOf", "pet"),
    row("3", "i1", "owl:intersectionOf", "cat"),
    row("4", "i1", "owl:intersectionOf", "pet"),
    row("5", "i1", "rdfs:subClassOf", "housecat"),
  ]);
  const { subsumers } = saturateEl(norm);
  assert.ok(has(subsumers, "tabby", "housecat"));
});

test("CR2 control — only one of the two conjuncts holds, nothing derived", () => {
  const norm = normalizeElTBox([
    row("1", "tabby", "rdfs:subClassOf", "cat"),
    row("3", "i1", "owl:intersectionOf", "cat"),
    row("4", "i1", "owl:intersectionOf", "pet"),
    row("5", "i1", "rdfs:subClassOf", "housecat"),
  ]);
  const { subsumers } = saturateEl(norm);
  assert.ok(!has(subsumers, "tabby", "housecat"));
});

test("CR3 — A' in S(A), NF3 A'⊑∃r.B, entails (A,B) in R(r)", () => {
  const norm = normalizeElTBox([
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
  ]);
  const { roleEdges } = saturateEl(norm);
  assert.ok(roleEdges.get("has")?.has("heart␟valve"));
});

test("CR3 control — a role edge is scoped to its own role, never bleeds into another", () => {
  const norm = normalizeElTBox([
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
  ]);
  const { roleEdges } = saturateEl(norm);
  assert.ok(!roleEdges.get("owns")?.has("heart␟valve"));
});

test("CR4 — (A,B) in R(r), B' in S(B), NF4 ∃r.B'⊑C, entails C in S(A)", () => {
  const norm = normalizeElTBox([
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
  ]);
  const { subsumers } = saturateEl(norm);
  assert.ok(has(subsumers, "heart", "some-has-valve"), "the restriction node itself is reached via its own NF4");
});

test("CR4 control — without the role edge, the restriction node is never reached", () => {
  const norm = normalizeElTBox([
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
  ]);
  const { subsumers } = saturateEl(norm);
  assert.ok(!has(subsumers, "valve", "some-has-valve"));
});

test("CR5 — (A,B) in R(r), bot in S(B), entails bot in S(A)", () => {
  const norm = normalizeElTBox([
    row("1", "tabby", "rdfs:subClassOf", "cat"),
    row("2", "tabby", "rdfs:subClassOf", "dog"),
    row("3", "cat", "owl:disjointWith", "dog"),
    row("4", "owner", "rdfs:subClassOf", "some-has-tabby"),
    row("5", "some-has-tabby", "owl:onProperty", "has"),
    row("6", "some-has-tabby", "owl:someValuesFrom", "tabby"),
  ]);
  const { subsumers, unsatisfiable } = saturateEl(norm);
  assert.ok(has(subsumers, "owner", BOT));
  assert.deepEqual(unsatisfiable, ["owner", "tabby"]);
});

test("CR5 control — a satisfiable filler never propagates bot through the role edge", () => {
  const norm = normalizeElTBox([
    row("1", "owner", "rdfs:subClassOf", "some-has-cat"),
    row("2", "some-has-cat", "owl:onProperty", "has"),
    row("3", "some-has-cat", "owl:someValuesFrom", "cat"),
  ]);
  const { unsatisfiable } = saturateEl(norm);
  assert.deepEqual(unsatisfiable, []);
});

test("CR6 — (A,B) in R(r), r⊑s, entails (A,B) in R(s)", () => {
  const norm = normalizeElTBox([
    row("1", "parent", "rdfs:subClassOf", "some-loves-child"),
    row("2", "some-loves-child", "owl:onProperty", "loves"),
    row("3", "some-loves-child", "owl:someValuesFrom", "child"),
    row("4", "loves", "rdfs:subPropertyOf", "cares-about"),
  ]);
  const { roleEdges } = saturateEl(norm);
  assert.ok(roleEdges.get("cares-about")?.has("parent␟child"));
});

test("CR6 control — without the subproperty declaration, the edge never propagates to the wider role", () => {
  const norm = normalizeElTBox([
    row("1", "parent", "rdfs:subClassOf", "some-loves-child"),
    row("2", "some-loves-child", "owl:onProperty", "loves"),
    row("3", "some-loves-child", "owl:someValuesFrom", "child"),
  ]);
  const { roleEdges } = saturateEl(norm);
  assert.ok(!roleEdges.get("cares-about")?.has("parent␟child"));
});

test("CR7 — (A,B),(B,C) in R(r), r transitive, entails (A,C) in R(r)", () => {
  const norm = normalizeElTBox([
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
    row("4", "valve", "rdfs:subClassOf", "some-has-hinge"),
    row("5", "some-has-hinge", "owl:onProperty", "has"),
    row("6", "some-has-hinge", "owl:someValuesFrom", "hinge"),
    row("7", "has", "rdf:type", "transitiveproperty"),
  ]);
  const { roleEdges } = saturateEl(norm);
  assert.ok(roleEdges.get("has")?.has("heart␟hinge"));
});

test("CR7 control — a non-transitive role never composes across two edges", () => {
  const norm = normalizeElTBox([
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
    row("4", "valve", "rdfs:subClassOf", "some-has-hinge"),
    row("5", "some-has-hinge", "owl:onProperty", "has"),
    row("6", "some-has-hinge", "owl:someValuesFrom", "hinge"),
  ]);
  const { roleEdges } = saturateEl(norm);
  assert.ok(!roleEdges.get("has")?.has("heart␟hinge"));
});

test("order-independence: feeding the same axioms in two different orders yields the identical subsumer sets and derivationOf", () => {
  const rows = [
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
    row("4", "valve", "rdfs:subClassOf", "flap"),
  ];
  const forward = saturateEl(normalizeElTBox(rows));
  const backward = saturateEl(normalizeElTBox([...rows].reverse()));
  const dump = (sat) => [...sat.subsumers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]);
  assert.deepEqual(dump(forward), dump(backward));
  assert.deepEqual([...forward.derivationOf.entries()].sort(), [...backward.derivationOf.entries()].sort());
});

test("budget truncation: a saturation that hits its commit budget mid-fixpoint reports truncated", () => {
  const rows = [
    row("1", "a", "rdfs:subClassOf", "b"),
    row("2", "b", "rdfs:subClassOf", "c"),
    row("3", "c", "rdfs:subClassOf", "d"),
    row("4", "d", "rdfs:subClassOf", "e"),
  ];
  const norm = normalizeElTBox(rows);
  const result = saturateEl(norm, { budget: 1 });
  assert.equal(result.truncated, true);
});

test("rounds truncation: a chain longer than the round cap never reaches its full fixpoint and reports truncated", () => {
  const rows = [];
  const chain = ["a", "b", "c", "d", "e", "f"];
  for (let i = 0; i < chain.length - 1; i += 1) rows.push(row(String(i), chain[i], "rdfs:subClassOf", chain[i + 1]));
  const norm = normalizeElTBox(rows);
  const result = saturateEl(norm, { rounds: 1 });
  assert.equal(result.truncated, true);
  assert.ok(!has(result.subsumers, "a", "f"), "one round is not enough to chain the whole run");
});

test("a saturation that reaches a genuine fixpoint within its caps reports truncated: false", () => {
  const norm = normalizeElTBox([row("1", "cat", "rdfs:subClassOf", "mammal")]);
  const result = saturateEl(norm);
  assert.equal(result.truncated, false);
});

test("focus scoping: a rule only fires when one of the concepts it touches is in the focus set", () => {
  const rows = [
    row("1", "cat", "rdfs:subClassOf", "mammal"),
    row("2", "dog", "rdfs:subClassOf", "canine"),
  ];
  const norm = normalizeElTBox(rows);
  const result = saturateEl(norm, { focus: new Set(["cat", "mammal"]) });
  assert.ok(has(result.subsumers, "cat", "mammal"));
  assert.ok(!has(result.subsumers, "dog", "canine"), "outside the focus set, CR1 never fires");
});

test("the unsatisfiable report is sorted and lists every concept whose subsumer set contains bot", () => {
  const rows = [
    row("1", "z", "rdfs:subClassOf", "cat"),
    row("2", "z", "rdfs:subClassOf", "dog"),
    row("3", "cat", "owl:disjointWith", "dog"),
    row("4", "a", "rdfs:subClassOf", "cat"),
    row("5", "a", "rdfs:subClassOf", "dog"),
  ];
  const norm = normalizeElTBox(rows);
  const { unsatisfiable } = saturateEl(norm);
  assert.deepEqual(unsatisfiable, ["a", "z"]);
});
