// retrieval-plan.mjs — what a turn asks a corpus for, worked out before any
// read happens. Pure: the same text, the same fuzzy mode and the same caps give
// the same plan, on any machine, in any order.
//
// The plan mirrors the engine's own reach rather than guessing at relevance.
// The engine chases aliases two hops and widens inheritance one stored
// rdfs:subClassOf hop, so the plan pulls two hops of relations plus the whole
// subClassOf ancestry chain above whatever it finds. A subgraph that covers
// those bounds holds everything the engine could have reached anyway.
//
// Nothing here is scored or ranked. Terms come out sorted, variants come out
// sorted and capped, and a cap always cuts the same tail. That is what lets a
// smaller budget return a prefix of a larger one's answer instead of a
// different answer.

import { normFactTerm } from "./hash.mjs";
import { loadLexicon, lookupNoun, classify } from "./grammar/lexicon.mjs";
import { editDistance, fuzzyBound, FUZZY_REPAIR_MIN_LENGTH } from "./interpret/fuzzy.mjs";
import { STOPWORDS, splitWords, normalizeQuery } from "./interpret/normalize.mjs";
import collisionData from "./real-word-collisions.json" with { type: "json" };

/** The row class a fact projects onto. The closed set itself lives with the
 *  backend contract, one layer out, so the one value this module reads is
 *  spelled here rather than imported upward. */
const FACT_ROW_CLASS = "fact";

/** The predicate whose object is a superclass. The ancestry chase follows this
 *  and nothing else. */
export const ANCESTRY_PREDICATE = "rdfs:subClassOf";

/** Real English words the fuzzy tier attracts. A word already in the language
 *  is not a typo, so retrieval spends no variants on it: the exact query is the
 *  answer path, and variants of a real word only pull rows about something
 *  else. The fuzzy tier keeps its own copy of this set behind an accessor that
 *  answers a different question (which repair to make), so this module reads
 *  the committed table directly. */
const REAL_ENGLISH_WORDS = new Set(collisionData.words);

/** Word classes that never name a fact's subject. Retrieval keys on subjects,
 *  which are nominal, so a known verb, adjective, determiner or quantifier is
 *  dropped before it costs a Query. An unknown word survives: it may be an
 *  entity the lexicon has never heard of, or the typo fuzzy mode exists for. */
const NON_SUBJECT_PARTS_OF_SPEECH = new Set(["verb", "adjective", "determiner", "quantifier", "number"]);

const MIN_TERM_LENGTH = 2;

/** Function words that cannot name a subject, on top of the parser's own
 *  stopword list: pronouns, auxiliaries and conjunctions.
 *
 *  Prepositions and degree words are deliberately absent, though they look like
 *  the obvious next thing to drop. "above", "below", "between", "always" and
 *  "never" are all real corpus terms carrying real facts, and a term this list
 *  refuses is a miss that never had to happen. Asking for a word that grounds
 *  nothing costs one Query, and the budgets already cap those. */
const FUNCTION_WORDS = new Set([
  "am", "and", "as", "be", "because", "been", "being", "but", "he", "her", "hers", "herself",
  "him", "himself", "his", "i", "if", "it", "its", "itself", "me", "mine", "my", "myself",
  "nor", "or", "our", "ours", "ourselves", "she", "so", "that", "their", "theirs", "them",
  "themselves", "these", "they", "this", "those", "though", "us", "we", "whether", "while",
  "you", "your", "yours", "yourself",
]);

/** The regular singular folds, applied to a word the lexicon does not know.
 *  A known noun folds through `lookupNoun`, which already runs these; a corpus
 *  term the lexicon never declared ("tariffs") needs them applied directly. */
function regularSingularForms(word) {
  const forms = [];
  if (word.length > 4 && /[a-z]ies$/.test(word)) forms.push(`${word.slice(0, -3)}y`);
  if (/(ses|xes|zes|ches|shes|oes)$/.test(word)) forms.push(word.slice(0, -2));
  // "analysis", "basis", "status", "virus" are singular already, and stripping
  // the s buys a term no corpus stores.
  if (/[a-z]s$/.test(word) && !/(ss|is|us)$/.test(word)) forms.push(word.slice(0, -1));
  return forms;
}

const sortedUnique = (values) => [...new Set(values)].sort();

/** The words in `text` that could name a subject, each with the position it
 *  held in the normalized turn, so only words the writer actually wrote side by
 *  side pair up into a two-word term. The turn goes through the same
 *  normalization the parser applies, so retrieval and the engine read one text.
 *  Dotted tokens survive: a module name is a subject. */
export function subjectWordsOf(text, { lexicon = loadLexicon() } = {}) {
  const words = [];
  const tokens = splitWords(normalizeQuery(String(text ?? "")));
  for (let position = 0; position < tokens.length; position += 1) {
    const word = tokens[position].toLowerCase().replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9.\-_]+$/, "");
    if (word.length < MIN_TERM_LENGTH) continue;
    if (STOPWORDS.has(word) || FUNCTION_WORDS.has(word)) continue;
    const reading = classify(word, lexicon);
    if (reading && NON_SUBJECT_PARTS_OF_SPEECH.has(reading.pos)) continue;
    words.push({ word, position });
  }
  return words;
}

/** Every canonical form one surface word could be stored under: the normalized
 *  word itself, the lexicon's lemma for it, and the regular singular when the
 *  lexicon has no entry to fold through. */
export function foldedFormsOf(word, { lexicon = loadLexicon() } = {}) {
  const base = normFactTerm(word);
  if (!base) return [];
  const forms = [base];
  const noun = lookupNoun(lexicon, base);
  if (noun?.lemma && noun.lemma !== base) forms.push(normFactTerm(noun.lemma));
  else for (const folded of regularSingularForms(base)) forms.push(normFactTerm(folded));
  return sortedUnique(forms.filter(Boolean));
}

