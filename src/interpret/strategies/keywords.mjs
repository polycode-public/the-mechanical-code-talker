// interpret/strategies/keywords.mjs — strategy 2: keyword-spotting/decomposition,
// extracted MOVE-only from ask.mjs (item 13). ELIZA's own mechanism: find the
// keyword(s) anywhere in the text, decompose around them, tolerate reordering and
// casual phrasing. Position-independent (no `^...$` anchor), so it tolerates
// "what calls this" / "who invokes this" / "something executes this, where from"
// — real phrasings the anchored grammar's fixed shapes don't cover.

import {
  VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND,
  WHERE_MARKERS, MENTION_MARKERS,
} from "../../ask-vocab.mjs";
import { STOPWORDS } from "../normalize.mjs";
import { VOCAB_WORDS, eligibleForCanon, fuzzyVocabWord } from "../fuzzy.mjs";

/** Find the longest phrase from `table`'s keys that appears as a contiguous
 *  run of `words` (case already lowercased by the caller). Longest-match-first
 *  (multi-word phrases before single words) so "co-changes with" isn't
 *  shadowed by a shorter unrelated word. A span overlapping `consumed` indices
 *  is skipped: the verb and entity tables now share a surface form ("change"
 *  is both a touches verb and the Change entity noun), and a word already
 *  claimed by the verb pass must not double as the entity keyword. Returns
 *  {kind, start, end} (end exclusive) or null. */
export function findPhrase(lcWords, table, consumed = null) {
  const phrases = Object.keys(table).sort((a, b) => b.split(" ").length - a.split(" ").length);
  for (const p of phrases) {
    const pWords = p.split(" ");
    for (let i = 0; i <= lcWords.length - pWords.length; i += 1) {
      if (consumed && pWords.some((_, j) => consumed.has(i + j))) continue;
      if (pWords.every((w, j) => lcWords[i + j] === w)) return { kind: table[p], start: i, end: i + pWords.length };
    }
  }
  return null;
}

/** Strategy 2: scan (already-normalized) text for a verb keyword anywhere,
 *  plus optional entity/modifier keywords anywhere, then split whatever's
 *  left (after removing the matched spans + stopwords) into the words BEFORE
 *  and AFTER the verb. Which side(s) are non-empty decides the shape —
 *  mirrors the three anchored shapes but by decomposition instead of a fixed
 *  template, so it tolerates reordering/casual phrasing the anchored regexes
 *  don't: text on BOTH sides ("does X import Y") -> ask{subject:before,
 *  object:after}; only AFTER the verb ("what calls this") -> reverse{object:
 *  after}; only BEFORE it ("what does X import") -> forward{object:before}.
 *  A lone context pronoun ("this"/"it"/"that"/"here") ending up as a resolved
 *  term is left as plain text — resolveTermOrContext (traverse-time)
 *  recognizes it against an optional contextId, so no separate flag is
 *  needed here. A misparse here costs nothing beyond an honest object-miss
 *  downstream (resolveObject never guesses).
 *
 *  Keyword matching is TIERED (two-level fuzzy work, 2026-07-02) — each lower
 *  tier fires ONLY when every tier above found no verb phrase at all, so an
 *  exact curated match can never be displaced:
 *    1. exact — the words as typed (post-normalization, which already applied
 *       the curated CONTRACTIONS/MISSPELLINGS/WRONG_WORDS corrections);
 *    2. lemma (only with the optional Node-side `nlp` adapter) — each eligible
 *       word is replaced by its wink lemma IF that lemma is itself a vocab word
 *       ("imported"/"importing" -> "import"), so inflections hit the curated
 *       phrases without enumerating them. Every verb family already stores its
 *       lemma form ("import", "call", "touch", "use", …), so a direct
 *       lemma-in-vocab check is the whole lookup — no reverse index needed;
 *    3. fuzzy (adapter-free; works in the inlined viewer too) — a word ≥4 chars
 *       matching nothing exactly may rewrite to a UNIQUE verb/modifier
 *       constituent within the bounded edit distance (see fuzzyVocabWord; ties
 *       are refused, entity nouns are never fuzzy targets).
 *  The canonicalized words drive PHRASE FINDING only — sideText always reads the
 *  ORIGINAL words, so a correction can never corrupt an object/subject term. */
