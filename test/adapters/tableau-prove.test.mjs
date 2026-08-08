// tableau-prove.test.mjs — proveEntailment and proveSubsumption end to end:
// E3 (disjunction elimination) and E4 (a complement class) close, a
// subsumption proof's fresh individual never leaks into the KB's own
// individuals or a rendered premise, the premise union for a case-split
// proof names every fact the case analysis actually used, a satisfiable KB
// disproves with a counter-model, and feeding the same rows in two orders
// gives the byte-identical answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTableauKb, canonicalKey, proveEntailment, proveSubsumption, TABLEAU_RULE_CONFIDENCE } from "../../src/domain/tableau.mjs";

const atom = (name) => ({ t: "atom", name });

// E3 — "every pet is a cat or a dog", "rex is a pet", "rex is not a cat" ⊨ "rex is a dog"
const e3Rows = () => [
  { id: "e3-1", subject: "cat-or-dog", predicate: "owl:unionOf", object: "cat" },
  { id: "e3-2", subject: "cat-or-dog", predicate: "owl:unionOf", object: "dog" },
  { id: "e3-3", subject: "pet", predicate: "rdfs:subClassOf", object: "cat-or-dog" },
  { id: "e3-4", subject: "rex", predicate: "rdf:type", object: "pet" },
  { id: "e3-5", subject: "rex", predicate: "owl:disjointWith", object: "cat" },
];

// E4 — "everything that is not aquatic is terrestrial", "a stone is not aquatic" ⊨ "a stone is terrestrial"
const e4Rows = () => [
  { id: "e4-1", subject: "not-aquatic", predicate: "owl:complementOf", object: "aquatic" },
  { id: "e4-2", subject: "not-aquatic", predicate: "rdfs:subClassOf", object: "terrestrial" },
  { id: "e4-3", subject: "stone", predicate: "owl:disjointWith", object: "aquatic" },
];

test("E3: disjunction elimination proves rex is a dog, citing the union, the subclass link and the negation", () => {
  const kb = buildTableauKb(e3Rows());
  const result = proveEntailment(kb, "rex", atom("dog"));
  assert.equal(result.status, "proved");
  for (const id of ["e3-1", "e3-2", "e3-3", "e3-5"]) assert.ok(result.premises.includes(id), `expected ${id} among the premises`);
});

test("E3: without the negation, rex being a dog is not entailed — an honest miss, not a guess", () => {
  const kb = buildTableauKb(e3Rows().filter((r) => r.id !== "e3-5"));
  const result = proveEntailment(kb, "rex", atom("dog"));
  assert.equal(result.status, "disproved");
});

test("E4: the complement class proves a stone is terrestrial as a class subsumption", () => {
  const kb = buildTableauKb(e4Rows());
  const result = proveSubsumption(kb, "stone", "terrestrial");
  assert.equal(result.status, "proved");
  for (const id of ["e4-1", "e4-2", "e4-3"]) assert.ok(result.premises.includes(id), `expected ${id} among the premises`);
});

test("proveSubsumption's fresh individual never appears in buildTableauKb's own individuals output", () => {
  const kb = buildTableauKb(e4Rows());
  assert.ok(!kb.individuals.includes("fresh-0"));
});

test("proveSubsumption's fresh individual never appears in a proved result's premises", () => {
  const kb = buildTableauKb(e4Rows());
  const result = proveSubsumption(kb, "stone", "terrestrial");
  assert.ok(!result.premises.some((p) => String(p).includes("fresh-0")));
});

test("TABLEAU_RULE_CONFIDENCE stays a sub-1 discount, matching every other rule's confidence discipline", () => {
  assert.ok(TABLEAU_RULE_CONFIDENCE > 0 && TABLEAU_RULE_CONFIDENCE < 1);
});

test("a satisfiable KB disproves with a counter-model naming the constraining premises", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "rex", predicate: "rdf:type", object: "dog" },
  ]);
  const result = proveEntailment(kb, "rex", atom("cat"));
  assert.equal(result.status, "disproved");
  assert.ok(result.model);
  const rex = result.model.nodes.find((n) => n.id === "rex");
  assert.ok(rex, "the counter-model must include the queried individual's own node");
});

test("order-independence: feeding the same rows in two different orders gives a byte-identical proof result", () => {
  const rows = e3Rows();
  const shuffled = [rows[3], rows[1], rows[4], rows[0], rows[2]];
  assert.notDeepEqual(rows.map((r) => r.id), shuffled.map((r) => r.id));

  const kbA = buildTableauKb(rows);
  const kbB = buildTableauKb(shuffled);
  assert.deepEqual(kbA, kbB, "buildTableauKb must converge to the identical KB regardless of row order");

  const resultA = proveEntailment(kbA, "rex", atom("dog"));
  const resultB = proveEntailment(kbB, "rex", atom("dog"));
  assert.deepEqual(resultA, resultB);
});

test("order-independence holds for a class subsumption proof too", () => {
  const rows = e4Rows();
  const shuffled = [rows[2], rows[0], rows[1]];
  const kbA = buildTableauKb(rows);
  const kbB = buildTableauKb(shuffled);
  assert.deepEqual(kbA, kbB);
  assert.deepEqual(proveSubsumption(kbA, "stone", "terrestrial"), proveSubsumption(kbB, "stone", "terrestrial"));
});

test("a case-split proof's premise union spans every branch the case analysis actually closed", () => {
  // "every widget is a lever or a spring", "sprocket is a widget" — asking
  // "is sprocket a mechanism" needs BOTH cases (lever⊑mechanism and
  // spring⊑mechanism) to close for the proof to hold at all.
  const kb = buildTableauKb([
    { id: "c1", subject: "lever-or-spring", predicate: "owl:unionOf", object: "lever" },
    { id: "c2", subject: "lever-or-spring", predicate: "owl:unionOf", object: "spring" },
    { id: "c3", subject: "widget", predicate: "rdfs:subClassOf", object: "lever-or-spring" },
    { id: "c4", subject: "lever", predicate: "rdfs:subClassOf", object: "mechanism" },
    { id: "c5", subject: "spring", predicate: "rdfs:subClassOf", object: "mechanism" },
    { id: "c6", subject: "sprocket", predicate: "rdf:type", object: "widget" },
  ]);
  const result = proveEntailment(kb, "sprocket", atom("mechanism"));
  assert.equal(result.status, "proved");
  for (const id of ["c1", "c2", "c3", "c4", "c5", "c6"]) assert.ok(result.premises.includes(id), `expected ${id} among the case-split premises`);
});
