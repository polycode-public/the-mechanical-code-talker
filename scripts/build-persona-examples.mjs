#!/usr/bin/env node
// scripts/build-persona-examples.mjs — maintainer-only curation-worksheet
// generator for the Medium/Large tiers of the example-sentence corpus
// (PLAN_SEED.md §9, the "tenth deliverable"). Mirrors
// scripts/build-persona-tiers.mjs's own discipline: offline, $0, never
// imported by anything under src/ or bin/, never run by `npm test`. Output
// is a curation WORKSHEET, not the final committed file — reviewed by hand
// before being written into corpus/tier2/human-examples-medium.jsonl /
// human-examples-large.jsonl.
//
// Two sources, both already used for Small's committed human-examples.jsonl:
//   1. WordNet's own inline `example:` field (same files as
//      scripts/build-persona-tiers.mjs reads) — extended here to cover the
//      cumulative Small+Medium and Small+Medium+Large word lists (every
//      corpus/tier2/generate.mjs CORPUSES.human*.lexicon.nouns list).
//   2. SemCor (~/projects/globalwordnet/semcor/) — real Brown Corpus text,
//      re-tagged to modern OEWN senses — for LARGE tier only, supplementing
//      categories where WordNet's own inline coverage is thin (human-nature
//      especially, PLAN_SEED.md §9: noun.animal's inline rate is <1%).
//      Filtered for simple grammar (short sentences, no semicolons) and
//      drawn from the plainer genres (press_reportage, humor) per §9's own
//      genre guidance.
//
//   node scripts/build-persona-examples.mjs --tier medium [--out <path>]
//   node scripts/build-persona-examples.mjs --tier large  [--out <path>]

import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { candidateFor } from "./extract-persona-sources.mjs";
import { WORDNET_YAML_DIR, loadAllNounSynsets, loadEntriesFor } from "../src/adapters/wordnet-source.mjs";
import { BLOCKLIST_RE, WORD_DENYLIST } from "../src/domain/persona/tiers.mjs";
import { isRealSentence, normalizeExample } from "../src/domain/persona/examples.mjs";
import {
  splitRecords, extractArray, extractText, isSimpleSentence, NOUN_POS,
} from "../src/domain/semcor/parse.mjs";

const SEMCOR_SRC = process.env.TMCT_SEMCOR_SRC || join(homedir(), "projects", "globalwordnet", "semcor");
const SEMCOR_DATA_DIR = join(SEMCOR_SRC, "data");

const TIER = (() => {
  const i = process.argv.indexOf("--tier");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : join("scripts", `persona-examples-${TIER || "worksheet"}.json`);
})();

// ---- WordNet inline examples (the same mechanism as
// extract-persona-sources.mjs's --examples mode, extended to a caller-
// supplied cumulative word list rather than always Small's own). ----

async function wordnetInlineExamples(words) {
  const synsets = await loadAllNounSynsets();
  const entries = await loadEntriesFor(new Set(words));
  const candidates = [];
  for (const word of words) {
    if (WORD_DENYLIST.has(word)) continue;
    const c = candidateFor(word, entries, synsets, "n");
    if (!c) continue;
    // candidateFor resolves via the entries index's sense-1 — NOT
    // necessarily the same sense build-persona-tiers.mjs picked for this
    // word's FACT (that script resolves from the clump's own source file,
    // this one from the word's overall most-common sense; they can
    // genuinely differ) — so the SAME two safety checks that script applies
    // to a fact's synset apply HERE too, against THIS resolved sense's own
    // definition: a real example, found live, is "dump"'s fact correctly
    // using its "waste disposal site" sense while its sense-1 example
    // sentence ("he took a shit") came from a completely different,
    // unrelated sense of the same headword.
    if (BLOCKLIST_RE.test(c.definition || "")) continue;
    const sentence = normalizeExample(c.example);
    if (sentence && isRealSentence(sentence)) {
      candidates.push({ term: word, sentence, sourceSynset: c.synsetId, source: "wordnet-inline" });
    }
  }
  return candidates;
}

// ---- SemCor supplement (Large tier only) ----------------------------------

const PREFERRED_GENRES = ["press_reportage", "humor"];
// A WIDER genre set for the human-nature priority pass only: press_reportage/
// humor (1960s American news + humor prose) turn out to rarely mention
// specific plant/animal/mineral vocabulary at all — the topic just doesn't
// come up — so restricting to the plainest genres would starve this pass of
// real hits regardless of the per-word cap. popular_lore (general-interest
// nonfiction) and skill_and_hobbies (gardening/pets/nature-adjacent topics)
// are still ordinary prose, just more likely to actually SAY "spruce"/
// "jackal"/"raven" — the same per-sentence simple-grammar filter
// (isSimpleSentence) still applies regardless of genre, so this widening
// trades genre-plainness for topical relevance, not grammatical complexity.
const NATURE_GENRES = ["press_reportage", "humor", "popular_lore", "skill_and_hobbies", "learned"];

async function semcorExamplesFor(targetWords, maxPerWord = 2, genres = PREFERRED_GENRES) {
  const targets = new Set(targetWords);
  const found = new Map(); // word -> [{sentence, source}]
  for (const genre of genres) {
    const dir = join(SEMCOR_DATA_DIR, genre);
    if (!existsSync(dir)) continue;
    const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml"));
    for (const f of files) {
      const text = await readFile(join(dir, f), "utf8");
      const blocks = splitRecords(text);
      for (const block of blocks) {
        const lemmas = extractArray(block, "lemmas");
        const pos = extractArray(block, "pos");
        if (!lemmas || !pos) continue;
        let matchWord = null;
        for (let idx = 0; idx < lemmas.length; idx += 1) {
          const lemma = String(lemmas[idx] || "").toLowerCase();
          if (targets.has(lemma) && NOUN_POS.has(pos[idx])) { matchWord = lemma; break; }
        }
        if (!matchWord) continue;
        const already = found.get(matchWord) || [];
        if (already.length >= maxPerWord) continue;
        const sentence = extractText(block);
        if (!sentence || !isSimpleSentence(sentence, lemmas.length)) continue;
        already.push({ term: matchWord, sentence, source: `semcor:${genre}/${f}` });
        found.set(matchWord, already);
      }
    }
  }
  return [...found.values()].flat();
}