export function parseKeywordSpot(text, nlp = null) {
  // Strip a trailing "?" (mirrors the anchored templates' own `\??$`) and turn commas into
  // pauses/spaces — but NEVER strip a mid-word ".": object terms are routinely dotted file/module
  // names ("a.py", "utils.mjs"), and the anchored strategy captures those raw, so keyword-spot
  // must too or the two strategies would "disagree" over a period that was never part of the intent.
  const words = text.replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const lcWords = words.map((w) => w.toLowerCase());
  // where/mentions shapes (2026-07-02 query families): "where is X [defined]" and
  // "where is X mentioned" carry NO relation verb, so the verb-driven decomposition
  // below can never reach them. Routed here by the "where" question word + marker —
  // but ONLY when no relation verb exists anywhere in the sentence: "something
  // executes this, where from" (an existing worked phrasing) has a verb, and its
  // "where" is decorative, not a location question.
  if (lcWords.includes("where") && !findPhrase(lcWords, VERB_TO_KIND)) {
    const mention = lcWords.some((w) => MENTION_MARKERS.includes(w));
    const markers = new Set([...WHERE_MARKERS, ...MENTION_MARKERS]);
    const objText = words.filter((w, i) => !STOPWORDS.has(lcWords[i]) && !markers.has(lcWords[i])).join(" ").trim();
    if (objText) {
      const kind = mention ? "mentions" : "where";
      return { shape: kind, entityType: null, modifier: "direct", kind, object: objText };
    }
  }
  let canonWords = lcWords;
  let verbHit = findPhrase(lcWords, VERB_TO_KIND);
  if (!verbHit && nlp) {
    // tier 2: lemma (see the tier doc above) — replace only when the lemma is
    // itself vocabulary, so unknown words ("myfile") pass through untouched.
    const lemmaWords = lcWords.map((w) => {
      if (!eligibleForCanon(w)) return w;
      const l = nlp.lemma(w);
      return VOCAB_WORDS.has(l) ? l : w;
    });
    verbHit = findPhrase(lemmaWords, VERB_TO_KIND);
    if (verbHit) canonWords = lemmaWords;
  }
  if (!verbHit) {
    // tier 3: bounded-edit-distance rewrite toward verb/modifier keywords only
    // ("impotr" -> "import"); ≥4-char words only — below that the bound covers
    // half of English (and "and" is 1 edit from the "land in" constituent).
    const fuzzyWords = lcWords.map((w) => (w.length >= 4 && eligibleForCanon(w) ? fuzzyVocabWord(w) || w : w));
    verbHit = findPhrase(fuzzyWords, VERB_TO_KIND);
    if (verbHit) canonWords = fuzzyWords;
  }
  if (!verbHit) return null;
  // POS consumer (wink adapter, Node-side only): rescue the ONE decomposition this
  // strategy provably mis-parses — a relation word used as a NOUN in a "the
  // <imports> of <term>" nominal ("show the imports of walk.mjs" otherwise
  // decomposes to ask{subject:"show"}; bare "the imports of walk.mjs" to the
  // reverse shape, both wrong). The wink probe showed "import" is tagged NOUN even
  // in genuine verb use ("which modules import walk.mjs"), so the POS signal is
  // deliberately NOT a general verb veto — it only fires inside this exact
  // det+NOUN+"of" frame, where the nominal reading is grammatically forced.
  if (nlp && verbHit.end - verbHit.start === 1) {
    const i = verbHit.start;
    const det = lcWords[i - 1];
    if ((det === "the" || det === "these" || det === "those") && lcWords[i + 1] === "of") {
      const tags = nlp.posTags(words);
      if (tags[i] === "NOUN") {
        const objText = words.slice(i + 2).filter((w, j) => !STOPWORDS.has(lcWords[i + 2 + j])).join(" ").trim();
        if (objText) return { shape: "forward", entityType: null, modifier: "direct", kind: verbHit.kind, object: objText };
      }
    }
  }
  const consumed = new Set();
  const mark = (hit) => { if (hit) for (let i = hit.start; i < hit.end; i += 1) consumed.add(i); };
  mark(verbHit);
  const entityHit = findPhrase(canonWords, ENTITY_TO_TYPE, consumed);
  mark(entityHit);
  const modifierHit = findPhrase(canonWords, MODIFIER_TO_KIND, consumed);
  mark(modifierHit);
  const sideText = (from, to) => words
    .slice(from, to)
    .filter((_, j) => !consumed.has(from + j) && !STOPWORDS.has(lcWords[from + j]))
    .join(" ")
    .trim();
  const beforeText = sideText(0, verbHit.start);
  const afterText = sideText(verbHit.end, words.length);
  const kind = verbHit.kind;
  // slices read canonWords, not lcWords: the entity/modifier spans were matched
  // against the canonicalized array, whose word IS the table key.
  const entityType = entityHit ? ENTITY_TO_TYPE[canonWords.slice(entityHit.start, entityHit.end).join(" ")] : null;
  const modifier = modifierHit ? MODIFIER_TO_KIND[canonWords.slice(modifierHit.start, modifierHit.end).join(" ")] : "direct";

  // when shape (2026-07-02 query families): "when did X change" / "when was X last
  // touched" — the "when" question word turns a touches decomposition temporal.
  // Only touches carries commit dates to answer with; a "when" next to any other
  // relation verb falls through to the ordinary shapes (and their honest answers).
  if (kind === "touches" && lcWords.includes("when")) {
    const objText = beforeText || afterText;
    if (objText) return { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: objText };
  }

  if (beforeText && afterText) return { shape: "ask", entityType: null, modifier: "direct", kind, subject: beforeText, object: afterText };
  if (afterText) return { shape: "reverse", entityType, modifier, kind, object: afterText };
  // forward keeps the spotted entityType ("which modules did commit <sha> touch" is a
  // forward decomposition — subject before the verb — whose asked grain would otherwise
  // be lost); traverse() only consults it for the commit-as-subject grain selection,
  // so plain forwards behave exactly as before. Modifier stays hardcoded: no forward
  // closure traversal exists (see ask.mjs's modifierIsWired).
  if (beforeText) return { shape: "forward", entityType, modifier: "direct", kind, object: beforeText };
  return null;
}

/** Pipeline registration (interpret/pipeline.mjs): keyword-spotting as a
 *  strategy. Class "graph-query" — shared with the anchored grammar, so the two
 *  merge (agree/disagree) exactly as the legacy two-way merge did. Confidence
 *  0.7: a decomposition is looser evidence than a full-template match. The
 *  lemma/POS adapter arrives via ctx.nlp (the pipeline's default is the same
 *  Node-only wink adapter ask.mjs picks up). */
export const keywordSpotStrategy = {
  id: "keyword-spot",
  class: "graph-query",
  run(text, ctx = {}) {
    const parsed = parseKeywordSpot(text, ctx.nlp || null);
    return parsed
      ? { strategyId: "keyword-spot", class: "graph-query", candidates: [{ parsed, confidence: 0.7 }] }
      : null;
  },
};
