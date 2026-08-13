// el-normalize.test.mjs — normalizeElTBox: folding the five stored shapes
// section 6.2 of the EL classifier design recognises into the four EL normal
// forms, plus the cardinality-as-existential bridge, the >2-member
// intersection fold, and the budget truncation flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeElTBox, TOP, BOT } from "../../src/domain/el-classify.mjs";
import { parseAce } from "../../src/domain/grammar/ace.mjs";

const row = (id, s, p, o) => ({ id: `fact:${id}`, subject: s, predicate: p, object: o, trust: 1 });

test("shape 1 — a plain rdfs:subClassOf edge normalizes to NF1 (sub)", () => {
  const rows = [row("1", "cat", "rdfs:subClassOf", "mammal")];
  const { axioms, concepts } = normalizeElTBox(rows);
  assert.deepEqual(axioms, [{ form: "sub", sub: "cat", sup: "mammal", from: ["fact:1"] }]);
  assert.deepEqual([...concepts].sort(), ["cat", "mammal"]);
});

test("shape 2 — a someValuesFrom restriction normalizes to NF3 (someRight) and NF4 (someLeft)", () => {
  const rows = [
    row("1", "heart", "rdfs:subClassOf", "some-has-valve"),
    row("2", "some-has-valve", "owl:onProperty", "has"),
    row("3", "some-has-valve", "owl:someValuesFrom", "valve"),
  ];
  const { axioms, restrictionOf } = normalizeElTBox(rows);
  assert.deepEqual(axioms, [
    { form: "someRight", sub: "heart", role: "has", filler: "valve", from: ["fact:1", "fact:2", "fact:3"] },
    { form: "someLeft", role: "has", filler: "valve", sup: "some-has-valve", from: ["fact:2", "fact:3"] },
  ]);
  assert.deepEqual(restrictionOf.get("some-has-valve"), { role: "has", filler: "valve" });
});

test("an owl:allValuesFrom restriction yields no EL axiom and does not become an atomic concept — EL has no universal restriction", () => {
  const rows = [
    row("1", "heart", "rdfs:subClassOf", "all-contains-valve"),
    row("2", "all-contains-valve", "owl:onProperty", "contains"),
    row("3", "all-contains-valve", "owl:allValuesFrom", "valve"),
  ];
  const { axioms, concepts } = normalizeElTBox(rows);
  assert.deepEqual(axioms, []);
  assert.ok(!concepts.has("all-contains-valve"), "the universal restriction node must not read as an atomic concept");
});

test("shape 3 — the cardinality-as-existential bridge: min cardinality >= 1 normalizes the same as a someValuesFrom restriction", () => {
  const rows = [
    row("1", "bicycle", "rdfs:subClassOf", "min-1-wheel"),
    row("2", "min-1-wheel", "owl:onProperty", "has"),
    row("3", "min-1-wheel", "owl:onClass", "wheel"),
    row("4", "min-1-wheel", "owl:minCardinality", "1"),
  ];
  const { axioms, restrictionOf } = normalizeElTBox(rows);
  assert.deepEqual(axioms, [
    { form: "someRight", sub: "bicycle", role: "has", filler: "wheel", from: ["fact:1", "fact:2", "fact:3", "fact:4"] },
    { form: "someLeft", role: "has", filler: "wheel", sup: "min-1-wheel", from: ["fact:2", "fact:3", "fact:4"] },
  ]);
  assert.deepEqual(restrictionOf.get("min-1-wheel"), { role: "has", filler: "wheel" });
});

test("shape 3 — an exactly-cardinality restriction also bridges to an existential", () => {
  const rows = [
    row("1", "car", "rdfs:subClassOf", "exactly-1-engine"),
    row("2", "exactly-1-engine", "owl:onProperty", "has"),
    row("3", "exactly-1-engine", "owl:onClass", "engine"),
    row("4", "exactly-1-engine", "owl:cardinality", "1"),
  ];
  const { axioms } = normalizeElTBox(rows);
  assert.ok(axioms.some((a) => a.form === "someRight" && a.sub === "car" && a.filler === "engine"));
});

