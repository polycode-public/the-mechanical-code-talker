// news-browser-entry.mjs — the esbuild entry for news.html's bundle
// (public/news-browser.bundle.js, built by scripts/build-news-bundle.mjs).
//
// news.html carries no engine and no seed. Every fact this page ever shows
// came from a poll, an enrich pass or a teach upload that ran server-side, in
// the news worker Lambda, against this session's own row partition — the
// same `pollNewsSources`/`enrichTopTerms`/`buildFeed` calls the CLI's `tmct
// news` verb runs, just running there instead of here. This module is the
// thin client over that: mint a session key, call the row service's five
// routes, and hand the result to the page's own render code
// (src/services/news-viz.mjs's inline script). Nothing here parses a feed,
// extracts a fact, or ranks a term.
//
// The one rule every method below honours: NOTHING here calls the row
// service until the visitor presses something, unless a session key already
// exists from a previous visit (a reload restores that session's last
// materialized feed with one read, per the plan's own reload contract).
// `start()` is the first press — it mints the key, records consent, and
// runs a poll. `enrich()`/`ingestText()`/`ingestRows()` each run their own
// trigger on their own press, independent of `start()`'s consent, the same
// way the in-page engine's `addSource()` used to run its own preflight.
//
// Gitignored, Pages-demo-site-only output — scripts/build-demo-site.mjs
// builds it fresh on every deploy, never committed, the same posture every
// sibling *-browser-entry.mjs documents for its own output.

import { createHttpRowBackend } from "./http-row-backend.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";

const SESSION_HEADER = "x-tmct-session";
const DEFAULT_CYCLE_POLL_MS = 400;
const DEFAULT_CYCLE_WAIT_TIMEOUT_MS = 20_000;

/** The localStorage keys the shipped page persists under — exported so the
 *  page's own inline script and a test can both name them without
 *  retyping the string. `NEWS_SESSION_PREF_KEY` is the ONE fact beyond the
 *  consent preference this page ever keeps locally: a random session
 *  pointer, never a fact. */
export const NEWS_START_PREF_KEY = "tmct.news.started";
export const NEWS_SESSION_PREF_KEY = "tmct.news.sessionKey";

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

function mintSessionKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  throw new Error("no UUIDv4 source available (crypto.randomUUID is missing)");
}

async function readJsonOrNull(response) {
  try { return await response.json(); } catch { return null; }
}

const EMPTY_FEED = Object.freeze({
  items: [], rankedTerms: [], stats: { graphSize: 0, factsFromNews: 0 }, sourceStatus: [], requestLog: [], builtAt: null,
});

/** One non-empty line per row: an uploaded `.jsonl` file is exactly this,
 *  and the teach panel's own "example: facts" button fills the textarea with
 *  the same shape. An unparseable line is dropped rather than thrown — the
 *  ingest trigger downgrades whatever rows do arrive, so a stray typo in one
 *  line should not cost every other line in the file. */
export function parseJsonlRows(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* skipped, never thrown */ }
  }
  return rows;
}

/**
 * The thin API session over the row service's news-facing routes:
 * `{ sessionKey, consented, unavailable, fetchFeed, fetchFeedVersion, start,
 * poll, enrich, ingestText, ingestRows, revokeConsent, destroy }`.
 *
 * `fetchImpl` defaults to the ambient `fetch`, so a page never has to pass
 * one; every path this module requests is root-relative ("/api/…"), which a
 * browser resolves against its own origin — the same-origin CloudFront
 * behaviour §3.7 draws. A test hands in a `fetchImpl` that resolves those
 * same paths against a running `local.mjs` double instead.
 *
 * `cyclePollMs`/`cycleWaitTimeoutMs` govern the one polling loop this module
 * runs: after a trigger's own 202, waiting for `feedVersion` to move past
 * where it stood before that trigger, so the button that fired it can settle
 * once the cycle it started has actually materialized. It gives up and
 * renders whatever is there once `cycleWaitTimeoutMs` elapses — a cycle that
 * failed before materializing must never wedge the button forever.
 */
