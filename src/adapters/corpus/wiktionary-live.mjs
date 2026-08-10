// corpus/wiktionary-live.mjs — the live Wiktionary research source: one GET
// against en.wiktionary.org's REST definition endpoint, mapped into the
// shipped reference-pack article-row shape. A dictionary definition has no
// copula ("a heart is a...") to key off — it opens directly on the genus
// noun phrase ("a muscular organ that pumps blood...") — so the isa
// extraction here is its own small parse, not reference-pack.mjs's isaOf,
// which expects the sentence-with-copula shape a Wikipedia lead uses.
//
// Courtesy is structural, mirroring wikipedia-live.mjs and wikidata-live.mjs:
// one in-flight lookup at a time, a minimum interval between round trips, a
// 429 cool-off honouring Retry-After, an abort timeout on every fetch, and a
// cache that keeps hits AND misses so a term is never asked twice. Every
// failure of any kind reads as null, so the caller's honest miss stands.
//
// No node builtins — this module ships in the browser bundles unchanged; the
// only I/O is fetch.

import { normFactTerm } from "../../domain/hash.mjs";
import { stripMarkup } from "../../domain/feed-normalize.mjs";
import { isResearchSourceRow, registerResearchSource, researchSourceTag } from "./research-source.mjs";
import { createCourtesyGate, DEFAULT_TIMEOUT_MS, DEFAULT_MIN_INTERVAL_MS } from "./courtesy.mjs";

export const WIKTIONARY_LIVE_ORIGIN = "https://en.wiktionary.org";
export const WIKTIONARY_SOURCE_NAME = "wiktionary";
export const WIKTIONARY_SOURCE_LABEL = "Wiktionary";
export const WIKTIONARY_LICENCE = "CC BY-SA 3.0";

export const WIKTIONARY_USER_AGENT = "the-mechanical-code-talker (+https://tmct.polycode.co.uk/)";

// The definition endpoint has no revision id to cite (unlike the page-summary
// APIs wikipedia-live.mjs and wikidata-live.mjs read); the row shape needs a
// positive integer regardless, so every Wiktionary row cites this fixed
// placeholder rather than a real revision.
const NO_REVISION_ID = 1;

const GROUNDED_PARTS_OF_SPEECH = new Set(["noun", "verb"]);

/** Wiktionary's REST endpoint nests definitions by language code
 *  (`{ en: [...] }`) on the live API; a caller may also hand a flat array
 *  directly (the shape the committed test fixture uses). Both read the same
 *  way past this point. */
function definitionEntries(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") return Object.values(body).flat();
  return [];
}

/** The first English noun-or-verb sense's definition sentence, or "". */
function firstGroundedDefinition(body) {
  for (const entry of definitionEntries(body)) {
    if (entry?.language && entry.language !== "English") continue;
    if (!GROUNDED_PARTS_OF_SPEECH.has(String(entry?.partOfSpeech ?? "").toLowerCase())) continue;
    const definition = entry?.definitions?.[0]?.definition;
    if (typeof definition === "string" && definition.trim()) return stripMarkup(definition);
  }
  return "";
}

// Where the genus noun phrase ends: a second alternative ("a vent OR
// fissure..."), a relative clause, or a trailing modifier all carry detail
// past what the class itself is.
const GENUS_STOP = new Set([
  "or", "that", "which", "who", "whose", "used", "found", "made", "with",
  "in", "on", "for", "from", "by", "to", "and",
]);
const GENUS_WINDOW_CAP = 4;

/** The genus term a Wiktionary definition opens on: a leading "a"/"an"
 *  introduces the noun phrase, read word by word up to the first stop word,
 *  and the PHRASE'S HEAD is its last word — English noun phrases are
 *  head-final, so "a muscular organ that..." keeps "organ", not the
 *  adjective in front of it, while "a vent or fissure..." keeps "vent"
 *  because "or" stops the window at one word. Null when the definition does
 *  not open on an article at all — a verb-phrase or bare-plural definition
 *  names no single genus this parse can trust. */
function genusOf(definition) {
  const m = /^(?:a|an)\s+([a-z][\w' -]*)/i.exec(String(definition ?? "").trim());
  if (!m) return null;
  const window = [];
  for (const raw of m[1].split(/\s+/)) {
    const word = raw.toLowerCase().replace(/[.,;:]+$/, "");
    if (!word || GENUS_STOP.has(word)) break;
    window.push(word);
    if (window.length >= GENUS_WINDOW_CAP) break;
  }
  return window.length ? normFactTerm(window[window.length - 1]) : null;
}

/**
 * A live Wiktionary research source: { name, origin, lookup(term),
 * provenanceTag(term) } — the research-source.mjs contract.
 *
 * `fetchImpl` defaults to the global fetch. `waitForSlot` picks the throttle
 * posture: false answers null the moment a slot is unavailable (never block a
 * chat turn), true waits for it (the research queue and the news enrichment
 * loop, both paced turn-by-turn, where a false miss would be dishonest).
 */
export function createWiktionaryLiveProvider({
  fetchImpl,
  origin = WIKTIONARY_LIVE_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  userAgent = WIKTIONARY_USER_AGENT,
  waitForSlot = false,
  sourceName = WIKTIONARY_SOURCE_NAME,
} = {}) {
  const gate = createCourtesyGate({ fetchImpl, timeoutMs, minIntervalMs, userAgent, waitForSlot });

  async function roundTrip(key) {
    const body = await gate.fetchJson(
      `${origin}/api/rest_v1/page/definition/${encodeURIComponent(key)}`,
    );
    if (!body) return null;
    const definition = firstGroundedDefinition(body);
    if (!definition) return null;
    const row = {
      term: key,
      title: key,
      text: definition,
      summary: definition,
      url: `${origin}/wiki/${encodeURIComponent(key.replace(/ /g, "_"))}`,
      revid: NO_REVISION_ID,
      source: WIKTIONARY_SOURCE_LABEL,
      licence: WIKTIONARY_LICENCE,
    };
    const isa = genusOf(definition);
    if (isa && isa !== key) row.isa = isa;
    return isResearchSourceRow(row) ? row : null;
  }

  return {
    name: sourceName,
    origin,
    label: WIKTIONARY_SOURCE_LABEL,

    /** Opens this source's per-turn fetch budget (courtesy.mjs). */
    beginTurn() { gate.beginTurn(); },

    /** The source's own running totals, including the failures that said the
     *  source itself is struggling — what a circuit breaker reads. */
    stats() { return gate.stats(); },

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

/** The Wiktionary research source with `waitForSlot` on: paced callers (the
 *  research queue, the news enrichment loop) wait for their polite slot
 *  rather than reporting a false miss. Every option the caller passes wins,
 *  so a test can hand it a stub transport and a zero interval. */
export function createWiktionaryResearchSource(options = {}) {
  return createWiktionaryLiveProvider({ waitForSlot: true, ...options });
}

registerResearchSource({
  name: WIKTIONARY_SOURCE_NAME,
  create: createWiktionaryResearchSource,
});
