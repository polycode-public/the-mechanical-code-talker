// build-wikidata-slice.mjs over a miniature Wikidata JSON-lines fixture — no
// network, no real Wikidata dump.
import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildWikidataSliceRows, WIKIDATA_SLICE_BAND, SEED_QIDS } from "../../scripts/corpus-bands/build-wikidata-slice.mjs";
import { rowProblems } from "../../src/adapters/memory/row-backend.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "corpus-bands", "wikidata-sample.jsonl");

function attr(row, key) {
  return JSON.parse(row.json).individual.attributes.find((a) => a.key === key).value;
}

test("emits one fact per mapped, valued claim on a seed entity whose object has a label", async () => {
  const { rows, scanned } = await buildWikidataSliceRows(FIXTURE);
  assert.equal(scanned, 7);
  const triples = rows.map((row) => `${attr(row, "subject")} ${attr(row, "predicate")} ${attr(row, "object")}`).sort();
  assert.deepEqual(triples, [
    "cat rdf:type animal",
    "dog rdf:type animal",
    "dog rdfs:subClassOf canine",
  ]);
  for (const row of rows) assert.equal(rowProblems(row).length, 0, rowProblems(row).join("; "));
});

test("a non-seed entity contributes no fact of its own, only resolves as an object's label", async () => {
  const { rows } = await buildWikidataSliceRows(FIXTURE);
  const subjects = rows.map((row) => attr(row, "subject"));
  assert.ok(!subjects.includes("animal"), "animal is only ever an object here, never a subject");
});

test("a novalue claim (Q5's P31) is skipped, not treated as a fact with an empty object", async () => {
  const { rows } = await buildWikidataSliceRows(FIXTURE);
  const humanFacts = rows.filter((row) => attr(row, "subject") === "human");
  assert.deepEqual(humanFacts, []);
});

test("a claim whose object entity carries no label in this file is skipped, never guessed at", async () => {
  const { rows } = await buildWikidataSliceRows(FIXTURE, { seedQids: ["Q999998"] });
  assert.deepEqual(rows, []);
});

test("an entity absent from SEED_QIDS is never a subject, even with a label and mapped claims", async () => {
  const { rows } = await buildWikidataSliceRows(FIXTURE, { seedQids: [] });
  assert.deepEqual(rows, []);
});

test("two runs over the same fixture produce byte-identical rows", async () => {
  const [first, second] = await Promise.all([buildWikidataSliceRows(FIXTURE), buildWikidataSliceRows(FIXTURE)]);
  assert.deepEqual(first.rows, second.rows);
});

test("rows carry this band's provenance and CC0 needs no share-alike wording", async () => {
  const { rows } = await buildWikidataSliceRows(FIXTURE);
  for (const row of rows) assert.equal(attr(row, "provenance"), `corpus:${WIKIDATA_SLICE_BAND}`);
});

test("SEED_QIDS is a closed, non-empty list of bare Wikidata item ids", () => {
  assert.ok(SEED_QIDS.length > 0);
  for (const id of SEED_QIDS) assert.match(id, /^Q[1-9][0-9]*$/);
});
