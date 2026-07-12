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
  NEGATION_FRAMES, COMMIT_CONTENT_FRAMES, VERB_TO_KIND, ENTITY_TO_TYPE,
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

// ---- two deferred typo sub-cases (HANDOVER.md 2026-07-12, routed from
// BENCHMARK_CONVERSATION_1.7.0.md's "Routed backlog": "cochange w/ wat",
// "tests 4 it") that structurally CANNOT live in the MISSPELLINGS/WRONG_WORDS
// tables above, for two independent reasons:
//   - correctionRe() builds `\b(...)\b` from a table's keys. A key of "w/"
//     can never satisfy the trailing `\b`: both "/" and the whitespace that
//     follows it are non-word characters, so no word-boundary transition
//     ever happens there — no table entry, however spelled, can match.
//   - "with" and "for" are not canonical grammar-owned words (not in
//     VERB_TO_KIND/ENTITY_TO_TYPE/MODIFIER_TO_KIND/TRIGGER_WORDS), and
//     test/ask-vocab.test.mjs enforces that every correction TABLE value is
//     one of those — by design, so a table entry couldn't rewrite INTO a
//     non-grammar word either.
// Same species as chat.mjs's VAGUE_TOUCH_TEL_RE/VAGUE_TOUCH_ABUT_RE (a
// dedicated, narrowly-scoped regex pass instead of a table entry), wired
// here rather than in chat.mjs because "w/" and leetspeak "4" are GENERAL
// shorthand a developer can use in any question, not one lane's own anchor
// word. normalize.mjs's normalizeQuery is the single point both ask.mjs's
// parseQuery and interpret/pipeline.mjs's normalizeInput funnel every query
// through, so wiring it here reaches every caller once. ----

/** "w/" -> "with". Lookbehind/lookahead require whitespace (or start/end of
 *  string) on BOTH sides, so a real path fragment ("src/w/foo.mjs" — the "/"
 *  right before "w" is not whitespace) and the DIFFERENT shorthand "w/o"
 *  ("without" — a non-whitespace "o" right after the slash) never match. */
const W_SLASH_RE = /(?<=^|\s)w\/(?=\s|$)/gi;

/** "4" meaning the word "for" — deliberately NOT a context-free standalone-
 *  digit substitution. fuzzy.mjs's eligibleForCanon() and several independent
 *  `/^[a-z]+$/` guards in ask.mjs protect digit tokens everywhere in this
 *  codebase (shas, line numbers, counts — "top 4 results", "line 4", "commit
 *  4a2b…") on purpose; a blind "4" -> "for" token rule would corrupt every
 *  one of those. Narrowed to two closed, well-justified trigger shapes —
 *  chosen SMALLER than the plausible "wait 4 X" / "used 4 X" leetspeak
 *  because both of those anchors collide with genuine counts in ordinary
 *  English ("wait 4 minutes", "used 4 times"), which this rule must never
 *  touch:
 *   - a GRATITUDE interjection immediately before "4" (the same closed word
 *     list THANKS_PREAMBLE_RE above already trusts as pure gratitude, never
 *     a count-report opener) — "thx 4 the help", "cheers 4 that".
 *   - the "4 example"/"4 instance" idiom, guarded to fire ONLY when nothing
 *     else follows on the same clause (end of string or punctuation next) —
 *     "…, 4 example" / "4 example?" is the parenthetical "for example" idiom,
 *     but "the 4 example modules" names a genuine COUNT of four example
 *     modules, and the trailing-word lookahead refuses to rewrite that.
 */
const FOR_DIGIT_THANKS_RE = /\b(thx|thanks|thank\s+you|many\s+thanks|ty|cheers)\s+4\b/gi;
const FOR_DIGIT_EXAMPLE_RE = /\b4\s+(example|instance)\b(?!\s*[a-z])/gi;

/** "that class"/"this module"/"that function" (a context pronoun immediately
 *  followed by the SINGULAR kind noun it's already standing in for) -> the bare
 *  pronoun alone (0.9.15 Tier-1 single-touch playtest). "which class contains
 *  Task.complete" answers by NAMING the class ("… there is Task"); a curious
 *  user's very next turn naturally says "what is in that class", not the bare
 *  "what is in that" the grammar already understands. Left unstripped, the two
 *  parse strategies disagreed on the SPAN (grammar kept "that class" as one
 *  literal 2-word object term; keyword-spot split off "class" as an entityType
 *  keyword, leaving bare "that" as the object) — same PARSE, different shape,
 *  so merge.mjs's honest {ambiguousParse} tie fired even though a human reads
 *  this as one unambiguous sentence. Folding the kind noun away BEFORE either
 *  strategy runs leaves exactly one reading: CONTEXT_PRONOUNS' own existing
 *  focus-resolution (ask.mjs's resolveTermOrContext) then takes it from there,
 *  unchanged — this frame only removes the strategy disagreement, it does not
 *  touch how the pronoun itself resolves. Singular kind nouns only ("that
 *  classes" isn't grammatical, so plurals are never a real anaphora and are
 *  left alone); "one" is excluded ("that one" is already its own literal
 *  CONTEXT_PRONOUNS entry). */