export function createNewsSession({
  fetchImpl = null, prefs = null,
  consentPrefKey = NEWS_START_PREF_KEY, sessionPrefKey = NEWS_SESSION_PREF_KEY,
  cyclePollMs = DEFAULT_CYCLE_POLL_MS, cycleWaitTimeoutMs = DEFAULT_CYCLE_WAIT_TIMEOUT_MS,
} = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const prefStore = prefs || (typeof globalThis !== "undefined" && globalThis.localStorage ? localStoragePrefStore() : memoryPrefStore());

  let sessionKey = prefStore.get(sessionPrefKey) || null;
  let consented = Boolean(sessionKey) && prefStore.get(consentPrefKey) === "on";
  let unavailable = false;

  function ensureSessionKey() {
    if (!sessionKey) {
      sessionKey = mintSessionKey();
      prefStore.set(sessionPrefKey, sessionKey);
    }
    return sessionKey;
  }

  /** Every request funnels through here: a thrown/rejected fetch or a 5xx
   *  both mean the service itself is unreachable, and the flag this sets is
   *  what the page reads to show feed-and-chat-unavailable and disable its
   *  controls. A later request that actually gets a response under 500
   *  clears it again — the same session object recovers on its own once the
   *  service answers, without needing a page reload. */
  async function request(path, init) {
    let response;
    try {
      response = await doFetch(path, init);
    } catch (error) {
      unavailable = true;
      throw new Error(`could not reach the news service: ${error.message}`);
    }
    if (response.status >= 500) {
      unavailable = true;
      throw new Error(`the news service failed (status ${response.status})`);
    }
    unavailable = false;
    return response;
  }

  async function readFeed() {
    if (!sessionKey) return { ...EMPTY_FEED, missing: true };
    const response = await request("/api/feed", { headers: { [SESSION_HEADER]: sessionKey } });
    if (response.status === 404) return { ...EMPTY_FEED, missing: true };
    if (!response.ok) throw new Error(`GET /api/feed failed (status ${response.status})`);
    const body = await readJsonOrNull(response);
    return { ...EMPTY_FEED, ...(body?.feed || {}), missing: false };
  }

  async function readFeedVersion() {
    if (!sessionKey) return 0;
    const response = await request("/api/meta/feedVersion", { headers: { [SESSION_HEADER]: sessionKey } });
    if (response.status === 404) return 0;
    if (!response.ok) throw new Error(`GET /api/meta/feedVersion failed (status ${response.status})`);
    const body = await readJsonOrNull(response);
    const n = Number(body?.value);
    return Number.isFinite(n) ? n : 0;
  }

  async function postTrigger(kind, body) {
    const key = ensureSessionKey();
    const response = await request(`/api/sessions/${key}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    // A 409 means a cycle this session already had running is still going —
    // never this call's own fault. Falling through to the version-wait below
    // still settles correctly once THAT cycle materializes.
    if (response.status === 409 || response.status === 202) {
      const parsed = response.status === 202 ? await readJsonOrNull(response) : null;
      return { cycleId: parsed?.cycleId || null };
    }
    const errBody = await readJsonOrNull(response);
    throw new Error(errBody?.error?.message || `${kind} trigger failed (status ${response.status})`);
  }

  async function waitForFeedVersionBump(versionBefore) {
    const deadline = Date.now() + cycleWaitTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, cyclePollMs));
      const version = await readFeedVersion();
      if (version > versionBefore) return version;
    }
    return versionBefore; // gives up; the caller renders whatever is there
  }

  async function triggerAndSettle(kind, body) {
    const versionBefore = await readFeedVersion();
    await postTrigger(kind, body);
    await waitForFeedVersionBump(versionBefore);
    return readFeed();
  }

  return {
    get sessionKey() { return sessionKey; },
    get consented() { return consented; },
    /** True once a request has failed to reach the service or answered 5xx;
     *  cleared again the moment a later request succeeds. */
    get unavailable() { return unavailable; },

    /** One `GET /api/feed` — cards, ranked terms, tiles, source panel status
     *  and the request log all come from here, and nothing else recomputes
     *  any of it client-side. Answers the empty document (never throws) when
     *  no session exists yet: a first visit renders the empty shell without
     *  making a request at all. */
    async fetchFeed() { return readFeed(); },

    /** `GET /api/meta/feedVersion` — the cheap poll a standing refresh loop
     *  reads. Exposed for that loop to use; this module never runs one on
     *  its own beyond the one-shot wait inside `triggerAndSettle`. */
    async fetchFeedVersion() { return readFeedVersion(); },

    /** First press: mints the session key if this is a first visit, records
     *  the start-consent preference, and runs one poll cycle. Every later
     *  press of the same button is just another poll — there is no
     *  recurring timer to distinguish a "first" press from any other. */
    async start(sources) {
      ensureSessionKey();
      prefStore.set(consentPrefKey, "on");
      consented = true;
      return triggerAndSettle("poll", sources?.length ? { sources } : {});
    },

    /** One enrich cycle, on its own press — independent of `start()`'s
     *  consent, the same way the old page's `addSource()` ran its own
     *  preflight regardless of whether polling had started. */
    async enrich() {
      return triggerAndSettle("enrich", {});
    },

    /** The teach panel's free-text path. */
    async ingestText(text) {
      return triggerAndSettle("ingest", { text });
    },

    /** The teach panel's uploaded-`.jsonl` path. */
    async ingestRows(rows) {
      return triggerAndSettle("ingest", { rows });
    },

    /** Purges every row and meta entry this session's key reaches, then
     *  discards the key and the consent preference regardless of whether
     *  the purge itself succeeded — the visitor's own pointer to any
     *  residue is gone either way, the same reasoning `deleteAll`'s own
     *  sharp edge documents. */
    async revokeConsent() {
      const key = sessionKey;
      let error = null;
      if (key) {
        try {
          const backend = createHttpRowBackend({ apiBase: "/", sessionKey: key, fetchImpl: doFetch });
          await backend.deleteAll();
          await backend.close();
          unavailable = false;
        } catch (err) {
          error = err.message;
          unavailable = true;
        }
      }
      prefStore.remove(consentPrefKey);
      prefStore.remove(sessionPrefKey);
      sessionKey = null;
      consented = false;
      return { ok: !error, error };
    },

    /** Nothing to tear down — kept for the same lifecycle shape every other
     *  page's session exposes. */
    destroy() {},
  };
}

publishTmctSurface({
  open: createNewsSession,
  page: { NEWS_START_PREF_KEY, NEWS_SESSION_PREF_KEY, parseJsonlRows },
});
