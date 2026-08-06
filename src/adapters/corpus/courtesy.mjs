// corpus/courtesy.mjs — the throttle, cool-off and cache machinery shared by
// every live research adapter that talks to a Wikimedia API (wikipedia-live.mjs,
// wikidata-live.mjs): one in-flight fetch at a time, a minimum interval between
// round trips, a 429/maxlag cool-off honouring Retry-After, an abort timeout on
// every fetch, and a cache that keeps hits AND misses so a term is never asked
// twice. Every failure of any kind reads as null, so the caller's honest miss
// stands.
//
// No node builtins — this module ships in the browser bundles unchanged; the
// only I/O is fetch.

export const DEFAULT_TIMEOUT_MS = 4000;
export const DEFAULT_MIN_INTERVAL_MS = 2000;
export const RETRY_AFTER_FLOOR_MS = 5000;
// Action-API requests carry maxlag so an overloaded replica set answers with
// an error we back off from instead of adding to its load (Wikimedia's own
// recommended default for non-interactive clients).
export const MAXLAG_SECONDS = 5;

/**
 * One adapter instance's courtesy state: `{ fetchJson(url), cachedFetch(key,
 * work) }`. Every option a caller passes wins, so a test can hand it a zero
 * interval and a stub transport.
 *
 * `waitForSlot` picks the throttle posture: false answers null the moment a
 * slot is unavailable (never block a chat turn), true waits for it (a queue
 * paced turn-by-turn, where a false miss would be dishonest).
 */
export function createCourtesyGate({
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  retryAfterFloorMs = RETRY_AFTER_FLOOR_MS,
  userAgent,
  waitForSlot = false,
} = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const cache = new Map(); // key -> value | null (hits AND settled misses)
  let lastLookupAt = 0;
  let coolOffUntil = 0;
  let inFlight = false;

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

  /** One GET, JSON-parsed, with the abort timeout and the 429/maxlag cool-off
   *  wired in. Any failure of any kind — network, non-2xx, unparseable body —
   *  reads as null. */
  async function fetchJson(url) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const opts = {};
      if (controller) opts.signal = controller.signal;
      const headers = identifyingHeaders();
      if (headers) opts.headers = headers;
      const res = await doFetch(url, opts);
      if (res.status === 429) {
        openCoolOff(res.headers?.get?.("retry-after"));
        return null;
      }
      if (!res.ok) return null;
      const body = await res.json();
      // A maxlag rejection arrives as HTTP 200 with an error body and a
      // Retry-After header — back off exactly as a 429 asks.
      if (body?.error?.code === "maxlag") {
        openCoolOff(res.headers?.get?.("retry-after"));
        return null;
      }
      return body;
    } catch {
      return null;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
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

  /** One slot-gated, cached operation: cache first (a settled hit or miss is
   *  never refetched), then the slot, then `work()`, with every failure
   *  cached as null so it never costs a second round trip. */
  async function cachedFetch(cacheKey, work) {
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
    cache.set(cacheKey, value);
    return value;
  }

  return { fetchJson, cachedFetch };
}
