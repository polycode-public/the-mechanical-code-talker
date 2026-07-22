// corpus/wikipedia-live.mjs — the OPT-IN live Wikipedia lookup behind the
// clean-miss gate: two small GET round trips against en.wikipedia.org (an
// opensearch title match, then the REST page summary), mapped into the same
// article-row shape the shipped reference pack uses. No node builtins — this
// module ships in the browser bundle unchanged; the only I/O is fetch.
//
// Courtesy is structural, not advisory: one in-flight lookup at a time, a
// minimum interval between network round trips, a 429 cool-off honouring
// Retry-After, an abort timeout on every fetch, and a cache that keeps hits
// AND misses so a term is never asked twice. Every failure of any kind reads
// as null — the caller's honest miss stands byte-identical.
//
// The provider seam mirrors reference-pack.mjs's: registerLiveReferenceProvider
// swaps the whole lookup behind one async { lookup(normTerm) } contract (tests
// and the demo page stub it); null restores the default provider below.
//
// The research lane rides the same provider factory against
// simple.wikipedia.org (registerResearchProvider/getResearchProvider below),
// adding two fan-out reads: pageByTitle (an exact linked title costs ONE
// round trip, no opensearch) and linkedTitles (the lead section's
// namespace-0 links, document-ordered). Requests identify themselves per
// Wikimedia's robot etiquette (WIKIMEDIA_USER_AGENT) and carry maxlag so an
// overloaded replica set is backed off from, not hammered.

import { normFactTerm } from "../../domain/hash.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { isReferenceArticleRow, sentencesUpTo, isaOf, SUMMARY_CHAR_CAP } from "../../domain/reference-pack.mjs";

export const WIKIPEDIA_LIVE_ORIGIN = "https://en.wikipedia.org";
export const SIMPLE_WIKIPEDIA_ORIGIN = "https://simple.wikipedia.org";

/** The identification string Wikimedia's robot policy asks API clients to
 *  carry, pointing at this project's public site as the contact. Browsers
 *  refuse to override the User-Agent request header, so the API-recognised
 *  Api-User-Agent header carries the same string there; under Node both are
 *  sent. */
export const WIKIMEDIA_USER_AGENT = "the-mechanical-code-talker (+https://polycode-projects.gitlab.io/the-mechanical-code-talker/)";

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MIN_INTERVAL_MS = 2000;
const RETRY_AFTER_FLOOR_MS = 5000;
// Action-API requests carry maxlag so an overloaded replica set answers with
// an error we back off from instead of adding to its load (Wikimedia's own
// recommended default for non-interactive clients).
const MAXLAG_SECONDS = 5;

/**
 * A live-lookup provider: { lookup(normTerm) -> article row | null }, plus
 * the research fan-out surface: pageByTitle(title) fetches an exact title's
 * summary in ONE round trip (no opensearch — a linked title is already
 * exact), and linkedTitles(title) lists the namespace-0 articles the page's
 * LEAD section links to, in document order.
 *
 * `fetchImpl` defaults to the global fetch; `origin` to en.wikipedia.org;
 * `lexicon` (optional) feeds the isa extraction. The row shape is the shipped
 * pack's own ({ term, title, text, summary, url, revid, isa? }), validated by
 * isReferenceArticleRow before it is ever returned.
 *
 * Throttle posture: every public method takes one "slot" gated by the
 * minimum interval, the single-flight guard and any open cool-off. By
 * default a caller that asks too soon gets null (the chat's clean-miss hook
 * must never block a turn); with `waitForSlot: true` the method WAITS for
 * the slot instead — the research queue's posture, where a false miss would
 * be dishonest and the caller is already paced turn-by-turn.
 */
