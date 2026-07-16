// interpret/normalize.mjs — the input-normalization pass and shared text-prep
// helpers every interpretation strategy reads: contractions expanded,
// curated misspelling/wrong-word corrections applied, g-dropped words
// restored, filler/politeness stripped, then a small closed set of
// rhetorical frames rewritten to the canonical form of the same question.
// Pure, deterministic, idempotent.

import {
  CONTRACTIONS, MISSPELLINGS, WRONG_WORDS, G_DROP, FILLER_WORDS,
  NEGATION_FRAMES, COMMIT_CONTENT_FRAMES, VERB_TO_KIND, ENTITY_TO_TYPE,
  TRAILING_SCOPE_FILLER, TRAILING_TEMPORAL_ADVERBS,
} from "../ask-vocab.mjs";

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- normalization — runs before EITHER parsing strategy sees the text ----

/** contraction/informal-spelling table -> word-boundary regex, longest phrase
 *  first (so "there's" doesn't get shadowed by a shorter overlapping entry). */
const tableRe = (table) => new RegExp(
  "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
  "gi",
);
const CONTRACTION_RE = tableRe(CONTRACTIONS);
// Misspelling/wrong-word corrections (ask-vocab.mjs). The trailing lookahead
// refuses a word glued to a dotted extension, since WRONG_WORDS entries are
// real words that can also name a module ("revision.mjs").
const correctionRe = (table) => new RegExp(
  "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b(?!\\.[a-z0-9])",
  "gi",
);
const MISSPELLING_RE = correctionRe(MISSPELLINGS);
const WRONG_WORD_RE = correctionRe(WRONG_WORDS);

// Two typo sub-cases that can't live in the MISSPELLINGS/WRONG_WORDS tables:
// "w/" has no word boundary for correctionRe() to anchor on, and "with"/"for"
// aren't grammar-owned vocabulary words.

/** "w/" -> "with", not "w/o" ("without") or a path fragment ("src/w/foo.mjs"). */
const W_SLASH_RE = /(?<=^|\s)w\/(?=\s|$)/gi;

/** Leetspeak "4" -> "for", narrowed to two closed trigger shapes (a gratitude
 *  interjection before it, or the "4 example/instance" idiom) so it never
 *  touches a genuine count ("wait 4 minutes", "commit 4a2b…"). */
const FOR_DIGIT_THANKS_RE = /\b(thx|thanks|thank\s+you|many\s+thanks|ty|cheers)\s+4\b/gi;
const FOR_DIGIT_EXAMPLE_RE = /\b4\s+(example|instance)\b(?!\s*[a-z])/gi;

/** "that class"/"this module" (context pronoun + the singular kind noun it
 *  already stands in for) -> the bare pronoun, so both parse strategies agree
 *  on one span instead of disagreeing into a false {ambiguousParse}. Plurals
 *  are left alone (never real anaphora); "one" already has its own
 *  CONTEXT_PRONOUNS entry. */
const KIND_NOUN_ANAPHORA_RE = /\b(this|that)\s+(class|module|function|method|attribute|variable|file|commit)\b/gi;

/** Read-only probe: the ENTITY_TO_TYPE class named by a KIND_NOUN_ANAPHORA_RE
 *  match, or null. Lets a caller (chat.mjs's pronoun-reuse site) recover the
 *  kind the pronoun stood for without mutating normalizeQuery's own path. */
export function kindNounAnaphoraHint(text) {
  const m = new RegExp(KIND_NOUN_ANAPHORA_RE.source, "i").exec(String(text || ""));
  return m ? (ENTITY_TO_TYPE[m[2].toLowerCase()] || null) : null;
}

// Every relation verb phrase, as one longest-first alternation — feeds the
// DOES-X-VERB-ANYTHING-ELSE frame below without hardcoding a parallel list.
const VERB_ALTERNATION = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");

/** Just the MISSPELLINGS correction, standalone, for a caller with its own
 *  anchor regex that wants typo tolerance without normalizeQuery's more
 *  invasive rewrites (frame rewrites can restructure the sentence in ways a
 *  shape-matcher doesn't expect). */
export function correctMisspellings(text) {
  return String(text || "").replace(MISSPELLING_RE, (m) => MISSPELLINGS[m.toLowerCase()]);
}

const FILLER_RE = FILLER_WORDS.length
  ? new RegExp(
      "\\b(" + [...FILLER_WORDS].sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b\\s*,?",
      "gi",
    )
  : null;

