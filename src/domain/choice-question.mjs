// choice-question.mjs — splits a closed multiple-choice question into its
// stem and its options. Pure, closed-set, no graph and no store: the same
// house style as ask-vocab.mjs's phrasing tables, not a general parser.
//
// Two shapes. Inline ("is a whale a fish or a mammal") is recognized by a
// small set of hand-authored sentence templates, tried most-specific-first
// so a relational source clause ("the capital of france") never gets read
// as a one-word source with the wrong option boundary. Enumerated ("A) ...
// B) ...") is recognized structurally: either explicit A/B/C labels in
// strict sequence, or — when no labels are found — a stem line followed by
// two or more bare option lines.
//
// The write-boundary brief this module exists for: "every pet is a cat or
// a dog" must keep teaching, never be swallowed as a choice question. That
// case (and the rest of the negative set) is handled by requiring an
// interrogative lead — reusing leadsInterrogative/QUESTION_LEAD_RE rather
// than inventing a second notion of "looks like a question" — plus a guard
// that declines whenever a candidate option itself reads as a second,
// embedded question ("is it a bird or is it a plane").
import { leadsInterrogative, QUESTION_LEAD_RE } from "./interpret/normalize.mjs";

/** The recognized shapes. Frozen so a caller can switch on the value
 *  without inventing its own string. */
export const CHOICE_SHAPES = Object.freeze({ inline: "inline", enumerated: "enumerated" });

/** Minimum and maximum alternatives a choice question may carry. Two is the
 *  smallest set that is a choice at all. Six is one above CommonsenseQA's
 *  five, which leaves the fixture room and still keeps the refusal list short
 *  enough to read in one line. A longer list is a set question, which the ask
 *  engine already answers, so the lane declines and falls through. */
export const CHOICE_MIN_OPTIONS = 2;
export const CHOICE_MAX_OPTIONS = 6;

const NEGATION_TAIL_WORDS = new Set(["not", "never", "no"]);
const PREP_WORDS = new Set(["in", "on", "at", "for", "with", "from", "of", "into", "onto"]);

const stripLeadingArticle = (phrase) => phrase.replace(/^(?:an?|the)\s+/i, "").trim();

