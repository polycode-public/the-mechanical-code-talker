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
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./extract-persona-sources.mjs";

const WORDNET_SRC = process.env.TMCT_WORDNET_SRC || join(homedir(), "projects", "globalwordnet", "english-wordnet");
const YAML_DIR = join(WORDNET_SRC, "src", "yaml");

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

// human-base's own category roots, plus every hypernym TARGET term Small's
// curation already established as a "root" word (generate.mjs's own comment:
// "category-root nouns used as a hypernym TARGET") — a real hypernym chain
// walk stops here rather than continuing on to WordNet's ultra-abstract
// "entity"/"abstraction"/"physical_entity" tops, which would add depth
// without adding anything a plain-English question would ever ask about.
const STOP_SET = new Set([
  "person", "place", "object", "event", "time", "quantity", "organization", "group",
  "animal", "plant", "furniture", "vehicle", "insect", "emotion", "metal", "liquid",
  "weather", "planet", "jewelry", "cutlery", "government", "material", "artifact",
  "location", "structure", "food", "drink", "clothing", "body", "language", "mind",
  "family", "meal", "season", "number", "entity", "abstraction", "physical_entity",
  "attribute", "state", "act", "communication", "cognition", "measure", "unit",
]);

const BLOCKLIST_RE = /\b(archaic|obsolete|offensive|derogatory|informal|slang|dialect|euphemism|hypothetical|imaginary|mythical|mythology|extraterrestrial|fictional|taxonomic genus|genus of|family [A-Z]|nonstandard|vulgar|disparaging|obscene|coarse|genital|ethnic slur|ethnic epithet|excrement|contemptuous|insulting|trade name|street name|controlled substance|illegal|sexual assault|monoclonal antibody|chemical compound|chemical formula|proprietary name)\b/i;
// A short, explicit denylist for specific words WordNet's own definitions
// don't reliably self-tag (the blocklist regex above misses some — e.g. the
// "female genitals" sense of a common word is tagged only "obscene terms
// for…", but the word itself has an unrelated clean sense too, so it isn't
// caught by filtering on OTHER senses' definitions). Checked directly
// against candidate headwords, not definitions.
const WORD_DENYLIST = new Set([
  "cunt", "pussy", "dick", "cock", "prick", "twat", "boob", "tit", "tits",
  "fuck", "shit", "piss", "bitch", "whore", "slut", "fag", "faggot", "nigger",
  "nigga", "spic", "chink", "kike", "wetback", "retard", "cripple",
  "asshole", "poop", "rape", "bastard",
  // deictic/function words that happen to carry a marginal WordNet noun
  // sense ("here" = "this place") — technically real, pragmatically not
  // something a plain-English question would ever ask "what is X" about.
  "here", "there", "somewhere", "elsewhere", "nowhere", "anywhere", "everywhere",
  // Real, live test-fixture collisions (test/fixtures/entities.fixture.json's
  // code-graph class/individual names double as ordinary WordNet-common
  // words) — found by actually running the test suite against the first
  // draft of this batch, not guessed in advance. "base"/"button" are
  // exactly the kind of everyday-but-also-a-common-class-name word that
  // will keep recurring as the persona vocabulary grows; excluded rather
  // than editing the shared fixture (many other tests depend on its exact
  // shape). "john" is also excluded on its own merits — WordNet's sense
  // for it (a prostitute's customer) is exactly the "obscure/informal
  // long-tail" this batch's curation is meant to skip, its own definition
  // just doesn't happen to carry one of the blocklist's tag words.
  "base", "button", "register", "john", "store",
]);
const WORD_RE = /^[a-z]+$/;

const humanize = (term) => String(term).replace(/_/g, " ");

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

/** Definition text of a synset (first line only — enough for the blocklist). */
function defOf(synset) {
  return Array.isArray(synset?.definition) ? synset.definition[0] : synset?.definition || "";
}

/** Walk UP a synset's hypernym chain from `synsetId`, resolving each
 *  ancestor's member[0] term, to check membership of a "building-like" root
 *  set (human-places' artifact-subtree filter) — up to 8 hops, memoized. */
function makeAncestorRootCheck(synsetMap, rootWords) {
  const memo = new Map();
  function isUnderRoot(id, depth = 0) {
    if (depth > 8 || !id) return false;
    if (memo.has(id)) return memo.get(id);
    const s = synsetMap.get(id);
    if (!s) { memo.set(id, false); return false; }
    const members = (s.members || []).map((m) => m.toLowerCase());
    if (members.some((m) => rootWords.has(m))) { memo.set(id, true); return true; }
    const hyperId = Array.isArray(s.hypernym) ? s.hypernym[0] : null;
    const result = hyperId ? isUnderRoot(hyperId, depth + 1) : false;
    memo.set(id, result);
    return result;
  }
  return isUnderRoot;
}

