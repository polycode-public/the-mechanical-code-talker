// The news service's orchestration (src/services/news.mjs): polling with
// per-source health/backoff, grounding a snapshot under the news: tag,
// ledger admission independent of lexicon membership, KB enrichment walking
// sources in config order with a negative cache, re-processing after a term
// grounds, eviction against news_fact_cap, the seed-only feed fallback, and
// determinism. Every fetch is an injected stub — no network anywhere here.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampNewsConfig, pollNewsSources, ingestNewsSnapshot, enrichTopTerms, reprocessAfterGrounding,
  isVocabGroundedTerm, isFactGroundedTerm, ingestUploadedFactRows, buildFeed, cycleMetrics, createNewsState,
} from "../../src/services/news.mjs";
import { openMemoryBackend, loadMemory, readFactRows, appendFacts, removeFacts } from "../../src/adapters/memory/core.mjs";
import { normalizeFeedItems } from "../../src/domain/feed-normalize.mjs";
import { createTermLedger, bumpTerms, ledgerPayload, ledgerFromPayload } from "../../src/domain/term-ledger.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";

const FIXED_NOW = "2026-08-08T00:00:00.000Z";

/** A ctx built against a fresh, in-process ("memory" backend) store — real
 *  grounding and syllogise runs, zero disk I/O, zero network. `close()` is a
 *  no-op for this backend but kept for symmetry with the sqlite path. */
async function makeCtx({ config = clampNewsConfig({}), state = createNewsState(), now = FIXED_NOW } = {}) {
  const backend = await openMemoryBackend("unused-repo-root", "memory");
  const ctx = {
    memoryDir: backend.dir,
    store: { loadMemory, readFactRows, appendFacts, removeFacts },
    cache: null,
    lexicon: loadLexicon(),
    config,
    state,
    providers: {},
    now: typeof now === "function" ? now : () => now,
    notify: null,
  };
  return { ctx, close: backend.close };
}

function snapshotFor(sourceId, guid, title, summary, now = FIXED_NOW) {
  return normalizeFeedItems(sourceId, [{ guid, title, url: `https://example.com/${sourceId}/${guid}`, summary }], { now })[0];
}

// ---- polling ----------------------------------------------------------------

test("pollNewsSources merges snapshots by id, ingests only the genuinely new ones, and enforces item_cap", async () => {
  const config = clampNewsConfig({ sources: ["hacker-news"], itemCap: 2 });
  const { ctx } = await makeCtx({ config });
  let call = 0;
  ctx.providers.newsFetchers = new Map([[
    "hacker-news",
    {
      id: "hacker-news",
      async fetchItems() {
        call += 1;
        const raw = call === 1
          ? [{ guid: "1", title: "A module is a component.", url: "https://x/1", summary: "" }]
          : [
            { guid: "1", title: "A module is a component.", url: "https://x/1", summary: "" },
            { guid: "2", title: "A module is a component.", url: "https://x/2", summary: "" },
            { guid: "3", title: "A module is a component.", url: "https://x/3", summary: "" },
          ];
        return { items: normalizeFeedItems("hacker-news", raw, { now: FIXED_NOW }), bytes: 100 };
      },
    },
  ]]);

  const r1 = await pollNewsSources(ctx);
  assert.equal(r1.newItems, 1);
  assert.equal(ctx.state.items.length, 1);

  const r2 = await pollNewsSources(ctx);
  assert.equal(r2.newItems, 2, "guid 1 was already seen; guids 2 and 3 are genuinely new");
  assert.equal(ctx.state.items.length, 2, "item_cap trims the merged set to 2");
});

test("pollNewsSources with no enabled sources reads as nothing to poll, never a failure", async () => {
  const { ctx } = await makeCtx({ config: clampNewsConfig({ sources: [] }) });
  const result = await pollNewsSources(ctx);
  assert.deepEqual(result, { fetched: 0, newItems: 0, failures: 0, evicted: 0, facts: 0, derived: 0, sources: [] });
});

