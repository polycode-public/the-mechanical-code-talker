#!/usr/bin/env node
// scripts/extract-persona-sources.mjs — maintainer-only curation-worksheet
// generator for the "human-world" default persona. Mirrors
// corpus/tier2/generate.mjs's own "not part of the product path" discipline:
// offline, $0, never imported by anything under src/ or bin/, never run by
// `npm test`.
//
// Reads two LOCALLY-CLONED reference repos (never vendored, never committed,
// never part of the npm package):
//   - Open English WordNet   (TMCT_WORDNET_SRC,   default ~/projects/globalwordnet/english-wordnet)
//   - Schema.org vocabulary  (TMCT_SCHEMAORG_SRC, default ~/projects/schemaorg/schemaorg)
// and writes ONE curation worksheet (JSON) surfacing CANDIDATES for the 9
// persona clumps — never the final committed files. A human
// (or an agent acting as one) reviews the worksheet and hand-picks the actual
// facts/lexicon words/example sentences that land in corpus/tier2/human.jsonl
// and src/domain/grammar/lexicon-core.json, exactly the same "curate down from a big
// source" discipline SEON and every existing tier2 bundle already follows.
//
//   node scripts/extract-persona-sources.mjs [--out <path>]
//
// Fails gracefully (a clear one-line message, exit 0 — never a stack trace)
// if either source repo isn't present locally: this is a maintainer
// convenience tool, never a build dependency, never required for `npm test`
// or the product path.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSchemaClasses } from "../src/domain/schemaorg/turtle.mjs";
import { isRealSentence } from "../src/domain/persona/examples.mjs";
import {
  WORDNET_YAML_DIR, loadSynsets, loadEntriesFor, loadAllNounSynsets,
} from "../src/adapters/wordnet-source.mjs";

const SCHEMAORG_SRC = process.env.TMCT_SCHEMAORG_SRC || join(homedir(), "projects", "schemaorg", "schemaorg");
const SCHEMA_TTL = join(SCHEMAORG_SRC, "data", "schema.ttl");

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : join("scripts", "persona-worksheet.json");
})();

// ---- WordNet candidate selection ------------------------------------------

/** For one target word, find its most likely synset (first noun sense, by
 *  WordNet's own sense-order convention — sense 1 is the most frequent/
 *  common sense in the source lexicographer files) and its one-hop
 *  hypernym candidate. */
function candidateFor(word, entries, synsets, pos = "n") {
  const senses = entries.get(word)?.[pos];
  if (!senses || !senses.length) return null;
  const synsetId = senses[0].synset;
  const synset = synsets.get(synsetId);
  if (!synset) return null;
  const hypernymId = Array.isArray(synset.hypernym) ? synset.hypernym[0] : null;
  const hyper = hypernymId ? synsets.get(hypernymId) : null;
  const hyperTerm = Array.isArray(hyper?.members) ? hyper.members[0] : null;
  return {
    word,
    synsetId,
    definition: Array.isArray(synset.definition) ? synset.definition[0] : synset.definition,
    example: Array.isArray(synset.example) ? synset.example[0] : synset.example,
    members: synset.members,
    hypernymId,
    hypernymTerm: hyperTerm,
    hypernymDefinition: Array.isArray(hyper?.definition) ? hyper.definition[0] : hyper?.definition,
  };
}

// ---- The 9 persona clumps -> source-file mapping ---------------------------

