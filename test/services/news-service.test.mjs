// The news service's orchestration (src/services/news.mjs): polling with
// per-source health/backoff, grounding a snapshot under the news: tag,
// ledger admission independent of lexicon membership, KB enrichment walking
// sources in config order with a negative cache, re-processing after a term
// grounds, eviction against news_fact_cap, the newsworthiness gate's empty
// state, and determinism. Every fetch is an injected stub — no network
// anywhere here.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampNewsConfig, pollNewsSources, ingestNewsSnapshot, enrichTopTerms, reprocessAfterGrounding,
  isVocabGroundedTerm, isFactGroundedTerm, ingestUploadedFactRows, buildFeed, cycleMetrics, createNewsState,
  filterRankedTermEntries, newsTurn, articleEntityNames,
} from "../../src/services/news.mjs";
import { openMemoryBackend, loadMemory, readFactRows, appendFacts, removeFacts } from "../../src/adapters/memory/core.mjs";
import { normalizeFeedItems } from "../../src/domain/feed-normalize.mjs";
import { renderNewsParagraph } from "../../src/domain/news-feed.mjs";
import { createTermLedger, bumpTerms, ledgerPayload, ledgerFromPayload } from "../../src/domain/term-ledger.mjs";
import { createSourceBreakerRegistry, SOURCE_BREAKER_DEFAULTS } from "../../src/domain/source-breaker.mjs";
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

/** A fetcher that answers one snapshot per call from a fixed list. */
function fetcherFor(sourceId, titles) {
  return {
    id: sourceId,
    async fetchItems() {
      const raw = titles.map((title, i) => ({ guid: String(i + 1), title, url: `https://x/${sourceId}/${i + 1}`, summary: "" }));
      return { items: normalizeFeedItems(sourceId, raw, { now: FIXED_NOW }), bytes: 100 };
    },
  };
}

// ---- polling ----------------------------------------------------------------

test("a ctx that says stop stops the poll between sources: the first source's articles land, the second is never fetched", async () => {
  const config = clampNewsConfig({ sources: ["hacker-news", "usgs-quakes"] });
  const { ctx } = await makeCtx({ config });
  let usgsFetches = 0;
  ctx.providers.newsFetchers = new Map([
    ["hacker-news", fetcherFor("hacker-news", ["A module is a component."])],
    ["usgs-quakes", { id: "usgs-quakes", async fetchItems() { usgsFetches += 1; return { items: [], bytes: 0 }; } }],
  ]);
  let polledSources = 0;
  ctx.shouldAbort = () => polledSources >= 1;
  const originalFetch = ctx.providers.newsFetchers.get("hacker-news").fetchItems;
  ctx.providers.newsFetchers.get("hacker-news").fetchItems = async () => {
    polledSources += 1;
    return originalFetch();
  };

  const result = await pollNewsSources(ctx);
  assert.equal(result.aborted, true, "the cycle reports that it stopped part-way");
  assert.equal(usgsFetches, 0, "the source after the stop was never fetched");
  assert.equal(ctx.state.items.length, 1, "what the first source returned still landed");
  assert.equal(result.sources.length, 1, "only the source it got to is reported on");
});

test("a stop between articles keeps what already ingested and never half-folds the one it was on", async () => {
  const config = clampNewsConfig({ sources: ["hacker-news"] });
  const { ctx } = await makeCtx({ config });
  ctx.providers.newsFetchers = new Map([[
    "hacker-news",
    fetcherFor("hacker-news", ["A module is a component.", "A widget is a gadget.", "A quokka is a marsupial."]),
  ]]);
  let ingested = 0;
  ctx.shouldAbort = () => ingested >= 1;
  const rowsBefore = readFactRows(await loadMemory(ctx.memoryDir)).length;
  const originalReadRows = ctx.store.readFactRows;
  ctx.store.readFactRows = (memory) => {
    const rows = originalReadRows(memory);
    if (rows.length > rowsBefore) ingested = 1;
    return rows;
  };

  const result = await pollNewsSources(ctx);
  ctx.store.readFactRows = originalReadRows;
  const stored = readFactRows(await loadMemory(ctx.memoryDir));
  assert.ok(result.aborted, "the poll reports that it stopped");
  assert.ok(stored.length > rowsBefore, "the article it had already folded is stored whole");
});