test("shape 3 — a max-cardinality-0 restriction is NOT read as an existential (outside EL, no bridge)", () => {
  const rows = [
    row("1", "bicycle", "rdfs:subClassOf", "max-0-wheel"),
    row("2", "max-0-wheel", "owl:onProperty", "has"),
    row("3", "max-0-wheel", "owl:onClass", "wheel"),
    row("4", "max-0-wheel", "owl:maxCardinality", "0"),
  ];
  const { axioms } = normalizeElTBox(rows);
  assert.deepEqual(axioms, [{ form: "sub", sub: "bicycle", sup: "max-0-wheel", from: ["fact:1"] }]);
});

test("shape 4 — a two-member intersection normalizes to one NF2 (and) axiom, subs sorted", () => {
  const rows = [
    row("1", "i1", "owl:intersectionOf", "dog"),
    row("2", "i1", "owl:intersectionOf", "cat"),
    row("3", "i1", "rdfs:subClassOf", "chimera"),
  ];
  const { axioms } = normalizeElTBox(rows);
  assert.deepEqual(axioms, [{ form: "and", subs: ["cat", "dog"], sup: "chimera", from: ["fact:2", "fact:1", "fact:3"] }]);
});

test("shape 4 — an intersection of more than two members folds left into a chain of binary NF2 axioms", () => {
  const rows = [
    row("1", "i1", "owl:intersectionOf", "bird"),
    row("2", "i1", "owl:intersectionOf", "cat"),
    row("3", "i1", "owl:intersectionOf", "dog"),
    row("4", "i1", "rdfs:subClassOf", "chimera"),
  ];
  const { axioms } = normalizeElTBox(rows);
  const andAxioms = axioms.filter((a) => a.form === "and");
  assert.equal(andAxioms.length, 2, "a 3-member intersection folds into exactly 2 binary NF2 axioms");
  assert.deepEqual(andAxioms[0].subs, ["bird", "cat"]);
  assert.notEqual(andAxioms[0].sup, "chimera", "the first fold step names an intermediate, not the real target");
  assert.deepEqual(andAxioms[1].subs, [andAxioms[0].sup, "dog"].sort());
  assert.equal(andAxioms[1].sup, "chimera", "the last fold step lands on the real subClassOf target");
});

test("shape 4 — re-teaching the same intersection sentence re-emits the identical axiom list", () => {
  const rows = [
    row("1", "i1", "owl:intersectionOf", "bird"),
    row("2", "i1", "owl:intersectionOf", "cat"),
    row("3", "i1", "owl:intersectionOf", "dog"),
    row("4", "i1", "rdfs:subClassOf", "chimera"),
  ];
  const first = normalizeElTBox(rows).axioms;
  const second = normalizeElTBox([...rows].reverse()).axioms;
  assert.deepEqual(first, second);
});

test("shape 5 — owl:disjointWith normalizes to NF2 (and) with sup bot (EL⊥)", () => {
  const rows = [row("1", "cat", "owl:disjointWith", "dog")];
  const { axioms } = normalizeElTBox(rows);
  assert.deepEqual(axioms, [{ form: "and", subs: ["cat", "dog"], sup: BOT, from: ["fact:1"] }]);
});

test("a transitive role declaration normalizes to a transitive role axiom", () => {
  const rows = [row("1", "has", "rdf:type", "transitiveproperty")];
  const { roleAxioms, roles } = normalizeElTBox(rows);
  assert.deepEqual(roleAxioms, [{ kind: "transitive", role: "has", from: ["fact:1"] }]);
  assert.ok(roles.has("has"));
});

test("a role subproperty declaration normalizes to a sub role axiom", () => {
  const rows = [row("1", "loves", "rdfs:subPropertyOf", "cares-about")];
  const { roleAxioms, roles } = normalizeElTBox(rows);
  assert.deepEqual(roleAxioms, [{ kind: "sub", sub: "loves", sup: "cares-about", from: ["fact:1"] }]);
  assert.deepEqual([...roles].sort(), ["cares-about", "loves"]);
});

test("a taught ACE pattern-19 row ('containing implies touching') normalizes to the same sub role axiom shape", () => {
  const taught = parseAce("containing implies touching");
  const rows = taught.triples.map((t, i) => row(String(i + 1), t.subject, t.predicate, t.object));
  const { roleAxioms, roles } = normalizeElTBox(rows);
  assert.deepEqual(roleAxioms, [{ kind: "sub", sub: "tmct:contains", sup: "tmct:touches", from: ["fact:1"] }]);
  assert.deepEqual([...roles].sort(), ["tmct:contains", "tmct:touches"]);
});

