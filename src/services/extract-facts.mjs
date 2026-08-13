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
// --optimistic  ALSO run a bounded fuzzy tier over the sentences the strict
//               recognizer skipped (optimisticTriples below): a copula, a
//               lexicon relation verb, or one of the closed newswire event
//               verbs read in a tighter frame, flanked by two resolvable
//               entities, becomes a candidate triple, stored under its OWN
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
// mis-read is declined by name (`relative-clause-verb`, `fragment-term`,
// `phrasal-particle`), and a definitional frame ("X is the name for Y") declines the false isa and mints
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
import { normFactTerm, factIdForTriple } from "../domain/hash.mjs";
import { splitIdentifierWords } from "../domain/prose.mjs";
import { baseVerbSurface } from "../domain/fact-phrase.mjs";
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
    config, memoryDir, sessionId: sessionId || uuidv7(), env, factRowsBefore: before, ingested: true,
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
// A pronoun standing between a copula and the nearest noun on its left IS that
// copula's subject: "many say it is just a matter of time" predicates about
// "it", and a scan that walks through the pronoun lands on whatever noun sits
// further left and stores a claim the sentence never made. A pronoun names
// nothing a fact can hold, so the subject side stops there and the frame
// abstains — the same answer the strict recognizer already gives a
// pronoun-subject claim.
const COPULA_SUBJECT_BLOCKERS = new Set([...COPULA_FRAME_BLOCKERS, "PRON"]);
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

// The verbs a news report states an event with. The relation arm above reads a
// verb only when the lexicon declares one, and the lexicon's verb list is a
// software vocabulary — so a whole newswire paragraph ("the moon will
// completely block the sun") carries no relation under it at all. This closed
// band sits beside it: transitive event verbs, each of which takes a direct
// object naming the thing the event happened to, so the frame below can demand
// an adjacent noun on each side and get the actor and the affected thing.
//
// Verbs of speech and attribution are deliberately absent — "say", "tell",
// "add", "report", "accuse", "claim" each open a reported clause, and the noun
// after one is the subject of what was said, never the object of the saying.
// So are verbs whose everyday reading swamps their news one ("hold", "face",
// "follow", "lead", "reach", "back", "pass", "cut"): a band that admits those
// buys a handful of events and pays for it in nonsense.
const NEWSWIRE_RELATION_VERBS = new Set([
  "hit", "strike", "kill", "injure", "wound", "damage", "destroy", "devastate",
  "ban", "halt", "block", "bar", "suspend", "impose",
  "arrest", "detain", "jail", "charge", "convict", "sentence", "deport", "release", "free",
  "elect", "appoint", "oust", "overthrow",
  "sign", "adopt", "approve", "reject", "veto",
  "launch", "unveil", "seize", "capture", "invade", "attack", "bomb", "target",
  "discover", "uncover", "rescue", "evacuate",
  "spark", "trigger", "cause", "force", "deploy", "restore", "expand",
]);
// Two verbs the band already holds can report ONE event: a report wounds the
// people its next sentence says were injured, and the card then states the
// same act twice. Each pair below is one act under two words, so the left
// lemma reads as the right one and both sentences land on a single edge —
// the vocabulary-level form of the rule that already puts "releases" and
// "released" on one edge.
//
// The bar for a pair is that the two words mean one thing wherever the band
// reads them. A pair that merely overlaps keeps its own edge, and it fails the
// bar in either of two ways. It can name two different acts on the same people
// ("detain"/"jail", "oust"/"overthrow"). Or one word can carry a second sense
// the other does not: "free" is "release from custody" for a prisoner and
// "pull out of the rubble" for a rescue, so folding it onto "release" turns
// "rescuers free quake victim" into a jail delivery. Nothing in the sentence
// tells those two senses apart, so the pair stays out.
const NEWSWIRE_VERB_SYNONYMS = new Map([
  ["wound", "injure"],
  ["uncover", "discover"],
  ["bar", "ban"],
]);

// The particles a phrasal verb carries. A frame that drops one states a
// different event ("Frenzy … Takes Over London" → "takes London"), and one
// that reads it as the thing the event touched states nonsense ("stocks sell
// out" → sell "out"), so the pair below is read whole or not at all.
const PHRASAL_PARTICLES = new Set([
  "over", "out", "up", "down", "off", "in", "on", "away", "back", "aside", "through",
]);
// The closed verb+particle pairs read as one predicate. Each is a phrasal verb
// whose meaning is not its bare verb's — "take over" is not "take", "sell out"
// is not "sell" — so the pair mints `mgx:<lemma>-<particle>`, which
// fact-phrase.mjs already reads back as "takes over". A verb+particle the list
// doesn't hold is left to the tiers it already went through.
const PHRASAL_VERB_PAIRS = new Set([
  "take over", "take out", "take up", "take on", "take down", "take back",
  "sell out", "sell off",
  "carry out",
  "step down", "step up", "step aside", "step in",
  "call off", "call up", "call out",
  "hand over", "hand out", "hand down",
  "rule out",
  "pull out", "pull off", "pull down", "pull back",
  "set out", "set up", "set off", "set aside",
  "break out", "break up", "break down", "break off",
  "lay off", "lay out",
  "shut down", "shut off",
  "turn out", "turn down", "turn over", "turn away", "turn back",
  "give up", "give back", "give in",
  "bring down", "bring back", "bring in",
  "roll out", "roll back",
  "hold back", "hold up", "hold off",
  "back down", "scale back", "push back", "push through",
  "knock out", "knock down", "wipe out", "shoot down", "strike down",
  "head off", "fend off",
  "point out", "speak out",
  "close down", "open up",
  "drop out", "walk out", "walk back",
  "wind down", "phase out", "sign off",
  "fall back", "move on",
]);
// The prepositions a subject run climbs OUT of to the head that governs it.
// "Frenzy for solar eclipse glasses takes over London" is about the frenzy;
// the run beside the verb is the preposition's object, never the subject.
// Deliberately without the temporal ones (after/before/during/since): a
// fronted temporal phrase is adverbial, so the noun the climb would reach for
// heads nothing.
const SUBJECT_CHAIN_PREPOSITIONS = new Set([
  "of", "for", "in", "on", "at", "from", "with", "about", "over",
  "against", "between", "among", "across", "near", "behind", "around",
  "under", "inside", "outside", "amid",
]);
// The counting words that head an of-frame the reader has to look through to
// find what the sentence is about. "triggers hundreds of evacuations" is a fact
// about the evacuations, and "discovers hundreds of ancient amphorae" about the
// amphorae. Every relation frame here reads through these; the newswire event
// frame widens the same climb to the container heads (OF_PARTITIVE_HEADS) and
// the classifier ones, so "charged a group of Cuban men" is about the men.
// Anything outside those sets names its own head, so "restore the sacred glow
// of fireflies" restores the glow, not the fireflies, and "a piece of cake" is
// about the piece.
const OF_COUNT_HEADS = new Set(["hundred", "hundreds", "thousand", "thousands", "million", "millions", "dozen", "dozens", "score", "scores", "handful"]);
// The count phrases newswire writes in front of what an event touched. Closed
// by list, and each has to close on the number itself, so a bare preposition
// ("attacked at dawn") is never mistaken for one.
const COUNT_PHRASE_RE = /^(?:more than|at least|at most|as many as|up to|fewer than|less than|nearly|almost|about|around|over|roughly)\s+\d[\d,.]*$/i;
const COUNT_PHRASE_MAX_TOKENS = 4;
// A verb whose own auxiliary is a be-form heads a passive or a progressive
// ("was arrested by ICE", "are disappearing"), and there the noun on the
// subject side is what the event happened TO, not who did it — an active read
// of one states the reverse of the sentence. The scan crosses adverbs only, so
// a modal chain that is still active ("will completely block") reads on.
const BE_AUXILIARIES = new Set(["is", "are", "was", "were", "be", "been", "being", "am"]);
// The prepositions an agentless passive states its subject's own condition
// with: "banned FROM parliament elections", "deported TO Mexico", "detained AT
// the border". Each says where the subject ended up, so the pair reads back as
// one predicate about the subject. Deliberately narrow — "charged WITH
// smuggling people" and "convicted OF fraud" take a whole clause or an
// abstraction after them, not a place a fact can hold, and "of" would collide
// with the of-chain climbs above.
const PASSIVE_STATE_PREPOSITIONS = new Set([
  "from", "to", "in", "at", "into", "on", "near", "under", "over", "across", "off",
]);