test("an enrich cycle stopped mid-lookup returns its term to pending, never to the negative cache", async () => {
  const config = clampNewsConfig({ kbSources: ["simple-wikipedia"], enrichTermsPerCycle: 2 });
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["gizmo", 3], ["widget", 2]]), "item-1", FIXED_NOW, new Map());
  const state = { ...createNewsState(), ledger: ledgerPayload(ledger) };
  const { ctx } = await makeCtx({ config, state });
  let lookups = 0;
  ctx.providers.getResearchProvider = () => ({
    name: "simple-wikipedia",
    provenanceTag: (term) => `research:simple-wikipedia:${term}`,
    lookup: async () => { lookups += 1; return null; },
  });
  ctx.shouldAbort = () => true;

  const result = await enrichTopTerms(ctx);
  assert.equal(result.aborted, true, "the cycle reports that it stopped");
  assert.equal(lookups, 0, "no lookup fired after the stop");
  assert.deepEqual(result.missed, [], "a stop is never read as a miss");
  const after = ledgerFromPayload(ctx.state.ledger);
  for (const term of ["gizmo", "widget"]) {
    assert.equal(after.terms.get(term).status, "pending", `${term} waits for the next cycle`);
  }
});

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
            { guid: "2", title: "A widget is a component.", url: "https://x/2", summary: "" },
            { guid: "3", title: "A gadget is a component.", url: "https://x/3", summary: "" },
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
  assert.deepEqual(result, { fetched: 0, newItems: 0, failures: 0, evicted: 0, facts: 0, derived: 0, aborted: false, sources: [] });
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

test("an enriched term arrives with the relations its article states, and reads back through the same paraphrase a polled item gets", async () => {
  const config = clampNewsConfig({ enrichTermsPerCycle: 1, kbSources: ["simple-wikipedia"] });
  const { ctx } = await makeCtx({ config });
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["rottnest", 2]]), "item1", FIXED_NOW, new Map());
  ctx.state.ledger = ledgerPayload(ledger);

  const summary = "A rottnest is an island. Rottnest has a lighthouse.";
  ctx.providers.getResearchProvider = ({ source }) => ({
    name: source,
    origin: "https://example.org",
    provenanceTag: (term) => `research:${source}:${term}`,
    async lookup(term) {
      return term === "rottnest"
        ? { term, title: "Rottnest", text: summary, summary, url: "https://x/rottnest", revid: 1, isa: "island" }
        : null;
    },
  });

  const result = await enrichTopTerms(ctx);
  assert.deepEqual(result.enriched, ["rottnest"]);
  const rows = readFactRows(await loadMemory(ctx.memoryDir)).filter((r) => r.subject === "rottnest");
  assert.ok(rows.some((r) => r.object === "island"), "the isa edge the source licensed is stored");
  assert.ok(
    rows.some((r) => r.predicate === "mgx:hasA" && r.object.includes("lighthouse")),
    `the article's own relation sentence is read too, not just its first line: ${JSON.stringify(rows.map((r) => `${r.predicate} ${r.object}`))}`,
  );

  const paragraph = renderNewsParagraph("rottnest", rows);
  assert.match(paragraph, /rottnest is an island/, "the paraphrase agrees its article with the word after it");
  assert.match(paragraph, /lighthouse/, "and it carries the relation the lookup found");
});

/** A KB source that answers nothing and reports why: `systemic` says whether
 *  each failure was the source struggling (a throttle or a timeout) or just
 *  an absent article. */
function countingKbSource(source, { systemic }) {
  const seen = { lookups: 0, systemicFailures: 0 };
  const provider = {
    name: source,
    origin: "https://example.org",
    provenanceTag: (term) => `research:${source}:${term}`,
    stats: () => ({ systemicFailures: seen.systemicFailures }),
    async lookup() {
      seen.lookups += 1;
      if (systemic) seen.systemicFailures += 1;
      return null;
    },
  };
  return { provider, seen };
}

function ledgerWith(counts) {
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map(counts), "item-1", FIXED_NOW, new Map());
  return ledgerPayload(ledger);
}

