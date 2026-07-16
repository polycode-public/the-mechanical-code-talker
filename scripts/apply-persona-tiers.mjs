#!/usr/bin/env node
// scripts/apply-persona-tiers.mjs — splices the reviewed
// scripts/build-persona-tiers.mjs worksheet into the two real committed
// surfaces: corpus/tier2/generate.mjs's CORPUSES object (new "human-medium"
// and "human-large" entries, each holding ONLY the facts incremental beyond
// the previous tier) and src/domain/grammar/lexicon-core.json (new nouns the
// incremental facts need). Maintainer-only, offline, $0 — never imported by
// src/ or bin/, never run by `npm test`. Run once per worksheet; re-run `node
// corpus/tier2/generate.mjs --verify` afterward to write the actual
// human-medium.jsonl/human-large.jsonl + manifest and verify alignment.
//
//   node scripts/apply-persona-tiers.mjs [--worksheet <path>]

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  CLUMP_ORDER, buildCorpusEntry, spliceCorpusEntries, lexiconNounEntry,
} from "../src/domain/persona/codegen.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKSHEET = (() => {
  const i = process.argv.indexOf("--worksheet");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : join(HERE, "persona-tiers-worksheet.json");
})();
const GENERATE_PATH = join(HERE, "..", "corpus", "tier2", "generate.mjs");
const LEXICON_PATH = join(HERE, "..", "src", "domain", "grammar", "lexicon-core.json");

async function main() {
  const worksheet = JSON.parse(await readFile(WORKSHEET, "utf8"));
  const generateSrc = await readFile(GENERATE_PATH, "utf8");

  const mediumEntry = buildCorpusEntry("human-medium", "Medium", worksheet.medium);
  const largeEntry = buildCorpusEntry("human-large", "Large", worksheet.large);

  await writeFile(GENERATE_PATH, spliceCorpusEntries(generateSrc, [mediumEntry, largeEntry]));
  console.error(`apply-persona-tiers: spliced human-medium + human-large into ${GENERATE_PATH}`);

  const lex = JSON.parse(await readFile(LEXICON_PATH, "utf8"));
  let added = 0;
  for (const tier of [worksheet.medium, worksheet.large]) {
    for (const clumpId of CLUMP_ORDER) {
      for (const word of tier[clumpId].newNouns) {
        if (lex.nouns[word]) continue; // already declared (usedWords guarded this)
        lex.nouns[word] = lexiconNounEntry(word);
        added += 1;
      }
    }
  }
  await writeFile(LEXICON_PATH, JSON.stringify(lex, null, 2) + "\n");
  console.error(`apply-persona-tiers: added ${added} new nouns to ${LEXICON_PATH}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