const KIND_NOUN_ANAPHORA_RE = /\b(this|that)\s+(class|module|function|method|attribute|variable|file|commit)\b/gi;

/** Read-only PROBE (BENCHMARK_CONVERSATION_1.7.0.md routed backlog C2): does
 *  `text` contain a KIND_NOUN_ANAPHORA_RE match, and if so, what ENTITY CLASS
 *  does its kind noun name (ENTITY_TO_TYPE, ask-vocab.mjs — the same
 *  "file"->"Module" convention every other lane in this grammar already
 *  uses)? Returns that class, or null when no such anaphora is present.
 *  Deliberately SEPARATE from normalizeQuery's own KIND_NOUN_ANAPHORA_RE
 *  replace just above (: this never mutates its input and has no effect
 *  on normalizeQuery's behavior, signature, or any of its many call sites.
 *  A caller that needs BOTH the collapsed pronoun AND the kind it stood for
 *  (chat.mjs's runAsk, at its pronoun-reuse site) calls this side-channel on
 *  the same raw text handed to normalizeQuery — order between the two calls
 *  doesn't matter, since this one only ever reads. */
export function kindNounAnaphoraHint(text) {
  const m = new RegExp(KIND_NOUN_ANAPHORA_RE.source, "i").exec(String(text || ""));
  return m ? (ENTITY_TO_TYPE[m[2].toLowerCase()] || null) : null;
}

// every relation verb phrase VERB_TO_KIND knows, as one alternation (longest-first
// so a multi-word verb like "inherit from" wins over its own leading word "inherit"
// appearing elsewhere) — feeds the DOES-X-VERB-ANYTHING-ELSE frame below, which needs
// to recognize "does <subject> <ANY closed relation verb> anything/something [else]"
// without hardcoding its own parallel verb list.
const VERB_ALTERNATION = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");

/** Just the curated MISSPELLINGS correction (ask-vocab.mjs), standalone — for a
 *  caller that needs typo-tolerant ANCHOR-WORD matching (a closed regex shape
 *  keyed on a literal "what"/"which"/"where" etc.) without running the rest of
 *  normalizeQuery's pipeline (contractions, preamble/subordination/conditional
 *  frame rewrites, filler-word stripping) — those can restructure the sentence
 *  in ways a shape-matcher never expects (0.9.14 Tier-2 playtest: normalizeQuery
 *  turns "tell me about Controller" into "about Controller", which would break
 *  chat.mjs's OWN "^tell me about …" shape regex if fed through wholesale). Pure,
 *  idempotent, same table as normalizeQuery's own first correction step. */
export function correctMisspellings(text) {
  return String(text || "").replace(MISSPELLING_RE, (m) => MISSPELLINGS[m.toLowerCase()]);
}

/** FILLER_WORDS (ask-vocab.mjs), pre-built into one alternation once at module
 *  load — same "build the regex from the table once, reuse it" discipline as
 *  every other closed-vocabulary regex in this file (CONTRACTION_RE,
 *  MISSPELLING_RE, …), rather than rebuilding it inside stripFillerWords on
 *  every call. */
const FILLER_RE = FILLER_WORDS.length
  ? new RegExp(
      "\\b(" + [...FILLER_WORDS].sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b\\s*,?",
      "gi",
    )
  : null;

/** Just the filler/politeness-word strip (ask-vocab.mjs's FILLER_WORDS),
 *  standalone — the same "one piece of the pipeline, not the whole thing"
 *  need correctMisspellings above exists for: a caller with its own
 *  closed anchor regex (chat.mjs's moduleOrientLane matches "^what does …
 *  do$" itself) wants leading/embedded filler cleared WITHOUT running
 *  normalizeQuery's other, more invasive rewrites (contraction expansion,
 *  preamble/subordination/conditional frame rewrites) that can restructure
 *  the sentence in ways its own shape-matcher never expects — the exact
 *  risk correctMisspellings' own docblock describes for the same reason.
 *
 *  A comma trailing the filler word/phrase itself (across any whitespace,
 *  e.g. "um, like," or "quickly,") is swallowed WITH it — leading
 *  conversational filler is routinely comma-spliced onto the real question
 *  ("so um, like, what does X do exactly?"), and stripping only the word
 *  leaves the comma stranded as parse-corrupting punctuation debris (a
 *  leading "," defeats every `^`-anchored template downstream, both parse
 *  strategies and lane-local regexes alike) — the same species of
 *  leftover-debris bug the preamble frames elsewhere in this file
 *  (GREETING_PREAMBLE_RE et al.) already avoid by consuming their own
 *  delimiter. The trailing `,?` is safe to make unconditional (unlike the
 *  preamble frames, no delimiter-required gate is needed): it only ever
 *  fires immediately after a MATCHED filler word, so it can only ever eat a
 *  comma that was already glued to filler, never a comma separating real
 *  content ("the modules, and the classes" — that comma sits after the
 *  content word "modules", not after any filler word). Pure, idempotent;
 *  unmatched text passes through byte-unchanged. */