test("two roles' subproperty axioms come out in codepoint order, not locale order, whichever way the rows arrived", () => {
  // "zebra-verb" sorts BEFORE "élan-verb" in codepoint order (z=0x7A < é=0xE9)
  // but AFTER it under locale-aware collation, so the axiom order this test
  // demands only holds if the fold never fell back to localeCompare.
  const rows = [
    row("1", "zebra-verb", "rdfs:subPropertyOf", "cares-about"),
    row("2", "élan-verb", "rdfs:subPropertyOf", "cares-about"),
  ];
  const forward = normalizeElTBox(rows).roleAxioms;
  const reversed = normalizeElTBox([...rows].reverse()).roleAxioms;
  assert.deepEqual(forward, reversed, "row arrival order never changes the axiom order");
  assert.deepEqual(forward.map((a) => a.sub), ["zebra-verb", "élan-verb"]);
});

test("normalizeElTBox folds rows in codepoint id order, not locale order, whichever way they arrived", () => {
  // Two chained subClassOf rows whose ids sort oppositely under codepoint vs
  // locale collation — first-wins dedup logic (intersectionTargetRow) depends
  // on which of two same-subject rows the id sort visits first.
  const rows = [
    { id: "zebra", subject: "and-node", predicate: "rdfs:subClassOf", object: "first-target", trust: 1 },
    { id: "élan", subject: "and-node", predicate: "rdfs:subClassOf", object: "second-target", trust: 1 },
    { id: "1", subject: "and-node", predicate: "owl:intersectionOf", object: "a", trust: 1 },
    { id: "2", subject: "and-node", predicate: "owl:intersectionOf", object: "b", trust: 1 },
  ];
  const forward = normalizeElTBox(rows).axioms;
  const reversed = normalizeElTBox([...rows].reverse()).axioms;
  assert.deepEqual(forward, reversed, "row arrival order never changes the derived axioms");
  const and = forward.find((a) => a.form === "and");
  assert.equal(and.sup, "first-target", "codepoint order visits the 'zebra' id row first, so it wins first-wins dedup");
});

test("truncated is false when the row count is within budget", () => {
  const rows = [row("1", "cat", "rdfs:subClassOf", "mammal")];
  assert.equal(normalizeElTBox(rows, { budget: 500 }).truncated, false);
});

test("truncated is true when the row count exceeds budget, and the partial normalization still returns what it built", () => {
  const rows = [
    row("1", "a", "rdfs:subClassOf", "b"),
    row("2", "b", "rdfs:subClassOf", "c"),
    row("3", "c", "rdfs:subClassOf", "d"),
  ];
  const result = normalizeElTBox(rows, { budget: 2 });
  assert.equal(result.truncated, true);
  assert.equal(result.axioms.length, 2, "only the first two (sorted by fact id) rows were processed");
});

test("a synthetic intersection-fold intermediate name never appears in the exposed concept set", () => {
  const rows = [
    row("1", "i1", "owl:intersectionOf", "bird"),
    row("2", "i1", "owl:intersectionOf", "cat"),
    row("3", "i1", "owl:intersectionOf", "dog"),
    row("4", "i1", "rdfs:subClassOf", "chimera"),
  ];
  const { concepts } = normalizeElTBox(rows);
  for (const c of concepts) assert.ok(!c.includes("-and-"), `${c} is a synthetic fold name, not a real declared concept`);
});

test("a row naming the reserved top/bot terms is dropped rather than crashing the pass", () => {
  const rows = [
    row("1", "top", "rdfs:subClassOf", "mammal"),
    row("2", "cat", "rdfs:subClassOf", "bot"),
    row("3", "cat", "rdfs:subClassOf", "mammal"),
  ];
  const { axioms } = normalizeElTBox(rows);
  assert.deepEqual(axioms, [{ form: "sub", sub: "cat", sup: "mammal", from: ["fact:3"] }]);
});

test("TOP and BOT are the reserved marker strings the module documents", () => {
  assert.equal(TOP, "top");
  assert.equal(BOT, "bot");
});