/** Just the filler/politeness-word strip, standalone, for a caller that wants
 *  filler cleared without normalizeQuery's more invasive rewrites. A comma
 *  trailing a stripped filler word is swallowed with it, so it never survives
 *  as debris that defeats a `^`-anchored template downstream. */
export function stripFillerWords(text) {
  let q = String(text || "");
  if (FILLER_RE) q = q.replace(FILLER_RE, " ");
  return q.replace(/\s+/g, " ").trim();
}

// ---- closed PREAMBLE frames: conversational wrapping around a real question
// (greeting/thanks lead-ins, modal politeness, show/give-me). Delimiter- and
// phrase-anchored, so they run before the filler strip erases their anchor
// words; applied to a small fixpoint. Unmatched text passes through unchanged.

/** Any relation verb phrase — the show/give-me bridge's "is the remainder a
 *  real relation query" probe. */
const RELATION_VERB_RE = new RegExp(
  "\\b(?:" + Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
  "i",
);
/** A remainder that opens interrogatively is already a question — unwrap it. */
const INTERROGATIVE_LEAD_RE = /^(?:which|what|who|whose|where|when|why|how)\b/i;
/** A remainder that is a KIND listing ("show me [the] untested modules", "show
 *  me the tests") already belongs to the compositional list/qualifier grammar,
 *  whose LIST_TRIGGERS include "show me"/"give me" — leave the WHOLE text
 *  untouched so that working path keeps it. Two shapes: a plural kind noun in
 *  tail position, or a bare (det +) singular kind noun and nothing else. */
const LISTING_TAIL_KINDS = new Set([
  "modules", "files", "functions", "methods", "classes", "attributes", "fields",
  "properties", "variables", "globals", "commits", "changes", "tests", "members",
]);
const BARE_KIND_RE = /^(?:all\s+|the\s+)?(?:module|file|function|method|class|attribute|field|property|variable|global|commit|change|test|member)\??$/i;
const isListingRemainder = (rest) => {
  if (BARE_KIND_RE.test(rest)) return true;
  const words = rest.replace(/\?+\s*$/, "").trim().split(/\s+/);
  return LISTING_TAIL_KINDS.has((words[words.length - 1] || "").toLowerCase());
};

/** Greeting lead-in with a delimiter (+ optional "quick question" bridge):
 *  "hey there, quick question - <Q>" -> "<Q>". Delimiter and non-empty
 *  remainder are both required, so a bare greeting stays small-talk. */