test("pollNewsSources tracks per-source health: failures back off with doubling, three failures auto-disable, and a backed-off source is skipped rather than retried", async () => {
  const config = clampNewsConfig({ sources: ["hacker-news"], pollMinutes: 10 });
  const { ctx } = await makeCtx({ config, now: FIXED_NOW });
  ctx.providers.newsFetchers = new Map([["hacker-news", { id: "hacker-news", fetchItems: async () => null }]]);

  await pollNewsSources(ctx);
  let health = ctx.state.health.find((h) => h.sourceId === "hacker-news");
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.lastStatus, "failed");
  assert.equal(health.autoDisabled, false);
  assert.equal(Date.parse(health.backoffUntil) - Date.parse(FIXED_NOW), 10 * 60000 * 2);

  const r2 = await pollNewsSources(ctx);
  assert.deepEqual(r2.sources, [{ sourceId: "hacker-news", status: "backed-off" }]);
  health = ctx.state.health.find((h) => h.sourceId === "hacker-news");
  assert.equal(health.consecutiveFailures, 1, "a skipped poll is never counted as a new failure");

  ctx.now = () => "2026-08-08T01:00:00.000Z";
  await pollNewsSources(ctx);
  health = ctx.state.health.find((h) => h.sourceId === "hacker-news");
  assert.equal(health.consecutiveFailures, 2);
  assert.equal(Date.parse(health.backoffUntil) - Date.parse("2026-08-08T01:00:00.000Z"), 10 * 60000 * 4);

  ctx.now = () => "2026-08-08T03:00:00.000Z";
  await pollNewsSources(ctx);
  health = ctx.state.health.find((h) => h.sourceId === "hacker-news");
  assert.equal(health.consecutiveFailures, 3);
  assert.equal(health.autoDisabled, true);

  const r5 = await pollNewsSources(ctx);
  assert.deepEqual(r5.sources, [{ sourceId: "hacker-news", status: "auto-disabled" }]);
});