// A candidate is only accepted for a clump if the synset we found it in is
// among the word's own TOP senses overall (its sense-rank in the entries
// reverse index, 0-based) — otherwise a common, highly polysemous word
// (e.g. "run", "light", "draw", "back") gets swept in via some rare/slang
// sense that just happens to live in this domain ("light" = a friend,
// "draw" = an entertainer), which is exactly the "genuinely obscure
// long-tail" PLAN_SEED.md §3 says to skip — just obscure at the SENSE level
// rather than the word level. Top-3 senses (rank <= 2) gives real latitude
// (a word's domain-relevant meaning is very often sense 2 or 3, not always
// sense 1) while still excluding deep-tail marginal senses.
const MAX_SENSE_RANK = 2;

function senseRank(word, synsetId, entriesIdx) {
  const nounSenses = entriesIdx.get(word)?.senses?.n;
  if (!nounSenses) return -1;
  return nounSenses.findIndex((s) => s.synset === synsetId);
}

/** Candidate headwords from a set of synsets: up to 2 qualifying members per
 *  synset (real WordNet synonyms, not invented) — word regex, length bound,
 *  not blocklisted, not already used, and the synset must be among the
 *  word's own top senses (see senseRank above). */
function collectCandidates(synsetEntries, usedWords, entriesIdx) {
  const candidates = new Map(); // word -> first-seen synsetId (existence only)
  for (const [id, synset] of synsetEntries) {
    if (BLOCKLIST_RE.test(defOf(synset))) continue;
    const members = synset.members || [];
    let taken = 0;
    for (const m of members) {
      if (taken >= 2) break;
      const w = String(m).toLowerCase();
      if (!WORD_RE.test(w) || w.length < 2 || w.length > 16 || WORD_DENYLIST.has(w)) continue;
      if (usedWords.has(w) || candidates.has(w)) continue;
      const rank = senseRank(w, id, entriesIdx);
      if (rank < 0 || rank > MAX_SENSE_RANK) continue;
      candidates.set(w, id);
      taken += 1;
    }
  }
  return candidates;
}

/** Resolve a word to the SPECIFIC synset it was discovered under in the
 *  clump's own source file(s) — deliberately NOT the entries index's
 *  sense-1 (a word's globally-most-frequent sense across ALL of WordNet is
 *  routinely a completely different domain than the clump it was found in —
 *  e.g. "run" turning up as a noun.group.yaml member resolves, via a global
 *  sense-1 lookup, to a baseball score, not anything group-related). The
 *  entries index is used ONLY for the sense-count ranking heuristic
 *  (rankCandidates), never for resolution. */
function resolveSynset(word, candidateSynsetId, synsetMap) {
  const synset = synsetMap.get(candidateSynsetId);
  if (!synset) return null;
  return { synsetId: candidateSynsetId, synset };
}

// Chemical/pharmaceutical trade names (e.g. "methylenedioxymethamphetamine",
// "infliximab") are almost always a single very long unbroken word with no
// spaces — real everyday concepts, even multi-word ones ("medium of
// exchange"), never have an individual token this long. A cheap, effective
// shape filter: reject any candidate/hypernym/meronym TERM with a token over
// 15 characters, independent of the definition-text blocklist (which these
// technical entries routinely don't trip, since their definitions are
// clinically neutral — "a monoclonal antibody used to treat…" carries none
// of the archaic/slang/offensive keywords above).
const looksLikeCommonTerm = (term) => String(term).split(" ").every((tok) => tok.length <= 15);

/** One real hypernym hop: [subjectTerm, "/r/IsA", hypernymTerm], plus the
 *  next synset to continue from (or null at a stop/dead end/blocklisted
 *  ancestor — a chain never walks INTO an obscure/archaic/mythical/technical
 *  concept, even if the word that started the chain was clean). */
function nextHop(term, synsetId, synsetMap) {
  const s = synsetMap.get(synsetId);
  const hyperId = Array.isArray(s?.hypernym) ? s.hypernym[0] : null;
  if (!hyperId) return null;
  const hyper = synsetMap.get(hyperId);
  if (BLOCKLIST_RE.test(defOf(hyper))) return null;
  const hyperTerm = Array.isArray(hyper?.members) ? humanize(hyper.members[0]).toLowerCase() : null;
  if (!hyperTerm || hyperTerm === term || !looksLikeCommonTerm(hyperTerm)) return null;
  return { fact: [term, "/r/IsA", hyperTerm], nextSynsetId: hyperId, nextTerm: hyperTerm };
}

/** A real meronym-derived secondary fact for `synset`, preferring
 *  mero_part > mero_member > mero_substance (word HasA part / HasA member /
 *  MadeOf substance) — real WordNet pointers, never invented. */