function stripTrailingPreposition(phrase) {
  const words = phrase.trim().split(/\s+/);
  if (words.length > 1 && PREP_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(" ");
}

function normalizeOptionText(text) {
  return String(text).toLowerCase().replace(/[^\w\s'-]/g, "").replace(/\s+/g, " ").trim();
}

// ---- the "or"-list splitter — the machinery this module adds, cited in the
// design survey as absent everywhere else under src/domain/ ----

/** Splits an option-list tail ("a fish or a mammal", "paris, lyon or
 *  marseille") on its final standalone "or", then the comma-separated
 *  options ahead of it. Returns an ordered array of option text, or null
 *  when no standalone "or" is present at all — the signal a caller reads as
 *  "this was not an alternation". */
function splitOrList(text) {
  const cleaned = String(text).replace(/[?.!]+\s*$/, "").trim();
  const orRe = /\bor\b/gi;
  let lastIndex = -1;
  let lastLength = 0;
  let match;
  while ((match = orRe.exec(cleaned))) {
    lastIndex = match.index;
    lastLength = match[0].length;
  }
  if (lastIndex === -1) return null;
  const before = cleaned.slice(0, lastIndex).trim().replace(/,\s*$/, "");
  const last = cleaned.slice(lastIndex + lastLength).trim();
  if (!before || !last) return null;
  const earlier = before.split(",").map((s) => s.trim()).filter(Boolean);
  return [...earlier, last];
}

// ---- shape A: natural inline phrasing ----
//
// Tried in this order deliberately: the comma-anchored and "of"-clause
// templates are more specific than the bare "is/are <source> <options>"
// template, which would otherwise shadow them (its source-clause capture is
// happy to stop after one word, so "is the capital of france ..." would
// mis-split into source "the capital" and a leading option "of france ...").

const INLINE_TEMPLATES = [
  // "which is <source clause>, <option list>?" — the one inline shape with
  // an explicit comma boundary between the source clause and its options.
  {
    re: /^which\s+is\s+((?:an?|the)\s+[a-z][\w'-]*(?:\s+[a-z][\w'-]*)?),\s*(.+?)[?.!]*$/i,
    build: (m) => ({
      stem: `which is ${m[1].trim()}?`,
      optionsText: m[2],
      sourceTerm: stripTrailingPreposition(stripLeadingArticle(m[1].trim())),
    }),
  },
  // "does/do/did <source clause> <verb preposition> <option list>?" — the
  // verb phrase is closed to a bare verb plus one of a curated preposition
  // set, never a general parse of the predicate.
  {
    re: /^(does|do|did)\s+((?:an?|the)\s+[a-z][\w'-]*)\s+([a-z]+\s+(?:in|on|at|of|with|for|from))\s+(.+?)[?.!]*$/i,
    build: (m) => ({
      stem: `${m[1].toLowerCase()} ${m[2].trim()} ${m[3].trim()}?`,
      optionsText: m[4],
      sourceTerm: stripLeadingArticle(m[2].trim()),
    }),
  },
  // "is <the X of Y> <option list>?" — a relational source clause with its
  // own internal "of", so the option list needs no linking word to start.
  {
    re: /^is\s+(the\s+[a-z][\w'-]*\s+of\s+[a-z][\w'-]*)\s+(.+?)[?.!]*$/i,
    build: (m) => ({
      stem: `is ${m[1].trim()}?`,
      optionsText: m[2],
      sourceTerm: stripLeadingArticle(m[1].trim()),
    }),
  },
  // "is/are/was/were <a/the source> <option list>?" — the bare-juxtaposition
  // form, tried last because it is the most general "is"-lead shape.
  {
    re: /^(is|are|was|were)\s+((?:an?|the)\s+[a-z][\w'-]*)\s+(.+?)[?.!]*$/i,
    build: (m) => ({
      stem: `${m[1].toLowerCase()} ${m[2].trim()}?`,
      optionsText: m[3],
      sourceTerm: stripLeadingArticle(m[2].trim()),
    }),
  },
];

/** Tries each inline template in order. Returns null when no template's
 *  sentence shape matches at all. When a template's shape matches but its
 *  option-list tail has no standalone "or" ("is a whale a fish?"), returns
 *  { stem, options: null, sourceTerm } — recognized shape, no alternation —
 *  so the caller can report that precisely rather than trying every other
 *  template in turn. */
function parseInline(text) {
  for (const template of INLINE_TEMPLATES) {
    const m = template.re.exec(text);
    if (!m) continue;
    const built = template.build(m);
    const rawOptions = splitOrList(built.optionsText);
    if (!rawOptions) return { stem: built.stem, options: null, sourceTerm: built.sourceTerm };
    const options = rawOptions.map((t, i) => ({ label: String(i + 1), text: t }));
    return { stem: built.stem, options, sourceTerm: built.sourceTerm };
  }
  return null;
}

// ---- shape B: enumerated options ----

// A label marker is "(A)", "A)", "A.", or "A:" — any letter, so a run past
// CHOICE_MAX_OPTIONS (an eight-option "A) ... H) ...") is still recognized
// as enumerated and declines on the option count, rather than the marker
// regex itself silently stopping short and truncating the list.
const LABEL_MARKER_RE = /\(([A-Za-z])\)|\b([A-Za-z])[.):]/g;

/** The longest run of label markers found in strict A, B, C, ... sequence.
 *  A marker that does not match the next expected letter is skipped rather
 *  than resetting the search, so one stray match elsewhere in the stem
 *  cannot break a real label sequence that follows it. */
function findAcceptedLabelSequence(text) {
  const accepted = [];
  let expected = 0;
  LABEL_MARKER_RE.lastIndex = 0;
  let m;
  while ((m = LABEL_MARKER_RE.exec(text))) {
    const letter = (m[1] || m[2]).toUpperCase();
    if (letter === String.fromCharCode(65 + expected)) {
      accepted.push({ letter, start: m.index, end: LABEL_MARKER_RE.lastIndex });
      expected += 1;
    }
  }
  return accepted;
}

// ---- stem source-term extraction ----
//
// A closed set of sentence templates, tried in order, each reading only the
// stem text — never a fixture's own question_concept, which the real lane
// never sees either. Every template ends the same way: hand the text after
// its cue word to captureStemNounPhrase, which trims determiners, pronouns
// and clause boundaries down to a short noun phrase. Anything no template
// matches yields "", which the contract states is a valid outcome, not a
// failure.

// Determiners and possessives stripped off the front of a captured phrase —
// closed classes, not open vocabulary.
const LEADING_DETERMINER_RE = /^(?:an?|the|some|any|few|many|several|more|most|my|your|his|its|our|their)\s+/i;

// Pronouns that can open a captured phrase but never name a source term —
// "where are you" and "what should he use" have no noun there to read.
const PRONOUN_TERMS = new Set([
  "you", "i", "it", "he", "she", "they", "we", "there", "someone",
  "something", "one", "him", "her", "them", "who",
  "himself", "herself", "itself", "themselves", "myself", "yourself",
]);

// Words that end a captured phrase rather than folding into it: the closed
// prepositions this module already uses elsewhere (PREP_WORDS), plus the
// conjunctions, clause-openers and auxiliary/modal verbs that mark a clause
// boundary in the sentence shapes CommonsenseQA's stems actually use.
const PHRASE_BOUNDARY_WORDS = new Set([
  ...PREP_WORDS, "to", "behind", "before", "near", "next",
  "along", "alongside", "under", "over", "between", "among", "during",
  "without", "about", "by", "as", "like",
  "that", "if", "when", "while", "being", "because", "since", "until",
  "so", "and", "but", "or",
  "immediately", "likely", "usually", "normally", "currently",
  "is", "are", "was", "were", "do", "does", "did",
  "has", "have", "had", "will", "would", "could", "should", "might", "must", "can",
]);

/** Reads a short noun phrase (at most three words) off the front of `words`,
 *  stopping at the first phrase-boundary word. A possessive ("restaurant's")
 *  ends the phrase right after the word it marks, its "'s" dropped — the
 *  next word belongs to a different noun ("restaurant's phone number" reads
 *  as "restaurant", not the number). */
function readStemNounPhrase(words) {
  const out = [];
  for (const word of words) {
    if (out.length >= 3 || PHRASE_BOUNDARY_WORDS.has(word)) break;
    const possessive = word.endsWith("'s");
    out.push(possessive ? word.slice(0, -2) : word);
    if (possessive) break;
  }
  return out.join(" ");
}

/** Strips a leading determiner, then reads a noun phrase — "" when the
 *  phrase would open on a pronoun or a boundary word, since neither ever
 *  names a source term. Stops at the first comma, so an option-like list
 *  ("a magazine, paper or gum") reads only its first member. */
function captureStemNounPhrase(tailText) {
  const [beforeComma] = String(tailText).split(",", 1);
  const stripped = beforeComma.replace(LEADING_DETERMINER_RE, "");
  const words = stripped.trim().toLowerCase().split(/[^a-z'-]+/).filter(Boolean);
  if (words.length === 0 || PRONOUN_TERMS.has(words[0]) || PHRASE_BOUNDARY_WORDS.has(words[0])) return "";
  return readStemNounPhrase(words);
}

// "where would you find/see/keep/put/store/place/buy/get/locate/hide/wear/
// carry/use/take/open/cross X" — the placement and possession verbs whose
// direct object is the term the question is about. Not anchored to "where":
// the same object slot holds the source term in "what would you put X into"
// too, and the verb match already carries the whole signal.
const PLACEMENT_VERB_RE = /\b(?:find|found|see|keep|put|store|place|buy|get|locate|hide|wear|carry|use|take|open|cross)\s+(.+)$/i;
const placementVerbSourceTerm = (stem) => {
  const m = PLACEMENT_VERB_RE.exec(stem);
  return m ? captureStemNounPhrase(m[1]) : "";
};

// "what do/does/did <subject> do/use/need/require" — the do-support shape
// CommonsenseQA's "what"-led stems lean on most: the subject sits between
// the auxiliary and the closing verb.
const WHAT_DO_SUBJECT_RE = /\bwhat\s+(?:do|does|did)\s+(.+?)\s+(?:primarily\s+)?(?:do|does|did|use|need|require)\b/i;
const whatDoSubjectSourceTerm = (stem) => {
  const m = WHAT_DO_SUBJECT_RE.exec(stem);
  return m ? captureStemNounPhrase(m[1]) : "";
};

// "what uses/needs/requires/has/holds/contains/involves X" — the shape
// where "what" is itself the subject and the source term is the verb's
// direct object instead.
const WHAT_VERB_OBJECT_RE = /^what\s+(?:uses|needs|requires|has|holds|contains|involves)\s+(.+)$/i;
const whatVerbObjectSourceTerm = (stem) => {
  const m = WHAT_VERB_OBJECT_RE.exec(stem);
  return m ? captureStemNounPhrase(m[1]) : "";
};

// "where is/are/was/were X" — the copula shape ("where is a doormat likely
// to be") that PLACEMENT_VERB_RE's action verbs never match.
const WHERE_COPULA_RE = /\bwhere\s+(?:is|are|was|were)\s+(.+)$/i;
const whereCopulaSourceTerm = (stem) => {
  const m = WHERE_COPULA_RE.exec(stem);
  return m ? captureStemNounPhrase(m[1]) : "";
};

// "... of the/a X?" at the very end of the stem — "what is the habitat of
// the fox?" names its term in a trailing relational clause, not its subject.
const TRAILING_OF_CLAUSE_RE = /\bof\s+(?:an?|the)\s+([a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,2})\s*\??\s*$/i;
const trailingOfClauseSourceTerm = (stem) => {
  const m = TRAILING_OF_CLAUSE_RE.exec(stem);
  return m ? captureStemNounPhrase(m[1]) : "";
};

// "... want(s/ed/ing) to <verb> [object]" — the desire-cue stems. The object
// grounds better than the bare verb when there is one ("want to open a
// steakhouse" -> "steakhouse"); the verb itself is the fallback for an
// intransitive want with nothing following it ("want to smoke?" -> "smoke").
const WANT_TO_RE = /\bwant(?:s|ed|ing)?\s+to\s+([a-z][\w'-]*)\b(.*)$/i;
const wantToSourceTerm = (stem) => {
  const m = WANT_TO_RE.exec(stem);
  if (!m) return "";
  return captureStemNounPhrase(m[2]) || m[1].toLowerCase();
};

// Note: a leading "A/An/The <subject> ..." shape is not among these
// templates. coreParse gates every input on leadsInterrogative before this
// module ever runs, and that gate's QUESTION_LEAD_RE never accepts a line
// starting with a determiner — so a stem in that shape is declined before
// reaching extractStemSourceTerm, and a template for it would never fire.
function extractStemSourceTerm(stem) {
  return (
    placementVerbSourceTerm(stem)
    || whatDoSubjectSourceTerm(stem)
    || whatVerbObjectSourceTerm(stem)
    || whereCopulaSourceTerm(stem)
    || trailingOfClauseSourceTerm(stem)
    || wantToSourceTerm(stem)
  );
}

function parseLabelledEnumerated(text) {
  const accepted = findAcceptedLabelSequence(text);
  if (accepted.length < 1) return null;
  const stem = text.slice(0, accepted[0].start).trim();
  if (!stem) return null;
  const options = accepted.map((marker, i) => {
    const end = i + 1 < accepted.length ? accepted[i + 1].start : text.length;
    return { label: marker.letter, text: text.slice(marker.end, end).trim() };
  });
  return { stem, options, sourceTerm: extractStemSourceTerm(stem) };
}

/** The unlabelled fallback: a stem line followed by two or more option
 *  lines, one per line, no markers at all. */
function parseBareNewlineEnumerated(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const [stem, ...optionLines] = lines;
  const options = optionLines.map((line, i) => ({ label: String.fromCharCode(65 + i), text: line }));
  return { stem, options, sourceTerm: extractStemSourceTerm(stem) };
}

const parseEnumerated = (text) => parseLabelledEnumerated(text) ?? parseBareNewlineEnumerated(text);

// ---- shared finalization ----

function finalize(shape, stem, rawOptions, sourceTerm) {
  if (!rawOptions) return { result: null, reason: "no-alternation" };
  const options = rawOptions.map((o) => ({
    label: o.label,
    text: o.text.trim(),
    normalized: normalizeOptionText(o.text),
  }));

  if (options.some((o) => !o.text)) return { result: null, reason: "option-empty" };
  // An option that itself opens like a question is a second, separate
  // question riding along ("is it a bird or is it a plane"), not a real
  // alternative — decline rather than misread the pair as one choice.
  if (options.some((o) => QUESTION_LEAD_RE.test(o.text))) return { result: null, reason: "no-alternation" };
  // "or not" is a negated tail on a polar question, not a second option.
  if (options.some((o) => NEGATION_TAIL_WORDS.has(o.normalized))) return { result: null, reason: "no-alternation" };
  if (options.length < CHOICE_MIN_OPTIONS) return { result: null, reason: "too-few-options" };
  if (options.length > CHOICE_MAX_OPTIONS) return { result: null, reason: "too-many-options" };

  const seen = new Set();
  for (const o of options) {
    if (seen.has(o.normalized)) return { result: null, reason: "duplicate-options" };
    seen.add(o.normalized);
  }

  return { result: { shape, stem, options, sourceTerm }, reason: "" };
}

function coreParse(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || !leadsInterrogative(trimmed)) return { result: null, reason: "not-a-question" };

  const enumerated = parseEnumerated(trimmed);
  if (enumerated) return finalize(CHOICE_SHAPES.enumerated, enumerated.stem, enumerated.options, enumerated.sourceTerm);

  const inline = parseInline(trimmed);
  if (inline) return finalize(CHOICE_SHAPES.inline, inline.stem, inline.options, inline.sourceTerm);

  return { result: null, reason: "no-alternation" };
}

/**
 * Splits a closed multiple-choice question into its stem and its options.
 * Returns null for anything that is not one, which is the fall-through
 * signal every caller relies on.
 *
 * @param {string} text
 * @returns {null | {
 *   shape: "inline" | "enumerated",
 *   stem: string,
 *   options: Array<{ label: string, text: string, normalized: string }>,
 *   sourceTerm: string,
 * }}
 */
export function splitChoiceQuestion(text) {
  return coreParse(text).result;
}

/** True when `text` reads as a choice question. Sugar over splitChoiceQuestion
 *  for a recognizer that does not need the parts. */
export function isChoiceQuestion(text) {
  return coreParse(text).result !== null;
}

/** The reason splitChoiceQuestion declined, for a trace note. One of:
 *  "not-a-question", "no-alternation", "too-few-options", "too-many-options",
 *  "duplicate-options", "option-empty". Returns "" when it did not decline. */
export function choiceDeclineReason(text) {
  return coreParse(text).reason;
}
