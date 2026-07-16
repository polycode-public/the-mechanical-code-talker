#!/usr/bin/env node
// scripts/apply-persona-tiers.mjs — splices the reviewed
// scripts/build-persona-tiers.mjs worksheet into the two real committed
// surfaces: corpus/tier2/generate.mjs's CORPUSES object (new "human-medium"
// and "human-large" entries, each holding ONLY the facts incremental beyond
// the previous tier — PLAN_SEED.md's tier-selection design) and
// src/domain/grammar/lexicon-core.json (new nouns the incremental facts need).
// Maintainer-only, offline, $0 — never imported by src/ or bin/, never run
// by `npm test`. Run once per worksheet; re-run `node
// corpus/tier2/generate.mjs --verify` afterward to write the actual
// human-medium.jsonl/human-large.jsonl + manifest and verify alignment.
//
//   node scripts/apply-persona-tiers.mjs [--worksheet <path>]

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKSHEET = (() => {
  const i = process.argv.indexOf("--worksheet");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : join(HERE, "persona-tiers-worksheet.json");
})();
const GENERATE_PATH = join(HERE, "..", "corpus", "tier2", "generate.mjs");
const LEXICON_PATH = join(HERE, "..", "src", "domain", "grammar", "lexicon-core.json");

const CLUMP_ORDER = [
  "human-core", "human-places", "human-objects", "human-nature",
  "human-time-events", "human-body-food", "human-mind",
];
const CLUMP_LABEL = {
  "human-core": "people, family, common roles",
  "human-places": "places",
  "human-objects": "objects, clothing, tools",
  "human-nature": "animals, plants, substances",
  "human-time-events": "time and events",
  "human-body-food": "body and food",
  "human-mind": "communication, cognition, feeling",
};

// A modest map of common English irregular plurals among the words this
// batch is likely to introduce (Latin/Greek-derived cognition/body/nature
// vocabulary especially) — anything NOT in this map defaults to `{}` and
// relies on the regular -s/-es/-ies suffix fold (src/domain/grammar/lexicon.mjs's
// foldCandidates), same as the vast majority of Small tier's own additions.
const IRREGULAR_PLURALS = {
  foot: "feet", tooth: "teeth", goose: "geese", ox: "oxen", die: "dice",
  louse: "lice", mouse: "mice", crisis: "crises", analysis: "analyses",
  hypothesis: "hypotheses", thesis: "theses", axis: "axes", basis: "bases",
  oasis: "oases", criterion: "criteria", phenomenon: "phenomena",
  alumnus: "alumni", cactus: "cacti", focus: "foci", radius: "radii",
  fungus: "fungi", nucleus: "nuclei", stimulus: "stimuli", larva: "larvae",
  alga: "algae", vertebra: "vertebrae", antenna: "antennae",
  formula: "formulae", datum: "data", medium: "media", index: "indices",
  matrix: "matrices", appendix: "appendices", curriculum: "curricula",
  memorandum: "memoranda", millennium: "millennia", bacterium: "bacteria",
  stratum: "strata", genus: "genera", species: "species", series: "series",
  sheep: "sheep", deer: "deer", moose: "moose", salmon: "salmon",
  trout: "trout", swine: "swine", offspring: "offspring", spacecraft: "spacecraft",
  aircraft: "aircraft", scissors: "scissors", knife: "knives", wife: "wives",
  life: "lives", leaf: "leaves", loaf: "loaves", thief: "thieves",
  shelf: "shelves", elf: "elves", calf: "calves", half: "halves",
  wolf: "wolves", self: "selves", woman: "women", man: "men",
  child: "children", person: "people", tempo: "tempi",
};

function jsonlLine(subject, rel, concept) {
  return { start: `/c/en/${subject}`, rel, end: `/c/en/${concept}`, weight: 1 };
}

/** One clump's facts as indented JS array-literal source lines. */
function factsBlock(facts) {
  return facts.map(([s, r, o]) => `      ["${s}", "${r}", "${o}"],`).join("\n");
}

function nounsListBlock(words) {
  // Wrap at ~8 words/line, matching Small tier's own lexicon-list style.
  const lines = [];
  for (let i = 0; i < words.length; i += 8) {
    lines.push(`        ${words.slice(i, i + 8).map((w) => `"${w}"`).join(", ")},`);
  }
  return lines.join("\n");
}