test("pollNewsSources records the request log: one row per fetch, url/time/bytes/status", async () => {
  const { ctx } = await makeCtx({ config: clampNewsConfig({ sources: ["hacker-news"] }) });
  ctx.providers.newsFetchers = new Map([[
    "hacker-news",
    { id: "hacker-news", fetchItems: async () => ({ items: [], bytes: 42, notModified: true }) },
  ]]);
  await pollNewsSources(ctx);
  assert.equal(ctx.state.requestLog.length, 1);
  const row = ctx.state.requestLog[0];
  assert.equal(row.status, "not-modified");
  assert.equal(row.bytes, 42);
  assert.equal(row.at, FIXED_NOW);
  assert.match(row.url, /^https:\/\//);
});

test("pollNewsSources evicts only news-tagged facts past news_fact_cap, oldest first, never a differently-tagged fact", async () => {
  const config = clampNewsConfig({ sources: ["hacker-news"], newsFactCap: 1 });
  const { ctx } = await makeCtx({ config });
  await appendFacts(ctx.memoryDir, [{ subject: "kestrel", predicate: "rdfs:subClassOf", object: "bird", provenance: "corpus:test" }]);

  ctx.providers.newsFetchers = new Map([[
    "hacker-news",
    {
      id: "hacker-news",
      fetchItems: async () => ({
        items: normalizeFeedItems("hacker-news", [
          { guid: "1", title: "A module is a component.", url: "https://x/1", summary: "" },
          { guid: "2", title: "Grace mentors Alan.", url: "https://x/2", summary: "" },
        ], { now: FIXED_NOW }),
        bytes: 10,
      }),
    },
  ]]);

  const result = await pollNewsSources(ctx);
  assert.ok(result.evicted > 0, "eviction ran once news-tagged rows exceeded the cap");

  const rows = readFactRows(await loadMemory(ctx.memoryDir));
  const newsRows = rows.filter((r) => r.provenance.startsWith("news:"));
  assert.ok(newsRows.length <= 1, "news-tagged rows never exceed the configured cap");
  assert.ok(rows.some((r) => r.subject === "kestrel"), "a non-news fact is never touched by eviction");
});

// ---- ingest / grounding -------------------------------------------------

test("ingestNewsSnapshot writes facts under the news: tag and admits a lexicon-known, fact-empty term to the ledger exactly like an unknown word", async () => {
  const { ctx } = await makeCtx();
  const snapshot = snapshotFor("hacker-news", "1", "A module is a component.", "There was a new tariff yesterday.");

  const result = await ingestNewsSnapshot(ctx, snapshot);
  assert.equal(result.facts, 1);
  assert.ok(snapshot.factIds.length, "the snapshot records the fact ids it contributed");

  const rows = readFactRows(await loadMemory(ctx.memoryDir));
  const moduleRow = rows.find((r) => r.subject === "module");
  // ingestText's own audit-tag wrapper nests the news tag rather than
  // writing it bare — trust.mjs's provenanceTagToSource reads this exact
  // nested shape back to the web tier.
  assert.match(moduleRow.provenance, /extracted:news:hacker-news@/);

  const ledger = ledgerFromPayload(ctx.state.ledger);
  const tariffEntry = ledger.terms.get("tariff");
  assert.ok(tariffEntry, "a lexicon-known, fact-empty term still enters the ledger");
  assert.equal(tariffEntry.vocabGrounded, true);
  assert.equal(tariffEntry.count, 1);
});

test("ingestNewsSnapshot runs its own bounded syllogism round and reports the derived count", async () => {
  const config = clampNewsConfig({ syllogismsPerIngest: 12 });
  const { ctx } = await makeCtx({ config });
  await appendFacts(ctx.memoryDir, [{ subject: "component", predicate: "rdfs:subClassOf", object: "part", provenance: "corpus:test" }]);
  const snapshot = snapshotFor("hacker-news", "1", "A module is a component.", "");

  const result = await ingestNewsSnapshot(ctx, snapshot);
  assert.equal(result.derived, 1, "module subClassOf part derives transitively");

  const rows = readFactRows(await loadMemory(ctx.memoryDir));
  assert.ok(rows.some((r) => r.subject === "module" && r.object === "part" && r.provenance.startsWith("entailed:")));
});

test("ingestNewsSnapshot's syllogism round is off when syllogisms_per_ingest is 0", async () => {
  const config = clampNewsConfig({ syllogismsPerIngest: 0 });
  const { ctx } = await makeCtx({ config });
  await appendFacts(ctx.memoryDir, [{ subject: "component", predicate: "rdfs:subClassOf", object: "part", provenance: "corpus:test" }]);
  const snapshot = snapshotFor("hacker-news", "1", "A module is a component.", "");
  const result = await ingestNewsSnapshot(ctx, snapshot);
  assert.equal(result.derived, 0);
});

// ---- enrichment -----------------------------------------------------------

test("enrichTopTerms caps at enrich_terms_per_cycle, walks kb sources in config order, stops at the first hit, and enters a miss into the negative cache", async () => {
  const config = clampNewsConfig({ enrichTermsPerCycle: 2, kbSources: ["simple-wikipedia", "wikidata"], negativeCacheTtlHours: 24 });
  const { ctx } = await makeCtx({ config });

  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["alpha", 3], ["beta", 2], ["gamma", 1]]), "item1", FIXED_NOW, new Map());
  ctx.state.ledger = ledgerPayload(ledger);

  const calls = { "simple-wikipedia": [], wikidata: [] };
  const alphaArticle = { term: "alpha", title: "Alpha", text: "Alpha is a thing.", summary: "Alpha is a thing.", url: "https://x/alpha", revid: 1, isa: "thing" };
  ctx.providers.getResearchProvider = ({ source }) => ({
    name: source,
    origin: "https://example.org",
    provenanceTag: (term) => `research:${source}:${term}`,
    async lookup(term) {
      calls[source].push(term);
      return source === "wikidata" && term === "alpha" ? alphaArticle : null;
    },
  });

  const result = await enrichTopTerms(ctx);
  assert.deepEqual(result.enriched, ["alpha"]);
  assert.deepEqual(result.missed, ["beta"], "gamma never gets a turn — the cycle cap is 2");
  assert.deepEqual(calls["simple-wikipedia"], ["alpha", "beta"], "config order: simple-wikipedia first, for every candidate this cycle");
  assert.deepEqual(calls.wikidata, ["alpha", "beta"], "wikidata only runs for a term simple-wikipedia missed");

  const rows = readFactRows(await loadMemory(ctx.memoryDir));
  assert.ok(rows.some((r) => r.subject === "alpha" && r.object === "thing" && r.provenance === "research:wikidata:alpha"));

  const afterLedger = ledgerFromPayload(ctx.state.ledger);
  assert.equal(afterLedger.terms.get("alpha").status, "grounded");
  assert.equal(afterLedger.terms.get("beta").status, "missed");
  assert.equal(afterLedger.terms.get("gamma").status, "pending");

  // A second cycle, same `now`: beta stays inside its negative-cache TTL and
  // is never retried; alpha is no longer pending (already grounded); only
  // gamma gets a turn.
  await enrichTopTerms(ctx);
  assert.deepEqual(calls["simple-wikipedia"], ["alpha", "beta", "gamma"], "beta was not retried inside the TTL");
});

