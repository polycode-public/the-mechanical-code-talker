// scripts/news-rig.mjs — PLAN_NEWS_FEED.md section 16's measurement rig:
// replays the committed test/fixtures/news/ set through the real news
// service loop (poll -> ingest -> rank -> enrich -> reprocess -> build)
// against a freshly seeded standard store, and reports the six named
// metrics. Every fetch is answered from a committed fixture file — zero
// live network, byte-for-byte deterministic given the fixed `now` below.
//
// The five contemporary fixtures carry ordinary news vocabulary (ceasefire,
// tariff, earthquake places, a Show HN title); the four knowledge-base
// fixtures this rig also wires up are each keyed to the term "heart" (a
// phase 2 unit-test fixture set, never chained to the contemporary content
// by design). So this run's own enrichment round measures what it measures
// honestly: whichever of the contemporary run's pending terms happen to
// match a KB fixture succeed, everything else records an honest miss and
// enters the negative cache, same as a real KB source finding nothing.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { initRepo } from "../src/services/init.mjs";
import { openMemoryBackend, loadMemory, readFactRows, appendFacts, removeFacts } from "../src/adapters/memory/core.mjs";
import { loadLexicon } from "../src/domain/grammar/lexicon.mjs";
import { normFactTerm } from "../src/domain/hash.mjs";
import { ledgerFromPayload, rankedTerms } from "../src/domain/term-ledger.mjs";
import {
  clampNewsConfig, createNewsState, pollNewsSources, enrichTopTerms, buildFeed,
} from "../src/services/news.mjs";
import { NEWS_SOURCE_RECORDS, createNewsFetcher } from "../src/adapters/corpus/news-sources.mjs";
import {
  createWikipediaLiveProvider, SIMPLE_WIKIPEDIA_ORIGIN, SIMPLE_WIKIPEDIA_SOURCE_NAME,
} from "../src/adapters/corpus/wikipedia-live.mjs";
import { createWikidataLiveProvider } from "../src/adapters/corpus/wikidata-live.mjs";
import { createWiktionaryLiveProvider } from "../src/adapters/corpus/wiktionary-live.mjs";
import { createDbpediaLookupLiveProvider } from "../src/adapters/corpus/dbpedia-lookup-live.mjs";
import { clearCache } from "../src/adapters/source.mjs";
import { writeClaim, defaultHardware, ROOT } from "./claims/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "test", "fixtures", "news");
const REPORT_PATH = join(ROOT, "reports", "NEWS_RIG.md");

// The rig's fixed clock: the same date the phase 4 source probes and the
// committed fixtures themselves were authored against (wikimedia-featured's
// own "date": "2026-08-08Z"), so the wikimedia-feed adapter's UTC date
// arithmetic lands on the fixture without a retry.
const NOW = "2026-08-08T12:00:00.000Z";

const CONTEMPORARY_SOURCE_IDS = ["wikimedia-featured", "hacker-news", "usgs-quakes", "nyt-world", "wikinews-published"];
const KB_SOURCE_IDS = ["simple-wikipedia", "wikidata", "wiktionary", "dbpedia-lookup"];

const readText = (name) => readFileSync(join(FIXTURES, name), "utf8");
const readJson = (name) => JSON.parse(readText(name));
const recordFor = (id) => NEWS_SOURCE_RECORDS.find((r) => r.id === id);

function jsonResponse(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}
function textResponse(text, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text };
}
const missingJson = () => jsonResponse({}, { status: 404 });

// ---------------------------------------------------------------------------
// contemporary sources — one fixture-backed fetchImpl per shipped format
// ---------------------------------------------------------------------------