test("a KB source that keeps failing is skipped for the rest of the session, and the term it never reached waits instead of entering the negative cache", async () => {
  const threshold = SOURCE_BREAKER_DEFAULTS.failureThreshold;
  const terms = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].slice(0, threshold);
  const config = clampNewsConfig({ kbSources: ["wikidata"], enrichTermsPerCycle: threshold });
  const state = { ...createNewsState(), ledger: ledgerWith(terms.map((t, i) => [t, terms.length - i])) };
  const { ctx } = await makeCtx({ config, state });
  const { provider, seen } = countingKbSource("wikidata", { systemic: true });
  ctx.providers.getResearchProvider = () => provider;
  ctx.sourceBreakers = createSourceBreakerRegistry();

  const first = await enrichTopTerms(ctx);
  assert.deepEqual(first.skippedSources, [], "the source answered every term in the first cycle");
  assert.equal(seen.lookups, threshold, "each term cost one lookup");

  const ledger = ledgerFromPayload(ctx.state.ledger);
  bumpTerms(ledger, new Map([["omega", 9]]), "item-2", FIXED_NOW, new Map());
  ctx.state.ledger = ledgerPayload(ledger);

  const second = await enrichTopTerms(ctx);
  assert.equal(seen.lookups, threshold, "the failing source is never asked again");
  assert.deepEqual(second.skippedSources, ["wikidata"]);
  assert.deepEqual(second.missed, [], "a term nobody asked about is not a term nobody knows");
  assert.equal(
    ledgerFromPayload(ctx.state.ledger).terms.get("omega").status,
    "pending",
    "the term waits for a cycle that can actually reach a source",
  );
});

test("a KB source that simply has no article keeps being asked, however often it answers nothing", async () => {
  const rounds = SOURCE_BREAKER_DEFAULTS.failureThreshold * 2;
  const terms = Array.from({ length: rounds }, (_, i) => `term${i}`);
  const config = clampNewsConfig({ kbSources: ["wikidata"], enrichTermsPerCycle: 10 });
  const state = { ...createNewsState(), ledger: ledgerWith(terms.map((t, i) => [t, terms.length - i])) };
  const { ctx } = await makeCtx({ config, state });
  const { provider, seen } = countingKbSource("wikidata", { systemic: false });
  ctx.providers.getResearchProvider = () => provider;
  ctx.sourceBreakers = createSourceBreakerRegistry();

  const result = await enrichTopTerms(ctx);
  assert.equal(seen.lookups, rounds, "an empty answer is an answer, so the source stays in use");
  assert.deepEqual(result.skippedSources, []);
  assert.equal(result.missed.length, rounds, "and every term is honestly a miss");
});

test("an enrich turn says which source it stopped asking", async () => {
  const threshold = SOURCE_BREAKER_DEFAULTS.failureThreshold;
  const terms = Array.from({ length: threshold }, (_, i) => `term${i}`);
  const config = clampNewsConfig({ kbSources: ["wikidata"], enrichTermsPerCycle: threshold });
  const state = { ...createNewsState(), ledger: ledgerWith(terms.map((t, i) => [t, terms.length - i])) };
  const { ctx } = await makeCtx({ config, state });
  const { provider } = countingKbSource("wikidata", { systemic: true });
  ctx.providers.getResearchProvider = () => provider;
  ctx.sourceBreakers = createSourceBreakerRegistry();

  await enrichTopTerms(ctx);
  const ledger = ledgerFromPayload(ctx.state.ledger);
  bumpTerms(ledger, new Map([["omega", 9]]), "item-2", FIXED_NOW, new Map());
  ctx.state.ledger = ledgerPayload(ledger);

  const turn = await newsTurn("/news enrich", ctx);
  assert.match(turn.text, /Skipped wikidata\. That source kept failing, so this session stopped asking it\./);
  assert.equal(turn.miss, false, "a reported skip is information, not an empty turn");
});

