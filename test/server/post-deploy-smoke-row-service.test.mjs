// The post-deploy smoke script's row-service probes, proven against the same
// local double the row-service handler's own tests use — no AWS reachable,
// and none needed: each probe only ever talks HTTP to whatever base URL it's
// handed.
import test from "node:test";
import assert from "node:assert/strict";

import { createLocalRowService } from "../../server/row-service/local.mjs";
import { rowServiceRoundTrip, corpusReadProbe } from "../../scripts/post-deploy-smoke.mjs";
import { bandFactRow } from "../../src/adapters/memory/corpus-bands.mjs";

test("the round trip PUTs, reads back, and deletes its own row against a local double", async () => {
  const service = await createLocalRowService();
  try {
    const sessionKey = await rowServiceRoundTrip(service.url);
    assert.match(sessionKey, /^[0-9a-f-]{36}$/i);

    const rows = await (await fetch(`${service.url}/api/rows`, { headers: { "x-tmct-session": sessionKey } })).json();
    assert.equal(rows.rows.length, 0, "the round trip's own delete leaves nothing behind");
  } finally {
    await service.close();
  }
});

test("a missing row service reports the failure instead of throwing past the caller", async () => {
  await assert.rejects(() => rowServiceRoundTrip("http://127.0.0.1:1"), /fetch failed|ECONNREFUSED/);
});

test("the round trip's PUT and its delete step carry x-amz-content-sha256; its GET never does — the URL auth layer 403s a body-carrying request without it, and the delete step uses the POST twin since CloudFront's OAC signs DELETE as body-less", async () => {
  const service = await createLocalRowService();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", headers: init?.headers || {} });
    return realFetch(url, init);
  };
  try {
    await rowServiceRoundTrip(service.url);
  } finally {
    globalThis.fetch = realFetch;
    await service.close();
  }

  const putCall = calls.find((call) => call.method === "PUT");
  assert.ok(putCall.headers["x-amz-content-sha256"], "the PUT carries the payload-hash header");

  const deleteCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/rows/delete"));
  assert.ok(deleteCall, "the delete step calls the POST twin, not the DELETE verb");
  assert.ok(deleteCall.headers["x-amz-content-sha256"], "the delete step carries the payload-hash header");

  const getCall = calls.find((call) => call.method === "GET");
  assert.equal(getCall.headers["x-amz-content-sha256"], undefined, "a GET must never gain the payload-hash header");
});

test("the corpus probe reads its WordNet-only term back from a loaded band", async () => {
  const rows = [
    bandFactRow({ subject: "dolphin", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:wordnet-complete", band: "wordnet-complete", ord: 0 }),
  ];
  const service = await createLocalRowService({ fixtureBand: { name: "wordnet-complete", rows } });
  try {
    const rowCount = await corpusReadProbe(service.url);
    assert.equal(rowCount, 1);
  } finally {
    await service.close();
  }
});

test("an unconfigured corpus band reports the failure instead of throwing past the caller", async () => {
  const service = await createLocalRowService();
  try {
    await assert.rejects(() => corpusReadProbe(service.url), /returned 404/);
  } finally {
    await service.close();
  }
});
