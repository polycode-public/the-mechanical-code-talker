// corpus/courtesy.mjs — the throttle, cool-off and cache machinery shared by
// every live adapter that fetches a third party: the research sources
// (wikipedia-live.mjs, wikidata-live.mjs, wiktionary-live.mjs,
// dbpedia-lookup-live.mjs) and the news sources (news-sources.mjs). One
// in-flight fetch at a time, a minimum interval between round trips, a
// 429/maxlag cool-off honouring Retry-After, an abort timeout on every fetch,
// optional ETag/Last-Modified conditional-request memory, and a cache that
// keeps hits AND misses so a term is never asked twice. Every failure of any
// kind reads as null, so the caller's honest miss stands.
//
// The gate also counts what its fetches cost and what they hit: how many round
// trips a turn has spent, and how many of its failures said the source itself
// is struggling. The first bounds a turn (`beginTurn` opens the budget window,
// and a turn past its cap stops fetching and misses honestly); the second is
// what a source's circuit breaker reads through `stats()`, so an empty answer
// and a timing-out source never look alike to it.
//
// No node builtins — this module ships in the browser bundles unchanged; the
// only I/O is fetch.

import { isSystemicSourceStatus } from "../../domain/source-breaker.mjs";

/** The abort timeout on every single fetch: one source's slowness costs a turn
 *  this much and no more. */
export const DEFAULT_TIMEOUT_MS = 4000;
export const DEFAULT_MIN_INTERVAL_MS = 2000;
export const RETRY_AFTER_FLOOR_MS = 5000;
/** How many round trips one turn may spend on a single source. A live
 *  reference lookup costs two (search, then read), a research step three at
 *  most, so the cap sits above what an honest turn needs and below what a
 *  retrying loop could spend. Only counted once a caller declares a turn. */
export const DEFAULT_MAX_FETCHES_PER_TURN = 6;
// Action-API requests carry maxlag so an overloaded replica set answers with
// an error we back off from instead of adding to its load (Wikimedia's own
// recommended default for non-interactive clients).
export const MAXLAG_SECONDS = 5;

/**
 * One adapter instance's courtesy state: `{ fetchJson(url), fetchText(url),
 * cachedFetch(key, work) }`. Every option a caller passes wins, so a test can
 * hand it a zero interval and a stub transport.
 *
 * `waitForSlot` picks the throttle posture: false answers null the moment a
 * slot is unavailable (never block a chat turn), true waits for it (a queue
 * paced turn-by-turn, where a false miss would be dishonest).
 *
 * `validators`, when given, is a Map the CALLER owns (keyed by URL) that this
 * gate reads an `{ etag, lastModified }` entry from before every request —
 * sent as `If-None-Match` / `If-Modified-Since` — and writes back to after
 * every 2xx response that carries an ETag or Last-Modified header. A 304
 * answers `{ notModified: true }` instead of the usual body, so a caller can
 * tell "nothing changed" apart from "the source failed" apart from "here is
 * the new body". Without `validators` this is all inert: no conditional
 * headers go out, and a 304 (which no server sends without them) falls
 * through the ordinary `!res.ok` path to null exactly as before.
 */
