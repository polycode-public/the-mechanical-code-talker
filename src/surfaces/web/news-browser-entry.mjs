// news-browser-entry.mjs — the esbuild entry for news.html's engine
// (public/news-browser.bundle.js, built by scripts/build-news-bundle.mjs).
//
// news.html is the scheduled-ingestion demo: one in-memory Backend-B store,
// seeded from chat-seed.json exactly as chat.html and research.html are,
// that then grows through the news capability (src/services/news.mjs) —
// polling contemporary sources, ranking what does not ground, walking
// knowledge-base sources to close the gap, and building the fact-churn feed —
// all over the SAME library contract the CLI's `tmct news` verb runs.
//
// The one rule every method below honours: NOTHING here calls a fetcher
// until the visitor presses something. `start()` (or a returning visit's own
// `start()` replay) is the press that also arms the recurring timer;
// `poll()`/`pollOnce()`/`enrich()`/`addSource()` each run one round of
// requests on their own press and schedule nothing, the same reasoning that
// lets pasting a URL and pressing "add" authorise its own preflight;
// `replayFixture()` never touches the network at all — it re-runs the exact
// ingest pipeline over an already-downloaded fixture body.
//
// The start-consent PREFERENCE (which localStorage key, and whether to persist
// at all) is a page concern, not this session's — the same split
// chat-page-viz.mjs's own WIKI_MODE_KEY draws between the page's own storage
// and chat-browser-entry.mjs's pure session. `prefs` here defaults to a real
// localStorage-backed store when one exists (so a caller doing nothing extra
// still gets persistence), and is fully injectable for tests, which never
// touch a real browser storage API.
//
// Gitignored, Pages-demo-site-only output — scripts/build-demo-site.mjs will
// build it fresh on every deploy once news.html joins DEMO_PAGES (a later
// round), never committed, the same posture every sibling *-browser-entry.mjs
// documents for its own output.

import { createInMemoryStore, applySeedPayload, loadMemory, readFactRows, appendFacts, removeFacts, normFactTerm, normFactPredicate } from "../../adapters/memory/core.mjs";
import { factIdFor } from "../../domain/hash.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { ingestText, setIngestYield } from "../../services/extract-facts.mjs";
import { isNewsProvenance } from "../../domain/news-feed.mjs";
import {
  resolveNewsConfig, createNewsState, pollNewsSources, enrichTopTerms, buildFeed,
  ingestUploadedFactRows, isVocabGroundedTerm, filterRankedTermEntries,
} from "../../services/news.mjs";
import { rankedTerms, ledgerFromPayload, bumpTerms, ledgerPayload } from "../../domain/term-ledger.mjs";
import {
  newsSourceRecords, normalizeNewsSourceIds, createNewsFetcher, preflightNewsUrl, registerNewsSource,
} from "../../adapters/corpus/news-sources.mjs";
import { detectFeedFormat, parseFeed, normalizeFeedItems, stripMarkup } from "../../domain/feed-normalize.mjs";
import { DEFAULT_MIN_INTERVAL_MS } from "../../adapters/corpus/courtesy.mjs";
import { getResearchProvider } from "../../adapters/corpus/wikipedia-live.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import { openPersistedStore } from "./idb-persist.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";

/** The localStorage key the shipped page persists start-consent under —
 *  exported so the page's own inline script and a test can both name it
 *  without retyping the string. */
export const NEWS_START_PREF_KEY = "tmct.news.started";

function localStoragePrefStore() {
  return {
    get(key) { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } },
    set(key, value) { try { globalThis.localStorage?.setItem(key, value); } catch { /* private mode — this visit still works */ } },
    remove(key) { try { globalThis.localStorage?.removeItem(key); } catch { /* already gone */ } },
  };
}

/** An in-memory stand-in for localStorage, used when no real one exists
 *  (every Node test, and any browser context with storage denied). */
function memoryPrefStore() {
  const map = new Map();
  return {
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => { map.set(key, value); },
    remove: (key) => { map.delete(key); },
  };
}

function resolveNowMs() {
  return Date.now();
}

function isoNow() {
  return new Date().toISOString();
}

const POLL_FLOOR_MINUTES = 5;

function clampPollMinutesLocal(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return POLL_FLOOR_MINUTES;
  const floored = Math.max(0, Math.floor(v));
  return floored === 0 ? 0 : Math.max(POLL_FLOOR_MINUTES, floored);
}

