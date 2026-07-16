// interpret/strategies/noise-strip.mjs — noise-tolerant fallback strategy:
// strip filler/noise/stop words the closed grammar gives no meaning to, then
// re-parse what's left (anchored templates first, then keyword-spot).
//
// Fires only when the anchored grammar misses the text as-given. Strips only
// curated noise or wink-flagged stop words, never a word in KEEP (grammar
// vocabulary, question scaffolding, context pronouns). Registered as its own
// class ("noise-stripped") at confidence 0.75 — above keyword-spot, below the
// anchored grammar.

import {
  VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND, META_MEANING_VERBS,
  WHERE_MARKERS, MENTION_MARKERS, RELATIVE_PRONOUNS, PLACEHOLDER_NOUNS,
  BOOLEAN_CONNECTIVES, QUALIFIERS, AGGREGATE_TRIGGERS, LIST_TRIGGERS,
  SUPERLATIVE_EXTREMES, EDGE_NOUN_TO_METRIC, ANAPHORA_TRIGGERS,
  CONTEXT_PRONOUNS, CASCADE_NOISE, CASCADE_SYNONYMS, FILLER_WORDS,
} from "../../ask-vocab.mjs";
import { STOPWORDS, splitWords, wordsOf } from "../normalize.mjs";
import { parseAnchored } from "./grammar.mjs";
import { parseKeywordSpot } from "./keywords.mjs";

/** Words this strategy may NEVER strip: everything the closed grammar gives
 *  query meaning to, plus the question/auxiliary scaffolding and the context
 *  pronouns. Mirrors the cascade's CONTENT_VOCAB ∪ STRUCTURAL_WORDS union —
 *  wink flags "which"/"what"/"does" as stop words, and stripping those would
 *  destroy the very templates this strategy re-runs. */
const KEEP = new Set([
  ...STOPWORDS, ...wordsOf(CONTEXT_PRONOUNS),
  ...wordsOf(Object.keys(VERB_TO_KIND)), ...wordsOf(Object.keys(ENTITY_TO_TYPE)),
  ...wordsOf(Object.keys(MODIFIER_TO_KIND)), ...wordsOf(Object.keys(QUALIFIERS)),
  ...wordsOf(AGGREGATE_TRIGGERS), ...wordsOf(LIST_TRIGGERS),
  ...wordsOf(Object.keys(SUPERLATIVE_EXTREMES)), ...wordsOf(Object.keys(EDGE_NOUN_TO_METRIC)),
  ...wordsOf(Object.keys(BOOLEAN_CONNECTIVES)), ...wordsOf(PLACEHOLDER_NOUNS),
  ...wordsOf(ANAPHORA_TRIGGERS), ...wordsOf(META_MEANING_VERBS),
  ...wordsOf(WHERE_MARKERS), ...wordsOf(MENTION_MARKERS), ...wordsOf(RELATIVE_PRONOUNS),
  ...wordsOf(Object.keys(CASCADE_SYNONYMS)),
]);

/** The curated noise tier — FILLER_WORDS (normally consumed by normalizeQuery;
 *  carried here too so the strategy stands alone) + the cascade's noise list. */
const CURATED_NOISE = new Set([...wordsOf(FILLER_WORDS), ...wordsOf(CASCADE_NOISE)]);

/** Words this pass keeps but flags as UNCERTAIN: wink's generic isStopWord
 *  misses light-verb synonyms ("store"/"hold" for "keep"/"put"), which are
 *  also plausible real identifiers, so a whole-sentence POS tag (VERB here)
 *  marks them `maybeNoise` rather than stripping them outright — the caller
 *  tries both readings and ask.mjs's traverse() prunes using the graph. */
function maybeVerbNoiseWords(words, kept, nlp) {
  if (!nlp || typeof nlp.posTags !== "function" || !kept.length) return [];
  const keptSet = new Set(kept.map((w) => w.toLowerCase()));
  let tags;
  try {
    tags = nlp.posTags(words);
  } catch {
    return [];
  }
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const lc = w.toLowerCase();
    if (!/^[a-z]+$/.test(w) || KEEP.has(lc) || !keptSet.has(lc)) continue;
    if (tags[i] === "VERB") out.push(lc);
  }
  return out;
}

/** Strip the strippable tokens (see the file doc). Returns {text, dropped,
 *  maybeNoise} — maybeNoise is the POS-flagged uncertain-word list above,
 *  `[]` whenever no `nlp` adapter is available (same graceful-degradation
 *  discipline as the rest of this file: never a curated guess, never a throw). */
export function stripNoise(text, nlp = null) {
  const words = splitWords(text);
  const kept = [];
  const dropped = [];
  for (const w of words) {
    const lc = w.toLowerCase();
    const strippable = /^[a-z]+$/.test(w) && !KEEP.has(lc)
      && (CURATED_NOISE.has(lc)
        || (nlp && typeof nlp.isStopWord === "function" && nlp.isStopWord(lc)));
    if (strippable) dropped.push(w);
    else kept.push(w);
  }
  const maybeNoise = maybeVerbNoiseWords(words, kept, nlp);
  return { text: kept.join(" "), dropped, maybeNoise };
}

/** Pipeline registration (interpret/pipeline.mjs). */
export const noiseStripStrategy = {
  id: "noise-strip",
  class: "noise-stripped",
  run(text, ctx = {}) {
    if (parseAnchored(text)) return null; // the grammar owns the text as-given
    const { text: stripped, dropped, maybeNoise } = stripNoise(text, ctx.nlp || null);
    if (!dropped.length || !stripped) return null;
    // Re-parse: the anchored templates first, then keyword-spot (the parser
    // that clean non-template phrasings like "what calls fnAlpha" already use).
    const parsed = parseAnchored(stripped) || parseKeywordSpot(stripped, ctx.nlp || null);
    if (!parsed) return null;
    // where/mentions has no relation verb gating its object, so it's the one shape
    // an unlisted light verb can leak into untouched; `altObject` rides on the same
    // candidate so ask.mjs's traverse() can prune using the graph.
    if (maybeNoise.length && (parsed.shape === "where" || parsed.shape === "mentions") && parsed.object) {
      const altObject = parsed.object.split(/\s+/).filter((w) => !maybeNoise.includes(w.toLowerCase())).join(" ").trim();
      if (altObject && altObject !== parsed.object) parsed.altObject = altObject;
    }
    return {
      strategyId: "noise-strip",
      class: "noise-stripped",
      candidates: [{ parsed, confidence: 0.75, note: `noise-stripped to "${stripped}"` }],
    };
  },
};