const CLUMPS = {
  "human-core": {
    files: ["noun.person.yaml", "noun.group.yaml"],
    // A curated CANDIDATE common-word list per clump — deliberately hand-picked
    // to be everyday words, not a mechanical dump of the ~10,400-synset pool
    // (WordNet's noun.person file alone includes
    // senses like "imaginary being"/"hypothetical creature" that must be
    // skipped in favour of "man", "woman", "doctor", "teacher", …).
    words: [
      "man", "woman", "person", "child", "boy", "girl", "baby", "adult",
      "friend", "neighbor", "stranger", "guest", "visitor",
      "doctor", "teacher", "nurse", "student", "worker", "farmer",
      "mother", "father", "parent", "brother", "sister", "family",
      "king", "queen", "soldier", "artist", "writer", "cook",
      "team", "group", "crowd", "audience", "club",
    ],
  },
  "human-places": {
    files: ["noun.location.yaml", "noun.artifact.yaml"],
    words: [
      "place", "city", "town", "village", "country", "state",
      "house", "home", "room", "kitchen", "bedroom", "bathroom",
      "school", "hospital", "shop", "store", "market", "church",
      "park", "garden", "street", "road", "bridge", "farm",
      "office", "factory", "library", "museum", "hotel", "airport",
    ],
  },
  "human-objects": {
    files: ["noun.artifact.yaml", "noun.possession.yaml"],
    words: [
      "hat", "shirt", "coat", "shoe", "dress", "clothing",
      "table", "chair", "bed", "door", "window", "wall", "roof",
      "book", "pen", "paper", "letter", "key", "lock", "box",
      "car", "bicycle", "boat", "train", "wheel",
      "knife", "spoon", "fork", "plate", "cup", "bottle", "bag",
      "money", "coin", "toy", "tool", "machine", "clock", "phone",
    ],
  },
  "human-nature": {
    files: ["noun.animal.yaml", "noun.plant.yaml", "noun.substance.yaml"],
    words: [
      "dog", "cat", "horse", "cow", "pig", "sheep", "bird", "fish",
      "mouse", "rabbit", "bear", "lion", "tiger", "elephant", "snake",
      "tree", "flower", "grass", "leaf", "root", "seed", "fruit",
      "water", "air", "fire", "earth", "stone", "sand", "gold", "iron",
      "rain", "snow", "wind", "cloud", "sun", "moon", "star",
    ],
  },
  "human-time-events": {
    files: ["noun.time.yaml", "noun.event.yaml", "noun.quantity.yaml"],
    words: [
      "time", "day", "night", "morning", "evening", "week", "month", "year",
      "hour", "minute", "second", "moment", "season", "spring", "summer", "winter",
      "party", "meeting", "wedding", "war", "game", "match", "race", "trip",
      "number", "amount", "pair", "dozen", "half", "part", "piece",
    ],
  },
  "human-body-food": {
    files: ["noun.body.yaml", "noun.food.yaml"],
    words: [
      "body", "head", "hand", "arm", "leg", "foot", "eye", "ear", "mouth",
      "nose", "hair", "heart", "blood", "bone", "skin", "face",
      "food", "bread", "meat", "milk", "egg", "cheese", "fruit", "vegetable",
      "meal", "breakfast", "dinner", "drink", "water", "wine", "tea", "coffee",
    ],
  },
  "human-mind": {
    files: ["noun.communication.yaml", "noun.cognition.yaml", "noun.feeling.yaml"],
    words: [
      "word", "language", "story", "news", "question", "answer", "idea",
      "thought", "mind", "knowledge", "memory", "dream", "belief", "reason",
      "love", "hate", "fear", "joy", "anger", "hope", "surprise", "pride",
      "name", "sound", "voice", "song", "picture", "art", "music",
    ],
  },
};

// ---- Schema.org class allowlist (human-base + human-bridge) ---------------

const SCHEMA_ALLOWLIST = ["Thing", "Person", "Place", "Event", "Organization", "Product"];

