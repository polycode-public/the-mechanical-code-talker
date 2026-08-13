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
import { BackendRejected, BackendUnavailable } from "../../src/adapters/memory/row-backend.mjs";
import {
  createFakeCorpusDocumentClient, poisonPutCall, flakyPutCall, alwaysFailingPutCall,
} from "../helpers/fake-corpus-document-client.mjs";

/** A retry policy for tests: no real waiting, and a fixed "random" draw so a
 *  test can assert on how many times the loader slept without depending on
 *  jitter's actual value. */
function instantRetryPolicy() {
  const sleepCalls = [];
  return { sleepCalls, sleep: async (ms) => { sleepCalls.push(ms); }, random: () => 0.5 };
}

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
  const { path, dir } = await writeWireRowsJsonl(sampleRows("wordnet-complete", 3));
  try {
    await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path });
    const callsAfterFirstLoad = client.calls.length;

    const second = await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path });
    assert.equal(second.status, "unchanged");
    assert.equal(client.calls.length, callsAfterFirstLoad + 1, "only the manifest get, no further writes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a changed source reloads and updates the manifest's digest", async () => {
  const client = createFakeCorpusDocumentClient();
  const { path, dir } = await writeWireRowsJsonl(sampleRows("wordnet-complete", 2));
  try {
    const first = await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path });
    await writeFile(path, sampleRows("wordnet-complete", 4).map((row) => JSON.stringify(row)).join("\n") + "\n");
    const second = await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path });
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
  const rows = sampleRows("wordnet-complete", 6);
  const { path, dir } = await writeWireRowsJsonl(rows);
  try {
    const dying = poisonPutCall(client, 3);
    await assert.rejects(loadBand({ client: dying, tableName: "t", band: "wordnet-complete", source: path, writeConcurrency: 1 }));

    const pk = bandPartitionKey("wordnet-complete");
    assert.equal(client.store.get(`${pk}|${MANIFEST_SORT_KEY}`), undefined, "no manifest after the crash");

    const retried = await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path });
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

