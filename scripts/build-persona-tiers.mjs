#!/usr/bin/env node
// scripts/build-persona-tiers.mjs — maintainer-only generator for the
// Medium/Large persona tiers (PLAN_SEED.md §3). Mirrors
// scripts/extract-persona-sources.mjs's own discipline: offline, $0, never
// imported by anything under src/ or bin/, never run by `npm test`. Its
// OUTPUT is a curation worksheet (JSON), not the final committed files — a
// human (or an agent acting as one) reviews it before it's spliced into
// corpus/tier2/generate.mjs's CORPUSES object by
// scripts/apply-persona-tiers.mjs.
//
// Algorithm (real WordNet structure, no invented facts):
//   1. Load every noun.*.yaml synset into one global id->record map, and
//      every entries-<letter>.yaml word->senses index (both offline, $0,
//      ~1.5s total — see the two loops below).
//   2. Per clump (PLAN_SEED.md §3's source-file mapping), collect candidate
//      HEADWORDS from the clump's own source file(s): single-word (no
//      underscore — multi-word compounds are never added as lexicon nouns,
//      matching the "hash_table"-as-concept-filler precedent already used
//      by every other tier2 corpus), definition not flagged by the
//      obscurity blocklist (archaic/offensive/hypothetical/mythical/…,
//      PLAN_SEED.md §3's own "imaginary being"/"hypothetical creature"
//      example), not already declared in lexicon-core.json.
//   3. Rank candidates by WordNet sense-count (a word's total number of
//      senses across every part of speech) as a commonness proxy — PLAN_SEED
//      §12's own suggested alternative to an external frequency list, needs
//      no extra download. Select top-N per clump until the incremental fact
//      target (Medium: tier target minus Small's real count; Large: tier
//      target minus Medium's) is reached.
//   4. Medium: one flat hop per word (word IsA hypernym-term), matching
//      Small's own style, plus one real meronym-derived secondary fact where
//      the word's own synset has mero_part/mero_member/mero_substance data
//      (word HasA part / word HasA member / word MadeOf substance) — never
//      invented, always the real WordNet pointer.
//   5. Large: walks the REAL hypernym chain up to 4 hops (stopping early at
//      a STOP_SET root already established by human-base/Small — e.g.
//      "person", "animal", "artifact"), reproducing PLAN_SEED.md §3's own
//      worked example ("surgeon ⊑ doctor ⊑ medical_professional ⊑
//      professional ⊑ person") for whichever words' real WordNet depth
//      happens to support it — not a fixed quota, a natural consequence of
//      walking real pointers. Same meronym secondary-fact pass as Medium.
//
//   node scripts/build-persona-tiers.mjs [--out <path>]
//
// Fails gracefully or exits 0 if the WordNet source isn't present locally.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../src/domain/wordnet/yaml.mjs";
import { WORDNET_YAML_DIR as YAML_DIR } from "../src/adapters/wordnet-source.mjs";
import {
  collectCandidates, buildClump, stripDenylisted, makeAncestorRootCheck, declaredWords,
} from "../src/domain/persona/tiers.mjs";

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : join("scripts", "persona-tiers-worksheet.json");
})();

// ---- Real, measured incremental targets (PLAN_SEED.md §3's table; Small's
// real per-clump counts measured directly from corpus/tier2/generate.mjs's
// CORPUSES.human.facts, not the doc's own rounded "~N facts" comments). ----
const SMALL_REAL = {
  "human-core": 147, "human-places": 80, "human-objects": 103,
  "human-nature": 98, "human-time-events": 58, "human-body-food": 80, "human-mind": 70,
};
const MEDIUM_TARGET = {
  "human-core": 350, "human-places": 200, "human-objects": 250,
  "human-nature": 250, "human-time-events": 150, "human-body-food": 200, "human-mind": 180,
};
const LARGE_TARGET = {
  "human-core": 2500, "human-places": 1200, "human-objects": 2800,
  "human-nature": 2800, "human-time-events": 900, "human-body-food": 1400, "human-mind": 2000,
};

const CLUMP_FILES = {
  "human-core": ["noun.person.yaml", "noun.group.yaml"],
  "human-places": ["noun.location.yaml"], // + artifact "building" subtree, below
  "human-objects": ["noun.artifact.yaml", "noun.possession.yaml"], // minus building subtree
  "human-nature": ["noun.animal.yaml", "noun.plant.yaml", "noun.substance.yaml"],
  "human-time-events": ["noun.time.yaml", "noun.event.yaml", "noun.quantity.yaml"],
  "human-body-food": ["noun.body.yaml", "noun.food.yaml"],
  "human-mind": ["noun.communication.yaml", "noun.cognition.yaml", "noun.feeling.yaml"],
};

async function loadAllNounSynsets() {
  const files = (await readdir(YAML_DIR)).filter((f) => f.startsWith("noun."));
  const map = new Map();
  const byFile = new Map();
  for (const f of files) {
    const text = await readFile(join(YAML_DIR, f), "utf8");
    const parsed = parseYaml(text);
    byFile.set(f, parsed);
    for (const [id, rec] of Object.entries(parsed)) map.set(id, rec);
  }
  return { map, byFile };
}

async function loadAllEntries() {
  const files = (await readdir(YAML_DIR)).filter((f) => f.startsWith("entries-"));
  const map = new Map();
  for (const f of files) {
    const text = await readFile(join(YAML_DIR, f), "utf8");
    const parsed = parseYaml(text);
    for (const [word, byPos] of Object.entries(parsed)) {
      const senses = {};
      let total = 0;
      for (const [pos, rec] of Object.entries(byPos || {})) {
        if (pos === "form") continue;
        const list = Array.isArray(rec?.sense) ? rec.sense : [];
        const s = list.map((x) => ({ id: x.id, synset: x.synset })).filter((x) => x.synset);
        senses[pos] = s;
        total += s.length;
      }
      map.set(word, { senses, total });
    }
  }
  return map;
}