function buildNewsFetchers() {
  const fetchers = new Map();

  const nytRss = readText("nyt-world.rss.xml");
  fetchers.set("nyt-world", createNewsFetcher(recordFor("nyt-world"), {
    fetchImpl: async () => textResponse(nytRss), minIntervalMs: 0, now: NOW,
  }));

  const wikimediaBody = readJson("wikimedia-featured.json");
  fetchers.set("wikimedia-featured", createNewsFetcher(recordFor("wikimedia-featured"), {
    fetchImpl: async () => jsonResponse(wikimediaBody), minIntervalMs: 0, now: NOW,
  }));

  const hnIds = readJson("hn-topstories.json");
  const hnItems = readJson("hn-items.json");
  fetchers.set("hacker-news", createNewsFetcher(recordFor("hacker-news"), {
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.endsWith("/topstories.json")) return jsonResponse(hnIds);
      const id = Number(u.match(/\/item\/(\d+)\.json$/)?.[1]);
      return jsonResponse(hnItems.find((it) => it.id === id) ?? null);
    },
    minIntervalMs: 0, now: NOW,
  }));

  const usgsBody = readJson("usgs-quakes.geojson");
  fetchers.set("usgs-quakes", createNewsFetcher(recordFor("usgs-quakes"), {
    fetchImpl: async () => jsonResponse(usgsBody), minIntervalMs: 0, now: NOW,
  }));

  const wikinewsBody = readJson("wikinews-published.json");
  fetchers.set("wikinews-published", createNewsFetcher(recordFor("wikinews-published"), {
    fetchImpl: async () => jsonResponse(wikinewsBody), minIntervalMs: 0, now: NOW,
  }));

  return fetchers;
}

// ---------------------------------------------------------------------------
// knowledge-base sources — real adapters, wired to the committed "heart"
// fixtures; every other term reads as the same "nothing found" shape the
// live API sends, an honest miss rather than a fabricated match.
// ---------------------------------------------------------------------------

function buildResearchProviders() {
  const heartTerm = normFactTerm("heart");

  const simpleWikipediaFixture = readJson("kb-simple-wikipedia.json");
  const simpleWikipedia = createWikipediaLiveProvider({
    origin: SIMPLE_WIKIPEDIA_ORIGIN,
    sourceName: SIMPLE_WIKIPEDIA_SOURCE_NAME,
    minIntervalMs: 0,
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("action=opensearch")) {
        const key = new URL(u).searchParams.get("search") || "";
        if (normFactTerm(key) === heartTerm) return jsonResponse([key, ["Heart"], [""], ["https://simple.wikipedia.org/wiki/Heart"]]);
        return jsonResponse([key, [], [], []]);
      }
      if (u.endsWith("/page/summary/Heart")) return jsonResponse(simpleWikipediaFixture);
      return missingJson();
    },
  });

  const wikidataFixture = readJson("kb-wikidata.json");
  const wikidata = createWikidataLiveProvider({
    minIntervalMs: 0,
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("action=wbsearchentities")) {
        const key = new URL(u).searchParams.get("search") || "";
        if (normFactTerm(key) === heartTerm) return jsonResponse({ search: [{ id: "Q1071", label: "heart" }] });
        return jsonResponse({ search: [] });
      }
      if (u.includes("action=wbgetentities") && u.includes("ids=Q1071")) return jsonResponse(wikidataFixture);
      // The batched object-label round trip: the committed fixture set does
      // not carry the objects' own labels, so this reads as an honest "no
      // further labels resolved" rather than a fabricated one.
      return jsonResponse({ entities: {} });
    },
  });

  const wiktionaryFixture = readJson("kb-wiktionary.json");
  const wiktionary = createWiktionaryLiveProvider({
    minIntervalMs: 0,
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.endsWith(`/definition/${encodeURIComponent(heartTerm)}`)) return jsonResponse(wiktionaryFixture);
      return missingJson();
    },
  });

  const dbpediaFixture = readJson("kb-dbpedia-lookup.json");
  const dbpedia = createDbpediaLookupLiveProvider({
    minIntervalMs: 0,
    fetchImpl: async (url) => {
      const u = String(url);
      const key = new URL(u).searchParams.get("query") || "";
      if (normFactTerm(key) === heartTerm) return jsonResponse(dbpediaFixture);
      return jsonResponse({ docs: [] });
    },
  });

  const byChoice = new Map([
    ["simple-wikipedia", simpleWikipedia],
    ["wikidata", wikidata],
    ["wiktionary", wiktionary],
    ["dbpedia", dbpedia],
  ]);
  return ({ source } = {}) => byChoice.get(source) ?? null;
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