function meronymFact(word, synset, synsetMap) {
  const pick = (key, rel) => {
    const ids = synset[key];
    if (!Array.isArray(ids) || !ids.length) return null;
    const target = synsetMap.get(ids[0]);
    if (BLOCKLIST_RE.test(defOf(target))) return null;
    const term = Array.isArray(target?.members) ? humanize(target.members[0]).toLowerCase() : null;
    if (!term || term === word || !looksLikeCommonTerm(term)) return null;
    return [word, rel, term];
  };
  return pick("mero_part", "/r/HasA") || pick("mero_member", "/r/HasA") || pick("mero_substance", "/r/MadeOf");
}

// Sense-count score, tie-broken by shorter word then alphabetically —
// deterministic across re-runs (same inputs -> same output, no Math.random).
function rankCandidates(words, entriesIdx) {
  return [...words].sort((a, b) => {
    const sa = entriesIdx.get(a)?.total || 0;
    const sb = entriesIdx.get(b)?.total || 0;
    if (sb !== sa) return sb - sa;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Build one tier's incremental facts + new-noun list for one clump.
 *  `candidatesMap` is word -> the SPECIFIC synset id it was discovered under
 *  (from collectCandidates) — the actual resolution source (see
 *  resolveSynset's doc comment); `entriesIdx` is used only for ranking. */
function buildClump(clumpId, candidatesMap, entriesIdx, synsetMap, target, usedWords, seenTriples, opts) {
  const { maxHops } = opts;
  const ranked = rankCandidates(candidatesMap.keys(), entriesIdx);
  const facts = [];
  const newNouns = [];
  for (const word of ranked) {
    if (facts.length >= target) break;
    if (usedWords.has(word)) continue;
    const resolved = resolveSynset(word, candidatesMap.get(word), synsetMap);
    if (!resolved) continue;
    const wordFacts = [];
    let curTerm = word;
    let curSynsetId = resolved.synsetId;
    for (let hop = 0; hop < maxHops; hop += 1) {
      const h = nextHop(curTerm, curSynsetId, synsetMap);
      if (!h) break;
      const key = `${h.fact[0]}|${h.fact[1]}|${h.fact[2]}`;
      if (!seenTriples.has(key)) { wordFacts.push(h.fact); seenTriples.add(key); }
      if (STOP_SET.has(h.nextTerm)) break;
      curTerm = h.nextTerm;
      curSynsetId = h.nextSynsetId;
    }
    const mero = meronymFact(word, resolved.synset, synsetMap);
    if (mero) {
      const key = `${mero[0]}|${mero[1]}|${mero[2]}`;
      if (!seenTriples.has(key)) { wordFacts.push(mero); seenTriples.add(key); }
    }
    if (!wordFacts.length) continue; // every candidate hop/mero fact was already present elsewhere — skip
    facts.push(...wordFacts);
    newNouns.push(word);
    usedWords.add(word);
  }
  return { facts, newNouns, clumpId, requested: target, got: facts.length };
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
  const lexPath = fileURLToPath(new URL("../src/grammar/lexicon-core.json", import.meta.url));
  const lex = JSON.parse(await readFile(lexPath, "utf8"));
  // Excludes existing ADJECTIVES and VERBS too, not just nouns — a word
  // already declared as an adjective (e.g. "male") must never ALSO become a
  // noun: a real bug caught live (build-persona-tiers.mjs's first pass added
  // "male" as a noun since WordNet legitimately has that sense too, which
  // then made ACE reclassify "ahab is male" as class-membership
  // (rdfs:subClassOf) instead of the intended property fact
  // (mgx:hasProperty) — silently breaking every filter-rule test built on
  // "who is male"). Nouns/verbs/adjectives are independent lookup maps
  // (a word CAN legitimately sit in two — "cook", "love" already do, noun +
  // verb), but never introduce a NEW second classification for an EXISTING
  // word — only the word's original part of speech is authoritative.
  const usedWords = new Set([
    ...Object.keys(lex.nouns).map((w) => w.toLowerCase()),
    ...Object.keys(lex.verbs).map((w) => w.toLowerCase()),
    ...Object.keys(lex.adjectives).map((w) => w.toLowerCase()),
    ...smallLexiconNouns,
  ]);

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

  // Final safety net: a denylisted word (see WORD_DENYLIST) can still reach
  // a fact as a HYPERNYM/MERONYM TARGET (nextHop/meronymFact only check the
  // definition-text blocklist + the shape filter, not the explicit word
  // list — that list is deliberately checked here, once, against every
  // final fact's subject AND object, rather than duplicated at every
  // resolution call site). Drops the fact outright and prunes any newNoun
  // left with no remaining supporting fact (mirrors generate.mjs's own
  // verifyLexiconAlignment "orphaned metadata" check).
  function stripDenylisted(result) {
    const hasDenied = (term) => term.split(" ").some((tok) => WORD_DENYLIST.has(tok));
    const facts = result.facts.filter((f) => !hasDenied(f[0]) && !hasDenied(f[2]));
    const survivingTerms = new Set(facts.flatMap((f) => [f[0], f[2]]));
    const newNouns = result.newNouns.filter((w) => survivingTerms.has(w));
    return { ...result, facts, newNouns, got: facts.length };
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