async function main() {
  if (!existsSync(YAML_DIR)) {
    console.error(`build-persona-tiers: WordNet source not found at ${YAML_DIR}`);
    console.error(`  (set TMCT_WORDNET_SRC to override — maintainer tool, not a build dependency)`);
    return;
  }

  console.error("build-persona-tiers: loading WordNet synsets + entries…");
  const t0 = Date.now();
  const { map: synsetMap, byFile } = await loadAllNounSynsets();
  const entriesIdx = await loadAllEntries();
  console.error(`  loaded ${synsetMap.size} synsets, ${entriesIdx.size} entry words in ${Date.now() - t0}ms`);

  const { CORPUSES } = await import("../corpus/tier2/generate.mjs");
  const smallLexiconNouns = new Set(CORPUSES.human.lexicon.nouns.map((w) => w.toLowerCase()));
  const lexPath = fileURLToPath(new URL("../src/domain/grammar/lexicon-core.json", import.meta.url));
  const lex = JSON.parse(await readFile(lexPath, "utf8"));
  const usedWords = declaredWords(lex, smallLexiconNouns);

  // Seed the triple-dedup set with every fact already in Small's own corpus
  // (Medium/Large hold ONLY incremental facts beyond the previous tier).
  const seenTriples = new Set();
  for (const [s, r, o] of CORPUSES.human.facts) seenTriples.add(`${s}|${r}|${o}`);

  // human-places' extra pool: noun.artifact synsets under a "building-like"
  // root (structure/building/dwelling/housing/edifice) — noun.location.yaml
  // alone (875 synsets, mostly abstract regions/boundaries) is too thin for
  // Large's 1200-fact target on its own (PLAN_SEED.md §3's own source note:
  // "noun.location + artifact-buildings share"). human-objects draws from
  // the REMAINDER of noun.artifact (everything NOT under that root) so the
  // two clumps don't compete for the same synsets.
  const artifactParsed = byFile.get("noun.artifact.yaml");
  const isUnderBuildingRoot = makeAncestorRootCheck(synsetMap, new Set(["structure", "building", "dwelling", "housing", "edifice"]));
  const artifactBuilding = [];
  const artifactRest = [];
  for (const [id, synset] of Object.entries(artifactParsed)) {
    (isUnderBuildingRoot(id) ? artifactBuilding : artifactRest).push([id, synset]);
  }
  console.error(`  noun.artifact split: ${artifactBuilding.length} building-like, ${artifactRest.length} other`);

  const clumpSynsetEntries = {};
  for (const [clumpId, files] of Object.entries(CLUMP_FILES)) {
    if (clumpId === "human-places") {
      const locParsed = byFile.get("noun.location.yaml");
      clumpSynsetEntries[clumpId] = [...Object.entries(locParsed), ...artifactBuilding];
    } else if (clumpId === "human-objects") {
      const possParsed = byFile.get("noun.possession.yaml");
      clumpSynsetEntries[clumpId] = [...artifactRest, ...Object.entries(possParsed)];
    } else {
      const entries = [];
      for (const f of files) entries.push(...Object.entries(byFile.get(f) || {}));
      clumpSynsetEntries[clumpId] = entries;
    }
  }

  const worksheet = { medium: {}, large: {}, stats: {} };

  for (const clumpId of Object.keys(CLUMP_FILES)) {
    const mediumTarget = MEDIUM_TARGET[clumpId] - SMALL_REAL[clumpId];
    const largeTarget = LARGE_TARGET[clumpId] - MEDIUM_TARGET[clumpId];

    // Medium: flat one-hop (maxHops=1) + meronym secondary.
    const mediumCandidates = collectCandidates(clumpSynsetEntries[clumpId], usedWords, entriesIdx);
    const medium = stripDenylisted(buildClump(clumpId, mediumCandidates, entriesIdx, synsetMap, mediumTarget, usedWords, seenTriples, { maxHops: 1 }));
    worksheet.medium[clumpId] = medium;

    // Large: real multi-hop chain (maxHops=4, stopping at STOP_SET) + meronym.
    // Recomputed AFTER Medium's selections update usedWords, so Large never
    // reselects a word Medium already claimed.
    const largeCandidates = collectCandidates(clumpSynsetEntries[clumpId], usedWords, entriesIdx);
    const large = stripDenylisted(buildClump(clumpId, largeCandidates, entriesIdx, synsetMap, largeTarget, usedWords, seenTriples, { maxHops: 4 }));
    worksheet.large[clumpId] = large;

    console.error(`  ${clumpId}: medium ${medium.got}/${mediumTarget} facts (${medium.newNouns.length} words), large ${large.got}/${largeTarget} facts (${large.newNouns.length} words)`);
  }

  const totalMedium = Object.values(worksheet.medium).reduce((n, c) => n + c.got, 0);
  const totalLarge = Object.values(worksheet.large).reduce((n, c) => n + c.got, 0);
  worksheet.stats = { totalMedium, totalLarge, smallTotal: CORPUSES.human.facts.length };
  console.error(`TOTAL medium incremental: ${totalMedium}, large incremental: ${totalLarge}`);
  console.error(`Grand totals: small ${CORPUSES.human.facts.length}, medium ${CORPUSES.human.facts.length + totalMedium}, large ${CORPUSES.human.facts.length + totalMedium + totalLarge}`);

  await writeFile(OUT, JSON.stringify(worksheet, null, 2) + "\n");
  console.error(`wrote ${OUT}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();

