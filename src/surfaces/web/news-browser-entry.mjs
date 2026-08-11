// news-browser-entry.mjs — the esbuild entry for news.html's bundle
// (public/news-browser.bundle.js, built by scripts/build-news-bundle.mjs).
//
// news.html carries no engine and no seed. Every fact this page ever shows
// came from a poll, an enrich pass or a teach upload that ran server-side, in
// the news worker Lambda, against this session's own row partition — the
// same `pollNewsSources`/`enrichTopTerms`/`buildFeed` calls the CLI's `tmct
// news` verb runs, just running there instead of here. This module is the
// thin client over that: mint a session key, call the row and turn
// services' routes, and hand the result to the page's own render code
// (src/services/news-viz.mjs's inline script). Nothing here parses a feed,
// extracts a fact, ranks a term, or renders an answer.
//
// The chat area's one call, `turn()`, is the odd one out: it answers
// synchronously (POST /api/sessions/<uuid>/turn) rather than through a
// trigger-and-settle cycle, and it never touches the materialized feed at
// all — a taught fact lands as a session row the same way an ingest trigger's
// row does, and reaches the feed only at whatever poll/enrich/ingest cycle
// materializes next. This module says nothing about that timing either way;
// it just reports what the turn itself returned.
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

import { createHttpRowBackend, sha256Hex } from "./http-row-backend.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { factSentence, findingCaveat } from "../../domain/fact-phrase.mjs";

const SESSION_HEADER = "x-tmct-session";
const PAYLOAD_HASH_HEADER = "x-amz-content-sha256";
const DEFAULT_CYCLE_POLL_MS = 400;
const DEFAULT_CYCLE_WAIT_TIMEOUT_MS = 20_000;

/** The standing refresh loop's own cadence: `~2 s interval with backoff
 *  toward ~10 s while nothing changes` (PLAN_MEMORY_BACKEND.md's materialized-
 *  feed section). A version change resets the interval back to the floor —
 *  something is actively happening, so the loop goes back to checking often —
 *  and a quiet tick or a failed read both step it toward the ceiling, never
 *  past it. The loop never stops outright: it only ever slows down. */
const DEFAULT_VERSION_POLL_MS = 2_000;
const DEFAULT_VERSION_POLL_STEP_MS = 2_000;
const DEFAULT_VERSION_POLL_MAX_MS = 10_000;

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

/** One line per row a turn's own write touched, through the phrase layer —
 *  `factSentence` turned into English, with any extraction caveat appended.
 *  No provenance tag rides along: a chat-taught row's own tag names this
 *  session and this moment, which the visitor already knows from having just
 *  typed it, so citing it back would be noise rather than information —
 *  unlike a corpus-grounded answer's citation, which names something the
 *  visitor could not otherwise know. */
export function turnCitationLines(factsTouched) {
  return (factsTouched || []).map((row) => {
    const caveat = findingCaveat(row);
    return caveat ? `${factSentence(row)} ${caveat}` : factSentence(row);
  });
}

/**
 * The thin API session over the row and turn services' news-facing routes:
 * `{ sessionKey, consented, unavailable, fetchFeed, fetchFeedVersion,
 * fetchCycle, onFeedUpdate, start, poll, enrich, ingestText, ingestRows,
 * turn, revokeConsent, destroy }`.
 *
 * `fetchImpl` defaults to the ambient `fetch`, so a page never has to pass
 * one; every path this module requests is root-relative ("/api/…"), which a
 * browser resolves against its own origin — the same-origin CloudFront
 * behaviour §3.7 draws. A test hands in a `fetchImpl` that resolves those
 * same paths against a running `local.mjs` double instead.
 *
 * `cyclePollMs`/`cycleWaitTimeoutMs` govern the one polling loop a trigger's
 * own press runs: after its 202, waiting for `feedVersion` to move past
 * where it stood before that trigger, so the button that fired it can settle
 * once the cycle it started has actually materialized. It gives up and
 * renders whatever is there once `cycleWaitTimeoutMs` elapses — a cycle that
 * failed before materializing must never wedge the button forever. While
 * that wait is running, each of its own ticks also reads the cycle marker
 * and hands it to the press's own `onCycle` callback, if it supplied one —
 * that is the page's live "polling…" / per-source-chip feed, not a separate
 * standing read.
 *
 * `versionPollMs`/`versionPollStepMs`/`versionPollMaxMs` govern the OTHER
 * loop: a standing watcher that starts the moment a session key exists (a
 * restored visit, or the first press that mints one) and keeps polling
 * `feedVersion` for as long as the session lives, backing off from
 * `versionPollMs` toward `versionPollMaxMs` while nothing changes and
 * dropping back to `versionPollMs` the moment it does — refetching the feed
 * and notifying every `onFeedUpdate` listener only on an actual version
 * change. It never stops outright (a cycle triggered from another tab, or
 * left running past a reload, still needs to reach this page), only ever
 * slows down; `destroy()`/`revokeConsent()` are the only ways to stop it.
 */
