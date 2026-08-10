// The corpus loader (load/clear/status) over a fake DynamoDB-shaped document
// client: the same `.put`/`.get`/`.delete`/`.query` convenience-client shape
// `termQueryOverDocumentClient` reads, so one fake client convention serves
// both the loader and the retrieval module's own tests.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadBand, clearBand, bandStatus, digestFile, queryBandTerm } from "../../src/services/corpus-loader.mjs";
import { bandFactRow, bandPartitionKey, bandSortKeyForRow, MANIFEST_SORT_KEY } from "../../src/adapters/memory/corpus-bands.mjs";
import { BackendRejected } from "../../src/adapters/memory/row-backend.mjs";
import { createFakeCorpusDocumentClient, poisonPutCall } from "../helpers/fake-corpus-document-client.mjs";

async function writeWireRowsJsonl(rows) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-corpus-loader-"));
  const path = join(dir, "band.jsonl");
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return { dir, path };
}

function sampleRows(band, count) {
  return Array.from({ length: count }, (_, i) => bandFactRow({
    subject: `term-${i}`, predicate: "rdfs:subClassOf", object: "thing", provenance: `corpus:${band}`, band, ord: i,
  }));
}

test("loads a band's wire rows and writes the manifest last", async () => {
  const client = createFakeCorpusDocumentClient();
  const rows = sampleRows("wordnet-complete", 5);
  const { path, dir } = await writeWireRowsJsonl(rows);
  try {
    const result = await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path, now: () => "2026-01-01T00:00:00.000Z" });
    assert.equal(result.status, "loaded");
    assert.equal(result.rowCount, 5);

    const pk = bandPartitionKey("wordnet-complete");
    for (const row of rows) {
      const item = client.store.get(`${pk}|fact#${row.term}#${row.rowKey}`);
      assert.ok(item, `row ${row.rowKey} landed under the band partition`);
      assert.equal(item.json, row.json);
    }
    const manifestItem = client.store.get(`${pk}|${MANIFEST_SORT_KEY}`);
    assert.equal(manifestItem.rowCount, 5);
    assert.equal(manifestItem.sourceDigest, await digestFile(path));
    assert.equal(manifestItem.license, "CC-BY-4.0", "the band's own licence, not a per-call flag");
    assert.equal(manifestItem.notice, "corpus/wordnet/LICENSE-NOTICE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a second load over the same source is a no-op that writes nothing new", async () => {
  const client = createFakeCorpusDocumentClient();
  const { path, dir } = await writeWireRowsJsonl(sampleRows("conceptnet-full", 3));
  try {
    await loadBand({ client, tableName: "t", band: "conceptnet-full", source: path });
    const callsAfterFirstLoad = client.calls.length;

    const second = await loadBand({ client, tableName: "t", band: "conceptnet-full", source: path });
    assert.equal(second.status, "unchanged");
    assert.equal(client.calls.length, callsAfterFirstLoad + 1, "only the manifest get, no further writes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a changed source reloads and updates the manifest's digest", async () => {
  const client = createFakeCorpusDocumentClient();
  const { path, dir } = await writeWireRowsJsonl(sampleRows("conceptnet-full", 2));
  try {
    const first = await loadBand({ client, tableName: "t", band: "conceptnet-full", source: path });
    await writeFile(path, sampleRows("conceptnet-full", 4).map((row) => JSON.stringify(row)).join("\n") + "\n");
    const second = await loadBand({ client, tableName: "t", band: "conceptnet-full", source: path });
    assert.equal(second.status, "loaded");
    assert.equal(second.rowCount, 4);
    assert.notEqual(second.sourceDigest, first.sourceDigest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a band outside the licence table loads with a null licence, honestly", async () => {
  const client = createFakeCorpusDocumentClient();
  const { path, dir } = await writeWireRowsJsonl(sampleRows("a-consumer-owned-band", 1));
  try {
    await loadBand({ client, tableName: "t", band: "a-consumer-owned-band", source: path });
    const status = await bandStatus({ client, tableName: "t", band: "a-consumer-owned-band" });
    assert.equal(status.license, null);
    assert.equal(status.notice, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a load that dies mid-way leaves valid rows and no manifest, and a retry completes it", async () => {
  const client = createFakeCorpusDocumentClient();
  const rows = sampleRows("wikidata-slice", 6);
  const { path, dir } = await writeWireRowsJsonl(rows);
  try {
    const dying = poisonPutCall(client, 3);
    await assert.rejects(loadBand({ client: dying, tableName: "t", band: "wikidata-slice", source: path, writeConcurrency: 1 }));

    const pk = bandPartitionKey("wikidata-slice");
    assert.equal(client.store.get(`${pk}|${MANIFEST_SORT_KEY}`), undefined, "no manifest after the crash");

    const retried = await loadBand({ client, tableName: "t", band: "wikidata-slice", source: path });
    assert.equal(retried.status, "loaded");
    assert.equal(retried.rowCount, 6);
    for (const row of rows) {
      assert.ok(client.store.get(`${pk}|fact#${row.term}#${row.rowKey}`), `row ${row.rowKey} present after the retry`);
    }
    assert.ok(client.store.get(`${pk}|${MANIFEST_SORT_KEY}`), "the manifest lands once the retry finishes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a dry run reports the row count and digest without writing anything", async () => {
  const client = createFakeCorpusDocumentClient();
  const { path, dir } = await writeWireRowsJsonl(sampleRows("wordnet-complete", 4));
  try {
    const result = await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path, dryRun: true });
    assert.equal(result.status, "dry-run");
    assert.equal(result.rowCount, 4);
    assert.equal(client.store.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clear physically deletes every row and the manifest, manifest last", async () => {
  const client = createFakeCorpusDocumentClient();
  const { path, dir } = await writeWireRowsJsonl(sampleRows("conceptnet-full", 5));
  try {
    await loadBand({ client, tableName: "t", band: "conceptnet-full", source: path });
    const result = await clearBand({ client, tableName: "t", band: "conceptnet-full" });
    assert.equal(result.deleted, 6); // 5 facts + the manifest

    const pk = bandPartitionKey("conceptnet-full");
    for (const key of client.store.keys()) assert.ok(!key.startsWith(`${pk}|`), `${key} should have been cleared`);
    assert.equal(await bandStatus({ client, tableName: "t", band: "conceptnet-full" }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clearing an already-empty band is a no-op", async () => {
  const client = createFakeCorpusDocumentClient();
  const result = await clearBand({ client, tableName: "t", band: "wikidata-slice" });
  assert.equal(result.deleted, 0);
});

test("a malformed source row is rejected before anything is written", async () => {
  const client = createFakeCorpusDocumentClient();
  const dir = await mkdtemp(join(tmpdir(), "tmct-corpus-loader-bad-"));
  const path = join(dir, "band.jsonl");
  await writeFile(path, `${JSON.stringify({ rowKey: "x", rowClass: "not-a-real-class", term: "x", json: "{}" })}\n`);
  try {
    await assert.rejects(
      loadBand({ client, tableName: "t", band: "wordnet-complete", source: path }),
      BackendRejected,
    );
    assert.equal(client.store.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bandStatus reads back exactly the manifest fields the loader wrote", async () => {
  const client = createFakeCorpusDocumentClient();
  const { path, dir } = await writeWireRowsJsonl(sampleRows("wordnet-complete", 2));
  try {
    await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path, now: () => "2026-02-01T00:00:00.000Z" });
    const status = await bandStatus({ client, tableName: "t", band: "wordnet-complete" });
    assert.equal(status.band, "wordnet-complete");
    assert.equal(status.rowCount, 2);
    assert.equal(status.loadedAt, "2026-02-01T00:00:00.000Z");
    assert.ok(status.sourceDigest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("queryBandTerm reads one term's rows out of the band partition, paginating past a small page size", async () => {
  const client = createFakeCorpusDocumentClient();
  const band = "wordnet-complete";
  const pk = bandPartitionKey(band);
  const rows = Array.from({ length: 5 }, (_, i) => bandFactRow({
    subject: "dolphin", predicate: "rdfs:subClassOf", object: `sense-${i}`, band, ord: i,
  }));
  for (const row of rows) {
    await client.put({ TableName: "t", Item: { pk, sk: bandSortKeyForRow(row.rowClass, row.term, row.rowKey), ...row } });
  }
  // an unrelated term in the same band, which a term read must not return
  const other = bandFactRow({ subject: "cat", predicate: "rdfs:subClassOf", object: "mammal", band });
  await client.put({ TableName: "t", Item: { pk, sk: bandSortKeyForRow(other.rowClass, other.term, other.rowKey), ...other } });

  const found = await queryBandTerm(client, "t", band, "dolphin", { pageSize: 2 });
  assert.equal(found.length, 5);
  assert.deepEqual(found.map((r) => r.rowKey).sort(), rows.map((r) => r.rowKey).sort());
  for (const row of found) {
    assert.equal(row.pk, undefined);
    assert.equal(row.sk, undefined);
  }
});

test("queryBandTerm returns nothing for a term the band never held", async () => {
  const client = createFakeCorpusDocumentClient();
  const found = await queryBandTerm(client, "t", "conceptnet-full", "zzzqx-nonsense");
  assert.deepEqual(found, []);
});
