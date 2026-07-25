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

import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { runTurn, uuidv7, stripLeadingDiscourseAdverb } from "./chat.mjs";
import { beginsWithVowelSound, grammarRules } from "./finish.mjs";
import { splitSentencesPreservingPaths, stripCitationResidue } from "./sentences.mjs";
import { loadMemory, readFactRows, appendFact } from "../adapters/memory/core.mjs";
import { loadConfig } from "../adapters/config.mjs";
import { touchedFactRows } from "../domain/memory/touched-facts.mjs";
import { normFactTerm } from "../domain/hash.mjs";
import { winkInstance } from "../adapters/wink-model.mjs";
import {
  loadLexicon, lookupNoun, lookupVerb, lookupAdjective, lookupProperName, predicateOf,
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
 * report the Fact rows THIS turn actually touched. Returns { recognized, rows }
 * — `recognized` true iff runTurn's own record called this a stored assertion,
 * `rows` the Fact rows it touched (possibly empty for a Rule-only write).
 */
async function runSentence(sentence, { config, memoryDir }) {
  const before = readFactRows(await loadMemory(memoryDir));
  const { record } = await runTurn(sentence, { config, memoryDir, sessionId: uuidv7() });
  if (record?.via !== "assert" || record?.miss) return { recognized: false, rows: [] };
  const after = readFactRows(await loadMemory(memoryDir));
  return { recognized: true, rows: touchedFactRows(before, after) };
}

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
// Of-chain handling on a copula object: classifier heads read through to the
// real class; partitive containers state composition and yield no isa.
const COPULA_OF_READ_THROUGH = new Set(["type", "kind", "sort", "form", "class", "variety", "species", "breed", "genus"]);
// Naming periphrases stay copular: "can be termed as a name", "is known as",
// "is defined as" — the participle + "as" carries the same class claim the
// bare copula does, unlike any other verb after "is".
const COPULA_NAMING_PARTICIPLES = new Set(["termed", "known", "defined", "described", "referred", "called", "classified"]);
const COPULA_PARTITIVE_HEADS = new Set(["body", "mass", "group", "collection", "set", "series", "number", "amount", "piece", "part", "lot", "pair", "bunch", "pile"]);
// The relative pronouns that open a clause predicating about the SENTENCE
// subject: "a mountain that has lava" is a fact about the volcano, so the
// relative clause's verb binds to the copula's own subject, not to its object.
const RELATIVE_PRONOUNS = new Set(["that", "which", "who", "whom", "whose"]);
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

/** The precise tier: wink POS tags pick out the NOUN/PROPN either side of a
 *  copula (→ rdfs:subClassOf) or a lexicon-known relation verb (→ its
 *  predicate). Adjectives, determiners and prepositions are never mistaken for
 *  the entity, so "the quick brown fox jumps over something" yields nothing.
 *  The entity scan stops at punctuation so it never crosses a clause. */
function optimisticTriplesPos(sentence, lexicon, nlp) {
  let values;
  let pos;
  try {
    const doc = nlp.readDoc(String(sentence || ""));
    values = doc.tokens().out(nlp.its.value);
    pos = doc.tokens().out(nlp.its.pos);
  } catch { return []; }
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
      if (COPULA_OF_READ_THROUGH.has(String(values[k]).toLowerCase())) return lo; // classifier reads through
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
  // "that/which …" relative clause — its subject is the sentence subject.
  const inRelativeFrame = (i) => {
    for (let k = i - 1; k >= 0; k -= 1) {
      if (pos[k] === "ADV" || pos[k] === "AUX") continue;
      return RELATIVE_PRONOUNS.has(String(values[k]).toLowerCase());
    }
    return false;
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
      const nextIsOf = values[hi + 1]?.toLowerCase() === "of";
      if (!nextIsOf) return { label: entityRunAt(j), hi };
      if (COPULA_OF_READ_THROUGH.has(headWord)) { i = hi + 1; j = hi + 1; continue; }
      if (COPULA_PARTITIVE_HEADS.has(headWord)) return null;
      return { label: entityRunAt(j), hi };
    }
    return null;
  };
  // The copula's own modal chain ("can be", "may be") is part of one verb
  // complex — the subject scan starts left of it, while a free-standing VERB
  // on the way still voids the frame. An of-chain subject climbs to its head
  // ("the weight of the snow is …" → weight); a mis-headed of-chain abstains.
  const copulaSubjectAt = (i) => {
    let k = i - 1;
    while (k >= 0 && pos[k] === "AUX") k -= 1;
    const found = nearestEntityIndex(k + 1, -1, COPULA_FRAME_BLOCKERS);
    if (found === null) return null;
    const climbed = climbSubjectRun(found);
    return climbed === null ? null : entityRunAt(climbed);
  };

  const triples = [];
  const seen = new Set();
  const push = (subject, predicate, object) => {
    if (!(subject && object && subject !== object)) return;
    const key = `${subject}\0${predicate}\0${object}`;
    if (seen.has(key) || triples.length >= MAX_TRIPLES_PER_SENTENCE) return;
    seen.add(key);
    triples.push({ subject, predicate, object });
  };

  // Pass 1 — the first clean copula frame yields the isa (all guards unchanged);
  // its subject and object-run end anchor the relative-clause continuation.
  let copulaSubject = null;
  let copulaObjHi = -1;
  for (let i = 1; i < values.length - 1; i += 1) {
    if (pos[i] === "AUX" && OPTIMISTIC_COPULAS.has(values[i].toLowerCase())) {
      const subject = copulaSubjectAt(i);
      const object = copulaObjectAt(i);
      if (subject && object && subject !== object.label) {
        push(subject, "rdfs:subClassOf", object.label);
        copulaSubject = subject;
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
  if (copulaSubject) {
    for (let i = copulaObjHi + 1; i < values.length; i += 1) {
      if (pos[i] !== "VERB" && pos[i] !== "AUX") continue;
      const word = values[i].toLowerCase();
      if (OPTIMISTIC_COPULAS.has(word)) continue;
      const verb = lookupVerb(lexicon, word);
      if (!verb) continue;
      const subject = inRelativeFrame(i) ? copulaSubject : climbedSubjectAt(i);
      if (subject === null) continue;
      push(subject, predicateOf(verb), nearestEntity(i, +1));
    }
    return triples;
  }

  // Pass 2b — no copula isa: the relation-verb tier over the whole sentence,
  // climbing an of-chain subject to its head ("the weight of the snow creates
  // pressure" → weight creates pressure, not snow). VERB-tagged only, so a bare
  // AUX ("Earth has …") in a non-frame sentence stays an honest miss.
  for (let i = 1; i < values.length - 1; i += 1) {
    if (pos[i] !== "VERB") continue;
    const verb = lookupVerb(lexicon, values[i].toLowerCase());
    if (!verb) continue;
    const subject = climbedSubjectAt(i);
    if (subject === null) continue;
    push(subject, predicateOf(verb), nearestEntity(i, +1));
  }
  return triples;
}

/** The lexical fallback for a checkout with no wink model: a copula flanked by
 *  two lexicon-known nouns (or a mid-sentence proper noun). Narrower and more
 *  cautious than the POS tier — without part-of-speech tags the only safe entity
 *  test is lexicon membership, so unlisted content nouns are skipped here. */
function optimisticTriplesLexical(sentence, lexicon) {
  const raw = String(sentence || "").match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (raw.length < 3) return [];
  const lower = raw.map((w) => w.toLowerCase());
  const nearestEntity = (idx, step) => {
    for (let i = idx + step, hops = 0; i >= 0 && i < lower.length && hops < OPTIMISTIC_ENTITY_HOPS; i += step, hops += 1) {
      const w = lower[i];
      if (OPTIMISTIC_SKIP.has(w) || lookupAdjective(lexicon, w)) continue;
      const noun = lookupNoun(lexicon, w);
      if (noun) return normFactTerm(noun.lemma);
      const proper = lookupProperName(lexicon, w);
      if (proper) return normFactTerm(proper);
      if (i > 0 && /^[A-Z]/.test(raw[i])) return normFactTerm(raw[i]);
      return null;
    }
    return null;
  };
  for (let i = 1; i < lower.length - 1; i += 1) {
    if (!OPTIMISTIC_COPULAS.has(lower[i])) continue;
    const subject = nearestEntity(i, -1);
    const object = nearestEntity(i, +1);
    if (subject && object && subject !== object) return [{ subject, predicate: "rdfs:subClassOf", object }];
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
 */
export function optimisticTriples(sentence, { lexicon = loadLexicon(), nlp } = {}) {
  const engine = nlp === undefined ? winkInstance() : nlp;
  return engine ? optimisticTriplesPos(sentence, lexicon, engine) : optimisticTriplesLexical(sentence, lexicon);
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
 *     optimistic  also run the fuzzy tier over strict-skipped sentences.
 *     canonical   include a `canonical` array: one enriched triple line per
 *                 ingested fact.
 *     config      a loaded config; derived from the write dir when absent.
 *     lexicon     a loaded lexicon; the core vocabulary when absent.
 *
 * Returns { sentences, recognized, extracted, optimistic, skipped, canonical? }.
 *   recognized — strict-recognized sentence count.
 *   extracted  — strict fact rows ({subject, predicate, object, provenance,
 *                quantifier, sentence}).
 *   optimistic — fuzzy candidate rows ({subject, predicate, object, provenance,
 *                sentence}); always [] unless options.optimistic.
 *   skipped    — sentences neither tier grounded.
 */
export async function ingestText(text, {
  memoryDir = null, sourceTag = "text", optimistic = false,
  canonical = false, config = null, lexicon = null,
} = {}) {
  // Paragraphs first (blank-line separated), so the pronoun carry never bridges
  // a topic break: a fresh paragraph clears the last-subject it would resolve
  // "they"/"it" against. Each paragraph then splits into sentences the shared
  // path-preserving way.
  const paragraphs = String(text ?? "").split(/\n[ \t]*\n/);
  const ephemeral = !memoryDir;
  const dir = memoryDir || await mkdtemp(join(tmpdir(), "tmct-ingest-"));
  // `dir` may be a backend handle (a sqlite store), not a path — only a real
  // directory string can seed loadConfig's cwd; a handle-holding caller passes
  // its own config.
  const cfg = config || loadConfig(process.env, typeof dir === "string" ? dir : process.cwd());
  const lex = lexicon || loadLexicon();
  const nlp = optimistic ? winkInstance() : null;

  const extracted = [];
  const optimisticFacts = [];
  let sentenceCount = 0;
  let recognizedSentences = 0;
  let optimisticSentences = 0;

  // One recognized read of some text form: null when the strict recognizer
  // grounds nothing, else the Fact rows it touched.
  const strictRows = async (form) => {
    const { recognized, rows } = await runSentence(form, { config: cfg, memoryDir: dir });
    return recognized && rows.length ? rows : null;
  };

  try {
    for (const paragraph of paragraphs) {
      // The last unique grounded subject in THIS paragraph, carried onto a
      // later pronoun-led sentence the strict recognizer couldn't ground on
      // its own. Cleared at the paragraph boundary.
      let carrySubject = null;
      for (const sentence of splitSentencesPreservingPaths(paragraph)) {
        sentenceCount += 1;
        const cleaned = stripCitationResidue(sentence);
        // Whole sentence first, then each closed-marker clause as a fallback.
        let rows = null;
        for (const candidate of clauseCandidates(cleaned, { nlp })) {
          rows = await strictRows(candidate);
          if (rows) break;
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
        }
        if (rows) {
          recognizedSentences += 1;
          const subjects = new Set(rows.map((r) => r.subject));
          if (subjects.size === 1) carrySubject = [...subjects][0];
          const tag = `extracted:${sourceTag}`;
          for (const row of rows) {
            await appendFact(dir, {
              subject: row.subject, predicate: row.predicate, object: row.object,
              provenance: tag, quantifier: row.quantifier || "",
            });
            extracted.push({
              subject: row.subject, predicate: row.predicate, object: row.object,
              provenance: tag, quantifier: row.quantifier || "", sentence,
            });
          }
          continue;
        }
        if (!optimistic) continue;
        const candidates = optimisticTriples(cleaned, { lexicon: lex, nlp });
        if (!candidates.length) continue;
        optimisticSentences += 1;
        const tag = `optimistic-extract:${sourceTag}`;
        for (const t of candidates) {
          await appendFact(dir, {
            subject: t.subject, predicate: t.predicate, object: t.object, provenance: tag,
          });
          optimisticFacts.push({ ...t, provenance: tag, sentence });
        }
      }
    }

    const result = {
      sentences: sentenceCount,
      recognized: recognizedSentences,
      extracted,
      optimistic: optimisticFacts,
      skipped: sentenceCount - recognizedSentences - optimisticSentences,
    };
    if (canonical) {
      result.canonical = canonicalLines([...extracted, ...optimisticFacts], readFactRows(await loadMemory(dir)));
    }
    return result;
  } finally {
    if (ephemeral) await rm(dir, { recursive: true, force: true });
  }
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
    return { sentences: 0, recognized: 0, extracted: [], optimistic: [], skipped: 0 };
  }

  const filePath = resolve(process.cwd(), file);
  const text = await readFile(filePath, "utf8");
  const sourceTag = basename(filePath);
  const memoryDir = repo ? resolve(process.cwd(), repo) : null;

  const result = await ingestText(text, { memoryDir, sourceTag, optimistic, canonical });
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
    + `an attempt, not full NLU).`,
  );
  if (repo) console.error(`facts written into ${memoryDir}'s tmct memory, tagged ${sourceTag}`);
  if (out) console.error(`facts written to ${out}`);
  return { sentences, recognized, extracted: result.extracted, optimistic: result.optimistic, skipped: result.skipped };
}
