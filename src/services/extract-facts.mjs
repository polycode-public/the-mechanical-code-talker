// `tmct extract` — turn plain text into facts by reusing the SAME deterministic
// recognizer the interactive chat's "teach" lane already has (runTurn,
// src/services/chat.mjs) — no new NLU, no LLM, no guessing.
//
//   tmct extract <text-file> [--repo <path>] [--out <file.jsonl>]
//                            [--optimistic] [--canonical]
//
// The text file is named positionally, or with --file, the way `tmct import`
// names one. The whole pipeline is exposed as one service seam, `ingestText`,
// so a browser or a tool layer can ground the same text without the CLI.
//
// How it works: the text is split into sentences with wink-nlp's own
// sentence-boundary detection (src/services/sentences.mjs — never a naive regex
// split). Each sentence is fed through runTurn() exactly as if an operator had
// typed it into the live chat. A sentence the recognizer turns into a stored
// fact (record.via === "assert", record.miss === false) is kept; every other
// sentence is SKIPPED. This is an honest partial extraction, an "attempt", never
// full NLU: nothing here ever paraphrases or invents a fact the recognizer
// itself didn't produce.
//
// --optimistic  ALSO run a bounded, lexicon-gated fuzzy tier over the sentences
//               the strict recognizer skipped (optimisticTriples below): a
//               copula or a known relation verb flanked by two resolvable
//               entities becomes a candidate triple, stored under its OWN
//               low-trust source kind (optimistic-extract:<source>, prior 0.35 —
//               below every curated pack, memory/trust.mjs) with NO operator or
//               teach tag riding alongside, so a fuzzy candidate can never
//               corroborate a curated fact.
// --canonical   Print each ingested fact in canonical triple form, enriched with
//               how each endpoint already links into the store.
//
// --repo <path>   write straight into that repo's own tmct memory (runTurn's
//                 normal memoryDir write path — "grow my own tmct memory
//                 from a document").
// (no --repo)     nothing on disk is mutated. Each sentence runs against an
//                 ephemeral scratch memory dir (deleted when the run ends);
//                 whatever gets recognized is printed as ConceptNet/tmct-
//                 shape JSONL ({subject, predicate, object, provenance}) —
//                 to stdout, or to --out <file.jsonl> if given.
//
// Every strict-recognized fact ALSO gets a second, additive provenance tag —
// extracted:<source-file-basename> — layered on top of whatever the recognizer
// itself already wrote (ace:chat:…/teach:chat:…), via appendFact's provenance
// UNION (memory/core.mjs). That keeps an extracted fact auditable as "this
// document evidenced this claim" at its own trust-prior tier
// (SOURCE_PRIOR.extracted, memory/trust.mjs). An optimistic candidate carries
// ONLY its own low tag, because it was never operator speech.
//
// Never claims full coverage: the summary this prints always states how many
// sentences were found, how many were recognized, and how many were skipped.
//
// The extractor also says HOW it read a sentence, as named structural findings
// with their own detectors — never a score. A candidate the detectors show was
// mis-read is declined by name (`relative-clause-verb`, `fragment-term`), and a
// definitional frame ("X is the name for Y") declines the false isa and mints
// the edge the sentence actually states (`mgx:nameFor`, `definitional-frame`).
// The ingest result reports both as `declined` and `minted`.

import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { runTurn, uuidv7, stripLeadingDiscourseAdverb } from "./chat.mjs";
import { beginsWithVowelSound, grammarRules } from "./finish.mjs";
import { splitSentencesPreservingPaths, stripCitationResidue } from "./sentences.mjs";
import { loadMemory, readFactRows, appendFacts, removeFacts } from "../adapters/memory/core.mjs";
import { loadConfig } from "../adapters/config.mjs";
import { touchedFactRows } from "../domain/memory/touched-facts.mjs";
import { INGEST_SESSION_MARKER } from "../domain/memory/trust.mjs";
import { normFactTerm } from "../domain/hash.mjs";
import { splitIdentifierWords } from "../domain/prose.mjs";
import { winkInstance } from "../adapters/wink-model.mjs";
import {
  loadLexicon, lookupNoun, lookupVerb, lookupAdjective, lookupProperName, predicateOf,
  OF_CLASSIFIER_HEADS, OF_PARTITIVE_HEADS, readsAsIndividualName,
} from "../domain/grammar/lexicon.mjs";

export const USAGE = "usage: tmct extract <text-file>|--file <text-file> [--repo <path>] [--out <file.jsonl>] [--optimistic] [--canonical]";

export function parseArgs(argv) {
  const args = { file: null, repo: null, out: null, optimistic: false, canonical: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--repo") args.repo = argv[i += 1];
    else if (a === "--out") args.out = argv[i += 1];
    else if (a === "--file") args.file = argv[i += 1];
    else if (a === "--optimistic") args.optimistic = true;
    else if (a === "--canonical") args.canonical = true;
    else rest.push(a);
  }
  args.file = args.file || rest[0] || null;
  return args;
}

/**
 * Run one already-split sentence through runTurn against `memoryDir`, and
 * report the Fact rows THIS turn actually touched. Returns { recognized, rows,
 * afterRows } — `recognized` true iff runTurn's own record called this a
 * stored assertion, `rows` the Fact rows it touched (possibly empty for a
 * Rule-only write), `afterRows` the post-turn fold when one was taken.
 *
 * `beforeRows` is the caller's already-folded view of the store. Folding is
 * the single most expensive thing an ingest does — three quarters of a second
 * on a browser-sized graph — so the caller threads one fold from sentence to
 * sentence instead of paying a fresh one per candidate.
 */
async function runSentence(sentence, { config, memoryDir, env, beforeRows, sessionId = "" }) {
  const before = beforeRows || readFactRows(await loadMemory(memoryDir));
  if (ingestYield) await ingestYield();
  // The turn takes the caller's fold as its own before-view and hands back the
  // after-fold it already had to take, so one sentence costs one fold rather
  // than three of the same graph.
  const { record, answer, factsTouched, factRowsAfter } = await runTurn(sentence, {
    config, memoryDir, sessionId: sessionId || uuidv7(), env, factRowsBefore: before,
  });
  const after = factRowsAfter || before;
  // Only an assert turn can have written a Fact, so only an assert turn earns
  // a fresh view; every other turn hands the caller's own straight back.
  if (record?.via !== "assert") return { recognized: false, rows: [], afterRows: before, decline: String(answer || "") };
  if (ingestYield) await ingestYield();
  if (record?.miss) return { recognized: false, rows: [], afterRows: after, decline: String(answer || "") };
  return { recognized: true, rows: factsTouched || touchedFactRows(before, after), afterRows: after };
}

/** The recognizer's own words for why it turned a sentence down, when it named
 *  an ungrounded term rather than the sentence's shape. "A wombat is a
 *  marsupial." is the same shape as "A kestrel is a bird.", which IS recognized;
 *  the difference is that "bird" is in the vocabulary and "marsupial" is not, so
 *  reporting every skip as an unrecognized shape blames the wrong thing. */
const UNGROUNDED_TERM_DECLINE_RE = /I don't recognize ((?:"[^"]+"(?:\s+(?:and|or)\s+)?)+) as (?:a )?words? I know/i;
const ungroundedTermsIn = (decline) => {
  const m = String(decline || "").match(UNGROUNDED_TERM_DECLINE_RE);
  return m ? m[1].match(/"([^"]+)"/g).map((q) => q.slice(1, -1)) : null;
};

