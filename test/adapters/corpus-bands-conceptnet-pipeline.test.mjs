// build-conceptnet.mjs over a miniature slice fixture — the shipped slice's
// own shape, a few lines of it, so the test costs nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildConceptnetRows, CONCEPTNET_BAND, DEFAULT_SOURCE } from "../../scripts/corpus-bands/build-conceptnet.mjs";
import { SLICE_FILE } from "../../src/adapters/corpus/conceptnet.mjs";
import { rowProblems } from "../../src/adapters/memory/row-backend.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "corpus-bands", "conceptnet-sample.jsonl");

test("the band builds from the committed slice by default, so the band is the whole slice", () => {
  assert.equal(DEFAULT_SOURCE, SLICE_FILE);
});

test("every row over the fixture is a valid, band-stamped wire row", async () => {
  const rows = await buildConceptnetRows(FIXTURE);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(rowProblems(row).length, 0, rowProblems(row).join("; "));
    assert.equal(row.rowClass, "fact");
    const record = JSON.parse(row.json);
    const provenance = record.individual.attributes.find((a) => a.key === "provenance").value;
    assert.match(provenance, new RegExp(`^corpus(-weak)?:${CONCEPTNET_BAND} `));
  }
});

test("two runs over the same fixture produce byte-identical rows", async () => {
  const [first, second] = await Promise.all([buildConceptnetRows(FIXTURE), buildConceptnetRows(FIXTURE)]);
  assert.deepEqual(first, second);
});

test("rows are ordered by (predicate, subject, object), and ord matches that order", async () => {
  const rows = await buildConceptnetRows(FIXTURE);
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

test("a term the fixture only ever names as an object still gets its own rows", async () => {
  const rows = await buildConceptnetRows(FIXTURE);
  const terms = rows.map((row) => row.term);
  assert.ok(terms.includes("penguin"));
  assert.ok(terms.includes("feather"), "the PartOf edge is stored under its subject");
});

test("a source with a relation missing from the map fails loudly, not silently", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "tmct-conceptnet-pipeline-"));
  const path = join(dir, "bad.jsonl");
  await writeFile(path, `${JSON.stringify({ start: "/c/en/x", rel: "/r/NotARealRelation", end: "/c/en/y" })}\n`);
  try {
    await assert.rejects(buildConceptnetRows(path), /slice\/map drift/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
