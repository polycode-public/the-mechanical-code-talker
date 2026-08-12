#!/usr/bin/env node
// scripts/news-bench/run.mjs — the offline news-feed-quality bench
// (PLAN_NEWS_FEED_QUALITY.md section 2): drives the real worker-shaped path
// (a source's own fetcher parsing -> pollNewsSources -> ingest -> buildFeed)
// over the committed, dated fixtures from capture-fixtures.mjs and a chosen
// seed, then reports every section 3 metric. Fully offline: every fetch
// answers from a captured fixture, the clock is a fixed value derived from
// the fixtures' own dates (never Date.now()), and the graph is either the
// committed xl seed or a fresh empty store. Two runs over the same fixtures
// and seed produce byte-identical `metrics`/`poll`/`definitions` JSON.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createInMemoryStore, applySeedPayload, loadMemory, readFactRows, appendFacts, removeFacts,
} from "../../src/adapters/memory/core.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";
import { isNewsProvenance } from "../../src/domain/news-feed.mjs";
import { ledgerFromPayload, rankedTerms } from "../../src/domain/term-ledger.mjs";
import {
  clampNewsConfig, createNewsState, pollNewsSources, buildFeed, filterRankedTermEntries,
} from "../../src/services/news.mjs";
import { NEWS_SOURCE_RECORDS, createNewsFetcher } from "../../src/adapters/corpus/news-sources.mjs";
import { serializeCard, enforceFeedSizeBound, feedDocumentBytes, MAX_FEED_DOCUMENT_BYTES } from "../../server/news-worker/handler.mjs";
import * as metrics from "./metrics.mjs";
import { buildArticlesReport, renderArticlesMarkdown } from "./articles.mjs";
import { ROOT, FIXTURE_SOURCE_IDS, latestSourceDate, loadFixture, replayFetchImplFor } from "./fixtures.mjs";

const recordFor = (id) => NEWS_SOURCE_RECORDS.find((r) => r.id === id);
// news.mjs's own renderRankText overfetches the ledger by this factor before
// filterRankedTermEntries narrows it, so the display-size slice below stays
// full even after concept/quantity terms drop out — mirrored here for the
// same reason, not re-exported since it is a private display constant.
const RANK_OVERFETCH = 4;
const RANKED_TERMS_LIMIT = 20;

const CHAT_SEED_PATH = join(ROOT, "public", "chat-seed.json");

async function seededMemoryHandle(seed) {
  const handle = createInMemoryStore();
  if (seed === "fixture") return handle;
  if (seed !== "xl") throw new Error(`news-bench: unknown --seed "${seed}" (expected "xl" or "fixture")`);
  let payload;
  try {
    payload = JSON.parse(readFileSync(CHAT_SEED_PATH, "utf8"));
  } catch (err) {
    throw new Error(`news-bench: --seed xl needs ${CHAT_SEED_PATH} — run \`npm run build:chat-seed\` first (${err?.message ?? err})`);
  }
  applySeedPayload(handle, payload);
  return handle;
}

/** Resolves each source's own fixture date: `date` pins every source to the
 *  same one (throws if any source has no capture for it); omitted, each
 *  source uses its own latest capture independently. Either way returns
 *  `{ dates, runNow }`, `runNow` a fixed clock derived from the latest date
 *  actually used — never the wall clock, so the report body stays
 *  deterministic across days. */
function resolveFixtureDates(sourceIds, date) {
  const dates = {};
  for (const sourceId of sourceIds) {
    const resolved = date || latestSourceDate(sourceId);
    if (!resolved) {
      throw new Error(`news-bench: no captured fixture for "${sourceId}" — run \`node scripts/news-bench/capture-fixtures.mjs\` first`);
    }
    dates[sourceId] = resolved;
  }
  const latest = Object.values(dates).sort().at(-1);
  return { dates, runNow: `${latest}T12:00:00.000Z` };
}