const GREETING_PREAMBLE_RE = /^(?:hi|hiya|hello|hey|yo|howdy|g'?day|yeah\s+nah|good\s+(?:morning|afternoon|evening|day)|greetings|salutations)(?:\s+(?:there|pardner|folks|friend|mate))?\s*[,.—–-]\s*(?:(?:just\s+a\s+)?quick\s+question\s*[,:—–-]?\s*)?(.+)$/i;
/** Thanks lead-in with a delimiter, the sibling of GREETING_PREAMBLE_RE for
 *  the "thanks" word family: "thanks so much, <Q>" -> "<Q>". */
const THANKS_PREAMBLE_RE = /^(?:thanks|thank\s+you|many\s+thanks|thx|ty|cheers)(?:\s+(?:so\s+much|a\s+lot|very\s+much|a\s+bunch))?\s*[,—–-]\s*(?:(?:just\s+a\s+)?quick\s+question\s*[,:—–-]?\s*)?(.+)$/i;
/** Acknowledgement lead-in with a delimiter ("ok cool, <Q>"), repeating (`+`)
 *  so a stack of ack-words peels in one pass. */
const ACK_PREAMBLE_RE = /^(?:(?:ok(?:ay)?|aight|cool|alright|sure|right|fine|great|nice|got it|gotcha|sounds good|no worries|no problem)[\s,]+)+(.+)$/i;
/** Self-orientation lead-in with a delimiter — "just poking around, <Q>",
 *  "first time using this, <Q>". */
const BROWSING_PREAMBLE_RE = /^(?:just\s+(?:poking\s+around|looking\s+around|browsing|exploring|checking\s+(?:this|it)\s+out)|first\s+time\s+(?:trying\s+this\s+out|using\s+this|here))\s*[,.—–-]\s*(.+)$/i;
/** Repeated leading hedge adverb before a polite request verb ("maybe
 *  possibly tell me <Q>"). No delimiter required, unlike ACK_PREAMBLE_RE. */
const HEDGE_ADVERB_PREAMBLE_RE = /^(?:(?:maybe|possibly|perhaps)\s+)+(.+)$/i;
/** A floating "if it's not too much trouble" aside — a mid-sentence
 *  parenthetical, stripped wherever it appears (not start-anchored). */
const TROUBLE_ASIDE_RE = /,?\s*if\s+(?:it'?s|it\s+is|that'?s|that\s+is)\s+not\s+too\s+much\s+(?:trouble|bother|hassle)\s*,?\s*/i;
/** Modal politeness wrapper: "can/could/would/will you [please] <Q>" -> "<Q>". */
const MODAL_WRAPPER_RE = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(.+?)(?:[,\s]+please)?\??$/i;
/** "explain [to me|please]* <Q>" -> "<Q>", gated on an interrogative
 *  remainder so it only unwraps a real WH-question underneath. */
const EXPLAIN_WRAPPER_RE = /^explain\s+(?:to\s+me\s+|please\s+)*(.+?)\??$/i;
/** "tell me <Q>" (bare, no "about") -> "<Q>"; "tell me about X" is a
 *  different, untouched territory (chat.mjs's vagueTouchTermOf). */
const TELL_ME_WRAPPER_RE = /^tell\s+me\s+(.+?)\??$/i;
/** "do you know <Q>" -> "<Q>", gated on an interrogative remainder — so
 *  "do you know anything about movies" (small-talk, no embedded question)
 *  passes through untouched. */
const KNOW_WRAPPER_RE = /^do\s+you\s+know\s+(.+?)\??$/i;
/** "i'd like to know <Q>" / "i want to know <Q>" -> "<Q>", same
 *  interrogative-remainder gate as KNOW_WRAPPER_RE. */
const WANT_KNOW_WRAPPER_RE = /^i(?:'d|\s+would)?\s+(?:like|want|need)\s+to\s+know\s+(.+?)\??$/i;
/** EMBEDDED-QUESTION DE-INVERSION: the wrappers above unwrap "could you
 *  tell me what a dog is" down to the embedded clause "what a dog is",
 *  which keeps declarative word order — nothing downstream parses it. Fold
 *  it back to the direct question the meta lane already owns. Deliberately
 *  closed to a short (≤3-word) subject so an ordinary relative clause
 *  ("what the parser does with X …") is never re-inverted. */
const EMBEDDED_WHATIS_RE = /^what\s+((?:an?\s+|the\s+)?[\w'-]+(?:\s+[\w'-]+){0,2})\s+(is|are)\??$/i;
const EMBEDDED_MEANS_RE = /^what\s+((?:an?\s+|the\s+)?[\w'-]+(?:\s+[\w'-]+){0,2})\s+means\??$/i;
/** show/give-me presentation bridge: a kind-listing remainder is left
 *  untouched, a relation/interrogative remainder unwraps to itself, anything
 *  else bridges to "describe <thing>". */
const SHOW_GIVE_ME_RE = /^(?:show|give)\s+me\s+(?:the\s+)?(.+?)\??$/i;

/** Leading STACCATO connective before an ALREADY well-formed question ("and
 *  what imports it") -> the question alone. Gated on the remainder starting
 *  a real question, so a mid-clause boolean composition ("classes that
 *  inherit from Base and are tested") is never touched. Without this gate,
 *  "and" itself got misread as the subject term — a miss the relaxation
 *  cascade can't rescue, since "and" is protected content vocabulary the
 *  noise-strip layer never drops. */
const LEADING_CONNECTIVE_RE = /^(?:and|also|so|then|now|but)\s+(.+)$/i;
const QUESTION_AUX_LEAD_RE = /^(?:does|do|did|is|are|was|were|has|have|had|can|could|will|would|should)\b/i;

/** A topic-switch/self-interruption preamble ("actually never mind, <Q>"),
 *  repeating so a stack of markers peels in one pass. Distinct from
 *  SELF_CORRECTION_RE below, which needs an explicit "sorry"/"i mean" marker
 *  with a mandatory trailing delimiter and models a mid-clause restart. */
const TOPIC_SWITCH_PREAMBLE_RE =
  /^(?:(?:actually|no\s+wait|wait|hold\s+on|never\s+mind|scratch\s+that|on\s+second\s+thought|i\s+mean(?:t)?)[\s,.]+)+(.+)$/i;

