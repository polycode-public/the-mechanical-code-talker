// el-entailment-fixtures.test.mjs — runs test/fixtures/el-entailments.jsonl,
// this project's own EL conformance fixture set (there is no OWL conformance
// harness in this repo to draw on directly). Each row states a small TBox as
// raw (subject, predicate, object) triples, an "ask" — either a role/filler
// existential query or a concept name to check for unsatisfiability — and
// the expected verdict. Drawn from the W3C OWL 2 EL profile's own entailment
// examples and from Baader, Brandt and Lutz's "Pushing the EL Envelope",
// covering every completion rule and the two worked examples that land in EL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeElTBox, saturateEl, proveElSubsumption } from "../../src/domain/el-classify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "..", "fixtures", "el-entailments.jsonl");

function loadFixtures() {
  return readFileSync(FIXTURE_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function rowsFor(fixture) {
  return fixture.axioms.map(([s, p, o], i) => ({ id: `fact:${fixture.id}-${i}`, subject: s, predicate: p, object: o, trust: 1 }));
}

const fixtures = loadFixtures();

test("the fixture set has at least twenty rows and every id is unique", () => {
  assert.ok(fixtures.length >= 20, `expected at least 20 fixtures, found ${fixtures.length}`);
  assert.equal(new Set(fixtures.map((f) => f.id)).size, fixtures.length, "no duplicate fixture ids");
});

test("every fixture row carries the documented shape: id, axioms, ask, expect", () => {
  for (const f of fixtures) {
    assert.equal(typeof f.id, "string");
    assert.ok(Array.isArray(f.axioms) && f.axioms.length > 0, `${f.id}: axioms must be a non-empty array`);
    for (const ax of f.axioms) assert.equal(ax.length, 3, `${f.id}: each axiom is an [s,p,o] triple`);
    assert.equal(typeof f.ask, "object", `${f.id}: ask is an object`);
    assert.ok(["proved", "not-proved", "unsatisfiable", "satisfiable"].includes(f.expect), `${f.id}: expect is one of the recognized verdicts`);
  }
});

for (const fixture of fixtures) {
  test(`el-entailment fixture: ${fixture.id}`, () => {
    const rows = rowsFor(fixture);
    if (fixture.ask.unsatisfiable) {
      const sat = saturateEl(normalizeElTBox(rows));
      const isUnsat = sat.unsatisfiable.includes(fixture.ask.unsatisfiable);
      assert.equal(isUnsat, fixture.expect === "unsatisfiable", `${fixture.id}: ${fixture.ask.unsatisfiable} unsatisfiable=${isUnsat}, expected ${fixture.expect}`);
    } else {
      const { sub, role, filler } = fixture.ask;
      const result = proveElSubsumption(rows, sub, { role, filler });
      assert.equal(result.proved, fixture.expect === "proved", `${fixture.id}: proved=${result.proved}, expected ${fixture.expect}`);
    }
  });
}