/** The exact terms a turn offers retrieval: each subject word's folded forms,
 *  plus the adjacent-word pairs, because a corpus subject is routinely two
 *  words ("roman letter", "time period"). Sorted and deduped. */
export function queryTerms(text, { lexicon = loadLexicon() } = {}) {
  const words = subjectWordsOf(text, { lexicon });
  const terms = [];
  for (const { word } of words) terms.push(...foldedFormsOf(word, { lexicon }));
  for (let i = 1; i < words.length; i += 1) {
    if (words[i].position !== words[i - 1].position + 1) continue;
    const pair = normFactTerm(`${words[i - 1].word} ${words[i].word}`);
    if (pair) terms.push(pair);
  }
  return sortedUnique(terms);
}

/** Deterministic fuzzy variants for one term: the words of a closed vocabulary
 *  within a fixed edit distance, capped, and ordered by that same distance with
 *  alphabetical order breaking every tie. Nothing is scored. The order is the
 *  bound the tier already measures, so a cap keeps the nearest forms instead of
 *  whatever the alphabet happened to put first.
 *
 *  `vocabulary` is any iterable of candidate words. It defaults to the grammar
 *  lexicon's nouns, which is the vocabulary available with no store loaded; a
 *  caller holding a seeded payload passes that store's own terms instead and
 *  reaches everything the seed knows about.
 *
 *  A term that is already vocabulary, already real English, too short for the
 *  bound to mean anything, or not plain alphabetic gets no variants. */
export function fuzzyVariantsFor(term, { lexicon = loadLexicon(), vocabulary = null, cap } = {}) {
  if (!Number.isInteger(cap) || cap < 0) throw new TypeError(`cap must be a non-negative integer, got ${JSON.stringify(cap)}`);
  if (cap === 0) return [];
  if (!/^[a-z]+$/.test(term)) return [];
  if (term.length < FUZZY_REPAIR_MIN_LENGTH) return [];
  if (STOPWORDS.has(term)) return [];
  if (REAL_ENGLISH_WORDS.has(term)) return [];
  const words = vocabulary ?? lexicon.nouns.keys();
  const bound = fuzzyBound(term);
  const hits = [];
  let termIsVocabulary = false;
  for (const candidate of words) {
    if (candidate === term) { termIsVocabulary = true; continue; }
    if (Math.abs(candidate.length - term.length) > bound) continue;
    const distance = editDistance(term, candidate, bound);
    if (distance <= bound) hits.push({ candidate, distance });
  }
  if (termIsVocabulary) return [];
  hits.sort((a, b) => a.distance - b.distance || (a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0));
  return hits.slice(0, cap).map((hit) => hit.candidate);
}

/** The plan a turn's retrieval executes. `terms` is sorted and deduped, an
 *  exact term always beating a fuzzy variant that spells the same word. */
export function buildRetrievalPlan({
  text, fuzzy = true, hopDepth, fuzzyVariantsPerTerm, lexicon = loadLexicon(), vocabulary = null,
}) {
  if (!Number.isInteger(hopDepth) || hopDepth < 0) throw new TypeError(`hopDepth must be a non-negative integer, got ${JSON.stringify(hopDepth)}`);
  const exact = queryTerms(text, { lexicon });
  const byTerm = new Map(exact.map((term) => [term, { term, origin: "exact", from: term }]));
  if (fuzzy) {
    for (const term of exact) {
      for (const variant of fuzzyVariantsFor(term, { lexicon, vocabulary, cap: fuzzyVariantsPerTerm })) {
        if (!byTerm.has(variant)) byTerm.set(variant, { term: variant, origin: "fuzzy", from: term });
      }
    }
  }
  const terms = [...byTerm.values()].sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
  return Object.freeze({
    fuzzy: Boolean(fuzzy),
    hopDepth,
    ancestryPredicate: ANCESTRY_PREDICATE,
    terms: Object.freeze(terms.map((entry) => Object.freeze(entry))),
  });
}

/** The triple a fact row carries, or null when the row is not a fact or its
 *  stored record cannot be read. */
export function factTripleOf(row) {
  if (!row || row.rowClass !== FACT_ROW_CLASS || typeof row.json !== "string") return null;
  let record;
  try { record = JSON.parse(row.json); } catch { return null; }
  const attributes = record?.individual?.attributes;
  if (!Array.isArray(attributes)) return null;
  const valueOf = (prop) => attributes.find((a) => a?.prop === prop)?.value || "";
  const subject = valueOf("rdf:subject");
  const predicate = valueOf("rdf:predicate");
  const object = valueOf("rdf:object");
  if (!subject || !predicate || !object) return null;
  return { subject, predicate, object };
}

/** The terms one hop out from a row set: every fact's object, folded and
 *  sorted, minus anything already asked for. */
export function expandedTerms(rows, { seen = new Set() } = {}) {
  const next = [];
  for (const row of rows || []) {
    const triple = factTripleOf(row);
    if (!triple) continue;
    const term = normFactTerm(triple.object);
    if (term && !seen.has(term)) next.push(term);
  }
  return sortedUnique(next);
}

/** The superclass terms a row set names, for the ancestry chase. Sorted, minus
 *  anything already asked for. */
export function ancestryTerms(rows, { seen = new Set() } = {}) {
  const next = [];
  for (const row of rows || []) {
    const triple = factTripleOf(row);
    if (!triple || triple.predicate !== ANCESTRY_PREDICATE) continue;
    const term = normFactTerm(triple.object);
    if (term && !seen.has(term)) next.push(term);
  }
  return sortedUnique(next);
}
