// interpret/strategies/noise-strip.mjs — the item-10 noise-tolerant fallback
// strategy: strip filler/noise/stop words the closed grammar gives no meaning to,
// then RE-RUN THE ANCHORED GRAMMAR over what's left. Rationale: the keyword-spot
// strategy decomposes around the verb and a leading vocative/adverb lands in the
// SUBJECT slot ("hey man which modules import X" -> ask{subject:"man"}), an
// unresolvable term the relaxation cascade can only rescue when the true answer
// is positive (it refuses to relax into a miss) — so a noise-wrapped question
// whose honest answer is negative/empty dies as "couldn't resolve one of the
// terms". Stripping the noise FIRST recovers the template parse and the same
// honest answer the clean phrasing gets.
//
// Discipline (no behavior change to anything that already parses):
//   · fires ONLY when the anchored grammar MISSES the text as-given — if a
//     template already matches, the grammar owns the sentence, noise and all;
//   · strips ONLY all-lowercase alphabetic tokens (a Capitalized/dotted/digit
//     token names something) that are curated noise (FILLER_WORDS + the
//     cascade's CASCADE_NOISE) or wink-flagged English stop words (ctx.nlp's
//     isStopWord — the optional Node-only tier), and NEVER a word in KEEP: the
//     grammar's own vocabulary, question scaffolding, and context pronouns;
//   · returns a candidate ONLY when the stripped text then matches an anchored
//     TEMPLATE — the strictest parser, so a stripped-away word can at worst cost
//     an honest object-miss downstream, never manufacture a reading.
//
// Registered with its own class ("noise-stripped") at confidence 0.75: above
// keyword-spot (0.7 — over noisy text its decomposition has provably swallowed
// the noise into a term) and below the anchored grammar (0.9 — which anyway
// gates this strategy off whenever it fires). A distinct class, so disagreement
// with keyword-spot is a ranked winner + "if you mean X then …" alternate,
// never a forced same-class ambiguity over a garbage subject.

import {
  VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND, META_MEANING_VERBS,
  WHERE_MARKERS, MENTION_MARKERS, RELATIVE_PRONOUNS, PLACEHOLDER_NOUNS,
  BOOLEAN_CONNECTIVES, QUALIFIERS, AGGREGATE_TRIGGERS, LIST_TRIGGERS,
  SUPERLATIVE_EXTREMES, EDGE_NOUN_TO_METRIC, ANAPHORA_TRIGGERS,
  CONTEXT_PRONOUNS, CASCADE_NOISE, CASCADE_SYNONYMS, FILLER_WORDS,
} from "../../ask-vocab.mjs";
import { STOPWORDS, splitWords, wordsOf } from "../normalize.mjs";
import { parseAnchored } from "./grammar.mjs";

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

/** Strip the strippable tokens (see the file doc). Returns {text, dropped}. */
export function stripNoise(text, nlp = null) {
  const kept = [];
  const dropped = [];
  for (const w of splitWords(text)) {
    const lc = w.toLowerCase();
    const strippable = /^[a-z]+$/.test(w) && !KEEP.has(lc)
      && (CURATED_NOISE.has(lc)
        || (nlp && typeof nlp.isStopWord === "function" && nlp.isStopWord(lc)));
    if (strippable) dropped.push(w);
    else kept.push(w);
  }
  return { text: kept.join(" "), dropped };
}

/** Pipeline registration (interpret/pipeline.mjs). */
export const noiseStripStrategy = {
  id: "noise-strip",
  class: "noise-stripped",
  run(text, ctx = {}) {
    if (parseAnchored(text)) return null; // the grammar owns the text as-given
    const { text: stripped, dropped } = stripNoise(text, ctx.nlp || null);
    if (!dropped.length || !stripped) return null;
    const parsed = parseAnchored(stripped);
    if (!parsed) return null;
    return {
      strategyId: "noise-strip",
      class: "noise-stripped",
      candidates: [{ parsed, confidence: 0.75, note: `noise-stripped to "${stripped}"` }],
    };
  },
};
