// interpret/normalize.mjs — the input-normalization pass (ROADMAP item 10) and the
// shared text-prep helpers every interpretation strategy reads. Extracted MOVE-only
// from ask.mjs (item 13, chat/primitives split): the code here is the §3.5
// normalization pipeline exactly as it ran inside ask.mjs — contractions expanded,
// curated misspelling/wrong-word corrections applied, g-dropped words restored,
// filler/politeness stripped, then the small closed set of rhetorical frames
// rewritten to the canonical form of the SAME question. Pure, deterministic,
// idempotent — both parsing strategies (and any future one) see identical text.
//
// This is the pipeline's documented PRE-PASS: interpret/pipeline.mjs runs
// normalizeInput() once, hands every strategy the normalized text (plus the raw
// text in ctx.raw), and records whether normalization changed the input.

import {
  CONTRACTIONS, MISSPELLINGS, WRONG_WORDS, G_DROP, FILLER_WORDS,
  NEGATION_FRAMES, COMMIT_CONTENT_FRAMES, VERB_TO_KIND,
} from "../ask-vocab.mjs";

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- §3.5 normalization — runs before EITHER parsing strategy sees the text ----

/** contraction/informal-spelling table -> word-boundary regex, longest phrase
 *  first (so "there's" doesn't get shadowed by a shorter overlapping entry). */
const tableRe = (table) => new RegExp(
  "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
  "gi",
);
const CONTRACTION_RE = tableRe(CONTRACTIONS);
// misspelling/wrong-word CORRECTIONS (ask-vocab.mjs) — same mechanism, applied
// after contractions: restore the intended spelling first, then map misused
// words to their canonical schema term. Deterministic and curated, so they run
// BEFORE either parse strategy and ahead of the bounded edit-distance fallback.
// The trailing lookahead refuses to rewrite a word glued to a dotted extension:
// WRONG_WORDS entries are real English words that plausibly NAME modules
// ("revision.mjs", "property.py"), and a correction that corrupts an object
// term would be a guess — the exact thing these tables exist to avoid.
const correctionRe = (table) => new RegExp(
  "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b(?!\\.[a-z0-9])",
  "gi",
);
const MISSPELLING_RE = correctionRe(MISSPELLINGS);
const WRONG_WORD_RE = correctionRe(WRONG_WORDS);

// ---- closed PREAMBLE frames (0.8.2 feel wave, PLAN_CHAT_FEEL item 2) — the
// conversational wrapping a developer puts AROUND a real question: a greeting
// lead-in with a delimiter ("hey there, quick question - …"), the modal
// politeness wrapper ("can you … please"), and the show/give-me presentation
// bridge. These are DELIMITER- and PHRASE-anchored, so they must run BEFORE the
// FILLER-strip pass below: FILLER_WORDS strips "hey"/"can you" as bare words, so
// after that pass the frames' anchors are gone while the punctuation debris
// ("there, quick question -") still poisons the parse (the playtest wall).
// Applied inside normalizeQuery — the one seam BOTH composition sites (ask.mjs
// parseQuery and interpret/pipeline.mjs normalizeInput) run first — AFTER the
// word-restoring correction tables (so "gimme"/"shwo me" are already "give me"/
// "show me") and BEFORE the filler strip. Closed patterns, applied in order to a
// small fixpoint; unmatched text passes through byte-unchanged. ----

/** Any relation verb phrase from the shared vocabulary — the show/give-me
 *  bridge's "this remainder is a real relation query" probe. */
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
 *  "hey there, quick question - <Q>" -> "<Q>". The delimiter and the non-empty
 *  remainder are REQUIRED, so a bare "hey there" stays a greeting for chat's
 *  conversational lane, and "hey tmct, …" (a vocative, no delimiter after the
 *  greeting word) is left for the noise-strip tier that already owns it. */