// ---- Example-sentence candidates ------------------------------------------
//
//   node scripts/extract-persona-sources.mjs --examples [--out <path>]
//
// Reads EVERY noun.*.yaml file (not just one clump's own source files — the
// already-curated word list in corpus/tier2/generate.mjs's own
// CORPUSES.human.lexicon.nouns spans words drawn from several source files
// each, and by this point the words are fixed and committed, so there is no
// more reason to keep the per-clump file split) and pulls each word's real
// WordNet inline `example:` sentence, where one exists (real coverage varies
// ~1-8% by category — most words won't have one, that's
// expected). Writes a candidate list — NOT the final committed file — for a
// human to hand-pick corpus/tier2/human-examples.jsonl from (same "curate
// down from a big source" discipline as everything else here).
async function writeExampleCandidates(outPath) {
  const { CORPUSES } = await import("../corpus/tier2/generate.mjs");
  const words = CORPUSES.human.lexicon.nouns.filter((w) => !w.includes(" "));
  const synsets = await loadAllNounSynsets();
  const entries = await loadEntriesFor(new Set(words));
  const candidates = [];
  for (const word of words) {
    const c = candidateFor(word, entries, synsets, "n");
    if (c && c.example && isRealSentence(c.example)) candidates.push({ term: word, sentence: c.example, sourceSynset: c.synsetId });
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outPath, JSON.stringify(candidates, null, 2) + "\n");
  console.error(`extract-persona-sources --examples: wrote ${outPath} (${candidates.length}/${words.length} words have a real WordNet example)`);
}

// ---- main ------------------------------------------------------------------

async function main() {
  if (!existsSync(WORDNET_YAML_DIR)) {
    console.error(`extract-persona-sources: WordNet source not found at ${WORDNET_YAML_DIR}`);
    console.error(`  (set TMCT_WORDNET_SRC to override — this is a maintainer convenience tool, not a build dependency)`);
    return;
  }
  if (!existsSync(SCHEMA_TTL)) {
    console.error(`extract-persona-sources: Schema.org source not found at ${SCHEMA_TTL}`);
    console.error(`  (set TMCT_SCHEMAORG_SRC to override — this is a maintainer convenience tool, not a build dependency)`);
    return;
  }

  if (process.argv.includes("--examples")) {
    const i = process.argv.indexOf("--out");
    const outPath = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : join("scripts", "persona-examples-candidates.json");
    await writeExampleCandidates(outPath);
    return;
  }

  const worksheet = { generatedBy: "scripts/extract-persona-sources.mjs", clumps: {}, schemaClasses: [] };

  // human-base / human-bridge candidates: Schema.org's Thing-rooted allowlist.
  const schemaText = await readFile(SCHEMA_TTL, "utf8");
  const schemaClasses = parseSchemaClasses(schemaText);
  for (const name of SCHEMA_ALLOWLIST) {
    const c = schemaClasses.get(name);
    if (c) worksheet.schemaClasses.push(c);
  }

  // The 8 content clumps.
  for (const [clumpId, spec] of Object.entries(CLUMPS)) {
    const synsets = await loadSynsets(spec.files);
    const entries = await loadEntriesFor(new Set(spec.words));
    const candidates = [];
    for (const word of spec.words) {
      const c = candidateFor(word, entries, synsets);
      if (c) candidates.push(c);
    }
    worksheet.clumps[clumpId] = { sourceFiles: spec.files, requested: spec.words.length, found: candidates.length, candidates };
  }

  await import("node:fs/promises").then(({ writeFile, mkdir }) =>
    mkdir(join(process.cwd(), "scripts"), { recursive: true }).then(() =>
      writeFile(OUT, JSON.stringify(worksheet, null, 2) + "\n")));

  const totalFound = Object.values(worksheet.clumps).reduce((n, c) => n + c.found, 0);
  const totalRequested = Object.values(worksheet.clumps).reduce((n, c) => n + c.requested, 0);
  console.error(`extract-persona-sources: wrote ${OUT}`);
  console.error(`  schema classes: ${worksheet.schemaClasses.length}/${SCHEMA_ALLOWLIST.length}`);
  console.error(`  wordnet candidates: ${totalFound}/${totalRequested} target words resolved`);
  for (const [id, c] of Object.entries(worksheet.clumps)) {
    console.error(`    ${id}: ${c.found}/${c.requested}`);
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();

export { candidateFor };
