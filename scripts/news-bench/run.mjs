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
import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

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

/** Loads the seed onto a fresh in-memory handle and reports what it loaded —
 *  the sha256 of the exact bytes read and the individual-row count — so the
 *  caller can stamp the run's provenance without a second file read. A
 *  "fixture" seed loads nothing (the fast lane starts from an empty store),
 *  which the digest/row-count report as null/0 rather than as a match for
 *  any real seed file. */
async function seededMemoryHandle(seed) {
  const handle = createInMemoryStore();
  if (seed === "fixture") return { handle, seedDigest: null, seedRowCount: 0 };
  if (seed !== "xl") throw new Error(`news-bench: unknown --seed "${seed}" (expected "xl" or "fixture")`);
  let raw;
  try {
    raw = readFileSync(CHAT_SEED_PATH, "utf8");
  } catch (err) {
    throw new Error(`news-bench: --seed xl needs ${CHAT_SEED_PATH} — run \`npm run build:chat-seed\` first (${err?.message ?? err})`);
  }
  const payload = JSON.parse(raw);
  applySeedPayload(handle, payload);
  const seedDigest = createHash("sha256").update(raw).digest("hex");
  const seedRowCount = Array.isArray(payload.individuals) ? payload.individuals.length : 0;
  return { handle, seedDigest, seedRowCount };
}

/** The repo's own HEAD sha at run time, or null outside a git checkout (an
 *  npm-packed tarball, say) — never thrown, since provenance is a courtesy
 *  stamp, not something a run should fail over. */
function gitHeadSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
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

/** The `take` most recent of `items` by `publishedAt` descending, id
 *  ascending as the deterministic tiebreak — a pure function of the item
 *  list, so two runs over the same fixture always keep the same slice. `take`
 *  of null/0 is "no limit", returning `items` unchanged. */
function mostRecentItems(items, take) {
  if (!take) return items;
  return [...items]
    .sort((a, b) => {
      const byDate = String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? ""));
      return byDate !== 0 ? byDate : String(a.id ?? "").localeCompare(String(b.id ?? ""));
    })
    .slice(0, take);
}

