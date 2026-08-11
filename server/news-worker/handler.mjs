// handler.mjs — the news worker: runs poll/enrich/ingest cycles and the feed
// materializer against a session's own row partition. `createNewsWorker` is
// the engine-neutral core: it builds the same ctx shape the in-page news
// session built (news.mjs's own documented contract) over an injected row
// backend instead of an in-memory store, and calls the SAME
// pollNewsSources/enrichTopTerms/buildFeed the page called — no engine
// change, only a different memoryDir.
//
// `local.mjs` wires this core over the reference row backend with
// fixture-injected fetchers, the double every later test runs against. The
// AWS Lambda entry below (`handler`, esbuild bundles this file directly)
// wires it over the real DynamoDB backend, the real news fetchers and KB
// providers, and a shared per-source courtesy throttle kept in the table's
// own `_meta` partition so every invocation of every session paces the same
// source together, not once per invocation.

import {
  wrapRowBackend, wrapRowBackendOverSqliteSeed, openSqliteSeedStore,
  loadMemory, readFactRows, appendFacts, removeFacts,
} from "../../src/adapters/memory/core.mjs";
import { createDynamoRowBackend } from "../../src/adapters/memory/row-backend-dynamo.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";
import { ingestText } from "../../src/services/extract-facts.mjs";
import { isNewsProvenance } from "../../src/domain/news-feed.mjs";
import { factSentence } from "../../src/domain/fact-phrase.mjs";
import {
  resolveNewsConfig, createNewsState, pollNewsSources, enrichTopTerms, buildFeed,
  ingestUploadedFactRows, filterRankedTermEntries,
} from "../../src/services/news.mjs";
import { rankedTerms, ledgerFromPayload } from "../../src/domain/term-ledger.mjs";
import { createNewsFetcher, newsSourceRecords, normalizeNewsSourceIds } from "../../src/adapters/corpus/news-sources.mjs";
import { getResearchProvider } from "../../src/adapters/corpus/wikipedia-live.mjs";
import { DEFAULT_MIN_INTERVAL_MS } from "../../src/adapters/corpus/courtesy.mjs";

export const MAX_FACT_LINES_PER_CARD = 24;
export const MAX_FEED_DOCUMENT_BYTES = 350 * 1024;
export const DEFAULT_WORKER_BUDGET_MS = 20_000;
export const DEFAULT_CYCLE_STALE_MS = 5 * 60_000;
export const RANKED_TERMS_LIMIT = 20;
const RANK_OVERFETCH = 4;
const REQUEST_LOG_KEPT = 50;
const REQUEST_LOG_IN_FEED = 20;

const META_NEWS_STATE_KEY = "newsState";
export const META_CYCLE_KEY = "cycle";
export const META_FEED_KEY = "feed";
export const META_FEED_VERSION_KEY = "feedVersion";
export const META_GRAPH_VERSION_KEY = "graphVersion";
const META_SEED_STAMP_KEY = "seedStamp";

function isoNow() {
  return new Date().toISOString();
}

