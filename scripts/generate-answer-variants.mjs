#!/usr/bin/env node
// scripts/generate-answer-variants.mjs — maintainer-only audit for
// src/domain/answer-variants.json (the wired-in answer-phrasing variety table --
// see src/domain/answer-variants.mjs for how it's used at render time). Never
// imported by src/ or bin/, never run by `npm test`, same discipline as its
// sibling scripts/generate-template-variants.mjs.
//
// src/domain/answer-variants.json is HAND-CURATED, not mechanically generated: its
// pools are domain-specific code-graph connector phrases ("defined in",
// "is dated", "for the full breakdown", ...) that describe a graph relation
// or a UI pointer, not ordinary prose -- WordNet's own sense-1-is-most-
// frequent convention (the same convention generate-template-variants.mjs's
// synsetsFor call already uses) resolves most of these to the WRONG sense
// ("locate" -> "turn up", "record" -> "enter, put down", "module" -> "mental
// faculty"), so mechanical substitution the way generate-template-variants.mjs
// does it for ordinary corpus sentences would silently produce nonsense here.
//
// What this script actually does: for every pool's `base` phrase, look up
// each content word's real WordNet synset (scripts/lib/wordnet-synonyms.mjs,
// the same maintainer-only reader generate-template-variants.mjs already
// uses) and print whether that pool's committed variants line up with a real
// synset sibling or were accepted purely on hand judgment -- an audit trail
// a maintainer can re-run after WordNet updates or before adding a new pool,
// never a file-writer. It NEVER edits answer-variants.json.
//
//   node scripts/generate-answer-variants.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { synsetsFor } from "./lib/wordnet-synonyms.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(HERE, "..", "src", "domain", "answer-variants.json");

async function main() {
  const data = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const pools = data.pools || {};
  const poolIds = Object.keys(pools);
  console.log(`generate-answer-variants: auditing ${poolIds.length} pool(s) in ${DATA_FILE}\n`);

  // Every distinct word across every base phrase, so one synsetsFor call
  // covers the whole file (mirrors generate-template-variants.mjs's own
  // batch-then-lookup shape).
  const words = new Set();
  for (const pool of Object.values(pools)) {
    for (const w of String(pool.base || "").toLowerCase().split(/\W+/).filter(Boolean)) words.add(w);
  }
  const synsets = await synsetsFor(words);

  for (const id of poolIds) {
    const pool = pools[id];
    console.log(`- ${id}: "${pool.base}" -> ${JSON.stringify(pool.variants)}`);
    for (const w of String(pool.base).toLowerCase().split(/\W+/).filter(Boolean)) {
      const hits = synsets.get(w);
      if (!hits || !hits.length) { console.log(`    "${w}": no WordNet entry -- accepted on hand judgment only`); continue; }
      for (const h of hits) {
        const siblings = h.members.filter((m) => m.toLowerCase() !== w);
        const matched = pool.variants.some((v) => siblings.some((s) => v.toLowerCase().includes(s.toLowerCase())));
        console.log(`    "${w}" (${h.pos} ${h.synsetId}): synset siblings [${siblings.join(", ")}]`
          + (matched ? " -- a committed variant reuses one" : " -- committed variants chosen by hand, not from this synset (wrong sense for this context)"));
      }
    }
  }
  console.log("\ngenerate-answer-variants: audit only, answer-variants.json was not modified.");
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