// wink's tokenizer keeps a sentence-final full stop glued to the word before
// it when that word ends the text ("… block the sun." tokenizes as one PROPN
// "sun."), so a term read off the last token would otherwise be stored with
// the sentence's own punctuation in its key. Only a LONE trailing stop comes
// off: an abbreviation carries interior stops too ("U.S.", "P.K.K.") and keeps
// every one of them.
const stripSentenceFinalStop = (word) => {
  const text = String(word ?? "");
  return text.endsWith(".") && !text.slice(0, -1).includes(".") ? text.slice(0, -1) : text;
};

/** The closed-band lemma a word spells, or null. A Title Case headline carries
 *  no tag a reader can trust, so the band's own vocabulary is what identifies
 *  its verb: the word itself, or its -s fold ("Halts" → halt). */
function newswireVerbLemma(word) {
  const surface = stripSentenceFinalStop(String(word ?? "")).toLowerCase();
  if (NEWSWIRE_RELATION_VERBS.has(surface)) return surface;
  const bare = surface.endsWith("s") ? surface.slice(0, -1) : "";
  return bare && NEWSWIRE_RELATION_VERBS.has(bare) ? bare : null;
}

/** Fold an entity surface to its stored key: a lexicon noun's lemma, else the
 *  word's own normFactTerm (the optimistic tier mints unlisted content nouns
 *  the way the strict teach lane already mints "redis"). */
function foldEntity(word, lexicon, taggedLemma = "") {
  const surface = stripSentenceFinalStop(word);
  // A multi-word name is stored exactly as it reads. "United States" is the
  // name; "united state" is a lemma fold of a word that was never on its own.
  if (surface.includes(" ")) return normFactTerm(surface);
  const noun = lookupNoun(lexicon, surface.toLowerCase());
  return normFactTerm(noun ? noun.lemma : singularHead(surface, taggedLemma));
}

/** The singular a head noun folds to when the lexicon carries no entry for it:
 *  the tagger's own lemma, and only where that lemma is the surface with an -s
 *  or -es taken off. A lemma that respells the word further ("analyses" →
 *  "analyzes") is not a singular, and a proper noun keeps its own spelling
 *  ("Wales", "Netherlands"), which is what a tagger returns for one anyway. */
function singularHead(surface, taggedLemma) {
  const word = String(surface ?? "");
  const lemma = String(taggedLemma ?? "");
  if (!lemma || lemma === word) return word;
  const lower = word.toLowerCase();
  const base = lemma.toLowerCase();
  return lower === `${base}s` || lower === `${base}es` ? lemma : word;
}

// The shortest word ingestText's fact-degree scan treats as a content-noun
// candidate — long enough to rule out stray abbreviations and pronouns the
// lexical fallback's stopword set doesn't already carry.
const CANDIDATE_TERM_MIN_LENGTH = 3;

// An abbreviated personal title carries a trailing stop, which is why wink
// tags it PROPN and glues it to the surname ("Mr./PROPN Gilman/PROPN"). A
// title addresses a person; it never names one, so it comes off the front of a
// name run however short the run is.
const HONORIFIC_NAME_PREFIXES = new Set([
  "mr", "mrs", "ms", "mx", "dr", "prof", "rev",
  "sen", "rep", "gov", "gen", "capt", "col", "lt", "sgt", "maj",
]);

/** The name a run of capitalized tokens states, front-trimmed. A run of three
 *  or more sheds a leading role noun the lexicon knows ("Prime Minister Keir
 *  Starmer" → "Keir Starmer") or a hyphenated compound that only Title Case
 *  lifted to a proper noun ("Ex-Marine Robert Gilman" → "Robert Gilman"). The
 *  trim stops at two tokens, so "Count Binface" and "Lake Kariba" keep the word
 *  that belongs to the name. An honorific comes off at any length. */
function trimNameRun(words, lexicon) {
  const bare = (word) => stripSentenceFinalStop(word).toLowerCase();
  let start = 0;
  while (start < words.length - 1 && HONORIFIC_NAME_PREFIXES.has(bare(words[start]))) start += 1;
  while (words.length - start >= 3) {
    const first = bare(words[start]);
    if (!first.includes("-") && !lookupNoun(lexicon, first)) break;
    start += 1;
  }
  return words.slice(start);
}

// A headline is set in Title Case AND carries no sentence-final stop. Both
// halves matter, and they buy different things — see headlineReadPos.
const SENTENCE_FINAL_STOPS = new Set([".", "!", "?"]);
const readsAsHeadline = (values) => readsAsTitleCase(values)
  && !SENTENCE_FINAL_STOPS.has(String(values[values.length - 1] ?? ""));

/**
 * How a sentence's parts of speech read once Title Case is allowed for. A
 * tagger given a headline has no lowercase to work from and comes back wrong in
 * both directions: the line's verb reads PROPN ("Thailand/PROPN Halts/PROPN
 * New/PROPN Gun/PROPN"), while its plainest noun reads VERB ("Permits/VERB",
 * "Shooting/VERB"). Two corrections, on two different conditions.
 *
 * In ANY Title Case sentence, a word the event band or the lexicon spells as a
 * verb IS the verb (and a `lemmas` array passed in is corrected to match): no
 * name run holds one of those, so promoting it can only split a run the
 * capitals glued together.
 *
 * Demoting an unlisted VERB to a noun takes the stricter test — a real
 * sentence can pass the capitalization test on its own ("The delegation met
 * Prime Minister Keir Starmer."), and demoting its verb would cost every tag
 * it already had right. The missing sentence-final stop is what tells a
 * headline from that.
 *
 * Never the first token either way: a headline opens on its subject, and "Bar
 * Refaeli" opens on a name the band also spells. Never a band word straight
 * after a determiner ("The Free Press"). Any other sentence gets its tags back
 * untouched.
 */