test("enrichTopTerms with nothing pending is a clean no-op", async () => {
  const { ctx } = await makeCtx();
  const result = await enrichTopTerms(ctx);
  assert.deepEqual(result, { enriched: [], missed: [], facts: 0, derived: 0 });
});

// ---- reprocessing -----------------------------------------------------------

test("reprocessAfterGrounding re-ingests only the snapshots mentioning a grounded term, upserts without duplicating fact ids, and sweeps the ledger by fact-grounding alone", async () => {
  const { ctx } = await makeCtx();
  const snapA = snapshotFor("hacker-news", "a", "A tariff is a policy.", "");
  const snapB = snapshotFor("hacker-news", "b", "A module is a component.", "");
  ctx.state.items = [snapA, snapB];

  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["tariff", 1]]), snapA.id, FIXED_NOW, new Map([["tariff", true]]));
  ctx.state.ledger = ledgerPayload(ledger);

  const result = await reprocessAfterGrounding(ctx, ["tariff"]);
  assert.equal(snapA.factIds.length, 1, "the mentioning snapshot was re-ingested");
  assert.equal(snapA.processedRounds, 1);
  assert.equal(snapB.factIds.length, 0, "the non-mentioning snapshot is untouched");
  assert.equal(snapB.processedRounds, 0);
  assert.equal(result.facts, 1);

  const before = [...snapA.factIds].sort();
  await reprocessAfterGrounding(ctx, ["tariff"]);
  assert.deepEqual([...snapA.factIds].sort(), before, "content-addressed ids upsert rather than duplicate");
  assert.equal(snapA.processedRounds, 2);

  const flippedLedger = ledgerFromPayload(ctx.state.ledger);
  assert.equal(flippedLedger.terms.get("tariff").status, "grounded", "the fact-degree sweep flips the entry, not the caller directly");
});

test("reprocessAfterGrounding with no grounded terms is a pure no-op", async () => {
  const { ctx } = await makeCtx();
  const result = await reprocessAfterGrounding(ctx, []);
  assert.deepEqual(result, { facts: 0, derived: 0, flipped: [] });
});

// ---- grounding definitions --------------------------------------------------

test("isVocabGroundedTerm and isFactGroundedTerm test independent, unrelated conditions", () => {
  const lexicon = loadLexicon();
  const rows = [{ id: "fact:1", subject: "widget", predicate: "rdfs:subClassOf", object: "device" }];

  assert.equal(isFactGroundedTerm(rows, "widget"), true, "an unlisted content noun with a fact row is fact-grounded");
  assert.equal(isVocabGroundedTerm(lexicon, "widget"), false, "the lexicon has never met it");

  assert.equal(isVocabGroundedTerm(lexicon, "tariff"), true, "a lexicon noun with zero fact rows is still ledger-eligible");
  assert.equal(isFactGroundedTerm(rows, "tariff"), false);

  assert.equal(isVocabGroundedTerm(lexicon, "xyzzyplugh"), false);
  assert.equal(isFactGroundedTerm(rows, "xyzzyplugh"), false);
});

// ---- uploaded facts ---------------------------------------------------------

