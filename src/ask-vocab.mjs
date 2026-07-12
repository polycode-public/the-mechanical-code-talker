// ask-vocab.mjs — the single committed vocabulary `ask.mjs`'s grammar, rephrase
// hint, and renderer noun forms all derive from (§3 of PLAN_MECHANICAL_CHAT.md).
// A shipped, hand-curated resource — the same "closed is deliberate" ethos as
// this repo's other closed vocabularies (SEON/mgx predicates, `.tmctignore`'s
// gitignore-subset grammar): an open/unbounded phrase list is unvalidatable and
// eventually produces a false-positive match against an unrelated code
// identifier, so each relation carries a curated (not exhaustive) set of real
// phrasings a developer would type, not a general-English thesaurus dump.
//
// Modeled on marginalia's app/lib/vocab.mjs pattern (a single source of truth
// with a `verbs: [...]` trigger-phrase array per token) — minus the RDF/OWL
// external-alignment machinery, which doesn't apply here: tmct's vocabulary
// is code-relationship-specific (imports/calls/inherits/…), not a general
// knowledge-graph ontology. No NLP library, no lemmatiser — plain phrase lists
// feeding the same fixed-precedence regex grammar `ask.mjs` already used, so
// broadening coverage never risks the "closed, deterministic, zero model
// calls" contract this repo holds at every layer (extraction through query).

/** relation token -> { comment, verbs[] }. Every phrase in `verbs` must be
 *  something a developer would plausibly type asking about THIS relation in
 *  THIS codebase's terms — not a synonym so generic it risks matching an
 *  unrelated question (see the file-level comment; judgment calls on omitted
 *  phrases are logged inline below, not silently dropped).
 *
 *  Register spread (2026-07-02, ELIZA/PARRY-style breadth, PLAN_MECHANICAL_CHAT.md
 *  §3.5): each relation's `verbs` list deliberately spans formal, neutral, and
 *  casual/colloquial phrasings — not just formal synonyms — because the value of
 *  a keyword-spotting matcher is SURFACE-FORM tolerance for the same underlying
 *  intent, not narrow correctness. Registers are grouped with an inline comment
 *  per relation rather than a per-phrase tag (kept flat, matching marginalia's
 *  `verbs: [...]` shape) since ask.mjs only needs phrase -> kind, never the
 *  register itself. A misparsed casual phrase costs nothing beyond an honest
 *  object-miss (resolveObject never guesses), so breadth here is genuinely low-risk. */
// REVERSE inherits phrasings (Seonix Batch 2 Fix 2) — "is X a superclass of Y" /
// "is X a parent class of Y" name the SAME `inherits` relation as the forward
// "is X a subclass of Y" verbs above, but with subject/object semantically
// SWAPPED: the questioner's X is the base, not the derived class. The "a"-forms
// (below) are folded into RELATIONS.inherits.verbs so VERB_TO_KIND maps them to
// kind "inherits" exactly like every forward verb — every existing
// inherits-consuming template/renderer keeps working unmodified — but ALSO kept
// as this separate exported list so the strategies that build "ask" shapes
// (subject-before/object-after by regex capture POSITION, not semantic
// direction — see grammar.mjs T1 and keywords.mjs's decomposition) can detect a
// reverse verb and swap subject/object at parse time, before evaluation ever
// sees it.
//
// Bare "superclass"/"superclasses" (single word, no "is … of" wrapper) are ALSO
// folded in: keyword-spot's decomposition (keywords.mjs) finds a verb phrase as
// a CONTIGUOUS run of words, and the interrogative word order ("is Base a
// superclass of Widget") puts the subject BETWEEN "is" and "a superclass of",
// breaking that contiguity for the 4-word phrase — exactly mirroring why the
// forward direction already carries bare "subclass"/"subclasses" alongside its
// own "is a subclass of" (both above, in RELATIONS.inherits.verbs): the bare
// stem is what actually lets keyword-spot's decomposition recognize the
// aux-first question form ("is Foo a subclass of Bar" only resolves today via
// that same bare "subclass" stem — see grammar.mjs T1's own comment).
//
// The "the"-DEFINITE forms ("is the superclass of", "are the superclass of",
// "is the parent class of") are named in INHERITS_REVERSE_VERBS below (the
// caller-requested literal set) but deliberately NOT folded into
// RELATIONS.inherits.verbs / VERB_TO_KIND: ask.mjs's CONTENT_VOCAB is built by
// splitting every VERB_TO_KIND key into its individual words (wordsOf), so a
// verb phrase containing the bare word "the" would leak "the" itself into
// CONTENT_VOCAB — and the progressive-relaxation cascade's NOISE-STRIP layer
// treats anything in CONTENT_VOCAB as un-strippable content, not noise. Verified
// live: folding the "the"-forms in broke test/ask-cascade.test.mjs's pinned
// NOISE-STRIP/DROP-UNMATCHED/SYNONYM-NORMALISE cases (each expects "the" to stay
// strippable) and test/chatflow-tier2.test.mjs's ESL-pronoun case, all of which
// rely on the pre-existing invariant that NO verb phrase in this file's tables
// ever contains the bare word "the" (confirmed true before this change). So the
// "the"-forms stay honest misses for now — "is a superclass of"/"are a
// superclass of" (the forms this Batch's own tests exercise) work; reinstating
// the "the"-forms would need a CONTENT_VOCAB fix first, out of this fix's scope.
const INHERITS_REVERSE_VERB_LIST = [
  "is a superclass of",
  "are a superclass of",
  "is a parent class of",
  "are a parent class of",
  "superclass", "superclasses",
];

