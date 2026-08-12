// corpus/wikidata-live.mjs — the live Wikidata research source. Small GET
// round trips against www.wikidata.org's Action API, mapped onto tmct's
// seed-ontology relations at THIS boundary and nowhere else: everything
// downstream reads ordinary tmct facts and never learns the word "Wikidata".
//
// Why the Action API rather than the SPARQL query service: wbsearchentities
// then wbgetentities is the same two-step shape wikipedia-live.mjs already
// uses (find the item, then read it). It answers in plain JSON, with no query
// language to escape per lookup, and it carries maxlag like every other
// Wikimedia action request. The query service would need its own endpoint, its
// own rate policy and a SPARQL string built per term.
//
// The round trips:
//   1. wbsearchentities — every candidate item whose English label matches
//                         the term, best fold first.
//   2. wbgetentities    — a candidate's label, description, revision, claims.
//   3. wbgetentities    — the English labels of that candidate's mapped
//                         claims' object items, batched into ONE request. A
//                         claim's value is a Q-id, and a stored fact's object
//                         has to be a human term. Skipped when nothing
//                         mapped.
// Steps 2 and 3 repeat, candidate by candidate, only while the current one
// turns out to be a media or document work sharing the term's name rather
// than the term itself — the common case still costs three round trips.
//
// Courtesy is structural, mirroring wikipedia-live.mjs: one in-flight lookup
// at a time, a minimum interval between round trips, a 429/maxlag cool-off
// honouring Retry-After, an abort timeout on every fetch, and a cache that
// keeps hits AND misses so a term is never asked twice. Every failure of any
// kind reads as null, so the caller's honest miss stands.
//
// No node builtins — this module ships in the browser bundles unchanged; the
// only I/O is fetch.

import { normFactTerm } from "../../domain/hash.mjs";
import { sentencesUpTo, SUMMARY_CHAR_CAP } from "../../domain/reference-pack.mjs";
import { isResearchSourceRow, registerResearchSource, researchSourceTag } from "./research-source.mjs";
import { createCourtesyGate, DEFAULT_TIMEOUT_MS, DEFAULT_MIN_INTERVAL_MS, MAXLAG_SECONDS } from "./courtesy.mjs";

export const WIKIDATA_LIVE_ORIGIN = "https://www.wikidata.org";
export const WIKIDATA_SOURCE_NAME = "wikidata";

/** The citation this source's rows carry, overriding the reference pack's
 *  Wikipedia defaults (isReferenceArticleRow's optional source/licence fields,
 *  which renderReferenceAnswer reads). Wikidata publishes its statements under
 *  CC0, not the CC BY-SA the encyclopedia text uses. */
export const WIKIDATA_SOURCE_LABEL = "Wikidata";
export const WIKIDATA_LICENCE = "CC0 1.0";

/** The identification string Wikimedia's robot policy asks API clients to
 *  carry. Browsers refuse to override User-Agent, so the API-recognised
 *  Api-User-Agent header carries the same string there. */
export const WIKIDATA_USER_AGENT = "the-mechanical-code-talker (+https://tmct.polycode.co.uk/)";

/**
 * The Wikidata property → tmct relation map: the ONE place this adapter aligns
 * Wikidata with the seed ontology. A property with no row here is not read at
 * all, and adding a row is the whole change needed to gain a relation. So the
 * alignment reads as a table rather than scattered through the parser. Every
 * target is a member of RESEARCH_SOURCE_RELATIONS.
 */
export const WIKIDATA_PROPERTY_RELATIONS = Object.freeze({
  P31: "rdf:type",           // instance of
  P279: "rdfs:subClassOf",   // subclass of
  P361: "mgx:partOf",        // part of
  P527: "mgx:hasA",          // has part(s)
  P186: "mgx:madeOf",        // made from material
  P366: "mgx:usedFor",       // has use
  P276: "mgx:atLocation",    // location
  P1542: "mgx:causes",       // has effect
  P170: "mgx:createdBy",     // creator
  P2670: "mgx:hasA",         // has part(s) of the class
});

// The properties whose object is the item's own category, best first: what
// row.isa reads off, so the chat ingest path stores the same subClassOf edge
// it would store from a prose lead sentence.
const ISA_PROPERTIES = ["P279", "P31"];