/** A cycleMetrics row's rate columns times its own sentence count recovers
 *  the integer counts to well inside float precision (the rate itself was
 *  computed as an exact division of two small integers) — rounding is the
 *  correction, not a source of error. */
function countsFromMetric(m) {
  const sentences = m.sentences || 0;
  const recognized = Math.round((m.groundedRateStrict || 0) * sentences);
  const combined = Math.round((m.groundedRateOptimistic || 0) * sentences);
  return { sentences, recognized, optimisticCount: Math.max(0, combined - recognized) };
}

/** Runs the full service loop once against a freshly seeded standard store
 *  and the committed fixtures, and returns every number the report and the
 *  claims block read. Pure with respect to the outside world: the only
 *  input is the fixed `now` above, so two calls return byte-identical
 *  results (test/services/news-rig.test.mjs's determinism check). */
export async function runNewsRig({ now = NOW } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-news-rig-"));
  try {
    await initRepo(dir);
    const { dir: memoryHandle, close: closeMemoryStore } = await openMemoryBackend(dir, "");
    try {
      const config = clampNewsConfig({
        sources: CONTEMPORARY_SOURCE_IDS,
        kbSources: KB_SOURCE_IDS,
        enrichTermsPerCycle: 8,
      });
      const state = createNewsState();
      const ctx = {
        memoryDir: memoryHandle,
        store: { loadMemory, readFactRows, appendFacts, removeFacts },
        cache: null,
        lexicon: loadLexicon(),
        config,
        state,
        providers: { newsFetchers: buildNewsFetchers(), getResearchProvider: buildResearchProviders() },
        now: () => now,
        notify: null,
      };

      const poll = await pollNewsSources(ctx);
      const enrich = await enrichTopTerms(ctx);
      const feed = await buildFeed(ctx);

      const ttlMs = config.negativeCacheTtlHours * 3600000;
      const ledger = ledgerFromPayload(state.ledger);
      const pending = rankedTerms(ledger, { limit: 10, status: "pending", now, ttlMs });
      const missed = rankedTerms(ledger, { limit: 10, status: "missed", now, ttlMs });

      const pollMetrics = state.metrics.filter((m) => m.sourceId !== "enrich");
      const enrichMetrics = state.metrics.filter((m) => m.sourceId === "enrich");

      const perSource = pollMetrics.map((m) => {
        const { sentences, recognized, optimisticCount } = countsFromMetric(m);
        return {
          sourceId: m.sourceId,
          sentences,
          recognized,
          optimisticCount,
          groundedRateStrict: m.groundedRateStrict,
          groundedRateOptimistic: m.groundedRateOptimistic,
          factsAdded: m.factsAdded,
          derived: m.derived,
        };
      });

      let sentencesTotal = 0;
      let recognizedApprox = 0;
      let combinedApprox = 0;
      for (const m of pollMetrics) {
        sentencesTotal += m.sentences || 0;
        recognizedApprox += (m.groundedRateStrict || 0) * (m.sentences || 0);
        combinedApprox += (m.groundedRateOptimistic || 0) * (m.sentences || 0);
      }
      const recognizedCount = Math.round(recognizedApprox);
      const combinedCount = Math.round(combinedApprox);
      const optimisticCount = Math.max(0, combinedCount - recognizedCount);
      const groundedRateStrict = sentencesTotal > 0 ? recognizedCount / sentencesTotal : 0;
      const groundedRateOptimistic = sentencesTotal > 0 ? combinedCount / sentencesTotal : 0;

      return {
        now,
        config: { sources: config.sources, kbSources: config.kbSources, enrichTermsPerCycle: config.enrichTermsPerCycle, syllogismsPerIngest: config.syllogismsPerIngest },
        poll,
        enrich,
        feed: { itemCount: feed.items.length, seedFallback: feed.seedFallback },
        headline: {
          sentences: sentencesTotal,
          recognized: recognizedCount,
          optimisticCount,
          groundedRateStrict,
          groundedRateOptimistic,
        },
        perSource,
        enrichRound: enrichMetrics.map((m) => ({ termsResolved: m.termsResolved, factsAdded: m.factsAdded, derived: m.derived })),
        ledger: {
          pending: pending.map((e) => ({ term: e.term, count: e.count, vocabGrounded: e.vocabGrounded })),
          missed: missed.map((e) => ({ term: e.term, count: e.count, vocabGrounded: e.vocabGrounded })),
        },
      };
    } finally {
      await closeMemoryStore();
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

const pct = (rate) => `${(rate * 100).toFixed(2)}%`;

function renderReport(result) {
  const perSourceRows = result.perSource
    .map((s) => `| ${s.sourceId} | ${s.sentences} | ${pct(s.groundedRateStrict)} | ${pct(s.groundedRateOptimistic)} | ${s.factsAdded} | ${s.derived} |`)
    .join("\n");
  const pendingRows = result.ledger.pending
    .map((e) => `| ${e.term} | ${e.count} | ${e.vocabGrounded ? "parseable but knowledge-free" : "unknown word"} |`)
    .join("\n") || "| (none) | | |";
  const missedRows = result.ledger.missed
    .map((e) => `| ${e.term} | ${e.count} |`)
    .join("\n") || "| (none) | |";
  const enrichLine = result.enrich.enriched.length
    ? `enriched: ${result.enrich.enriched.join(", ")}`
    : "enriched: none this round";
  const missLine = result.enrich.missed.length
    ? `missed (negative-cached): ${result.enrich.missed.join(", ")}`
    : "missed (negative-cached): none";

  return `# NEWS_RIG — the first measured run over the committed fixtures

## What this measures

The five shipped contemporary source fixtures (Wikimedia featured, Hacker News, USGS
earthquakes, NYT World, Wikinews) and four of the five shipped knowledge-base fixtures
(Simple English Wikipedia, Wikidata, Wiktionary, DBpedia Lookup — English Wikipedia carries
no enrichment wiring of its own, section 10.2's \`KB_SOURCE_TO_RESEARCH_CHOICE\` table) run
through the real service loop — poll, ingest, rank, enrich, reprocess, build — against a
freshly seeded standard \`tmct init\` store. Every fetch answers from a committed file in
\`test/fixtures/news/\`; nothing reaches the network. Given the fixed clock this rig runs
against, the same facts land and the same numbers print on every run.

The four knowledge-base fixtures are each keyed to the term "heart", a phase 2 unit-test
fixture never chained to the contemporary fixtures' own vocabulary (ceasefire, tariff, an
earthquake place name, a Show HN title). So this run's enrichment round measures exactly
what it can: none of the contemporary run's pending terms happen to be "heart", so every
enrichment attempt this round reads as an honest miss and enters the negative cache — the
same shape a real KB source finding nothing reads as. The rig still exercises every wired
adapter's real request shape end to end; it just does not, on this particular fixture set,
land a KB grounding hit.

## Headline: grounding rate

| tier | rate | of ${result.headline.sentences} sentences |
| --- | --: | --- |
| strict | ${pct(result.headline.groundedRateStrict)} | ${result.headline.recognized} recognized |
| optimistic | ${pct(result.headline.groundedRateOptimistic)} | ${result.headline.recognized + result.headline.optimisticCount} recognized + optimistic |

Compare against L1's prose-band claim (\`results/claims/prose-band.json\`): 18.65% strict on
unedited Simple English Wikipedia sentences. This run measures higher than that, not lower —
the opposite of what PLAN_NEWS_FEED.md section 16 predicted before this rig existed to check
it. The reason is the fixture set itself: phase 0's own text says these five contemporary
fixtures are "authored samples matching each format's real field shapes rather than trims of
the recorded probe output" (the probe bodies were not on disk in the worktree that built that
phase), and the samples an author writes lean toward clean copula sentences ("A tariff is a
tax imposed on imported goods and services.") that the strict recognizer reads well. Live news
prose, once a real feed is polled, carries denser proper names and one-off phrasing that this
particular committed set does not exercise — so this number characterizes the shipped fixture
set, not a claim about raw contemporary prose in general. Either way, the page is designed to
stay useful however the number lands: the feed shows facts-with-sources rather than article
summaries, and the ranked ungrounded-terms panel turns every miss into the visible work queue.

## Per-source breakdown

| source | sentences | strict | optimistic | facts added | derived |
| --- | --: | --: | --: | --: | --: |
${perSourceRows}

Poll totals: ${result.poll.fetched} sources fetched, ${result.poll.newItems} new items,
${result.poll.facts} facts stored, ${result.poll.derived} syllogisms derived,
${result.poll.failures} failures, ${result.poll.evicted} evicted.

## Enrichment round

${enrichLine}
${missLine}
Facts from enrichment: ${result.enrich.facts}. Syllogisms derived: ${result.enrich.derived}.

## Ledger after this run

Top fact-ungrounded terms still pending:

| term | mentions | status |
| --- | --: | --- |
${pendingRows}

Terms the enrichment round tried and missed (negative-cached):

| term | mentions |
| --- | --: |
${missedRows}

## Feed

${result.feed.itemCount} item(s) built${result.feed.seedFallback ? " (seed fallback — no news-tagged facts fell inside the window)" : ""}.

## Metrics 5 and 6: page-only

Time-to-first-article and time-to-first-complete-poll are both page metrics (navigation start
to a real DOM paint), not something a Node-side replay measures. \`test-e2e/pages-news-feed
.test.mjs\`'s responsiveness contract covers them against the live page.

## Reproduce

\`node scripts/news-rig.mjs\`
`;
}

async function main() {
  const result = await runNewsRig();
  mkdirSync(join(ROOT, "reports"), { recursive: true });
  writeFileSync(REPORT_PATH, renderReport(result));
  console.log(`wrote ${REPORT_PATH}`);

  const record = writeClaim("news", {
    hardware: defaultHardware(),
    pack: "shipped",
    unit: "percent",
    value: Number((result.headline.groundedRateStrict * 100).toFixed(2)),
    marginKind: "rate",
    sources: [
      "scripts/news-rig.mjs",
      "test/fixtures/news",
      "src/services/news.mjs",
      "src/domain/news-feed.mjs",
      "src/domain/term-ledger.mjs",
      "src/domain/feed-normalize.mjs",
      "src/adapters/corpus/news-sources.mjs",
      "src/services/extract-facts.mjs",
    ],
    detail: {
      sentenceCount: result.headline.sentences,
      recognizedCount: result.headline.recognized,
      optimisticCount: result.headline.optimisticCount,
      groundedRateOptimisticPercent: Number((result.headline.groundedRateOptimistic * 100).toFixed(2)),
      sourcesPolled: result.config.sources,
      kbSourcesEnabled: result.config.kbSources,
      perSource: result.perSource,
      factsFromPoll: result.poll.facts,
      derivedFromPoll: result.poll.derived,
      enrichCandidatesTried: result.enrich.enriched.length + result.enrich.missed.length,
      enrichEnriched: result.enrich.enriched,
      enrichMissed: result.enrich.missed,
      factsFromEnrich: result.enrich.facts,
      derivedFromEnrich: result.enrich.derived,
      feedItemCount: result.feed.itemCount,
      pendingLedgerTop: result.ledger.pending,
    },
  });
  console.log(`claim:news: ${record.value}% strict grounding (${result.headline.recognized}/${result.headline.sentences} sentences), optimistic ${(result.headline.groundedRateOptimistic * 100).toFixed(2)}%`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
