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

// The -s/-ed/-ing rules and the collision fold live in src/domain/inflect.mjs,
// where they are unit-tested. This script is the disk half: read the corpus,
// write the table.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FUZZY_TARGET_WORDS } from "../src/domain/interpret/fuzzy.mjs";
import { inflectionsOf, collisionsFrom } from "../src/domain/inflect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

const WORDNET_FILES = ["wordnet-full.jsonl", "wordnet-xl.jsonl"];

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

function main() {
  const outFlag = process.argv.indexOf("--out");
  const outFile = outFlag >= 0 && process.argv[outFlag + 1]
    ? process.argv[outFlag + 1]
    : join(REPO, "src", "domain", "real-word-collisions.json");

  const lemmas = wordnetLemmas();
  const realWords = new Set([...lemmas].flatMap(inflectionsOf));
  const collisions = collisionsFrom(realWords);

  // The table answers "which real words does THIS target list attract", so add a
  // verb to the vocabulary and the answer changes. The target list it was built
  // against ships with it, and the suite compares the two.
  const out = {
    source: "corpus/wordnet/*.jsonl lemmas, expanded through the regular -s/-ed/-ing inflections",
    generator: "scripts/generate-real-word-collisions.mjs",
    targets: [...FUZZY_TARGET_WORDS].sort(),
    words: collisions,
  };
  writeFileSync(outFile, `${JSON.stringify(out)}\n`);
  console.log(`generate-real-word-collisions: ${lemmas.size} WordNet lemmas -> ${realWords.size} forms with inflections`);
  console.log(`generate-real-word-collisions: ${collisions.length} collide with ${FUZZY_TARGET_WORDS.length} repair targets -> ${outFile}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