/** Apply the closed preamble frames in order (greeting -> modal -> show/give-me),
 *  repeated to a small fixpoint so stacked wrappers ("hey, can you show me X
 *  please") peel fully. Pure and idempotent; unmatched text passes through. */
export function applyPreambleFrames(text) {
  let q = String(text || "");
  q = q.replace(TROUBLE_ASIDE_RE, " ").replace(/\s+/g, " ").trim();
  for (let pass = 0; pass < 3; pass++) {
    const before = q;
    let m = q.match(GREETING_PREAMBLE_RE);
    if (m) q = m[1].trim();
    m = q.match(THANKS_PREAMBLE_RE);
    if (m) q = m[1].trim();
    m = q.match(ACK_PREAMBLE_RE);
    if (m) q = m[1].trim();
    m = q.match(BROWSING_PREAMBLE_RE);
    if (m) q = m[1].trim();
    m = q.match(HEDGE_ADVERB_PREAMBLE_RE);
    if (m) q = m[1].trim();
    m = q.match(TOPIC_SWITCH_PREAMBLE_RE);
    if (m) q = m[1].trim();
    m = q.match(MODAL_WRAPPER_RE);
    if (m) q = m[1].trim();
    m = q.match(EXPLAIN_WRAPPER_RE);
    if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
    m = q.match(TELL_ME_WRAPPER_RE);
    if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
    m = q.match(KNOW_WRAPPER_RE);
    if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
    m = q.match(WANT_KNOW_WRAPPER_RE);
    if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
    m = q.match(EMBEDDED_WHATIS_RE);
    if (m) q = `what ${m[2].toLowerCase()} ${m[1].trim()}`;
    m = q.match(EMBEDDED_MEANS_RE);
    if (m) q = `what does ${m[1].trim()} mean`;
    m = q.match(SHOW_GIVE_ME_RE);
    if (m) {
      const rest = m[1].trim();
      if (!isListingRemainder(rest)) {
        q = (RELATION_VERB_RE.test(rest) || INTERROGATIVE_LEAD_RE.test(rest)) ? rest : `describe ${rest}`;
      }
    }
    m = q.match(LEADING_CONNECTIVE_RE);
    if (m) {
      const rest = m[1].trim();
      // Also accept a remainder matching another closed preamble frame, so a
      // connective sandwiched between two markers ("so actually wait, X")
      // doesn't block the fixpoint.
      if (
        INTERROGATIVE_LEAD_RE.test(rest) || QUESTION_AUX_LEAD_RE.test(rest)
        || TOPIC_SWITCH_PREAMBLE_RE.test(rest) || ACK_PREAMBLE_RE.test(rest)
        || HEDGE_ADVERB_PREAMBLE_RE.test(rest) || BROWSING_PREAMBLE_RE.test(rest)
      ) q = rest;
    }
    if (q === before) break;
  }
  return q;
}

/** Strippable leading framing clause: "since/although/though/while/because/
 *  whereas/given that/now that <clause>, <Q>" -> "<Q>". Comma-anchored and
 *  non-empty-remainder-required, same discipline as GREETING_PREAMBLE_RE. */
const SUBORDINATION_FRAMES_RE =
  /^(?:since|although|though|while|because|whereas|given\s+that|now\s+that)\s+.+?,\s*(.+)$/i;

export function applySubordinationFrames(text) {
  let q = String(text || "");
  for (let pass = 0; pass < 3; pass++) {
    const m = q.match(SUBORDINATION_FRAMES_RE);
    if (!m) break;
    q = m[1].trim();
  }
  return q;
}

/** A mid-sentence false start, abandoned and restarted: "what -- sorry, who
 *  inherits from Record". The marker ("sorry"/"i mean") and its trailing
 *  delimiter are both required — an ordinary em-dash aside is common prose,
 *  not a restart, and treating every dash as a delimiter would be a guess.
 *  The trailing delimiter also means an object-only restart with no comma
 *  after "i mean" isn't rescued here. */
const SELF_CORRECTION_RE =
  /^.+?(?:\s*(?:--|—|-)\s*)?\b(?:sorry|i\s+mean)\b\s*(?:--|—|-|,|:)\s*(.+)$/i;