export function createWikipediaLiveProvider({
  fetchImpl,
  origin = WIKIPEDIA_LIVE_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  lexicon = null,
  userAgent = WIKIMEDIA_USER_AGENT,
  waitForSlot = false,
} = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const cache = new Map(); // key -> row | null (hits AND settled misses)
  let lastLookupAt = 0;
  let coolOffUntil = 0;
  let inFlight = false;

  const identifyingHeaders = () => {
    if (!userAgent) return null;
    const headers = { "Api-User-Agent": userAgent };
    // A browser strips User-Agent as a forbidden header; only set it where
    // no DOM says we are one (Node ships a global `navigator` these days, so
    // `document` is the discriminating global).
    if (typeof document === "undefined") headers["User-Agent"] = userAgent;
    return headers;
  };

  function openCoolOff(retryAfterSeconds) {
    const retryAfterMs = Number(retryAfterSeconds) * 1000;
    coolOffUntil = Date.now() + Math.max(retryAfterMs || 0, RETRY_AFTER_FLOOR_MS);
  }

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
      // A maxlag rejection arrives as HTTP 200 with an error body (and a
      // Retry-After header) — back off exactly as a 429 asks.
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
   *  returns false immediately (the clean-miss hook's "null, never block");
   *  `waitForSlot` sleeps until the slot opens instead. */
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

  /** The opensearch title whose normFactTerm fold equals or extends the key —
   *  the topic-drift guard: "quasar" may resolve to "Quasar" or "Quasars",
   *  never to a first suggestion about something else. */
  function matchingTitle(key, searchResult) {
    const titles = Array.isArray(searchResult?.[1]) ? searchResult[1] : [];
    for (const title of titles) {
      const folded = normFactTerm(title);
      if (folded === key || folded.startsWith(key)) return String(title);
    }
    return null;
  }

  async function summaryRow(key, title) {
    const summary = await fetchJson(
      `${origin}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    );
    if (!summary) return null;
    const extract = String(summary.extract ?? "");
    const revid = Number(summary.revision);
    const row = {
      term: key,
      title: String(summary.title ?? title),
      text: extract,
      summary: sentencesUpTo(extract, SUMMARY_CHAR_CAP),
      url: String(summary.content_urls?.desktop?.page ?? `${origin}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`),
      revid,
    };
    let lex = lexicon;
    if (!lex) { try { lex = loadLexicon(); } catch { lex = null; } }
    const isa = lex ? isaOf(extract, lex) : null;
    if (isa) row.isa = isa;
    return isReferenceArticleRow(row) ? row : null;
  }

  async function roundTrips(key) {
    const search = await fetchJson(
      `${origin}/w/api.php?action=opensearch&format=json&origin=*&maxlag=${MAXLAG_SECONDS}&search=${encodeURIComponent(key)}&limit=3`,
    );
    const title = search ? matchingTitle(key, search) : null;
    if (!title) return null;
    return summaryRow(key, title);
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

  return {
    async lookup(normTerm) {
      const key = String(normTerm ?? "");
      if (!key) return null;
      return cachedFetch(key, () => roundTrips(key));
    },

    /** The summary for an EXACT title — one round trip, no opensearch. The
     *  research queue's depth-1 fetch: a linked title came from the wiki
     *  itself, so the fuzzy title match would only waste a request. */
    async pageByTitle(title) {
      const t = String(title ?? "").trim();
      if (!t) return null;
      return cachedFetch(`title\0${normFactTerm(t)}`, () => summaryRow(normFactTerm(t), t));
    },

    /** The namespace-0 articles the page's LEAD section links to, in document
     *  order, capped at `limit`. One action-API round trip
     *  (action=parse&prop=links&section=0): the lead is the smallest payload
     *  that still orders links by how the article introduces its topic —
     *  a full-page prop=links listing is alphabetical, which would make the
     *  fan-out pick by spelling instead of relevance. Null on any failure. */
    async linkedTitles(title, { limit = 25 } = {}) {
      const t = String(title ?? "").trim();
      if (!t) return null;
      const listed = await cachedFetch(`links\0${normFactTerm(t)}`, async () => {
        const parsed = await fetchJson(
          `${origin}/w/api.php?action=parse&format=json&formatversion=2&origin=*&maxlag=${MAXLAG_SECONDS}&prop=links&redirects=1&page=${encodeURIComponent(t)}&section=0`,
        );
        const links = parsed?.parse?.links;
        if (!Array.isArray(links)) return null;
        const seen = new Set();
        const out = [];
        for (const link of links) {
          if (!link || link.ns !== 0 || link.exists === false) continue;
          const linkTitle = String(link.title ?? link["*"] ?? "").trim();
          const folded = normFactTerm(linkTitle);
          if (!linkTitle || !folded || seen.has(folded)) continue;
          seen.add(folded);
          out.push(linkTitle);
        }
        return out;
      });
      return Array.isArray(listed) ? listed.slice(0, Math.max(0, limit)) : null;
    },
  };
}

let defaultProvider = null;
let registeredProvider = null;

/** Swap the live lookup: provider = { lookup: async (normTerm) => row|null }.
 *  Pass null to restore the default en.wikipedia.org provider. */
export function registerLiveReferenceProvider(provider) {
  registeredProvider = provider && typeof provider.lookup === "function" ? provider : null;
}

/** The active provider — the registered one, else one lazily created default
 *  provider shared by every caller (its cache and throttle are what make the
 *  lookup polite, so it must be a singleton). */
export function getLiveReferenceProvider() {
  if (registeredProvider) return registeredProvider;
  if (!defaultProvider) defaultProvider = createWikipediaLiveProvider();
  return defaultProvider;
}

// ---- the research lane's provider: Simple English Wikipedia, waiting slots --

let defaultResearchProvider = null;
let registeredResearchProvider = null;

/** Swap the research lane's lookup: provider = { lookup, pageByTitle,
 *  linkedTitles } (tests and the demo pages stub it, same seam shape as
 *  registerLiveReferenceProvider). Pass null to restore the default
 *  simple.wikipedia.org provider. */
export function registerResearchProvider(provider) {
  registeredResearchProvider = provider && typeof provider.lookup === "function" ? provider : null;
}

/** The research lane's active provider — the registered one, else one lazily
 *  created singleton against simple.wikipedia.org with `waitForSlot` on: the
 *  queue is paced turn-by-turn, so a throttled step WAITS for its polite slot
 *  rather than reporting a false miss. `minIntervalMs` (first call only —
 *  the singleton keeps its throttle clock) can only ever RAISE the interval;
 *  the shipped minimum stays the floor. */
export function getResearchProvider({ minIntervalMs } = {}) {
  if (registeredResearchProvider) return registeredResearchProvider;
  if (!defaultResearchProvider) {
    defaultResearchProvider = createWikipediaLiveProvider({
      origin: SIMPLE_WIKIPEDIA_ORIGIN,
      waitForSlot: true,
      minIntervalMs: Math.max(DEFAULT_MIN_INTERVAL_MS, Number(minIntervalMs) || 0),
    });
  }
  return defaultResearchProvider;
}