// ---- main ------------------------------------------------------------------

async function main() {
  if (!TIER || !["medium", "large"].includes(TIER)) {
    console.error("usage: node scripts/build-persona-examples.mjs --tier medium|large [--out <path>]");
    process.exit(1);
  }
  if (!existsSync(WORDNET_YAML_DIR)) {
    console.error(`build-persona-examples: WordNet source not found at ${WORDNET_YAML_DIR}`);
    return;
  }

  const { CORPUSES } = await import("../corpus/tier2/generate.mjs");
  const smallNouns = CORPUSES.human.lexicon.nouns.filter((w) => !w.includes(" "));
  const mediumNouns = (CORPUSES["human-medium"]?.lexicon.nouns || []).filter((w) => !w.includes(" "));
  const largeNouns = (CORPUSES["human-large"]?.lexicon.nouns || []).filter((w) => !w.includes(" "));

  // Existing committed Small-tier sentences (never duplicated — this tier's
  // output holds ONLY incremental sentences, same "increment-only" design as
  // the fact tiers).
  const smallExamplesPath = join("corpus", "tier2", "human-examples.jsonl");
  const smallTerms = new Set();
  if (existsSync(smallExamplesPath)) {
    const text = await readFile(smallExamplesPath, "utf8");
    for (const line of text.trim().split("\n").filter(Boolean)) smallTerms.add(JSON.parse(line).term);
  }

  const cumulativeWords = TIER === "medium"
    ? [...smallNouns, ...mediumNouns]
    : [...smallNouns, ...mediumNouns, ...largeNouns];
  const newWordsThisTier = TIER === "medium" ? mediumNouns : largeNouns;

  // WordNet inline, for every word this tier's cumulative vocabulary
  // introduces beyond what's already in the committed Small-tier file.
  const targetWords = newWordsThisTier.filter((w) => !smallTerms.has(w));
  const inline = await wordnetInlineExamples(targetWords);
  const coveredTerms = new Set(inline.map((c) => c.term));

  const worksheet = { tier: TIER, inline, semcor: [] };

  if (TIER === "large") {
    // SemCor supplement for thin-inline-coverage categories — human-nature
    // ESPECIALLY (PLAN_SEED.md §9: noun.animal's own inline rate is <1%).
    // The flat CORPUSES lexicon list doesn't tag words by clump, so the
    // per-clump breakdown comes from build-persona-tiers.mjs's own worksheet
    // (scripts/persona-tiers-worksheet.json by default — re-run that script
    // first if this file is missing/stale). human-nature words are targeted
    // FIRST (a real priority, not just "in practice dominates"); every other
    // still-uncovered word across every clump fills in AFTER, so the
    // supplement still contributes useful volume even where the worksheet
    // isn't available.
    const worksheetPath = (() => {
      const i = process.argv.indexOf("--tiers-worksheet");
      return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : join("scripts", "persona-tiers-worksheet.json");
    })();
    let natureWords = [];
    if (existsSync(worksheetPath)) {
      const tiersWorksheet = JSON.parse(await readFile(worksheetPath, "utf8"));
      natureWords = [
        ...(tiersWorksheet.medium?.["human-nature"]?.newNouns || []),
        ...(tiersWorksheet.large?.["human-nature"]?.newNouns || []),
      ];
    } else {
      console.error(`build-persona-examples: tiers worksheet not found at ${worksheetPath} — skipping the human-nature priority pass (falling back to all uncovered words)`);
    }
    const allNewWords = [...mediumNouns, ...largeNouns];
    const natureUncovered = natureWords.filter((w) => !smallTerms.has(w) && !coveredTerms.has(w) && !w.includes(" "));
    const otherUncovered = allNewWords.filter((w) => !natureWords.includes(w) && !smallTerms.has(w) && !coveredTerms.has(w) && !w.includes(" "));
    if (existsSync(SEMCOR_DATA_DIR)) {
      // TWO real passes, not just a re-sorted target list — semcorExamplesFor
      // scans by FILE/record, not by target order, so priority has to come
      // from which words are even IN a given call's target set. human-nature
      // gets a generous per-word cap (3) since it's the whole point of this
      // supplement; the general fallback pass (cap 1) tops up volume from
      // every other still-uncovered word without letting it dominate.
      const natureExamples = await semcorExamplesFor(natureUncovered, 3, NATURE_GENRES);
      const otherExamples = await semcorExamplesFor(otherUncovered, 1, PREFERRED_GENRES);
      worksheet.semcor = [...natureExamples, ...otherExamples];
    } else {
      console.error(`build-persona-examples: SemCor source not found at ${SEMCOR_DATA_DIR} — skipping supplement`);
    }
  }

  await writeFile(OUT, JSON.stringify(worksheet, null, 2) + "\n");
  console.error(`build-persona-examples --tier ${TIER}: wrote ${OUT}`);
  console.error(`  wordnet inline: ${inline.length}/${targetWords.length} target words resolved`);
  console.error(`  semcor supplement: ${worksheet.semcor.length} sentences`);
  console.error(`  TOTAL new sentences this tier: ${inline.length + worksheet.semcor.length}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();