function headlineReadPos(values, pos, lemmas, lexicon) {
  if (!readsAsTitleCase(values)) return pos;
  const demoteUnlistedVerbs = readsAsHeadline(values);
  const read = [...pos];
  for (let i = 1; i < values.length; i += 1) {
    const banded = read[i - 1] === "DET" ? null : newswireVerbLemma(values[i]);
    // The tagger's own lemma still counts where it reaches a band verb the
    // surface fold cannot ("Freed" → free), so a headline's past participle
    // keeps the tag it had.
    const taggedBandVerb = read[i] === "VERB" && NEWSWIRE_RELATION_VERBS.has(String(lemmas?.[i] ?? "").toLowerCase());
    if (banded) {
      read[i] = "VERB";
      if (lemmas) lemmas[i] = banded;
    } else if (taggedBandVerb || lookupVerb(lexicon, stripSentenceFinalStop(String(values[i])).toLowerCase())) {
      read[i] = "VERB";
    } else if (read[i] === "VERB" && demoteUnlistedVerbs) {
      read[i] = "NOUN";
    }
  }
  return read;
}

/** Every NOUN/PROPN token `sentences` names, surface-form occurrence-counted —
 *  a POS tagger reads unknown words by context, so an unlisted noun ("wombat")
 *  counts exactly like a lexicon-known one. A contiguous run of two or more
 *  PROPN tokens counts ONCE, as the whole name it spells ("Robert Gilman",
 *  "United States"); the run's own words never count beside it, because half a
 *  name is half a lookup. */
function candidateTermOccurrencesPos(sentences, nlp, lexicon) {
  const counts = new Map();
  for (const sentence of sentences) {
    let values;
    let pos;
    let lemmas;
    try {
      const doc = nlp.readDoc(String(sentence || ""));
      values = doc.tokens().out(nlp.its.value);
      pos = doc.tokens().out(nlp.its.pos);
      lemmas = doc.tokens().out(nlp.its.lemma);
    } catch { continue; }
    const headline = readsAsHeadline(values);
    const taggedPos = pos;
    pos = headlineReadPos(values, pos, lemmas, lexicon);
    // A headline read demotes an unlisted verb to a noun so a run can span it
    // ("Mass Shooting"). That much is right for a run, and wrong for a term of
    // its own: "Arrives" belongs inside no name and names nothing on its own.
    const namesOnlyInsideARun = (k) => taggedPos[k] === "VERB" && pos[k] !== "VERB";
    // A headline's capitals say nothing about which words spell a name, so its
    // runs read over every noun; ordinary prose keeps the capital as the tell
    // and runs over proper nouns alone.
    const runsWith = (k) => (headline ? pos[k] === "NOUN" || pos[k] === "PROPN" : pos[k] === "PROPN");
    // A role noun standing in front of a name is a title on that name, not a
    // term of its own — "President Trump" is one lookup, while "president" and
    // "trump" are two half ones. Only a common noun the lexicon knows opens a
    // run this way, and a headline's own capitals carry no such distinction.
    const opensRoleTitledName = (k) => !headline && pos[k] === "NOUN" && pos[k + 1] === "PROPN"
      && Boolean(lookupNoun(lexicon, stripSentenceFinalStop(String(values[k])).toLowerCase()));
    for (let i = 0; i < values.length; i += 1) {
      if (pos[i] !== "NOUN" && pos[i] !== "PROPN") continue;
      let hi = i;
      if (runsWith(i) || opensRoleTitledName(i)) {
        while (hi + 1 < values.length && runsWith(hi + 1)) hi += 1;
      }
      if (hi > i) {
        const name = trimNameRun(values.slice(i, hi + 1), lexicon).join(" ");
        counts.set(name, (counts.get(name) || 0) + 1);
        i = hi;
        continue;
      }
      if (namesOnlyInsideARun(i)) continue;
      counts.set(values[i], (counts.get(values[i]) || 0) + 1);
    }
  }
  return counts;
}

// The tags a noun phrase opens with. One of these in front of a token settles
// that the token heads a noun phrase of its own, whatever follows it — a
// determiner ("the day it happened"), a possessive, a numeral, or the
// preposition that governs the phrase ("immigrants to countries they have no
// connection to").
const NOUN_PHRASE_OPENERS = new Set(["DET", "PRON", "PART", "NUM", "ADP"]);

/** Does the token at `i` stand where only a clause's own verb can, despite its
 *  NOUN tag? A tagger reads "many say it is just a matter of time" as a noun on
 *  the very word the clause turns on, and a term scan then offers "say" as
 *  something to look up. One closed frame says otherwise: a subject pronoun and
 *  its own verb right behind the token. The pronoun has to be a subject one, so
 *  a relative clause hanging off a real noun ("a camera that would cost …")
 *  keeps its reading. */
function readsAsClauseVerb(values, pos, i) {
  if (i > 0 && NOUN_PHRASE_OPENERS.has(pos[i - 1])) return false;
  if (pos[i + 1] !== "PRON" || RELATIVE_PRONOUNS.has(String(values[i + 1] ?? "").toLowerCase())) return false;
  return pos[i + 2] === "VERB" || pos[i + 2] === "AUX";
}

/** The same question for the other frame a newswire sentence hides a verb in:
 *  an infinitive right behind the token, with a finished noun phrase in front
 *  of it — "the central government moves to assert control". The noun phrase is
 *  what makes the reading safe, because an infinitive alone follows nouns
 *  constantly ("rapid development to cater to tourists", "the only person to
 *  break the sound barrier"): those all carry an adjective, a determiner or a
 *  preposition on the token itself, and only a token whose own left neighbour
 *  is a common noun reads as the verb that noun phrase governs. */
function readsAsInfinitiveClauseVerb(values, pos, i) {
  if (i === 0 || pos[i - 1] !== "NOUN") return false;
  if (String(values[i + 1] ?? "").toLowerCase() !== "to") return false;
  return pos[i + 2] === "VERB";
}

/** The stored term keys `sentences` only ever uses as a clause's verb. Folded
 *  the same way `ungroundedTermOccurrences` folds its own counts, so a caller
 *  can subtract this set from those keys directly. A term the text also uses as
 *  a plain noun somewhere ("the peace talks" beside "he talks to them") stays
 *  out of the set — one verb reading never disqualifies a word that names
 *  something elsewhere in the same article.
 *
 *  `nlp` follows this module's own convention: absent means the shared wink
 *  instance, and an explicit null (no model) returns an empty set, since the
 *  frames below are read off part-of-speech tags. */
export function termsUsedOnlyAsVerbs(sentences, { lexicon = loadLexicon(), nlp } = {}) {
  const engine = nlp === undefined ? winkInstance() : nlp;
  const asVerb = new Map();
  const total = new Map();
  if (!engine) return new Set();
  for (const sentence of sentences) {
    let values;
    let pos;
    let lemmas;
    try {
      const doc = engine.readDoc(String(sentence || ""));
      values = doc.tokens().out(engine.its.value);
      pos = doc.tokens().out(engine.its.pos);
      lemmas = doc.tokens().out(engine.its.lemma);
    } catch { continue; }
    pos = headlineReadPos(values, pos, lemmas, lexicon);
    for (let i = 0; i < values.length; i += 1) {
      if (pos[i] !== "NOUN" && pos[i] !== "PROPN") continue;
      const term = foldEntity(values[i], lexicon);
      if (!term) continue;
      total.set(term, (total.get(term) || 0) + 1);
      if (readsAsClauseVerb(values, pos, i) || readsAsInfinitiveClauseVerb(values, pos, i)) {
        asVerb.set(term, (asVerb.get(term) || 0) + 1);
      }
    }
  }
  const verbs = new Set();
  for (const [term, count] of asVerb) if (count === total.get(term)) verbs.add(term);
  return verbs;
}

