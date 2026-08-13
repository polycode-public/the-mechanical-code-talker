// Corpus band naming, the manifest shape, and the wire row a band fact
// projects onto — corpus-bands.mjs. The term Query helper (queryBandTerm)
// lives in corpus-loader.mjs instead (it wraps a services-layer module;
// corpus-loader.test.mjs covers it) — see corpus-bands.mjs's own header.
import test from "node:test";
import assert from "node:assert/strict";

import {
  BAND_PARTITION_PREFIX, FIRST_CLASS_BANDS, MANIFEST_SORT_KEY,
  bandPartitionKey, isBandPartitionKey, bandNameFromPartitionKey, bandSortKeyForRow,
  buildBandManifest, bandFactRow, bandLicenseInfo,
} from "../../src/adapters/memory/corpus-bands.mjs";
import { rowProblems } from "../../src/adapters/memory/row-backend.mjs";

test("bandPartitionKey and bandNameFromPartitionKey round-trip", () => {
  for (const band of FIRST_CLASS_BANDS) {
    const pk = bandPartitionKey(band);
    assert.equal(pk, `${BAND_PARTITION_PREFIX}${band}`);
    assert.equal(bandNameFromPartitionKey(pk), band);
  }
});

test("a band partition key is never a valid session UUIDv4", () => {
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const band of FIRST_CLASS_BANDS) {
    assert.ok(!uuidV4.test(bandPartitionKey(band)));
    assert.ok(isBandPartitionKey(bandPartitionKey(band)));
  }
  assert.ok(!isBandPartitionKey("4c9b1e2a-1111-4aaa-8aaa-111111111111"));
  assert.equal(bandNameFromPartitionKey("4c9b1e2a-1111-4aaa-8aaa-111111111111"), null);
});

test("bandSortKeyForRow matches the session fact row layout", () => {
  assert.equal(bandSortKeyForRow("fact", "tariff", "abc123"), "fact#tariff#abc123");
  assert.equal(bandSortKeyForRow("fact", "", "abc123"), "fact##abc123");
});

test("buildBandManifest carries every field a citation or a no-op check reads", () => {
  const manifest = buildBandManifest({
    band: "wordnet-complete", rowCount: 42, loadedAt: "2026-01-01T00:00:00.000Z",
    sourceDigest: "deadbeef", license: "CC-BY-4.0", notice: "corpus/wordnet/LICENSE-NOTICE",
  });
  assert.deepEqual(manifest, {
    band: "wordnet-complete", version: 1, rowCount: 42, loadedAt: "2026-01-01T00:00:00.000Z",
    sourceDigest: "deadbeef", license: "CC-BY-4.0", notice: "corpus/wordnet/LICENSE-NOTICE",
  });
});

test("buildBandManifest refuses a negative or non-integer row count", () => {
  const base = { band: "b", loadedAt: "t", sourceDigest: "d" };
  assert.throws(() => buildBandManifest({ ...base, rowCount: -1 }));
  assert.throws(() => buildBandManifest({ ...base, rowCount: 1.5 }));
});

test("bandFactRow projects a valid wire row with no pk or sk of its own", () => {
  const row = bandFactRow({
    subject: "dolphin", predicate: "rdfs:subClassOf", object: "mammal",
    provenance: "corpus:wordnet-complete /r/IsA", band: "wordnet-complete", ord: 3,
  });
  assert.equal(rowProblems(row).length, 0);
  assert.equal(row.rowClass, "fact");
  assert.equal(row.term, "dolphin");
  assert.equal(row.pk, undefined);
  assert.equal(row.sk, undefined);
  const record = JSON.parse(row.json);
  assert.equal(record.ord, 3);
  assert.equal(record.individual.class, "Fact");
  const attr = (key) => record.individual.attributes.find((a) => a.key === key)?.value;
  assert.equal(attr("subject"), "dolphin");
  assert.equal(attr("predicate"), "rdfs:subClassOf");
  assert.equal(attr("object"), "mammal");
  assert.equal(attr("provenance"), "corpus:wordnet-complete /r/IsA");
  assert.equal(attr("trustScore"), "0.7");
});

test("bandFactRow is deterministic: the same triple on two runs is byte-identical", () => {
  const build = () => bandFactRow({
    subject: "dog", predicate: "rdfs:subClassOf", object: "mammal",
    provenance: "corpus:wordnet-complete /r/IsA", band: "wordnet-complete", ord: 0,
  });
  assert.deepEqual(build(), build());
});

test("bandFactRow's rowKey carries the source band, so the same triple from two bands never collides", () => {
  const a = bandFactRow({ subject: "dog", predicate: "rdfs:subClassOf", object: "mammal", band: "wordnet-complete" });
  const b = bandFactRow({ subject: "dog", predicate: "rdfs:subClassOf", object: "mammal", band: "a-consumer-owned-band" });
  assert.notEqual(a.rowKey, b.rowKey);
});

test("bandFactRow refuses an oversized projection before any write", () => {
  assert.throws(() => bandFactRow({
    subject: "x", predicate: "rdfs:subClassOf", object: "y",
    provenance: "corpus:wordnet-complete " + "z".repeat(5000), band: "wordnet-complete",
  }));
});

test("bandLicenseInfo names every first-class band's licence and, when the licence needs one, a notice file", () => {
  for (const band of FIRST_CLASS_BANDS) {
    const info = bandLicenseInfo(band);
    assert.ok(info.license);
    assert.ok(info.notice, `${band} needs a notice file`);
  }
});

test("bandLicenseInfo reads null, not a guess, for a band outside the table", () => {
  assert.deepEqual(bandLicenseInfo("a-consumer-owned-band"), { license: null, notice: null });
});

test("MANIFEST_SORT_KEY is not a shape bandSortKeyForRow could ever produce", () => {
  // A fact row's sk always has two "#" separators; the manifest's sk has none,
  // so a term read (begins_with a rowClass#) can never accidentally match it.
  assert.equal(MANIFEST_SORT_KEY.includes("#"), false);
});
