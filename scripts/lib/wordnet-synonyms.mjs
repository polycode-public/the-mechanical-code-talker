// scripts/lib/wordnet-synonyms.mjs — safe, mechanical WordNet-driven synonym
// lookups for the template-variant generation script
// (scripts/generate-template-variants.mjs). Maintainer-only tooling: never
// imported by src/ or bin/, never run by `npm test`.
//
// Reads real Open English WordNet synset data
// (`~/projects/globalwordnet/english-wordnet`, override via
// TMCT_WORDNET_SRC) and answers exactly one question, safely: "what other
// words are declared in WordNet's SAME synset as this word, for this part of
// speech" — the ONLY substitution sanctioned here (synonym-substituted
// within a synset, using its members, never crossing synsets). Reuses the
// WordNet reader in scripts/lib/wordnet-source.mjs rather than re-deriving it —
// same offline, maintainer-only discipline.
//
// Sense choice: WordNet's own sense-1-is-most-frequent convention (the same
// choice extract-persona-sources.mjs's candidateFor already makes for the
// persona corpus) — a word with no declared sense for the requested POS
// is simply absent from the result, never guessed.

import { readdir } from "node:fs/promises";
import {
  WORDNET_SRC, WORDNET_YAML_DIR as YAML_DIR, loadSynsets, loadEntriesFor,
} from "./wordnet-source.mjs";

const POS_MAP = Object.freeze({ noun: "n", verb: "v", adjective: "a" });

let synsetCache = null;
async function allSynsets() {
  if (synsetCache) return synsetCache;
  const files = (await readdir(YAML_DIR)).filter((f) => /^(noun|verb|adj)\./.test(f));
  synsetCache = await loadSynsets(files);
  return synsetCache;
}

/** For each word in `words` (an iterable of lowercase strings) and each POS
 *  in `poses`, resolve its first-sense synset for that POS and return
 *  `word -> [{pos, synsetId, members, example}]` — one entry per POS the word
 *  actually has a declared sense for (a word can be both a noun and a verb).
 *  `example` is the synset's own first WordNet example sentence, if any
 *  (0-2 per synset) — carried through
 *  purely as optional extra provenance for the caller, not otherwise used
 *  here. Words absent from WordNet's entries index are simply absent from
 *  the returned map. */
export async function synsetsFor(words, poses = ["noun", "verb", "adjective"]) {
  const synsets = await allSynsets();
  const entries = await loadEntriesFor(new Set(words));
  const out = new Map();
  for (const word of words) {
    const senses = entries.get(word);
    if (!senses) continue;
    const hits = [];
    for (const posName of poses) {
      const posKey = POS_MAP[posName];
      const list = senses[posKey];
      if (!list || !list.length) continue;
      const synsetId = list[0].synset;
      const synset = synsets.get(synsetId);
      if (!synset || !Array.isArray(synset.members)) continue;
      const example = Array.isArray(synset.example) ? synset.example[0] : synset.example;
      hits.push({ pos: posName, synsetId, members: synset.members, example: example || null });
    }
    if (hits.length) out.set(word, hits);
  }
  return out;
}

export { WORDNET_SRC, YAML_DIR };