test("enrichTopTerms with nothing pending is a clean no-op", async () => {
  const { ctx } = await makeCtx();
  const result = await enrichTopTerms(ctx);
  assert.deepEqual(result, { enriched: [], missed: [], aborted: false, skippedSources: [], facts: 0, derived: 0 });
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

test("buildFeed on a seed-only graph reads back empty rather than falling back to whole-graph concept cards", async () => {
  const { ctx } = await makeCtx();
  await appendFacts(ctx.memoryDir, [
    { subject: "volcano", predicate: "rdfs:subClassOf", object: "mountain", provenance: "corpus:test" },
    { subject: "volcano", predicate: "mgx:hasA", object: "lava", provenance: "corpus:test" },
  ]);
  const feed = await buildFeed(ctx);
  assert.deepEqual(feed.items, [], "nothing has been reported yet, so the gate has nothing to pass");
  assert.equal(feed.seedFallback, false, "the seed fallback has retired from the feed path");
});

test("buildFeed is deterministic: the same state and the same now render byte-identical feeds", async () => {
  const { ctx } = await makeCtx({ config: clampNewsConfig({ syllogismsPerIngest: 0 }) });
  const snapshot = snapshotFor("hacker-news", "1", "A module is a component.", "");
  await ingestNewsSnapshot(ctx, snapshot);

  const first = await buildFeed(ctx);
  const second = await buildFeed(ctx);
  assert.deepEqual(first, second);
});

test("buildFeed badges a card newName when the lexicon has no everyday-noun reading for its hub", async () => {
  const { ctx } = await makeCtx();
  await appendFacts(ctx.memoryDir, [
    { subject: "xyzzyplugh", predicate: "mgx:hasA", object: "new role", provenance: "news:src@1", observedAt: FIXED_NOW },
    { subject: "tariff", predicate: "mgx:hasA", object: "new schedule", provenance: "news:src@2", observedAt: FIXED_NOW },
  ]);
  const feed = await buildFeed(ctx);
  const unknown = feed.items.find((it) => it.hub === "xyzzyplugh");
  const known = feed.items.find((it) => it.hub === "tariff");
  assert.equal(unknown.newName, true, "the lexicon has never met this term");
  assert.equal(known.newName, false, "a lexicon noun is not badged as a new name");
});

test("filterRankedTermEntries drops a class object and a bare quantity, keeping every other entry", () => {
  const rows = [{ id: "seed:1", subject: "spider", predicate: "rdf:type", object: "animal" }];
  const entries = [
    { term: "animal", count: 3 },
    { term: "42000000", count: 2 },
    { term: "widget", count: 1 },
  ];
  assert.deepEqual(filterRankedTermEntries(rows, entries), [{ term: "widget", count: 1 }]);
});

test("/news rank never lists a function word, no matter how far its raw occurrence count would otherwise carry it", async () => {
  const state = createNewsState();
  const ledger = createTermLedger();
  bumpTerms(
    ledger,
    new Map([
      ["from", 500],
      ["and", 400],
      ["but", 300],
      ["very", 200],
      ["into", 100],
      ["about", 50],
      ["tariff", 1],
    ]),
    "item-1",
    FIXED_NOW,
  );
  state.ledger = ledgerPayload(ledger);
  const { ctx, close } = await makeCtx({ state });
  try {
    const { text } = await newsTurn("/news rank", ctx);
    assert.match(text, /tariff \(1\)/);
    for (const word of ["from", "and", "but", "very", "into", "about"]) {
      assert.doesNotMatch(text, new RegExp(`\\b${word} \\(`), `"${word}" must never rank as a news term`);
    }
  } finally {
    await close();
  }
});

test("/news rank never lists a bare measurement unit, compass abbreviation or foreign particle, but keeps u.s.", async () => {
  const state = createNewsState();
  const ledger = createTermLedger();
  bumpTerms(
    ledger,
    new Map([
      ["km", 9],
      ["m", 6],
      ["ssw", 4],
      ["de", 4],
      ["u.s.", 4],
      ["tariff", 1],
    ]),
    "item-1",
    FIXED_NOW,
  );
  state.ledger = ledgerPayload(ledger);
  const { ctx, close } = await makeCtx({ state });
  try {
    const { text } = await newsTurn("/news rank", ctx);
    assert.match(text, /tariff \(1\)/);
    assert.match(text, /u\.s\. \(4\)/);
    for (const word of ["km", "m", "ssw", "de"]) {
      assert.doesNotMatch(text, new RegExp(`\\b${word} \\(`), `"${word}" must never rank as a news term`);
    }
  } finally {
    await close();
  }
});

// ---- the newsworthiness gate (PLAN_NEWS_FEED.md section 17) ---------------
//
// The recorded Wikimedia fixture's own text ("A tariff is a tax imposed on
// imported goods and services.") only ever grounds an identity fact — real
// prose the strict recognizer can turn into a relation is what proves the
// gate lets a genuine report through, so this exercises the real
// ingestNewsSnapshot/appendFacts paths rather than the fixture's exact
// wording. `now` runs off the real clock: the strict recognizer's own
// assert-turn write (ingestText -> runTurn -> teachFact) stamps its OWN
// assertion with the wall clock regardless of the caller's `observedAt`, and
// a fixed simulated `now` would then read that stamp as outside the window.
test("buildFeed's gate: a research-tagged definition and an identity-only report never head a card, while a genuinely reported, anchored fact does", async () => {
  const { ctx } = await makeCtx({ now: () => new Date().toISOString() });

  // The enrichment loop's own provenance (PLAN_NEWS_FEED.md section 17.1): a
  // definition the graph looked up, stamped fresh, that used to enter the
  // window as though a source had reported it.
  await appendFacts(ctx.memoryDir, [
    { subject: "kilometre", predicate: "rdfs:subClassOf", object: "unit", provenance: "research:simple-wikipedia:kilometre" },
  ]);

  // One contemporary item: an identity-only sentence (the recorded fixture's
  // own shape) plus two relation sentences — one of them digit-anchored.
  const snapshot = snapshotFor(
    "wikimedia-featured", "1",
    "A tariff is a tax imposed on imported goods and services.",
    "Kumamoto is a city. Kumamoto has a population of 1738000.",
  );
  ctx.state.items = [snapshot];
  await ingestNewsSnapshot(ctx, snapshot);

  const feed = await buildFeed(ctx);
  assert.equal(feed.seedFallback, false, "a genuinely anchored reported fact takes the feed out of the seed fallback");

  const hubs = feed.items.map((it) => it.hub);
  assert.ok(!hubs.includes("kilometre"), `a research-tagged definition never heads a card: ${JSON.stringify(hubs)}`);
  assert.ok(!hubs.includes("tariff"), `an identity-only report never heads a card: ${JSON.stringify(hubs)}`);
  assert.ok(!hubs.includes("unit"), `a class term never heads a card: ${JSON.stringify(hubs)}`);
  assert.ok(!hubs.includes("city"), `a class term never heads a card: ${JSON.stringify(hubs)}`);
  assert.ok(hubs.includes("kumamoto"), `a genuinely reported, digit-anchored fact heads its own card: ${JSON.stringify(hubs)}`);

  for (const item of feed.items) {
    const reportedCount = item.factIds.length - item.background.length;
    assert.ok(reportedCount > 0, `card "${item.hub}" carries at least one reported fact id: ${JSON.stringify(item)}`);
  }

  const kumamotoItem = feed.items.find((it) => it.hub === "kumamoto");
  assert.ok(kumamotoItem.sources.some((s) => s.url), "the Kumamoto item carries its source link");
  assert.ok(kumamotoItem.background.length > 0, "the identity fact rides along as background, not as its own card");
  assert.equal(kumamotoItem.paragraph, "kumamoto has population of 1738000. kumamoto is a city.", "the report leads and the identity clause follows it");
  assert.ok(!kumamotoItem.paragraph.includes("tariff"), "an unrelated identity-only report never leaks into another card's background");
});

test("buildFeed's card carries its source's publication date when the snapshot has one, and none when it doesn't", async () => {
  const { ctx } = await makeCtx({ now: () => FIXED_NOW });

  const dated = normalizeFeedItems("usgs-quakes", [{
    guid: "eq1", title: "A quake struck near Wana.", url: "https://example.com/usgs/eq1",
    summary: "Wana is a place. An earthquake struck near Wana.", publishedAt: "2026-08-07T09:00:00.000Z",
  }], { now: FIXED_NOW })[0];
  const undated = snapshotFor("hacker-news", "1", "Hackernews discusses a widget.", "A widget is a gadget for widgeteers.");

  ctx.state.items = [dated, undated];
  await ingestNewsSnapshot(ctx, dated);
  await ingestNewsSnapshot(ctx, undated);

  const feed = await buildFeed(ctx);
  const wanaItem = feed.items.find((it) => it.hub === "wana");
  assert.ok(wanaItem, `the dated snapshot heads its own card: ${JSON.stringify(feed.items.map((it) => it.hub))}`);
  assert.equal(wanaItem.sources[0].publishedAt, "2026-08-07T09:00:00.000Z");

  const widgetItem = feed.items.find((it) => it.hub === "widget" || it.hub === "gadget");
  if (widgetItem) {
    assert.ok(!Object.hasOwn(widgetItem.sources[0], "publishedAt"), "an undated snapshot's source carries no publishedAt key");
  }
});

test("buildFeed's card carries the item's own headline and description, so a reader can check the graph's sentences against the report", async () => {
  const { ctx } = await makeCtx({ now: () => FIXED_NOW });
  const snapshot = normalizeFeedItems("usgs-quakes", [{
    guid: "eq1", title: "M 4.6 - 14 km NE of Wana, Pakistan", url: "https://example.com/usgs/eq1",
    summary: "An earthquake struck near Wana.", publishedAt: "2026-08-07T09:00:00.000Z",
  }], { now: FIXED_NOW })[0];

  ctx.state.items = [snapshot];
  await ingestNewsSnapshot(ctx, snapshot);

  const feed = await buildFeed(ctx);
  const quakeItem = feed.items.find((it) => it.sources.some((s) => s.url === "https://example.com/usgs/eq1"));
  assert.equal(quakeItem.sources[0].title, "M 4.6 - 14 km NE of Wana, Pakistan");
  assert.equal(quakeItem.sources[0].summary, "An earthquake struck near Wana.");
});

test("buildFeed's card cuts an over-long description at a word boundary rather than carrying a whole article into the feed document", async () => {
  const { ctx } = await makeCtx({ now: () => FIXED_NOW });
  const longSummary = `An earthquake struck near Wana. ${"The tremor was felt widely across the district. ".repeat(20)}`;
  const snapshot = normalizeFeedItems("usgs-quakes", [{
    guid: "eq1", title: "M 4.6 - 14 km NE of Wana, Pakistan", url: "https://example.com/usgs/eq1",
    summary: longSummary, publishedAt: "2026-08-07T09:00:00.000Z",
  }], { now: FIXED_NOW })[0];

  ctx.state.items = [snapshot];
  await ingestNewsSnapshot(ctx, snapshot);

  const quakeItem = (await buildFeed(ctx)).items
    .find((it) => it.sources.some((s) => s.url === "https://example.com/usgs/eq1"));
  const carried = quakeItem.sources[0].summary;
  assert.ok(carried.length <= 401, `the carried description is bounded: ${carried.length}`);
  assert.ok(carried.endsWith("…"), "a cut description says it was cut");
  assert.ok(!/\s…$/.test(carried), "the cut lands on a word, not a trailing space");
  assert.ok(longSummary.startsWith(carried.slice(0, -1)), "what is carried is the report's own opening words, unrewritten");
});

test("buildFeed's gate: a card the optimistic tier only reached off an identifier-shaped token never heads, while a clean report from the same poll still does", async () => {
  // A live wall clock, not FIXED_NOW: this sentence grounds through the
  // strict recognizer's own assert-lane write for one of its facts, which
  // stamps its own record with the real clock regardless of the ctx's own
  // `now` — a frozen historical `now` would then read that record as
  // observed in the future and band it background for reasons that have
  // nothing to do with this test.
  const { ctx } = await makeCtx({ now: () => new Date().toISOString() });
  const snapshot = snapshotFor(
    "hacker-news", "1",
    "Talks Resume Over Ceasefire Terms",
    "The site uses normalizeFeedItems for parsing.",
  );
  ctx.state.items = [snapshot];
  await ingestNewsSnapshot(ctx, snapshot);

  const rows = await ctx.store.readFactRows(await ctx.store.loadMemory(ctx.memoryDir));
  const tainted = rows.find((r) => r.subject === "site" && r.object === "normalizefeeditems");
  assert.ok(tainted, "the identifier-shaped sentence grounds and stores");
  assert.ok(tainted.extraction?.includes("identifier-token"), "its assertion carries the identifier-token finding");

  const feed = await buildFeed(ctx);
  const hubs = feed.items.map((it) => it.hub);
  assert.ok(!hubs.includes("normalizefeeditems"), `an identifier-token row never heads a card: ${JSON.stringify(hubs)}`);
  assert.ok(!hubs.includes("site"), `the same declined row cannot head via its other endpoint either: ${JSON.stringify(hubs)}`);
  assert.ok(hubs.includes("talks") || hubs.includes("ceasefire terms"), `a clean report from the same poll still heads: ${JSON.stringify(hubs)}`);
});

test("articleEntityNames reads the whole names an article's text carries and drops the everyday nouns beside them", () => {
  const names = articleEntityNames(['Tim King, AmigaDOS developer, has died', 'Hackernews discusses "Tim King, AmigaDOS developer, has died".']);
  assert.ok(names.includes("amigados"), `the headline's entity survives whole: ${JSON.stringify(names)}`);
  assert.ok(names.includes("tim king"), `a two-word name stays one term: ${JSON.stringify(names)}`);
  assert.ok(!names.includes("developer"), `an everyday noun names no entity: ${JSON.stringify(names)}`);
  assert.deepEqual(names, [...names].sort(), "the names come back in a fixed order");
});

test("articleEntityNames drops a word the article only ever uses as a clause's verb", () => {
  const names = articleEntityNames([
    "A Syrian Holdout Province, Sweida, Fears a Government Takeover",
    "In Sweida Province, dominated by the country's Druse minority, many say it is just a matter of "
      + "time before the central government moves to assert control over the region.",
  ]);
  assert.ok(!names.includes("say"), `"many say" is the article speaking, not a name: ${JSON.stringify(names)}`);
  assert.ok(!names.includes("moves"), `"moves to assert" is the government moving, not a name: ${JSON.stringify(names)}`);
  assert.ok(names.includes("sweida province"), `the place the report is about survives: ${JSON.stringify(names)}`);
  assert.ok(names.includes("druse"), `the minority it names survives: ${JSON.stringify(names)}`);
  assert.ok(names.includes("government takeover"), `the headline's own compound survives: ${JSON.stringify(names)}`);
});

test("buildFeed's card carries what the graph holds about an entity named inside its headline, not only its own facts' endpoints", async () => {
  const { ctx } = await makeCtx({ now: () => FIXED_NOW });

  // What an enrichment lookup on the headline's own entity already wrote.
  await appendFacts(ctx.memoryDir, [
    { subject: "amigados", predicate: "rdf:type", object: "disk operating system", provenance: "research:wikidata:amigados" },
    { subject: "amigados", predicate: "mgx:partOf", object: "amigaos", provenance: "research:wikidata:amigados" },
  ]);

  // Two stories from the same site, so the site itself is a publication rather
  // than a card title and the first card stays headed by its quoted headline.
  const died = snapshotFor("hacker-news", "1", "Tim King, AmigaDOS developer, has died", 'Hackernews discusses "Tim King, AmigaDOS developer, has died".');
  const rewrite = snapshotFor("hacker-news", "2", "A Rust compiler rewrite", 'Hackernews discusses "A Rust compiler rewrite".');
  ctx.state.items = [died, rewrite];
  await ingestNewsSnapshot(ctx, died);
  await ingestNewsSnapshot(ctx, rewrite);

  const feed = await buildFeed(ctx);
  const card = feed.items.find((it) => it.sources.some((s) => s.url === died.url));
  assert.ok(card, `the story mints a card: ${JSON.stringify(feed.items.map((it) => it.hub))}`);
  assert.match(card.backgroundParagraph, /amigados is a disk operating system/);
  assert.match(card.backgroundParagraph, /amigados is part of amigaos/);
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
