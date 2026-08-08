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
// before `start()` (or a returning visit's own `start()` replay) is called.
// `poll()`/`enrich()` are consent-gated the same way; `addSource()` performs
// its own one-off preflight fetch because pasting a URL and pressing "add" is
// itself the explicit action authorising that one request; `replayFixture()`
// never touches the network at all — it re-runs the exact ingest pipeline
// over an already-downloaded fixture body.
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
import { ingestText } from "../../services/extract-facts.mjs";
import {
  resolveNewsConfig, createNewsState, pollNewsSources, enrichTopTerms, buildFeed,
  ingestUploadedFactRows, isVocabGroundedTerm,
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
 * except for the fetches `start()`/`poll()`/`enrich()`/`addSource()`
 * themselves trigger — every one of them consent-gated, `addSource()` by its
 * own one-off preflight rather than the poll cycle's consent.
 *
 * Returns `{ memoryDir, phase, consented, metrics, nextPollAt, config,
 * requestLog, health, start, poll, enrich, buildFeed, rank, addSource,
 * setInterval, ingestText, ingestFile, replayFixture, revokeConsent,
 * destroy }`.
 */
export function createNewsSession({
  seedPayload = null, vocabSeeded = false, fetchImpl = null, now = isoNow,
  prefs = null, prefKey = NEWS_START_PREF_KEY,
} = {}) {
  const memoryDir = createInMemoryStore();
  applySeedPayload(memoryDir, seedPayload);

  const store = { loadMemory, readFactRows, appendFacts, removeFacts };
  const cache = { rows: null };
  let lexicon = loadLexicon();
  let config = resolveNewsConfig();
  const state = createNewsState();
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));

  const prefStore = prefs || (typeof globalThis !== "undefined" && globalThis.localStorage ? localStoragePrefStore() : memoryPrefStore());
  let consented = prefStore.get(prefKey) === "on";

  let phase = "seeded"; // the page-level "seeding" state (S0) precedes this session existing at all
  let timer = null;
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
    return { memoryDir, store, cache, lexicon, config, state, providers, now };
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
    timer = setTimeout(() => { runPollCycle().then(runEnrichCycle).catch(() => {}); }, delayMs);
  }

  async function noteFirstArticle() {
    if (metrics.timeToFirstArticleMs !== null) return;
    const feed = await buildFeed(ctx());
    if (feed.items.length) metrics.timeToFirstArticleMs = resolveNowMs() - bootMs;
  }

  async function runPollCycle() {
    phase = "polling";
    const result = await pollNewsSources(ctx());
    if (metrics.timeToFirstCompletePollMs === null) metrics.timeToFirstCompletePollMs = resolveNowMs() - bootMs;
    phase = "grounding";
    await noteFirstArticle();
    return result;
  }

  async function runEnrichCycle() {
    phase = "enriching";
    const result = await enrichTopTerms(ctx());
    phase = "idle";
    armTimer();
    return result;
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
      const pollResult = await runPollCycle();
      const enrichResult = await runEnrichCycle();
      return { poll: pollResult, enrich: enrichResult };
    },

    /** A manual "poll now" — still consent-gated: never fires before
     *  start() has run at least once this session. */
    async poll() {
      if (!consented) return { fetched: 0, newItems: 0, failures: 0, evicted: 0, facts: 0, derived: 0, sources: [] };
      return runPollCycle();
    },

    /** A manual "enrich now" — same consent gate as poll(). */
    async enrich() {
      if (!consented) return { enriched: [], missed: [], facts: 0, derived: 0 };
      return runEnrichCycle();
    },

    async buildFeed() { return buildFeed(ctx()); },

    /** The fact rows behind a set of ids — a feed item's own `factIds`,
     *  expanded so the page's `<details>` fact list can show each one as a
     *  sentence and, nested under it, the raw triple record. */
    async factRows(ids) {
      const wanted = new Set(ids || []);
      if (!wanted.size) return [];
      const memory = await store.loadMemory(memoryDir);
      return store.readFactRows(memory).filter((r) => wanted.has(r.id));
    },

    async rank({ limit = 20 } = {}) {
      const nowVal = typeof now === "function" ? now() : now;
      const ledger = ledgerFromPayload(state.ledger);
      return rankedTerms(ledger, { limit, now: nowVal, ttlMs: config.negativeCacheTtlHours * 3600000 });
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
      const nowVal = typeof now === "function" ? now() : now;
      const sourceTag = `teach:upload:${fileLabel}@${nowVal}`;
      const result = await ingestText(text, { memoryDir, sourceTag, optimistic: true, lexicon });
      cache.rows = null;
      return { facts: result.extracted.length + result.optimistic.length, sentences: result.sentences };
    },

    /** One uploaded file, routed by its own kind: `.txt`/`.md` prose through
     *  the same free-text path as ingestText; `.json` (a lexicon-core-shaped
     *  extra vocabulary) widens this session's own lexicon so later
     *  grounding can resolve terms it could not before; `.jsonl` (fact rows)
     *  through ingestUploadedFactRows's validate-and-downgrade before they
     *  land, so an uploaded row can never claim trust it did not earn. */
    async ingestFile({ name, text, kind } = {}) {
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
      if (downgraded.length) { await appendFacts(memoryDir, downgraded); cache.rows = null; }
      return { facts: downgraded.length, vocabAdded: 0, error: null };
    },

    /** Replays a committed fixture's raw wire body through the exact live
     *  parse -> ingest pipeline, under `news-fixture:<sourceId>@<itemId>`
     *  provenance (the corpus-tier demo path) rather than `news:` — never a
     *  network call, so it works with the network fully blocked. */
    async replayFixture(sourceId, { format, body } = {}) {
      const nowVal = typeof now === "function" ? now() : now;
      const raw = fixtureRawItems(format, body);
      const items = normalizeFeedItems(sourceId, raw, { now: nowVal });
      let factsTotal = 0;
      for (const snapshot of items) {
        const text = [snapshot.title, snapshot.summary].filter(Boolean).join(". ");
        const sourceTag = `news-fixture:${sourceId}@${snapshot.id}`;
        const result = await ingestText(text, { memoryDir, sourceTag, optimistic: true, lexicon });
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
      const existingIds = new Set(state.items.map((s) => s.id));
      state.items = [...state.items, ...items.filter((s) => !existingIds.has(s.id))];
      await noteFirstArticle();
      return { items: items.length, facts: factsTotal };
    },

    /** Clears the start-consent preference and stops the timer — the next
     *  load of this page reads back as first-visit, exactly as if start()
     *  had never been pressed. */
    revokeConsent() {
      consented = false;
      prefStore.remove(prefKey);
      clearTimer();
      phase = "seeded";
    },

    /** Stops the poll timer without touching consent — a test's own
     *  teardown, and a page's own unload hook. */
    destroy() { clearTimer(); },
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
