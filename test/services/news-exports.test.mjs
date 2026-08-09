// Pins the news library contract's package entry: a consumer taking only
// `@polycode-projects/the-mechanical-code-talker/news` (no chat/grammar
// engine) reaches the state constructor, cycle entry points, metrics and
// the built-in fetchers/courtesy gate the same way an external package
// would, resolved through the package's own `exports` map rather than a
// relative import.

import { test } from "node:test";
import assert from "node:assert/strict";

const news = await import("@polycode-projects/the-mechanical-code-talker/news");

test("the ./news subpath resolves the state constructor and metrics", () => {
  assert.equal(typeof news.createNewsState, "function");
  const state = news.createNewsState();
  assert.deepEqual(state.items, []);
  assert.deepEqual(state.health, []);
  assert.deepEqual(state.requestLog, []);
  assert.deepEqual(state.metrics, []);
  assert.ok("ledger" in state);

  assert.equal(typeof news.cycleMetrics, "function");
  const before = { sentences: 0, recognized: 0, factsAdded: 0, termsResolved: 0, derived: 0 };
  const after = { sentences: 4, recognized: 2, factsAdded: 3, termsResolved: 1, derived: 1, at: "2026-08-09T00:00:00.000Z" };
  const metrics = news.cycleMetrics(before, after, { source: "wikimedia-featured" });
  assert.equal(metrics.sourceId, "wikimedia-featured");
  assert.equal(metrics.sentences, 4);
  assert.equal(metrics.groundedRateStrict, 0.5);
  assert.equal(metrics.factsAdded, 3);
});

test("the ./news subpath resolves the cycle entry points and config", () => {
  for (const name of [
    "resolveNewsConfig", "clampNewsConfig", "parseNewsRequest",
    "pollNewsSources", "ingestNewsSnapshot", "enrichTopTerms", "reprocessAfterGrounding",
    "isVocabGroundedTerm", "isFactGroundedTerm", "ingestUploadedFactRows", "buildFeed", "newsTurn",
  ]) {
    assert.equal(typeof news[name], "function", `${name} should be a function`);
  }
  assert.equal(typeof news.NEWS_DEFAULTS, "object");
  assert.ok(Array.isArray(news.NEWS_SOURCE_RECORDS) && news.NEWS_SOURCE_RECORDS.length > 0);
  assert.ok(Array.isArray(news.DEFAULT_NEWS_SOURCE_IDS));
  assert.ok(Array.isArray(news.DEFAULT_NEWS_KB_IDS));
});

test("the ./news subpath resolves the built-in fetchers as an optional convenience", () => {
  assert.equal(typeof news.createNewsFetcher, "function");
  assert.equal(typeof news.preflightNewsUrl, "function");
  assert.equal(typeof news.registerNewsSource, "function");
  assert.equal(typeof news.newsSourceRecords, "function");
  assert.equal(typeof news.normalizeNewsSourceIds, "function");

  const record = news.NEWS_SOURCE_RECORDS[0];
  const fetcher = news.createNewsFetcher(record, { fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(fetcher.id, record.id);
  assert.equal(typeof fetcher.fetchItems, "function");
});

test("the ./news subpath resolves the courtesy gate as an optional convenience", () => {
  assert.equal(typeof news.createCourtesyGate, "function");
  assert.equal(typeof news.DEFAULT_TIMEOUT_MS, "number");
  assert.equal(typeof news.DEFAULT_MIN_INTERVAL_MS, "number");

  const gate = news.createCourtesyGate({ fetchImpl: async () => ({ ok: true, status: 200 }) });
  assert.equal(typeof gate.fetchJson, "function");
  assert.equal(typeof gate.fetchText, "function");
  assert.equal(typeof gate.cachedFetch, "function");
});

test("the package entry (\".\") also carries createNewsState and cycleMetrics", async () => {
  const root = await import("@polycode-projects/the-mechanical-code-talker");
  assert.equal(typeof root.createNewsState, "function");
  assert.equal(typeof root.cycleMetrics, "function");
});