// The copula lemmas that read as class membership; a following noun phrase is
// the class the subject is-a. "has/have" and other verbs are relations, not isa.
const OPTIMISTIC_COPULAS = new Set(["is", "are", "was", "were", "be", "been", "being", "am"]);
// The determiners and generic classifier heads the lexical fallback reads
// through when a wink model isn't available to tag parts of speech.
const OPTIMISTIC_SKIP = new Set([
  "a", "an", "the", "this", "that", "these", "those", "its", "his", "her", "their",
  "our", "my", "your", "some", "any", "one", "kind", "sort", "type", "of",
]);
const OPTIMISTIC_ENTITY_HOPS = 4;
// Crossing any of these while scanning for a copula's entities voids the isa
// read — the noun on the far side belongs to a different clause or to a
// prepositional complement, not to "X is a Y".
const COPULA_FRAME_BLOCKERS = new Set(["VERB", "AUX", "ADP", "SCONJ", "CCONJ"]);
// Naming periphrases stay copular: "can be termed as a name", "is known as",
// "is defined as" — the participle + "as" carries the same class claim the
// bare copula does, unlike any other verb after "is".
const COPULA_NAMING_PARTICIPLES = new Set(["termed", "known", "defined", "described", "referred", "called", "classified"]);
// The relative pronouns that open a clause predicating about the SENTENCE
// subject: "a mountain that has lava" is a fact about the volcano, so the
// relative clause's verb binds to the copula's own subject, not to its object.
const RELATIVE_PRONOUNS = new Set(["that", "which", "who", "whom", "whose"]);
// The copula-object heads that define a subject rather than classify it. "X is
// the name for Y" says what X names; it does not put X under the class "name".
// Followed by "for" or "of", one of these declines the isa and mints the edge
// the sentence states instead.
const DEFINITIONAL_HEADS = new Set(["name", "word", "term", "label", "title"]);
// The predicate that edge carries: the subject is a name for the object's
// concept, minted at the extraction tier beside the other mgx: relations.
const NAME_FOR_PREDICATE = "mgx:nameFor";
// At most this many triples from one sentence — a bound so a run-on can never
// shatter into noise, not a first-wins cap.
const MAX_TRIPLES_PER_SENTENCE = 4;
// How far a copula object scan walks past an attributive-adjective compound
// (wink tokenizes "medium-sized" as NOUN + "-" + VERB and never re-fuses it) to
// reach the real head noun through a coordinate modifier list
// (", burrowing, nocturnal mammal"). A small, explicit bound: past it the object
// abstains rather than guess, so a long noun pile never mints a stray class.
const ATTRIBUTIVE_CHAIN_MAX_HOPS = 8;

/** Fold an entity surface to its stored key: a lexicon noun's lemma, else the
 *  word's own normFactTerm (the optimistic tier mints unlisted content nouns
 *  the way the strict teach lane already mints "redis"). */
function foldEntity(word, lexicon) {
  const noun = lookupNoun(lexicon, String(word).toLowerCase());
  return normFactTerm(noun ? noun.lemma : word);
}

// The shortest word ingestText's fact-degree scan treats as a content-noun
// candidate — long enough to rule out stray abbreviations and pronouns the
// lexical fallback's stopword set doesn't already carry.
const CANDIDATE_TERM_MIN_LENGTH = 3;

/** Every NOUN/PROPN token `sentences` names, surface-form occurrence-counted —
 *  a POS tagger reads unknown words by context, so an unlisted noun ("wombat")
 *  counts exactly like a lexicon-known one. */
function candidateTermOccurrencesPos(sentences, nlp) {
  const counts = new Map();
  for (const sentence of sentences) {
    let values;
    let pos;
    try {
      const doc = nlp.readDoc(String(sentence || ""));
      values = doc.tokens().out(nlp.its.value);
      pos = doc.tokens().out(nlp.its.pos);
    } catch { continue; }
    for (let i = 0; i < values.length; i += 1) {
      if (pos[i] !== "NOUN" && pos[i] !== "PROPN") continue;
      counts.set(values[i], (counts.get(values[i]) || 0) + 1);
    }
  }
  return counts;
}

/** The no-wink-model fallback: every word that is neither a closed-class
 *  scaffolding token nor a lexicon-known verb/adjective counts as a candidate
 *  noun — narrower than the POS tier (no context to lean on), but the same
 *  "an unlisted word can still be a content noun" posture. */