/** Temporarily replaces the global fetch with one that throws, for the
 *  duration of `work()` — the bench's own proof that nothing inside it ever
 *  escapes the fixture stubs onto the real network (every fetcher below is
 *  built with an explicit fetchImpl, so this should never fire). */
async function withNetworkDisabled(work) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    throw new Error(`news-bench: an unstubbed fetch reached the network (${url}) — run.mjs must be fully offline`);
  };
  try {
    return await work();
  } finally {
    if (original) globalThis.fetch = original;
    else delete globalThis.fetch;
  }
}

function buildFetchers(sourceIds, dates) {
  const fetchers = new Map();
  for (const sourceId of sourceIds) {
    const fixture = loadFixture(sourceId, dates[sourceId]);
    const fetchImpl = replayFetchImplFor(fixture);
    fetchers.set(sourceId, createNewsFetcher(recordFor(sourceId), { fetchImpl, minIntervalMs: 0, now: fixture.capturedAt }));
  }
  return fetchers;
}

function rankedPanelEntries(ctx, rows) {
  const ttlMs = ctx.config.negativeCacheTtlHours * 3600000;
  const ledger = ledgerFromPayload(ctx.state.ledger);
  const raw = rankedTerms(ledger, { limit: RANKED_TERMS_LIMIT * RANK_OVERFETCH, now: ctx.now(), ttlMs });
  return filterRankedTermEntries(rows, raw).slice(0, RANKED_TERMS_LIMIT);
}

function materializedFeedBytes(ctx, feed, rows, rankedEntries) {
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const items = feed.items.map((item) => serializeCard(item, rowsById));
  let factsFromNews = 0;
  for (const row of rows) if (isNewsProvenance(row.provenance)) factsFromNews += 1;
  const document = enforceFeedSizeBound({
    items, rankedTerms: rankedEntries,
    stats: { graphSize: rows.length, factsFromNews },
    sourceStatus: ctx.state.health || [],
    requestLog: [],
    builtAt: feed.builtAt,
  });
  return feedDocumentBytes(document);
}

/** Runs one bench pass and returns the full report — no file I/O.
 *  `seed`: "xl" (default) or "fixture". `date`: pins every source to one
 *  capture date; omitted, each source uses its own latest. `sourceIds`:
 *  defaults to the five shipped contemporary sources. */