export function stripFillerWords(text) {
  let q = String(text || "");
  if (FILLER_RE) q = q.replace(FILLER_RE, " ");
  return q.replace(/\s+/g, " ").trim();
}

// ---- closed PREAMBLE frames (0.8.2 feel wave, PLAN_CHAT_FEEL item 2) — the
// conversational wrapping a developer puts AROUND a real question: a greeting
// lead-in with a delimiter ("hey there, quick question - …"), a thanks lead-in
// with a delimiter ("thanks so much, …" — Bug B2, 0.8.2 follow-up), the modal
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
// "g'day"/"gday" (AU/NZ dialect, §3b): the same lead-in-with-delimiter shape as
// hi/hey/howdy — 0.9.14 Tier-2 playtest §3b spot-check found "g'day, what does
// Base contain" fell through to a bogus "'g'day Base' matches more than one
// module" object search instead of stripping the greeting.
// "good morning"/"good afternoon"/"good evening"/"good day"/"greetings"/
// "salutations" (formal register, §3b) — chat.mjs's own bare-turn GREETINGS/
// IDENTITY_PHRASES closed sets already recognize these exact phrases stand-
// alone, but this LEAD-IN regex (a greeting fused onto a real question in the
// same turn) didn't carry the multi-word formal forms at all: a second Tier-2
// playtest pass (0.9.14) found "Good day, what is a method" hit the grammar
// wall outright, and "Good morning, what about tests" fell through to a bogus
// "no module matching 'Good morning' found" object search — the exact same
// failure g'day had before its own fix, just for the formal register instead
// of the AU/NZ dialect. Formal register also plausibly types the lead-in as
// its OWN full sentence ("Good day. What is a method?") rather than a comma
// splice — "." joins the delimiter class for exactly this reason; a bare
// greeting alone ("hi.") still can't match since the regex also requires a
// non-empty remainder AFTER the delimiter.
// "yeah nah" (AU/NZ informal opener, §3b, Tier 6 playtest): a soft discourse
// filler AU/NZ speakers lead a sentence with, distinct from an actual "no" —
// chat.mjs's own GREET closed set already recognizes the BARE phrase, but a
// fused lead-in ("yeah nah, what does the router do") had no preamble form at
// all and fell straight to the raw grammar wall, the exact failure g'day's own
// fix (just above) closed for that dialect's greeting word.
// "howdy pardner" (Tier 6 playtest, §3b dialect axis): "howdy" alone already
// matched, but a VOCATIVE word right after it ("pardner", a US-Western/cowboy
// register touch) sat between the greeting and its delimiter, where only the
// literal word "there" was tolerated — "howdy pardner, remember that X" fell
// straight to the raw grammar wall. A small closed vocative set, same
// discipline as the greeting word list itself.
const GREETING_PREAMBLE_RE = /^(?:hi|hiya|hello|hey|yo|howdy|g'?day|yeah\s+nah|good\s+(?:morning|afternoon|evening|day)|greetings|salutations)(?:\s+(?:there|pardner|folks|friend|mate))?\s*[,.—–-]\s*(?:(?:just\s+a\s+)?quick\s+question\s*[,:—–-]?\s*)?(.+)$/i;
/** Thanks lead-in with a delimiter (+ optional "quick question" bridge), the
 *  sibling of GREETING_PREAMBLE_RE for the "thanks" word family (Bug B2, 0.8.2
 *  follow-up): "thanks, <Q>" / "thanks so much, <Q>" -> "<Q>". chat.mjs's
 *  GREETINGS set already treats a BARE "thanks"/"thank you"/"cheers" as
 *  small-talk, and noise-strip.mjs's CASCADE_NOISE strips a single bare
 *  token — but a multi-word lead-in ("thanks so much, X", "thanks a lot, X")
 *  left "so"/"much"/"a"/"lot" debris after the noise strip that corrupted
 *  re-parse (the object term inherited the debris). Same delimiter- and
 *  non-empty-remainder-REQUIRED discipline as the greeting frame, so a bare
 *  "thanks so much" (no delimiter, no question) stays small-talk. */
const THANKS_PREAMBLE_RE = /^(?:thanks|thank\s+you|many\s+thanks|thx|ty|cheers)(?:\s+(?:so\s+much|a\s+lot|very\s+much|a\s+bunch))?\s*[,—–-]\s*(?:(?:just\s+a\s+)?quick\s+question\s*[,:—–-]?\s*)?(.+)$/i;
/** An ACKNOWLEDGEMENT lead-in with a delimiter, the sibling of GREETING_PREAMBLE_RE/
 *  THANKS_PREAMBLE_RE for the "ok"/"cool" word family (Tier 6 playtest: "ok cool,
 *  what about the TaskController" — a drill-down continuation politely
 *  acknowledging the PREVIOUS answer before asking the next question). chat.mjs's
 *  OK_ACK set already treats a BARE "ok"/"cool"/"sounds good" as small-talk, but a
 *  CHAINED lead-in ("ok cool, X") left "cool"/"," debris ahead of the real
 *  question — same failure class GREETING/THANKS' own multi-word lead-ins had.
 *  The marker group repeats (`+`) so a stack of ack-words peels in one pass ("ok
 *  cool" both go), each followed by whitespace/comma; same delimiter- and
 *  non-empty-remainder-REQUIRED discipline as the two frames above. */
// "no worries" (Tier 6 playtest, §3b dialect axis, AU/NZ): a casual "that's
// fine"/"no problem" opener that also, like the other ack words, sometimes
// leads straight into the NEXT question rather than standing alone. "aight"
// (cycle 5, §3b typo/elongation axis): the further-dropped texting-register
// contraction of "alright", chainable with the others just like "ok cool,".
const ACK_PREAMBLE_RE = /^(?:(?:ok(?:ay)?|aight|cool|alright|sure|right|fine|great|nice|got it|gotcha|sounds good|no worries|no problem)[\s,]+)+(.+)$/i;
/** A SELF-ORIENTATION lead-in with a delimiter — "just poking around, what's
 *  in this repo", "just browsing, X", "just exploring, X" (Tier 6 playtest,
 *  §3: the vague-opener family a genuine first-time stranger types). Same
 *  delimiter-required discipline as GREETING/THANKS/ACK_PREAMBLE_RE above —
 *  a bare "just poking around" with no question stays small-talk (this file
 *  never claims a turn that has no remainder to hand back).
 *  HANDOVER.md 2026-07-10 item 3: "first time trying this out"/"first time
 *  using this"/"first time here" is the SAME self-orientation species — a
 *  genuine stranger's opener, just phrased around their own inexperience
 *  rather than what they're doing right now — found live as "hey, first
 *  time trying this out - what is in here?" falling straight to the raw
 *  grammar wall (GREETING_PREAMBLE_RE peels "hey,", but nothing recognized
 *  the remainder as a preamble at all). Added as a sibling alternative in
 *  the SAME regex/capture group, so it strips into the identical downstream
 *  shape ("just poking around, X" and "first time trying this out, X" both
 *  hand back the bare "X" for the ordinary pipeline to answer) rather than a
 *  new frame with its own behavior. */
const BROWSING_PREAMBLE_RE = /^(?:just\s+(?:poking\s+around|looking\s+around|browsing|exploring|checking\s+(?:this|it)\s+out)|first\s+time\s+(?:trying\s+this\s+out|using\s+this|here))\s*[,.—–-]\s*(.+)$/i;
/** A repeated leading HEDGE ADVERB ("maybe", "possibly", "perhaps") ahead of a
 *  polite request verb — the sibling of ACK_PREAMBLE_RE for HEDGING rather than
 *  acknowledging (Tier 6 playtest §3's own stacked-politeness example: "could
 *  you maybe possibly tell me... what saveStore does"). Unlike ACK_PREAMBLE_RE,
 *  no delimiter is required — a hedge adverb modifies the verb it precedes
 *  directly ("maybe possibly tell me"), so requiring a comma would miss the
 *  common case; unconditional strip, same as the other preamble frames (none
 *  of these three words is grammar-owned vocabulary). Deliberately a narrow,
 *  closed three-word set. */
const HEDGE_ADVERB_PREAMBLE_RE = /^(?:(?:maybe|possibly|perhaps)\s+)+(.+)$/i;
/** A floating "if it's not too much trouble"/"if that's not too much bother"
 *  aside — a genuine mid-sentence PARENTHETICAL (unlike every other frame
 *  here, this is NOT anchored to the start of the string), stripped wherever
 *  it appears, comma-bounded on either side. Tier 6 playtest's own example
 *  phrase: "...tell me, if its not too much trouble, what saveStore does". */
const TROUBLE_ASIDE_RE = /,?\s*if\s+(?:it'?s|it\s+is|that'?s|that\s+is)\s+not\s+too\s+much\s+(?:trouble|bother|hassle)\s*,?\s*/i;
/** Modal politeness wrapper: "can/could/would/will you [please] <Q>[, please][?]"
 *  -> "<Q>". FILLER_WORDS already ate "can you"/"please" as words; this frame
 *  removes them as a WRAPPER so the ", please" comma never survives into the
 *  parsed object term. The unwrapped remainder flows on through the ordinary
 *  passes, so "can you tell me a joke" -> "tell me a joke" -> (FILLER) "a joke"
 *  — byte-identical to what the bare form normalizes to (the hm-joke wall). */
const MODAL_WRAPPER_RE = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(.+?)(?:[,\s]+please)?\??$/i;
/** "explain" politeness/ESL wrapper: "explain [to me|please]* <Q>" -> "<Q>"
 *  (0.9.13 Tier-1 playtest, §3b surface-variation axis) — a formal/ESL lead-in
 *  around an ordinary structural question ("explain please where is it
 *  defined") used to leave "explain"/"please" as noise words that corrupted the
 *  object term into a bogus search ("no module matching 'explain it' found").
 *  Anchored to an INTERROGATIVE remainder (same guard as the show/give-me
 *  bridge below) so this frame only unwraps a real WH-question underneath —
 *  chat.mjs's own IDENTITY_PHRASES ("explain what is this") and the bare
 *  "explain" elaboration request (WHY set) are matched on the RAW turn text
 *  before normalizeQuery ever runs, so neither is touched by this frame. */
const EXPLAIN_WRAPPER_RE = /^explain\s+(?:to\s+me\s+|please\s+)*(.+?)\??$/i;
/** "tell me <Q>" (bare, no "about") -> "<Q>" — the sibling of EXPLAIN_WRAPPER_RE
 *  for the "tell me" verb family when what follows is already a full WH-question
 *  rather than a bare noun. "tell me about X" is vagueTouchTermOf's own separate
 *  territory (chat.mjs) and is untouched here: this frame's interrogative-lead
 *  gate can only ever fire on a remainder that "about X" never satisfies (it
 *  starts with "about", not a WH-word). Found live (Tier 6 playtest): "could you
 *  maybe possibly tell me... what saveStore does" left "tell me what saveStore
 *  does" needing one more unwrap after HEDGE_ADVERB_PREAMBLE_RE and
 *  MODAL_WRAPPER_RE peeled their own layers. */
const TELL_ME_WRAPPER_RE = /^tell\s+me\s+(.+?)\??$/i;
/** show/give-me presentation bridge: "show me [the] <thing>". Three-way:
 *  a KIND-listing remainder is left untouched (the compositional list grammar
 *  owns "show me untested modules"); a remainder carrying a relation verb or an
 *  interrogative lead is a real query merely presented — unwrap to it ("show me
 *  which modules import X" -> "which modules import X"); anything else is an
 *  entity presentation — bridge to the describe surface ("show me the store
 *  module" -> "describe store module"). */
const SHOW_GIVE_ME_RE = /^(?:show|give)\s+me\s+(?:the\s+)?(.+?)\??$/i;

/** Leading STACCATO connective before an ALREADY well-formed question ("and
 *  what imports it", "so does it import anything else", "also where is X
 *  defined") -> the question alone (0.9.15 Tier-1 single-touch playtest). A
 *  rapid-fire drill-down naturally opens its next turn with a bare discourse
 *  connective (chat.mjs's own STACCATO_LEAKED_CONNECTIVES set: and/also/so/
 *  then/now, here joined by "but" for the same family); when what follows is
 *  ALREADY an interrogative lead or an auxiliary-question opener, the
 *  connective carries no query content of its own — conversational
 *  scaffolding, same species as the greeting/subordination preambles. Gated
 *  on the REMAINDER starting a real question, so a genuine mid-clause boolean
 *  composition ("classes that inherit from Base and are tested") is never
 *  touched — that "and" never sits at position 0 to begin with. Without this,
 *  "and what imports it" parsed as an "ask"-shape question with "and" itself
 *  MISREAD as the subject term — a miss the relaxation cascade can't rescue,
 *  because "and" is protected CONTENT_VOCAB (a boolean connective elsewhere)
 *  and the noise-strip layer never drops content vocab. */
const LEADING_CONNECTIVE_RE = /^(?:and|also|so|then|now|but)\s+(.+)$/i;
const QUESTION_AUX_LEAD_RE = /^(?:does|do|did|is|are|was|were|has|have|had|can|could|will|would|should)\b/i;

/** A TOPIC-SWITCH / self-interruption preamble — "actually never mind, what
 *  calls X", "no wait, I meant what calls Y", "hold on, where is Z defined"
 *  (Tier 6 playtest, §3: "no wait", mid-conversation topic switches). A real
 *  user abandoning whatever they were about to say and asking something else
 *  instead — same species as LEADING_CONNECTIVE_RE just above (a discourse
 *  marker carrying no query content of its own, gated on a real question
 *  following it), just a richer closed marker set than a single connective
 *  word, and CHAINABLE ("actually" + "never mind" + "i meant" can all stack —
 *  the fixpoint loop below peels one per pass). Deliberately NOT the same
 *  mechanism as SELF_CORRECTION_RE (this file, further down): that shape
 *  requires an explicit "sorry"/"i mean" marker WITH a mandatory trailing
 *  delimiter, modeling a mid-sentence restart of the SAME clause with real
 *  text on both sides; this one is a STANDALONE marker at the very start of
 *  the turn with nothing meaningful before it, and the delimiter (a comma) is
 *  optional — colloquial speech routinely drops it ("no wait i meant …"). The
 *  marker group REPEATS (`+`, mirroring ACK_PREAMBLE_RE just above) so a stack
 *  of markers peels in ONE pass ("actually" + "never mind," both go) — unlike
 *  LEADING_CONNECTIVE_RE's single-word frame, gating on the remainder after
 *  only the FIRST marker would reject the strip before later markers ever get
 *  a chance to peel (found live: "actually never mind, X" left "never mind,
 *  X" as the gated remainder, which itself never looks like a question lead,
 *  so the whole frame silently declined). None of these markers is grammar-
 *  owned vocabulary (VERB_TO_KIND/ENTITY_TO_TYPE), so — same as GREETING_
 *  PREAMBLE_RE/THANKS_PREAMBLE_RE/ACK_PREAMBLE_RE above — the strip is
 *  unconditional; no interrogative-lead gate needed. */
const TOPIC_SWITCH_PREAMBLE_RE =
  /^(?:(?:actually|no\s+wait|wait|hold\s+on|never\s+mind|scratch\s+that|on\s+second\s+thought|i\s+mean(?:t)?)[\s,.]+)+(.+)$/i;

/** Apply the closed preamble frames in order (greeting -> modal -> show/give-me),
 *  repeated to a small fixpoint so stacked wrappers ("hey, can you show me X
 *  please") peel fully. Pure and idempotent; unmatched text passes through. */
export function applyPreambleFrames(text) {
  let q = String(text || "");
  // The trouble-aside is a mid-sentence parenthetical, not a start-anchored
  // wrapper — stripped unconditionally, once, before the fixpoint loop (it
  // never interacts with the other frames' anchoring).
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
      // Tier 6 playtest cycle 5: a leading connective ("so") sandwiched
      // BETWEEN two other discourse markers ("aight cool, so actually wait,
      // what calls X") used to block the WHOLE fixpoint — the remainder right
      // after "so" ("actually wait, X") isn't ITSELF a question yet (it still
      // has its own marker prefix), so the original interrogative-only gate
      // rejected the strip, and TOPIC_SWITCH_PREAMBLE_RE (anchored to start)
      // never got a chance at "actually" while "so " still sat in front of
      // it. Also accepting a remainder that matches one of this file's OWN
      // other closed preamble frames is safe by the same logic those frames
      // already rely on: each is anchored + closed-vocabulary, so a match
      // here guarantees the NEXT pass strips it too, not a guess.
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

// ---- ADVANCED_GRAMMAR track (a) (PLAN_ADVANCED_GRAMMAR.md §2): closed-frame
// subordination + conditionals — the proven 0.8.2 preamble-frame method (closed,
// delimiter-anchored, first-match-wins, unmatched text passes through
// byte-unchanged) at its next size up. Two families:
//   SUBORDINATION_FRAMES  strippable leading framing clauses ("since we're
//     refactoring, which modules import x?" -> "which modules import x?") —
//     the clause carries no query content, it's conversational scaffolding
//     around a real question, same species as the greeting/thanks preambles.
//   CONDITIONAL frames    "if <clause>, is it <qualifier>?" compiles to the
//     EXISTING compositional boolean-qualifier shape the grammar already
//     answers ("<kind> <relation-gerund> <object> and <qualifier>" — proven by
//     test/ask-compositional.test.mjs's "classes inheriting from Base and
//     tested"), and the counterfactual "if X were deleted, what would break"
//     compiles to the existing transitive-modifier reverse-dependency closure
//     ("which modules transitively import X" — proven by
//     test/ask.test.mjs's transitive-modifier suite). Both frame families are
//     wired INSIDE normalizeQuery (not as a separate call site) because this
//     agent's scope is normalize.mjs only — ask.mjs/interpret/pipeline.mjs
//     call normalizeQuery already, so embedding here reaches every strategy
//     for free, with no new call site required. A conditional shape NOT
//     covered by these two closed patterns is deliberately left unmatched —
//     the honest-miss discipline PLAN_ADVANCED_GRAMMAR §2a states explicitly
//     ("refuse any conditional whose consequent isn't a computable
//     traversal"): only rewrite to a shape independently verified correct,
//     never a plausible-looking guess. ----

/** Strippable leading framing clause: "since/although/though/while/because/
 *  whereas/given that/now that <clause>, <Q>" -> "<Q>". Delimiter- (comma-)
 *  anchored and non-empty-remainder-required, same discipline as
 *  GREETING_PREAMBLE_RE — a bare "since when do you know that" (no comma
 *  splitting a framing clause from a real question) is NOT a subordination
 *  wrapper and is left alone; "since" as an ordinary temporal content word
 *  ("modules changed since last week", no leading comma-delimited clause)
 *  never matches either. */
const SUBORDINATION_FRAMES_RE =
  /^(?:since|although|though|while|because|whereas|given\s+that|now\s+that)\s+.+?,\s*(.+)$/i;

/** Apply the subordination-frame strip to a small fixpoint (a doubly-wrapped
 *  "well, since X, although Y, <Q>" peels fully — rare, but the same
 *  discipline applyPreambleFrames already uses). Pure; unmatched text passes
 *  through byte-unchanged. */
export function applySubordinationFrames(text) {
  let q = String(text || "");
  for (let pass = 0; pass < 3; pass++) {
    const m = q.match(SUBORDINATION_FRAMES_RE);
    if (!m) break;
    q = m[1].trim();
  }
  return q;
}

// ---- SELF-CORRECTION (found live, playtest sprint round 5, HANDOVER item 12.1): a
// mid-sentence false start, abandoned and restarted — "what -- sorry, who inherits
// from Record", "what is a class -- i mean, what is a module". Same species as the
// preamble/subordination frames above (closed, delimiter-anchored, first-match-wins,
// unmatched text passes through byte-unchanged), sized for a false-start clause
// instead of a leading wrapper clause. The delimiter is the marker phrase "sorry" or
// "i mean" — REQUIRED, with an optional interruption dash ("--"/"—"/"-") in front of
// it and a required trailing separator (dash/comma/colon) after it. Deliberately does
// NOT match on a bare dash alone with no marker word: an ordinary em-dash aside
// ("modules — like Base — that inherit from X") is common prose, not a restart, and
// treating every dash as a delimiter would be a guess this file's discipline forbids
// everywhere else.
//
// Tier 6 playtest tried making the trailing delimiter optional too (to catch
// "what calls listTasks -- oh wait, i mean createTask" — no comma after "i
// mean") and reverted it live: this regex's `.+?` prefix discards EVERYTHING
// before the marker, which is correct for a FULL-CLAUSE restart (the remainder
// is a complete new question, verb included, e.g. "which classes inherit from
// Base") but wrong for an OBJECT-ONLY restart, where the verb clause ("what
// calls") must survive and only the object swaps. Without the delimiter, this
// object-only shape reduced to the bare noun "createTask" alone (no verb at
// all) — a genuine regression from the honest "did you mean listTasks or
// createTask?" ambiguity nudge the UNCHANGED regex already gives (a real
// candidate list including the correct answer is an acceptable FLOW under
// SKILL_CHAT_PLAYTEST.md §0/§2, not a dead end) to a hard wall. Fixing the
// object-only case properly needs verb-clause-preserving logic this closed,
// delimiter-anchored frame mechanism isn't shaped for — left as a genuine,
// narrower ceiling rather than risk widening this proven, tested regex. ----
const SELF_CORRECTION_RE =
  /^.+?(?:\s*(?:--|—|-)\s*)?\b(?:sorry|i\s+mean)\b\s*(?:--|—|-|,|:)\s*(.+)$/i;

/** Apply the self-correction strip to a small fixpoint (a stacked restart —
 *  "what -- sorry, who -- sorry, what inherits from Record" — peels to the final
 *  restart). Pure; unmatched text passes through byte-unchanged. */
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

/** relation-verb (bare 3rd-person singular, the RELATIONS table's own primary
 *  form) -> gerund, the shape the compositional grammar's proven
 *  "<kind> <gerund> <object> and <qualifier>" pattern needs. A small, closed,
 *  hand-curated table (not a generic morphological rule) — the same
 *  "no guessing" discipline as every other closed vocabulary in this file. */
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

/** Counterfactual deletion: "if <X> were/was deleted/removed(,)? what
 *  would/might break/fail/be affected?" -> "which modules transitively import
 *  <X>" — the EXISTING reverse-dependency closure (impactClosure via the
 *  transitive modifier, ask.mjs/codegraph.mjs), proven correct by
 *  test/ask.test.mjs's transitive-modifier suite. Exported so chat.mjs can
 *  independently recognize the SAME raw query shape and prepend a
 *  hypothetical marker to the rendered answer (a hypothetical consequent must
 *  never be presented as an unqualified fact) — normalize.mjs only rewrites
 *  the QUESTION text, it never touches the answer. */
export const COUNTERFACTUAL_RE =
  /^if\s+(.+?)\s+(?:were|was)\s+(?:deleted|removed),?\s*what\s+(?:would|might|could)\s+(?:break|fail|be\s+affected)\??$/i;

/** Apply the two closed CONDITIONAL frames, first-match-wins (qualifier
 *  composition tried first — it is the more specific shape). Pure; unmatched
 *  text passes through byte-unchanged. */
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
 *  politeness words stripped. Idempotent and pure — the same
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
  // "w/" -> "with", leetspeak "4" -> "for" (narrow trigger shapes only) — see
  // the two tables' own docblocks just above for why neither can live in the
  // MISSPELLINGS/WRONG_WORDS tables above this function.
  q = q.replace(W_SLASH_RE, "with");
  q = q.replace(FOR_DIGIT_THANKS_RE, (_, w) => `${w} for`);
  q = q.replace(FOR_DIGIT_EXAMPLE_RE, (_, w) => `for ${w}`);
  q = q.replace(KIND_NOUN_ANAPHORA_RE, (_, pron) => pron);
  q = q.replace(G_DROP, "$1ing");
  // closed preamble frames (greeting lead-in, modal wrapper, show/give-me
  // bridge) — AFTER the correction tables (a repaired "give me"/"show me" still
  // feeds the bridge) but BEFORE the filler strip erases their anchor words.
  q = applyPreambleFrames(q);
  // self-correction (strip an abandoned false-start clause) BEFORE subordination/
  // conditional: a false start can itself look like the OPENING of a subordination
  // clause ("since -- sorry, which modules import X" — "since" would otherwise be
  // read as SUBORDINATION_FRAMES_RE's own anchor), so peeling the restart first
  // means the real remainder is all either frame ever sees.
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
  //   "what else is in X" (0.9.15 Tier-1 single-touch playtest) — the natural
  //   "besides what I already know" drill-down after a members-of-class answer.
  //   Distinct from the "what else does X <verb>" family (which the compositional
  //   grammar already tolerates, dropping "else" as noise on its own): the "is
  //   in" idiom is NOT a compositional marker, so parseComposite never sees it and
  //   "what else is in X" fell through to the strategies with NO candidate at all
  //   (neither recognizes the bare "is in" idiom once "else" sits in front of it).
  //   The only rescue was the relaxation cascade's drop-unmatched layer — but that
  //   layer refuses to accept a relaxed reading that still renders an honest EMPTY
  //   (by design: relaxation must turn a miss into a real answer, never into
  //   another kind of miss), so a genuinely empty class ("what else is in
  //   Task.complete" — a method, no members) bottomed out at the bare grammar
  //   wall instead of the specific "no contains edges" receipt. Routing this
  //   frame onto the SAME direct "what does X contain" path the plain "what is
  //   in X" frame above already uses sidesteps the cascade's conservative gate
  //   entirely, so a real empty is reported honestly instead of walled.
  { re: /^what\s+else\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },

  // WHERE-DEFINED → "where is X defined". PAST TENSE ONLY ("what defined X", "what
  // declared X"): the PRESENT "what defines X" already parses as a reverse-defines
  // query (the module defining symbol X — test/ask.test.mjs pins that), so rewriting
  // it would change that receipt. The past-tense form is the one that hit the wall.
  { re: /^what\s+(?:defined|declared)\s+(?:the\s+)?(?:function\s+|method\s+|class\s+|module\s+|variable\s+|constant\s+)?(.+?)\??$/i, to: (m) => `where is ${m[1]} defined` },
  //   "where's X defined" (the "where's" contraction is not in the contraction table)
  { re: /^where'?s\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },
  //   "were is X defined" (0.9.13 Tier-1 playtest: the missing-h typo of "where").
  //   NOT curated as a blanket MISSPELLINGS entry — "were" is a real word already
  //   load-bearing as the TEMPORAL_AUX auxiliary ("when were the modules last
  //   touched"), so a global word-boundary rewrite would clobber that reading.
  //   This frame is anchored to the WHERE-DEFINED shape specifically ("were is
  //   … defined/declared/located/implemented"), a construction no legitimate
  //   temporal query produces ("were" as an auxiliary never leads directly into
  //   a bare "is").
  { re: /^were\s+is\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },

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

  // DOES-X-VERB-ANYTHING-ELSE → the plain forward "what does X <verb>" listing
  // (0.9.15 Tier-1 single-touch playtest). A very natural drill-down follow-up
  // after a relation answer — "does listTasks call anything else", "does
  // src/handlers/tasks.mjs import something else" — used to dead-end: "anything"/
  // "something" [else] is a placeholder standing in for "the rest of the list",
  // not a real object term, but the two parse strategies disagreed on the SPAN
  // (grammar kept "anything else" whole as the object, keyword-spot dropped
  // "anything" and kept only "else"), landing on the {ambiguousParse} surface —
  // two nonsense readings offered as if one might be right. "what does X <verb>"
  // is the exact working canonical shape (see the MEMBERS-of-class frames above),
  // so rewriting the whole closed pattern onto it sidesteps the disagreement
  // instead of teaching either strategy's tokenizer to special-case "else".
  // Anchored to the closed VERB_TO_KIND vocabulary so it can never swallow a
  // genuine named object that happens to start with "any"/"some" (only the bare
  // placeholder nouns "anything"/"something", optionally trailed by "else", match).
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
  // frequency-adverb filler ("what does X usually change together with", "what does
  // X typically call") — found live: "usually" glued onto the object term instead of
  // being stripped, corrupting resolution ("src/core/store.mjs usually" instead of
  // the module alone). Same trade as every other stopword: a symbol literally named
  // "usually" would be the accepted residual cost.
  "usually", "typically", "generally", "normally", "often", "commonly", "mostly",
  // modal auxiliaries ("what SHOULD i look at first") — found live: with no modal in
  // this set, "should" reached the cascade's bounded fuzzy-correction step and landed
  // within edit distance of the unrelated closed-vocab word "hold" ("defines" synonym,
  // ask-vocab.mjs), corrupting the whole query into "what hold i at". Same trade as
  // every other stopword: a symbol literally named "should" would be the accepted
  // residual cost.
  "should", "would", "could", "can", "will", "shall", "might", "must",
]);

/** Split free text into words: trailing "?" run stripped, commas treated as
 *  spaces, mid-word "." preserved (object terms are routinely dotted file/module
 *  names — "a.py", "utils.mjs"). */
export const splitWords = (text) => String(text).replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);

/** Flatten a phrase list into its lowercase constituent words — the standard way
 *  a vocab table's multi-word phrases feed a word-level set (the cascade's
 *  content-vocab union, the noise-strip KEEP set). */
export const wordsOf = (arr) => arr.flatMap((p) => String(p).toLowerCase().split(" "));