const GREETING_PREAMBLE_RE = /^(?:hi|hiya|hello|hey|yo|howdy)(?:\s+there)?\s*[,—–-]\s*(?:(?:just\s+a\s+)?quick\s+question\s*[,:—–-]?\s*)?(.+)$/i;
/** Modal politeness wrapper: "can/could/would/will you [please] <Q>[, please][?]"
 *  -> "<Q>". FILLER_WORDS already ate "can you"/"please" as words; this frame
 *  removes them as a WRAPPER so the ", please" comma never survives into the
 *  parsed object term. The unwrapped remainder flows on through the ordinary
 *  passes, so "can you tell me a joke" -> "tell me a joke" -> (FILLER) "a joke"
 *  — byte-identical to what the bare form normalizes to (the hm-joke wall). */
const MODAL_WRAPPER_RE = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(.+?)(?:[,\s]+please)?\??$/i;
/** show/give-me presentation bridge: "show me [the] <thing>". Three-way:
 *  a KIND-listing remainder is left untouched (the compositional list grammar
 *  owns "show me untested modules"); a remainder carrying a relation verb or an
 *  interrogative lead is a real query merely presented — unwrap to it ("show me
 *  which modules import X" -> "which modules import X"); anything else is an
 *  entity presentation — bridge to the describe surface ("show me the store
 *  module" -> "describe store module"). */
const SHOW_GIVE_ME_RE = /^(?:show|give)\s+me\s+(?:the\s+)?(.+?)\??$/i;

/** Apply the closed preamble frames in order (greeting -> modal -> show/give-me),
 *  repeated to a small fixpoint so stacked wrappers ("hey, can you show me X
 *  please") peel fully. Pure and idempotent; unmatched text passes through. */
export function applyPreambleFrames(text) {
  let q = String(text || "");
  for (let pass = 0; pass < 3; pass++) {
    const before = q;
    let m = q.match(GREETING_PREAMBLE_RE);
    if (m) q = m[1].trim();
    m = q.match(MODAL_WRAPPER_RE);
    if (m) q = m[1].trim();
    m = q.match(SHOW_GIVE_ME_RE);
    if (m) {
      const rest = m[1].trim();
      if (!isListingRemainder(rest)) {
        q = (RELATION_VERB_RE.test(rest) || INTERROGATIVE_LEAD_RE.test(rest)) ? rest : `describe ${rest}`;
      }
    }
    if (q === before) break;
  }
  return q;
}

/** Free-text -> normalized free-text: contractions expanded, g-dropped words
 *  restored, closed preamble frames peeled, filler/politeness words stripped.
 *  Idempotent and pure — the same
 *  input always normalizes the same way, so both parsing strategies see
 *  identical text and their outputs are directly comparable. Deliberately
 *  does NOT force lowercase: object/subject terms (module names like
 *  "myFile", class names like "Base") are meaningfully cased, and every
 *  substitution below already matches case-insensitively (`i`/`gi` flags) —
 *  forcing the whole string to lowercase would silently corrupt every parsed
 *  term's case instead. */
export function normalizeQuery(text) {
  let q = String(text || "");
  q = q.replace(CONTRACTION_RE, (m) => CONTRACTIONS[m.toLowerCase()]);
  q = q.replace(MISSPELLING_RE, (m) => MISSPELLINGS[m.toLowerCase()]);
  q = q.replace(WRONG_WORD_RE, (m) => WRONG_WORDS[m.toLowerCase()]);
  q = q.replace(G_DROP, "$1ing");
  // closed preamble frames (greeting lead-in, modal wrapper, show/give-me
  // bridge) — AFTER the correction tables (a repaired "give me"/"show me" still
  // feeds the bridge) but BEFORE the filler strip erases their anchor words.
  q = applyPreambleFrames(q);
  if (FILLER_WORDS.length) {
    const fillerRe = new RegExp(
      "\\b(" + [...FILLER_WORDS].sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
      "gi",
    );
    q = q.replace(fillerRe, " ");
  }
  // emphatic trailing punctuation (item 10): a run of terminal "?" collapses to
  // one — the anchored templates consume exactly one optional trailing "?", so
  // "…walk.mjs??" otherwise leaks a stray "?" into the captured object term (the
  // keyword-spot strategy already strips the whole run, and the two strategies
  // then "disagreed" over punctuation that was never part of the intent).
  q = q.replace(/\?{2,}\s*$/, "?");
  return q.replace(/\s+/g, " ").trim();
}