export const RELATIONS = {
  imports: {
    comment: "Module -> Module: subject's import graph references object (usesComplexType).",
    verbs: [
      // formal/neutral ("uses"/"use" moved to the `uses` union family, 2026-07-02 —
      // "uses code from" stays here: its phrasing is specifically import-flavored)
      "couples to", "couple to", "depends on", "imports", "import",
      "relies on", "rely on", "requires", "require", "references", "reference",
      "pulls in", "pull in", "built on", "builds on", "build on", "uses code from",
      // casual/colloquial
      "grabs", "grab", "pulls from", "pull from", "leans on", "lean on",
      "is wired to", "are wired to", "is hooked up to", "are hooked up to",
      // gerund (g-drop normalization turns dialectal "importin'" into this — §3.5)
      "importing",
    ],
  },
  // "uses" is a QUERY-side union family, not a stored predicate (2026-07-02 query
  // families): "what uses X" honestly means BOTH the import graph and the call
  // graph, so ask.mjs traverses it as imports + calls + callsSymbol together
  // (KIND_UNIONS there). The verbs moved here FROM imports — "which modules use X"
  // still answers with the importing modules (the asked Module grain filters the
  // union down to module-grain subjects), and "what uses <function>" now also
  // reaches the symbol-grain callers instead of silently ignoring them.
  uses: {
    comment: "query-side union: imports (Module->Module) + calls (Module->Module) + callsSymbol (fn->fn).",
    verbs: [
      "uses", "use", "used by", "makes use of", "make use of",
      // gerund (g-drop normalization — §3.5)
      "using",
    ],
  },
  calls: {
    comment: "Function/Method -> Function/Class (symbol-grain) or Module -> Module (coarse): subject invokes object.",
    verbs: [
      // formal
      "invokes", "invoke",
      // neutral
      "calls", "call", "runs", "run", "executes", "execute",
      // casual/colloquial
      "hits", "hit", "triggers", "trigger", "fires", "fire", "kicks off", "kick off",
      // gerund (g-drop normalization turns dialectal "callin'" into this — §3.5)
      "calling",
    ],
  },
  defines: {
    comment: "Module -> top-level Function/Class/Method/Attribute: subject declares object.",
    verbs: [
      "defines", "define", "declares", "declare",
      "has", "have", "holds", "hold",
      // gerund (g-drop normalization — §3.5)
      "defining",
    ],
  },
  contains: {
    comment: "Class -> Method/Attribute: subject's membership includes object.",
    verbs: [
      "contains", "contain", "lives in", "live in", "is defined in", "are defined in",
      "is part of", "are part of", "sits in", "sit in", "sits inside", "sit inside",
      // gerund (g-drop normalization — §3.5)
      "containing",
    ],
  },
  tests: {
    comment: "Module -> Module: subject is a test module importing/covering object.",
    verbs: [
      "tests", "test", "covers", "cover", "verifies", "verify", "exercises", "exercise",
      "checks", "check", "makes sure of", "make sure of",
      // gerund (g-drop normalization — §3.5)
      "testing",
    ],
  },
  inherits: {
    comment: "Class -> Class: subject's declared base resolves to object (subclassOf).",
    verbs: [
      "inherits from", "inherit from",
      // bare "inherits"/"inherit" (Tier 6 playtest, §3b surface-variation axis):
      // this list's own SIBLING verb "extends"/"extend" already works bare, with
      // no "from" required, but "inherits"/"inherit" — arguably the MORE common
      // everyday phrasing of the two ("TaskController inherits Controller",
      // "does TaskController inherit Controller") — had no bare form at all,
      // only the "... from" variant. VERB_ALT's longest-first sort (already
      // relied on elsewhere in this file for the same reason) means "inherits
      // from"/"inherit from" still win whenever "from" actually follows, so
      // this is purely additive.
      "inherits", "inherit",
      "extends", "extend", "subclasses", "subclass",
      "derives from", "derive from", "is a subclass of", "are a subclass of",
      "is a kind of", "are a kind of", "is built off", "are built off",
      "is built on top of", "are built on top of",
      // gerund (g-drop normalization — §3.5, and the compositional grammar's
      // gerund-led boolean gate: "classes inheriting from Base but not tested").
      // Both the two-word "inheriting from" (so "from" is consumed into the verb
      // phrase, not the object term) and the bare "inheriting" (the single token
      // the gerund-lead check reads) are listed; longest-match-first prefers the
      // two-word form when "from" follows.
      "extending", "inheriting from", "inheriting", "subclassing", "extends from",
      // REVERSE phrasings (Seonix Batch 2 Fix 2, see INHERITS_REVERSE_VERB_LIST's own
      // comment above): "is/are a|the superclass/parent class of" — folded in here so
      // VERB_TO_KIND maps them to "inherits" like every other verb in this list; the
      // subject/object SWAP their direction requires is handled at parse time by the
      // strategies that build the "ask" shape, not here.
      ...INHERITS_REVERSE_VERB_LIST,
    ],
  },
  touches: {
    comment: "Commit -> Module (coarse) or Commit -> symbol (fine, touchesSymbol): a commit's changed-line-range intersects object.",
    verbs: [
      "touched", "touches", "changed", "change", "modified", "modifies",
      "was changed in", "were changed in", "was edited in", "were edited in",
      "was modified by", "were modified by", "was tweaked in", "were tweaked in",
      "got changed in", "got edited in",
      // commit-question forms (2026-07-02, viewer commit-chat fix): the same touch
      // relation asked from the commit's side — "which changes touch commit <sha>",
      // "what did commit <sha> touch", "which functions changed in <sha>", "which
      // changes landed in commit <sha>", "what was touched by commit <sha>". Bare
      // "touch" completes the touched/touches pair for the "did … touch" auxiliary
      // form; the "by"/"in" phrases are the passive/locative counterparts of forms
      // already above (curated per register spread, not a thesaurus dump).
      "touch", "touched by", "modified by", "changed by", "changed in",
      "landed in", "land in",
      // contents-of-a-commit forms (2026-07-02, operator screenshot: "what was in
      // commit <sha>" missed on the live site). "was in"/"went into" only read as
      // touch questions when the object is a commit — the sha-shaped object keeps
      // them from firing on structural questions ("is X in the graph" has no verb
      // match anyway). Judgment call: "is in" omitted — too generic without the
      // past-tense anchor and risks matching containment phrasings.
      "was in", "were in", "went into", "included in",
      // when-question forms (2026-07-02 query families): "when was X last
      // updated/edited" — bare past participles that only read naturally in the
      // temporal shape; the when template routes them, but they are ordinary
      // touches verbs so "which modules were updated ..." keeps working too.
      "updated", "edited",
      // gerund (g-drop normalization — §3.5)
      "touching",
    ],
  },
  cochange: {
    comment: "Module -> Module: subject and object are frequently committed together (changeCoupledWith).",
    verbs: [
      "changed with", "co-changes with", "co-change with", "changes alongside",
      "change alongside", "shares commits with", "share commits with",
      "tends to change together with", "tend to change together with",
      "moves together with", "move together with",
      // Track-1 trio (temporal lever): the bare "changed/change together with" form
      // (no "tends to"/"tend to" prefix) was missing outright — "which modules
      // changed together with X" fell through to the "touch(ed)" verb instead (a
      // Commit->Module kind, structurally unable to match a Module subject), always
      // producing a confidently-empty answer regardless of real cochange data.
      "changed together with", "change together with", "changes together with",
      // Present-tense bare form (Seonix Batch 4/5 follow-up): only the past tense
      // "changed with" existed above — "what changes with X"/"what usually changes
      // with X" fell through entirely (ENTITY_TO_TYPE's own "changes"->"Change"
      // pseudo-type noun risked consuming the word first; see parseRelationalOrQualified's
      // guard against exactly that in ask.mjs).
      "changes with", "change with", "tends to change with", "tend to change with",
      "usually changes with",
    ],
  },
  reexports: {
    comment: "Module -> exported symbol: subject's public API surface (__all__/export list).",
    verbs: [
      "exports", "export", "re-exports", "re-export", "passes through", "pass through",
      // API-surface phrasing (2026-07-02 query families): "what does <module>
      // expose". Bare "exposed" is NOT listed — the lemma tier maps it here when
      // an adapter is present, and "how does the API get exposed" has no
      // traversal either way (pinned as an honest miss in the tests).
      "exposes", "expose",
      // gerund (g-drop normalization — §3.5)
      "exporting",
    ],
  },
};

/** The closed set of reverse `inherits` verb phrasings a strategy that has already
 *  matched a verb phrase can check ("was this one of the reverse ones?") to decide
 *  whether to swap subject/object before returning its parsed shape (see the
 *  comment above INHERITS_REVERSE_VERB_LIST, right before RELATIONS, for the full
 *  story). Every phrase here EXCEPT the three "the"-definite forms is ALSO folded
 *  into RELATIONS.inherits.verbs (so VERB_TO_KIND routes it to kind "inherits"
 *  like any other inherits verb) — the "the"-forms are named here for
 *  completeness (matching the originally-specified closed set) but are not yet
 *  reachable through VERB_TO_KIND, so a strategy will never actually see one as
 *  a matched verb; keeping them in this list is harmless and future-proofs the
 *  swap check for whenever the CONTENT_VOCAB constraint is lifted. */
export const INHERITS_REVERSE_VERBS = Object.freeze([
  ...INHERITS_REVERSE_VERB_LIST,
  "is the superclass of", "are the superclass of", "is the parent class of",
]);

