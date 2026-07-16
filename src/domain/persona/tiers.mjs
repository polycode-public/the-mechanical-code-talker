// tiers.mjs — the curation rules that build the Medium/Large persona tiers out
// of real WordNet structure. No invented facts: every hop and every meronym is
// a pointer WordNet already declares.
//
// Pure throughout — these read in-memory maps a caller loaded from disk, so
// they are testable with no WordNet clone present. The loading lives in
// src/adapters/wordnet-source.mjs, the fact targets and the run itself in
// scripts/build-persona-tiers.mjs.

// human-base's own category roots, plus every hypernym TARGET term Small's
// curation already established as a "root" word (generate.mjs's own comment:
// "category-root nouns used as a hypernym TARGET") — a real hypernym chain
// walk stops here rather than continuing on to WordNet's ultra-abstract
// "entity"/"abstraction"/"physical_entity" tops, which would add depth
// without adding anything a plain-English question would ever ask about.
export const STOP_SET = new Set([
  "person", "place", "object", "event", "time", "quantity", "organization", "group",
  "animal", "plant", "furniture", "vehicle", "insect", "emotion", "metal", "liquid",
  "weather", "planet", "jewelry", "cutlery", "government", "material", "artifact",
  "location", "structure", "food", "drink", "clothing", "body", "language", "mind",
  "family", "meal", "season", "number", "entity", "abstraction", "physical_entity",
  "attribute", "state", "act", "communication", "cognition", "measure", "unit",
]);

export const BLOCKLIST_RE = /\b(archaic|obsolete|offensive|derogatory|informal|slang|dialect|euphemism|hypothetical|imaginary|mythical|mythology|extraterrestrial|fictional|taxonomic genus|genus of|family [A-Z]|nonstandard|vulgar|disparaging|obscene|coarse|genital|ethnic slur|ethnic epithet|excrement|contemptuous|insulting|trade name|street name|controlled substance|illegal|sexual assault|monoclonal antibody|chemical compound|chemical formula|proprietary name)\b/i;

// A short, explicit denylist for specific words WordNet's own definitions
// don't reliably self-tag (the blocklist regex above misses some — e.g. the
// "female genitals" sense of a common word is tagged only "obscene terms
// for…", but the word itself has an unrelated clean sense too, so it isn't
// caught by filtering on OTHER senses' definitions). Checked directly
// against candidate headwords, not definitions.
export const WORD_DENYLIST = new Set([
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

/** Definition text of a synset (first line only — enough for the blocklist). */
export function defOf(synset) {
  return Array.isArray(synset?.definition) ? synset.definition[0] : synset?.definition || "";
}

/** Every word the lexicon already declares, across ALL THREE parts of speech,
 *  plus the previous tier's own nouns.
 *
 *  Adjectives and verbs count, not just nouns: a word already declared as an
 *  adjective (e.g. "male") must never ALSO become a noun. That was a real bug,
 *  caught only by running the suite — the first pass added "male" as a noun
 *  since WordNet legitimately has that sense too, which made ACE reclassify
 *  "ahab is male" as class-membership (rdfs:subClassOf) instead of the intended
 *  property fact (mgx:hasProperty), silently breaking every filter-rule test
 *  built on "who is male". Nouns/verbs/adjectives are independent lookup maps
 *  and a word CAN legitimately sit in two ("cook", "love" already do, noun +
 *  verb), but a NEW second classification for an EXISTING word is never
 *  introduced — only the word's original part of speech is authoritative. */
export function declaredWords(lex, previousTierNouns = []) {
  return new Set([
    ...Object.keys(lex.nouns).map((w) => w.toLowerCase()),
    ...Object.keys(lex.verbs).map((w) => w.toLowerCase()),
    ...Object.keys(lex.adjectives).map((w) => w.toLowerCase()),
    ...[...previousTierNouns].map((w) => w.toLowerCase()),
  ]);
}

/** Walk UP a synset's hypernym chain from `synsetId`, resolving each
 *  ancestor's member[0] term, to check membership of a "building-like" root
 *  set (human-places' artifact-subtree filter) — up to 8 hops, memoized. */
export function makeAncestorRootCheck(synsetMap, rootWords) {
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
// "draw" = an entertainer), which is a genuinely obscure long-tail sense —
// just obscure at the SENSE level rather than the word level. Top-3 senses
// (rank <= 2) gives real latitude (a word's domain-relevant meaning is very
// often sense 2 or 3, not always sense 1) while still excluding deep-tail
// marginal senses.
export const MAX_SENSE_RANK = 2;

export function senseRank(word, synsetId, entriesIdx) {
  const nounSenses = entriesIdx.get(word)?.senses?.n;
  if (!nounSenses) return -1;
  return nounSenses.findIndex((s) => s.synset === synsetId);
}

/** Candidate headwords from a set of synsets: up to 2 qualifying members per
 *  synset (real WordNet synonyms, not invented) — word regex, length bound,
 *  not blocklisted, not already used, and the synset must be among the
 *  word's own top senses (see senseRank above). */
export function collectCandidates(synsetEntries, usedWords, entriesIdx) {
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
export function resolveSynset(word, candidateSynsetId, synsetMap) {
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
export const looksLikeCommonTerm = (term) => String(term).split(" ").every((tok) => tok.length <= 15);

/** One real hypernym hop: [subjectTerm, "/r/IsA", hypernymTerm], plus the
 *  next synset to continue from (or null at a stop/dead end/blocklisted
 *  ancestor — a chain never walks INTO an obscure/archaic/mythical/technical
 *  concept, even if the word that started the chain was clean). */
export function nextHop(term, synsetId, synsetMap) {
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
export function meronymFact(word, synset, synsetMap) {
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
export function rankCandidates(words, entriesIdx) {
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
export function buildClump(clumpId, candidatesMap, entriesIdx, synsetMap, target, usedWords, seenTriples, opts) {
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

/** Final safety net: a denylisted word (see WORD_DENYLIST) can still reach a
 *  fact as a HYPERNYM/MERONYM TARGET (nextHop/meronymFact only check the
 *  definition-text blocklist + the shape filter, not the explicit word list —
 *  that list is deliberately checked here, once, against every final fact's
 *  subject AND object, rather than duplicated at every resolution call site).
 *  Drops the fact outright and prunes any newNoun left with no remaining
 *  supporting fact (mirrors generate.mjs's own verifyLexiconAlignment
 *  "orphaned metadata" check). */
export function stripDenylisted(result) {
  const hasDenied = (term) => term.split(" ").some((tok) => WORD_DENYLIST.has(tok));
  const facts = result.facts.filter((f) => !hasDenied(f[0]) && !hasDenied(f[2]));
  const survivingTerms = new Set(facts.flatMap((f) => [f[0], f[2]]));
  const newNouns = result.newNouns.filter((w) => survivingTerms.has(w));
  return { ...result, facts, newNouns, got: facts.length };
}
