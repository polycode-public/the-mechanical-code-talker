// grammar/lexicon.mjs — the declared lexicon behind tmct's ACE-OWL
// sub-fragment parser (see ace.mjs). The lexicon is
// LOAD-BEARING: the grammar is only deterministic because every noun, verb
// (with any preposition), adjective (with its declared type) and proper name
// is DECLARED — the parser never guesses a word's category. Undeclared words
// route a sentence out of the grammar (a miss is a feature, not a bug — see
// ace.mjs).
//
// Data lives in lexicon-core.json (plain, diffable), tmct's starter
// software-domain vocabulary. Extend it via loadLexicon(extra) with the same
// JSON shape (extensions.mjs's mergedLexiconExtra); extra entries win on
// conflict.
//
// Namespace: every lexicon carries a `.ns` field (the CURIE prefix ace.mjs
// stamps onto every term it mints) — always "tmct:" here (DEFAULT_NS).
//
// Morphology is deterministic (no NLP dependency): a
// suffix-fold for plurals/3rd-person-singular ("repositories"→repository,
// "relies"→rely, "classes"→class, "uses"→use) plus an optional declared
// irregular `plural` ("indices"). Anything the fold can't reach is simply not
// in the lexicon — honest, not clever.

// The core vocabulary rides in as a JSON module — declarative data, no
// filesystem read at import or call time, and the browser bundler inlines it.
import coreLexiconRaw from "./lexicon-core.json" with { type: "json" };

/** The CURIE namespace every tmct lexicon mints terms under. */
const DEFAULT_NS = "tmct:";

/** Determiner tokens the grammar consumes (pattern table's every/a/no…). */
export const DETERMINERS = Object.freeze({
  every: "universal",
  a: "indefinite",
  an: "indefinite",
  the: "definite",
  no: "negative",
});

/** The cardinality quantifier phrases (pattern 5) → the OWL term they select. */
export const QUANTIFIERS = Object.freeze({
  "at least": "owl:minCardinality",
  "at most": "owl:maxCardinality",
  exactly: "owl:cardinality",
});

// The two closed head vocabularies that say what an "of" between two nouns is
// DOING, so every reader of the of-frame decides it the same way instead of
// each growing its own list. A CLASSIFIER head reads THROUGH to the inner noun
// — "a kind of dog" is a dog, "a type of mammal" is a mammal — so the phrase
// is a rewrite of the inner noun, never a term of its own. A PARTITIVE head
// states quantity or composition — "a piece of cake", "a lot of dogs", "a body
// of ice" — so the phrase names no class at all. Anything else ("unit of
// work", "chain of command") is a compound noun the of belongs to.
/** Of-frame heads that read through to the inner noun. */
export const OF_CLASSIFIER_HEADS = Object.freeze(new Set([
  "type", "kind", "sort", "form", "class", "variety", "species", "breed", "genus",
]));
/** Of-frame heads that state quantity or composition, not a class. */
export const OF_PARTITIVE_HEADS = Object.freeze(new Set([
  "body", "mass", "group", "collection", "set", "series", "number", "amount",
  "piece", "part", "lot", "pair", "bunch", "pile",
]));

const NUMBER_WORDS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
});

/** Parse a cardinality count token: a digit run or a small number word. */
export function numberOf(word) {
  const w = String(word ?? "").trim().toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return NUMBER_WORDS[w] ?? null;
}

/** 3rd-person-singular surface form of a verb lemma ("import"→imports,
 *  "rely"→relies, "catch"→catches, "have"→has) — the predicate spelling. */
