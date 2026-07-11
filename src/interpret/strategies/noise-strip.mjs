// interpret/strategies/noise-strip.mjs — the item-10 noise-tolerant fallback
// strategy: strip filler/noise/stop words the closed grammar gives no meaning to,
// then RE-RUN THE PARSE over what's left (the anchored grammar first, then the
// keyword-spot decomposition — see the discipline notes). Rationale: the keyword-spot
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
//   · returns a candidate ONLY when the stripped text then parses — first against
//     the anchored TEMPLATES (the strictest parser), then (cycle-2 robustness,
//     CHATBENCH_001 L1) against the keyword-spot decomposition over the SAME
//     stripped text. The second tier exists because the clean phrasing of half
//     the worked questions ("what calls fnAlpha") is itself a keyword-spot
//     parse, not a template — so a noise-wrapped variant ("i was wondering what
//     calls fnAlpha", "hey tmct, what calls fnAlpha thanks") could never be
//     rescued by the template re-parse alone and died as "couldn't resolve one
//     of the terms". The keyword-spot re-parse also swallows auxiliary-verb
//     residue for free ("was what calls fnAlpha" → reverse{fnAlpha}): its
//     decomposition filters STOPWORDS out of the subject/object sides, which is
//     exactly where a stripped frame's "was"/"is" residue lands. Same cost
//     bound as before: only curated-noise/stop-word tokens were removed, and a
//     wrongly-stripped word can at worst cost an honest object-miss downstream
//     (resolveObject never guesses), never manufacture an entity.
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

/** Words this pass keeps but flags as UNCERTAIN (PLAN_CONVERSATION.md Finding 2
 *  — the "store"/"keep" gap): wink's `isStopWord` is a generic English
 *  dictionary, not purpose-built for this codebase — it happens to flag
 *  "keep"/"put"/"get" but not their close synonyms "store"/"hold"/"place"/
 *  "save" sitting in the exact same no-relation-verb slot ("where would i
 *  keep/store a router"), so a KEPT word surviving the pass above is not
 *  necessarily real content. A curated synonym list was tried and rejected
 *  (see the file doc / PLAN_CONVERSATION.md): "store"/"hold"/"save" are
 *  exactly the words most likely to ALSO be a real identifier ("where does
 *  the store live" must not lose its subject). The general, non-curated
 *  signal that discriminates the two: wink's POS tagger, reading the WHOLE
 *  ORIGINAL sentence for real grammatical context (an isolated 2-word
 *  fragment like "store router" tags BOTH words NOUN — confirmed live; the
 *  same "store" in "where would i store a router" tags VERB, and in "where
 *  does the store live" tags NOUN — also confirmed live, so the isolated
 *  object phrase alone can never carry this signal; it must be read here,
 *  off the whole sentence, before the phrase is extracted).
 *
 *  A KEPT word wink tags VERB here is returned as `maybeNoise`, NOT stripped
 *  outright — this function has no graph to check a resolution against
 *  (interpret/pipeline.mjs's own documented boundary: "no graph access
 *  here"). The caller below turns this into a second candidate reading;
 *  ask.mjs's traverse() (where the graph lives) tries both and prunes the
 *  one that misses/ties in favor of the one that resolves cleanly —
 *  mirroring resolveObject's own grain-word retry (try a variant, keep it
 *  only on an unambiguous hit) and grammar/ace.mjs's parseAceAmbiguous
 *  ("keep only complete, valid parses"). Never guessed here; always pruned
 *  where the evidence (the graph) actually is. */
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
    // tier 1: the anchored templates over the stripped text — the strictest
    // re-parse, tried first so a template shape is never displaced by a looser
    // decomposition of the same words. tier 2 (cycle-2, CHATBENCH_001 L1): the
    // keyword-spot decomposition over the SAME stripped text — the parser the
    // clean phrasing of non-template questions ("what calls fnAlpha") actually
    // uses, so their noise-wrapped variants recover the identical honest answer
    // (see the file doc for the discipline/cost argument).
    const parsed = parseAnchored(stripped) || parseKeywordSpot(stripped, ctx.nlp || null);
    if (!parsed) return null;
    // Finding 2 extension (PLAN_CONVERSATION.md): a bare "where"/"mentions"
    // question is the ONE shape with no explicit relation verb gating its
    // object (every other decomposition in keywords.mjs requires a real
    // VERB_TO_KIND match before it ever runs), so it's the only place an
    // unlisted light verb ("store", "hold", …) can leak into the object
    // phrase untouched. Scoped to exactly that shape — deliberately not a
    // blanket change to stripNoise's shared criteria, per the file's own
    // construction-scoping caveat. `altObject` rides along on the SAME
    // single candidate (not a second strategy candidate — that would force
    // mergeStrategyResults' pre-resolution ambiguousParse surface on every
    // hit, before anyone has checked whether it's even real ambiguity);
    // ask.mjs's traverse() is the one place both the alternate reading and
    // the graph are available together to actually prune it.
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