/** The wikimedia-feed body shape (`{ news: [...] }` or `{ mostread: {
 *  articles: [...] } }`) turned into the same raw-item shape
 *  createNewsFetcher's own network path builds — the pure half of that
 *  adapter's private fetchWikimediaFeed, restated here because a fixture
 *  replay never calls the network wrapper that owns it. Kept intentionally
 *  small: only the mapping a fixture-replay demo button needs, never the
 *  courtesy-gated fetch itself. */
function wikimediaFixtureRawItems(body) {
  const articles = Array.isArray(body?.news)
    ? body.news.flatMap((story) => (Array.isArray(story?.links) ? story.links : []))
    : Array.isArray(body?.mostread?.articles)
      ? body.mostread.articles
      : [];
  return articles.map((a) => ({
    guid: a?.wikibase_item || a?.normalizedtitle || a?.title || "",
    title: stripMarkup(a?.normalizedtitle || a?.displaytitle || a?.title || ""),
    url: a?.content_urls?.desktop?.page || "",
    summary: stripMarkup(a?.extract || ""),
    publishedAt: "",
  }));
}

/** A fixture body's raw items, for whichever wire shape the demo buttons
 *  ship: `format` names it explicitly so this never has to guess. */
function fixtureRawItems(format, body) {
  if (format === "wikimedia-feed") return wikimediaFixtureRawItems(body);
  return parseFeed(body, { format });
}

/**
 * The graph-growing session over the real news capability (news.mjs), pure
 * except for the fetches `start()`/`poll()`/`pollOnce()`/`enrich()`/
 * `addSource()` themselves trigger — each one a press the visitor made.
 *
 * Returns `{ memoryDir, phase, consented, busy, metrics, nextPollAt, config,
 * requestLog, health, start, poll, pollOnce, stopPolling, enrich, buildFeed,
 * stats, rank, addSource, setInterval, ingestText, ingestFile, replayFixture,
 * revokeConsent, destroy }`.
 */
