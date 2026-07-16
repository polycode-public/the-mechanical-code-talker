// scripts/generate-real-word-collisions.mjs — the generator for
// src/domain/real-word-collisions.json, the closed table that stops the fuzzy
// verb-repair tier from rewriting words that are already real English.
//
// The repair tier exists for typos ("impotr" -> "import"). A word that is
// already an English word is not a typo, so rewriting it invents a question the
// user never asked: "does store.mjs rest on app.mjs" is a question about
// resting, and "rest" is one edit from "test". We do not record a rests
// relation, so the honest answer is a miss.
//
// The word source is this repo's own WordNet corpus (corpus/wordnet/*.jsonl),
// which is committed and offline. So this generator needs no system dictionary
// and no new package, and it reproduces anywhere the repo does — which is what
// lets test/estate/generated-artifacts.test.mjs rebuild the table and compare.
//
// WordNet carries lemmas only ("rest" is present, "rests" is absent), and
// "rests" -> "tests" is the collision that matters most, so every lemma is
// expanded through the regular -s/-ed/-ing forms before the check runs.
//
// Only the COLLISION set is committed, not the whole language: a real word the
// tier would never reach needs no entry.
//
// Usage:
//   node scripts/generate-real-word-collisions.mjs [--out <path>]

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STOPWORDS } from "../src/domain/interpret/normalize.mjs";
import {
  FUZZY_TARGET_WORDS, FUZZY_REPAIR_MIN_LENGTH, fuzzyMatchInSet, fuzzyBound,
} from "../src/domain/interpret/fuzzy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const outFlag = process.argv.indexOf("--out");
const OUT_FILE = outFlag >= 0 && process.argv[outFlag + 1]
  ? process.argv[outFlag + 1]
  : join(REPO, "src", "domain", "real-word-collisions.json");

const WORDNET_FILES = ["wordnet-full.jsonl", "wordnet-xl.jsonl"];

const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const isVowel = (c) => VOWELS.has(c);

/** A single final consonant after a single vowel doubles before -ed/-ing
 *  ("run" -> "running"). w, x and y never double. */
function doublesFinalConsonant(w) {
  const [c3, c2, c1] = [w.at(-3), w.at(-2), w.at(-1)];
  if (!c3 || isVowel(c1) || "wxy".includes(c1)) return false;
  return isVowel(c2) && !isVowel(c3);
}

function pluralOf(w) {
  if (/(?:s|x|z|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

function pastOf(w) {
  if (w.endsWith("e")) return `${w}d`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ied`;
  if (doublesFinalConsonant(w)) return `${w}${w.at(-1)}ed`;
  return `${w}ed`;
}

function gerundOf(w) {
  if (w.endsWith("ie")) return `${w.slice(0, -2)}ying`;
  if (w.endsWith("e") && !/(?:ee|oe|ye)$/.test(w)) return `${w.slice(0, -1)}ing`;
  if (doublesFinalConsonant(w)) return `${w}${w.at(-1)}ing`;
  return `${w}ing`;
}

/** Every surface form of `w` this generator counts as real English. Generous on
 *  purpose. An extra form costs one repair we decline to make, and the sentence
 *  misses honestly. A missing form costs a real word rewritten into a different
 *  question, answered with confidence. The first is the cheaper mistake. */
const inflectionsOf = (w) => [w, pluralOf(w), pastOf(w), gerundOf(w)];

/** Single-word lowercase lemmas from the ConceptNet-shaped WordNet JSONL. Every
 *  edge carries a `/c/en/<term>` concept at each end, and a multi-word term
 *  joins its words with "_", so each part is a lemma in its own right. Swept
 *  with one regex over the raw text rather than parsed line by line: the two
 *  files are ~28 MB and only the concept terms are wanted. */
//  A term runs to the next "/" (a part-of-speech suffix) or the closing quote,
//  and may carry an apostrophe ("coeur_d'alene"), so the parts are filtered
//  after the split rather than by the sweep itself.
const CONCEPT_RE = /"\/c\/en\/([^"/]+)/g;

function wordnetLemmas() {
  const lemmas = new Set();
  for (const file of WORDNET_FILES) {
    const text = readFileSync(join(REPO, "corpus", "wordnet", file), "utf8");
    for (const m of text.matchAll(CONCEPT_RE)) {
      for (const part of m[1].split("_")) if (/^[a-z]+$/.test(part)) lemmas.add(part);
    }
  }
  return lemmas;
}

const lemmas = wordnetLemmas();
const realWords = new Set([...lemmas].flatMap(inflectionsOf));

const collisions = [...realWords]
  .filter((w) => w.length >= FUZZY_REPAIR_MIN_LENGTH)
  .filter((w) => !STOPWORDS.has(w))
  .filter((w) => !FUZZY_TARGET_WORDS.includes(w))
  .filter((w) => fuzzyMatchInSet(w, FUZZY_TARGET_WORDS, fuzzyBound(w)) !== null)
  .sort();

// The table answers "which real words does THIS target list attract", so add a
// verb to the vocabulary and the answer changes. The target list it was built
// against ships with it, and the suite compares the two.
const out = {
  source: "corpus/wordnet/*.jsonl lemmas, expanded through the regular -s/-ed/-ing inflections",
  generator: "scripts/generate-real-word-collisions.mjs",
  targets: [...FUZZY_TARGET_WORDS].sort(),
  words: collisions,
};
writeFileSync(OUT_FILE, `${JSON.stringify(out)}\n`);
console.log(`generate-real-word-collisions: ${lemmas.size} WordNet lemmas -> ${realWords.size} forms with inflections`);
console.log(`generate-real-word-collisions: ${collisions.length} collide with ${FUZZY_TARGET_WORDS.length} repair targets -> ${OUT_FILE}`);