function candidateTermOccurrencesLexical(sentences, lexicon) {
  const counts = new Map();
  for (const sentence of sentences) {
    const words = String(sentence || "").match(/[A-Za-z][A-Za-z'-]*/g) || [];
    for (const word of words) {
      const lower = word.toLowerCase();
      if (lower.length < CANDIDATE_TERM_MIN_LENGTH) continue;
      if (OPTIMISTIC_SKIP.has(lower)) continue;
      if (lookupVerb(lexicon, lower) || lookupAdjective(lexicon, lower)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return counts;
}

/** Every fact-ungrounded term `sentences` names: a candidate noun folded to
 *  its stored term key (`foldEntity`, so a ledger entry and a stored fact key
 *  the same term identically) that `rows` holds zero fact rows for — the
 *  fact-degree rule an ungrounded-term ledger admits by, independent of
 *  whether the lexicon happens to know the word. Occurrence-counted, so a
 *  term named three times outranks one named once. */
function ungroundedTermOccurrences(sentences, rows, { lexicon, nlp }) {
  const raw = nlp ? candidateTermOccurrencesPos(sentences, nlp) : candidateTermOccurrencesLexical(sentences, lexicon);
  const grounded = new Set();
  for (const row of rows) {
    grounded.add(normFactTerm(row.subject));
    grounded.add(normFactTerm(row.object));
  }
  const counts = new Map();
  for (const [word, n] of raw) {
    const term = foldEntity(word, lexicon);
    if (!term || grounded.has(term)) continue;
    counts.set(term, (counts.get(term) || 0) + n);
  }
  return counts;
}

/** The precise tier: wink POS tags pick out the NOUN/PROPN either side of a
 *  copula (→ rdfs:subClassOf) or a lexicon-known relation verb (→ its
 *  predicate). Adjectives, determiners and prepositions are never mistaken for
 *  the entity, so "the quick brown fox jumps over something" yields nothing.
 *  The entity scan stops at punctuation so it never crosses a clause. */
function optimisticTriplesPos(sentence, lexicon, nlp, { mintDefinitional = false } = {}) {
  let values;
  let pos;
  try {
    const doc = nlp.readDoc(String(sentence || ""));
    values = doc.tokens().out(nlp.its.value);
    pos = doc.tokens().out(nlp.its.pos);
  } catch { return { triples: [], declined: [], minted: [] }; }
  // A found noun is read as its whole contiguous NOUN/PROPN run, head-lemma
  // folded — "a string instrument" is the class "string instrument", never
  // its modifier "string"; a single-word run keeps the plain lemma fold.
  const isNounish = (i) => pos[i] === "NOUN" || pos[i] === "PROPN";
  const runLoOf = (i) => { let lo = i; while (lo - 1 >= 0 && isNounish(lo - 1)) lo -= 1; return lo; };
  const entityRunAt = (i) => {
    let lo = i;
    let hi = i;
    while (lo - 1 >= 0 && isNounish(lo - 1)) lo -= 1;
    while (hi + 1 < values.length && isNounish(hi + 1)) hi += 1;
    if (lo === hi) return foldEntity(values[i], lexicon);
    const head = lookupNoun(lexicon, String(values[hi]).toLowerCase());
    return normFactTerm([...values.slice(lo, hi), head ? head.lemma : values[hi]].join(" "));
  };
  const nearestEntityIndex = (idx, step, blocked = null) => {
    for (let i = idx + step; i >= 0 && i < values.length; i += step) {
      if (pos[i] === "PUNCT") break;
      if (blocked && blocked.has(pos[i])) break;
      if (isNounish(i)) return i;
    }
    return null;
  };
  const nearestEntity = (idx, step, blocked = null) => {
    const i = nearestEntityIndex(idx, step, blocked);
    return i === null ? null : entityRunAt(i);
  };
  // The subject-side mirror of the copula-object of-chain rule: when a found
  // subject run is the inner noun of an of-chain ("the weight of all of the
  // snow …"), climb to the outer run's nominal head ("weight"), bounded to two
  // hops. A classifier head (type/kind/sort/…) reads THROUGH — a "kind of X"
  // outer never becomes the subject, so the inner noun is kept. When the run is
  // governed by "of" but no readable noun heads the chain (a mis-tagged head,
  // e.g. "the top of the mountain …"), return null: an honest abstain, never the
  // inner-noun confusion ("mountain", "snow"). A run not governed by "of" is
  // returned unchanged. Returns a run-lo index to fold, or null to abstain.
  const ofChainSkip = (k) => {
    const p = pos[k];
    return p === "DET" || p === "ADJ" || p === "ADV" || p === "NUM";
  };
  const climbSubjectRun = (found) => {
    let lo = runLoOf(found);
    for (let hop = 0; hop < 2; hop += 1) {
      let g = lo - 1;
      while (g >= 0 && ofChainSkip(g)) g -= 1;
      if (g < 0 || values[g]?.toLowerCase() !== "of") return lo; // not an of-chain object
      let k = g - 1;
      while (k >= 0 && !isNounish(k) && (ofChainSkip(k) || values[k]?.toLowerCase() === "of")) k -= 1;
      if (k < 0 || !isNounish(k)) return null; // no readable head — abstain
      if (OF_CLASSIFIER_HEADS.has(String(values[k]).toLowerCase())) return lo; // classifier reads through
      lo = runLoOf(k);
    }
    return lo;
  };
  // The subject resolution shared by the relation-verb tiers: a run climbed
  // through its of-chain and folded, or null when the of-chain has no readable
  // head (abstain rather than store the inner-noun confusion).
  const climbedSubjectAt = (idx) => {
    const found = nearestEntityIndex(idx, -1);
    if (found === null) return null;
    const climbed = climbSubjectRun(found);
    return climbed === null ? null : entityRunAt(climbed);
  };
  // A relation verb whose nearest content token leftward (skipping adverbs and
  // the auxiliaries of its own verb complex) is a relative pronoun sits in a
  // "that/which …" relative clause. Returns that pronoun's own index, or -1 when
  // the verb heads a main clause.
  const relativePronounBefore = (i) => {
    for (let k = i - 1; k >= 0; k -= 1) {
      if (pos[k] === "ADV" || pos[k] === "AUX") continue;
      return RELATIVE_PRONOUNS.has(String(values[k]).toLowerCase()) ? k : -1;
    }
    return -1;
  };
  // An isa needs a CLEAN copula frame: only determiners/adjectives/adverbs/
  // numerals may sit between each entity and the copula. Crossing a verb or
  // auxiliary means the noun belongs to another clause ("one reason life can
  // exist here IS that earth …" is not "life is-a earth"); crossing a
  // preposition or subordinator means locative/complement predication ("water
  // is IN the oceans", "land is grouped INTO continents") — none of them
  // class membership.
  // An of-chain on the object reads through a classifier head to the real
  // class ("a type of mammal" → mammal); a partitive container head states
  // composition, never a class ("a large body of ice" — no isa at all).
  const copulaObjectAt = (i) => {
    for (let j = i + 1; j < values.length; j += 1) {
      // A naming periphrasis ("… termed as …", "… known as …") keeps the
      // frame copular: skip the participle and its "as" and read on.
      if ((pos[j] === "VERB" || pos[j] === "AUX") && COPULA_NAMING_PARTICIPLES.has(values[j]?.toLowerCase())
        && values[j + 1]?.toLowerCase() === "as") { j += 1; continue; }
      if (pos[j] === "PUNCT" || COPULA_FRAME_BLOCKERS.has(pos[j])) {
        if (values[j]?.toLowerCase() !== "of") return null;
        return null;
      }
      if (!isNounish(j)) continue;
      let hi = j;
      while (hi + 1 < values.length && isNounish(hi + 1)) hi += 1;
      // A NOUN immediately followed by "-" then a VERB or ADJ is the left half of
      // an attributive-adjective compound wink never re-fused ("medium-sized"),
      // not the class. Walk forward through the coordinate modifier list (hyphens,
      // commas, "and", further ADJ/VERB tokens) to the real head noun and re-point
      // there; abstain if none appears within the bound, never mint the modifier.
      if (values[hi + 1] === "-" && (pos[hi + 2] === "VERB" || pos[hi + 2] === "ADJ")) {
        let head = null;
        let k = hi + 1;
        for (let hop = 0; hop < ATTRIBUTIVE_CHAIN_MAX_HOPS && k < values.length; hop += 1, k += 1) {
          if (isNounish(k)) { head = k; break; }
          const w = values[k]?.toLowerCase();
          if (w === "-" || w === "," || w === "and" || pos[k] === "ADJ" || pos[k] === "VERB" || pos[k] === "CCONJ") continue;
          break;
        }
        if (head === null) return null;
        j = head;
        hi = head;
        while (hi + 1 < values.length && isNounish(hi + 1)) hi += 1;
      }
      const headWord = String(values[hi]).toLowerCase();
      const nextWord = values[hi + 1]?.toLowerCase();
      // "latency is the name for the time period …" defines latency; it does not
      // put latency under the class "name". The isa is declined and the object
      // is re-read past the "for"/"of" as what the subject names.
      if (DEFINITIONAL_HEADS.has(headWord) && (nextWord === "for" || nextWord === "of")) {
        const named = nearestEntityIndex(hi + 1, +1, COPULA_FRAME_BLOCKERS);
        return {
          definitional: true, label: entityRunAt(j), hi,
          names: named === null ? null : entityRunAt(named),
        };
      }
      const nextIsOf = nextWord === "of";
      if (!nextIsOf) return { label: entityRunAt(j), hi };
      if (OF_CLASSIFIER_HEADS.has(headWord)) { i = hi + 1; j = hi + 1; continue; }
      if (OF_PARTITIVE_HEADS.has(headWord)) return null;
      return { label: entityRunAt(j), hi };
    }
    return null;
  };
  // The copula's own modal chain ("can be", "may be") is part of one verb
  // complex — the subject scan starts left of it, while a free-standing VERB
  // on the way still voids the frame. An of-chain subject climbs to its head
  // ("the weight of the snow is …" → weight); a mis-headed of-chain abstains.
  // Returns { label, hi } — `hi` is the run's own head-token index (same
  // right-edge convention entityRunAt already heads a multi-word run by),
  // read by Pass 1 below to tell a PROPN subject (an individual) from a NOUN
  // one (a class), wink's own tag standing in for readsAsIndividualName's
  // lexicon-level signal.
  const copulaSubjectAt = (i) => {
    let k = i - 1;
    while (k >= 0 && pos[k] === "AUX") k -= 1;
    const found = nearestEntityIndex(k + 1, -1, COPULA_FRAME_BLOCKERS);
    if (found === null) return null;
    const climbed = climbSubjectRun(found);
    if (climbed === null) return null;
    let hi = climbed;
    while (hi + 1 < values.length && isNounish(hi + 1)) hi += 1;
    return { label: entityRunAt(climbed), hi };
  };

  const triples = [];
  const declined = [];
  const minted = [];
  const seen = new Set();
  const push = (subject, predicate, object) => {
    if (!(subject && object && subject !== object)) return null;
    const key = `${subject}\0${predicate}\0${object}`;
    if (seen.has(key) || triples.length >= MAX_TRIPLES_PER_SENTENCE) return null;
    seen.add(key);
    const triple = { subject, predicate, object };
    triples.push(triple);
    return triple;
  };
  const decline = (finding, candidate) => { declined.push({ finding, candidate }); };

  // Pass 1 — the first clean copula frame yields the isa (all guards unchanged);
  // its subject and object-run end anchor the relative-clause continuation.
  let copulaSubject = null;
  let copulaObjHi = -1;
  for (let i = 1; i < values.length - 1; i += 1) {
    if (pos[i] === "AUX" && OPTIMISTIC_COPULAS.has(values[i].toLowerCase())) {
      const subject = copulaSubjectAt(i);
      const object = copulaObjectAt(i);
      // A definitional frame declines its isa and mints the naming edge in its
      // place. The rest of the sentence still reads, through Pass 2b.
      if (subject && object?.definitional) {
        decline("definitional-frame", { subject: subject.label, predicate: "rdfs:subClassOf", object: object.label });
        if (mintDefinitional) {
          const fact = push(subject.label, NAME_FOR_PREDICATE, object.names);
          if (fact) minted.push({ finding: "definitional-frame", fact });
        }
        break;
      }
      if (subject && object && subject.label !== object.label) {
        // "is" only, never are/was/were/be/been/being/am — the same G2 rule
        // every other individual-vs-class anchor holds to: a plural/non-
        // present copula is never one named individual, however its subject
        // tags.
        const namedIndividual = values[i].toLowerCase() === "is" && pos[subject.hi] === "PROPN";
        push(subject.label, namedIndividual ? "rdf:type" : "rdfs:subClassOf", object.label);
        copulaSubject = subject.label;
        copulaObjHi = object.hi;
        break;
      }
    }
  }

  // Pass 2a — with a copula isa in hand, CONTINUE past its object for relation
  // verbs (has/creates/…), so one sentence contributes every fact it grounds.
  // A "that/which <verb>" clause right after the object predicates about the
  // SENTENCE subject ("a mountain that has lava" → volcano has lava); any other
  // relation verb keeps its nearest-entity-leftward subject. AUX relation verbs
  // ("has") count here — but only inside a copula frame that already resolved,
  // so a bare "… is that Earth has …" complement never mints "earth has lot".
  //
  // The bind is adjacency-bound: the relative pronoun must directly follow the
  // copula object's own run end, so the clause restricts the class the subject
  // was just given ("a mountain that has lava"). A pronoun hanging off a noun
  // deeper in the object's complement ("the name for the time period that needs
  // …") restricts that noun, not the subject, so the verb is declined.
  if (copulaSubject) {
    for (let i = copulaObjHi + 1; i < values.length; i += 1) {
      if (pos[i] !== "VERB" && pos[i] !== "AUX") continue;
      const word = values[i].toLowerCase();
      if (OPTIMISTIC_COPULAS.has(word)) continue;
      const verb = lookupVerb(lexicon, word);
      if (!verb) continue;
      const relative = relativePronounBefore(i);
      if (relative >= 0 && relative - 1 !== copulaObjHi) {
        decline("relative-clause-verb", { subject: copulaSubject, predicate: predicateOf(verb), object: nearestEntity(i, +1) });
        continue;
      }
      const subject = relative >= 0 ? copulaSubject : climbedSubjectAt(i);
      if (subject === null) continue;
      push(subject, predicateOf(verb), nearestEntity(i, +1));
    }
    return { triples, declined, minted };
  }

  // Pass 2b — no copula isa: the relation-verb tier over the whole sentence,
  // climbing an of-chain subject to its head ("the weight of the snow creates
  // pressure" → weight creates pressure, not snow). VERB-tagged only, so a bare
  // AUX ("Earth has …") in a non-frame sentence stays an honest miss.
  //
  // With no main predication resolved, a relative clause's verb has nothing to
  // bind to, so any relative frame declines here rather than guess a subject.
  for (let i = 1; i < values.length - 1; i += 1) {
    if (pos[i] !== "VERB") continue;
    const verb = lookupVerb(lexicon, values[i].toLowerCase());
    if (!verb) continue;
    const subject = climbedSubjectAt(i);
    if (relativePronounBefore(i) >= 0) {
      decline("relative-clause-verb", { subject, predicate: predicateOf(verb), object: nearestEntity(i, +1) });
      continue;
    }
    if (subject === null) continue;
    push(subject, predicateOf(verb), nearestEntity(i, +1));
  }
  return { triples, declined, minted };
}

/** The lexical fallback for a checkout with no wink model: a copula flanked by
 *  two lexicon-known nouns (or a mid-sentence proper noun). Narrower and more
 *  cautious than the POS tier — without part-of-speech tags the only safe entity
 *  test is lexicon membership, so unlisted content nouns are skipped here. */
function optimisticTriplesLexical(sentence, lexicon) {
  const raw = String(sentence || "").match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (raw.length < 3) return [];
  const lower = raw.map((w) => w.toLowerCase());
  // Returns { term, raw } — `raw` is the surface AS TYPED, read by the isa
  // mint below through readsAsIndividualName the same way ace.mjs's
  // parseCopula reads a bare copula subject's own spelling.
  const nearestEntity = (idx, step) => {
    for (let i = idx + step, hops = 0; i >= 0 && i < lower.length && hops < OPTIMISTIC_ENTITY_HOPS; i += step, hops += 1) {
      const w = lower[i];
      if (OPTIMISTIC_SKIP.has(w) || lookupAdjective(lexicon, w)) continue;
      const noun = lookupNoun(lexicon, w);
      if (noun) return { term: normFactTerm(noun.lemma), raw: raw[i] };
      const proper = lookupProperName(lexicon, w);
      if (proper) return { term: normFactTerm(proper), raw: raw[i] };
      if (i > 0 && /^[A-Z]/.test(raw[i])) return { term: normFactTerm(raw[i]), raw: raw[i] };
      return null;
    }
    return null;
  };
  for (let i = 1; i < lower.length - 1; i += 1) {
    if (!OPTIMISTIC_COPULAS.has(lower[i])) continue;
    const subject = nearestEntity(i, -1);
    const object = nearestEntity(i, +1);
    if (subject && object && subject.term !== object.term) {
      // "is" only (the same G2 rule the POS tier and every ACE anchor hold
      // to) — are/was/were is never one named individual.
      const namedIndividual = lower[i] === "is" && readsAsIndividualName(subject.raw, lexicon);
      return [{ subject: subject.term, predicate: namedIndividual ? "rdf:type" : "rdfs:subClassOf", object: object.term }];
    }
  }
  return [];
}

/**
 * The bounded triple candidates from a sentence the strict recognizer skipped:
 * a copula (→ rdfs:subClassOf) and, past its object, the relation verbs it
 * grounds (→ their predicates), so one sentence contributes every fact it holds
 * ("a volcano is a mountain that has lava" → volcano ⊑ mountain AND volcano has
 * lava). Every triple passes the same entity/guard checks on its own, deduped,
 * capped at MAX_TRIPLES_PER_SENTENCE so a run-on never shatters into noise; []
 * when nothing resolves both sides — no guessing past the shape. Uses wink POS
 * tags when a model is available (the precise tier), else a narrower
 * lexicon-only fallback.
 *
 *   opts.lexicon  a loaded lexicon (the core vocabulary when absent).
 *   opts.nlp      a wink instance (winkInstance() when absent); null forces the
 *                 lexical fallback.
 *   opts.findings mint the definitional edge a `definitional-frame` sentence
 *                 states. Off by default, the same flag ingestText gates the
 *                 finding-bearing rows behind.
 */
export function optimisticTriples(sentence, opts = {}) {
  return optimisticReading(sentence, opts).triples;
}

/**
 * The same read as `optimisticTriples`, with how it read the sentence:
 * { triples, declined, minted }. `declined` holds { finding, candidate } for
 * every candidate a detector turned down; `minted` holds { finding, fact } for
 * each edge minted in a declined candidate's place. Takes the same options.
 */
export function optimisticReading(sentence, { lexicon = loadLexicon(), nlp, findings = false } = {}) {
  const engine = nlp === undefined ? winkInstance() : nlp;
  if (!engine) return { triples: optimisticTriplesLexical(sentence, lexicon), declined: [], minted: [] };
  return optimisticTriplesPos(sentence, lexicon, engine, { mintDefinitional: findings });
}

// A closed set of clause markers a compound sentence hinges on. A candidate
// fragment is only kept when it stands alone as a clause; the marker set is
// deliberately small so a run-on never shatters into noise.
const CLAUSE_MARKER_RE = /,?\s+(?:because|since|although|though|whereas|while|so|and|but)\s+/i;
// The copula/auxiliary/light-verb words that mark a fragment as a would-be
// clause when no wink POS tagger is on hand — the same closed-list discipline
// the strict teach frames use in place of a probabilistic tag.
const CLAUSE_VERBISH = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am",
  "has", "have", "had", "can", "could", "will", "would", "should",
  "do", "does", "did", "want", "wants", "need", "needs", "make", "makes", "made",
]);

/** Does the fragment carry a verb-ish token — a real VERB/AUX when wink tags
 *  it, else one of the closed copula/aux words above? A clause with no verb is
 *  a noun pile, never a sentence to ground. */
function fragmentHasVerb(fragment, nlp) {
  const engine = nlp === undefined ? winkInstance() : nlp;
  if (engine) {
    try {
      const pos = engine.readDoc(String(fragment)).tokens().out(engine.its.pos);
      if (pos.some((p) => p === "VERB" || p === "AUX")) return true;
    } catch { /* fall through to the closed-list check */ }
  }
  return String(fragment).toLowerCase().split(/\s+/).some((w) => CLAUSE_VERBISH.has(w));
}

/**
 * The grounding candidates a sentence offers, WHOLE SENTENCE FIRST: the strict
 * recognizer should always get the full sentence before any fragment, so a
 * clause split only ever adds fallbacks, never pre-empts a clean whole-sentence
 * read. When the sentence hinges on a closed clause marker
 * (because/since/although/though/whereas/while/so/and/but), each side is added
 * as a fallback — but only a fragment of at least 3 tokens that carries a
 * verb-ish token, so a stray connective can't split a sentence into noise.
 * Returns [sentence, ...fragments] with no duplicates.
 */
export function clauseCandidates(sentence, { nlp } = {}) {
  const whole = String(sentence ?? "").trim();
  const out = [whole];
  if (!whole) return out;
  const parts = whole.split(CLAUSE_MARKER_RE).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return out;
  for (const part of parts) {
    if (part === whole || out.includes(part)) continue;
    if (part.split(/\s+/).length < 3) continue;
    if (!fragmentHasVerb(part, nlp)) continue;
    out.push(part);
  }
  return out;
}

// A stored term names a thing. These words open a predicate remainder or a new
// clause, so a term that STARTS with one is the tail of a sentence a recognizer
// frame over-read, never an entity — "has a population of 1,683,115" and "and
// killed his two grandparents" are both that shape, and both surface as a feed
// card's own title once they reach the graph.
const FRAGMENT_LEAD_WORDS = new Set([
  "and", "or", "but", "because", "since", "although", "though", "whereas", "while", "so",
  "that", "which", "who", "whom", "whose", "if", "when", "then", "also", "however",
  "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had",
  "do", "does", "did", "can", "could", "will", "would", "should", "may", "might", "must",
  "of", "in", "on", "at", "for", "to", "with", "from", "by", "as", "into", "onto",
  "over", "under", "after", "before", "between", "during", "about", "near", "through",
  "against", "among", "within", "without", "per",
]);
// Longest a stored term may run. Real multi-word entities are short compounds
// ("string instrument", "american guitarist"); past this a "term" is a clause
// the split lost the subject of.
const MAX_TERM_WORDS = 6;
// The tags a MULTI-WORD term's leading token may not carry — the POS reading
// of the same rule FRAGMENT_LEAD_WORDS states lexically, so an unlisted verb
// ("killed", "borders") is caught the same way a listed auxiliary is. A
// one-word term is exempt: a bare verb is a perfectly good object for a
// capability or relation fact ("a cell is capable of grow"), and a single word
// is never the clause fragment this rule exists to catch.
const FRAGMENT_LEAD_TAGS = new Set(["VERB", "AUX", "ADP", "CCONJ", "SCONJ", "PART", "ADV"]);
// The particles a phrasal verb leaves behind when a frame over-reads its
// remainder as a term: "falls back to the link" surfaces as "back to the link",
// which names nothing. Read lexically so a checkout with no wink model catches
// it too, and only for a multi-word term — "back" alone is a fine noun.
const PARTICLE_LEAD_WORDS = new Set(["back", "up", "down", "out", "off", "away", "along", "around"]);

/** Does `term` read as a thing's name rather than a clause fragment? Bounds
 *  the word count and rejects a leading conjunction, auxiliary, preposition,
 *  adverb or phrasal-verb particle. Used to keep an over-read recognizer
 *  frame's predicate remainder out of the graph, where it would otherwise hub
 *  a feed card. */
export function readsAsEntityTerm(term, nlp) {
  const text = String(term ?? "").trim();
  if (!text) return false;
  const words = text.split(/\s+/);
  if (words.length > MAX_TERM_WORDS) return false;
  const first = words[0].toLowerCase().replace(/^[^a-z0-9]+/, "");
  if (!first) return false;
  if (FRAGMENT_LEAD_WORDS.has(first)) return false;
  if (words.length === 1) return true;
  if (PARTICLE_LEAD_WORDS.has(first)) return false;
  const engine = nlp === undefined ? winkInstance() : nlp;
  if (!engine) return true;
  try {
    const pos = engine.readDoc(text).tokens().out(engine.its.pos);
    if (pos.length && FRAGMENT_LEAD_TAGS.has(pos[0])) return false;
  } catch { /* an untaggable term falls back to the lexical rule above */ }
  return true;
}

const readsAsEntityFact = (fact, nlp) => readsAsEntityTerm(fact.subject, nlp) && readsAsEntityTerm(fact.object, nlp);

/** Does one raw token read as a code identifier rather than a word? camelCase
 *  and snake_case split into several words, and a dot between letters or a path
 *  separator names a module or a file. Read on the sentence's own surface,
 *  before normFactTerm lower-cases the shape away: "normalizeFeedItems" is one,
 *  "guitar" is not. */
export function readsAsIdentifierToken(raw) {
  const token = String(raw ?? "").trim();
  if (!token || /\s/.test(token)) return false;
  if (token.includes("_")) return true;
  if (/[A-Za-z]\.[A-Za-z]/.test(token)) return true;
  if (/[/\\]/.test(token)) return true;
  return splitIdentifierWords(token).length > 1;
}

// The punctuation a raw sentence wraps a token in. Stripped from both ends
// before the identifier test, so "(normalizeFeedItems)," still reads as one.
const IDENTIFIER_TOKEN_EDGE_RE = /^[^A-Za-z0-9_/\\.]+|[^A-Za-z0-9_/\\.]+$/g;

/** The stored term keys `sentence` names with an identifier-shaped token. An
 *  endpoint whose key is in this set carries the `identifier-token` finding. */
export function identifierTermsIn(sentence) {
  const terms = new Set();
  for (const raw of String(sentence ?? "").match(/\S+/g) || []) {
    const token = raw.replace(IDENTIFIER_TOKEN_EDGE_RE, "");
    if (!token || !readsAsIdentifierToken(token)) continue;
    const term = normFactTerm(token);
    if (term) terms.add(term);
  }
  return terms;
}

/** The findings one stored row carries: whatever the sentence's own reading
 *  contributed (a clause fallback, a carried pronoun subject), plus
 *  `identifier-token` when either endpoint's stored key came from an
 *  identifier-shaped token. `identifierTerms` null means this run records no
 *  findings at all, so nothing is attached. */
function findingsForRow(fact, readingFindings, identifierTerms) {
  if (!identifierTerms) return [];
  const named = [...readingFindings];
  if (identifierTerms.has(fact.subject) || identifierTerms.has(fact.object)) named.push("identifier-token");
  return named;
}

// A host that shares one thread with a UI hands the thread back through this;
// a Node run leaves it unset and pays nothing.
let ingestYield = null;

/** Sets the function `ingestText` awaits between sentences so a browser can
 *  paint and answer input while a long article grounds. Pass null to clear. */
export function setIngestYield(fn) {
  ingestYield = typeof fn === "function" ? fn : null;
}

// The pronoun subjects a bounded carry substitutes with the paragraph's last
// grounded subject. Ingest only — a chat turn resolves "it"/"they" against the
// live focus, never a stale paragraph carry.
const PRONOUN_LEAD_RE = /^(?:they|it|these|those|this)\b\s*/i;

/** Re-article a bare carried subject so the retried sentence is a grammatical
 *  habitual surface the recognizer accepts: "cell" → "a cell", "orbit" → "an
 *  orbit". Uses the same vowel-sound-aware article rule (grammar-rules.toml)
 *  the chat recognizer's own capability rewrite uses, rather than a hardcoded
 *  "a". */
function articledSubject(subject) {
  const articleRule = grammarRules().find((r) => r.kind === "article");
  const article = articleRule && beginsWithVowelSound(subject, articleRule) ? "an" : "a";
  return `${article} ${subject}`;
}

/** A readable predicate for canonical output: the local part of an rdfs:/ace:
 *  CURIE, otherwise the predicate verbatim. */
const readablePredicate = (predicate) => String(predicate).replace(/^[a-z]+:/i, "");

/** One canonical line per ingested fact, enriched with how each endpoint links
 *  back into the store: `subject predicate object` plus, for each endpoint that
 *  the store also mentions elsewhere, how many OTHER facts touch it. */
function canonicalLines(facts, storeRows) {
  const degree = new Map();
  for (const row of storeRows) {
    degree.set(row.subject, (degree.get(row.subject) || 0) + 1);
    if (row.object !== row.subject) degree.set(row.object, (degree.get(row.object) || 0) + 1);
  }
  return facts.map((f) => {
    const links = [];
    for (const end of [f.subject, f.object]) {
      const others = (degree.get(end) || 0) - 1; // exclude this fact's own edge
      if (others > 0) links.push(`${end} links to ${others} other fact${others === 1 ? "" : "s"}`);
    }
    const line = `${f.subject} ${readablePredicate(f.predicate)} ${f.object}`;
    return links.length ? `${line}  [${links.join("; ")}]` : line;
  });
}

/**
 * ingestText — the single ingest seam. Grounds `text` into facts and returns a
 * structured result; the CLI, the browser and the tool layer all drive this.
 *
 *   text     the raw string to ground.
 *   options:
 *     memoryDir   write grounded facts here (a real .tmct memory dir). Omit for
 *                 an ephemeral scratch dir that is created and deleted inside
 *                 this call, so nothing on disk is mutated — the returned facts
 *                 are the only output.
 *     sourceTag   the label the audit provenance carries (extracted:<tag> /
 *                 optimistic-extract:<tag>). Default "text".
 *     attributeToSource
 *                 file the recognizer's own assertion under `sourceTag`'s
 *                 publication instead of a fresh chat session per sentence.
 *                 Off by default: an operator running `tmct extract` over their
 *                 own notes IS the asserting party, so that lane keeps minting
 *                 a session. A feed or a reference work is not, and one
 *                 publication's sentences must never corroborate each other.
 *     optimistic  also run the fuzzy tier over strict-skipped sentences.
 *     canonical   include a `canonical` array: one enriched triple line per
 *                 ingested fact.
 *     config      a loaded config; derived from the write dir when absent.
 *     lexicon     a loaded lexicon; the core vocabulary when absent.
 *     findings    record how each sentence read: mint the edge a definitional
 *                 frame states (`mgx:nameFor`) where the false isa was
 *                 declined, and attach the kept findings (`identifier-token`,
 *                 `clause-fallback`, `pronoun-carry`, `definitional-frame`) to
 *                 the assertions this call writes. Off by default; the declines
 *                 themselves are reported either way.
 *
 * Returns { sentences, recognized, extracted, optimistic, skipped, declined,
 * minted, canonical? }.
 *   recognized — strict-recognized sentence count.
 *   extracted  — strict fact rows ({subject, predicate, object, provenance,
 *                quantifier, sentence}), plus `extraction` when the row was
 *                stored carrying findings.
 *   optimistic — fuzzy candidate rows ({subject, predicate, object, provenance,
 *                sentence}, same optional `extraction`); always [] unless
 *                options.optimistic.
 *   skipped    — sentences neither tier grounded.
 *   declined   — every candidate a detector turned down, as
 *                { sentence, finding, candidate }.
 *   minted     — every edge minted in a declined candidate's place, as
 *                { sentence, finding, fact }.
 */
export async function ingestText(text, {
  memoryDir = null, sourceTag = "text", optimistic = false,
  canonical = false, config = null, lexicon = null, observedAt = "", findings = false,
  attributeToSource = false,
} = {}) {
  // The session id every sentence's recognizer turn runs under. Stable and
  // derived from the publication when the caller attributes to it, so the whole
  // run lands on one Source; a fresh uuid per sentence otherwise (runSentence).
  const recognizerSessionId = attributeToSource ? `${INGEST_SESSION_MARKER}${sourceTag.split("@")[0]}` : "";
  // Paragraphs first (blank-line separated), so the pronoun carry never bridges
  // a topic break: a fresh paragraph clears the last-subject it would resolve
  // "they"/"it" against. Each paragraph then splits into sentences the shared
  // path-preserving way.
  const paragraphs = String(text ?? "").split(/\n[ \t]*\n/);
  const ephemeral = !memoryDir;
  const dir = memoryDir || await mkdtemp(join(tmpdir(), "tmct-ingest-"));
  // `dir` may be a backend handle (a sqlite store, or a browser's in-memory
  // store), not a path — only a real directory string can seed loadConfig's
  // cwd, and `process` itself doesn't exist in a browser. A handle-holding
  // caller passes its own config; absent that, `graphFile` is moot for a
  // handle anyway (there is no on-disk repo to resolve it against), so a
  // bare default stands in rather than reaching for `loadConfig`/`process`.
  const cfg = config || (typeof dir === "string" ? loadConfig(process.env, dir) : { graphFile: "" });
  // dispatchTurn's own `env = process.env` default parameter is evaluated
  // eagerly, so it throws in a browser the moment runSentence (below) omits
  // `env` — passing it explicitly here (real env in Node, `{}` in a browser)
  // is the same shape `env` already has to take everywhere else this module
  // runs client-side.
  const runEnv = typeof process !== "undefined" && process.env ? process.env : {};
  const lex = lexicon || loadLexicon();
  const nlp = optimistic ? winkInstance() : null;
  // The fact-degree scan below runs whether or not --optimistic is on, so it
  // reads its own wink handle rather than reusing `nlp` (which stays null off
  // --optimistic, and changing that would also change the strict clause-
  // fallback's own verb detection — a different, wider change than this one).
  const termNlp = winkInstance();

  const extracted = [];
  const optimisticFacts = [];
  // How each sentence read: the candidates a detector turned down, and the
  // edges minted where one was declined.
  const declined = [];
  const minted = [];
  let sentenceCount = 0;
  let recognizedSentences = 0;
  let optimisticSentences = 0;
  // The terms a skipped sentence named that nothing grounds yet. Reported with
  // the skip count so the summary names the real obstacle instead of blaming
  // the sentence's shape for a shape it actually recognizes.
  const ungroundedTerms = new Set();
  // Every sentence's cleaned text, kept for the fact-degree scan (below) that
  // runs once over the whole text after every fact this call will write has
  // landed.
  const cleanedSentences = [];

  // One fold, threaded through every candidate below. A fold costs about a
  // second on a browser-sized graph and the old shape paid two per candidate,
  // which is what made a poll block the page for minutes.
  let currentRows = readFactRows(await loadMemory(dir));
  // Facts this call has already written its own tag onto. Their provenance in
  // `currentRows` is a tag behind, so a later sentence would otherwise read
  // them back as freshly touched; skipping them is what a re-fold would have
  // said, without the re-fold.
  const taggedIds = new Set();

  // One recognized read of some text form: null when the strict recognizer
  // grounds nothing, else the Fact rows it touched. A row whose subject or
  // object reads as a clause fragment rather than an entity is retracted here
  // — the recognizer has already written it by the time this sees it — and
  // the sentence falls through to the optimistic tier instead.
  let lastDecline = "";
  // The sentence every decline and mint below is reported against, threaded the
  // same way `lastDecline` is.
  let currentSentence = "";
  const strictRows = async (form) => {
    if (ingestYield) await ingestYield();
    const knownIds = new Set(currentRows.map((r) => r.id));
    const { recognized, rows, afterRows, decline } = await runSentence(form, {
      config: cfg, memoryDir: dir, env: runEnv, beforeRows: currentRows, sessionId: recognizerSessionId,
    });
    currentRows = afterRows;
    if (!recognized) { lastDecline = decline || lastDecline; return null; }
    const fresh = rows.filter((row) => !taggedIds.has(row.id));
    const kept = fresh.filter((row) => readsAsEntityFact(row, termNlp));
    if (kept.length !== fresh.length) {
      for (const row of fresh) {
        if (kept.includes(row)) continue;
        declined.push({
          sentence: currentSentence,
          finding: "fragment-term",
          candidate: { subject: row.subject, predicate: row.predicate, object: row.object },
        });
      }
      const retractIds = fresh.filter((row) => !kept.includes(row) && !knownIds.has(row.id)).map((row) => row.id);
      if (retractIds.length) {
        await removeFacts(dir, retractIds);
        const retracted = new Set(retractIds);
        currentRows = currentRows.filter((row) => !retracted.has(row.id));
      }
    }
    return kept.length ? kept : null;
  };

  try {
    for (const paragraph of paragraphs) {
      // The last unique grounded subject in THIS paragraph, carried onto a
      // later pronoun-led sentence the strict recognizer couldn't ground on
      // its own. Cleared at the paragraph boundary.
      let carrySubject = null;
      for (const sentence of splitSentencesPreservingPaths(paragraph)) {
        sentenceCount += 1;
        lastDecline = "";
        currentSentence = sentence;
        const cleaned = stripCitationResidue(sentence);
        cleanedSentences.push(cleaned);
        // The stored term keys this sentence names with an identifier-shaped
        // token, read off the surface before normFactTerm folds the shape away.
        // Null when this run records no findings.
        const identifierTerms = findings ? identifierTermsIn(cleaned) : null;
        // How the strict tier reached its rows, when it did: the whole sentence
        // carries nothing, a later candidate is a clause fragment, and the
        // pronoun retry carried its subject in from an earlier sentence.
        let readingFindings = [];
        // Whole sentence first, then each closed-marker clause as a fallback.
        let rows = null;
        const candidates = clauseCandidates(cleaned, { nlp });
        for (let i = 0; i < candidates.length; i += 1) {
          rows = await strictRows(candidates[i]);
          if (!rows) continue;
          if (i > 0) readingFindings = ["clause-fallback"];
          break;
        }
        // Bounded pronoun carry: a "they/it/these/those/this …" sentence the
        // recognizer skipped is retried once with the paragraph's last grounded
        // subject in the pronoun's place. A leading ordinal/temporal discourse
        // adverb ("Then it splits.") is stripped first so the pronoun reaches
        // the sentence front; the carried subject is re-articled ("a cell") so
        // the retry is a grammatical habitual surface. Never a chat turn —
        // ingest only.
        const threaded = stripLeadingDiscourseAdverb(cleaned);
        if (!rows && carrySubject && PRONOUN_LEAD_RE.test(threaded)) {
          rows = await strictRows(threaded.replace(PRONOUN_LEAD_RE, `${articledSubject(carrySubject)} `));
          if (rows) readingFindings = ["pronoun-carry"];
        }
        if (rows) {
          recognizedSentences += 1;
          const subjects = new Set(rows.map((r) => r.subject));
          if (subjects.size === 1) carrySubject = [...subjects][0];
          const tag = `extracted:${sourceTag}`;
          // One write for the whole sentence, not one per row: a write reads
          // and re-derives the whole graph, so N of them cost N times what one
          // carrying the same N rows does. The batch stays inside the sentence
          // — a later sentence still reads everything the earlier ones wrote.
          const writes = [];
          for (const row of rows) {
            const extraction = findingsForRow(row, readingFindings, identifierTerms);
            writes.push({
              subject: row.subject, predicate: row.predicate, object: row.object,
              provenance: tag, quantifier: row.quantifier || "", observedAt,
              ...(extraction.length ? { extraction } : {}),
            });
            extracted.push({
              subject: row.subject, predicate: row.predicate, object: row.object,
              provenance: tag, quantifier: row.quantifier || "", sentence,
              ...(extraction.length ? { extraction } : {}),
            });
            taggedIds.add(row.id);
          }
          await appendFacts(dir, writes);
          continue;
        }
        const ungrounded = ungroundedTermsIn(lastDecline);
        if (ungrounded) for (const term of ungrounded) ungroundedTerms.add(term);
        if (!optimistic) continue;
        const reading = optimisticReading(cleaned, { lexicon: lex, nlp, findings });
        for (const { finding, candidate } of reading.declined) declined.push({ sentence, finding, candidate });
        const keptCandidates = [];
        for (const t of reading.triples) {
          if (readsAsEntityFact(t, termNlp)) keptCandidates.push(t);
          else declined.push({ sentence, finding: "fragment-term", candidate: t });
        }
        // A minted edge rides its own finding: minted[].fact is the very object
        // the candidate list holds, so the mint and its row match by identity
        // rather than by re-deriving the triple.
        const mintFindings = new Map();
        for (const { finding, fact } of reading.minted) {
          if (!keptCandidates.includes(fact)) continue;
          minted.push({ sentence, finding, fact });
          mintFindings.set(fact, finding);
        }
        if (!keptCandidates.length) continue;
        optimisticSentences += 1;
        const tag = `optimistic-extract:${sourceTag}`;
        const candidateWrites = [];
        for (const t of keptCandidates) {
          const extraction = findingsForRow(t, mintFindings.has(t) ? [mintFindings.get(t)] : [], identifierTerms);
          candidateWrites.push({
            subject: t.subject, predicate: t.predicate, object: t.object, provenance: tag, observedAt,
            ...(extraction.length ? { extraction } : {}),
          });
          optimisticFacts.push({ ...t, provenance: tag, sentence, ...(extraction.length ? { extraction } : {}) });
        }
        const { ids } = await appendFacts(dir, candidateWrites);
        for (const id of ids) taggedIds.add(id);
      }
    }

    // The fact-degree scan below only reads each row's subject and object, so
    // the threaded fold plus this call's own writes answers it exactly.
    // `canonical` prices every endpoint's degree instead, which needs the
    // store's real row set.
    if (ingestYield) await ingestYield();
    const finalRows = canonical
      ? readFactRows(await loadMemory(dir))
      : currentRows.concat(extracted, optimisticFacts);
    // ungroundedCounts widens the legacy ungroundedTerms rule (a lexicon-miss
    // named in a decline) to the fact-degree rule: every term with zero fact
    // rows, lexicon-known or not. ungroundedTerms stays a subset by
    // construction — each of its terms is folded in below even on the rare
    // chance the POS scan itself missed it.
    const ungroundedCounts = ungroundedTermOccurrences(cleanedSentences, finalRows, { lexicon: lex, nlp: termNlp });
    for (const term of ungroundedTerms) {
      const key = normFactTerm(term);
      if (key && !ungroundedCounts.has(key)) ungroundedCounts.set(key, 1);
    }

    const result = {
      sentences: sentenceCount,
      recognized: recognizedSentences,
      extracted,
      optimistic: optimisticFacts,
      skipped: sentenceCount - recognizedSentences - optimisticSentences,
      ungroundedTerms: [...ungroundedTerms],
      ungroundedCounts,
      declined,
      minted,
    };
    if (canonical) {
      result.canonical = canonicalLines([...extracted, ...optimisticFacts], finalRows);
    }
    return result;
  } finally {
    if (ephemeral) await rm(dir, { recursive: true, force: true });
  }
}

/** "relative-clause-verb 1, fragment-term 2" — how many rows each named finding
 *  accounts for, in the order the findings first appeared. */
function countsByFinding(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.finding, (counts.get(row.finding) || 0) + 1);
  return [...counts].map(([finding, n]) => `${finding} ${n}`).join(", ");
}

/**
 * `argv` defaults to the real CLI args (process.argv.slice(2)) but takes an
 * explicit array too, so a test can drive this exactly like the CLI does
 * without touching global process.argv. Returns { sentences, recognized,
 * extracted, optimistic, skipped } (the same counts the printed summary
 * reports) so a test can assert on structured results instead of scraping
 * console output.
 */
export async function main(argv = process.argv.slice(2)) {
  const { file, repo, out, optimistic, canonical } = parseArgs(argv);
  if (!file) {
    console.error(USAGE);
    process.exitCode = 1;
    return { sentences: 0, recognized: 0, extracted: [], optimistic: [], skipped: 0, declined: [], minted: [] };
  }

  const filePath = resolve(process.cwd(), file);
  const text = await readFile(filePath, "utf8");
  const sourceTag = basename(filePath);
  // A repo path is not a store handle. Resolve the SAME backend every other verb
  // reads back through, or the facts land in the retired flat file and the
  // "facts written into …" line below reports a write chat can never see.
  const repoRoot = repo ? resolve(process.cwd(), repo) : null;
  const { openConfiguredMemoryBackend } = await import("../adapters/memory/core.mjs");
  const store = repoRoot ? await openConfiguredMemoryBackend(repoRoot) : null;

  let result;
  try {
    result = await ingestText(text, {
      memoryDir: store ? store.dir : null,
      config: repoRoot ? loadConfig(process.env, repoRoot) : null,
      sourceTag, optimistic, canonical, findings: true,
    });
  } finally {
    if (store) await store.close();
  }
  const emitted = optimistic ? [...result.extracted, ...result.optimistic] : result.extracted;

  if (out) {
    const body = emitted.map((f) => JSON.stringify(f)).join("\n") + (emitted.length ? "\n" : "");
    await writeFile(resolve(process.cwd(), out), body, "utf8");
  } else if (canonical) {
    for (const line of result.canonical) console.log(line);
  } else if (!repo) {
    for (const f of emitted) console.log(JSON.stringify(f));
  }

  const { sentences, recognized } = result;
  const optimisticCount = result.optimistic.length;
  console.error(
    `${sentences} sentence${sentences === 1 ? "" : "s"} found, `
    + `${recognized} recognized as fact${recognized === 1 ? "" : "s"} `
    + `(${result.extracted.length} fact row${result.extracted.length === 1 ? "" : "s"})`
    + (optimistic ? `, ${optimisticCount} optimistic candidate${optimisticCount === 1 ? "" : "s"}` : "")
    + `, ${result.skipped} skipped — not a recognized declarative shape (an honest, expected gap; this is `
    + `an attempt, not full NLU).`
    + (result.ungroundedTerms?.length
      ? `\nSome of those skips were shapes I do read, held up by terms nothing grounds yet: `
        + `${result.ungroundedTerms.map((t) => `"${t}"`).join(", ")}. `
        + `Ground one side first (e.g. "every ${result.ungroundedTerms[0]} is a thing") and re-run.`
      : ""),
  );
  if (result.declined.length) {
    console.error(
      `${result.declined.length} candidate${result.declined.length === 1 ? "" : "s"} declined `
      + `on how the sentence read: ${countsByFinding(result.declined)}.`,
    );
  }
  if (result.minted.length) {
    console.error(
      `${result.minted.length} edge${result.minted.length === 1 ? "" : "s"} minted `
      + `in a declined candidate's place: ${countsByFinding(result.minted)}.`,
    );
  }
  if (repo) console.error(`facts written into ${repoRoot}'s tmct memory, tagged ${sourceTag}`);
  if (out) console.error(`facts written to ${out}`);
  return {
    sentences, recognized, extracted: result.extracted, optimistic: result.optimistic,
    skipped: result.skipped, declined: result.declined, minted: result.minted,
  };
}