export function createCourtesyGate({
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  retryAfterFloorMs = RETRY_AFTER_FLOOR_MS,
  maxFetchesPerTurn = DEFAULT_MAX_FETCHES_PER_TURN,
  userAgent,
  waitForSlot = false,
  validators = null,
} = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const cache = new Map(); // key -> value | null (hits AND settled misses)
  let lastLookupAt = 0;
  let coolOffUntil = 0;
  let inFlight = false;
  let fetches = 0;
  let systemicFailures = 0;
  let fetchesThisTurn = 0;
  let turnBudgetOpen = false;
  let budgetExhausted = false;

  const identifyingHeaders = () => {
    if (!userAgent) return null;
    const headers = { "Api-User-Agent": userAgent };
    // A browser strips User-Agent as a forbidden header; only set it where no
    // DOM says we are one (Node ships a global `navigator` these days, so
    // `document` is the discriminating global).
    if (typeof document === "undefined") headers["User-Agent"] = userAgent;
    return headers;
  };

  function openCoolOff(retryAfterSeconds) {
    const retryAfterMs = Number(retryAfterSeconds) * 1000;
    coolOffUntil = Date.now() + Math.max(retryAfterMs || 0, retryAfterFloorMs);
  }

  /** The conditional-request headers this URL's remembered validator earns,
   *  or null when there is none yet (first fetch of this URL, or no
   *  `validators` map at all). */
  function conditionalHeaders(url) {
    const entry = validators?.get(url);
    if (!entry) return null;
    const headers = {};
    if (entry.etag) headers["If-None-Match"] = entry.etag;
    if (entry.lastModified) headers["If-Modified-Since"] = entry.lastModified;
    return Object.keys(headers).length ? headers : null;
  }

  /** Remember this URL's validator off a 2xx response, so the NEXT fetch of
   *  it can ask "did this change" instead of paying for the whole body. */
  function rememberValidators(url, res) {
    if (!validators) return;
    const etag = res.headers?.get?.("etag") ?? "";
    const lastModified = res.headers?.get?.("last-modified") ?? "";
    if (!etag && !lastModified) return;
    const prior = validators.get(url) ?? {};
    validators.set(url, { etag: etag || prior.etag || "", lastModified: lastModified || prior.lastModified || "" });
  }

  /** One GET, with the abort timeout, the 429/maxlag cool-off and the
   *  conditional-request dance all wired in. Any failure of any kind —
   *  network, non-2xx, unparseable body — reads as null; a 304 reads as
   *  `{ notModified: true }`, but only when `validators` is in play (nothing
   *  else could have earned a 304 in the first place). `asJson` picks the
   *  body shape: parsed JSON (with the maxlag check) or raw text. */
  async function fetchRaw(url, { asJson }) {
    if (turnBudgetOpen && fetchesThisTurn >= maxFetchesPerTurn) {
      budgetExhausted = true;
      return null;
    }
    fetches += 1;
    fetchesThisTurn += 1;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const opts = {};
      if (controller) opts.signal = controller.signal;
      const headers = { ...(identifyingHeaders() ?? {}), ...(conditionalHeaders(url) ?? {}) };
      if (Object.keys(headers).length) opts.headers = headers;
      let res;
      try {
        res = await doFetch(url, opts);
      } catch {
        // Nothing came back at all: a dropped connection, a refused host, or
        // this fetch's own abort timer. Every one of those is the source
        // failing, not answering.
        systemicFailures += 1;
        return null;
      }
      if (res.status === 429) {
        openCoolOff(res.headers?.get?.("retry-after"));
        systemicFailures += 1;
        return null;
      }
      if (res.status === 304) return validators ? { notModified: true } : null;
      if (!res.ok) {
        // A 404 for a term nobody wrote about is an answer; a 5xx is not.
        if (isSystemicSourceStatus(res.status)) systemicFailures += 1;
        return null;
      }
      rememberValidators(url, res);
      if (asJson) {
        const body = await res.json();
        // A maxlag rejection arrives as HTTP 200 with an error body and a
        // Retry-After header — back off exactly as a 429 asks.
        if (body?.error?.code === "maxlag") {
          openCoolOff(res.headers?.get?.("retry-after"));
          systemicFailures += 1;
          return null;
        }
        return body;
      }
      return await res.text();
    } catch {
      // The response arrived and its body did not. A body cut off by this
      // fetch's own timer is the source failing; an unparseable one is just
      // an answer we cannot use.
      if (controller?.signal?.aborted) systemicFailures += 1;
      return null;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function fetchJson(url) {
    return fetchRaw(url, { asJson: true });
  }

  /** Same slot, cool-off, timeout and conditional-request handling as
   *  fetchJson, returning the raw body text instead of a parsed object — what
   *  every feed format (RSS/Atom/JSON Feed) needs, since JSON Feed is the only
   *  one of the three worth parsing before this layer hands it over. */
  async function fetchText(url) {
    return fetchRaw(url, { asJson: false });
  }

  /** When the next network slot opens: past the cool-off, past the minimum
   *  interval since the last taken slot. */
  const slotOpensAt = () => Math.max(coolOffUntil, lastLookupAt + minIntervalMs);

  /** Take the one network slot, or report it unavailable. Default posture
   *  returns false immediately; `waitForSlot` sleeps until the slot opens
   *  instead. */
  async function takeSlot() {
    for (;;) {
      const now = Date.now();
      if (!inFlight && now >= slotOpensAt()) {
        lastLookupAt = now;
        inFlight = true;
        return true;
      }
      if (!waitForSlot) return false;
      await new Promise((resolve) => setTimeout(resolve, Math.max(slotOpensAt() - now, 25)));
    }
  }

  /** One slot-gated operation: cache first (a settled hit or miss is never
   *  refetched), then the slot, then `work()`, with every failure cached as
   *  null so it never costs a second round trip.
   *
   *  `remember: false` skips the cache write (the poll loop's use: a live
   *  feed must re-fetch every cycle, never answer from a stale hit), while
   *  still gating `work()` behind the slot — so a caller that needs "paced,
   *  but never stale" (every feed poller in news-sources.mjs) still gets the
   *  minInterval spacing between successive calls, just without the
   *  answer-forever memory a term lookup wants. */
  async function cachedFetch(cacheKey, work, { remember = true } = {}) {
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (!(await takeSlot())) return null;
    let value = null;
    try {
      value = await work();
    } catch {
      value = null;
    } finally {
      inFlight = false;
    }
    if (remember) cache.set(cacheKey, value);
    return value;
  }

  /** Opens this gate's per-turn fetch budget and resets its count. A caller
   *  that never calls this spends no budget at all — a library consumer with
   *  no turn boundary keeps today's behaviour, and the cap applies exactly
   *  where a turn declares itself. */
  function beginTurn() {
    turnBudgetOpen = true;
    fetchesThisTurn = 0;
    budgetExhausted = false;
  }

  /** What this gate has spent and hit since it was created. `fetches` and
   *  `systemicFailures` only ever climb, so a caller reads them either side of
   *  one lookup and takes the difference. */
  function stats() {
    return { fetches, systemicFailures, fetchesThisTurn, budgetExhausted };
  }

  return { fetchJson, fetchText, cachedFetch, beginTurn, stats };
}