/** Recognized rhetorical/idiomatic constructions rewritten to the canonical form
 *  of the SAME question before either parse strategy sees the text — a small
 *  closed pattern set, not a general rewriter. Two families, tried in order:
 *  COMMIT_CONTENT_FRAMES first ("what was in commit <sha>" -> "what did <sha>
 *  touch"; sha-anchored, so it can't swallow a containment question), then the
 *  §3.6 negative-rhetorical NEGATION_FRAMES. First matching frame across both wins
 *  and rewriting stops; unmatched text passes through unchanged. */
export function applyNegationFrames(text) {
  for (const frame of [...COMMIT_CONTENT_FRAMES, ...NEGATION_FRAMES]) {
    const m = text.match(frame.re);
    if (m) return frame.to(m).replace(/\s+/g, " ").trim();
  }
  return text;
}

// ---- phrasing frames (SKILL_CHAT_PLAYTEST drill-down loop) — route the natural
// ways a developer asks a MEMBERS-of-class or a WHERE-DEFINED question onto the
// canonical shapes the grammar already answers, so a phrasing miss becomes a real
// answer (or an honest empty with a receipt) instead of the grammar wall. Same
// closed-pattern, first-match-wins discipline as the negation/commit frames: each
// frame REWRITES the whole line to a canonical query BOTH parse strategies then
// handle for free. Run AFTER applyNegationFrames so a sha "what's in <sha>" is
// already the commit-subject question before the members frame could see it. ----
export const PHRASING_FRAMES = Object.freeze([
  // MEMBERS-of-class → "what does X contain".
  //   "what functions are in Task", "what methods are inside X", "what attributes are in X"
  { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:are|is)\s+(?:in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
  //   "what functions does Task have", "what methods does X have"
  { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:does|do)\s+(.+?)\s+have\??$/i, to: (m) => `what does ${m[1]} contain` },
  //   "what are the members of X", "what are the methods in X"
  { re: /^what\s+are\s+(?:the\s+)?(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:of|in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
  //   "members of X", "methods of X", "contents of X"
  { re: /^(?:the\s+)?(?:members?|methods?|attributes?|contents)\s+of\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
  //   "what's in X" / "what is in X" (contraction already expanded; sha handled above)
  { re: /^what\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },

  // WHERE-DEFINED → "where is X defined". PAST TENSE ONLY ("what defined X", "what
  // declared X"): the PRESENT "what defines X" already parses as a reverse-defines
  // query (the module defining symbol X — test/ask.test.mjs pins that), so rewriting
  // it would change that receipt. The past-tense form is the one that hit the wall.
  { re: /^what\s+(?:defined|declared)\s+(?:the\s+)?(?:function\s+|method\s+|class\s+|module\s+|variable\s+|constant\s+)?(.+?)\??$/i, to: (m) => `where is ${m[1]} defined` },
  //   "where's X defined" (the "where's" contraction is not in the contraction table)
  { re: /^where'?s\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },

  // PREDICATIVE QUALIFIER → the ATTRIBUTIVE form the grammar already answers. The
  // adjective-qualifier post-filters (ask-vocab.mjs QUALIFIERS: tested/untested,
  // public/private, exported, static/abstract/constant, …) parse in the ATTRIBUTIVE
  // slot — "untested modules", "public methods" — but a developer just as naturally
  // asks the PREDICATIVE "which modules are untested" / "what functions are tested",
  // which hit the grammar wall (and, worse, the wall's own hint SUGGESTED "which
  // functions are tested" — a shape it could not then answer). Rewriting the
  // predicative "<which|what> <kind> are <QUALIFIER>" to "<QUALIFIER> <kind>" routes
  // it onto the working attributive filter. Closed to the known qualifier adjectives
  // (not a general "… are X" catch), and the QUALIFIER must sit immediately after
  // are/is, so "which modules are NOT tested" never matches here — that keeps its own
  // set-complement handler (matchNegationSet, downstream in ask.mjs's parseNegation).
  {
    re: /^(?:which|what)\s+(?:the\s+|all\s+)?([a-z][a-z-]*?)\s+(?:are|is)\s+(public|private|protected|static|abstract|constant|exported|re-?exported|tested|covered|untested|uncovered)\??$/i,
    to: (m) => `${m[2].toLowerCase()} ${m[1].toLowerCase()}`,
  },

  // BARE COVERAGE SURVEY (no entity kind) → the attributive "<qualifier> modules"
  // the grammar already answers. Once "what is a test" opens the topic, a developer
  // asks the survey the plainest way — "what is untested", "what's not tested",
  // "what isn't covered", "what is covered" — with NO entity noun at all, so the
  // predicative-qualifier frame above (which needs a KIND between what/which and
  // are/is) can't catch it, and it fell through to a soft wall ("no module matching
  // 'not'…" / the "I answer questions…" orientation). Default the surveyed kind to
  // modules (the same set "which modules are not tested" / "untested modules" return)
  // and fold the negation into the qualifier (not tested → untested, not covered →
  // uncovered). Anchored with no object, so "what tests cover X" / "what is a test"
  // never match here.
  {
    re: /^what\s+(?:is|are)\s+(not\s+)?(tested|untested|covered|uncovered)\??$/i,
    to: (m) => {
      const q = m[2].toLowerCase();
      const flipped = m[1] ? (q === "tested" ? "untested" : q === "covered" ? "uncovered" : q) : q;
      return `${flipped} modules`;
    },
  },

  // CO-CHANGE → the "co-changes with" canonical the RELATIONS table answers. The
  // cochange verb synonyms (ask-vocab.mjs) include "co-changes with" / "moves
  // together with" / "tends to change together with", but NOT the plainest form a
  // developer types — the one the README itself prints and the relation renders as:
  // "what does X change together with" / "what changes together with X". Both hit a
  // dead-end ("couldn't resolve one of the terms" / the grammar wall); rewriting them
  // onto "what co-changes with X" routes them to the working change-coupling query.
  { re: /^what\s+does\s+(.+?)\s+changes?\s+together\s+with\??$/i, to: (m) => `what co-changes with ${m[1]}` },
  { re: /^what\s+changes?\s+together\s+with\s+(.+?)\??$/i, to: (m) => `what co-changes with ${m[1]}` },

  // AUTHORSHIP → the "who touched X" churn query. "who touched X" now names the
  // commit author beside the sha (the 0.8.1 commit-ref quick-win), which invites the
  // synonyms a developer reaches for next — "who wrote X", "who authored X", "who is
  // the author of X" — and every one of them hit the grammar wall. tmct has no
  // separate authorship edge; "touched" IS the authorship signal (the churn commits
  // carry the author), so these are true synonyms of "who touched X", not a new
  // capability. Anaphora rides through untouched ("who wrote it" → "who touched it").
  // SHA GUARD (0.8.2 feel wave): a COMMIT object is NOT a synonym — "who is the
  // author of abc1234" rewritten to "who touched abc1234" dumps the commit's
  // touch-SET instead of naming its author. The negative lookahead refuses the
  // rewrite when the object is a bare (optionally "commit "-prefixed) 7-40 char
  // hex sha, leaving the un-rewritten form for the author lane to consume;
  // file/symbol objects (anything non-sha, e.g. "deadbeef.mjs") keep the rewrite.
  { re: /^who\s+(?:wrote|authored)\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },
  { re: /^who\s+is\s+the\s+authors?\s+of\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },

  // HAS-TESTS → the coverage question the RELATIONS table answers. "does X have
  // tests" parses "have" as a defines-verb (VERB_TO_KIND), producing the garbled
  // "No — no defines edge found from X to <whatever resolves>" receipt; "is X
  // tested" traverses tests edges from the WRONG side (subject = X). Both mean
  // the coverage question "what tests X" — rewrite onto it. Closed to a
  // tests/coverage object ("does X have methods/members" stays the members
  // family) and refuses any "not" in the subject span, so the set-complement
  // negations ("is X not tested") keep their own handler downstream.
  { re: /^(?:does|do)\s+(?!.*\bnot\b)(.+?)\s+have\s+(?:any\s+)?(?:tests?|test\s+coverage|coverage)\??$/i, to: (m) => `what tests ${m[1]}` },
  { re: /^(?:is|are)\s+(?!.*\bnot\b)(.+?)\s+tested\??$/i, to: (m) => `what tests ${m[1]}` },

  // NEEDS-TESTS → the untested-module survey. "what needs tests" / "what needs
  // testing" is the plainest way to ask which modules are uncovered, and it hit the
  // grammar wall ("no module matching 'needs'…"). Route it onto the same attributive
  // survey the bare "what is untested" frame lands on. Closed to the tests/coverage
  // object, so it can't swallow a general "what needs X".
  { re: /^what\s+needs\s+(?:to\s+be\s+)?(?:a\s+)?(?:tested|tests?|testing|coverage|covering)\??$/i, to: () => "untested modules" },
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

// ---- §B1 negation — the SET-COMPLEMENT frame (Cycle 5, archive/PLAN_CYCLE_4.md). Recognizes
// a BARE set-negation query — "which X do not <verb> Y", "X that don't <verb> Y",
// "modules not importing Y", "which X are not <qualifier>" — and returns a descriptor
// {entWord, predicate} that ask.mjs's compositional grammar turns into a bounded
// complement (allOfClass(kind) MINUS the positive result set). Deliberately SEPARATE
// from applyNegationFrames/NEGATION_FRAMES above: that table is a rhetorical
// double-negative rewriter that REMOVES negation ("there isn't anything calling it" ->
// "what calls it") and its docblock forbids scope parsing; this detector PRESERVES the
// negation as a set operation. Returns null when no set-negation marker is present, so
// every affirmative query passes through untouched (the active-voice regression guard).
// The entWord is validated against the entity vocabulary by the caller, which also
// enforces the bounded-universe refusal for the non-enumerable "changes" pseudo-type. ----
const NEGATION_SET_RE = new RegExp(
  "^(?:which|what|who|list|show(?:\\s+me)?|find|give\\s+me)?\\s*(?:the\\s+|all\\s+)?" // optional frame + determiner
  + "([a-z][a-z-]*)\\s+"                    // (1) the entity kind noun
  + "(?:(?:that|which|who)\\s+)?"           // optional relative pronoun
  + "(?:(?:do|does|did|are|is|was|were|have|has)\\s+)?" // optional auxiliary
  + "not\\s+(.+)$",                         // the negation marker + (2) the predicate
  "i",
);

/** Recognize a bare set-negation query and return {entWord, predicate}, or null when
 *  no set-negation marker ("not") follows an entity noun. Pure text analysis — the
 *  caller (ask.mjs's parseNegation) validates the entity kind, refuses the
 *  non-enumerable "changes" universe, and builds the complement AST. */
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
  // temporal filler in when-questions ("when was X last touched") — a symbol
  // literally named "last" would be the accepted residual cost, same trade as
  // every other stopword.
  "last",
]);

/** Split free text into words: trailing "?" run stripped, commas treated as
 *  spaces, mid-word "." preserved (object terms are routinely dotted file/module
 *  names — "a.py", "utils.mjs"). */
export const splitWords = (text) => String(text).replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);

/** Flatten a phrase list into its lowercase constituent words — the standard way
 *  a vocab table's multi-word phrases feed a word-level set (the cascade's
 *  content-vocab union, the noise-strip KEEP set). */
export const wordsOf = (arr) => arr.flatMap((p) => String(p).toLowerCase().split(" "));