// A closed list of Wikidata item classes that name a media or document work,
// not the everyday concept a term search asked for. A search on "canadian
// companies" or "continents" can land on a paper or an album that merely
// SHARES the term's name — Wikidata's own title match, not a definition.
// Folded through normFactTerm the same way every isa term is, so the check
// compares like with like. Each class is a Wikidata English label read
// straight off the item, not a guess at one — refine this list from what
// Wikidata actually returns, keep it named and small.
const MEDIA_WORK_CLASSES = new Set([
  "scholarly article",
  "album",
  "song",
  "single",
  "film",
  "television series",
  "television series episode",
  "band",
  "musical group",
  "video game",
  "book",
  "novel",
]);

// How much of one item a single lookup reads: at most this many object values
// per property, and this many facts in total. A busy item like "human" carries
// hundreds of statements, and a research lookup wants the shape of the thing,
// not its whole record.
const MAX_VALUES_PER_PROPERTY = 3;
const MAX_FACTS_PER_ITEM = 12;

const ITEM_ID_RE = /^Q[1-9][0-9]*$/;

/** Every candidate item whose English label folds onto the key, exact folds
 *  first then prefix folds, each group in the search result's own order — the
 *  topic-drift guard, matching wikipedia-live.mjs's: "quasar" may resolve to
 *  "quasar" or "quasars", never to the first suggestion about something else.
 *  An exact fold beats a prefix fold wherever it appears in the result list,
 *  so a search that ranks "Quasars (album)" above "quasar" still lands on the
 *  term the caller asked for first. Returning every candidate, not just the
 *  best one, lets the caller step to the next title match when the best one
 *  turns out to be a media work sharing the name. */
function candidateItemIds(key, body) {
  const results = Array.isArray(body?.search) ? body.search : [];
  const exact = [];
  const prefix = [];
  for (const hit of results) {
    const id = String(hit?.id ?? "");
    if (!ITEM_ID_RE.test(id)) continue;
    const folded = normFactTerm(hit?.label ?? "");
    if (folded === key) exact.push(id);
    else if (folded.startsWith(key)) prefix.push(id);
  }
  return [...exact, ...prefix];
}

/** Every mapped claim on an entity as {predicate, id} pairs, capped per
 *  property and in total. Only item-valued statements are read: a claim whose
 *  value is a date, a quantity or a string has no object term to store. */
function mappedClaims(entity) {
  const out = [];
  for (const [property, predicate] of Object.entries(WIKIDATA_PROPERTY_RELATIONS)) {
    const statements = entity?.claims?.[property];
    if (!Array.isArray(statements)) continue;
    let taken = 0;
    for (const statement of statements) {
      if (out.length >= MAX_FACTS_PER_ITEM) return out;
      if (taken >= MAX_VALUES_PER_PROPERTY) break;
      const snak = statement?.mainsnak;
      if (snak?.snaktype !== "value") continue;
      const id = String(snak?.datavalue?.value?.id ?? "");
      if (!ITEM_ID_RE.test(id)) continue;
      out.push({ property, predicate, id });
      taken += 1;
    }
  }
  return out;
}

/** The item's own category term, read off the first subclass-of (else
 *  instance-of) claim whose object label resolved. Null when neither did. */
function isaFrom(claims, termById, subject) {
  for (const property of ISA_PROPERTIES) {
    for (const claim of claims) {
      if (claim.property !== property) continue;
      const term = termById.get(claim.id);
      if (term && term !== subject) return term;
    }
  }
  return null;
}

/**
 * A live Wikidata research source: { name, origin, lookup(term),
 * provenanceTag(term) } — the research-source.mjs contract.
 *
 * `fetchImpl` defaults to the global fetch. `waitForSlot` picks the throttle
 * posture: false answers null the moment a slot is unavailable (never block a
 * chat turn), true waits for it (the research queue, which is paced
 * turn-by-turn and where a false miss would be dishonest).
 */