export function applySelfCorrectionFrames(text) {
  let q = String(text || "");
  for (let pass = 0; pass < 3; pass++) {
    const m = q.match(SELF_CORRECTION_RE);
    if (!m) break;
    const next = m[1].trim();
    if (!next || next === q) break;
    q = next;
  }
  return q;
}

/** relation-verb -> gerund, the shape the compositional grammar's
 *  "<kind> <gerund> <object> and <qualifier>" pattern needs. A small,
 *  hand-curated table, not a morphological rule. */
const CONDITIONAL_VERB_GERUND = Object.freeze({
  imports: "importing", calls: "calling", touches: "touching", tests: "testing",
  exports: "exporting", contains: "containing", defines: "defining", uses: "using",
  "inherits from": "inheriting from",
});
/** entity kind noun (singular) -> plural, the LISTABLE_KINDS the compositional
 *  grammar's subject slot takes. Regular English pluralization covers every
 *  entry (no irregulars in this closed set), so a flat table beats a
 *  morphological rule for the same "no guessing" reason as the verb table. */
const CONDITIONAL_KIND_PLURAL = Object.freeze({
  module: "modules", class: "classes", function: "functions", method: "methods",
  attribute: "attributes", variable: "variables", commit: "commits", file: "files",
});
const CONDITIONAL_QUALIFIER_SRC =
  "public|private|protected|static|abstract|constant|re-?exported|exported|tested|covered|untested|uncovered";
/** "if a/the <kind> <relation-verb> <object>, is/are it/that/they/this
 *  <qualifier>?" -> "<kind plural> <relation-gerund> <object> and <qualifier>".
 *  Closed to the two small tables above (both ends validated), so an
 *  unrecognized kind/verb/qualifier simply doesn't match — falls through to
 *  the ordinary grammar, which honestly misses on the untransformed "if …"
 *  text rather than risk a wrong composition. */
const CONDITIONAL_QUALIFIER_RE = new RegExp(
  "^if\\s+(?:a|an|the)?\\s*(" + Object.keys(CONDITIONAL_KIND_PLURAL).join("|") + ")\\s+"
  + "(" + Object.keys(CONDITIONAL_VERB_GERUND).join("|") + ")\\s+"
  + "(.+?),\\s*(?:is|are)\\s+(?:it|that|they|this)\\s+"
  + "(" + CONDITIONAL_QUALIFIER_SRC + ")\\??$",
  "i",
);

/** Counterfactual deletion -> "which modules transitively import <X>" (the
 *  existing reverse-dependency closure). Exported so chat.mjs can recognize
 *  the same shape and prepend a hypothetical marker to the rendered answer. */
export const COUNTERFACTUAL_RE =
  /^if\s+(.+?)\s+(?:were|was)\s+(?:deleted|removed),?\s*what\s+(?:would|might|could)\s+(?:break|fail|be\s+affected)\??$/i;

/** Apply the two conditional frames, qualifier composition first (more specific). */
export function applyConditionalFrames(text) {
  const q = String(text || "");
  const qual = q.match(CONDITIONAL_QUALIFIER_RE);
  if (qual) {
    const kind = CONDITIONAL_KIND_PLURAL[qual[1].toLowerCase()];
    const gerund = CONDITIONAL_VERB_GERUND[qual[2].toLowerCase()];
    return `${kind} ${gerund} ${qual[3].trim()} and ${qual[4].toLowerCase()}`;
  }
  const cf = q.match(COUNTERFACTUAL_RE);
  if (cf) return `which modules transitively import ${cf[1].trim()}`;
  return q;
}

/** Free-text -> normalized free-text: contractions expanded, g-dropped words
 *  restored, closed preamble/subordination/conditional frames peeled, filler/
 *  politeness words stripped. Idempotent and pure. Deliberately does NOT
 *  force lowercase — object/subject terms (module/class names) are
 *  meaningfully cased, and every substitution already matches
 *  case-insensitively. */
/** The contraction table applied on its own — "what's on peg-a" -> "what is on
 *  peg-a". normalizeQuery's first pass, lifted out for callers that count words
 *  and need "what's" counted as the two it stands for, without the filler strip
 *  that would take words back off. Pure and idempotent. */
export function expandContractions(text) {
  return String(text || "").replace(CONTRACTION_RE, (m) => CONTRACTIONS[m.toLowerCase()]);
}

