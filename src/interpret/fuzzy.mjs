// interpret/fuzzy.mjs — the bounded-edit-distance fuzzy tier (two-level fuzzy,
// 2026-07-02), extracted MOVE-only from ask.mjs (item 13). A reusable SERVICE the
// strategies call, not a strategy itself: the keyword-spotting strategy's tier-3
// vocabulary rewrite and resolveObject's tier-5 label pass both read editDistance/
// fuzzyBound from here, and the "assuming you meant …" announcement discipline
// (a unique within-bound hit is announced, a tie is refused or surfaced as
// ambiguity, never a silently-broken guess) is enforced by the callers off these
// primitives. Deliberately coupled to the curated vocab tables via explicit
// imports — the fuzzy TARGETS are a closed, curated set, same ethos as the
// tables themselves. Pure JS, no deps.

import { VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND } from "../ask-vocab.mjs";
import { STOPWORDS } from "./normalize.mjs";

// ---- bounded edit distance — hand-rolled Damerau-Levenshtein (optimal string
// alignment: substitution/insertion/deletion + adjacent transposition), bounded
// with an early row-minimum exit. Fires only after every exact/curated tier
// missed, and a distance TIE is refused (keyword) or surfaced as ambiguity
// (object), never broken by a guess. ----

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
  [...Object.keys(VERB_TO_KIND), ...Object.keys(ENTITY_TO_TYPE), ...Object.keys(MODIFIER_TO_KIND)]
    .flatMap((p) => p.split(" ")),
);

/** Fuzzy-correction TARGETS: verb-phrase and modifier constituents only, length ≥4.
 *  Entity nouns are deliberately excluded — real identifiers collide with them at
 *  distance ≤2 far too easily ("myfile" is 2 edits from "file", "caller" 2 from
 *  "calls"-family words), and entity-noun typos are already owned by the curated
 *  MISSPELLINGS table where such calls are made deliberately. Short constituents
 *  ("of", "to", "in", "on") are excluded for the same reason: at bound 1 half of
 *  English is adjacent to them. */
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
  const bound = fuzzyBound(w);
  let best = bound + 1;
  let hit = null;
  let tied = false;
  for (const target of FUZZY_TARGET_WORDS) {
    const d = editDistance(w, target, Math.min(best, bound));
    if (d < best) { best = d; hit = target; tied = false; }
    else if (d === best && d <= bound && target !== hit) tied = true;
  }
  return best <= bound && !tied ? hit : null;
}
