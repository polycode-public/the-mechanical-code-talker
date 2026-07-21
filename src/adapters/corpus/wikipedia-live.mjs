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

import { normFactTerm } from "../../domain/hash.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { isReferenceArticleRow, sentencesUpTo, isaOf, SUMMARY_CHAR_CAP } from "../../domain/reference-pack.mjs";

export const WIKIPEDIA_LIVE_ORIGIN = "https://en.wikipedia.org";

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MIN_INTERVAL_MS = 2000;
const RETRY_AFTER_FLOOR_MS = 5000;

/**
 * A live-lookup provider: { lookup(normTerm) -> article row | null }.
 *
 * `fetchImpl` defaults to the global fetch; `origin` to en.wikipedia.org;
 * `lexicon` (optional) feeds the isa extraction. The row shape is the shipped
 * pack's own ({ term, title, text, summary, url, revid, isa? }), validated by
 * isReferenceArticleRow before it is ever returned.
 */
export function createWikipediaLiveProvider({
  fetchImpl,
  origin = WIKIPEDIA_LIVE_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  lexicon = null,
} = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const cache = new Map(); // key -> row | null (hits AND settled misses)
  let lastLookupAt = 0;
  let coolOffUntil = 0;
  let inFlight = false;

  async function fetchJson(url) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(url, controller ? { signal: controller.signal } : {});
      if (res.status === 429) {
        const retryAfterMs = Number(res.headers?.get?.("retry-after")) * 1000;
        coolOffUntil = Date.now() + Math.max(retryAfterMs || 0, RETRY_AFTER_FLOOR_MS);
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      if (timer !== null) clearTimeout(timer);
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

  async function roundTrips(key) {
    const search = await fetchJson(
      `${origin}/w/api.php?action=opensearch&format=json&origin=*&search=${encodeURIComponent(key)}&limit=3`,
    );
    const title = search ? matchingTitle(key, search) : null;
    if (!title) return null;
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

  return {
    async lookup(normTerm) {
      const key = String(normTerm ?? "");
      if (!key) return null;
      if (cache.has(key)) return cache.get(key);
      const now = Date.now();
      if (inFlight || now < coolOffUntil || now - lastLookupAt < minIntervalMs) return null;
      lastLookupAt = now;
      inFlight = true;
      let row = null;
      try {
        row = await roundTrips(key);
      } catch {
        row = null;
      } finally {
        inFlight = false;
      }
      cache.set(key, row);
      return row;
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
