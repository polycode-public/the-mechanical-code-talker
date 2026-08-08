// el-goals.test.mjs — elGoalAxioms/elGoalFor/proveElSubsumption: batch goal
// minting is bounded and deterministic, the query-mode name matches the
// batch name for the same role/filler, E1 and E2 close through
// proveElSubsumption, and a subsumer that only appears after CR2 saturation
// (never in the plain asserted ancestor chain) still gets its goal minted and
// materialises in a batch pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeElTBox, saturateEl, elGoalAxioms, elGoalFor, proveElSubsumption, TOP,
} from "../../src/domain/el-classify.mjs";

const row = (id, s, p, o) => ({ id: `fact:${id}`, subject: s, predicate: p, object: o, trust: 1 });

test("elGoalFor mints the deterministic some-<role>-<filler> name and an NF4 axiom with no premises", () => {
  const { axiom, name } = elGoalFor("has", "flap");
  assert.equal(name, "some-has-flap");
  assert.deepEqual(axiom, { form: "someLeft", role: "has", filler: "flap", sup: "some-has-flap", from: [] });
});

test("elGoalFor normalizes its role/filler the same way stored terms are normalized", () => {
  const { name } = elGoalFor("Has", "The Flap");
  assert.equal(name, "some-has-flap");
});

test("elGoalAxioms mints one goal per (role, filler) subsumer pair reachable from every NF3 axiom's filler", () => {
  const rows = [
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
    row("4", "valve", "rdfs:subClassOf", "flap"),
  ];
  const norm = normalizeElTBox(rows);
  const firstPass = saturateEl(norm);
  const goals = elGoalAxioms(norm, firstPass.subsumers);
  const names = goals.map((g) => g.sup).sort();
  assert.deepEqual(names, ["some-has-flap", "some-has-valve"]);
});

test("elGoalAxioms is deterministic: the same TBox in two row orders mints the identical goal set", () => {
  const rows = [
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
    row("4", "valve", "rdfs:subClassOf", "flap"),
  ];
  const a = normalizeElTBox(rows);
  const b = normalizeElTBox([...rows].reverse());
  const goalsA = elGoalAxioms(a, saturateEl(a).subsumers);
  const goalsB = elGoalAxioms(b, saturateEl(b).subsumers);
  assert.deepEqual(goalsA, goalsB);
});

test("elGoalAxioms never mints a goal for top or bot as the filler", () => {
  const rows = [
    row("1", "owner", "rdfs:subClassOf", "some-has-tabby"),
    row("2", "some-has-tabby", "owl:onProperty", "has"),
    row("3", "some-has-tabby", "owl:someValuesFrom", "tabby"),
    row("4", "tabby", "rdfs:subClassOf", "cat"),
    row("5", "tabby", "rdfs:subClassOf", "dog"),
    row("6", "cat", "owl:disjointWith", "dog"),
  ];
  const norm = normalizeElTBox(rows);
  const firstPass = saturateEl(norm);
  const goals = elGoalAxioms(norm, firstPass.subsumers);
  for (const g of goals) {
    assert.notEqual(g.filler, TOP);
    assert.notEqual(g.filler, "bot");
  }
});

test("elGoalAxioms respects its own budget, capping the total goal count", () => {
  const rows = [
    row("1", "a", "rdfs:subClassOf", "some-has-x"),
    row("2", "some-has-x", "owl:onProperty", "has"),
    row("3", "some-has-x", "owl:someValuesFrom", "x"),
    row("4", "x", "rdfs:subClassOf", "y1"),
    row("5", "x", "rdfs:subClassOf", "y2"),
    row("6", "x", "rdfs:subClassOf", "y3"),
  ];
  const norm = normalizeElTBox(rows);
  const firstPass = saturateEl(norm);
  const goals = elGoalAxioms(norm, firstPass.subsumers, { budget: 2 });
  assert.equal(goals.length, 2);
});

test("E1 closes: a nested existential (heart⊑∃has.valve, valve⊑flap) proves \"does a heart have a flap\"", () => {
  const rows = [
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
    row("4", "valve", "rdfs:subClassOf", "flap"),
  ];
  const result = proveElSubsumption(rows, "heart", { role: "has", filler: "flap" });
  assert.equal(result.proved, true);
  assert.deepEqual(result.premises, ["fact:1", "fact:2", "fact:3", "fact:4"]);
});

test("E2 closes: an existential chain composes through a declared-transitive role", () => {
  const rows = [
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
    row("4", "valve", "rdfs:subClassOf", "some-has-hinge"),
    row("5", "some-has-hinge", "owl:onProperty", "has"),
    row("6", "some-has-hinge", "owl:someValuesFrom", "hinge"),
    row("7", "has", "rdf:type", "transitiveproperty"),
  ];
  const result = proveElSubsumption(rows, "heart", { role: "has", filler: "hinge" });
  assert.equal(result.proved, true);
});

test("E2 stays an honest miss without the transitive declaration", () => {
  const rows = [
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
    row("4", "valve", "rdfs:subClassOf", "some-has-hinge"),
    row("5", "some-has-hinge", "owl:onProperty", "has"),
    row("6", "some-has-hinge", "owl:someValuesFrom", "hinge"),
  ]; // no "has rdf:type owl:TransitiveProperty"
  const result = proveElSubsumption(rows, "heart", { role: "has", filler: "hinge" });
  assert.equal(result.proved, false);
  assert.equal(result.exhausted, false, "a genuine non-entailment is not a budget exhaustion");
});

test("a subsumer only reachable after CR2 saturation — never in the plain asserted ancestor chain — still gets its goal minted and materialises in a batch pass", () => {
  // "endotherm" is not a direct rdfs:subClassOf ancestor of "mammal" — it only
  // becomes a subsumer once CR2 combines mammal's two independently asserted
  // parents through the intersection. The batch goal minter must see this
  // CR2-derived subsumer, not just mammal's stated ancestors.
  const rows = [
    row("1", "creature", "rdfs:subClassOf", "some-has-mammal"),
    row("2", "some-has-mammal", "owl:onProperty", "has"),
    row("3", "some-has-mammal", "owl:someValuesFrom", "mammal"),
    row("4", "mammal", "rdfs:subClassOf", "warm-blooded"),
    row("5", "mammal", "rdfs:subClassOf", "furry"),
    row("6", "i1", "owl:intersectionOf", "warm-blooded"),
    row("7", "i1", "owl:intersectionOf", "furry"),
    row("8", "i1", "rdfs:subClassOf", "endotherm"),
  ];
  const norm = normalizeElTBox(rows);
  const firstPass = saturateEl(norm);
  assert.ok((firstPass.subsumers.get("mammal") || new Set()).has("endotherm"), "CR2 reaches endotherm within the first pass");
  const goals = elGoalAxioms(norm, firstPass.subsumers);
  assert.ok(goals.some((g) => g.sup === "some-has-endotherm"), "the CR2-derived subsumer got its own goal minted");

  const result = proveElSubsumption(rows, "creature", { role: "has", filler: "endotherm" });
  assert.equal(result.proved, true);
});
