// fetch-wikidata-slice-live.mjs over a stubbed fetch — no network. Proves
// envelope unwrapping, WIKIDATA_PROPERTY_RELATIONS-driven object derivation
// through the real objectQidsOf, the retry-with-backoff path, and that the
// slice it writes is exactly the shape build-wikidata-slice.mjs consumes.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { entityDataUrl, fetchWikidataSliceLive } from "../../scripts/corpus-bands/fetch-wikidata-slice-live.mjs";
import { buildWikidataSliceRows } from "../../scripts/corpus-bands/build-wikidata-slice.mjs";
import { rowProblems } from "../../src/adapters/memory/row-backend.mjs";

function entity(id, label, claims = {}) {
  return { type: "item", id, labels: label ? { en: { language: "en", value: label } } : {}, claims };
}

function valueClaim(property, objectId) {
  return { mainsnak: { snaktype: "value", property, datavalue: { value: { "entity-type": "item", id: objectId } } } };
}

// Two real SEED_QIDS ("Q5" human, "Q144" dog) with mapped claims, their
// object entities, an unmapped-property claim that must never derive an
// object QID, and an object with no English label (still fetched, only
// later dropped by the builder).
const ENTITIES = {
  Q5: entity("Q5", "human", { P279: [valueClaim("P279", "Q900001")] }),
  Q144: entity("Q144", "dog", {
    P31: [valueClaim("P31", "Q900001")],
    P279: [valueClaim("P279", "Q900002")],
    P361: [valueClaim("P361", "Q900005")],
    P9999: [valueClaim("P9999", "Q900006")],
  }),
  Q900001: entity("Q900001", "mammal"),
  Q900002: entity("Q900002", "carnivore"),
  Q900005: entity("Q900005", null),
};

function response(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

/** A stub transport keyed off Special:EntityData/<QID>.json, wrapping each
 *  known entity in the live endpoint's own {entities:{QID:...}} envelope.
 *  `failFirstN` makes a given QID's first N calls answer 503 before it
 *  succeeds, exercising the retry-with-backoff path. */
function fakeFetch(entitiesByQid, { failFirstN = {} } = {}) {
  const callCounts = new Map();
  return async (url) => {
    const qid = /Special:EntityData\/(Q[0-9]+)\.json/.exec(String(url))?.[1];
    const count = (callCounts.get(qid) ?? 0) + 1;
    callCounts.set(qid, count);
    if (count <= (failFirstN[qid] ?? 0)) return response("", { status: 503 });
    const found = entitiesByQid[qid];
    if (!found) return response({ entities: {} });
    return response({ entities: { [qid]: found } });
  };
}

async function withTempOutDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-wikidata-live-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  return dir;
}

test("entityDataUrl builds the Special:EntityData path for a QID", () => {
  assert.equal(entityDataUrl("Q5"), "https://www.wikidata.org/wiki/Special:EntityData/Q5.json");
  assert.equal(entityDataUrl("Q5", "https://example.org"), "https://example.org/wiki/Special:EntityData/Q5.json");
});

test("unwraps the live endpoint's {entities:{QID:...}} envelope to a bare entity, matching the dump line shape", async (t) => {
  const outDir = await withTempOutDir(t);
  const result = await fetchWikidataSliceLive({
    outDir, seedQids: ["Q5", "Q144"], fetchImpl: fakeFetch(ENTITIES), minIntervalMs: 0, retryBaseMs: 1,
  });
  assert.equal(result.seedsFound, 2);
  const text = await readFile(result.outPath, "utf8");
  const lines = text.trim().split("\n").map((line) => JSON.parse(line));
  const human = lines.find((e) => e.id === "Q5");
  assert.equal(human.labels.en.value, "human");
  assert.ok(!("entities" in human), "the per-entity object never carries the endpoint's own envelope key");
});

test("derives object QIDs through the real WIKIDATA_PROPERTY_RELATIONS-driven objectQidsOf, dropping unmapped-property targets", async (t) => {
  const outDir = await withTempOutDir(t);
  const result = await fetchWikidataSliceLive({
    outDir, seedQids: ["Q5", "Q144"], fetchImpl: fakeFetch(ENTITIES), minIntervalMs: 0, retryBaseMs: 1,
  });
  assert.equal(result.objectQidsDerived, 3, "Q900001, Q900002, Q900005 — not Q900006, the unmapped-property target");
  assert.equal(result.objectsFound, 3);
  assert.equal(result.totalLines, 5);

  const text = await readFile(result.outPath, "utf8");
  const ids = text.trim().split("\n").map((line) => JSON.parse(line).id).sort();
  assert.deepEqual(ids, ["Q144", "Q5", "Q900001", "Q900002", "Q900005"]);
});

test("output lines are sorted by QID, deterministically", async (t) => {
  const outDir = await withTempOutDir(t);
  const result = await fetchWikidataSliceLive({
    outDir, seedQids: ["Q144", "Q5"], fetchImpl: fakeFetch(ENTITIES), minIntervalMs: 0, retryBaseMs: 1,
  });
  const text = await readFile(result.outPath, "utf8");
  const ids = text.trim().split("\n").map((line) => JSON.parse(line).id);
  assert.deepEqual(ids, [...ids].sort());
});

test("a transient failure retries with backoff and succeeds within the retry budget", async (t) => {
  const outDir = await withTempOutDir(t);
  const result = await fetchWikidataSliceLive({
    outDir, seedQids: ["Q5"], fetchImpl: fakeFetch(ENTITIES, { failFirstN: { Q5: 2 } }),
    minIntervalMs: 0, retryBaseMs: 1, retries: 4,
  });
  assert.equal(result.seedsFound, 1);
  assert.equal(result.seedsMissing, 0);
});

test("a seed that fails every retry is recorded missing, not fatal to the run", async (t) => {
  const outDir = await withTempOutDir(t);
  const result = await fetchWikidataSliceLive({
    outDir, seedQids: ["Q5", "Q144"], fetchImpl: fakeFetch(ENTITIES, { failFirstN: { Q5: 99 } }),
    minIntervalMs: 0, retryBaseMs: 1, retries: 2,
  });
  assert.equal(result.seedsMissing, 1);
  assert.equal(result.seedsFound, 1);
  const text = await readFile(result.outPath, "utf8");
  const ids = text.trim().split("\n").map((line) => JSON.parse(line).id);
  assert.ok(!ids.includes("Q5"));
});

test("the fetched slice is exactly the shape build-wikidata-slice.mjs consumes", async (t) => {
  const outDir = await withTempOutDir(t);
  const { outPath } = await fetchWikidataSliceLive({
    outDir, seedQids: ["Q5", "Q144"], fetchImpl: fakeFetch(ENTITIES), minIntervalMs: 0, retryBaseMs: 1,
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
