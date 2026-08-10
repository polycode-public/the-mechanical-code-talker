// The shared courtesy gate: fetchJson's existing behaviour (timeout, 429/
// maxlag cool-off, caching) stays byte-for-byte what wikipedia-live.mjs and
// wikidata-live.mjs already exercise; this file covers the two additive
// pieces news-sources.mjs needs — fetchText, and the ETag/Last-Modified
// conditional-request memory — plus cachedFetch's `remember: false` escape
// hatch for a caller (a feed poller) that must always re-fetch.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createCourtesyGate } from "../../src/adapters/corpus/courtesy.mjs";

function response(body, { status = 200, headers = {}, asJson = true } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => {
      if (typeof body === "function") throw body();
      return body;
    },
    text: async () => (asJson ? JSON.stringify(body) : body),
  };
}

test("fetchText returns the raw body text on a 2xx response", async () => {
  const gate = createCourtesyGate({
    fetchImpl: async () => response("<rss><channel></channel></rss>", { asJson: false }),
    minIntervalMs: 0,
  });
  assert.equal(await gate.fetchText("https://example.com/feed.xml"), "<rss><channel></channel></rss>");
});

test("fetchText reads as null on a non-2xx response, a thrown fetch, and a body that throws", async () => {
  const notOk = createCourtesyGate({ fetchImpl: async () => response("", { status: 500, asJson: false }), minIntervalMs: 0 });
  assert.equal(await notOk.fetchText("https://example.com/feed.xml"), null);

  const dead = createCourtesyGate({ fetchImpl: async () => { throw new Error("network down"); }, minIntervalMs: 0 });
  assert.equal(await dead.fetchText("https://example.com/feed.xml"), null);

  const badBody = createCourtesyGate({
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => { throw new Error("stream error"); } }),
    minIntervalMs: 0,
  });
  assert.equal(await badBody.fetchText("https://example.com/feed.xml"), null);
});

