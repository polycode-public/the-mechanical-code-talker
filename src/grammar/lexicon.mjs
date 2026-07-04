// grammar/lexicon.mjs — the declared lexicon behind tmct's ACE-OWL sub-fragment
// (ROADMAP Phase 2, item 2; docs/references/schemas/ace-owl-fragment.md).
//
// The lexicon is LOAD-BEARING: the grammar (grammar/ace.mjs) is only
// deterministic because every noun, verb (with any preposition), adjective
// (with its declared type) and proper name is DECLARED — tmct never guesses a
// word's category. Undeclared words route a sentence out of the grammar
// strategy (a miss is a feature: the interpretation pipeline falls through to
// the tolerant strategies).
//
// Data lives in lexicon-core.json (plain, diffable — the item-4/7 format
// discipline), a starter software-domain vocabulary. Callers extend it via
// loadLexicon(extra) with the same JSON shape; user entries win on conflict.
//
// Morphology is deliberately tiny and deterministic (no NLP dependency): a
// suffix-fold for plurals/3rd-person-singular ("repositories"→repository,
// "relies"→rely, "classes"→class, "uses"→use) plus an optional declared
// irregular `plural` ("indices"). Anything the fold can't reach is simply not
// in the lexicon — honest, not clever.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CORE_FILE = join(dirname(fileURLToPath(import.meta.url)), "lexicon-core.json");

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

/** 3rd-person-singular surface form of a verb lemma — the predicate spelling
 *  ("import"→imports, "rely"→relies, "catch"→catches, "have"→has), matching
 *  the code graph's 3sg relation-kind convention (ask.mjs §verbs). */
export function thirdPerson(base) {
  const b = String(base);
  if (b === "have") return "has";
  if (/[^aeiou]y$/.test(b)) return `${b.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(b)) return `${b}es`;
  return `${b}s`;
}

/** The URI-style predicate a verb entry emits: a declared override, or
 *  tmct:<3sg lemma> with any preposition camel-appended ("depend on"→tmct:dependsOn). */
export function predicateOf(verbEntry) {
  if (verbEntry.predicate) return verbEntry.predicate;
  const prep = verbEntry.prep ? verbEntry.prep[0].toUpperCase() + verbEntry.prep.slice(1) : "";
  return `tmct:${thirdPerson(verbEntry.lemma)}${prep}`;
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

let coreCache = null;

/** Load the lexicon: the committed core vocabulary, optionally merged with a
 *  caller-supplied `extra` block of the same JSON shape (extra entries win).
 *  The no-extra result is cached (the JSON is committed, immutable at runtime). */
export function loadLexicon(extra) {
  if (!extra && coreCache) return coreCache;
  const raw = JSON.parse(readFileSync(CORE_FILE, "utf8"));
  const lex = {
    nouns: new Map(),
    nounPlurals: new Map(),
    verbs: new Map(),
    adjectives: new Map(),
    properNames: new Map(), // lowercased → canonical spelling
  };
  ingest(lex, raw);
  if (extra) {
    ingest(lex, extra);
    return lex;
  }
  coreCache = lex;
  return lex;
}

/** Noun lookup with plural folding; returns the entry ({lemma, property?}) or null. */
export function lookupNoun(lexicon, word) {
  const w = String(word ?? "").toLowerCase();
  const irregular = lexicon.nounPlurals.get(w);
  if (irregular) return lexicon.nouns.get(irregular) ?? null;
  for (const cand of foldCandidates(w)) {
    const hit = lexicon.nouns.get(cand);
    if (hit) return hit;
  }
  return null;
}

/** Verb lookup with 3sg folding; returns the entry ({lemma, prep?, predicate?}) or null. */
export function lookupVerb(lexicon, word) {
  const w = String(word ?? "").toLowerCase();
  for (const cand of foldCandidates(w)) {
    const hit = lexicon.verbs.get(cand);
    if (hit) return hit;
  }
  return null;
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
    return { pos: "verb", type: "objectProperty", lemma: verb.lemma, predicate: predicateOf(verb), ...(verb.prep ? { prep: verb.prep } : {}) };
  }
  const adj = lookupAdjective(lexicon, lower);
  if (adj) return { pos: "adjective", type: adj.type, lemma: adj.lemma };
  return null;
}
