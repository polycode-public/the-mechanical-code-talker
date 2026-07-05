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
  NEGATION_FRAMES, COMMIT_CONTENT_FRAMES,
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

/** Free-text -> normalized free-text: contractions expanded, g-dropped words
 *  restored, filler/politeness words stripped. Idempotent and pure — the same
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

// ---- §B1 negation — the SET-COMPLEMENT frame (Cycle 5, PLAN_CYCLE_4.md). Recognizes
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