test("fetchText is aborted by the timeout and reads as null", async () => {
  const gate = createCourtesyGate({
    fetchImpl: (url, { signal } = {}) => new Promise((resolve, reject) => {
      if (signal) signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
    timeoutMs: 20,
    minIntervalMs: 0,
  });
  assert.equal(await gate.fetchText("https://example.com/feed.xml"), null);
});

test("a 429 opens a cool-off shared by fetchJson and fetchText alike", async () => {
  const calls = [];
  const gate = createCourtesyGate({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return response("", { status: 429, headers: { "retry-after": "60" }, asJson: false });
    },
    minIntervalMs: 0,
  });
  assert.equal(await gate.fetchText("https://example.com/feed.xml"), null);
  assert.equal(calls.length, 1);
});

test("without a validators map, fetchJson/fetchText send no conditional headers and a 304 reads as null", async () => {
  const seenHeaders = [];
  const gate = createCourtesyGate({
    fetchImpl: async (url, opts = {}) => {
      seenHeaders.push(opts.headers);
      return response("", { status: 304, asJson: false });
    },
    minIntervalMs: 0,
  });
  assert.equal(await gate.fetchText("https://example.com/feed.xml"), null, "a 304 with no validators falls through to the ordinary !res.ok null");
  assert.deepEqual(seenHeaders, [undefined], "no If-None-Match/If-Modified-Since without a validators map");
});

test("with a validators map: the first fetch sends no conditional headers, remembers the response's ETag and Last-Modified, and the second fetch sends them back", async () => {
  const validators = new Map();
  const seenHeaders = [];
  let call = 0;
  const gate = createCourtesyGate({
    fetchImpl: async (url, opts = {}) => {
      seenHeaders.push(opts.headers);
      call += 1;
      if (call === 1) {
        return response("first body", { asJson: false, headers: { etag: '"abc123"', "last-modified": "Sat, 08 Aug 2026 09:00:00 GMT" } });
      }
      return response("", { status: 304, asJson: false });
    },
    minIntervalMs: 0,
    validators,
  });

  const first = await gate.fetchText("https://example.com/feed.xml");
  assert.equal(first, "first body");
  assert.equal(seenHeaders[0], undefined, "no validator to send yet on the first fetch, so no headers option at all");
  assert.deepEqual(validators.get("https://example.com/feed.xml"), { etag: '"abc123"', lastModified: "Sat, 08 Aug 2026 09:00:00 GMT" });

  const second = await gate.fetchText("https://example.com/feed.xml");
  assert.deepEqual(second, { notModified: true }, "a 304 reads as notModified, not null, once validators are in play");
  assert.equal(seenHeaders[1]["If-None-Match"], '"abc123"');
  assert.equal(seenHeaders[1]["If-Modified-Since"], "Sat, 08 Aug 2026 09:00:00 GMT");
});

test("a 2xx response that carries neither header leaves an existing validator entry untouched", async () => {
  const validators = new Map([["https://example.com/feed.xml", { etag: '"kept"', lastModified: "" }]]);
  const gate = createCourtesyGate({
    fetchImpl: async () => response("body with no validator headers", { asJson: false }),
    minIntervalMs: 0,
    validators,
  });
  await gate.fetchText("https://example.com/feed.xml");
  assert.deepEqual(validators.get("https://example.com/feed.xml"), { etag: '"kept"', lastModified: "" });
});

test("cachedFetch({remember:false}) never answers from cache — a repeated call always re-runs work, still gated by the slot", async () => {
  const calls = [];
  const gate = createCourtesyGate({ fetchImpl: async () => response({}), minIntervalMs: 0 });
  const work = () => { calls.push(Date.now()); return Promise.resolve("fresh"); };

  assert.equal(await gate.cachedFetch("k", work, { remember: false }), "fresh");
  assert.equal(await gate.cachedFetch("k", work, { remember: false }), "fresh");
  assert.equal(calls.length, 2, "the second call re-ran work instead of answering from cache");
});

test("cachedFetch's default (remember: true, or the option omitted) still caches — existing callers see no behaviour change", async () => {
  let calls = 0;
  const gate = createCourtesyGate({ fetchImpl: async () => response({}), minIntervalMs: 0 });
  const work = () => { calls += 1; return Promise.resolve("fresh"); };

  assert.equal(await gate.cachedFetch("k", work), "fresh");
  assert.equal(await gate.cachedFetch("k", work), "fresh");
  assert.equal(calls, 1, "the second call answered from the cache");
});

test("cachedFetch({remember:false}) still respects the minimum interval between slots", async () => {
  const gate = createCourtesyGate({ fetchImpl: async () => response({}), minIntervalMs: 60_000 });
  const work = () => Promise.resolve("fresh");
  assert.equal(await gate.cachedFetch("a", work, { remember: false }), "fresh", "the first call gets the open slot");
  assert.equal(await gate.cachedFetch("b", work, { remember: false }), null, "a second key inside the interval is throttled, not answered fresh");
});

test("the gate counts a throttle, a 5xx, a dead transport and a maxlag rejection as the source failing", async () => {
  const throttled = createCourtesyGate({ fetchImpl: async () => response({}, { status: 429 }), minIntervalMs: 0 });
  assert.equal(await throttled.fetchJson("https://example.com/a"), null);
  assert.equal(throttled.stats().systemicFailures, 1);

  const broken = createCourtesyGate({ fetchImpl: async () => response({}, { status: 503 }), minIntervalMs: 0 });
  assert.equal(await broken.fetchJson("https://example.com/a"), null);
  assert.equal(broken.stats().systemicFailures, 1);

  const dead = createCourtesyGate({ fetchImpl: async () => { throw new Error("connection refused"); }, minIntervalMs: 0 });
  assert.equal(await dead.fetchJson("https://example.com/a"), null);
  assert.equal(dead.stats().systemicFailures, 1);

  const lagging = createCourtesyGate({
    fetchImpl: async () => response({ error: { code: "maxlag" } }, { headers: { "retry-after": "5" } }),
    minIntervalMs: 0,
  });
  assert.equal(await lagging.fetchJson("https://example.com/a"), null);
  assert.equal(lagging.stats().systemicFailures, 1);
});

test("a 404 and an unreadable body are answers, not the source failing", async () => {
  const missing = createCourtesyGate({ fetchImpl: async () => response({}, { status: 404 }), minIntervalMs: 0 });
  assert.equal(await missing.fetchJson("https://example.com/a"), null);
  assert.equal(missing.stats().systemicFailures, 0);
  assert.equal(missing.stats().fetches, 1);

  const unparseable = createCourtesyGate({
    fetchImpl: async () => response(() => new Error("not json")),
    minIntervalMs: 0,
  });
  assert.equal(await unparseable.fetchJson("https://example.com/a"), null);
  assert.equal(unparseable.stats().systemicFailures, 0);
});

test("a 2xx never counts against the source, and the counters climb across calls", async () => {
  const gate = createCourtesyGate({ fetchImpl: async () => response({ ok: true }), minIntervalMs: 0 });
  await gate.fetchJson("https://example.com/a");
  await gate.fetchJson("https://example.com/b");
  assert.deepEqual(
    { fetches: gate.stats().fetches, systemicFailures: gate.stats().systemicFailures },
    { fetches: 2, systemicFailures: 0 },
  );
});

test("a turn spends its declared fetch budget and then stops fetching, and the stop is not a failure", async () => {
  let calls = 0;
  const gate = createCourtesyGate({
    fetchImpl: async () => { calls += 1; return response({ ok: true }); },
    minIntervalMs: 0,
    maxFetchesPerTurn: 2,
  });
  gate.beginTurn();
  assert.notEqual(await gate.fetchJson("https://example.com/a"), null);
  assert.notEqual(await gate.fetchJson("https://example.com/b"), null);
  assert.equal(await gate.fetchJson("https://example.com/c"), null, "the third fetch is past the turn's budget");
  assert.equal(calls, 2, "the budget stops the round trip before it leaves");
  assert.equal(gate.stats().budgetExhausted, true);
  assert.equal(gate.stats().systemicFailures, 0);

  gate.beginTurn();
  assert.notEqual(await gate.fetchJson("https://example.com/d"), null, "the next turn starts with a full budget");
  assert.equal(gate.stats().budgetExhausted, false);
});

test("a caller that never declares a turn spends no budget", async () => {
  const gate = createCourtesyGate({ fetchImpl: async () => response({ ok: true }), minIntervalMs: 0, maxFetchesPerTurn: 1 });
  for (let i = 0; i < 5; i += 1) assert.notEqual(await gate.fetchJson(`https://example.com/${i}`), null);
  assert.equal(gate.stats().fetches, 5);
});