export function createNewsSession({
  fetchImpl = null, prefs = null,
  consentPrefKey = NEWS_START_PREF_KEY, sessionPrefKey = NEWS_SESSION_PREF_KEY,
  cyclePollMs = DEFAULT_CYCLE_POLL_MS, cycleWaitTimeoutMs = DEFAULT_CYCLE_WAIT_TIMEOUT_MS,
  versionPollMs = DEFAULT_VERSION_POLL_MS, versionPollStepMs = DEFAULT_VERSION_POLL_STEP_MS,
  versionPollMaxMs = DEFAULT_VERSION_POLL_MAX_MS,
} = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const prefStore = prefs || (typeof globalThis !== "undefined" && globalThis.localStorage ? localStoragePrefStore() : memoryPrefStore());

  let sessionKey = prefStore.get(sessionPrefKey) || null;
  let consented = Boolean(sessionKey) && prefStore.get(consentPrefKey) === "on";
  let unavailable = false;

  const feedUpdateListeners = new Set();
  let versionWatcher = null;

  /** The last `feedVersion` any code path in this session has actually
   *  confirmed — the watcher's own ticks update it, and so does a trigger's
   *  own settle-wait (`waitForFeedVersionBump`), which already polls the
   *  same number for its own reasons. Sharing one value across both means a
   *  press's own wait already having caught a cycle's bump leaves nothing
   *  for the standing watcher to rediscover moments later — without it, the
   *  watcher's independent bookkeeping would treat that same bump as a
   *  change of its own the next time it ticked, and needlessly refetch the
   *  feed a second time for a change the page already rendered. `null` means
   *  nothing has confirmed a number yet. */
  let knownFeedVersion = null;

  /** The standing loop: one `feedVersion` read per tick, refetching the feed
   *  and notifying listeners only when the number actually moved from what
   *  `knownFeedVersion` last confirmed. A failed tick (service unreachable)
   *  backs off exactly like a quiet one — this loop never throws and never
   *  blocks anything else the page does. */
  function startVersionWatcher() {
    if (versionWatcher || !sessionKey) return;
    let intervalMs = versionPollMs;
    let stopped = false;
    let timer = null;
    versionWatcher = {
      stop() { stopped = true; if (timer) clearTimeout(timer); versionWatcher = null; },
    };

    function scheduleTick() {
      timer = setTimeout(tick, intervalMs);
      if (typeof timer?.unref === "function") timer.unref();
    }

    async function tick() {
      if (stopped) return;
      try {
        const version = await readFeedVersion();
        if (knownFeedVersion !== null && version !== knownFeedVersion) {
          knownFeedVersion = version;
          intervalMs = versionPollMs;
          const feed = await readFeed();
          for (const listener of feedUpdateListeners) { try { listener(feed); } catch { /* a listener's own bug never stops the loop */ } }
        } else {
          knownFeedVersion = version;
          intervalMs = Math.min(versionPollMaxMs, intervalMs + versionPollStepMs);
        }
      } catch {
        intervalMs = Math.min(versionPollMaxMs, intervalMs + versionPollStepMs);
      }
      if (!stopped) scheduleTick();
    }

    // The baseline read happens right away, not on the first timer tick —
    // waiting a whole interval to find out where the count already stood
    // would silently swallow a change that lands in that gap (a cycle this
    // same press just started, or one still running from an earlier visit).
    // Skipped entirely when a trigger already confirmed a number moments
    // earlier — see knownFeedVersion above. Every tick after this one runs
    // on the ordinary schedule.
    (async () => {
      if (knownFeedVersion === null) {
        try { knownFeedVersion = await readFeedVersion(); } catch { knownFeedVersion = 0; }
      }
      if (!stopped) scheduleTick();
    })();
  }

  function stopVersionWatcher() {
    versionWatcher?.stop();
  }

  function ensureSessionKey() {
    if (!sessionKey) {
      sessionKey = mintSessionKey();
      prefStore.set(sessionPrefKey, sessionKey);
    }
    startVersionWatcher();
    return sessionKey;
  }

  // A restored visit (a session key already in the pref store) starts the
  // standing loop right away — nothing here waited for a press, because the
  // consent that authorised the loop already happened on an earlier visit.
  startVersionWatcher();

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
    const serializedBody = JSON.stringify(body || {});
    const response = await request(`/api/sessions/${key}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json", [PAYLOAD_HASH_HEADER]: await sha256Hex(serializedBody) },
      body: serializedBody,
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

  /** `GET /api/meta/cycle` — the running cycle's own marker: `{cycleId,
   *  kind, state, startedAt, sources, finishedAt?, reason?}`. Answers `null`
   *  before any cycle has ever run for this session (404) or once the
   *  session itself doesn't exist yet, never throws on a malformed value —
   *  a marker this module cannot parse is the same as no marker. */
  async function readCycle() {
    if (!sessionKey) return null;
    const response = await request("/api/meta/cycle", { headers: { [SESSION_HEADER]: sessionKey } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET /api/meta/cycle failed (status ${response.status})`);
    const body = await readJsonOrNull(response);
    if (typeof body?.value !== "string") return null;
    try { return JSON.parse(body.value); } catch { return null; }
  }

  /** Waits for `feedVersion` to move past `versionBefore`, the same tight
   *  loop every trigger settles on. Keeps `knownFeedVersion` current on every
   *  read — this loop is a trigger's own dedicated watch over the exact
   *  number the standing loop also tracks, so the standing loop must never
   *  end up rediscovering, and re-rendering, a change this wait already
   *  caught. `onCycle`, when supplied, is handed the cycle marker (or
   *  `null`) on every tick — the press's own live "polling…" /
   *  per-source-chip feed, read here because this is the one loop already
   *  running for the whole span a cycle is in flight; a read that fails is
   *  reported as `null` rather than aborting the wait over a display-only
   *  read. */
  async function waitForFeedVersionBump(versionBefore, onCycle) {
    const deadline = Date.now() + cycleWaitTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, cyclePollMs));
      const version = await readFeedVersion();
      knownFeedVersion = version;
      if (typeof onCycle === "function") {
        let marker = null;
        try { marker = await readCycle(); } catch { marker = null; }
        try { onCycle(marker); } catch { /* a caller's own bug never stops the wait */ }
      }
      if (version > versionBefore) return version;
    }
    return versionBefore; // gives up; the caller renders whatever is there
  }

  async function triggerAndSettle(kind, body, { onCycle } = {}) {
    const versionBefore = await readFeedVersion();
    knownFeedVersion = versionBefore;
    await postTrigger(kind, body);
    await waitForFeedVersionBump(versionBefore, onCycle);
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

    /** `GET /api/meta/feedVersion` — the cheap poll the standing refresh
     *  loop reads on its own. Exposed too, for a caller that wants a one-off
     *  read outside that loop. */
    async fetchFeedVersion() { return readFeedVersion(); },

    /** `GET /api/meta/cycle` — the cycle marker, for a caller that wants a
     *  one-off read of the current or most recent cycle's progress outside
     *  a trigger's own `onCycle` callback (a boot-time check, say). */
    async fetchCycle() { return readCycle(); },

    /** Subscribes to the standing refresh loop: `callback(feed)` fires every
     *  time `feedVersion` actually moves, with the freshly re-fetched feed
     *  already in hand. Returns an unsubscribe function. The loop itself
     *  runs independently of any subscriber — it starts the moment a
     *  session key exists, subscribed or not — so a page that boots after
     *  the loop already started still catches every later change. */
    onFeedUpdate(callback) {
      feedUpdateListeners.add(callback);
      return () => feedUpdateListeners.delete(callback);
    },

    /** First press: mints the session key if this is a first visit, records
     *  the start-consent preference, and runs one poll cycle. Every later
     *  press of the same button is just another poll — there is no
     *  recurring timer to distinguish a "first" press from any other.
     *  `onCycle`, if supplied, is reported the cycle marker on every tick of
     *  the settle-wait (see `waitForFeedVersionBump`). */
    async start(sources, { onCycle } = {}) {
      ensureSessionKey();
      prefStore.set(consentPrefKey, "on");
      consented = true;
      return triggerAndSettle("poll", sources?.length ? { sources } : {}, { onCycle });
    },

    /** One enrich cycle, on its own press — independent of `start()`'s
     *  consent, the same way the old page's `addSource()` ran its own
     *  preflight regardless of whether polling had started. `fuzzy`, when
     *  supplied, rides the trigger body as `{fuzzy: 0|1}` — §3.15.2's
     *  per-request rung, read by the worker's own corpus enrichment source;
     *  omitted entirely (not defaulted here) when the caller doesn't pass
     *  it, so the worker's own mode/env/config resolution still applies. */
    async enrich({ fuzzy, onCycle } = {}) {
      return triggerAndSettle("enrich", fuzzy === undefined ? {} : { fuzzy: fuzzy ? 1 : 0 }, { onCycle });
    },

    /** The teach panel's free-text path. */
    async ingestText(text, { onCycle } = {}) {
      return triggerAndSettle("ingest", { text }, { onCycle });
    },

    /** The teach panel's uploaded-`.jsonl` path. */
    async ingestRows(rows, { onCycle } = {}) {
      return triggerAndSettle("ingest", { rows }, { onCycle });
    },

    /** POST /api/sessions/:uuid/turn — the chat area's one call. Mints the
     *  session key on a first call the same way every trigger does; never
     *  requires `start()`'s own consent by itself, the page decides whether
     *  to gate its own control on that. `fuzzy`, when supplied, rides the
     *  body as `retrieval: {fuzzy}`, the same per-request override
     *  `enrich()` threads through its own trigger.
     *
     *  Resolves to `{reply, factsTouched, citations, narration}`: `reply` is
     *  the turn's own answer text, already worded for display; `citations`
     *  is `factsTouched` read through the phrase layer (`turnCitationLines`),
     *  one line per row this turn wrote; `narration` is the turn's trace.
     *  Never touches the feed, and never claims anything about it — a
     *  learned row reaches `GET /api/feed` only at whatever cycle
     *  materializes next, which this call has no way to know or wait for.
     *
     *  A 429 (this session's hourly turn cap) rejects with a message already
     *  worded for direct display, distinct from the generic unavailable
     *  wording — the rate limit is not the service being down. Any other
     *  non-2xx, a thrown fetch, or a 5xx all reject the same way every other
     *  request does and mark `unavailable` accordingly. */
    async turn(text, { fuzzy } = {}) {
      const key = ensureSessionKey();
      const body = { text };
      if (fuzzy !== undefined) body.retrieval = { fuzzy: Boolean(fuzzy) };
      const serializedBody = JSON.stringify(body);
      const response = await request(`/api/sessions/${key}/turn`, {
        method: "POST",
        headers: { "content-type": "application/json", [PAYLOAD_HASH_HEADER]: await sha256Hex(serializedBody) },
        body: serializedBody,
      });
      if (response.status === 429) {
        throw new Error("this session has sent a lot of chat messages this hour — wait a bit and try again.");
      }
      if (!response.ok) {
        const errBody = await readJsonOrNull(response);
        throw new Error(errBody?.error?.message || `the turn failed (status ${response.status})`);
      }
      const parsed = await readJsonOrNull(response);
      const factsTouched = Array.isArray(parsed?.factsTouched) ? parsed.factsTouched : [];
      return {
        reply: typeof parsed?.reply === "string" ? parsed.reply : "",
        factsTouched,
        citations: turnCitationLines(factsTouched),
        narration: typeof parsed?.narration === "string" ? parsed.narration : "",
      };
    },

    /** Purges every row and meta entry this session's key reaches, then
     *  discards the key and the consent preference regardless of whether
     *  the purge itself succeeded — the visitor's own pointer to any
     *  residue is gone either way, the same reasoning `deleteAll`'s own
     *  sharp edge documents. Stops the standing refresh loop first: there is
     *  nothing left for it to watch. */
    async revokeConsent() {
      const key = sessionKey;
      let error = null;
      stopVersionWatcher();
      knownFeedVersion = null; // a later start() mints a different key with its own numbering from zero
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

    /** Stops the standing refresh loop — a page tearing itself down (or a
     *  test moving on to the next case) leaves nothing still polling. */
    destroy() { stopVersionWatcher(); },
  };
}

publishTmctSurface({
  open: createNewsSession,
  page: { NEWS_START_PREF_KEY, NEWS_SESSION_PREF_KEY, parseJsonlRows },
});