test("a put that fails with a transient 5xx a few times retries and completes the load", async () => {
  const client = createFakeCorpusDocumentClient();
  const flaky = flakyPutCall(client, 2, "InternalServerError");
  const rows = sampleRows("wordnet-complete", 3);
  const { path, dir } = await writeWireRowsJsonl(rows);
  const { sleepCalls, sleep, random } = instantRetryPolicy();
  try {
    const result = await loadBand({
      client: flaky, tableName: "t", band: "wordnet-complete", source: path, writeConcurrency: 1, sleep, random,
    });
    assert.equal(result.status, "loaded");
    assert.equal(result.rowCount, 3);
    assert.ok(sleepCalls.length > 0, "the loader backed off before at least one retry");

    const pk = bandPartitionKey("wordnet-complete");
    for (const row of rows) {
      assert.ok(client.store.get(`${pk}|fact#${row.term}#${row.rowKey}`), `row ${row.rowKey} landed after the retries`);
    }
    assert.ok(client.store.get(`${pk}|${MANIFEST_SORT_KEY}`), "the manifest landed once every row did");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a put rejected with a validation error fails immediately, with no retry", async () => {
  const client = createFakeCorpusDocumentClient();
  const invalid = alwaysFailingPutCall(client, "ValidationException");
  const { path, dir } = await writeWireRowsJsonl(sampleRows("wordnet-complete", 1));
  const { sleepCalls, sleep, random } = instantRetryPolicy();
  try {
    await assert.rejects(
      loadBand({ client: invalid, tableName: "t", band: "wordnet-complete", source: path, sleep, random }),
      (error) => {
        assert.ok(error instanceof BackendUnavailable);
        assert.ok(!/after \d+ attempts/.test(error.message), `expected a single-attempt message, got: ${error.message}`);
        return true;
      },
    );
    assert.equal(sleepCalls.length, 0, "a validation error never backs off");
    assert.equal(client.store.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a put that never recovers exhausts its retries and names the attempt count and last error", async () => {
  const client = createFakeCorpusDocumentClient();
  const down = alwaysFailingPutCall(client, "InternalServerError");
  const { path, dir } = await writeWireRowsJsonl(sampleRows("wordnet-complete", 1));
  const { sleepCalls, sleep, random } = instantRetryPolicy();
  try {
    await assert.rejects(
      loadBand({
        client: down, tableName: "t", band: "wordnet-complete", source: path, retryAttempts: 3, sleep, random,
      }),
      (error) => {
        assert.ok(error instanceof BackendUnavailable);
        assert.match(error.message, /after 3 attempts/);
        assert.match(error.message, /simulated InternalServerError/);
        return true;
      },
    );
    assert.equal(sleepCalls.length, 2, "backs off between attempts 1-2 and 2-3, not after the last one");
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
  const { path, dir } = await writeWireRowsJsonl(sampleRows("wordnet-complete", 5));
  try {
    await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path });
    const result = await clearBand({ client, tableName: "t", band: "wordnet-complete" });
    assert.equal(result.deleted, 6); // 5 facts + the manifest

    const pk = bandPartitionKey("wordnet-complete");
    for (const key of client.store.keys()) assert.ok(!key.startsWith(`${pk}|`), `${key} should have been cleared`);
    assert.equal(await bandStatus({ client, tableName: "t", band: "wordnet-complete" }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clearing an already-empty band is a no-op", async () => {
  const client = createFakeCorpusDocumentClient();
  const result = await clearBand({ client, tableName: "t", band: "wordnet-complete" });
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
  const found = await queryBandTerm(client, "t", "wordnet-complete", "zzzqx-nonsense");
  assert.deepEqual(found, []);
});

/** A clock that advances by a fixed step every call, regardless of who
 *  calls it — lets a test decide exactly how much time each written row
 *  "takes" without depending on wall-clock timing. */
function stepClock(stepMs) {
  let ms = 0;
  return () => { const value = ms; ms += stepMs; return value; };
}

test("onProgress fires once a fake clock crosses the interval, with the loaded/total count at that point", async () => {
  const client = createFakeCorpusDocumentClient();
  const rows = sampleRows("wordnet-complete", 5);
  const { path, dir } = await writeWireRowsJsonl(rows);
  const ticks = [];
  try {
    await loadBand({
      client, tableName: "t", band: "wordnet-complete", source: path, writeConcurrency: 1,
      progressIntervalMs: 1000, progressNow: stepClock(400),
      onProgress: (progress) => ticks.push(progress),
    });
    // one row every 400ms of fake time: the interval (1000ms) is crossed
    // after the 3rd row (1200ms since start), then again after the 5th
    // (2000ms) at completion — the final call always reports rowCount/rowCount.
    assert.deepEqual(ticks.map((t) => t.loaded), [3, 5]);
    for (const tick of ticks) assert.equal(tick.total, 5);
    assert.equal(ticks.at(-1).loaded, ticks.at(-1).total, "the completion report always carries the final count");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("onProgress never fires mid-load when the fake clock never crosses the interval, only at completion", async () => {
  const client = createFakeCorpusDocumentClient();
  const rows = sampleRows("wordnet-complete", 4);
  const { path, dir } = await writeWireRowsJsonl(rows);
  const ticks = [];
  try {
    await loadBand({
      client, tableName: "t", band: "wordnet-complete", source: path, writeConcurrency: 1,
      progressIntervalMs: 60_000, progressNow: stepClock(1),
      onProgress: (progress) => ticks.push(progress),
    });
    assert.equal(ticks.length, 1, "only the completion report, no mid-load tick");
    assert.equal(ticks[0].loaded, 4);
    assert.equal(ticks[0].total, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("onProgress is unset by default and changes nothing about a load's result", async () => {
  const client = createFakeCorpusDocumentClient();
  const { path, dir } = await writeWireRowsJsonl(sampleRows("wordnet-complete", 3));
  try {
    const result = await loadBand({ client, tableName: "t", band: "wordnet-complete", source: path });
    assert.equal(result.status, "loaded");
    assert.equal(result.rowCount, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