export function thirdPerson(base) {
  const b = String(base);
  if (b === "have") return "has";
  if (/[^aeiou]y$/.test(b)) return `${b.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(b)) return `${b}es`;
  return `${b}s`;
}

/** The URI-style predicate a verb entry emits: a declared override
 *  (verbEntry.predicate, namespace-independent), or `${ns}<3sg lemma>` with
 *  any preposition camel-appended ("depend on" → `${ns}dependsOn`). `ns`
 *  defaults to DEFAULT_NS for a caller that doesn't thread one through. */
export function predicateOf(verbEntry, ns = DEFAULT_NS) {
  if (verbEntry.predicate) return verbEntry.predicate;
  const prep = verbEntry.prep ? verbEntry.prep[0].toUpperCase() + verbEntry.prep.slice(1) : "";
  return `${ns}${thirdPerson(verbEntry.lemma)}${prep}`;
}

/** Deterministic singular/base-form candidates for a surface word, most
 *  specific first: as-is, -ies→y, -(s|x|z|ch|sh)es→stem, -s→stem. The FIRST
 *  candidate found in the relevant map wins ("classes"→class before "classe";
 *  "uses"→"us" misses, "use" hits). */
function foldCandidates(word) {
  const w = String(word);
  const out = [w];
  if (w.length > 4 && /[a-z]ies$/.test(w)) out.push(`${w.slice(0, -3)}y`);
  if (/(ses|xes|zes|ches|shes)$/.test(w)) out.push(w.slice(0, -2));
  if (/[a-z]s$/.test(w) && !/ss$/.test(w)) out.push(w.slice(0, -1));
  if (w === "has") out.push("have");
  return out;
}

const NOUN_PROPERTY_TYPES = new Set(["data", "object"]);
const ADJECTIVE_TYPES = new Set(["subclass", "data"]);

/** Merge one raw lexicon block ({nouns, verbs, adjectives, properNames}) into
 *  the lookup maps, validating the declared typings (bad declarations throw —
 *  a lexicon that lies would make the grammar guess). */
function ingest(lex, raw = {}) {
  for (const [lemma, e] of Object.entries(raw.nouns || {})) {
    const entry = { lemma, ...(e || {}) };
    if (entry.property && !NOUN_PROPERTY_TYPES.has(entry.property)) {
      throw new Error(`lexicon noun "${lemma}": property must be "data" or "object", got ${JSON.stringify(entry.property)}`);
    }
    lex.nouns.set(lemma, entry);
    if (entry.plural) lex.nounPlurals.set(entry.plural, lemma);
  }
  for (const [lemma, e] of Object.entries(raw.verbs || {})) {
    lex.verbs.set(lemma, { lemma, ...(e || {}) });
  }
  for (const [lemma, e] of Object.entries(raw.adjectives || {})) {
    const entry = { lemma, ...(e || {}) };
    if (!ADJECTIVE_TYPES.has(entry.type)) {
      throw new Error(`lexicon adjective "${lemma}": type must be "subclass" or "data", got ${JSON.stringify(entry.type)}`);
    }
    lex.adjectives.set(lemma, entry);
  }
  for (const name of raw.properNames || []) {
    lex.properNames.set(String(name).toLowerCase(), String(name));
  }
}

// Cache keyed by namespace — a no-extra load is immutable at runtime and
// cached per-ns, so two consumers requesting different namespaces (or the
// same one repeatedly) each get a stable, shared lexicon object.
const coreCacheByNs = new Map();

/** Load the lexicon: the committed core vocabulary, optionally merged with a
 *  caller-supplied `extra` block of the same JSON shape (extra entries win).
 *  `ns` (default DEFAULT_NS) is stamped onto the returned lexicon as `.ns` —
 *  the CURIE prefix ace.mjs mints new terms under. The no-extra result is
 *  cached per-ns (the JSON is committed, immutable at runtime). */
export function loadLexicon(extra, ns = DEFAULT_NS) {
  if (!extra && coreCacheByNs.has(ns)) return coreCacheByNs.get(ns);
  const raw = coreLexiconRaw;
  const lex = {
    nouns: new Map(),
    nounPlurals: new Map(),
    verbs: new Map(),
    adjectives: new Map(),
    properNames: new Map(), // lowercased → canonical spelling
    ns,
  };
  ingest(lex, raw);
  if (extra) {
    ingest(lex, extra);
    return lex;
  }
  coreCacheByNs.set(ns, lex);
  return lex;
}

/** `lexicon` with `names` additionally declared as proper names. The noun,
 *  verb and adjective maps are SHARED with the base lexicon rather than
 *  re-ingested — a caller that re-declares on every turn (a live game world
 *  minting ids as it is played) would otherwise rebuild nine thousand core
 *  entries to add half a dozen. Proper names outrank every other category, so
 *  a name with no dictionary reading of its own ("groundhog-1", "carrot-2")
 *  resolves as itself instead of dying as an undeclared word. */
export function withProperNames(lexicon, names) {
  const properNames = new Map(lexicon.properNames);
  for (const name of names) properNames.set(String(name).toLowerCase(), String(name));
  return { ...lexicon, properNames };
}

/** Noun lookup with plural folding; returns the entry ({lemma, property?}) or
 *  null. `opts.singularOnly` (an "a"/"an" determiner) prunes the irregular-
 *  plural fold in favor of a standalone-singular entry when both exist for
 *  the same surface word (die/dice, person/people). */
export function lookupNoun(lexicon, word, opts = {}) {
  return lookupNounCandidates(lexicon, word, opts)[0] ?? null;
}

/** Every lexicon entry `word` could plausibly resolve to, ranked the same as
 *  lookupNoun's top choice but without discarding a genuine alternate (e.g.
 *  die/dice returns both entries). */
function lookupNounCandidates(lexicon, word, opts = {}) {
  const w = String(word ?? "").toLowerCase();
  const standalone = lexicon.nouns.get(w);
  const irregular = lexicon.nounPlurals.get(w);
  const out = [];
  const seen = new Set();
  const push = (entry) => {
    if (entry && !seen.has(entry.lemma)) { seen.add(entry.lemma); out.push(entry); }
  };
  if (irregular) {
    const irregularEntry = lexicon.nouns.get(irregular) ?? null;
    if (opts.singularOnly && standalone) {
      // grammatical-agreement pruning: "a"/"an" rules out the plural-fold
      // reading, so the standalone singular entry is ranked FIRST here.
      push(standalone);
      push(irregularEntry);
    } else {
      push(irregularEntry);
      push(standalone);
    }
    return out;
  }
  for (const cand of foldCandidates(w)) {
    push(lexicon.nouns.get(cand));
  }
  return out;
}

/** Verb lookup with 3sg folding; returns the entry ({lemma, prep?, predicate?}) or null. */
export function lookupVerb(lexicon, word) {
  return lookupVerbCandidates(lexicon, word)[0] ?? null;
}

/** Every verb entry `word` could plausibly resolve to via foldCandidates,
 *  most-specific-fold-first — the verb sibling of lookupNounCandidates. */
function lookupVerbCandidates(lexicon, word) {
  const w = String(word ?? "").toLowerCase();
  const out = [];
  const seen = new Set();
  for (const cand of foldCandidates(w)) {
    const hit = lexicon.verbs.get(cand);
    if (hit && !seen.has(hit.lemma)) { seen.add(hit.lemma); out.push(hit); }
  }
  return out;
}

/** Adjective lookup (exact lemma); returns {lemma, type, property?, value?} or null. */
export function lookupAdjective(lexicon, word) {
  return lexicon.adjectives.get(String(word ?? "").toLowerCase()) ?? null;
}

/** Proper-name lookup, case-insensitive; returns the CANONICAL spelling or null. */
export function lookupProperName(lexicon, word) {
  return lexicon.properNames.get(String(word ?? "").toLowerCase()) ?? null;
}

/** Classify one word (or a two-word quantifier phrase) against the lexicon.
 *  Returns {pos, type?, …} or null for an undeclared word. Priority when a
 *  word is declared in several categories (e.g. "test" noun+verb): closed-class
 *  tokens, then properName > noun > verb > adjective — the grammar itself
 *  disambiguates by position, this is the standalone answer. */
export function classify(word, lexicon = loadLexicon()) {
  const w = String(word ?? "").trim();
  if (!w) return null;
  const lower = w.toLowerCase();
  if (DETERMINERS[lower]) return { pos: "determiner", type: DETERMINERS[lower] };
  if (QUANTIFIERS[lower]) return { pos: "quantifier", type: QUANTIFIERS[lower] };
  const n = numberOf(lower);
  if (n != null) return { pos: "number", type: "cardinal", value: n };
  const proper = lookupProperName(lexicon, w);
  if (proper) return { pos: "properName", type: "individual", canonical: proper };
  const noun = lookupNoun(lexicon, lower);
  if (noun) {
    return noun.property
      ? { pos: "noun", type: `${noun.property}-property`, lemma: noun.lemma, property: noun.property }
      : { pos: "noun", type: "class", lemma: noun.lemma };
  }
  const verb = lookupVerb(lexicon, lower);
  if (verb) {
    return { pos: "verb", type: "objectProperty", lemma: verb.lemma, predicate: predicateOf(verb, lexicon.ns), ...(verb.prep ? { prep: verb.prep } : {}) };
  }
  const adj = lookupAdjective(lexicon, lower);
  if (adj) return { pos: "adjective", type: adj.type, lemma: adj.lemma };
  return null;
}