export function createWikidataLiveProvider({
  fetchImpl,
  origin = WIKIDATA_LIVE_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  userAgent = WIKIDATA_USER_AGENT,
  waitForSlot = false,
  sourceName = WIKIDATA_SOURCE_NAME,
} = {}) {
  const gate = createCourtesyGate({ fetchImpl, timeoutMs, minIntervalMs, userAgent, waitForSlot });

  const actionUrl = (params) =>
    `${origin}/w/api.php?${new URLSearchParams({ format: "json", origin: "*", maxlag: String(MAXLAG_SECONDS), ...params })}`;

  /** The English labels of a batch of item ids, folded to fact terms, in one
   *  round trip. An id whose label is missing simply drops out of the map, and
   *  the claim that named it drops with it. */
  async function termsForIds(ids) {
    const termById = new Map();
    if (!ids.length) return termById;
    const body = await gate.fetchJson(actionUrl({
      action: "wbgetentities",
      languages: "en",
      props: "labels",
      ids: ids.join("|"),
    }));
    for (const [id, entity] of Object.entries(body?.entities ?? {})) {
      const term = normFactTerm(entity?.labels?.en?.value ?? "");
      if (term) termById.set(id, term);
    }
    return termById;
  }

  /** The looked-up item, or null when every candidate that matched the
   *  search either has no readable entity or turns out to be a media/document
   *  work sharing the term's name — a media-class isa is a wrong identity, not
   *  a definition, so the caller steps to the next title match instead of
   *  accepting it. Exhausting every candidate this way is the term missing. */
  async function roundTrips(key) {
    const search = await gate.fetchJson(actionUrl({
      action: "wbsearchentities",
      language: "en",
      uselang: "en",
      type: "item",
      limit: "5",
      search: key,
    }));
    const candidateIds = search ? candidateItemIds(key, search) : [];

    for (const id of candidateIds) {
      const read = await gate.fetchJson(actionUrl({
        action: "wbgetentities",
        languages: "en",
        props: "labels|descriptions|claims|info",
        ids: id,
      }));
      const entity = read?.entities?.[id];
      if (!entity) continue;

      const claims = mappedClaims(entity);
      const termById = await termsForIds(claims.map((c) => c.id));
      const isa = isaFrom(claims, termById, key);
      if (isa && MEDIA_WORK_CLASSES.has(isa)) continue;

      const provenance = researchSourceTag(sourceName, key);
      const facts = [];
      const seen = new Set();
      for (const claim of claims) {
        const object = termById.get(claim.id);
        if (!object || object === key || seen.has(`${claim.predicate}\0${object}`)) continue;
        seen.add(`${claim.predicate}\0${object}`);
        facts.push({ subject: key, predicate: claim.predicate, object, provenance });
      }

      const description = String(entity.descriptions?.en?.value ?? "");
      const row = {
        term: key,
        title: String(entity.labels?.en?.value ?? ""),
        text: description,
        summary: sentencesUpTo(description, SUMMARY_CHAR_CAP),
        url: `${origin}/wiki/${id}`,
        revid: Number(entity.lastrevid),
        source: WIKIDATA_SOURCE_LABEL,
        licence: WIKIDATA_LICENCE,
      };
      if (isa) row.isa = isa;
      if (facts.length) row.facts = facts;
      if (isResearchSourceRow(row)) return row;
    }
    return null;
  }

  return {
    name: sourceName,
    origin,
    label: WIKIDATA_SOURCE_LABEL,

    /** Opens this source's per-turn fetch budget (courtesy.mjs). */
    beginTurn() { gate.beginTurn(); },

    /** The source's own running totals, including the failures that said the
     *  source itself is struggling — what a circuit breaker reads. */
    stats() { return gate.stats(); },

    /** The tag every fact this source contributes carries. */
    provenanceTag(term) {
      return researchSourceTag(sourceName, term);
    },

    /** One term's item as an article row, or null. Cache first (a settled hit
     *  or miss is never refetched), then the courtesy slot, then the round
     *  trips, with every failure cached as null so it costs one attempt. */
    async lookup(term) {
      const key = normFactTerm(term ?? "");
      if (!key) return null;
      return gate.cachedFetch(key, () => roundTrips(key));
    },
  };
}

/** The Wikidata research source with `waitForSlot` on: the research queue is
 *  paced turn-by-turn, so a throttled step waits for its polite slot rather
 *  than reporting a false miss. Every option the caller passes wins, so a test
 *  can hand it a stub transport and a zero interval. */
export function createWikidataResearchSource(options = {}) {
  return createWikidataLiveProvider({ waitForSlot: true, ...options });
}

registerResearchSource({
  name: WIKIDATA_SOURCE_NAME,
  create: createWikidataResearchSource,
});