function buildFetchers(sourceIds, dates, { take = null } = {}) {
  const fetchers = new Map();
  for (const sourceId of sourceIds) {
    const fixture = loadFixture(sourceId, dates[sourceId]);
    const fetchImpl = replayFetchImplFor(fixture);
    const fetcher = createNewsFetcher(recordFor(sourceId), { fetchImpl, minIntervalMs: 0, now: fixture.capturedAt });
    fetchers.set(sourceId, !take ? fetcher : {
      id: fetcher.id,
      fetchItems: async () => {
        const result = await fetcher.fetchItems();
        return { ...result, items: mostRecentItems(result.items, take) };
      },
    });
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
 *  defaults to the five shipped contemporary sources. `take`: the N most
 *  recent items per source (publishedAt desc, id tiebreak); null/omitted
 *  takes every item the fixture offers. `doubleIngest`: whether to run a
 *  second poll/feed pass to check the de-dupe metric's "mints nothing new"
 *  target — defaults to true for the fixture seed (seconds either way) and
 *  false for xl (the second full pass otherwise doubles the run's wall time
 *  for a check the fixture lane already covers every time it runs). */
export async function runBench({
  seed = "xl", date = null, sourceIds = FIXTURE_SOURCE_IDS, take = null,
  doubleIngest = seed !== "xl",
} = {}) {
  return withNetworkDisabled(async () => {
    const { dates, runNow } = resolveFixtureDates(sourceIds, date);
    const { handle: memoryDir, seedDigest, seedRowCount } = await seededMemoryHandle(seed);
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
      providers: { newsFetchers: buildFetchers(sourceIds, dates, { take }) },
      now: () => runNow,
      notify: null,
    };

    const poll = await pollNewsSources(ctx);
    const feed = await buildFeed(ctx);
    const rows = readFactRows(await loadMemory(ctx.memoryDir));

    // The double-ingest check (metric 3's own target: a second pass over the
    // identical fixtures mints zero new items and zero new cards) — only
    // when asked for. Runs against the SAME ctx/state a real second poll
    // cycle would see; every other metric below is computed from the first
    // pass alone either way.
    let secondPassNewItems = null;
    let secondPassNewCards = null;
    if (doubleIngest) {
      const poll2 = await pollNewsSources(ctx);
      const feed2 = await buildFeed(ctx);
      secondPassNewItems = poll2.newItems;
      secondPassNewCards = Math.max(0, feed2.items.length - feed.items.length);
    }

    const rankedEntries = rankedPanelEntries(ctx, rows);
    const feedDocBytes = materializedFeedBytes(ctx, feed, rows, rankedEntries);

    const admission = metrics.admissionRate(state, sourceIds);
    const groundedTerm = metrics.groundedTermProportion(state, rows);
    const dedupe = { ...metrics.dedupeRatio(feed, admission), secondPassNewItems, secondPassNewCards, doubleIngestChecked: doubleIngest };
    const entity = metrics.entityPreservation(state, rows, feed);
    const noisyHub = metrics.noisyHubRelationRate(feed, rows, state);
    const paragraph = metrics.paragraphShape(feed);
    const rankedNoise = metrics.rankedTermNoise(rankedEntries);
    const size = metrics.sizeMetrics(rows, admission.aggregate.admitted, feedDocBytes, MAX_FEED_DOCUMENT_BYTES);
    const articles = buildArticlesReport({ feed, state, rows });

    return {
      meta: { seed, sourceIds, fixtureDates: dates, now: runNow, take, doubleIngest },
      provenance: {
        seedDigest, seedRowCount, fixtureDates: dates, gitHead: gitHeadSha(),
        sources: sourceIds, take, doubleIngest,
      },
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

/** Whether two reports' provenance blocks describe the SAME inputs — same
 *  seed bytes, same fixture dates, same source/take slice — so their metrics
 *  are directly comparable without a re-run. The code that produced them can
 *  (should) differ; that's the whole point of a lever's before/after pair.
 *  Returns the reason for a mismatch so a caller can name the drift instead
 *  of silently pairing two incomparable reports. */
export function provenanceComparable(a, b) {
  if (!a || !b) return { comparable: false, reason: "one report has no provenance block" };
  if (a.seedDigest !== b.seedDigest) {
    return { comparable: false, reason: `seed digest differs (${a.seedDigest ?? "none"} vs ${b.seedDigest ?? "none"})` };
  }
  const datesA = JSON.stringify(a.fixtureDates);
  const datesB = JSON.stringify(b.fixtureDates);
  if (datesA !== datesB) return { comparable: false, reason: `fixture dates differ (${datesA} vs ${datesB})` };
  const sourcesA = JSON.stringify([...a.sources].sort());
  const sourcesB = JSON.stringify([...b.sources].sort());
  if (sourcesA !== sourcesB) return { comparable: false, reason: `sources differ (${sourcesA} vs ${sourcesB})` };
  if ((a.take ?? null) !== (b.take ?? null)) return { comparable: false, reason: `--take differs (${a.take ?? "none"} vs ${b.take ?? "none"})` };
  return { comparable: true, reason: null };
}

/** The most recently written git-tracked report under reports/newsbench/,
 *  its own JSON parsed, or null when there is none (a fresh checkout, or
 *  every report so far still uncommitted). `excludePath` skips the report a
 *  caller just wrote itself — relevant when it overwrites an already-tracked
 *  same-date-and-label file, which would otherwise "compare" a report
 *  against itself. */
export function newestCommittedReport(excludePath = null) {
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", "reports/newsbench/*.json"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
  const candidates = tracked
    .map((rel) => join(ROOT, rel))
    .filter((path) => path !== excludePath);
  if (!candidates.length) return null;
  candidates.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  const path = candidates.at(-1);
  return { path, report: JSON.parse(readFileSync(path, "utf8")) };
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

  const p = report.provenance;
  return `# newsbench — ${runDate} (${label})

seed: ${report.meta.seed}. fixture dates: ${JSON.stringify(report.meta.fixtureDates)}. clock: ${report.meta.now}. sources: ${report.meta.sourceIds.join(", ")}. take: ${report.meta.take ?? "all"}. double-ingest checked: ${report.meta.doubleIngest}.

## Provenance

seed digest: ${p.seedDigest ?? "none (fixture seed)"} (${p.seedRowCount} row(s)). git HEAD: ${p.gitHead ?? "unknown"}.

Two reports are directly comparable — same numbers meaningfully diffable, no re-run needed — exactly when their provenance blocks match on seed digest, fixture dates, sources and take. The code that produced them is free to differ; that's the point of a before/after pair. A lever's "before" is the previous committed after-report once the two provenance blocks line up on those four fields. When they don't, the newest committed report's own drift gets a one-line warning at run time instead of a silently incomparable pair.

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

cards ${m.dedupeRatio.cards}, admitted items ${m.dedupeRatio.admittedItems}, ratio ${num(m.dedupeRatio.ratio)}. Second pass${m.dedupeRatio.doubleIngestChecked ? "" : " (not checked this run)"}: ${num(m.dedupeRatio.secondPassNewItems)} new item(s), ${num(m.dedupeRatio.secondPassNewCards)} new card(s).

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
  const out = {
    seed: "xl", date: null, sources: null, label: null, take: null, doubleIngest: null,
  };
  for (const arg of argv) {
    if (arg.startsWith("--seed=")) out.seed = arg.slice("--seed=".length);
    else if (arg.startsWith("--date=")) out.date = arg.slice("--date=".length);
    else if (arg.startsWith("--label=")) out.label = arg.slice("--label=".length);
    else if (arg.startsWith("--sources=")) out.sources = arg.slice("--sources=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--take=")) out.take = Number.parseInt(arg.slice("--take=".length), 10);
    else if (arg === "--double-ingest") out.doubleIngest = true;
  }
  return out;
}

/** Prints a one-line warning naming the drift when `report` isn't directly
 *  comparable to the newest committed report — the seed-drift case that
 *  used to force a fresh "before" run. Silent when there is no prior
 *  committed report to compare against (a fresh checkout) or when the two
 *  line up. */
function warnIfIncomparable(report, jsonPath) {
  const prev = newestCommittedReport(jsonPath);
  if (!prev) return;
  const cmp = provenanceComparable(report.provenance, prev.report.provenance);
  if (!cmp.comparable) {
    process.stdout.write(`provenance: not directly comparable to ${relative(ROOT, prev.path)} — ${cmp.reason}\n`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const label = args.label || args.seed;
  const report = await runBench({
    seed: args.seed, date: args.date, sourceIds: args.sources ?? FIXTURE_SOURCE_IDS,
    take: args.take, doubleIngest: args.doubleIngest ?? undefined,
  });
  const runDate = new Date().toISOString().slice(0, 10);
  const { jsonPath, mdPath, articlesPath } = writeReport(report, { runDate, label });
  process.stdout.write(`wrote ${jsonPath}\nwrote ${mdPath}\nwrote ${articlesPath}\n`);
  process.stdout.write(
    `admission ${(report.metrics.admissionRate.aggregate.rate * 100).toFixed(2)}%, `
    + `dedupe ratio ${num(report.metrics.dedupeRatio.ratio)}, `
    + `feed document ${report.metrics.size.feedDocumentBytes} bytes\n`,
  );
  warnIfIncomparable(report, jsonPath);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(`news-bench: run failed: ${err?.stack ?? err}`);
    process.exitCode = 1;
  });
}