function buildCorpusEntry(id, tierLabel, byClump) {
  const allNouns = CLUMP_ORDER.flatMap((c) => byClump[c].newNouns);
  const allFacts = CLUMP_ORDER.flatMap((c) => byClump[c].facts);
  const nounsSrc = CLUMP_ORDER.map((c) => `        // ${c} (+${byClump[c].newNouns.length} words: ${CLUMP_LABEL[c]})\n${nounsListBlock(byClump[c].newNouns)}`).join("\n");
  const factsSrc = CLUMP_ORDER.map((c) => `      // ---- ${c} (+${byClump[c].facts.length} facts, ${tierLabel}) ----\n${factsBlock(byClump[c].facts)}`).join("\n\n");

  return `
  // ${tierLabel} tier — INCREMENTAL facts beyond ${id === "human-medium" ? "Small (corpus/tier2/human.jsonl)" : "Medium (corpus/tier2/human-medium.jsonl)"} only
  // (PLAN_SEED.md §3's tier-selection design: Small/Medium/Large are SIZES of
  // one bundle, not separate corpus ids — this file holds only what ${tierLabel}
  // ADDS beyond the previous tier). Built by scripts/build-persona-tiers.mjs
  // from the same two locally-cloned WordNet source files as Small
  // (~/projects/globalwordnet/english-wordnet/src/yaml/), automatically
  // curated: candidate words ranked by WordNet sense-count (a commonness
  // proxy, PLAN_SEED.md §12), restricted to each word's own TOP senses (not
  // some rare/slang meaning that happens to live in this domain), obscure/
  // archaic/offensive/pharmaceutical content excluded via a definition-text
  // blocklist plus an explicit word denylist, reviewed by hand before being
  // spliced in here (scripts/apply-persona-tiers.mjs). ${id === "human-large" ? "Large's own facts walk real multi-hop hypernym chains (up to 4 hops, PLAN_SEED.md §3's own \"surgeon ⊑ doctor ⊑ … ⊑ person\" example) wherever WordNet's real structure supports it, not a flat one-hop-per-word cap." : "Medium stays flat, one hop per word, same style as Small."}
  "${id}": {
    kind: "domain",
    description: "The ${tierLabel} tier of the default human-world persona (PLAN_SEED.md): incremental facts beyond ${id === "human-medium" ? "Small" : "Medium"} only — activated alongside \\"human\\" via --persona-size ${id === "human-medium" ? "medium" : "large"}, never active by default.",
    lexicon: {
      nouns: [
${nounsSrc}
      ],
    },
    facts: [
${factsSrc}
    ],
  },
`;
}

async function main() {
  const worksheet = JSON.parse(await readFile(WORKSHEET, "utf8"));
  const generateSrc = await readFile(GENERATE_PATH, "utf8");

  const mediumEntry = buildCorpusEntry("human-medium", "Medium", worksheet.medium);
  const largeEntry = buildCorpusEntry("human-large", "Large", worksheet.large);

  const anchor = "\n};\n\nconst conceptUri = ";
  const idx = generateSrc.indexOf(anchor);
  if (idx === -1) throw new Error("apply-persona-tiers: could not find CORPUSES closing anchor in generate.mjs");
  const updatedGenerate = generateSrc.slice(0, idx) + mediumEntry + largeEntry + generateSrc.slice(idx + 1);
  await writeFile(GENERATE_PATH, updatedGenerate);
  console.error(`apply-persona-tiers: spliced human-medium + human-large into ${GENERATE_PATH}`);

  const lex = JSON.parse(await readFile(LEXICON_PATH, "utf8"));
  let added = 0;
  for (const tier of [worksheet.medium, worksheet.large]) {
    for (const clumpId of CLUMP_ORDER) {
      for (const word of tier[clumpId].newNouns) {
        if (lex.nouns[word]) continue; // already declared (shouldn't happen — usedWords guarded this)
        const plural = IRREGULAR_PLURALS[word];
        lex.nouns[word] = plural ? { plural } : {};
        added += 1;
      }
    }
  }
  await writeFile(LEXICON_PATH, JSON.stringify(lex, null, 2) + "\n");
  console.error(`apply-persona-tiers: added ${added} new nouns to ${LEXICON_PATH}`);
}

await main();
