// codegen.mjs — renders a reviewed persona-tier worksheet as JS source, ready
// to splice into corpus/tier2/generate.mjs's CORPUSES object, and as the
// lexicon-core.json noun entries those facts need.
//
// Pure: worksheet in, source text out, no imports.

export const CLUMP_ORDER = [
  "human-core", "human-places", "human-objects", "human-nature",
  "human-time-events", "human-body-food", "human-mind",
];

export const CLUMP_LABEL = {
  "human-core": "people, family, common roles",
  "human-places": "places",
  "human-objects": "objects, clothing, tools",
  "human-nature": "animals, plants, substances",
  "human-time-events": "time and events",
  "human-body-food": "body and food",
  "human-mind": "communication, cognition, feeling",
};

// The irregular plurals among the words these batches introduce (Latin/Greek-
// derived cognition/body/nature vocabulary especially). A word absent from this
// map gets `{}` and relies on the regular -s/-es/-ies suffix fold at LOOKUP
// time (src/domain/grammar/lexicon.mjs's foldCandidates), same as the vast
// majority of Small tier's own additions. So this map is not a pluralizer: it
// is the list of exceptions that folding cannot recover, and declaring a
// regular plural here would be redundant.
//
// This is deliberately NOT src/domain/inflect.mjs's pluralOf, and the two must
// not be merged. They answer opposite questions. pluralOf GENERATES candidate
// surface forms for the real-word collision table, where over-generating is the
// cheap mistake and its own header commits to regular rules only — it wants
// "foots", because a form it fails to generate is a real word the repair tier
// may rewrite into a different question. This map DECLARES the one correct
// plural for a lexicon entry, where "foots" would simply be a lie the grammar
// then trusts. Teaching pluralOf about "feet" would cost the collision table
// "foots"; deriving this map from pluralOf would put "foots" in the lexicon.
export const IRREGULAR_PLURALS = {
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

/** One noun's lexicon-core.json entry: an explicit plural only where folding
 *  could not recover it. */
export function lexiconNounEntry(word) {
  const plural = IRREGULAR_PLURALS[word];
  return plural ? { plural } : {};
}

/** One clump's facts as indented JS array-literal source lines. */
export function factsBlock(facts) {
  return facts.map(([s, r, o]) => `      ["${s}", "${r}", "${o}"],`).join("\n");
}

/** A noun list wrapped at ~8 words/line, matching Small tier's own
 *  lexicon-list style. */
export function nounsListBlock(words) {
  const lines = [];
  for (let i = 0; i < words.length; i += 8) {
    lines.push(`        ${words.slice(i, i + 8).map((w) => `"${w}"`).join(", ")},`);
  }
  return lines.join("\n");
}

/** One CORPUSES entry as JS source, for `id` ("human-medium"/"human-large")
 *  from `byClump`, the reviewed worksheet's per-clump {facts, newNouns}. */
export function buildCorpusEntry(id, tierLabel, byClump) {
  const nounsSrc = CLUMP_ORDER.map((c) => `        // ${c} (+${byClump[c].newNouns.length} words: ${CLUMP_LABEL[c]})\n${nounsListBlock(byClump[c].newNouns)}`).join("\n");
  const factsSrc = CLUMP_ORDER.map((c) => `      // ---- ${c} (+${byClump[c].facts.length} facts, ${tierLabel}) ----\n${factsBlock(byClump[c].facts)}`).join("\n\n");

  return `
  // ${tierLabel} tier — INCREMENTAL facts beyond ${id === "human-medium" ? "Small (corpus/tier2/human.jsonl)" : "Medium (corpus/tier2/human-medium.jsonl)"} only
  // (Small/Medium/Large are SIZES of one bundle, not separate corpus ids — this
  // file holds only what ${tierLabel} ADDS beyond the previous tier). Built by
  // scripts/build-persona-tiers.mjs
  // from the same two locally-cloned WordNet source files as Small
  // (~/projects/globalwordnet/english-wordnet/src/yaml/), automatically
  // curated: candidate words ranked by WordNet sense-count (a commonness
  // proxy), restricted to each word's own TOP senses (not
  // some rare/slang meaning that happens to live in this domain), obscure/
  // archaic/offensive/pharmaceutical content excluded via a definition-text
  // blocklist plus an explicit word denylist, reviewed by hand before being
  // spliced in here (scripts/apply-persona-tiers.mjs). ${id === "human-large" ? "Large's own facts walk real multi-hop hypernym chains (up to 4 hops, e.g. \"surgeon ⊑ doctor ⊑ … ⊑ person\") wherever WordNet's real structure supports it, not a flat one-hop-per-word cap." : "Medium stays flat, one hop per word, same style as Small."}
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

/** The CORPUSES source with `entries` spliced in before its closing brace.
 *  Throws when the anchor is absent rather than writing a mangled file. */
export function spliceCorpusEntries(generateSrc, entries) {
  const anchor = "\n};\n\nconst conceptUri = ";
  const idx = generateSrc.indexOf(anchor);
  if (idx === -1) throw new Error("apply-persona-tiers: could not find CORPUSES closing anchor in generate.mjs");
  return generateSrc.slice(0, idx) + entries.join("") + generateSrc.slice(idx + 1);
}