// ---- where/when/mentions markers (2026-07-02 query families) — the location and
// prose-mention questions carry NO relation verb ("where is X defined", "where is
// X mentioned"), so ask.mjs routes them by these marker words instead of
// VERB_TO_KIND. Closed lists, same curation discipline as everything above. ----

/** Definition-location markers: "where is X <marker>" (or bare "where is X"). */
export const WHERE_MARKERS = Object.freeze(["defined", "declared", "located", "implemented"]);

/** Prose-mention markers: "where is X <marker>" -> the prose/mentions surface. */
export const MENTION_MARKERS = Object.freeze(["mentioned", "referenced"]);

// ---- trailing scope filler (Seonix Batch 2 Fix 3) — a "what is a <noun phrase>"
// question sometimes tacks on a trailing clause that scopes the question back onto
// the graph/codebase ITSELF, not onto any additional term: "what is a Module in
// this graph" means exactly "what is a Module", not a literal lookup of the glued
// phrase "Module in this graph". Closed and curated like every other table here —
// an unlisted trailing clause is left alone (an honest literal lookup), never
// silently swallowed by a general heuristic. ----

/** Trailing filler clauses stripped from the END of a captured meta-whatis object,
 *  case-insensitive, before the term is used as a lookup key. */
export const TRAILING_SCOPE_FILLER = Object.freeze([
  "in this graph", "in the graph", "in this codebase", "in the codebase",
  "in this repo", "in the repo", "here",
]);

const TRAILING_SCOPE_FILLER_RE = new RegExp(
  `\\s+(?:${TRAILING_SCOPE_FILLER.join("|")})\\s*[?.!]*$`, "i",
);

/** Strip ONE trailing scope-filler clause (TRAILING_SCOPE_FILLER, above) off the end
 *  of a captured meta-whatis object — "what is a Module in this graph" resolves the
 *  same term as "what is a Module". Applied once, not in a loop: no worked phrasing
 *  stacks two filler clauses. Every TRAILING_SCOPE_FILLER entry is plain words (no
 *  regex metacharacters), so no escaping is needed building the alternation. */
export function stripTrailingScopeFiller(text) {
  return text.replace(TRAILING_SCOPE_FILLER_RE, "").trim();
}

/** Trailing bare discourse tags — the same curated "then"/"though" pair
 *  ask.mjs's PRED_LEAD_SKIP already recognizes as a trailing discourse tag on
 *  an otherwise-bare follow-up ("how many of those then"). A "what is X"
 *  meta-whatis question wasn't tolerant of this yet: "what is a component
 *  then" captured the literal unknown term "component then" instead of
 *  "component" (HANDOVER.md 2026-07-10, item 8). Stripped the same
 *  closed-list way as TRAILING_SCOPE_FILLER, just above. "too" (playtest
 *  sprint round 2): "is UserController a validator too then" — a STACKED
 *  pair of trailing tags — needed both "too" added to the set AND the strip
 *  applied twice (below), since a single pass only ever removes the
 *  outermost tag. */
export const TRAILING_DISCOURSE_TAG = Object.freeze(["then", "though", "too"]);

const TRAILING_DISCOURSE_TAG_RE = new RegExp(
  `\\s+(?:${TRAILING_DISCOURSE_TAG.join("|")})\\s*[?.!]*$`, "i",
);

/** Trailing COMMA-delimited discourse clauses ("what is a class, please
 *  explain") — a distinct shape from TRAILING_DISCOURSE_TAG above (a bare
 *  space-led tag, no comma): an ESL follow-on clause tacked onto a
 *  meta-whatis term after a comma, meaning "please explain [it]", not part of
 *  the term itself (BENCHMARK_CONVERSATION_1.7.0.md routed backlog C1). Closed
 *  and curated exactly like TRAILING_DISCOURSE_TAG — anchored on a LITERAL
 *  comma immediately before the tag, so this can never fire mid-phrase and
 *  can never touch a term that merely contains a comma for some other reason
 *  (no real code identifier ends in ", please explain" or ", explain"). */
export const TRAILING_DISCOURSE_CLAUSE = Object.freeze(["please explain", "explain"]);

const TRAILING_DISCOURSE_CLAUSE_RE = new RegExp(
  `,\\s*(?:${TRAILING_DISCOURSE_CLAUSE.join("|")})\\s*[?.!]*$`, "i",
);

/** Strip trailing bare discourse tags (TRAILING_DISCOURSE_TAG, above) AND
 *  trailing comma-delimited discourse clauses (TRAILING_DISCOURSE_CLAUSE,
 *  above) off the end of a captured meta-whatis term — "what is a component
 *  then" resolves the same term as "what is a component", and "what is a
 *  class, please explain" resolves the same term as "what is a class".
 *  Applied up to twice (a stacked "too then"/"then too" is the only worked
 *  case that ever needs a second pass; no phrasing seen so far stacks a
 *  third), mirroring stripTrailingScopeFiller's own single-clause discipline
 *  for the common single-tag case while still covering the rarer
 *  double-tag one. The comma-clause strip runs each pass too, so "class,
 *  please explain then" (an unworked but plausible stack) still resolves. */
