// The news-feed-quality bench's own regression guard: runs the fast
// (fixture-seed) lane over the committed test/fixtures/news-feeds/ capture
// and asserts every floor below still holds. A floor number is the N0
// baseline run's own reading minus a small margin — it locks what already
// shipped, it does not aspire to a number nobody measured yet. A landed
// improvement moves its floor up in the same commit that earns it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { runBench } from "../../scripts/news-bench/run.mjs";

// Baseline: fixture-seed lane, five committed 2026-08-12 captures, 121 items
// offered, 69 admitted, 66 cards.
const ADMISSION_RATE_FLOOR = 0.50; // baseline 0.5702
const GROUNDED_TERM_PROPORTION_FLOOR = 0.10; // baseline 0.1318
const DEDUPE_RATIO_FLOOR = 0.85; // baseline 0.9565
// A second poll over the identical fixtures must mint nothing new — the
// plan's own target for this metric, not a margin-relaxed floor.
const SECOND_PASS_NEW_ITEMS_MAX = 0;
const SECOND_PASS_NEW_CARDS_MAX = 0;
// Context lines are sparse under the fast lane's empty prior graph (one
// line, baseline 0 noisy) — the ceiling stays loose rather than pretend a
// single-line sample locks a rate tightly.
const NOISY_HUB_RELATION_RATE_CEILING = 0.5;
const REPEATED_SENTENCE_RATE_CEILING = 0.50; // baseline 0.4095, a named N0 gap — this stops it getting worse
const HEADLINE_PRESENT_RATE_FLOOR = 0.90; // baseline 1.0
const LINK_PRESENT_RATE_FLOOR = 0.90; // baseline 1.0
const DATE_PRESENT_RATE_FLOOR = 0.90; // baseline 1.0
const RANKED_TERM_NOISE_CEILING = 0.30; // baseline 0.2

let cached = null;
async function fastBench() {
  if (!cached) cached = await runBench({ seed: "fixture" });
  return cached;
}

test("the fast lane runs fully offline against the committed fixtures with zero fetch failures", async () => {
  const report = await fastBench();
  assert.equal(report.meta.seed, "fixture");
  assert.equal(report.poll.fetched, 5);
  assert.equal(report.poll.failures, 0);
});

test("admission rate holds its floor", async () => {
  const report = await fastBench();
  assert.ok(report.metrics.admissionRate.aggregate.rate >= ADMISSION_RATE_FLOOR, report.metrics.admissionRate.aggregate.rate);
});

test("grounded-term proportion holds its floor", async () => {
  const report = await fastBench();
  assert.ok(report.metrics.groundedTermProportion.aggregate.microAverage >= GROUNDED_TERM_PROPORTION_FLOOR);
});

test("de-dupe ratio holds its floor, and a second pass over the same fixtures mints nothing new", async () => {
  const report = await fastBench();
  assert.ok(report.metrics.dedupeRatio.ratio >= DEDUPE_RATIO_FLOOR);
  assert.ok(report.metrics.dedupeRatio.secondPassNewItems <= SECOND_PASS_NEW_ITEMS_MAX);
  assert.ok(report.metrics.dedupeRatio.secondPassNewCards <= SECOND_PASS_NEW_CARDS_MAX);
});

test("noisy-hub-relation rate stays under its ceiling", async () => {
  const report = await fastBench();
  assert.ok(report.metrics.noisyHubRelationRate.rate <= NOISY_HUB_RELATION_RATE_CEILING);
});

test("paragraph shape holds its floors: repeated-sentence rate capped, headline, link and date presence floored", async () => {
  const report = await fastBench();
  assert.ok(report.metrics.paragraphShape.repeatedSentenceRate <= REPEATED_SENTENCE_RATE_CEILING);
  assert.ok(report.metrics.paragraphShape.headlinePresentRate >= HEADLINE_PRESENT_RATE_FLOOR);
  assert.ok(report.metrics.paragraphShape.linkPresentRate >= LINK_PRESENT_RATE_FLOOR);
  assert.ok(report.metrics.paragraphShape.datePresentRate >= DATE_PRESENT_RATE_FLOOR);
});

test("ranked-term noise stays under its ceiling", async () => {
  const report = await fastBench();
  assert.ok(report.metrics.rankedTermNoise.rate <= RANKED_TERM_NOISE_CEILING);
});

test("the materialized feed document never breaches MAX_FEED_DOCUMENT_BYTES", async () => {
  const report = await fastBench();
  assert.ok(report.metrics.size.feedDocumentBytes <= report.metrics.size.maxFeedDocumentBytes);
});

test("two fast-lane runs over the same fixtures produce byte-identical metrics and definitions", async () => {
  const a = await runBench({ seed: "fixture" });
  const b = await runBench({ seed: "fixture" });
  assert.deepEqual(a.metrics, b.metrics);
  assert.deepEqual(a.definitions, b.definitions);
  assert.deepEqual(a.poll, b.poll);
  assert.deepEqual(a.articles, b.articles);
});

test("the articles log accounts for every offered item exactly once, across cards, cardless-admitted and rejected", async () => {
  const report = await fastBench();
  const cardEntries = report.articles.filter((a) => a.kind === "card");
  const cardlessEntries = report.articles.filter((a) => a.kind === "cardless-admitted");
  const rejectedEntries = report.articles.filter((a) => a.kind === "rejected");
  assert.equal(cardEntries.length, report.metrics.dedupeRatio.cards);

  const backingItemIds = new Set();
  for (const card of cardEntries) for (const item of card.backingItems) backingItemIds.add(item.id);
  assert.equal(backingItemIds.size + cardlessEntries.length, report.metrics.admissionRate.aggregate.admitted);
  assert.equal(rejectedEntries.length, report.metrics.admissionRate.aggregate.offered - report.metrics.admissionRate.aggregate.admitted);

  for (const card of cardEntries) {
    assert.ok(typeof card.hub === "string" && card.hub.length > 0);
    assert.ok(typeof card.paragraph === "string");
    assert.ok(Array.isArray(card.sources));
    assert.ok(typeof card.headlinePresent === "boolean");
    assert.ok(typeof card.linkPresent === "boolean");
    assert.ok(typeof card.datePresent === "boolean");
  }
});
