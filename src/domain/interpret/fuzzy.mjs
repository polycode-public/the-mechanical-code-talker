// interpret/fuzzy.mjs — the bounded-edit-distance fuzzy tier, shared by the
// keyword-spotting and object-resolution strategies. A distance tie is always
// refused or surfaced as ambiguity, never broken by a guess.

import { VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND } from "../ask-vocab.mjs";

/** Words the canonicalization passes must leave alone even though no parse table
 *  spells them. "used" reads as vocabulary, not as a relation: "what is it used
 *  for" asks the corpus what a thing is FOR, and both tiers below would otherwise
 *  walk it to the graph verb "uses" — the lemma tier through "use", the fuzzy tier
 *  by one edit — and answer a question about imports and calls instead. The active
 *  verb table deliberately has no bare "used" for the same reason. */
const NEVER_CANONICALIZE = ["used"];
import { STOPWORDS } from "./normalize.mjs";

// ---- bounded edit distance — hand-rolled Damerau-Levenshtein, bounded with an
// early row-minimum exit ----

/** Distance between a and b, or max+1 as soon as it provably exceeds `max`. */
export function editDistance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** The curated distance budget: 1 edit for short tokens, 2 for longer ones. */
export const fuzzyBound = (s) => (s.length <= 5 ? 1 : 2);

/** Every single word appearing in the three parse tables — the "is this word
 *  already vocabulary?" gate for the lemma/fuzzy canonicalization passes (an
 *  exact vocab word is NEVER rewritten: exact curated match always wins). */
export const VOCAB_WORDS = new Set(
  [...Object.keys(VERB_TO_KIND), ...Object.keys(ENTITY_TO_TYPE), ...Object.keys(MODIFIER_TO_KIND),
    ...NEVER_CANONICALIZE]
    .flatMap((p) => p.split(" ")),
);

/** Fuzzy-correction TARGETS: verb-phrase and modifier constituents only,
 *  length ≥4. Entity nouns and short words are excluded — real identifiers
 *  collide with them too easily at this distance bound. */
const FUZZY_TARGET_WORDS = [...new Set(
  [...Object.keys(VERB_TO_KIND), ...Object.keys(MODIFIER_TO_KIND)]
    .flatMap((p) => p.split(" "))
    .filter((w) => w.length >= 4),
)];

/** A query word may be canonicalized only if it is plain alphabetic, not a
 *  stopword, and not already vocabulary. Dotted/digit terms (file names, shas)
 *  are never touched. */
export function eligibleForCanon(w) {
  return /^[a-z]+$/.test(w) && !STOPWORDS.has(w) && !VOCAB_WORDS.has(w);
}

/** UNIQUE within-bound fuzzy vocab keyword for `w`, or null — a tie between two
 *  distinct target words at the same distance is refused outright (the honest-miss
 *  discipline at the vocabulary level; cf. MISSPELLINGS' curated "calss" decision). */
export function fuzzyVocabWord(w) {
  return fuzzyMatchInSet(w, FUZZY_TARGET_WORDS, fuzzyBound(w));
}

/** Generic unique-within-bound fuzzy match of `w` against an arbitrary
 *  candidate list, or null on a tie — never guessed. */
export function fuzzyMatchInSet(w, candidates, bound = fuzzyBound(w)) {
  let best = bound + 1;
  let hit = null;
  let tied = false;
  for (const target of candidates) {
    const d = editDistance(w, target, Math.min(best, bound));
    if (d < best) { best = d; hit = target; tied = false; }
    else if (d === best && d <= bound && target !== hit) tied = true;
  }
  return best <= bound && !tied ? hit : null;
}