export function stripTrailingDiscourseTag(text) {
  let out = text;
  for (let pass = 0; pass < 2; pass += 1) {
    let next = out.replace(TRAILING_DISCOURSE_TAG_RE, "").trim();
    next = next.replace(TRAILING_DISCOURSE_CLAUSE_RE, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/** relation token -> flat verb-phrase list, the shape ask.mjs's VERB_TO_KIND
 *  table needs (phrase -> kind), derived once from RELATIONS. */
export const VERB_TO_KIND = Object.freeze(
  Object.fromEntries(
    Object.entries(RELATIONS).flatMap(([kind, { verbs }]) => verbs.map((v) => [v, kind])),
  ),
);

/** "what is a kind of X" / "what is a subclass of X" collision fix (2026-07-11,
 *  live-repro: "boney is a dog" -> "what is a dog" -> "what is a kind of
 *  animal" hit a forced disambiguation wall instead of answering). grammar.mjs's
 *  T5 "meta-whatis" template reads "what is a/an <object>" as a literal
 *  glossary/term-definition question ("what is a Commit"). But some registered
 *  inherits verbs are THEMSELVES phrased "is a <continuation>" ("is a kind
 *  of", "is a subclass of" — RELATIONS.inherits.verbs above) — when the object
 *  T5 captures IS one of these continuations plus a real term ("kind of
 *  animal"), the sentence isn't asking to define the noun phrase "kind of
 *  animal"; it's the exact same question as "what inherits from animal", just
 *  phrased with the verb's own "is a" lead instead of "inherits". keyword-spot
 *  (keywords.mjs) already reads it that way, unambiguously — the meta reading
 *  is the spurious one, and it collides with keyword-spot's correct reading to
 *  manufacture a needless {ambiguousParse} tie (interpret/merge.mjs) over a
 *  phrasing the engine itself just used a turn earlier. Derived from
 *  VERB_TO_KIND (not hand-duplicated) so any future plain "is a/are a X of"
 *  verb phrase added to RELATIONS is covered automatically, without touching
 *  this file again.
 *
 *  Deliberately EXCLUDES every INHERITS_REVERSE_VERBS entry ("is a superclass
 *  of", "is a parent class of") even though they match the same "is a
 *  <continuation>" shape: those verbs' subject/object are semantically
 *  SWAPPED relative to storage direction (see INHERITS_REVERSE_VERB_LIST's own
 *  comment above) — "what is a superclass of X" asks a FORWARD question
 *  (X's own supertype), not this reverse-by-object listing, and keyword-spot's
 *  decomposition only applies that swap in the two-sided "ask" shape (verb
 *  between a subject AND an object), not this "reverse"-only afterText-only
 *  shape. Suppressing the meta reading for these too would trade one honest
 *  {ambiguousParse} wall for a confusing WRONG answer (a reverse-by-object
 *  lookup with the direction backwards) — a separate, pre-existing gap in
 *  keywords.mjs, out of this fix's scope. */
const NON_REVERSE_VERB = (v) => !INHERITS_REVERSE_VERBS.includes(v);
export const ARTICLE_RELATION_CONTINUATIONS = Object.freeze([
  ...new Set(
    Object.keys(VERB_TO_KIND)
      .filter(NON_REVERSE_VERB)
      .map((v) => v.match(/^(?:is|are)\s+an?\s+(.+)$/i))
      .filter(Boolean)
      .map((m) => m[1].toLowerCase()),
  ),
]);

export const ENTITY_TO_TYPE = Object.freeze({
  function: "Function", functions: "Function",
  method: "Method", methods: "Method",
  class: "Class", classes: "Class",
  // "mod"/"mods" (HANDOVER.md 2026-07-10 item 10): a rushed-dev abbreviation
  // prefix ("mod store.mjs imports") used to land in disambiguation instead of
  // resolving cleanly, since nothing recognized "mod" as this same Module noun
  // — same alias-of-Module trade "file"/"files" already make just above.
  module: "Module", modules: "Module", mod: "Module", mods: "Module", file: "Module", files: "Module",
  attribute: "Attribute", attributes: "Attribute", field: "Attribute", fields: "Attribute",
  variable: "GlobalVariable", variables: "GlobalVariable", global: "GlobalVariable", globals: "GlobalVariable",
  // "changes" in a touch question ("which changes touch commit <sha>") means the
  // code entities on the other end of the touch edges, at WHATEVER grain the graph
  // recorded — module (touches) and symbol (touchesSymbol) together when the commit
  // is the given side, and the touching commits themselves when a module/symbol is
  // the given side. Mapped to the pseudo-type "Change" (not a node class): ask.mjs's
  // traverse() reads it as a wildcard over the touch traversal's results rather than
  // aliasing it to ONE real class and silently dropping the other grain of the
  // answer. Listed BEFORE commit/commits: findPhrase (ask.mjs) takes the first
  // same-length phrase in table order, so in "which changes touch commit <sha>" the
  // entity slot must consume "changes" and leave "commit <sha>" intact as the
  // object term.
  change: "Change", changes: "Change",
  commit: "Commit", commits: "Commit",
});

export const MODIFIER_TO_KIND = Object.freeze({
  explicitly: "direct", directly: "direct",
  transitively: "transitive", indirectly: "transitive",
});

// ---- reversible-passive participles (Cycle 6, archive/PLAN_CYCLE_4.md) — past participles ->
// relation kind, for the agent-marked passive "X is <participle> by Y". Kept SEPARATE
// from VERB_TO_KIND on purpose: these forms are NOT standalone active verbs in this
// grammar ("defined" belongs to the multi-word "is defined in" and to the WHERE_MARKERS
// location routing; bare "inherited" has no active key), so folding them into
// VERB_TO_KIND would silently re-route "where is X defined" and other queries. This
// table is consulted ONLY by the keyword strategy's passive path, which has already
// confirmed a passive auxiliary AND an agent-marking "by" — so an active query is never
// affected. Most common participles ("imported"/"tested"/"called"/"covered") already
// reach VERB_TO_KIND via the lemma tier; this table backfills the two families the lemma
// tier can't (defines/inherits) plus the obvious siblings, so the passive works
// adapter-free too. ----
export const PASSIVE_PARTICIPLE_TO_KIND = Object.freeze({
  imported: "imports", called: "calls", used: "uses",
  tested: "tests", covered: "tests", verified: "tests", exercised: "tests", checked: "tests",
  defined: "defines", declared: "defines",
  inherited: "inherits", extended: "inherits", subclassed: "inherits",
  contained: "contains",
  exported: "reexports", "re-exported": "reexports", exposed: "reexports",
  touched: "touches", changed: "touches", modified: "touches", edited: "touches", updated: "touches",
});

// ---- §3.5 normalization — contractions/informal spellings that would otherwise
// block a match, expanded BEFORE parsing (BOTH the anchored-template strategy
// and the independent keyword-spotting strategy see the same normalized text —
// this table is not owned by either). Small and code-question-scoped, not a
// general slang dictionary — every entry here exists because it appears in an
// actual worked example this file's matcher must handle. ----
export const CONTRACTIONS = Object.freeze({
  "ain't": "is not", "aint": "is not",
  "isn't": "is not", "isnt": "is not",
  "aren't": "are not", "arent": "are not",
  "doesn't": "does not", "doesnt": "does not",
  "don't": "do not", "dont": "do not",
  "didn't": "did not", "didnt": "did not",
  "there's": "there is", "theres": "there is",
  "what's": "what is", "whats": "what is",
  "who's": "who is", "whos": "who is",
  "gonna": "going to",
  "wanna": "want to",
  "gotta": "got to",
  "yer": "your", "ur": "your",
  "gimme": "give me",
});

// ---- misspellings and wrong words (2026-07-02, two-level fuzzy work) — these are
// CORRECTIONS, not synonyms: the asker typed a broken or incorrect surface form of
// a word this grammar already owns, and we restore the canonical form BEFORE
// parsing (normalizeQuery applies both tables like CONTRACTIONS: word-boundary,
// longest key first, case-insensitive). Synonyms belong in RELATIONS/ENTITY_TO_TYPE;
// these tables exist so a typo'd or misused word maps to canonical language
// deterministically, ahead of (and more precisely than) ask.mjs's bounded
// edit-distance fallback. ask.mjs's correction regex refuses to rewrite a word
// glued to a dotted extension ("revision.mjs" stays a module name), since
// WRONG_WORDS entries are real English words that plausibly name modules; a
// bare standalone token that happens to be a real identifier remains the
// accepted residual exposure, same as CONTRACTIONS. ----

/** Curated common typos of THIS vocabulary's own keywords — entity nouns, relation
 *  verbs, and the grammar's anchor words (which/what/does/the): a typo'd anchor
 *  kills the anchored templates outright, so anchors earn entries too. Values are
 *  always the canonical word. Judgment calls logged: "calss" maps to "class" (the
 *  doubled-s slip of "class"), NOT "calls", though both are edit-distance 1 — the
 *  exact tie the generic fuzzy tier must refuse to break; a curated table is where
 *  that call is made deliberately. "dose" is a real English word, but at a word
 *  boundary in this closed question grammar ("dose X import Y") the intent is
 *  unambiguous. */
export const MISSPELLINGS = Object.freeze({
  // entity nouns
  "funtion": "function", "funtions": "functions",
  "fucntion": "function", "fucntions": "functions",
  "functoin": "function", "functoins": "functions",
  "calss": "class", "calsses": "classes", "classs": "class", "clases": "classes",
  "modul": "module", "moduls": "modules",
  "moduel": "module", "moduels": "modules",
  "moudle": "module", "moudles": "modules",
  "methdo": "method", "methdos": "methods",
  "mehtod": "method", "mehtods": "methods",
  "comit": "commit", "comits": "commits",
  "commmit": "commit", "commmits": "commits",
  "varaible": "variable", "varaibles": "variables",
  "varibale": "variable", "varibales": "variables",
  "atribute": "attribute", "atributes": "attributes",
  // relation verbs
  "improt": "import", "improts": "imports",
  "imoprt": "import", "imoprts": "imports",
  "inherts": "inherits", "inheirts": "inherits",
  "extands": "extends", "extneds": "extends",
  "depnds": "depends",
  "touchs": "touches", "tuoches": "touches", "touhced": "touched",
  // WHERE_MARKERS typo (0.9.13 Tier-1 playtest): "defined" itself had no typo
  // entry, so "where is it defned" fell through to the bare-object search path
  // instead of the where-shape ("no module matching 'it defned' found").
  "defned": "defined",
  "chagned": "changed", "chnaged": "changed",
  "chagnes": "changes", "chnages": "changes",
  "calles": "calls",
  "exprot": "export", "exprots": "exports",
  "tets": "tests",
  // grammar anchor words
  "whcih": "which", "wich": "which", "whihc": "which",
  // "wehre"/"whre" (0.9.13 Tier-1 playtest, "where is it defined" drill-down):
  // the WHERE-DEFINED shape's own anchor word had NO typo tolerance at all
  // (unlike which/what/does/the above), so a plain dropped/transposed letter
  // fell straight through resolveObject and hit either the grammar wall or a
  // bogus "no module matching 'it defined'" search. "were" (the missing-h
  // homophone slip) is NOT curated here — it's a real word already load-bearing
  // as the TEMPORAL_AUX auxiliary ("when were the modules last touched"), so
  // that one typo is handled by its own anchored phrasing frame instead
  // (normalize.mjs PHRASING_FRAMES) to avoid clobbering the legitimate reading.
  "wehre": "where", "whre": "where",
  // "wat" (chatbench cycle 2, tf-wat-calls): the internet-casual spelling of
  // "what" — neither curated noise nor a restorable trigger typo, so "wat calls
  // fnAlpha" used to die as "couldn't resolve one of the terms". Restored here
  // so BOTH parse strategies and the relaxation cascade see the canonical
  // anchor; the correction regex's dotted-extension guard keeps a module
  // literally named "wat.mjs" untouched, same residual trade as every entry.
  "waht": "what", "wat": "what",
  "dose": "does", "doess": "does",
  "teh": "the",
  // aggregate/list TRIGGER words (2026-07-02, trigger-typo work) — a typo of a count
  // or list trigger used to be DROPPED as unmatched by the relaxation cascade, losing
  // the aggregate/list INTENT entirely ("how manyn classes" → the count was lost);
  // curated here so the intended trigger is restored BEFORE parsing (the general
  // bounded fuzzy path in ask.mjs's cascade is the backstop for uncurated typos).
  "manyn": "many", "mnay": "many", "amny": "many", "mnany": "many",
  // "hwo" (Tier 6 playtest, §3b typo axis): a transposed-letter typo of "how" —
  // "hwo many classes are there" used to lose the aggregate/list trigger
  // outright ("how many" only reads as a count trigger when both words are
  // exact), same failure class as "manyn"/"mnay" just above, one word to the
  // left of it. "how" is grammar-owned via AGGREGATE_TRIGGERS' own "how many"/
  // "how much" entries (test/ask-vocab.test.mjs's canonical-value check
  // splits those multi-word triggers into individual words).
  "hwo": "how",
  "coutn": "count", "conut": "count", "cuont": "count", "ocunt": "count",
  "numer": "number", "nubmer": "number", "numbr": "number", "nmuber": "number",
  "lst": "list", "lsit": "list", "ilst": "list",
  "shwo": "show", "hsow": "show",
  "dispaly": "display", "dsiplay": "display",
  "funtcions": "functions", "funciton": "function", "funcitons": "functions",
});

/** Words used INCORRECTLY but with clear intent, mapped to the canonical schema
 *  term — used like synonyms by the asker, but they are corrections of usage, not
 *  alternative names (which is why they live here and not in ENTITY_TO_TYPE).
 *  Only mapped where intent is unambiguous in a code-graph question; words
 *  deliberately NOT mapped are logged in the omitted-on-purpose block at the end
 *  of this file. */
export const WRONG_WORDS = Object.freeze({
  // neither a folder nor a directory grain exists in this graph — in "which
  // folders import X" the only honest referent is the module/file grain.
  "folder": "module", "folders": "modules",
  "directory": "module", "directories": "modules",
  // unambiguous abbreviation of an entity noun this grammar owns
  "func": "function", "funcs": "functions",
  // VCS terms whose canonical schema class here is Commit
  "changeset": "commit", "changesets": "commits",
  "revision": "commit", "revisions": "commits",
  // code-graph "property" is the Attribute grain in this schema
  "property": "attribute", "properties": "attributes",
});

/** Trailing g-drop ("callin'", "hittin'") — a plain suffix restore, not a
 *  lemmatiser: -in' -> -ing, applied per-word during normalization. The
 *  apostrophe is REQUIRED (not optional): bare "-in" endings with no
 *  apostrophe are real English words far more often than dropped g's
 *  ("cabin", "robin", "chin", "twin") — restoring those would be a false
 *  positive the anchored templates never had to worry about. No trailing
 *  `\b` after the apostrophe: `'` is a non-word character, so a `\b` there
 *  can never match the (non-word) whitespace/end-of-string that follows —
 *  the apostrophe itself already delimits the word, a second boundary check
 *  after it is redundant and unmatchable. */
export const G_DROP = /\b([a-z]{3,})in'/gi;

/** Words stripped during normalization/keyword-spotting once they carry no
 *  grammatical weight for this grammar — greetings, politeness, hedges, and
 *  the discourse fillers a spoken-style question picks up. Never strips a
 *  relation verb, entity noun, or modifier (those are checked first).
 *  Bare "you" (0.9.14 Tier-2 playtest, §3b ESL angle): a non-native word-order
 *  slip ("please you tell me what is Class", "you tell me what is Class") left
 *  a leading "you" that "could you"/"can you"/"would you" don't cover (those
 *  are anchored WRAPPERS requiring the verb-first order) — the leftover
 *  pronoun broke the bare "what is Class" no-article count reading, which
 *  (unlike the "what is a Class" meta form) requires the WHOLE normalized
 *  string to match, not just a substring. "you" carries no grammatical weight
 *  in this code-graph grammar (never a real entity/relation term), so it is
 *  safe to strip anywhere, same trade as every other word in this list. */
export const FILLER_WORDS = Object.freeze([
  "um", "uh", "erm", "so", "like", "yo", "hey", "bru", "bro", "fam", "mate",
  "please", "could you", "can you", "would you", "tell me", "i wonder",
  "just wondering", "quickly", "real quick", "kinda", "sorta",
  "btw", "by the way", "you",
]);

/** Deictic/pronoun terms that refer to a context entity rather than naming one
 *  directly — resolved against an optional `contextId` (ask.mjs §keyword-
 *  spotting; wired from the graph viewer's currently-selected node, when the
 *  chat panel is asking "about" whatever the user last clicked). With no
 *  context available (the bare CLI surface), these produce an honest
 *  "which node does 'this' refer to?" miss — never a guess. */
export const CONTEXT_PRONOUNS = Object.freeze(["this", "it", "that", "here", "this one", "that one"]);

// ---- §3.6 negation frames — a SMALL, pattern-based set of recognized
// double-negative / negative-rhetorical constructions, normalized to the
// affirmative form of the SAME question (not a general negation-scope parser
// — ELIZA/PARRY's own scope discipline: a handful of recognized frames, not
// an attempt at full logical negation handling). Each frame is tried in
// order; the first match rewrites the whole string and normalization stops
// (a second negation frame firing on an already-rewritten string would be a
// design smell, not a feature). ----
export const NEGATION_FRAMES = Object.freeze([
  // "there ain't nothin' calling it" / "there isn't nothing that calls it"
  //   -> "what calls it"
  { re: /\bthere\s+is\s+not\s+(?:anything|nothing)\s+(?:that\s+)?(\S.*)$/i, to: (m) => `what ${m[1]}` },
  // "there's no module that imports auth" -> "what imports auth"
  { re: /\bthere\s+is\s+no\s+\S+\s+(?:that\s+)?(\S.*)$/i, to: (m) => `what ${m[1]}` },
  // "isn't there anything calling it" -> "what calls it" (question-inverted form)
  { re: /\bis\s+not\s+there\s+(?:anything|nothing)\s+(?:that\s+)?(\S.*)$/i, to: (m) => `what ${m[1]}` },
  // "nobody/nothing calls it, does it" (tag-question double-negative) -> "what calls it"
  { re: /\b(?:nobody|nothing|no one)\s+(\S.*?)(?:,?\s+does\s+it\??|,?\s+do\s+they\??)?$/i, to: (m) => `what ${m[1]}` },
]);

// ---- commit-content frames (2026-07-02, operator screenshot: "what was in commit
// ef74e44e25c8" missed on the live site) — "what was/is in commit <sha>", "what's
// in <sha>" (the contraction table has already expanded "what's" by the time
// frames run), "what went into <sha>", "what made it into commit <sha>" all mean
// the canonical commit-subject question "what did <sha> touch", so they are
// REWRITTEN to it before either parse strategy runs: the same mechanism and scope
// discipline as NEGATION_FRAMES (a small closed pattern set, first match wins),
// which also makes both strategies parse the family for free. The sha-shaped tail
// is REQUIRED so these frames only ever fire on an actual commit reference: over a
// non-sha object ("what was in walk.mjs") the frame does not match and the text is
// left for the ordinary grammar to handle as it already does, rather than being
// bent into a commit-subject touches query that would then blank. ----
export const COMMIT_CONTENT_FRAMES = Object.freeze([
  // "what was in commit ef74e44e25c8" / "what is in ef74e44e" / "what's in commit <sha>"
  { re: /^what\s+(?:is|was|were|are)\s+in\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
  // "what went into commit ef74e44e25c8" / casual "what got into <sha>"
  { re: /^what\s+(?:went|got)\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
  // "what made it into commit ef74e44e25c8"
  { re: /^what\s+made\s+it\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
]);

// ---- §7 meta-vocabulary — trigger phrases for the "meta" query shape (asking what a
// graph vocabulary term itself means: "what does cochange mean", "what does mgx:
// callsSymbol mean"). Deliberately NOT folded into RELATIONS/VERB_TO_KIND: these
// phrases don't name a graph relation kind for edgesOfKind to traverse, they name
// "explain this term" intent. Adding them to VERB_TO_KIND would make
// parseKeywordSpot's decomposition matcher independently derive a *different* shape
// ("forward", the only shape its before-only-text case produces) for the very same
// sentence the anchored meta template resolves to shape:"meta" — a spurious strategy
// DISAGREEMENT (ambiguousParse) on every meta question. So this table is read directly
// by ask.mjs's own meta template, never merged into the shared verb tables. ----
export const META_MEANING_VERBS = Object.freeze([
  "mean", "means", "stand for", "stands for", "signify", "signifies",
  "represent", "represents", "refer to", "refers to",
]);

// ---- §compositional grammar vocabulary (PLAN §5.16 P3 — the ask engine's step up
// from ELIZA keyword-spotting to a real recursive-descent grammar over CLAUSES).
// ask.mjs's parseComposite reads these tables to recognize the compositional
// MARKERS — relative clauses, boolean connectives, subject qualifiers, aggregates,
// superlatives, and anaphora — that compose the SAME closed clause vocabulary
// (RELATIONS/ENTITY_TO_TYPE above) into multi-hop / set-algebra queries. The
// grammar COMPOSES the closed vocabulary; it never opens it. Every table here is
// curated + closed, same discipline as everything above: a marker the tables don't
// carry is an honest miss, never a guess. ----

/** Relative-clause introducers: "<noun> that/which/who <predicate>". Only ever
 *  read as a relative pronoun when it sits AFTER a noun and BEFORE a predicate
 *  (ask.mjs enforces both) — "that" is also a CONTEXT_PRONOUN ("what calls that"),
 *  so position, not mere presence, decides. This gates the nested/relative and
 *  same-subject boolean shapes: their absence is exactly what keeps the bare
 *  reverse-template query "which classes extends Base and couples to logging" out
 *  of the compositional path (it stays the existing two-strategy ambiguous parse). */
export const RELATIVE_PRONOUNS = Object.freeze(["that", "which", "who"]);

/** Placeholder object nouns — the indefinite "something" in "what calls something
 *  that imports X": they name NO entity, they stand in for the inner clause's
 *  result set. Mapped to entityType null (any grain); a real entity noun in the
 *  same slot ("what calls modules that import X") narrows the grain instead. */
export const PLACEHOLDER_NOUNS = Object.freeze([
  "something", "anything", "everything", "somethings", "things", "thing",
  "entities", "entity", "nodes", "node", "stuff", "code",
  // "symbol(s)" is a grain-agnostic stand-in for any code entity — "exported
  // symbols of X" means whatever X defines, at any grain, filtered by the qualifier.
  "symbol", "symbols",
]);

/** Boolean connectives over same-subject clauses -> a set operation on result ids.
 *  "and" = intersection, "or" = union, "but not"/"and not"/"without"/"except" =
 *  difference. Multi-word keys are matched longest-first by ask.mjs so "but not"
 *  wins over a bare "not". Left-associative in ask.mjs's fold. */
export const BOOLEAN_CONNECTIVES = Object.freeze({
  "but not": "difference", "and not": "difference", "except": "difference",
  "without": "difference",
  "and": "intersection", "plus": "intersection",
  "or": "union",
});

/** Subject QUALIFIERS (adjectives) -> a post-filter over the result set, read off
 *  attributes/edges the graph already carries (codegraph.mjs): `visibility`
 *  (private/protected present; public is the default/absent), `isStatic`/
 *  `isConstant`/`isAbstract` boolean attrs, the reexports edge set (exported), and
 *  the tests edge set (tested/untested). `isAbstract` is never populated by any
 *  extractor today (codegraph.mjs says so) — "abstract methods" therefore honestly
 *  returns an empty set, not an error, exactly like any other zero-hit answer. An
 *  UNKNOWN qualifier is an honest miss naming these supported ones (ask.mjs). */
export const QUALIFIERS = Object.freeze({
  public: { via: "visibility", value: "public" },
  private: { via: "visibility", value: "private" },
  protected: { via: "visibility", value: "protected" },
  static: { via: "attr", attr: "isStatic" },
  abstract: { via: "attr", attr: "isAbstract" },
  constant: { via: "attr", attr: "isConstant" },
  exported: { via: "exported" },
  "re-exported": { via: "exported" },
  tested: { via: "tested", value: true },
  covered: { via: "tested", value: true },
  untested: { via: "tested", value: false },
  uncovered: { via: "tested", value: false },
});

/** Aggregate/count triggers: "how many <kind> …", "count <kind>s", "number of
 *  <kind>". Answered by counting a class of individuals or a clause's result set —
 *  no header magic, a straight count over the graph (ask.mjs). Register-spread the
 *  same way RELATIONS' verbs are (2026-07-02): the count question has a formal
 *  ("how many"/"number of"), a neutral/imperative ("count"/"count up"), and a
 *  quantity ("quantity of"/"total number of") register a developer actually types.
 *  Judgement calls, kept OUT deliberately: bare "tally"/"sum"/"total" — those are
 *  already mapped to "count" by CASCADE_SYNONYMS (ask.mjs's relaxation layer), and a
 *  cascade test asserts "tally the classes" reaches the count via that synonym path,
 *  so promoting them to direct triggers here would both duplicate the mapping and
 *  break that test; and single-word "total"/"sum" would false-match identifier
 *  fragments ("total price", "sum of squares") the count intent never meant. */
export const AGGREGATE_TRIGGERS = Object.freeze([
  // formal ("the number of classes" reaches "number of" once the cascade strips the
  // leading article — keeping the trigger list clear of "the" so it never enters
  // CONTENT_VOCAB and blocks the article's own noise-strip)
  "how many", "how much", "how many of", "number of",
  "total number of", "quantity of",
  // "<measure> of <kind>" cardinality forms (widened net, cycle W2P): count = sum = total
  // = tally = number of. The bare single words (sum/total/tally) stay CASCADE_SYNONYMS-
  // mapped to "count" (identifier-fragment risk without the "of" anchor — see that table's
  // note); the multi-word "of" forms are safe to promote to direct triggers because the
  // trailing "of <kind>" pins them to a cardinality question, not a stray identifier.
  "tally of", "sum of", "total of", "amount of",
  // neutral / imperative (bare "tally"/"sum"/"total" stay CASCADE_SYNONYMS-mapped so the
  // "tally the classes" relaxation path — pinned by a cascade test — is preserved).
  "count", "count up", "count of", "tot up",
]);

/** LIST triggers (2026-07-02, list shape) — the many ways a developer asks to SEE the
 *  individuals of a kind ("list functions", "show me the classes", "what are the
 *  modules"). Read by ask.mjs's parseList (a sibling of the count node): a trigger
 *  followed by an entity kind noun lists that class (capped at OVERFLOW_CAP), a
 *  trailing scope/predicate narrows it, and an unknown kind after a clear list trigger
 *  is an honest miss naming the kinds. Two registers, wide-but-deliberate (the operator's
 *  "err toward inclusion", bounded by the file-header discipline: a phrase earns its
 *  place only if it genuinely means "enumerate these" and won't false-match an unrelated
 *  identifier — parseList further requires a real entity kind to follow, so a stray
 *  "show"/"name" in another question is never seized):
 *   · IMPERATIVE — "<verb> [me/us] [the] <kind>". Bare determiners/objects (the/a/all/
 *     me/us) after the verb are skipped by parseList's LIST_SKIP, so only the verb stem
 *     is listed here (not every "... the"/"... all" inflection).
 *   · INTERROGATIVE — "what/which are [the] <kind>"; the bare "what <kind>"/"which
 *     <kind>" (+ optional "are there") form is handled directly in parseList, not here.
 *  Kept OUT on purpose: "tell me" / "give me" collide only where normalizeQuery already
 *  strips them as FILLER_WORDS ("tell me the classes" → "the classes"), so "tell me" is
 *  omitted (it never survives to parseList); "gimme" is omitted because CONTRACTIONS
 *  rewrites it to "give me" before parseList runs. */
export const LIST_TRIGGERS = Object.freeze([
  // imperative — "<verb> [me/us] [the] <kind>"
  "list", "show", "show me", "show us", "display", "print", "print out",
  "dump", "enumerate", "name", "give me", "get me", "spit out", "rattle off",
  "run down", "run through", "ls",
  // interrogative — "what/which are [the] <kind>"
  "what are", "which are",
]);

/** Superlative extremes -> ranking direction. "most/greatest/highest/biggest/
 *  largest/most-connected" rank descending; "fewest/least/smallest/lowest" rank
 *  ascending. Read by ask.mjs's parseSuperlative alongside EDGE_NOUN_TO_METRIC. */
export const SUPERLATIVE_EXTREMES = Object.freeze({
  most: "most", greatest: "most", highest: "most", biggest: "most",
  largest: "most", "most-connected": "most", "most connected": "most",
  fewest: "fewest", least: "fewest", smallest: "fewest", lowest: "fewest",
});

/** Degree-metric nouns for superlatives ("which module has the most <noun>") ->
 *  {kind, dir} over the SAME classified edge groups. dir "out" counts edges where
 *  the ranked entity is the subject (its own imports/calls); "in" counts edges
 *  where it is the object (its importers/callers/tests). "connections"/"edges"/
 *  "connected" is the total (both directions, all structural kinds). A `sibling`
 *  fine-grained kind is added to the tally when present (callers include the
 *  symbol-grain callsSymbol edges, not just module-coarse calls); a `filter`
 *  restricts the counted objects to one class ("methods"). */
export const EDGE_NOUN_TO_METRIC = Object.freeze({
  imports: { kind: "imports", dir: "out" },
  dependencies: { kind: "imports", dir: "out" },
  importers: { kind: "imports", dir: "in" },
  dependents: { kind: "imports", dir: "in" },
  callers: { kind: "calls", dir: "in", sibling: "callsSymbol" },
  callees: { kind: "calls", dir: "out", sibling: "callsSymbol" },
  calls: { kind: "calls", dir: "out", sibling: "callsSymbol" },
  methods: { kind: "contains", dir: "out", filter: "Method" },
  members: { kind: "contains", dir: "out" },
  tests: { kind: "tests", dir: "in" },
  test: { kind: "tests", dir: "in" }, // singular ("needs a test") — same edge as plural "tests"
  subclasses: { kind: "inherits", dir: "in" },
  connections: { kind: "*", dir: "both" },
  edges: { kind: "*", dir: "both" },
  connected: { kind: "*", dir: "both" },
  // participle degree-nouns (widened net, cycle W2P): "the most imported / most
  // depended-on / most used <module>" ranks by IN-degree — how many things import/depend
  // on/use it — the ARGMAX-by-degree intent a developer expresses with a passive
  // participle rather than the noun ("importers"). "depended" catches "depended-on" /
  // "depended on" (both tokenize to a bare "depended"); "used" folds the symbol-grain
  // callsSymbol callers in alongside importers so "most used" reads as most-relied-upon.
  imported: { kind: "imports", dir: "in" },
  "depended-on": { kind: "imports", dir: "in" },
  depended: { kind: "imports", dir: "in" },
  used: { kind: "imports", dir: "in", sibling: "callsSymbol" },
  called: { kind: "calls", dir: "in", sibling: "callsSymbol" },
});

/** Metric nouns whose edge kind targets exactly ONE entity class in this graph's
 *  ontology (only a Module is ever the object of a `tests` edge) — read by
 *  ask.mjs's parseSuperlative to default `entityType` when a superlative names a
 *  metric but no explicit entity noun ("what most needs a test", vs. the fully
 *  explicit "which MODULE has the most tests"). Deliberately small: a metric like
 *  "calls"/"connections" targets more than one class, so it is NOT listed here —
 *  those keep requiring an explicit entity noun, same as before this table existed. */
export const METRIC_IMPLIES_ENTITY = Object.freeze({
  tests: "Module",
  test: "Module",
});

/** Anaphora triggers over the PREVIOUS result set (ask()'s `prev` id array):
 *  "which of those/them/these …", "how many of those …". The pronoun refers to the
 *  last answer's ids, not a graph term — with no prev supplied it is an honest miss
 *  (ask.mjs), never a guess, exactly like an unresolved context pronoun. */
export const ANAPHORA_TRIGGERS = Object.freeze(["those", "them", "these"]);

/** Membership relations for "<entity> of/in <term>" (qualifier/relative inner
 *  clauses like "public methods of Widget", "untested functions in walk.mjs") ->
 *  the forward edge kinds whose subject is <term> and whose objects are the
 *  members. contains (Class->member) and defines (Module->symbol) are both tried;
 *  the asked entity type narrows the result. */
export const MEMBERSHIP_KINDS = Object.freeze(["contains", "defines"]);

// ---- §progressive-relaxation cascade vocabulary (SHRDLU-in-a-code-graph, with a
// Zork parser's forgiveness) — the three closed, curated tables ask.mjs's relaxParse
// reads when the DIRECT parse of a query would MISS. The cascade only ever DROPS
// noise/unmatched words or NORMALISES a near-canonical word to the closed vocabulary;
// it never invents a term or guesses an entity, and it bottoms out in the same honest
// rephrase hint. Every entry is hand-curated with inline provenance, same "closed is
// deliberate" ethos as everything above: a word these tables don't carry is left for
// the honest miss, never a general-English stoplist that would silently eat a real
// code term. ----

/** Politeness / filler / vocative / presentation-frame tokens the cascade may strip
 *  ONE AT A TIME (leftmost first) when a query misses — but only ever a token that is
 *  NOT itself a content vocabulary word (a relation verb, entity noun, modifier,
 *  qualifier, aggregate/superlative trigger, …) and does NOT resolve to a graph entity
 *  (ask.mjs guards both), so a module literally named "show" or "the" is never eaten.
 *  This is a SUPERSET of the multi-word politeness FILLER_WORDS strips up-front during
 *  normalization: those handle "could you"/"tell me"/"please" before either parse runs;
 *  these single tokens catch what a spoken-style question keeps AFTER that pass — the
 *  bare vocative ("matey"), the article ("the"/"a"), and the presentation frame words
 *  ("show"/"me"/"list") that the compositional grammar already skips as FRAME_WORDS but
 *  the keyword-spotting strategy does not, so an un-stripped "show me" otherwise
 *  decomposes to a bogus ask{subject:"show me"}. Curated, not a general stoplist:
 *  question words (what/which/…), connectives (and/or), and pronouns (this/it/that)
 *  are deliberately ABSENT — they carry grammatical weight and must survive. */
export const CASCADE_NOISE = Object.freeze([
  // articles / vague determiners (kept OUT of content vocab so they're strippable;
  // the aggregate/where parsers already tolerate a stray "the"/"a", so stripping is
  // belt-and-braces, not load-bearing)
  "the", "a", "an", "some",
  // topic lead-in filler — "what about the modules", "how about classes": "about"
  // carries no graph meaning here, so stripping it lets the bare kind noun surface for
  // the cascade's bare-kind-noun terminal rule (ask.mjs). ("what"/"how" are structural
  // question words the drop-pass keeps; only the "about" between them and the kind is
  // noise.) A module literally named "about" is safe-listed by relaxParse's resolvesExact
  // guard, same as every other noise token.
  "about",
  // politeness / hedges (single-token; multi-word "could you"/"please" etc. are
  // FILLER_WORDS, stripped earlier during normalization)
  "please", "pls", "plz", "kindly", "just", "simply", "maybe", "perhaps",
  "thanks", "thank", "ta", "cheers",
  // greetings a question sometimes opens with (chat.mjs owns standalone greetings;
  // here they're only stripped when embedded in an otherwise-real question)
  "hi", "hello", "hey", "yo", "hiya", "howdy", "ok", "okay",
  // vocatives / terms of address (the "matey" of the worked example, and its kin)
  "matey", "mate", "buddy", "pal", "dude", "man", "bro", "bru", "fam",
  "friend", "sir", "maam", "folks", "guys", "everyone", "dear",
  // the product's OWN name used as an address (chatbench cycle 2, ns-hey-tmct:
  // "hey tmct, what calls fnAlpha thanks") — a vocative like "matey", stripped
  // by the same rules: relaxParse's resolvesExact guard still protects a module
  // literally named "tmct", and noise-strip's template/keyword-spot acceptance
  // bounds the cost of a mid-question strip to an honest object-miss.
  "tmct",
  // presentation frames — the keyword-spotting strategy's blind spot: the
  // compositional grammar skips these as FRAME_WORDS, but "show me what imports X"
  // otherwise decomposes (via keyword-spot) to ask{subject:"show me"}. Stripping
  // them on a miss recovers the underlying reverse/forward question. ("count" is NOT
  // here — it is an aggregate trigger; "find"/"search" are here as presentation
  // verbs, not the tmct_search tool, which ask.mjs never dispatches.)
  "show", "tell", "give", "list", "find", "me", "us", "lemme",
]);

/** Near-canonical words the cascade REWRITES to the closed vocabulary once noise and
 *  unmatched tokens are gone (SYNONYM-NORMALISE, the cascade's third layer). Kept
 *  deliberately TINY and aggregate-flavoured: the relation/entity synonyms a developer
 *  actually types already live in RELATIONS/ENTITY_TO_TYPE (and "uses"/"depends on" are
 *  mapped there); this table only closes the gap for the count family, whose triggers
 *  (AGGREGATE_TRIGGERS) don't include the "tally the classes"/"total number of classes"
 *  register. Each key is also kept OUT of the drop pass (ask.mjs treats a synonym key as
 *  meaningful) so it survives to be normalised rather than dropped as unmatched. The
 *  rewrite is guarded by ask.mjs (never applied to a token that resolves to a graph
 *  entity), so a symbol named "total" is never bent into "count". */
export const CASCADE_SYNONYMS = Object.freeze({
  tally: "count", tallies: "count", sum: "count", total: "count", totals: "count",
});

/** Explicit help / orientation requests — when the WHOLE query is one of these, ask.mjs
 *  shows the rephrase hint DIRECTLY (the honest bottom of the cascade, reached on
 *  demand) rather than pretending to answer or running the relaxation loop. A closed
 *  set matched against the whole normalized query only, so "which functions call help"
 *  (a real question about a symbol named "help") is untouched. Standalone greetings and
 *  the chat "/help" command are chat.mjs's own surface; this is the bare CLI ask()
 *  entry point's equivalent. */
export const HELP_TRIGGERS = Object.freeze([
  "help", "help me", "how do i ask", "how do i use this", "what can i ask",
  "what can you ask", "usage", "commands", "examples", "syntax", "options",
]);

// ---- omitted-on-purpose (judgment calls, not oversights) -------------------
// "runs"/"executes" (calls) are common English words with many non-code
// senses — accepted anyway, formal-template AND keyword-spotting alike,
// because a misparse costs nothing beyond an honest object-miss
// (resolveObject never guesses); the risk is bounded by the render layer,
// not by narrowing the vocabulary.
// NOT added: "needs"/"wants" for imports (too weakly code-specific — "which
// modules need auth" reads as a feature request, not a graph query, in a way
// "which modules depend on auth" doesn't); "wraps"/"decorates" for calls (a
// real but distinct relationship codegraph.mjs doesn't classify separately —
// adding the phrase would silently misroute it onto plain call edges);
// "belongs to" for contains (already claimed by a hypothetical membership
// verb elsewhere — kept out to avoid a future collision if one is added).
// NOT added: a cochange gerund ("co-changing with") — every cochange phrase
// is already 2-3 words with its own internal "-ing"/"-s" (e.g. "changes
// alongside"), so g-drop normalization has no bare stem to dialectally
// contract in the first place; only relations with a genuinely bare-verb
// casual form ("call", "touch") needed one.
// WRONG_WORDS not mapped (judgment calls): "script(s)" (routinely names a real
// module/identifier — rewriting it could corrupt an object term, and file/files
// already covers the honest synonym); "package(s)" (a genuinely coarser grain
// this graph doesn't model — mapping it to module would silently answer a
// different question than the one asked); "fn" (too short and too often a real
// identifier fragment to rewrite at a word boundary).