export function createNewsSession({
  seedPayload = null, vocabSeeded = false, fetchImpl = null, now = isoNow,
  prefs = null, prefKey = NEWS_START_PREF_KEY, yieldToHost,
} = {}) {
  // Grounding one article is seconds of straight-line work, and the page has
  // only the one thread. A macrotask between candidates lets it paint, answer
  // a click and keep the "polling…" affordance honest instead of going
  // unresponsive mid-poll. A Node caller gets no yield and pays nothing.
  setIngestYield(yieldToHost === undefined
    ? (typeof document === "undefined" ? null : () => new Promise((resolve) => setTimeout(resolve, 0)))
    : yieldToHost);

  const memoryDir = createInMemoryStore();
  applySeedPayload(memoryDir, seedPayload);

  // Folding the seeded store is seconds of main-thread work in a browser,
  // and every session verb reads rows — uncached, a 30-item feed render
  // folds the whole store once per item and freezes the page for minutes.
  // One fold per write epoch keeps every read on the same rows.
  let foldedRows = null;
  const store = {
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
  const cache = { rows: null };
  let lexicon = loadLexicon();
  let config = resolveNewsConfig();
  const state = createNewsState();
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));

  const prefStore = prefs || (typeof globalThis !== "undefined" && globalThis.localStorage ? localStoragePrefStore() : memoryPrefStore());
  let consented = prefStore.get(prefKey) === "on";

  let phase = "seeded"; // the page-level "seeding" state (S0) precedes this session existing at all
  let timer = null;
  // Set by revokeConsent, cleared by the next action that puts content back.
  // While it holds, buildFeed answers with nothing rather than falling back to
  // the seed graph: a visitor who pressed "stop & forget" asked for an empty
  // feed, and seed-derived cards in its place read as articles that survived
  // the purge.
  let forgotten = false;
  // Raised by stopPolling(), lowered when the next cycle starts. The ingest
  // loops read it at their own awaited yield points, so a stop lands between
  // whole articles and never half-way through folding one.
  let stopRequested = false;
  let cycleRunning = false;
  const bootMs = resolveNowMs();
  const metrics = { timeToFirstArticleMs: null, timeToFirstCompletePollMs: null };
  let nextPollAt = "";

  const validators = new Map();
  const fetchersById = new Map();
  function rebuildFetchers() {
    fetchersById.clear();
    for (const id of normalizeNewsSourceIds(config.sources)) {
      const record = newsSourceRecords().find((r) => r.id === id);
      if (!record) continue;
      fetchersById.set(id, createNewsFetcher(record, { fetchImpl: doFetch, validators, now }));
    }
  }
  rebuildFetchers();

  const providers = {
    newsFetchers: fetchersById,
    getResearchProvider: ({ source } = {}) => getResearchProvider({ source }),
    preflightNewsUrl: (url) => preflightNewsUrl(url, { fetchImpl: doFetch }),
  };

  function ctx() {
    return { memoryDir, store, cache, lexicon, config, state, providers, now, shouldAbort: () => stopRequested };
  }

  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    nextPollAt = "";
  }

  function armTimer() {
    clearTimer();
    if (!consented || !config.pollMinutes) return;
    const delayMs = config.pollMinutes * 60000;
    nextPollAt = new Date(resolveNowMs() + delayMs).toISOString();
    timer = setTimeout(() => { runCycle({ armNext: true }).catch(() => {}); }, delayMs);
  }

  async function noteFirstArticle() {
    if (metrics.timeToFirstArticleMs !== null) return;
    const feed = await buildFeed(ctx());
    if (feed.items.length) metrics.timeToFirstArticleMs = resolveNowMs() - bootMs;
  }

  async function runPollCycle() {
    forgotten = false;
    cycleRunning = true;
    phase = "polling";
    const result = await pollNewsSources(ctx());
    // The cycle's ingest writes through core appendFact directly, never the
    // wrapping store, so the fold cache must drop here by hand.
    foldedRows = null;
    cache.rows = null;
    if (metrics.timeToFirstCompletePollMs === null) metrics.timeToFirstCompletePollMs = resolveNowMs() - bootMs;
    phase = "grounding";
    await noteFirstArticle();
    return result;
  }

  async function runEnrichCycle({ armNext = true } = {}) {
    forgotten = false;
    cycleRunning = true;
    phase = "enriching";
    const result = await enrichTopTerms(ctx());
    foldedRows = null;
    cache.rows = null;
    phase = "idle";
    cycleRunning = false;
    if (armNext) armTimer();
    return result;
  }

  /** One poll-then-enrich pass, with the stop flag lowered first so a cycle
   *  the visitor asked for is never cancelled by an older stop. `armNext`
   *  false runs the pass without scheduling another — what "poll once"
   *  means. */
  async function runCycle({ armNext } = {}) {
    stopRequested = false;
    try {
      const poll = await runPollCycle();
      const enrich = await runEnrichCycle({ armNext });
      return { poll, enrich };
    } finally {
      cycleRunning = false;
      stopRequested = false;
    }
  }

  return {
    memoryDir,
    get phase() { return phase; },
    get consented() { return consented; },
    get metrics() { return { ...metrics }; },
    get nextPollAt() { return nextPollAt; },
    get config() { return { ...config }; },
    get requestLog() { return state.requestLog; },
    get health() { return state.health; },

    /** First run: records the start-consent preference. Every run (first or
     *  a returning visit's own replay): one poll cycle, then one enrich
     *  cycle, then the timer arms for the next one — "poll on load" for a
     *  returning visit is exactly this same call. */
    async start() {
      consented = true;
      prefStore.set(prefKey, "on");
      return runCycle({ armNext: true });
    },

    /** One poll cycle, now, on its own: the click IS the authorisation for
     *  that one round of requests, the same way addSource's own preflight
     *  is. It never records the start preference and never schedules
     *  another, so "poll once" really does mean once. */
    async poll() {
      stopRequested = false;
      try {
        return await runPollCycle();
      } finally {
        cycleRunning = false;
        stopRequested = false;
      }
    },

    /** One poll-then-enrich pass on demand, scheduling nothing after it. */
    async pollOnce() {
      return runCycle({ armNext: false });
    },

    /** A manual "enrich now": one lookup round over the terms the feed could
     *  not ground, scheduling nothing after it. */
    async enrich() {
      stopRequested = false;
      return runEnrichCycle({ armNext: false });
    },

    /** Stops polling: the recurring timer is cancelled, and a cycle already
     *  running abandons at its next yield point — between whole articles,
     *  never part-way through folding one, so nothing half-ingested lands. */
    stopPolling() {
      stopRequested = true;
      clearTimer();
      return { wasRunning: cycleRunning };
    },

    /** True while a poll or enrich cycle is mid-flight. */
    get busy() { return cycleRunning; },

    async buildFeed() {
      if (forgotten) return { items: [], seedFallback: false, builtAt: typeof now === "function" ? now() : now };
      return buildFeed(ctx());
    },

    /** The two whole-graph counts the dashboard shows: every fact the store
     *  holds, and the subset a news, fixture-replay or research ingest
     *  contributed. Read off the same provenance rule the feed window uses,
     *  so a tile and the feed can never disagree about what came from news. */
    async stats() {
      const memory = await store.loadMemory(memoryDir);
      const rows = store.readFactRows(memory);
      let fromNews = 0;
      for (const row of rows) if (isNewsProvenance(row.provenance)) fromNews += 1;
      return { graphSize: rows.length, factsFromNews: fromNews };
    },

    /** The fact rows behind a set of ids — a feed item's own `factIds`,
     *  expanded so the page's `<details>` fact list can show each one as a
     *  sentence and, nested under it, the raw triple record. */
    async factRows(ids) {
      const wanted = new Set(ids || []);
      if (!wanted.size) return [];
      const memory = await store.loadMemory(memoryDir);
      return store.readFactRows(memory).filter((r) => wanted.has(r.id));
    },

    // filterRankedTermEntries can shrink the ledger's own limited slice, so
    // this asks for more than the display wants and trims afterward — the
    // panel's own count stays full even when a class term or a bare
    // quantity filters out.
    async rank({ limit = 20 } = {}) {
      const nowVal = typeof now === "function" ? now() : now;
      const ledger = ledgerFromPayload(state.ledger);
      const raw = rankedTerms(ledger, { limit: limit * 4, now: nowVal, ttlMs: config.negativeCacheTtlHours * 3600000 });
      const memory = await store.loadMemory(memoryDir);
      const rows = store.readFactRows(memory);
      return filterRankedTermEntries(rows, raw).slice(0, limit);
    },

    /** Add-by-URL: its own one-off preflight fetch, independent of the poll
     *  cycle's start()-gated consent — pasting a URL and pressing "add" IS
     *  the explicit action authorising that one request. */
    async addSource(url) {
      const result = await preflightNewsUrl(url, { fetchImpl: doFetch });
      if (!result.ok) return { ok: false, reason: result.reason };
      const id = `custom:${normFactTerm(url)}`;
      registerNewsSource({
        id, name: url, kind: "contemporary", format: result.format, url, homepage: url,
        licence: "unknown", browserVerified: "", minIntervalMs: DEFAULT_MIN_INTERVAL_MS, enabledByDefault: false,
      });
      config.sources = normalizeNewsSourceIds([...config.sources, id]);
      rebuildFetchers();
      return { ok: true, id, format: result.format };
    },

    /** The sources panel's checkbox path: replaces the enabled contemporary
     *  and kb id sets in one call. `config` is only ever handed out as a
     *  copy, so a real setter is the one way a toggle can narrow what the
     *  next poll fetches. */
    setSources(ids) {
      const normalized = normalizeNewsSourceIds(ids);
      const kindOf = new Map(newsSourceRecords().map((r) => [r.id, r.kind]));
      config.sources = normalized.filter((id) => kindOf.get(id) !== "kb");
      config.kbSources = normalized.filter((id) => kindOf.get(id) === "kb");
      rebuildFetchers();
      return { sources: [...config.sources], kbSources: [...config.kbSources] };
    },

    /** Re-arms the poll timer at `minutes`, clamped to the same floor the
     *  service config enforces (0 disarms). */
    setInterval(minutes) {
      config.pollMinutes = clampPollMinutesLocal(minutes);
      armTimer();
      return config.pollMinutes;
    },

    /** The teach panel's free-text path: prose ingested under this upload's
     *  own teach tag, the same tier a typed teach turn earns. */
    async ingestText(text, { fileLabel = "free-text" } = {}) {
      forgotten = false;
      const nowVal = typeof now === "function" ? now() : now;
      const sourceTag = `teach:upload:${fileLabel}@${nowVal}`;
      const result = await ingestText(text, { memoryDir, sourceTag, optimistic: true, lexicon, observedAt: nowVal });
      cache.rows = null;
      foldedRows = null;
      return { facts: result.extracted.length + result.optimistic.length, sentences: result.sentences };
    },

    /** One uploaded file, routed by its own kind: `.txt`/`.md` prose through
     *  the same free-text path as ingestText; `.json` (a lexicon-core-shaped
     *  extra vocabulary) widens this session's own lexicon so later
     *  grounding can resolve terms it could not before; `.jsonl` (fact rows)
     *  through ingestUploadedFactRows's validate-and-downgrade before they
     *  land, so an uploaded row can never claim trust it did not earn. */
    async ingestFile({ name, text, kind } = {}) {
      forgotten = false;
      const nowVal = typeof now === "function" ? now() : now;
      const resolvedKind = kind || (/\.jsonl$/i.test(name || "") ? "jsonl" : /\.json$/i.test(name || "") ? "json" : "prose");
      if (resolvedKind === "prose") {
        return this.ingestText(text, { fileLabel: name || "upload" });
      }
      if (resolvedKind === "json") {
        let extra;
        try { extra = JSON.parse(text); } catch { return { facts: 0, vocabAdded: 0, error: "not valid JSON" }; }
        lexicon = loadLexicon(extra);
        return { facts: 0, vocabAdded: (extra?.nouns ? Object.keys(extra.nouns).length : 0), error: null };
      }
      // jsonl: one fact row per non-empty line.
      const rows = [];
      for (const line of String(text || "").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { rows.push(JSON.parse(trimmed)); } catch { /* an unparseable line is skipped, never thrown */ }
      }
      const downgraded = ingestUploadedFactRows(rows, { fileLabel: name || "upload", now: nowVal })
        .filter((r) => r.subject && r.predicate && r.object);
      if (downgraded.length) { await appendFacts(memoryDir, downgraded); cache.rows = null;
      foldedRows = null; }
      return { facts: downgraded.length, vocabAdded: 0, error: null };
    },

    /** Replays a committed fixture's raw wire body through the exact live
     *  parse -> ingest pipeline, under `news-fixture:<sourceId>@<itemId>`
     *  provenance (the corpus-tier demo path) rather than `news:` — never a
     *  network call, so it works with the network fully blocked. */
    async replayFixture(sourceId, { format, body } = {}) {
      forgotten = false;
      const nowVal = typeof now === "function" ? now() : now;
      const raw = fixtureRawItems(format, body);
      const items = normalizeFeedItems(sourceId, raw, { now: nowVal });
      let factsTotal = 0;
      for (const snapshot of items) {
        const text = [snapshot.title, snapshot.summary].filter(Boolean).join(". ");
        const sourceTag = `news-fixture:${sourceId}@${snapshot.id}`;
        const result = await ingestText(text, { memoryDir, sourceTag, optimistic: true, lexicon, observedAt: nowVal });
        const allFacts = [...result.extracted, ...result.optimistic];
        snapshot.factIds = allFacts.map((f) => factIdFor(normFactTerm(f.subject), normFactPredicate(f.predicate), normFactTerm(f.object)));
        factsTotal += allFacts.length;

        const vocabGroundedByTerm = new Map();
        for (const term of result.ungroundedCounts.keys()) vocabGroundedByTerm.set(term, isVocabGroundedTerm(lexicon, term));
        const ledger = ledgerFromPayload(state.ledger);
        bumpTerms(ledger, result.ungroundedCounts, snapshot.id, nowVal, vocabGroundedByTerm);
        state.ledger = ledgerPayload(ledger);
      }
      if (factsTotal) cache.rows = null;
      foldedRows = null;
      const existingIds = new Set(state.items.map((s) => s.id));
      state.items = [...state.items, ...items.filter((s) => !existingIds.has(s.id))];
      await noteFirstArticle();
      return { items: items.length, facts: factsTotal };
    },

    /** Forgets everything this session gathered: the start-consent
     *  preference, the poll timer, every article snapshot, the term ledger,
     *  the health and request logs, and every fact a news, fixture-replay or
     *  enrichment ingest wrote into the graph. The next load of this page
     *  reads back as first-visit, and the feed here and now is empty — a
     *  visitor who pressed this asked for the articles to go, not just the
     *  preference. The seed graph itself is untouched. */
    async revokeConsent() {
      consented = false;
      forgotten = true;
      stopRequested = true;
      prefStore.remove(prefKey);
      clearTimer();
      phase = "seeded";

      const nowVal = typeof now === "function" ? now() : now;
      const memory = await store.loadMemory(memoryDir);
      const newsFactIds = store.readFactRows(memory)
        .filter((row) => isNewsProvenance(row.provenance))
        .map((row) => row.id);
      if (newsFactIds.length) await store.removeFacts(memoryDir, newsFactIds, { retractedAt: nowVal });

      const fresh = createNewsState();
      state.items = fresh.items;
      state.ledger = fresh.ledger;
      state.health = fresh.health;
      state.requestLog = fresh.requestLog;
      state.metrics = fresh.metrics;
      state.lastPollAt = "";
      state.lastEnrichAt = "";
      metrics.timeToFirstArticleMs = null;
      metrics.timeToFirstCompletePollMs = null;
      cache.rows = null;
      foldedRows = null;
      return { factsRemoved: newsFactIds.length };
    },

    /** Stops the poll timer and any running cycle without touching consent —
     *  a test's own teardown, and a page's own unload hook. */
    destroy() { stopRequested = true; clearTimer(); },
  };
}

publishTmctSurface({
  open: createNewsSession,
  page: {
    NEWS_START_PREF_KEY,
    registerWinkModel, openPersistedStore, normFactTerm,
    newsSourceRecords, detectFeedFormat,
  },
});