/** "where is disk-1 now" -> "where is disk-1". A locative question's answer is the
 *  same with the adverb or without it, so the word carries nothing to read — but
 *  the where template's term capture runs to the end of the string and binds it,
 *  which then shows up in the receipt as part of the term. Stripped here, in the
 *  shared pre-pass, so both parse strategies see one string and cannot disagree
 *  about where the term ends. Anchored to "where is/are/was/were" and to the end:
 *  a term of the same name elsewhere in a question is untouched. */
const WHERE_TRAILING_TEMPORAL_RE = new RegExp(
  `^(where\\s+(?:is|are|was|were)\\s+.+?)\\s+(?:${TRAILING_TEMPORAL_ADVERBS.map(escapeRegex).join("|")})(\\s*[?.!]*)$`,
  "i",
);

export function normalizeQuery(text) {
  let q = expandContractions(text);
  q = q.replace(MISSPELLING_RE, (m) => MISSPELLINGS[m.toLowerCase()]);
  q = q.replace(WRONG_WORD_RE, (m) => WRONG_WORDS[m.toLowerCase()]);
  q = q.replace(W_SLASH_RE, "with");
  q = q.replace(FOR_DIGIT_THANKS_RE, (_, w) => `${w} for`);
  q = q.replace(FOR_DIGIT_EXAMPLE_RE, (_, w) => `for ${w}`);
  q = q.replace(KIND_NOUN_ANAPHORA_RE, (_, pron) => pron);
  q = q.replace(WHERE_TRAILING_TEMPORAL_RE, "$1$2");
  q = q.replace(G_DROP, "$1ing");
  q = applyPreambleFrames(q);
  // self-correction runs before subordination/conditional: a false start can
  // itself look like a subordination clause's opening ("since -- sorry, X").
  q = applySelfCorrectionFrames(q);
  // subordination (strip a leading framing clause) THEN conditional (compile
  // "if …" to an existing working shape) — subordination first so a stacked
  // "since we're refactoring, if a module imports X, is it tested" peels its
  // outer wrapper before the conditional frame ever sees it. Both run BEFORE
  // the filler strip for the same reason the preamble frames do: their
  // anchors ("since", "if", "is it") would otherwise be eaten as bare words,
  // leaving punctuation/clause debris that poisons the parse.
  q = applySubordinationFrames(q);
  q = applyConditionalFrames(q);
  q = stripFillerWords(q);
  // emphatic trailing punctuation (item 10): a run of terminal "?" collapses to
  // one — the anchored templates consume exactly one optional trailing "?", so
  // "…walk.mjs??" otherwise leaks a stray "?" into the captured object term (the
  // keyword-spot strategy already strips the whole run, and the two strategies
  // then "disagreed" over punctuation that was never part of the intent).
  q = q.replace(/\?{2,}\s*$/, "?");
  return q.replace(/\s+/g, " ").trim();
}

/** Two closed families tried in order: COMMIT_CONTENT_FRAMES ("what was in
 *  commit <sha>" -> "what did <sha> touch"), then NEGATION_FRAMES. First
 *  match wins; unmatched text passes through unchanged. */
export function applyNegationFrames(text) {
  for (const frame of [...COMMIT_CONTENT_FRAMES, ...NEGATION_FRAMES]) {
    const m = text.match(frame.re);
    if (m) return frame.to(m).replace(/\s+/g, " ").trim();
  }
  return text;
}