function safeJsonParse(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

async function readIntMeta(backend, key) {
  const n = Number(await backend.readMeta(key));
  return Number.isFinite(n) ? n : 0;
}

/** Reads-then-writes a meta counter by one and returns the new value. Not
 *  atomic — the row backend's meta contract is a plain string upsert with no
 *  numeric primitive — but every writer of one session's `graphVersion` or
 *  `feedVersion` is itself serialized behind the trigger routes' one-running-
 *  cycle lock, so a read-then-write is the whole of what this needs. */
async function bumpIntMeta(backend, key) {
  const next = (await readIntMeta(backend, key)) + 1;
  await backend.putMeta(key, String(next));
  return next;
}

function trimmedRequestLog(log) {
  return Array.isArray(log) ? log.slice(0, REQUEST_LOG_KEPT) : [];
}

function trimStateForPersistence(state) {
  return { ...state, requestLog: trimmedRequestLog(state.requestLog) };
}

/** The store triple every news.mjs call takes, folding `readFactRows` once
 *  per write epoch the same way the in-page session did. `graphVersion`
 *  bumps once per cycle instead — most of the engine's own writes go
 *  through `ingestText` directly against `memoryDir`, never through this
 *  wrapper, so a per-call hook here would miss them; `runCycle` bumps it
 *  itself once it knows whether the cycle's own result actually wrote
 *  anything. */
function foldingStore() {
  let foldedRows = null;
  return {
    loadMemory,
    readFactRows(memory) {
      if (!foldedRows) foldedRows = readFactRows(memory);
      return foldedRows;
    },
    async appendFacts(...args) {
      foldedRows = null;
      return appendFacts(...args);
    },
    async removeFacts(...args) {
      foldedRows = null;
      return removeFacts(...args);
    },
  };
}

const megabytes = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

export const DEFAULT_HEARTBEAT_MS = 15_000;

/** A line every `heartbeatMs` for as long as a phase is running, so a cycle
 *  that is going to run out of time says so while it still has time to say it.
 *  A phase only narrates when it finishes, and a phase that never finishes
 *  reads in CloudWatch exactly like a cycle that never started. */
function narrateWhileRunning(log, phase, heartbeatMs) {
  if (!(heartbeatMs > 0)) return () => {};
  const startedMs = Date.now();
  const timer = setInterval(() => {
    log({ event: "phase-running", phase, ms: Date.now() - startedMs, heapMb: megabytes(process.memoryUsage().heapUsed) });
  }, heartbeatMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}

/** What a cycle cost in memory. `maxRSS` is the kernel's own high-water mark,
 *  the number a Lambda's memory ceiling is actually measured against; the heap
 *  peak is sampled, because the peak lands in the middle of a phase (assembling
 *  a payload) rather than at the boundaries a phase log would catch. The growth
 *  figures are what a budget assertion reads: they hold whatever the process
 *  was already carrying before this cycle out of the number. */
function startMemoryWatch({ intervalMs = 100 } = {}) {
  const baselineHeapBytes = process.memoryUsage().heapUsed;
  const baselineMaxRssKb = process.resourceUsage().maxRSS;
  let peakHeapBytes = baselineHeapBytes;
  const sample = () => {
    const { heapUsed } = process.memoryUsage();
    if (heapUsed > peakHeapBytes) peakHeapBytes = heapUsed;
  };
  const timer = setInterval(sample, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return {
    sample,
    stop() {
      clearInterval(timer);
      sample();
      const maxRssKb = process.resourceUsage().maxRSS;
      return {
        peakHeapMb: megabytes(peakHeapBytes),
        heapGrowthMb: megabytes(peakHeapBytes - baselineHeapBytes),
        maxRssMb: megabytes(maxRssKb * 1024),
        maxRssGrowthMb: megabytes((maxRssKb - baselineMaxRssKb) * 1024),
      };
    },
  };
}

/** Whether a cycle's own result touched the graph, read off the counts
 *  poll/enrich/ingest already return — true for any fact written, derived,
 *  or evicted. */
function cycleWroteFacts(cycleResult) {
  return (cycleResult?.facts || 0) > 0 || (cycleResult?.derived || 0) > 0 || (cycleResult?.evicted || 0) > 0;
}

/** Wraps a fetchers map so every fetch asks the shared per-source gate
 *  first. A refused fetch reads as "nothing new this round" (the same shape
 *  a real 304 gives pollNewsSources) rather than a failure — a courtesy
 *  skip is not the source's fault and must never count against its health. */
function gatedFetchers(fetchersById, sourceGate) {
  if (!sourceGate) return fetchersById;
  const gated = new Map();
  for (const [id, fetcher] of fetchersById) {
    gated.set(id, {
      id: fetcher.id,
      async fetchItems() {
        const allowed = await sourceGate.shouldFetch(id);
        if (!allowed) return { items: [], bytes: 0, notModified: true };
        let outcome = null;
        try { outcome = await fetcher.fetchItems(); } catch { outcome = null; }
        await sourceGate.noteOutcome(id, outcome !== null);
        return outcome;
      },
    });
  }
  return gated;
}

function sourcesFromPollResult(list) {
  const out = {};
  for (const entry of list || []) out[entry.sourceId] = { status: entry.status, newItems: entry.newItems || 0 };
  return out;
}

/** The teach panel's server-side path: the same `ingestText`/
 *  `ingestUploadedFactRows` the page ran in-page, run once against this
 *  invocation's ctx. */
async function runIngest(ctx, body) {
  const { memoryDir, store, lexicon, now } = ctx;
  const nowVal = typeof now === "function" ? now() : now;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text) {
    const result = await ingestText(text, {
      memoryDir, sourceTag: `teach:upload:ingest-trigger@${nowVal}`, optimistic: true, lexicon, observedAt: nowVal, findings: true,
    });
    return { facts: result.extracted.length + result.optimistic.length, aborted: false };
  }
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const downgraded = ingestUploadedFactRows(rows, { fileLabel: "ingest-trigger", now: nowVal })
    .filter((r) => r.subject && r.predicate && r.object);
  if (downgraded.length) await store.appendFacts(memoryDir, downgraded);
  return { facts: downgraded.length, aborted: false };
}

/** One card, trimmed to the display bound: the first `MAX_FACT_LINES_PER_CARD`
 *  fact sentences in the card's own deterministic order, with the full count
 *  carried alongside so a trimmed card can say "…and N more" rather than
 *  pretend completeness. */
export function serializeCard(item, rowsById) {
  const factLines = item.factIds.map((id) => rowsById.get(id)).filter(Boolean).map((row) => factSentence(row));
  const observedMs = Date.parse(item.builtAt);
  return {
    id: item.id,
    hub: item.hub,
    paragraph: item.paragraph,
    tier: item.tier,
    newName: item.newName,
    sources: item.sources,
    backgroundParagraph: item.backgroundParagraph,
    factLines: factLines.slice(0, MAX_FACT_LINES_PER_CARD),
    factCount: factLines.length,
    observedMs: Number.isFinite(observedMs) ? observedMs : 0,
    changedCount: item.changedCount,
  };
}

export function feedDocumentBytes(document) {
  return Buffer.byteLength(JSON.stringify(document), "utf8");
}

/** The 350 KB enforced bound: when the ordinary 24-line-per-card trim still
 *  is not enough, whole cards' `factLines` drop from the feed's own tail
 *  upward — deterministic, since the items are already sorted — until the
 *  document fits. `trimmed: true` marks the document whenever this runs, so
 *  a reader can tell a trimmed card from a genuinely quiet one. */
export function enforceFeedSizeBound(document) {
  if (feedDocumentBytes(document) <= MAX_FEED_DOCUMENT_BYTES) return document;
  const items = document.items.map((item) => ({ ...item }));
  let index = items.length - 1;
  let candidate = { ...document, items, trimmed: true };
  while (feedDocumentBytes(candidate) > MAX_FEED_DOCUMENT_BYTES && index >= 0) {
    if (items[index].factLines.length) items[index] = { ...items[index], factLines: [] };
    index -= 1;
    candidate = { ...document, items, trimmed: true };
  }
  return candidate;
}

/** The materialized feed document (the plan's own §3.22 shape): every card,
 *  tile stat, ranked term and status line the page renders, so the page
 *  computes nothing. Runs at the end of every cycle and standalone in
 *  "materialize" mode — load rows, build, write, bump, nothing fetched. */
async function materializeFeed(ctx, rawBackend) {
  const { memoryDir, store, config, state } = ctx;
  const nowVal = typeof ctx.now === "function" ? ctx.now() : ctx.now;
  const feedBuild = await buildFeed(ctx);
  const memory = await store.loadMemory(memoryDir);
  const rows = store.readFactRows(memory);
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  let factsFromNews = 0;
  for (const row of rows) if (isNewsProvenance(row.provenance)) factsFromNews += 1;

  const items = feedBuild.items.map((item) => serializeCard(item, rowsById));

  const ledger = ledgerFromPayload(state.ledger);
  const rankedRaw = rankedTerms(ledger, {
    limit: RANKED_TERMS_LIMIT * RANK_OVERFETCH, now: nowVal, ttlMs: config.negativeCacheTtlHours * 3600000,
  });
  const rankedTermsOut = filterRankedTermEntries(rows, rankedRaw).slice(0, RANKED_TERMS_LIMIT);

  const document = enforceFeedSizeBound({
    items,
    rankedTerms: rankedTermsOut,
    stats: { graphSize: rows.length, factsFromNews },
    sourceStatus: state.health || [],
    requestLog: trimmedRequestLog(state.requestLog).slice(0, REQUEST_LOG_IN_FEED),
    builtAt: feedBuild.builtAt,
  });

  await rawBackend.putMeta(META_FEED_KEY, JSON.stringify(document));
  const version = await bumpIntMeta(rawBackend, META_FEED_VERSION_KEY);
  return { version, trimmed: !!document.trimmed };
}

/** The engine-neutral core every worker entry point wires up: the same
 *  `{ runCycle }` shape whether the session backend is the reference double
 *  or real DynamoDB, whether the fetchers are fixtures or the real registry.
 *
 *  `createSessionBackend(sessionKey)` — a §3.1 row backend for this session.
 *  `createFetchers(config)` — sourceId -> `{ id, fetchItems() }`, built fresh
 *  per cycle so a narrowed `body.sources` (poll) takes effect.
 *  `getResearchProvider({ source })` — the KB lookup seam enrich walks.
 *  `seedPayload` — the base payload `loadMemory` overlays session rows onto
 *  (the full xl seed in production; §3.22's grounding-parity reasoning).
 *  `seedStore` — the same seed held as an open read-only sqlite store
 *  (`openSqliteSeedStore`), which the cycle reads instead of a parsed payload:
 *  the seed's rows never exist as a row array and the write path never projects
 *  them, so one cycle holds one assembled copy of the graph rather than three.
 *  Takes precedence over `seedPayload` when both are set.
 *  `seedStamp` — when set, a session whose own stamp disagrees is purged
 *  before this cycle runs, rather than mixing rows across seed versions.
 *  `sourceGate` — optional `{ shouldFetch(id), noteOutcome(id, ok) }`, the
 *  shared per-source courtesy throttle and breaker.
 *  `budgetMs`/`nowMs` — the abort-on-remaining-time budget: `shouldAbort`
 *  reads true once `nowMs()` crosses `nowMs() at entry + budgetMs`. */
export function createNewsWorker({
  createSessionBackend,
  createFetchers = () => new Map(),
  getResearchProvider: getProvider = () => null,
  seedPayload = null,
  seedStore = null,
  seedStamp = "",
  sourceGate = null,
  now = isoNow,
  nowMs = () => Date.now(),
  budgetMs = DEFAULT_WORKER_BUDGET_MS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  log = () => {},
} = {}) {
  if (typeof createSessionBackend !== "function") {
    throw new TypeError("createNewsWorker needs a createSessionBackend(sessionKey) function");
  }

  /** The cycle itself. `nowMs` stays the budget's clock alone — every timing
   *  the narration carries is wall clock, so a test driving the budget with a
   *  counted fake clock is not also driving the log. */
  async function runWatchedCycle({ sessionKey, cycleId, mode, body = {} }, memoryWatch) {
    const cycleStartedMs = Date.now();
    log({ event: "cycle-start", sessionKey, cycleId, mode, seed: seedStore ? "sqlite" : "json" });
    let rawBackend = await createSessionBackend(sessionKey);

    if (seedStamp) {
      const storedStamp = await rawBackend.readMeta(META_SEED_STAMP_KEY);
      if (storedStamp && storedStamp !== seedStamp) {
        await rawBackend.deleteAll();
        rawBackend = await createSessionBackend(sessionKey);
      }
      await rawBackend.putMeta(META_SEED_STAMP_KEY, seedStamp);
    }

    const handle = seedStore
      ? wrapRowBackendOverSqliteSeed(rawBackend, seedStore)
      : wrapRowBackend(rawBackend, { basePayload: seedPayload });
    const store = foldingStore();
    const config = resolveNewsConfig();
    if (Array.isArray(body?.sources) && body.sources.length) config.sources = normalizeNewsSourceIds(body.sources);

    const state = safeJsonParse(await rawBackend.readMeta(META_NEWS_STATE_KEY), null) || createNewsState();
    const deadlineMs = nowMs() + budgetMs;

    const ctx = {
      memoryDir: handle,
      store,
      cache: { rows: null },
      lexicon: loadLexicon(),
      config,
      state,
      providers: {
        // Only "poll" ever reads newsFetchers — building the map is not
        // free (one courtesy gate per source), so enrich/ingest/materialize
        // skip it entirely rather than build fetchers nothing will call.
        newsFetchers: mode === "poll" ? gatedFetchers(createFetchers(config), sourceGate) : new Map(),
        getResearchProvider: getProvider,
      },
      now,
      shouldAbort: () => nowMs() >= deadlineMs,
    };

    const marker = mode === "materialize" ? null : { cycleId, kind: mode, state: "running", startedAt: typeof now === "function" ? now() : now, sources: {} };

    let cycleResult = { aborted: false };
    let failure = null;
    const phaseStartedMs = Date.now();
    const stopPhaseNarration = narrateWhileRunning(log, mode, heartbeatMs);
    try {
      if (mode === "poll") {
        cycleResult = await pollNewsSources(ctx);
        if (marker) marker.sources = sourcesFromPollResult(cycleResult.sources);
      } else if (mode === "enrich") {
        cycleResult = await enrichTopTerms(ctx);
      } else if (mode === "ingest") {
        cycleResult = await runIngest(ctx, body);
      } else if (mode === "materialize") {
        cycleResult = { aborted: false };
      } else {
        throw new Error(`unknown news worker mode ${JSON.stringify(mode)}`);
      }
    } catch (error) {
      failure = error;
    }
    stopPhaseNarration();
    memoryWatch.sample();
    log({
      event: "phase-done", phase: mode, ms: Date.now() - phaseStartedMs,
      facts: cycleResult.facts || 0, aborted: !!cycleResult.aborted,
      ...(mode === "poll" ? { sources: sourcesFromPollResult(cycleResult.sources) } : {}),
      ...(failure ? { failed: failure.message } : {}),
    });

    if (!failure && cycleWroteFacts(cycleResult)) await bumpIntMeta(rawBackend, META_GRAPH_VERSION_KEY);
    await rawBackend.putMeta(META_NEWS_STATE_KEY, JSON.stringify(trimStateForPersistence(state)));

    let feedResult = null;
    if (!failure) {
      const materializeStartedMs = Date.now();
      const stopMaterializeNarration = narrateWhileRunning(log, "materialize", heartbeatMs);
      try {
        feedResult = await materializeFeed(ctx, rawBackend);
      } catch (error) {
        failure = error;
      }
      stopMaterializeNarration();
      memoryWatch.sample();
      log({
        event: "phase-done", phase: "materialize", ms: Date.now() - materializeStartedMs,
        ...(feedResult ? { feedVersion: feedResult.version, trimmed: feedResult.trimmed } : {}),
        ...(failure ? { failed: failure.message } : {}),
      });
    }

    if (marker) {
      await rawBackend.putMeta(META_CYCLE_KEY, JSON.stringify({
        ...marker,
        state: failure ? "failed" : (cycleResult.aborted ? "done-partial" : "done"),
        finishedAt: typeof now === "function" ? now() : now,
        ...(failure ? { reason: failure.message } : {}),
      }));
    }

    log({
      event: "cycle-end", sessionKey, cycleId, mode,
      aborted: !!cycleResult.aborted, failed: !!failure,
      ms: Date.now() - cycleStartedMs,
      ...memoryWatch.stop(),
    });
    if (failure) throw failure;
    return { cycleId, mode, aborted: !!cycleResult.aborted, feedVersion: feedResult?.version };
  }

  async function runCycle(request) {
    const memoryWatch = startMemoryWatch();
    try {
      return await runWatchedCycle(request, memoryWatch);
    } finally {
      memoryWatch.stop();
    }
  }

  return { runCycle };
}

/** The in-memory shared per-source gate: one courtesy throttle and one
 *  breaker per source id, held across every `runCycle` call this process
 *  makes — the local double's analogue of the `_meta` items every real
 *  worker invocation shares through DynamoDB. */
export function createInMemorySourceGate({
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  failureThreshold = 3,
  cooldownMs = 5 * 60_000,
  nowMs = () => Date.now(),
} = {}) {
  const lastFetchAt = new Map();
  const breakers = new Map();
  return {
    async shouldFetch(id) {
      const breaker = breakers.get(id);
      if (breaker?.open && nowMs() - breaker.openedAt < cooldownMs) return false;
      const last = lastFetchAt.get(id) || 0;
      if (nowMs() - last < minIntervalMs) return false;
      lastFetchAt.set(id, nowMs());
      return true;
    },
    async noteOutcome(id, ok) {
      if (ok) { breakers.delete(id); return; }
      const breaker = breakers.get(id) || { failures: 0, open: false, openedAt: 0 };
      breaker.failures += 1;
      if (breaker.failures >= failureThreshold) { breaker.open = true; breaker.openedAt = nowMs(); }
      breakers.set(id, breaker);
    },
  };
}

// ---------------------------------------------------------------------------
// The AWS entry point. Bundled directly as the worker Lambda's code
// (`npm run build:news-worker`), invoked asynchronously by the row service's
// trigger routes (event mode) or by the turn handler (materialize mode).

/** What the abort budget leaves behind for everything that happens AFTER a
 *  phase gives up: the eviction sweep's own read and write, the news-state
 *  write, the whole feed materialization, and the two log lines that say what
 *  the cycle did. Over a seed-sized graph each of those is seconds, so a margin
 *  sized for a fixture leaves a real cycle killed mid-tail — narrating nothing
 *  at all, which is how a timed-out cycle reads exactly like a cycle that never
 *  started. */
const WORKER_SAFETY_MARGIN_MS = 30_000;
const CORPUS_BREAKER_META_PARTITION_KEY = "_meta";

let cachedDynamoClientPromise = null;
async function loadDocumentClient() {
  if (!cachedDynamoClientPromise) {
    cachedDynamoClientPromise = (async () => {
      const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
      const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
      return DynamoDBDocumentClient.from(new DynamoDBClient({}));
    })();
  }
  return cachedDynamoClientPromise;
}

/** The full xl seed as JSON — the same payload `scripts/build-chat-seed.mjs`
 *  writes for the browser, read and parsed lazily so a test importing this
 *  module for `createNewsWorker` alone never touches a file that only exists
 *  after a build.
 *
 *  READ, never `import`: a static import specifier is one esbuild inlines into
 *  the bundle, which put 86 MB of JSON inside the handler that every cold start
 *  then paid to load — including the deployed one, which opens the sqlite seed
 *  below and never reads a byte of this. */
const XL_SEED_JSON_PATH = new URL("../../public/chat-seed.json", import.meta.url);
let cachedSeedPayloadPromise = null;
async function loadXlSeedPayload(seedPath = XL_SEED_JSON_PATH) {
  if (!cachedSeedPayloadPromise) {
    cachedSeedPayloadPromise = (async () => {
      const { readFile } = await import("node:fs/promises");
      return JSON.parse(await readFile(seedPath, "utf8"));
    })();
  }
  return cachedSeedPayloadPromise;
}

/** The same seed as a pre-built sqlite file, opened read-only once per
 *  execution environment: milliseconds, and no parse. The path comes from
 *  `TMCT_XL_SEED_SQLITE`; unset, the JSON import above stays the seed source,
 *  so a zip deploy keeps working until the image lands. */
let cachedSeedStorePromise = null;
function openXlSeedStore(dbPath) {
  if (!cachedSeedStorePromise) cachedSeedStorePromise = openSqliteSeedStore(dbPath);
  return cachedSeedStorePromise;
}

/** The worker's log seam wired to CloudWatch: one stamped line per entry, so a
 *  cycle's phases read in order and a failure has a time beside it. */
export function logToConsole(entry) {
  console.log(`${isoNow()} news-worker ${typeof entry === "string" ? entry : JSON.stringify(entry)}`);
}

function isConditionalCheckFailure(error) {
  return error?.name === "ConditionalCheckFailedException";
}

/** The shared per-source courtesy throttle and breaker over raw DynamoDB
 *  items, the same `_meta`-partition pattern the corpus breaker and the row
 *  service's own counters use: a conditional `UpdateCommand` settles every
 *  race between concurrent worker invocations touching the same source. */
function createDynamoSourceGate({ client, tableName, minIntervalMs = DEFAULT_MIN_INTERVAL_MS, failureThreshold = 3, cooldownMs = 5 * 60_000 }) {
  async function shouldFetch(id) {
    const { UpdateCommand, GetCommand } = await import("@aws-sdk/lib-dynamodb");
    const now = Date.now();
    const breakerItem = await client.send(new GetCommand({
      TableName: tableName, Key: { pk: CORPUS_BREAKER_META_PARTITION_KEY, sk: `breaker#source#${id}` }, ConsistentRead: true,
    }));
    const openedAt = breakerItem.Item?.openedAt;
    if (typeof openedAt === "number" && now - openedAt < cooldownMs) return false;
    try {
      await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: CORPUS_BREAKER_META_PARTITION_KEY, sk: `throttle#${id}` },
        UpdateExpression: "SET lastFetchAt = :now",
        ConditionExpression: "attribute_not_exists(lastFetchAt) OR lastFetchAt <= :floor",
        ExpressionAttributeValues: { ":now": now, ":floor": now - minIntervalMs },
      }));
      return true;
    } catch (error) {
      if (isConditionalCheckFailure(error)) return false;
      throw error;
    }
  }

  async function noteOutcome(id, ok) {
    const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    if (ok) {
      await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: CORPUS_BREAKER_META_PARTITION_KEY, sk: `breaker#source#${id}` },
        UpdateExpression: "REMOVE openedAt SET failures = :zero",
        ExpressionAttributeValues: { ":zero": 0 },
      }));
      return;
    }
    const now = Date.now();
    const result = await client.send(new UpdateCommand({
      TableName: tableName,
      Key: { pk: CORPUS_BREAKER_META_PARTITION_KEY, sk: `breaker#source#${id}` },
      UpdateExpression: "ADD failures :one",
      ExpressionAttributeValues: { ":one": 1 },
      ReturnValues: "UPDATED_NEW",
    }));
    if ((result.Attributes?.failures || 0) >= failureThreshold) {
      await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: CORPUS_BREAKER_META_PARTITION_KEY, sk: `breaker#source#${id}` },
        UpdateExpression: "SET openedAt = :now",
        ExpressionAttributeValues: { ":now": now },
      }));
    }
  }

  return { shouldFetch, noteOutcome };
}

