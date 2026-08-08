// tableau-alc-fixtures.test.mjs — the ALC entailment fixture set at
// test/fixtures/alc-entailments.jsonl: one worked example per connective
// (⊓, ⊔, ¬, ∃, ∀, subclass transitivity, disjointness), plus the consistency
// shape findTableauViolations answers. Same JSONL contract as the EL
// fixtures: one JSON object per line, replayed through the shipped engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildTableauKb, findTableauViolations, proveEntailment, proveSubsumption } from "../../src/domain/tableau.mjs";

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "alc-entailments.jsonl");

function loadFixtures() {
  const text = readFileSync(FIXTURE_PATH, "utf8");
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`alc-entailments.jsonl line ${i + 1}: ${e.message}`);
    }
  });
}

function rowsFromAxioms(axioms) {
  return axioms.map(([subject, predicate, object], i) => ({ id: `ax${i}`, subject, predicate, object }));
}

const fixtures = loadFixtures();

test("the fixture file parses and every row carries an id, axioms and a kind", () => {
  assert.ok(fixtures.length > 0, "the fixture set must not be empty");
  for (const row of fixtures) {
    assert.ok(row.id, "every fixture needs an id");
    assert.ok(Array.isArray(row.axioms), `${row.id}: axioms must be an array of [subject, predicate, object] triples`);
    assert.ok(["entailment", "subsumption", "consistency"].includes(row.kind), `${row.id}: unknown kind "${row.kind}"`);
  }
});

test("fixture ids are unique", () => {
  const ids = fixtures.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const row of fixtures) {
  test(`alc-entailments: ${row.id}`, () => {
    const kb = buildTableauKb(rowsFromAxioms(row.axioms));
    if (row.kind === "entailment") {
      const concept = row.conceptExpr ?? { t: "atom", name: row.concept };
      const result = proveEntailment(kb, row.subject, concept);
      assert.equal(result.status, row.expect, `${row.id}: expected ${row.expect}, got ${result.status}`);
    } else if (row.kind === "subsumption") {
      const result = proveSubsumption(kb, row.subClass, row.superClass);
      assert.equal(result.status, row.expect, `${row.id}: expected ${row.expect}, got ${result.status}`);
    } else if (row.kind === "consistency") {
      const violations = findTableauViolations(kb, [row.subject]);
      if (row.expect === "violation") assert.equal(violations.length, 1, `${row.id}: expected exactly one violation`);
      else assert.equal(violations.length, 0, `${row.id}: expected no violation`);
    }
  });
}
