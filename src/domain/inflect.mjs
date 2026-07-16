// inflect.mjs — the regular English -s/-ed/-ing rules, applied to a lemma.
//
// WordNet carries lemmas only ("rest" is present, "rests" is absent), and it is
// the inflected forms that collide with the fuzzy repair tier's targets —
// "rests" is one edit from "tests". So the real-word collision table expands
// every lemma through these rules before it looks for collisions.
//
// These are the REGULAR rules and nothing else. No irregular table, no stress
// model: pastOf("run") is "runned" and pastOf("make") is "maked". That is the
// intended shape. The table's job is to name words the repair tier must not
// rewrite, and inflectionsOf is generous on purpose (see below) — an extra form
// costs one repair we decline to make, and the sentence misses honestly, while
// a missing form costs a real word rewritten into a different question,
// answered with confidence. The first is the cheaper mistake.

import { STOPWORDS } from "./interpret/normalize.mjs";
import {
  FUZZY_TARGET_WORDS, FUZZY_REPAIR_MIN_LENGTH, fuzzyMatchInSet, fuzzyBound,
} from "./interpret/fuzzy.mjs";

const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const isVowel = (c) => VOWELS.has(c);

/** A single final consonant after a single vowel doubles before -ed/-ing
 *  ("run" -> "running"). w, x and y never double. Stress is not modelled, so a
 *  second syllable doubles too ("visit" -> "visitting"). */
export function doublesFinalConsonant(w) {
  const [c3, c2, c1] = [w.at(-3), w.at(-2), w.at(-1)];
  if (!c3 || isVowel(c1) || "wxy".includes(c1)) return false;
  return isVowel(c2) && !isVowel(c3);
}

export function pluralOf(w) {
  if (/(?:s|x|z|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

export function pastOf(w) {
  if (w.endsWith("e")) return `${w}d`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ied`;
  if (doublesFinalConsonant(w)) return `${w}${w.at(-1)}ed`;
  return `${w}ed`;
}

export function gerundOf(w) {
  if (w.endsWith("ie")) return `${w.slice(0, -2)}ying`;
  if (w.endsWith("e") && !/(?:ee|oe|ye)$/.test(w)) return `${w.slice(0, -1)}ing`;
  if (doublesFinalConsonant(w)) return `${w}${w.at(-1)}ing`;
  return `${w}ing`;
}

/** Every surface form of `w` the collision table counts as real English. */
export const inflectionsOf = (w) => [w, pluralOf(w), pastOf(w), gerundOf(w)];

/** The words in `realWords` that the repair tier would rewrite onto one of its
 *  targets: long enough to reach the tier, not a stopword, not a target itself,
 *  and within the fuzzy bound of some target. Sorted, so the table it feeds is
 *  reproducible. */
export function collisionsFrom(realWords) {
  return [...realWords]
    .filter((w) => w.length >= FUZZY_REPAIR_MIN_LENGTH)
    .filter((w) => !STOPWORDS.has(w))
    .filter((w) => !FUZZY_TARGET_WORDS.includes(w))
    .filter((w) => fuzzyMatchInSet(w, FUZZY_TARGET_WORDS, fuzzyBound(w)) !== null)
    .sort();
}