// Phrasing frames: route natural phrasings of a members-of-class or
// where-defined question onto the canonical shape the grammar answers.
// First match wins; run after applyNegationFrames.
export const PHRASING_FRAMES = Object.freeze([
  // MEMBERS-of-class → "what does X contain".
  { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:are|is)\s+(?:in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
  { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:does|do)\s+(.+?)\s+have\??$/i, to: (m) => `what does ${m[1]} contain` },
  { re: /^what\s+are\s+(?:the\s+)?(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:of|in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
  { re: /^(?:the\s+)?(?:members?|methods?|attributes?|contents)\s+of\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
  { re: /^what\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
  // "what else is in X" drill-down after a members-of-class answer.
  { re: /^what\s+else\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },

  // WHERE-DEFINED → "where is X defined". PAST TENSE ONLY ("what defined X", "what
  // declared X"): the PRESENT "what defines X" already parses as a reverse-defines
  // query (the module defining symbol X), so rewriting it would change that
  // receipt. The past-tense form is the one that hit the wall.
  { re: /^what\s+(?:defined|declared)\s+(?:the\s+)?(?:function\s+|method\s+|class\s+|module\s+|variable\s+|constant\s+)?(.+?)\??$/i, to: (m) => `where is ${m[1]} defined` },
  //   "where's X defined" (the "where's" contraction is not in the contraction table)
  { re: /^where'?s\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },
  //   "were is X defined" (the missing-h typo of "where").
  //   NOT curated as a blanket MISSPELLINGS entry — "were" is a real word already
  //   load-bearing as the TEMPORAL_AUX auxiliary ("when were the modules last
  //   touched"), so a global word-boundary rewrite would clobber that reading.
  //   This frame is anchored to the WHERE-DEFINED shape specifically ("were is
  //   … defined/declared/located/implemented"), a construction no legitimate
  //   temporal query produces ("were" as an auxiliary never leads directly into
  //   a bare "is").
  { re: /^were\s+is\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },

  // DESCRIBE PARAPHRASES ("what is the purpose of X", "what does X do in
  // this codebase") → the meta/whatis shape ("what is a <term>"), which
  // already answers a unique code entity via metaFallbackEntityAnswer. The
  // term slot refuses an a/an article or a pronoun lead so the vocabulary
  // phrasings ("what is the purpose of a horse", "what does it do here")
  // pass through untouched to their own memory-facts and context readers,
  // which read the raw text and must keep their turn. A leading "the" is
  // entity-term noise (mirrors resolveObject's own article strip). The
  // sibling "what is X for" paraphrase is deliberately NOT a frame: chat's
  // module-overview lane owns that phrasing and gates on an ask() miss, so
  // it lives as ask()'s own miss-gated fallback (WHATIS_FOR_FALLBACK_RE)
  // instead, adopted only when the meta reading actually answers.
  { re: /^what\s+is\s+the\s+purpose\s+of\s+(?:the\s+)?(?!(?:an?|it|this|that|these|those)\s)(.+?)\??$/i, to: (m) => `what is a ${m[1]}` },
  // Scoped form only: bare "what does X do" stays unrewritten — the chat
  // surface's module-grain overview lane owns it and only gets its turn when
  // ask() misses, so claiming it here would swap that richer answer for the
  // one-line meta fallback.
  {
    re: new RegExp(`^what\\s+does\\s+(?:the\\s+)?(?!(?:an?|it|this|that|these|those)\\s)(.+?)\\s+do\\s+(?:${TRAILING_SCOPE_FILLER.map(escapeRegex).join("|")})\\??$`, "i"),
    to: (m) => `what is a ${m[1]}`,
  },

  // PREDICATIVE QUALIFIER ("which modules are untested") → the ATTRIBUTIVE form
  // ("untested modules") the grammar already answers. The QUALIFIER must sit
  // immediately after are/is, so "…are NOT tested" keeps its own set-complement handler.
  {
    re: /^(?:which|what)\s+(?:the\s+|all\s+)?([a-z][a-z-]*?)\s+(?:are|is)\s+(public|private|protected|static|abstract|constant|exported|re-?exported|tested|covered|untested|uncovered)\??$/i,
    to: (m) => `${m[2].toLowerCase()} ${m[1].toLowerCase()}`,
  },

  // BARE COVERAGE SURVEY, no entity kind ("what is untested") → defaults the
  // surveyed kind to modules and folds the negation into the qualifier.
  {
    re: /^what\s+(?:is|are)\s+(not\s+)?(tested|untested|covered|uncovered)\??$/i,
    to: (m) => {
      const q = m[2].toLowerCase();
      const flipped = m[1] ? (q === "tested" ? "untested" : q === "covered" ? "uncovered" : q) : q;
      return `${flipped} modules`;
    },
  },

  // CO-CHANGE → "what co-changes with X" (the plainest phrasing a developer types).
  { re: /^what\s+does\s+(.+?)\s+changes?\s+together\s+with\??$/i, to: (m) => `what co-changes with ${m[1]}` },
  { re: /^what\s+changes?\s+together\s+with\s+(.+?)\??$/i, to: (m) => `what co-changes with ${m[1]}` },

  // AUTHORSHIP → "who touched X" (tmct's touch edge IS the authorship signal).
  // A commit sha object is excluded — that dumps the commit's touch-set, not its author.
  { re: /^who\s+(?:wrote|authored)\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },
  { re: /^who\s+is\s+the\s+authors?\s+of\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },

  // HAS-TESTS → "what tests X" (the coverage question). Refuses "not" in the
  // subject so set-complement negations keep their own downstream handler.
  { re: /^(?:does|do)\s+(?!.*\bnot\b)(.+?)\s+have\s+(?:any\s+)?(?:tests?|test\s+coverage|coverage)\??$/i, to: (m) => `what tests ${m[1]}` },
  { re: /^(?:is|are)\s+(?!.*\bnot\b)(.+?)\s+tested\??$/i, to: (m) => `what tests ${m[1]}` },

  // NEEDS-TESTS → the untested-module survey.
  { re: /^what\s+needs\s+(?:to\s+be\s+)?(?:a\s+)?(?:tested|tests?|testing|coverage|covering)\??$/i, to: () => "untested modules" },

  // DOES-X-VERB-ANYTHING-ELSE → "what does X <verb>" (drops the placeholder
  // "anything/something else" object, which otherwise made the two parse
  // strategies disagree on the span). Anchored to VERB_TO_KIND so it can't
  // swallow a real object that happens to start with "any"/"some".
  {
    re: new RegExp(`^(?:do|does)\\s+(.+?)\\s+(${VERB_ALTERNATION})\\s+(?:anything|something)(?:\\s+else)?\\??$`, "i"),
    to: (m) => `what does ${m[1]} ${m[2]}`,
  },
]);

/** Apply the phrasing frames (members-of-class + where-defined) — first match wins
 *  and rewriting stops; unmatched text passes through unchanged. Kept SEPARATE from
 *  applyNegationFrames so the ordering (negation/commit first, then phrasing) is
 *  explicit at the call site (normalizeInput). */
export function applyPhrasingFrames(text) {
  for (const frame of PHRASING_FRAMES) {
    const m = text.match(frame.re);
    if (m) return frame.to(m).replace(/\s+/g, " ").trim();
  }
  return text;
}

// SET-COMPLEMENT frame: recognizes a bare set-negation query ("which X do not
// <verb> Y") and returns a descriptor, distinct from the rhetorical
// double-negative rewriter above (which REMOVES negation instead of
// preserving it as a set operation).
const NEGATION_SET_RE = new RegExp(
  "^(?:which|what|who|list|show(?:\\s+me)?|find|give\\s+me)?\\s*(?:the\\s+|all\\s+)?"
  + "([a-z][a-z-]*)\\s+"
  + "(?:(?:that|which|who)\\s+)?"
  + "(?:(?:do|does|did|are|is|was|were|have|has)\\s+)?"
  + "not\\s+(.+)$",
  "i",
);

/** Recognize a bare set-negation query -> {entWord, predicate}, or null. The
 *  caller (ask.mjs's parseNegation) validates the entity kind and builds the
 *  complement AST. */
export function matchNegationSet(text) {
  const m = String(text || "").match(NEGATION_SET_RE);
  if (!m) return null;
  const entWord = m[1].toLowerCase();
  const predicate = m[2].trim();
  if (!predicate) return null;
  return { entWord, predicate };
}

// ---- shared text-prep helpers (used by the strategies, the compositional
// grammar, and ask.mjs's relaxation cascade alike) ----

/** Question/auxiliary/article scaffolding the decomposition strategies skip when
 *  splitting residual words into subject/object terms. Shared so every strategy
 *  (and the cascade's structural-word set) reads the SAME list. */
export const STOPWORDS = new Set([
  "what", "who", "which", "where", "when", "why", "how",
  "does", "do", "did", "is", "are", "was", "were", "the", "a", "an", "of", "to", "from", "at", "in", "on",
  "there", "something", "anything", "nothing", "one", "any",
  "last", // temporal filler ("when was X last touched")
  "usually", "typically", "generally", "normally", "often", "commonly", "mostly", // frequency-adverb filler
  "should", "would", "could", "can", "will", "shall", "might", "must", // modal auxiliaries
]);

/** Split free text into words: trailing "?" run stripped, commas treated as
 *  spaces, mid-word "." preserved (object terms are routinely dotted file/module
 *  names — "a.py", "utils.mjs"). */
export const splitWords = (text) => String(text).replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);

/** Flatten a phrase list into its lowercase constituent words — the standard way
 *  a vocab table's multi-word phrases feed a word-level set (the cascade's
 *  content-vocab union, the noise-strip KEEP set). */
export const wordsOf = (arr) => arr.flatMap((p) => String(p).toLowerCase().split(" "));
