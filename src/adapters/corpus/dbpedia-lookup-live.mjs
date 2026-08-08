// corpus/dbpedia-lookup-live.mjs — the live DBpedia Lookup research source:
// one GET against lookup.dbpedia.org's ranked entity search, mapped into the
// shipped reference-pack article-row shape. The top hit's own category is the
// isa: DBpedia categories are DBpedia's OWN classification of the resource
// (not free text to parse), so there is no sentence to read a genus out of —
// unlike wiktionary-live.mjs, whose definitions are prose.
//
// Courtesy is structural, mirroring the other live research sources: one
// in-flight lookup at a time, a minimum interval between round trips, a 429
// cool-off honouring Retry-After, an abort timeout on every fetch, and a
// cache that keeps hits AND misses so a term is never asked twice. Every
// failure of any kind reads as null, so the caller's honest miss stands.
//
// No node builtins — this module ships in the browser bundles unchanged; the
// only I/O is fetch.

import { normFactTerm } from "../../domain/hash.mjs";
import { stripMarkup } from "../../domain/feed-normalize.mjs";
import { sentencesUpTo, SUMMARY_CHAR_CAP } from "../../domain/reference-pack.mjs";
import { isResearchSourceRow, registerResearchSource, researchSourceTag } from "./research-source.mjs";
import { createCourtesyGate, DEFAULT_TIMEOUT_MS, DEFAULT_MIN_INTERVAL_MS } from "./courtesy.mjs";

export const DBPEDIA_LOOKUP_ORIGIN = "https://lookup.dbpedia.org";
export const DBPEDIA_LOOKUP_SOURCE_NAME = "dbpedia-lookup";
export const DBPEDIA_LOOKUP_SOURCE_LABEL = "DBpedia";
export const DBPEDIA_LOOKUP_LICENCE = "CC BY-SA 3.0";

export const DBPEDIA_LOOKUP_USER_AGENT = "the-mechanical-code-talker (+https://tmct.polycode.co.uk/)";

// Lookup's search results carry no revision id of their own; the row shape
// needs a positive integer regardless, so every DBpedia row cites this fixed
// placeholder rather than a real revision.
const NO_REVISION_ID = 1;
const MAX_RESULTS = 5;

/** A category resource URI's local name, spaced and folded to a fact term:
 *  ".../resource/Category:Cardiac_anatomy" -> "cardiac anatomy". */
function categoryTerm(categoryUrl) {
  const local = String(categoryUrl ?? "").split("/").pop() ?? "";
  const name = local.replace(/^Category:/, "").replace(/_/g, " ").trim();
  return name ? normFactTerm(name) : null;
}

/**
 * A live DBpedia Lookup research source: { name, origin, lookup(term),
 * provenanceTag(term) } — the research-source.mjs contract.
 *
 * `fetchImpl` defaults to the global fetch. `waitForSlot` picks the throttle
 * posture: false answers null the moment a slot is unavailable (never block a
 * chat turn), true waits for it (the research queue and the news enrichment
 * loop, both paced turn-by-turn, where a false miss would be dishonest).
 */
export function createDbpediaLookupLiveProvider({
  fetchImpl,
  origin = DBPEDIA_LOOKUP_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  userAgent = DBPEDIA_LOOKUP_USER_AGENT,
  waitForSlot = false,
  sourceName = DBPEDIA_LOOKUP_SOURCE_NAME,
} = {}) {
  const gate = createCourtesyGate({ fetchImpl, timeoutMs, minIntervalMs, userAgent, waitForSlot });

  async function roundTrip(key) {
    const body = await gate.fetchJson(
      `${origin}/api/search?query=${encodeURIComponent(key)}&maxResults=${MAX_RESULTS}&format=json`,
    );
    const doc = Array.isArray(body?.docs) ? body.docs[0] : null;
    if (!doc) return null;
    const label = stripMarkup(String(doc.label?.[0] ?? ""));
    const comment = stripMarkup(String(doc.comment?.[0] ?? ""));
    const resourceUrl = String(doc.resource?.[0] ?? "");
    if (!label || !comment || !resourceUrl) return null;
    const row = {
      term: key,
      title: label,
      text: comment,
      summary: sentencesUpTo(comment, SUMMARY_CHAR_CAP),
      url: resourceUrl,
      revid: NO_REVISION_ID,
      source: DBPEDIA_LOOKUP_SOURCE_LABEL,
      licence: DBPEDIA_LOOKUP_LICENCE,
    };
    const isa = categoryTerm(Array.isArray(doc.category) ? doc.category[0] : null);
    if (isa && isa !== key) row.isa = isa;
    return isResearchSourceRow(row) ? row : null;
  }

  return {
    name: sourceName,
    origin,

    provenanceTag(term) {
      return researchSourceTag(sourceName, term);
    },

    async lookup(term) {
      const key = normFactTerm(term ?? "");
      if (!key) return null;
      return gate.cachedFetch(key, () => roundTrip(key));
    },
  };
}

/** The DBpedia Lookup research source with `waitForSlot` on: paced callers
 *  (the research queue, the news enrichment loop) wait for their polite slot
 *  rather than reporting a false miss. Every option the caller passes wins,
 *  so a test can hand it a stub transport and a zero interval. */
export function createDbpediaLookupResearchSource(options = {}) {
  return createDbpediaLookupLiveProvider({ waitForSlot: true, ...options });
}

registerResearchSource({
  name: DBPEDIA_LOOKUP_SOURCE_NAME,
  create: createDbpediaLookupResearchSource,
});
