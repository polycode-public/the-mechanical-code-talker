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
import {
  registerResearchSource,
  researchSourceTag,
  researchSources,
  researchSourceNameFor,
  normalizeResearchChoice,
} from "./research-source.mjs";
import { createCourtesyGate, DEFAULT_TIMEOUT_MS, DEFAULT_MIN_INTERVAL_MS, MAXLAG_SECONDS } from "./courtesy.mjs";

export const WIKIPEDIA_LIVE_ORIGIN = "https://en.wikipedia.org";
export const SIMPLE_WIKIPEDIA_ORIGIN = "https://simple.wikipedia.org";

/** The names these two providers go by as research SOURCES
 *  (research-source.mjs): the name segment of every provenance tag their facts
 *  carry, and the key each registers under. */
export const WIKIPEDIA_LIVE_SOURCE_NAME = "wikipedia-live";
export const SIMPLE_WIKIPEDIA_SOURCE_NAME = "simple-wikipedia";

/** The identification string Wikimedia's robot policy asks API clients to
 *  carry, pointing at this project's public site as the contact. Browsers
 *  refuse to override the User-Agent request header, so the API-recognised
 *  Api-User-Agent header carries the same string there; under Node both are
 *  sent. */
export const WIKIMEDIA_USER_AGENT = "the-mechanical-code-talker (+https://tmct.polycode.co.uk/)";

/**
 * A live-lookup provider: { lookup(normTerm) -> article row | null }, plus
 * the research fan-out surface: pageByTitle(title) fetches an exact title's
 * summary in ONE round trip (no opensearch — a linked title is already
 * exact), and linkedTitles(title) lists the namespace-0 articles the page's
 * LEAD section links to, in document order. It also carries the research
 * source contract (research-source.mjs): `name`, `origin` and
 * `provenanceTag(term)`.
 *
 * `fetchImpl` defaults to the global fetch; `origin` to en.wikipedia.org;
 * `sourceName` to the en.wikipedia source name; `lexicon` (optional) feeds the
 * isa extraction. The row shape is the shipped pack's own ({ term, title,
 * text, summary, url, revid, isa? }), validated by isReferenceArticleRow
 * before it is ever returned.
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
  sourceName = WIKIPEDIA_LIVE_SOURCE_NAME,
} = {}) {
  const gate = createCourtesyGate({ fetchImpl, timeoutMs, minIntervalMs, userAgent, waitForSlot });

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
    const summary = await gate.fetchJson(
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
    const search = await gate.fetchJson(
      `${origin}/w/api.php?action=opensearch&format=json&origin=*&maxlag=${MAXLAG_SECONDS}&search=${encodeURIComponent(key)}&limit=3`,
    );
    const title = search ? matchingTitle(key, search) : null;
    if (!title) return null;
    return summaryRow(key, title);
  }

  return {
    name: sourceName,
    origin,

    /** The tag a fact gained through the research source contract carries. The
     *  research lane stamps its own `research:<topic>@<depth>` tag instead when
     *  it ingests, because only the lane knows how far its fan-out reached. */
    provenanceTag(term) {
      return researchSourceTag(sourceName, term);
    },

    async lookup(normTerm) {
      const key = String(normTerm ?? "");
      if (!key) return null;
      return gate.cachedFetch(key, () => roundTrips(key));
    },

    /** The summary for an EXACT title — one round trip, no opensearch. The
     *  research queue's depth-1 fetch: a linked title came from the wiki
     *  itself, so the fuzzy title match would only waste a request. */
    async pageByTitle(title) {
      const t = String(title ?? "").trim();
      if (!t) return null;
      return gate.cachedFetch(`title\0${normFactTerm(t)}`, () => summaryRow(normFactTerm(t), t));
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
      const listed = await gate.cachedFetch(`links\0${normFactTerm(t)}`, async () => {
        const parsed = await gate.fetchJson(
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

const researchProvidersByChoice = new Map();

function defaultSimpleWikipediaProvider(minIntervalMs) {
  if (!defaultResearchProvider) {
    defaultResearchProvider = createSimpleWikipediaResearchSource({
      minIntervalMs: Math.max(DEFAULT_MIN_INTERVAL_MS, Number(minIntervalMs) || 0),
    });
  }
  return defaultResearchProvider;
}

/** The research lane's active provider — the registered one, else the source
 *  the config `source` choice names, each a lazily created singleton against
 *  its own origin with `waitForSlot` on: the queue is paced turn-by-turn, so a
 *  throttled step WAITS for its polite slot rather than reporting a false
 *  miss. `minIntervalMs` (first call only — the singleton keeps its throttle
 *  clock) can only ever RAISE the interval; the shipped minimum stays the
 *  floor. A registered provider (registerResearchProvider) wins outright,
 *  before any source resolution — every existing caller that never passes
 *  `source` keeps today's simple.wikipedia.org default unchanged. */
export function getResearchProvider({ minIntervalMs, source } = {}) {
  if (registeredResearchProvider) return registeredResearchProvider;
  const choice = normalizeResearchChoice(source);
  if (choice === "wikipedia") return defaultSimpleWikipediaProvider(minIntervalMs);
  if (researchProvidersByChoice.has(choice)) return researchProvidersByChoice.get(choice);
  const entry = researchSources().find((e) => e.name === researchSourceNameFor(choice));
  const provider = entry
    ? entry.create({ minIntervalMs: Math.max(DEFAULT_MIN_INTERVAL_MS, Number(minIntervalMs) || 0) })
    : defaultSimpleWikipediaProvider(minIntervalMs);
  researchProvidersByChoice.set(choice, provider);
  return provider;
}

/** The Simple English Wikipedia research source: the same provider, named and
 *  origin-pinned for the research-source registry, with `waitForSlot` on. Every
 *  option the caller passes wins, so a test can hand it a stub transport and a
 *  zero interval. */
export function createSimpleWikipediaResearchSource(options = {}) {
  return createWikipediaLiveProvider({
    origin: SIMPLE_WIKIPEDIA_ORIGIN,
    sourceName: SIMPLE_WIKIPEDIA_SOURCE_NAME,
    waitForSlot: true,
    ...options,
  });
}

registerResearchSource({
  name: SIMPLE_WIKIPEDIA_SOURCE_NAME,
  create: createSimpleWikipediaResearchSource,
});