function buildRealFetchers(config, { fetchImpl = (...args) => globalThis.fetch(...args), now = isoNow } = {}) {
  const validators = new Map();
  const fetchersById = new Map();
  for (const id of normalizeNewsSourceIds(config.sources)) {
    const record = newsSourceRecords().find((r) => r.id === id);
    if (!record) continue;
    fetchersById.set(id, createNewsFetcher(record, { fetchImpl, validators, now }));
  }
  return fetchersById;
}

function newsWorkerConfigFromEnv() {
  const ttlDays = process.env.TTL_DAYS ? Number(process.env.TTL_DAYS) : 7;
  return {
    tableName: process.env.TABLE_NAME,
    ttlSeconds: ttlDays * 86400,
    seedStamp: process.env.SEED_STAMP || "",
    seedSqlitePath: process.env.TMCT_XL_SEED_SQLITE || "",
  };
}

/** The Lambda entry point esbuild bundles. `event` is `{ sessionKey, cycleId,
 *  mode, body }` — the async-invoke payload the row service's trigger routes
 *  (or the turn handler, for `mode: "materialize"`) send. The abort budget
 *  reads the invocation's own remaining time, minding a safety margin so the
 *  cycle stops between whole units of work before the runtime kills it. */
export const handler = async (event, context) => {
  const { tableName, ttlSeconds, seedStamp, seedSqlitePath } = newsWorkerConfigFromEnv();
  const initStartedMs = Date.now();
  const coldSeed = seedSqlitePath ? !cachedSeedStorePromise : !cachedSeedPayloadPromise;
  const client = await loadDocumentClient();
  const seedStore = seedSqlitePath ? await openXlSeedStore(seedSqlitePath) : null;
  const seedPayload = seedStore ? null : await loadXlSeedPayload();
  logToConsole({
    event: "init-done", seed: seedStore ? "sqlite" : "json", cold: coldSeed, ms: Date.now() - initStartedMs,
  });
  const remainingMs = typeof context?.getRemainingTimeInMillis === "function"
    ? context.getRemainingTimeInMillis()
    : DEFAULT_WORKER_BUDGET_MS + WORKER_SAFETY_MARGIN_MS;

  const worker = createNewsWorker({
    createSessionBackend: (sessionKey) => createDynamoRowBackend({ client, tableName, sessionKey, softDelete: true, ttlSeconds }),
    createFetchers: (config) => buildRealFetchers(config, {}),
    getResearchProvider: ({ source } = {}) => getResearchProvider({ source }),
    seedPayload,
    seedStore,
    seedStamp,
    sourceGate: createDynamoSourceGate({ client, tableName }),
    budgetMs: Math.max(1000, remainingMs - WORKER_SAFETY_MARGIN_MS),
    log: logToConsole,
  });

  return worker.runCycle({
    sessionKey: event.sessionKey, cycleId: event.cycleId, mode: event.mode, body: event.body || {},
  });
};
