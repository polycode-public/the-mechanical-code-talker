// build-wordnet-complete.mjs over a miniature ConceptNet-shape fixture — no
// network, no real WordNet dump. The pipeline's own header explains why the
// source shape is ConceptNet-shape assertions rather than raw WordNet YAML.
import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildWordnetCompleteRows, WORDNET_COMPLETE_BAND } from "../../scripts/corpus-bands/build-wordnet-complete.mjs";
import { rowProblems } from "../../src/adapters/memory/row-backend.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "corpus-bands", "wordnet-sample.jsonl");

test("every row over the fixture is a valid, band-stamped wire row", async () => {
  const rows = await buildWordnetCompleteRows(FIXTURE);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(rowProblems(row).length, 0, rowProblems(row).join("; "));
    assert.equal(row.rowClass, "fact");
    const record = JSON.parse(row.json);
    const provenance = record.individual.attributes.find((a) => a.key === "provenance").value;
    assert.match(provenance, new RegExp(`^corpus(-weak)?:${WORDNET_COMPLETE_BAND}`));
  }
});

test("two runs over the same fixture produce byte-identical rows", async () => {
  const [first, second] = await Promise.all([buildWordnetCompleteRows(FIXTURE), buildWordnetCompleteRows(FIXTURE)]);
  assert.deepEqual(first, second);
});

test("rows are ordered by (predicate, subject, object), and ord matches that order", async () => {
  const rows = await buildWordnetCompleteRows(FIXTURE);
  const triples = rows.map((row) => {
    const attr = (key) => JSON.parse(row.json).individual.attributes.find((a) => a.key === key).value;
    return [attr("predicate"), attr("subject"), attr("object")];
  });
  const sorted = [...triples].sort(([ap, as_, ao], [bp, bs, bo]) => (
    ap !== bp ? (ap < bp ? -1 : 1) : as_ !== bs ? (as_ < bs ? -1 : 1) : ao < bo ? -1 : ao > bo ? 1 : 0
  ));
  assert.deepEqual(triples, sorted);
  rows.forEach((row, i) => assert.equal(JSON.parse(row.json).ord, i));
});

test("the fixture's IsA chain (dolphin -> mammal -> animal) survives the conversion", async () => {
  const rows = await buildWordnetCompleteRows(FIXTURE);
  const subjects = rows.map((row) => row.term);
  assert.ok(subjects.includes("dolphin"));
  assert.ok(subjects.includes("mammal"));
});

test("a source with a relation missing from the map fails loudly, not silently", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "tmct-wordnet-pipeline-"));
  const path = join(dir, "bad.jsonl");
  await writeFile(path, `${JSON.stringify({ start: "/c/en/x", rel: "/r/NotARealRelation", end: "/c/en/y" })}\n`);
  try {
    await assert.rejects(buildWordnetCompleteRows(path), /slice\/map drift/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