test("ingestUploadedFactRows downgrades an above-teach row and leaves an at-or-below-teach row untouched", () => {
  const rows = [
    { subject: "a", predicate: "mgx:hasA", object: "b", provenance: "ace:chat:sess1@2026-01-01" },
    { subject: "c", predicate: "mgx:hasA", object: "d", provenance: "teach:chat:sess1@2026-01-01" },
    { subject: "e", predicate: "mgx:hasA", object: "f", provenance: "corpus:conceptnet" },
  ];
  const out = ingestUploadedFactRows(rows, { fileLabel: "upload.jsonl", now: FIXED_NOW });
  assert.equal(out[0].provenance, `teach:upload:upload.jsonl@${FIXED_NOW}`, "operator-tier provenance is above teach — downgraded");
  assert.equal(out[1].provenance, "teach:chat:sess1@2026-01-01", "already at the teach tier — kept as stated");
  assert.equal(out[2].provenance, "corpus:conceptnet", "below the teach tier — kept as stated");
});

// ---- the feed ---------------------------------------------------------------

test("buildFeed falls back to whole-graph hub scoring on a seed-only graph, and every item carries the fallback flag", async () => {
  const { ctx } = await makeCtx();
  await appendFacts(ctx.memoryDir, [
    { subject: "volcano", predicate: "rdfs:subClassOf", object: "mountain", provenance: "corpus:test" },
    { subject: "volcano", predicate: "mgx:hasA", object: "lava", provenance: "corpus:test" },
  ]);
  const feed = await buildFeed(ctx);
  assert.ok(feed.seedFallback, "no news-tagged rows exist yet, so scoring fell back to the whole graph");
  assert.ok(feed.items.length > 0, "the first paint is never empty");
  assert.ok(feed.items.some((it) => it.hub === "volcano"));
});

test("buildFeed is deterministic: the same state and the same now render byte-identical feeds", async () => {
  const { ctx } = await makeCtx({ config: clampNewsConfig({ syllogismsPerIngest: 0 }) });
  const snapshot = snapshotFor("hacker-news", "1", "A module is a component.", "");
  await ingestNewsSnapshot(ctx, snapshot);

  const first = await buildFeed(ctx);
  const second = await buildFeed(ctx);
  assert.deepEqual(first, second);
});

// ---- metrics ----------------------------------------------------------------

test("cycleMetrics computes strict and optimistic grounding rate as two separate columns, plus the plain count deltas", () => {
  const before = { at: FIXED_NOW, sentences: 0, recognized: 0, optimisticCount: 0, factsAdded: 0, termsResolved: 0, derived: 0 };
  const after = { at: FIXED_NOW, sentences: 10, recognized: 3, optimisticCount: 2, factsAdded: 5, termsResolved: 1, derived: 2 };
  const metric = cycleMetrics(before, after, { source: "hacker-news" });
  assert.equal(metric.sourceId, "hacker-news");
  assert.equal(metric.sentences, 10);
  assert.equal(metric.groundedRateStrict, 0.3);
  assert.equal(metric.groundedRateOptimistic, 0.5, "recognized + optimistic, over the same total");
  assert.equal(metric.factsAdded, 5);
  assert.equal(metric.termsResolved, 1);
  assert.equal(metric.derived, 2);
});

test("cycleMetrics never divides by zero when a cycle sees no sentences", () => {
  const before = { sentences: 0, recognized: 0, optimisticCount: 0, factsAdded: 0, termsResolved: 0, derived: 0 };
  const after = { ...before };
  const metric = cycleMetrics(before, after, {});
  assert.equal(metric.groundedRateStrict, 0);
  assert.equal(metric.groundedRateOptimistic, 0);
});

test("pollNewsSources appends one cycle metric per source that returned items", async () => {
  const { ctx } = await makeCtx({ config: clampNewsConfig({ sources: ["hacker-news"] }) });
  ctx.providers.newsFetchers = new Map([[
    "hacker-news",
    {
      id: "hacker-news",
      fetchItems: async () => ({
        items: normalizeFeedItems("hacker-news", [{ guid: "1", title: "A module is a component.", url: "https://x/1", summary: "" }], { now: FIXED_NOW }),
        bytes: 10,
      }),
    },
  ]]);
  await pollNewsSources(ctx);
  assert.equal(ctx.state.metrics.length, 1);
  assert.equal(ctx.state.metrics[0].sourceId, "hacker-news");
  assert.ok(ctx.state.metrics[0].sentences > 0);
});
