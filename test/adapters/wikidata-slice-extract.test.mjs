// extract-wikidata-slice.mjs over a tiny synthetic gzipped dump — no
// network, no real Wikidata dump. Proves pass A seed matching, trailing-
// comma stripping, WIKIDATA_PROPERTY_RELATIONS-driven object derivation,
// pass B, and that the slice it writes is exactly the shape
// build-wikidata-slice.mjs consumes.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractWikidataSlice,
  lineEntityId,
  objectQidsOf,
  stripTrailingComma,
  verifyDumpReady,
} from "../../scripts/corpus-bands/extract-wikidata-slice.mjs";
import { buildWikidataSliceRows } from "../../scripts/corpus-bands/build-wikidata-slice.mjs";
import { rowProblems } from "../../src/adapters/memory/row-backend.mjs";

function entity(id, label, claims = {}) {
  return { type: "item", id, labels: label ? { en: { language: "en", value: label } } : {}, claims };
}

function valueClaim(property, objectId) {
  return { mainsnak: { snaktype: "value", property, datavalue: { value: { "entity-type": "item", id: objectId } } } };
}

// Twelve entities: two real SEED_QIDS ("Q5" human, "Q144" dog) with mapped
// claims, their object entities, an unmapped-property claim that must never
// derive an object QID, an object with no English label (still extracted,
// only later dropped by the builder), and unreferenced decoys that must
// never appear in the output.
const ENTITIES = [
  entity("Q5", "human", { P279: [valueClaim("P279", "Q900001")] }),
  entity("Q900003", "decoy one"),
  entity("Q144", "dog", {
    P31: [valueClaim("P31", "Q900001")],
    P279: [valueClaim("P279", "Q900002")],
    P361: [valueClaim("P361", "Q900005")],
    P9999: [valueClaim("P9999", "Q900006")],
  }),
  entity("Q900001", "mammal"),
  entity("Q900002", "carnivore"),
  entity("Q900004", "decoy two"),
  entity("Q900005", null),
  entity("Q900006", "unreferenced by any mapped claim"),
  entity("Q900007", "noise seven"),
  entity("Q900008", "noise eight"),
  entity("Q900009", "noise nine"),
  entity("Q900010", "noise ten"),
];

function dumpText(entities) {
  const lines = entities.map((e, i) => JSON.stringify(e) + (i < entities.length - 1 ? "," : ""));
  return `[\n${lines.join("\n")}\n]\n`;
}

async function withTempDump(t) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-wikidata-extract-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const dumpPath = join(dir, "wikidata-fixture.json.gz");
  await writeFile(dumpPath, gzipSync(dumpText(ENTITIES)));
  return { dir, dumpPath, outDir: join(dir, "out") };
}

test("stripTrailingComma removes exactly one trailing comma, leaving a comma-free line untouched", () => {
  assert.equal(stripTrailingComma('{"a":1},'), '{"a":1}');
  assert.equal(stripTrailingComma('{"a":1}'), '{"a":1}');
  assert.equal(stripTrailingComma('{"a":1},  '), '{"a":1}');
});

test("lineEntityId reads the id near the start of a dump line, skipping brackets", () => {
  assert.equal(lineEntityId('{"type":"item","id":"Q144","labels":{}},'), "Q144");
  assert.equal(lineEntityId("["), null);
  assert.equal(lineEntityId("]"), null);
});

test("objectQidsOf derives only mapped, valued claim targets", () => {
  const targets = objectQidsOf(ENTITIES.find((e) => e.id === "Q144"));
  assert.deepEqual([...targets].sort(), ["Q900001", "Q900002", "Q900005"]);
});

test("a missing dump path fails with an actionable message, no network call", async () => {
  await assert.rejects(
    () => verifyDumpReady("/nonexistent/tmct-fixture-dump.json.gz"),
    /dump not found at .*resume-wikidata-dump\.sh/,
  );
});

test("a short dump fails against an injected expected-size resolver, no network call", async (t) => {
  const { dumpPath } = await withTempDump(t);
  await assert.rejects(
    () => verifyDumpReady(dumpPath, { expectedBytesFn: async () => Number.MAX_SAFE_INTEGER }),
    /dump looks incomplete/,
  );
  await assert.doesNotReject(
    () => verifyDumpReady(dumpPath, { expectedBytesFn: async () => 0 }),
  );
});

test("pass A finds only the seed entities actually present in the dump", async (t) => {
  const { dumpPath, outDir } = await withTempDump(t);
  const result = await extractWikidataSlice({
    dumpPath, outDir, seedQids: ["Q5", "Q144", "Q6256"], progressIntervalMs: 86_400_000,
  });
  assert.equal(result.seedsRequested, 3);
  assert.equal(result.seedsFound, 2, "Q6256 is a real SEED_QIDS entry absent from this fixture");
});

test("pass B collects exactly the derived object entities, nothing else", async (t) => {
  const { dumpPath, outDir } = await withTempDump(t);
  const result = await extractWikidataSlice({
    dumpPath, outDir, seedQids: ["Q5", "Q144"], progressIntervalMs: 86_400_000,
  });
  assert.equal(result.objectQidsDerived, 3, "Q900001, Q900002, Q900005 — not Q900006, the unmapped-property target");
  assert.equal(result.objectsFound, 3);
  assert.equal(result.totalLines, 5);

  const text = await readFile(result.outPath, "utf8");
  const ids = text.trim().split("\n").map((line) => JSON.parse(line).id).sort();
  assert.deepEqual(ids, ["Q144", "Q5", "Q900001", "Q900002", "Q900005"]);
});

test("a rerun with the same out dir skips already-finished phases and reproduces the same slice", async (t) => {
  const { dumpPath, outDir } = await withTempDump(t);
  const options = { dumpPath, outDir, seedQids: ["Q5", "Q144"], progressIntervalMs: 86_400_000 };
  const first = await extractWikidataSlice(options);
  const second = await extractWikidataSlice(options);
  assert.deepEqual(first, second);
});

test("the extracted slice is exactly the shape build-wikidata-slice.mjs consumes", async (t) => {
  const { dumpPath, outDir } = await withTempDump(t);
  const { outPath } = await extractWikidataSlice({
    dumpPath, outDir, seedQids: ["Q5", "Q144"], progressIntervalMs: 86_400_000,
  });

  const { rows, scanned } = await buildWikidataSliceRows(outPath, { seedQids: ["Q5", "Q144"] });
  assert.equal(scanned, 5);
  for (const row of rows) assert.equal(rowProblems(row).length, 0, rowProblems(row).join("; "));

  const attr = (row, key) => JSON.parse(row.json).individual.attributes.find((a) => a.key === key).value;
  const triples = rows.map((row) => `${attr(row, "subject")} ${attr(row, "predicate")} ${attr(row, "object")}`).sort();
  assert.deepEqual(triples, [
    "dog rdf:type mammal",
    "dog rdfs:subClassOf carnivore",
    "human rdfs:subClassOf mammal",
  ], "Q900005's mgx:partOf claim is dropped: the object entity carries no English label");
});