/** A sentence whose substantial words are nearly all capitalized is a headline
 *  set in Title Case, where a capital says nothing about which words spell a
 *  name. The POS tier reads such a sentence by tag and is unaffected; the
 *  lexical fallback has only the capitals, so it reads no name runs there. */
function readsAsTitleCase(words) {
  const substantial = words.filter((word) => word.length >= 4);
  if (substantial.length < 4) return false;
  const capitalized = substantial.filter((word) => /^[A-Z]/.test(word)).length;
  return capitalized / substantial.length >= 0.8;
}

/** The no-wink-model fallback: every word that is neither a closed-class
 *  scaffolding token nor a lexicon-known verb/adjective counts as a candidate
 *  noun — narrower than the POS tier (no context to lean on), but the same
 *  "an unlisted word can still be a content noun" posture. Capitalization
 *  stands in for the missing tags when it carries information: two or more
 *  capitalized words separated by nothing but spaces count once, as one name. */
function candidateTermOccurrencesLexical(sentences, lexicon) {
  const counts = new Map();
  for (const sentence of sentences) {
    const text = String(sentence || "");
    const matches = [...text.matchAll(/[A-Za-z][A-Za-z'-]*/g)];
    const words = matches.map((match) => match[0]);
    const titleCase = readsAsTitleCase(words);
    const spacedRunEnd = (start) => {
      let hi = start;
      while (hi + 1 < matches.length && /^[A-Z]/.test(words[hi + 1])
        && !text.slice(matches[hi].index + words[hi].length, matches[hi + 1].index).trim()) hi += 1;
      return hi;
    };
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      if (!titleCase && /^[A-Z]/.test(word)) {
        const hi = spacedRunEnd(i);
        if (hi > i) {
          const name = trimNameRun(words.slice(i, hi + 1), lexicon).join(" ");
          counts.set(name, (counts.get(name) || 0) + 1);
          i = hi;
          continue;
        }
      }
      const lower = word.toLowerCase();
      if (lower.length < CANDIDATE_TERM_MIN_LENGTH) continue;
      if (OPTIMISTIC_SKIP.has(lower)) continue;
      if (lookupVerb(lexicon, lower) || lookupAdjective(lexicon, lower)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return counts;
}

/** A single-word term that is one word of exactly one multi-word name the same
 *  text captured is that name's fragment, not a term of its own: "Gilman"
 *  beside "Robert Gilman" is the same person, and only the whole name is a
 *  question a reference lookup can answer. Its occurrences move onto the name.
 *  A word no captured name holds ("Russia", standing alone) is left where it
 *  is, and a word two names share is dropped rather than guessed onto one. */
function foldNameFragments(counts) {
  const namesByWord = new Map();
  for (const term of counts.keys()) {
    if (!term.includes(" ")) continue;
    for (const word of term.split(" ")) {
      if (!namesByWord.has(word)) namesByWord.set(word, new Set());
      namesByWord.get(word).add(term);
    }
  }
  for (const [term, occurrences] of [...counts]) {
    if (term.includes(" ")) continue;
    const names = namesByWord.get(term);
    if (!names) continue;
    counts.delete(term);
    if (names.size !== 1) continue;
    const [name] = names;
    counts.set(name, (counts.get(name) || 0) + occurrences);
  }
  return counts;
}

/** Every fact-ungrounded term `sentences` names: a candidate noun folded to
 *  its stored term key (`foldEntity`, so a ledger entry and a stored fact key
 *  the same term identically) that `rows` holds zero fact rows for — the
 *  fact-degree rule an ungrounded-term ledger admits by, independent of
 *  whether the lexicon happens to know the word. Occurrence-counted, so a
 *  term named three times outranks one named once.
 *
 *  `nlp` follows this module's own convention: absent means the shared wink
 *  instance, and an explicit null forces the lexical fallback. */
export function ungroundedTermOccurrences(sentences, rows, { lexicon = loadLexicon(), nlp } = {}) {
  const engine = nlp === undefined ? winkInstance() : nlp;
  const raw = engine
    ? candidateTermOccurrencesPos(sentences, engine, lexicon)
    : candidateTermOccurrencesLexical(sentences, lexicon);
  const grounded = new Set();
  for (const row of rows) {
    grounded.add(normFactTerm(row.subject));
    grounded.add(normFactTerm(row.object));
  }
  const counts = new Map();
  for (const [word, n] of raw) {
    const term = foldEntity(word, lexicon);
    if (!term) continue;
    counts.set(term, (counts.get(term) || 0) + n);
  }
  // Fragments fold onto their whole name BEFORE the fact-degree filter, so a
  // name a fact already grounds takes its own fragments out with it.
  foldNameFragments(counts);
  for (const term of [...counts.keys()]) if (grounded.has(term)) counts.delete(term);
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
  let lemmas;
  try {
    const doc = nlp.readDoc(String(sentence || ""));
    values = doc.tokens().out(nlp.its.value);
    pos = doc.tokens().out(nlp.its.pos);
    lemmas = doc.tokens().out(nlp.its.lemma);
  } catch { return { triples: [], declined: [], minted: [] }; }
  pos = headlineReadPos(values, pos, lemmas, lexicon);
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
    if (lo === hi) return foldEntity(values[i], lexicon, lemmas?.[i]);
    // A run of proper nouns spells a name, and a name sheds the honorific or
    // role word stacked in front of it — "Ex-Marine Robert Gilman" is Robert
    // Gilman. A run holding any common noun is a compound, not a name, and
    // keeps every word ("disk operating system").
    let words = values.slice(lo, hi + 1);
    if (words.every((_, k) => pos[lo + k] === "PROPN")) words = trimNameRun(words, lexicon);
    const last = stripSentenceFinalStop(words[words.length - 1]);
    const head = lookupNoun(lexicon, last.toLowerCase());
    if (words.length === 1) return normFactTerm(head ? head.lemma : singularHead(last, lemmas?.[hi]));
    return normFactTerm([...words.slice(0, -1), head ? head.lemma : singularHead(last, lemmas?.[hi])].join(" "));
  };
  // Where a leftward scan resumes when it meets a comma, or -1 when the comma
  // stands between it and another clause. A news sentence names its subject
  // first and then interrupts itself — "Yabloko, the Russian antiwar party, is
  // banned …", "Robert Gilman, Freed by Russia, Arrives …" — so a scan that
  // stops dead on a comma never reaches the subject at all. It may cross when
  // nothing between the comma and either an earlier comma or the sentence start
  // predicates: a relative clause ("the quake, which killed 100 people,
  // damaged …") holds a verb, and that keeps the scan out.
  const commaCrossingFrom = (close) => {
    for (let k = close - 1; k >= 0; k -= 1) {
      if (values[k] === ",") return k;
      if (pos[k] === "VERB" || pos[k] === "AUX" || pos[k] === "PUNCT") return -1;
    }
    return close;
  };
  const nearestEntityIndex = (idx, step, blocked = null) => {
    let mayCrossComma = step < 0;
    for (let i = idx + step; i >= 0 && i < values.length; i += step) {
      if (pos[i] === "PUNCT") {
        if (!mayCrossComma || values[i] !== ",") break;
        const resume = commaCrossingFrom(i);
        if (resume < 0) break;
        mayCrossComma = false;
        i = resume;
        continue;
      }
      if (blocked && blocked.has(pos[i])) break;
      if (isNounish(i)) return i;
    }
    return null;
  };
  // The subject-side mirror of the copula-object of-chain rule: when a found
  // subject run is the object of a preposition ("the weight of all of the
  // snow …", "frenzy for eclipse glasses …"), climb to the head that governs
  // the phrase ("weight", "frenzy"), bounded to two hops. A classifier head
  // (type/kind/sort/…) or a counting one (hundreds/dozens/…) reads THROUGH —
  // "a kind of X" and "hundreds of X" are both about X — so the inner noun is
  // kept. When the run is governed by a preposition but no readable noun heads
  // the phrase (a mis-tagged head, e.g. "the top of the mountain …"), return
  // null: an honest abstain, never the inner-noun confusion ("mountain",
  // "snow"). An ungoverned run is returned unchanged. Returns a run-lo index
  // to fold, or null to abstain.
  const prepositionChainSkip = (k) => {
    const p = pos[k];
    return p === "DET" || p === "ADJ" || p === "ADV" || p === "NUM";
  };
  const climbSubjectRun = (found) => {
    let lo = runLoOf(found);
    for (let hop = 0; hop < 2; hop += 1) {
      let g = lo - 1;
      while (g >= 0 && prepositionChainSkip(g)) g -= 1;
      if (g < 0 || !SUBJECT_CHAIN_PREPOSITIONS.has(values[g]?.toLowerCase())) return lo; // ungoverned run
      let k = g - 1;
      while (k >= 0 && !isNounish(k)
        && (prepositionChainSkip(k) || SUBJECT_CHAIN_PREPOSITIONS.has(values[k]?.toLowerCase()))) k -= 1;
      if (k < 0 || !isNounish(k)) return null; // no readable head — abstain
      const head = String(values[k]).toLowerCase();
      if (OF_CLASSIFIER_HEADS.has(head) || OF_COUNT_HEADS.has(head)) return lo; // reads through to the inner noun
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
  // class ("a type of mammal" → mammal). A container or counting head states
  // quantity instead ("a large body of ice", "dozens of wolves"), and quantity
  // is no class at all, so both decline the isa.
  const copulaObjectAt = (i) => {
    let sawDeterminer = false;
    for (let j = i + 1; j < values.length; j += 1) {
      if (pos[j] === "DET" || pos[j] === "NUM") sawDeterminer = true;
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
      // A bare "-ed" complement straight after the copula is a predicative
      // participle the tagger mis-read as a noun ("dozens have been rescued"),
      // never a class: a real class complement carries a determiner or number
      // ("has been a doctor"). Short true nouns in -ed (bed, seed, need) stay
      // under the length bound.
      if (!sawDeterminer && headWord.length >= 5 && headWord.endsWith("ed")) return null;
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
      if (OF_PARTITIVE_HEADS.has(headWord) || OF_COUNT_HEADS.has(headWord)) return null;
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
    const found = nearestEntityIndex(k + 1, -1, COPULA_SUBJECT_BLOCKERS);
    if (found === null) return null;
    const climbed = climbSubjectRun(found);
    if (climbed === null) return null;
    let hi = climbed;
    while (hi + 1 < values.length && isNounish(hi + 1)) hi += 1;
    return { label: entityRunAt(climbed), hi };
  };

  // Does the verb complex headed at `i` open with a be-form auxiliary? Adverbs
  // in between are crossed; anything else ends the complex.
  const beAuxiliaryBefore = (i) => {
    for (let k = i - 1; k >= 0; k -= 1) {
      if (pos[k] === "ADV" || pos[k] === "PART") continue;
      if (pos[k] !== "AUX") return false;
      if (BE_AUXILIARIES.has(String(values[k]).toLowerCase())) return true;
    }
    return false;
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

  // The newswire event frame — a closed band of transitive event verbs
  // (NEWSWIRE_RELATION_VERBS) read in a much tighter frame than the lexicon
  // arm's. The lexicon's own verbs keep their loose scans; a verb only this
  // band knows has to earn its triple:
  //
  //   - wink must have tagged the token VERB, and its LEMMA must be in the
  //     band, so a past tense ("released", "adopted") reads where the
  //     lexicon's -s-only fold cannot. A verb the LEXICON already declares is
  //     skipped by surface, because the lexicon arm read that sentence first
  //     and this frame would mint the same act a second time;
  //   - a verb followed by one of the closed phrasal pairs is admitted on the
  //     pair instead, whichever vocabulary the bare verb belongs to: "take
  //     over" is a different relation from "take", so the lexicon's entry for
  //     the verb has nothing to say about it;
  //   - it must not sit in a relative clause, which has no subject of its own
  //     here;
  //   - a be-form auxiliary heads a passive or a progressive rather than
  //     declining the sentence: the -ing form marks the progressive and is
  //     skipped, a "by" complement mints the ACTIVE edge with the actor as
  //     subject, and an agentless passive states the patient's own condition;
  //   - subject and object are each the NEAREST noun run on their side with
  //     the copula frame's blockers applied, so neither scan crosses a verb, a
  //     preposition or a conjunction into another clause. "resigned from
  //     Cambridge" yields no object at all rather than "resign Cambridge".
  //     The subject scan starts left of the verb's OWN modal chain ("will
  //     completely block"), which is one verb complex rather than a crossing,
  //     and climbs out of any preposition that governs it ("a fire AT the
  //     hospital killed …" is about the fire). A counting of-chain on either
  //     side reads through to what the event really touched ("hundreds of
  //     ancient amphorae" → amphorae).
  //
  // A lemma the lexicon itself declares keeps the lexicon's predicate, so
  // "releases" (the lexicon arm) and "released" (this one) land on one edge —
  // and NEWSWIRE_VERB_SYNONYMS folds the band's own interchangeable pairs onto
  // that same edge before the lookup, so "freed" lands there too.
  const verbComplexStart = (i) => {
    let k = i - 1;
    while (k >= 0 && (pos[k] === "ADV" || pos[k] === "AUX" || pos[k] === "PART")) k -= 1;
    return k + 1;
  };
  // A counting word alone. The lexicon arm reads through these and no others:
  // a container head states what the thing is made of or held in, and a
  // classifier rewrites a class, so neither one moves what a relation verb
  // touched.
  const readsThroughCountOf = (word) => OF_COUNT_HEADS.has(String(word ?? "").toLowerCase());
  // The newswire event frame's wider read-through: the counting words, plus the
  // container and classifier heads a headline writes its patient behind.
  const readsThroughOf = (word) => {
    const w = String(word ?? "").toLowerCase();
    return readsThroughCountOf(w) || OF_PARTITIVE_HEADS.has(w) || OF_CLASSIFIER_HEADS.has(w);
  };
  // Walk a found run's of-chain to the noun the phrase is really about, at most
  // two hops so a chain of prepositions can never wander into another clause.
  // `readsThrough` says which heads qualify; a head outside that set stops the
  // climb and keeps its own run.
  const ofChainEntityIndex = (at, readsThrough) => {
    for (let hop = 0; at !== null && hop < 2; hop += 1) {
      let hi = at;
      while (hi + 1 < values.length && isNounish(hi + 1)) hi += 1;
      if (values[hi + 1]?.toLowerCase() !== "of" || !readsThrough(values[hi])) break;
      const inner = nearestEntityIndex(hi + 1, +1);
      if (inner === null) break;
      at = inner;
    }
    return at;
  };
  const countChainEntityIndex = (idx, step) =>
    ofChainEntityIndex(nearestEntityIndex(idx, step, COPULA_FRAME_BLOCKERS), readsThroughOf);
  const countChainEntity = (idx, step) => {
    const at = countChainEntityIndex(idx, step);
    return at === null ? null : entityRunAt(at);
  };
  // The object a lexicon relation verb takes: the nearest run rightward, on the
  // arm's own blocker-free scan ("relies ON redis" has to read past the
  // preposition), then climbed through a counting of-chain so the fact lands on
  // what was counted rather than on the count word.
  const relationVerbObject = (i) => {
    const at = ofChainEntityIndex(nearestEntityIndex(i, +1), readsThroughCountOf);
    return at === null ? null : entityRunAt(at);
  };
  // The noun an event predicates about: the nearest run leftward, climbed out
  // of any preposition it is the object of, so a phrase-headed subject reads as
  // its own head rather than as the noun that happens to sit beside the verb.
  const newswireSubject = (idx) => {
    const at = countChainEntityIndex(idx, -1);
    if (at === null) return null;
    const climbed = climbSubjectRun(at);
    return climbed === null ? null : entityRunAt(climbed);
  };
  // The phrasal verb headed at `i`, when the closed table holds the pair: its
  // own minted predicate, and the particle's index, so an object scan reads
  // past the particle to what the event touched.
  const phrasalVerbAt = (i) => {
    const particle = stripSentenceFinalStop(String(values[i + 1] ?? "")).toLowerCase();
    if (!PHRASAL_PARTICLES.has(particle)) return null;
    const lemma = String(lemmas?.[i] ?? values[i]).toLowerCase();
    if (!PHRASAL_VERB_PAIRS.has(`${lemma} ${particle}`)) return null;
    return { predicate: `mgx:${lemma}-${particle}`, particleAt: i + 1 };
  };
  // The first token of the complement a verb takes, adverbs crossed. A passive
  // reads its own frame off this one word: "by" names the actor, a locative or
  // directional preposition names where the subject ended up.
  const complementHead = (i) => {
    for (let k = i + 1; k < values.length; k += 1) {
      if (pos[k] === "ADV") continue;
      return k;
    }
    return -1;
  };
  // Newswire writes the count before the thing counted — "killed more than 100
  // people", "injured at least 30 workers" — and the preposition inside the
  // count phrase stops an object scan dead. Each lead below is skipped whole,
  // and only where the number itself closes the phrase, so "attacked at dawn"
  // (no number, no count) is untouched.
  const skipCountPhrase = (idx) => {
    for (let n = COUNT_PHRASE_MAX_TOKENS; n >= 2; n -= 1) {
      const span = values.slice(idx + 1, idx + 1 + n);
      if (span.length === n && COUNT_PHRASE_RE.test(span.join(" "))) return idx + n;
    }
    return idx;
  };
  const readNewswireFrame = () => {
    for (let i = 1; i < values.length - 1; i += 1) {
      if (pos[i] !== "VERB") continue;
      const lemma = String(lemmas?.[i] ?? values[i]).toLowerCase();
      const phrasal = phrasalVerbAt(i);
      if (!phrasal) {
        if (lookupVerb(lexicon, String(values[i]).toLowerCase())) continue;
        if (!NEWSWIRE_RELATION_VERBS.has(lemma)) continue;
      }
      if (relativePronounBefore(i) >= 0) continue;
      const canonical = NEWSWIRE_VERB_SYNONYMS.get(lemma) || lemma;
      const declared = lookupVerb(lexicon, canonical);
      const predicate = phrasal
        ? phrasal.predicate
        : (declared ? predicateOf(declared) : `mgx:${canonical}`);
      const surface = stripSentenceFinalStop(String(values[i])).toLowerCase();
      // A phrasal verb's own complement starts past the particle, so the frame
      // below reads "was taken over BY Google" the same way it reads a bare
      // participle's "by".
      const head = complementHead(phrasal ? phrasal.particleAt : i);
      const headWord = head === -1 ? "" : String(values[head]).toLowerCase();
      const beAuxiliary = beAuxiliaryBefore(i);
      // A progressive is not an event that happened, and its -ing form is the
      // one thing that tells it apart from the past participle a passive takes.
      if (beAuxiliary && surface.endsWith("ing")) continue;
      // "<patient> (was) <participle> by <actor>" — the sentence names both
      // roles, so it mints the ACTIVE edge with the actor on the subject side.
      // A reduced passive carries no auxiliary at all ("Boats Hit by Mystery
      // Attackers"), so the "by" is what identifies the frame.
      if (headWord === "by") {
        const actor = countChainEntity(head, +1);
        const patient = newswireSubject(verbComplexStart(i));
        if (actor && patient) push(actor, predicate, patient);
        continue;
      }
      if (beAuxiliary) {
        // "<patient> is <participle> <prep> <complement>" — no actor is named,
        // so nothing can take the subject side of an active edge. The claim the
        // sentence DOES make is about the patient's own condition, and that is
        // what the participle predicate states. A phrasal pair already carries
        // its particle as that condition, and no second preposition can restate
        // it, so an agentless phrasal passive abstains.
        if (phrasal || !PASSIVE_STATE_PREPOSITIONS.has(headWord)) continue;
        const patient = newswireSubject(verbComplexStart(i));
        const complement = countChainEntity(head, +1);
        if (patient && complement) push(patient, `mgx:${surface}-${headWord}`, complement);
        continue;
      }
      const subject = newswireSubject(verbComplexStart(i));
      const object = countChainEntity(phrasal ? phrasal.particleAt : skipCountPhrase(i), +1);
      if (!subject || !object) continue;
      push(subject, predicate, object);
    }
  };

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
      if (phrasalVerbAt(i)) continue; // the phrasal frame reads the pair whole
      const relative = relativePronounBefore(i);
      if (relative >= 0 && relative - 1 !== copulaObjHi) {
        decline("relative-clause-verb", { subject: copulaSubject, predicate: predicateOf(verb), object: relationVerbObject(i) });
        continue;
      }
      const subject = relative >= 0 ? copulaSubject : climbedSubjectAt(i);
      if (subject === null) continue;
      push(subject, predicateOf(verb), relationVerbObject(i));
    }
    readNewswireFrame();
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
    if (phrasalVerbAt(i)) continue; // the phrasal frame reads the pair whole
    const subject = climbedSubjectAt(i);
    if (relativePronounBefore(i) >= 0) {
      decline("relative-clause-verb", { subject, predicate: predicateOf(verb), object: relationVerbObject(i) });
      continue;
    }
    if (subject === null) continue;
    push(subject, predicateOf(verb), relationVerbObject(i));
  }
  readNewswireFrame();
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
 * a copula (→ rdfs:subClassOf), past its object the relation verbs it grounds
 * (→ their predicates), and the closed newswire event band in its own tighter
 * frame, so one sentence contributes every fact it holds
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

// The verbs a report attributes a claim with. Closed and deliberately short:
// each of these carries the claim through unchanged, so the clause beside one
// is what the article states. Hedging and reversing verbs stay out — "denied",
// "alleged", "claimed" and "suggested" each change what the sentence says
// about the clause, and a frame that unwrapped them would store the opposite of
// the report.
const REPORTED_SPEECH_VERB_SRC = "said|says|told|reported|reports|announced|announces|stated|states|confirmed|confirms|added|wrote|writes";
// "<claim>, President Trump said." — the attribution rides the tail after a
// comma and closes the sentence. A closing quote mark may sit between them.
// Group 1 is the speaker.
const TRAILING_ATTRIBUTION_RE = new RegExp(
  `,\\s*["'“”‘’]?\\s*([\\w.'’-]+(?:\\s+[\\w.'’-]+){0,3})\\s+(?:${REPORTED_SPEECH_VERB_SRC})\\s*[.!?]?\\s*$`,
  "i",
);
// "President Trump said (that) <claim>", "Mr. Gilman's family had said <claim>"
// — the attribution leads and the claim is everything past it. Group 1 is the
// speaker, group 2 the claim.
const LEADING_ATTRIBUTION_RE = new RegExp(
  `^\\s*([\\w.'’-]+(?:\\s+[\\w.'’-]+){0,4})\\s+(?:has\\s+|had\\s+|have\\s+)?(?:${REPORTED_SPEECH_VERB_SRC})\\s+(?:that\\s+)?(\\S.*)$`,
  "i",
);

/**
 * The claim a sentence attributes to a speaker, and the speaker it names. A
 * report states most of what it knows this way, and the recognizer reading the
 * WHOLE sentence reads the attribution as the claim: "Officials said the quake
 * killed more than 100 people." came back as `officials mgx:say quake killed
 * more than 100 people`, a whole clause stored as a term. Stripping the
 * attribution leaves the claim the article is making, which is the thing worth
 * grounding.
 *
 * Returns { claim, speaker }. `speaker` is "" when no attribution frame fired,
 * or when the claim left behind is too short to be one — the sentence comes
 * back whole in that case, so there is nothing the speaker would hang off.
 * Where both frames fire ("Officials said X, police reported."), the LEADING
 * speaker wins: it is the one attached to the clause that survived.
 */
export function reportedClauseOf(sentence) {
  const text = String(sentence ?? "").trim();
  const trailing = TRAILING_ATTRIBUTION_RE.exec(text);
  const trailingStripped = trailing ? text.replace(TRAILING_ATTRIBUTION_RE, ".") : text;
  const leading = LEADING_ATTRIBUTION_RE.exec(trailingStripped);
  const claim = leading ? leading[2].trim() : trailingStripped;
  if (claim.split(/\s+/).length < 3) return { claim: text, speaker: "" };
  return { claim, speaker: (leading?.[1] ?? trailing?.[1] ?? "").trim() };
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
// A pronoun names nothing on its own — it points back at whatever the last
// clause named — so a multi-word term opening with one is a clause the split
// lost the subject of ("he's also destroyed the city's soul"), never a name. A
// one-word term is exempt for the same reason the particle rule exempts one:
// "us" is also how a headline writes the United States.
const PRONOUN_LEAD_WORDS = new Set([
  "i", "he", "she", "it", "we", "they", "you", "me", "him", "them", "us",
  "his", "her", "its", "their", "our", "your", "my",
]);
const CLITIC_SUFFIX_RE = /['’](?:s|re|ve|ll|d|m)$/;
// A term ending in a bare auxiliary is the front half of a clause the split cut
// ("rooms were"), never the whole of a name.
const TRAILING_AUXILIARY_WORDS = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had",
]);
// A compass word opening a place name is a modifier, not a clause lead —
// "north korea", "south sandwich islands". A tagger reading the LOWERCASED
// term has no capital left to tell the place from the direction and tags
// "north"/"south" as an adverb, so the POS rule below would turn every one of
// them down. Followed by "of" the word really is heading a prepositional
// phrase ("north of the border"), and that stays declined.
const COMPASS_LEAD_WORDS = new Set([
  "north", "south", "east", "west",
  "northeast", "northwest", "southeast", "southwest",
  "northern", "southern", "eastern", "western",
]);
// A name is one noun phrase. These words open a new phrase or a new clause, so
// a term carrying one BETWEEN its first and last word is a headline a frame
// tore into subject + predicate + remainder: "colombia as rescuers free quake
// victim", "keir starmer faces a vote", "new gun licenses after mass shooting",
// "boats hit by mystery attackers" — all four reach the graph as a card's own
// hub or object otherwise.
//
// "of" is deliberately absent: it is the one preposition real names are built
// with ("house of representatives", "united states of america", "isle of man").
// The rule reads STRICTLY interior positions for the same reason the lead and
// trailing rules read the edges separately — "may" and "will" end real surnames
// ("theresa may", "brian may") and open nothing there.
const INTERIOR_CLAUSE_WORDS = new Set([
  "a", "an", "the",
  "and", "or", "but", "because", "since", "although", "though", "whereas", "while", "so",
  "if", "when", "then", "however", "as", "that", "which", "who", "whom", "whose",
  "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had",
  "do", "does", "did", "can", "could", "will", "would", "should", "may", "might", "must",
  "in", "on", "at", "for", "to", "with", "from", "by", "into", "onto",
  "over", "under", "after", "before", "between", "during", "about", "near", "through",
  "against", "among", "within", "without", "per",
]);

// Past participles that open a real name. Read on the lowercased stored key,
// wink tags each of these VERB, so the POS rule below turns down "united
// states" — the name world news reports most often — and every sibling built
// the same way.
const PARTICIPIAL_NAME_LEAD_WORDS = new Set(["united", "allied", "combined", "armed", "organized", "associated"]);

// A term the source itself wrapped in quotation marks is a title it quoted, and
// a title is free to read as a clause — "Hackernews discusses \"Tim King,
// AmigaDOS developer, has died\"" states a true fact about a whole headline.
// The quotes are the tell, so they exempt the interior rule and nothing else.
const QUOTED_TERM_RE = /^["“'‘].*["”'’]$/;

/** Does `term` carry a clause- or phrase-opening word strictly between its
 *  first and last word? */
export function carriesInteriorClauseWord(words) {
  if (words.length >= 2 && QUOTED_TERM_RE.test(`${words[0]} ${words[words.length - 1]}`)) return false;
  for (let i = 1; i < words.length - 1; i += 1) {
    if (INTERIOR_CLAUSE_WORDS.has(String(words[i]).toLowerCase())) return true;
  }
  return false;
}

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
  if (PRONOUN_LEAD_WORDS.has(first.replace(CLITIC_SUFFIX_RE, ""))) return false;
  if (TRAILING_AUXILIARY_WORDS.has(words[words.length - 1].toLowerCase())) return false;
  if (carriesInteriorClauseWord(words)) return false;
  if (COMPASS_LEAD_WORDS.has(first) && words[1].toLowerCase() !== "of") return true;
  if (PARTICIPIAL_NAME_LEAD_WORDS.has(first)) return true;
  const engine = nlp === undefined ? winkInstance() : nlp;
  if (!engine) return true;
  try {
    const pos = engine.readDoc(text).tokens().out(engine.its.pos);
    if (pos.length && FRAGMENT_LEAD_TAGS.has(pos[0])) return false;
  } catch { /* an untaggable term falls back to the lexical rule above */ }
  return true;
}

const readsAsEntityFact = (fact, nlp) => readsAsEntityTerm(fact.subject, nlp) && readsAsEntityTerm(fact.object, nlp);

/** Did the frame that read this row cut a phrasal verb in half? "as prices
 *  surge and stocks sell out" names no object at all, so a row pairing the
 *  bare verb with its own particle ("stocks mgx:sell out") states nothing —
 *  the particle belongs to the verb. Read off the same closed pair table the
 *  optimistic tier reads a phrasal verb whole by, so only a particle that verb
 *  really takes declines the row. */
export function splitsPhrasalVerb(fact) {
  const particle = String(fact?.object ?? "").trim().toLowerCase();
  if (!PHRASAL_PARTICLES.has(particle)) return false;
  const surface = String(fact?.predicate ?? "").split(":").pop().toLowerCase();
  return PHRASAL_VERB_PAIRS.has(`${surface} ${particle}`)
    || PHRASAL_VERB_PAIRS.has(`${baseVerbSurface(surface)} ${particle}`);
}

/** Why a candidate row is turned down, or null when it stands: the phrasal
 *  split first (it names the row's real problem), then the entity-term rule. */
const declineFindingFor = (fact, nlp) => {
  if (splitsPhrasalVerb(fact)) return "phrasal-particle";
  return readsAsEntityFact(fact, nlp) ? null : "fragment-term";
};

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

const REPORTED_SPEECH_FINDING = "reported-speech";
const ATTRIBUTED_TO_PREDICATE = "mgx:attributedTo";

/** The reified attribution beside a claim row: `fact:<claimHash> |
 *  mgx:attributedTo | <speaker>`. A fact is content-addressed by its own
 *  triple, so naming the claim's group id costs no read back. Null when the
 *  sentence attributed nothing. */
function attributionRowFor(fact, { speaker, tag, observedAt }) {
  if (!speaker) return null;
  return {
    subject: factIdForTriple(fact.subject, fact.predicate, fact.object),
    predicate: ATTRIBUTED_TO_PREDICATE,
    object: speaker,
    provenance: tag,
    observedAt,
  };
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
 * A sentence that attributes its claim to a speaker is handed to the recognizer
 * as the claim alone (`reportedClauseOf`); the ungrounded-term scan still reads
 * the sentence as written, so the speaker keeps reaching the enrichment queue.
 * Under `findings` the speaker is also stored, twice over: the claim carries the
 * `reported-speech` finding, and a reified `fact:<claimId> | mgx:attributedTo |
 * <speaker>` row goes into the same batch. The finding is the half that must
 * survive — a reader that loses the attribution still sees the claim say which
 * reading it came from, so the two are written together or not at all.
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
 *                 declined, attach the kept findings (`identifier-token`,
 *                 `clause-fallback`, `pronoun-carry`, `definitional-frame`,
 *                 `reported-speech`) to the assertions this call writes, and
 *                 write the attribution row beside each reported-speech claim.
 *                 Off by default; the declines themselves are reported either
 *                 way.
 *
 * Returns { sentences, recognized, extracted, optimistic, attributions, skipped,
 * declined, minted, canonical? }.
 *   recognized — strict-recognized sentence count.
 *   extracted  — strict fact rows ({subject, predicate, object, provenance,
 *                quantifier, sentence}), plus `extraction` when the row was
 *                stored carrying findings.
 *   optimistic — fuzzy candidate rows ({subject, predicate, object, provenance,
 *                sentence}, same optional `extraction`); always [] unless
 *                options.optimistic.
 *   attributions
 *              — the attribution rows written beside the two arrays above, in
 *                the same shape. Reported apart from them because they are not
 *                facts the article stated, so nothing counting what an article
 *                taught should count them.
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
  // The reified attributions written beside the claim rows above. Kept out of
  // `extracted`/`optimistic` on purpose: those two arrays are what the article
  // stated, and they feed a snapshot's fact ids and the bench's own score. An
  // attribution says who said one of them, which is not another fact the
  // article stated.
  const attributions = [];
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
    const kept = fresh.filter((row) => !declineFindingFor(row, termNlp));
    if (kept.length !== fresh.length) {
      for (const row of fresh) {
        if (kept.includes(row)) continue;
        declined.push({
          sentence: currentSentence,
          finding: declineFindingFor(row, termNlp),
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
        const asWritten = stripCitationResidue(sentence);
        // The ungrounded-term scan reads the sentence AS WRITTEN, so a speaker
        // the article named still reaches the enrichment queue; only the
        // recognizer reads the claim on its own.
        cleanedSentences.push(asWritten);
        const { claim: cleaned, speaker } = reportedClauseOf(asWritten);
        // The stored term keys this sentence names with an identifier-shaped
        // token, read off the surface before normFactTerm folds the shape away.
        // Null when this run records no findings.
        const identifierTerms = findings ? identifierTermsIn(cleaned) : null;
        // The finding every row off this sentence carries, and the speaker each
        // one is attributed to. Both halves ride the same switch: the finding is
        // what a reader falls back on when the attribution is gone, so writing
        // one without the other would invert the fallback.
        const attributedTo = identifierTerms && speaker ? speaker : "";
        const speechFindings = attributedTo ? [REPORTED_SPEECH_FINDING] : [];
        // How the strict tier reached its rows, when it did: the whole sentence
        // carries nothing, a later candidate is a clause fragment, and the
        // pronoun retry carried its subject in from an earlier sentence.
        let readingFindings = [...speechFindings];
        // Whole sentence first, then each closed-marker clause as a fallback.
        let rows = null;
        const candidates = clauseCandidates(cleaned, { nlp });
        for (let i = 0; i < candidates.length; i += 1) {
          rows = await strictRows(candidates[i]);
          if (!rows) continue;
          if (i > 0) readingFindings = [...speechFindings, "clause-fallback"];
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
          if (rows) readingFindings = [...speechFindings, "pronoun-carry"];
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
            const attribution = attributionRowFor(row, { speaker: attributedTo, tag, observedAt });
            if (attribution) { writes.push(attribution); attributions.push({ ...attribution, sentence }); }
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
          const finding = declineFindingFor(t, termNlp);
          if (finding) declined.push({ sentence, finding, candidate: t });
          else keptCandidates.push(t);
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
          const mintFinding = mintFindings.has(t) ? [mintFindings.get(t)] : [];
          const extraction = findingsForRow(t, [...speechFindings, ...mintFinding], identifierTerms);
          candidateWrites.push({
            subject: t.subject, predicate: t.predicate, object: t.object, provenance: tag, observedAt,
            ...(extraction.length ? { extraction } : {}),
          });
          optimisticFacts.push({ ...t, provenance: tag, sentence, ...(extraction.length ? { extraction } : {}) });
          const attribution = attributionRowFor(t, { speaker: attributedTo, tag, observedAt });
          if (attribution) { candidateWrites.push(attribution); attributions.push({ ...attribution, sentence }); }
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
    // A decline names the word it tripped over, so the legacy set carries name
    // fragments too ("Gilman" out of "Robert Gilman"). Same fold, same reason.
    foldNameFragments(ungroundedCounts);

    const result = {
      sentences: sentenceCount,
      recognized: recognizedSentences,
      extracted,
      optimistic: optimisticFacts,
      attributions,
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