export async function runBench({ seed = "xl", date = null, sourceIds = FIXTURE_SOURCE_IDS } = {}) {
  return withNetworkDisabled(async () => {
    const { dates, runNow } = resolveFixtureDates(sourceIds, date);
    const memoryDir = await seededMemoryHandle(seed);
    // itemCap is a GLOBAL cap across every source's own snapshots
    // (mergeSnapshotsById evicts the oldest once the combined total crosses
    // it), not a per-source one — a one-shot measurement over five sources'
    // worth of fixtures needs every genuinely fetched item to survive long
    // enough to be measured, so this pins the knob at its own product
    // ceiling (clampNewsConfig's own [1, 200] range) rather than the
    // rolling-poll default of 30.
    const config = clampNewsConfig({ sources: sourceIds, itemCap: 200 });
    const state = createNewsState();
    const ctx = {
      memoryDir,
      store: { loadMemory, readFactRows, appendFacts, removeFacts },
      cache: null,
      lexicon: loadLexicon(),
      config,
      state,
      providers: { newsFetchers: buildFetchers(sourceIds, dates) },
      now: () => runNow,
      notify: null,
    };

    const poll = await pollNewsSources(ctx);
    const feed = await buildFeed(ctx);
    const rows = readFactRows(await loadMemory(ctx.memoryDir));

    // The double-ingest check (metric 3's own target: a second pass over the
    // identical fixtures mints zero new items and zero new cards). Runs
    // against the SAME ctx/state a real second poll cycle would see; every
    // other metric below is computed from the first pass alone.
    const poll2 = await pollNewsSources(ctx);
    const feed2 = await buildFeed(ctx);
    const secondPassNewItems = poll2.newItems;
    const secondPassNewCards = Math.max(0, feed2.items.length - feed.items.length);

    const rankedEntries = rankedPanelEntries(ctx, rows);
    const feedDocBytes = materializedFeedBytes(ctx, feed, rows, rankedEntries);

    const admission = metrics.admissionRate(state, sourceIds);
    const groundedTerm = metrics.groundedTermProportion(state, rows);
    const dedupe = { ...metrics.dedupeRatio(feed, admission), secondPassNewItems, secondPassNewCards };
    const entity = metrics.entityPreservation(state, rows, feed);
    const noisyHub = metrics.noisyHubRelationRate(feed, rows, state);
    const paragraph = metrics.paragraphShape(feed);
    const rankedNoise = metrics.rankedTermNoise(rankedEntries);
    const size = metrics.sizeMetrics(rows, admission.aggregate.admitted, feedDocBytes, MAX_FEED_DOCUMENT_BYTES);
    const articles = buildArticlesReport({ feed, state, rows });

    return {
      meta: { seed, sourceIds, fixtureDates: dates, now: runNow },
      poll: {
        fetched: poll.fetched, newItems: poll.newItems, failures: poll.failures,
        facts: poll.facts, derived: poll.derived, evicted: poll.evicted,
      },
      metrics: {
        admissionRate: admission,
        groundedTermProportion: groundedTerm,
        dedupeRatio: dedupe,
        entityPreservation: entity,
        noisyHubRelationRate: noisyHub,
        paragraphShape: paragraph,
        rankedTermNoise: rankedNoise,
        size,
      },
      definitions: metrics.DEFINITIONS,
      articles,
    };
  });
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

const pct = (rate) => (rate === null || rate === undefined ? "n/a" : `${(rate * 100).toFixed(2)}%`);
const num = (n) => (n === null || n === undefined ? "n/a" : (Number.isInteger(n) ? String(n) : n.toFixed(2)));

function renderMarkdown(report, { runDate, label }) {
  const m = report.metrics;
  const admissionRows = Object.entries(m.admissionRate.perSource)
    .map(([sourceId, r]) => `| ${sourceId} | ${r.admitted}/${r.offered} | ${pct(r.rate)} |`)
    .join("\n");
  const groundedRows = Object.entries(m.groundedTermProportion.perSource)
    .map(([sourceId, r]) => `| ${sourceId} | ${r.articles} | ${pct(r.microAverage)} |`)
    .join("\n");

  return `# newsbench — ${runDate} (${label})

seed: ${report.meta.seed}. fixture dates: ${JSON.stringify(report.meta.fixtureDates)}. clock: ${report.meta.now}.

## Poll

fetched ${report.poll.fetched}, new items ${report.poll.newItems}, facts ${report.poll.facts}, derived ${report.poll.derived}, failures ${report.poll.failures}, evicted ${report.poll.evicted}.

## 1. Admission rate

| source | admitted/offered | rate |
| --- | --: | --: |
${admissionRows}

aggregate: ${m.admissionRate.aggregate.admitted}/${m.admissionRate.aggregate.offered} (${pct(m.admissionRate.aggregate.rate)})

## 2. Grounded-term proportion

| source | articles | micro-average |
| --- | --: | --: |
${groundedRows}

aggregate: ${pct(m.groundedTermProportion.aggregate.microAverage)} over ${m.groundedTermProportion.aggregate.articles} article(s)

## 3. De-dupe ratio

cards ${m.dedupeRatio.cards}, admitted items ${m.dedupeRatio.admittedItems}, ratio ${num(m.dedupeRatio.ratio)}. Second pass: ${m.dedupeRatio.secondPassNewItems} new item(s), ${m.dedupeRatio.secondPassNewCards} new card(s).

## 4. Entity preservation

${m.entityPreservation.anchoredCandidateCount} gazetteer-anchored candidate(s) of ${m.entityPreservation.rawCandidateCount} raw. Fact survival ${pct(m.entityPreservation.factSurvivalRate)}, paragraph survival ${pct(m.entityPreservation.paragraphSurvivalRate)}.

## 5. Noisy-hub-relation rate

${m.noisyHubRelationRate.noisy}/${m.noisyHubRelationRate.contextLines} context line(s) noisy (${pct(m.noisyHubRelationRate.rate)}), same-sense test. Closed-list reading: ${pct(m.noisyHubRelationRate.noisyHubRateClosedList)}.

## 6. Paragraph shape

${m.paragraphShape.cards} card(s). sentences/card: ${m.paragraphShape.sentencesPerCard ? `min ${m.paragraphShape.sentencesPerCard.min}, max ${m.paragraphShape.sentencesPerCard.max}, mean ${num(m.paragraphShape.sentencesPerCard.mean)}` : "n/a"}. repeated-sentence rate ${pct(m.paragraphShape.repeatedSentenceRate)}, "Around it" repeat rate ${pct(m.paragraphShape.aroundItRepeatRate)}. headline ${pct(m.paragraphShape.headlinePresentRate)}, link ${pct(m.paragraphShape.linkPresentRate)}, date ${pct(m.paragraphShape.datePresentRate)}.

## 7. Ranked-term noise

${m.rankedTermNoise.noisy}/${m.rankedTermNoise.entries} noisy (${pct(m.rankedTermNoise.rate)}).

## 8. Size

${m.size.newsFactRows} news fact row(s), ${m.size.newsFactBytes} bytes (${num(m.size.rowsPerArticle)} rows/article, ${num(m.size.bytesPerArticle)} bytes/article). Feed document ${m.size.feedDocumentBytes} bytes of a ${m.size.maxFeedDocumentBytes} budget (${pct(m.size.feedDocumentBudgetUsed)}).

## Reproduce

\`node scripts/news-bench/run.mjs --seed ${report.meta.seed}\`
`;
}

export function writeReport(report, { runDate, label }) {
  const dir = join(ROOT, "reports", "newsbench");
  mkdirSync(dir, { recursive: true });
  const base = `${runDate}-${label}`;
  const jsonPath = join(dir, `${base}.json`);
  const mdPath = join(dir, `${base}.md`);
  const articlesPath = join(dir, `${base}-articles.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report, { runDate, label }));
  writeFileSync(articlesPath, renderArticlesMarkdown(report, report.articles, { runDate, label }));
  return { jsonPath, mdPath, articlesPath };
}

function parseArgs(argv) {
  const out = { seed: "xl", date: null, sources: null, label: null };
  for (const arg of argv) {
    if (arg.startsWith("--seed=")) out.seed = arg.slice("--seed=".length);
    else if (arg.startsWith("--date=")) out.date = arg.slice("--date=".length);
    else if (arg.startsWith("--label=")) out.label = arg.slice("--label=".length);
    else if (arg.startsWith("--sources=")) out.sources = arg.slice("--sources=".length).split(",").map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const label = args.label || args.seed;
  const report = await runBench({ seed: args.seed, date: args.date, sourceIds: args.sources ?? FIXTURE_SOURCE_IDS });
  const runDate = new Date().toISOString().slice(0, 10);
  const { jsonPath, mdPath, articlesPath } = writeReport(report, { runDate, label });
  process.stdout.write(`wrote ${jsonPath}\nwrote ${mdPath}\nwrote ${articlesPath}\n`);
  process.stdout.write(
    `admission ${(report.metrics.admissionRate.aggregate.rate * 100).toFixed(2)}%, `
    + `dedupe ratio ${num(report.metrics.dedupeRatio.ratio)}, `
    + `feed document ${report.metrics.size.feedDocumentBytes} bytes\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(`news-bench: run failed: ${err?.stack ?? err}`);
    process.exitCode = 1;
  });
}
