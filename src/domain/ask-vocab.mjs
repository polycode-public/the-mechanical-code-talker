// ask-vocab.mjs — the closed, curated vocabulary `ask.mjs`'s grammar, rephrase
// hint, and renderer noun forms derive from. No NLP library or lemmatiser:
// plain phrase lists feeding the same fixed-precedence regex grammar.

/** relation token -> { bare, comment, verbs[] }. Each `verbs` list spans formal,
 *  neutral, and casual phrasings of the same relation; a misparse costs
 *  nothing beyond an honest object-miss (resolveObject never guesses).
 *
 *  `bare` is the relation's base verb form, for frames that need an infinitive
 *  rather than the inflected relation token ("modules that do not IMPORT x",
 *  where the token would read "do not imports"). Hand-curated per relation, the
 *  same closed-vocabulary discipline as `verbs`: deriving it by stripping an
 *  "s" is a morphology rule that gets "touches" and "co-change with" wrong. */
// Reverse `inherits` phrasings ("is X a superclass of Y") name the same
// relation as the forward verbs above but with subject/object swapped, so
// they're kept in INHERITS_REVERSE_VERB_LIST too: strategies that build "ask"
// shapes use it to detect a reverse verb and swap subject/object at parse
// time. The "the"-definite forms ("is the superclass of") are deliberately
// NOT folded into RELATIONS.inherits.verbs/VERB_TO_KIND: CONTENT_VOCAB is
// built by splitting every VERB_TO_KIND key into words, and no verb phrase
// here may contain the bare word "the" without breaking the relaxation
// cascade's noise-strip pass — so those forms stay honest misses.
const INHERITS_REVERSE_VERB_LIST = [
  "is a superclass of",
  "are a superclass of",
  "is a parent class of",
  "are a parent class of",
  "superclass", "superclasses",
];

export const RELATIONS = {
  imports: {
    bare: "import",
    comment: "Module -> Module: subject's import graph references object (usesComplexType).",
    verbs: [
      // formal/neutral ("uses code from" stays here: its phrasing is
      // specifically import-flavored)
      "couples to", "couple to", "depends on", "imports", "import",
      "relies on", "rely on", "requires", "require", "references", "reference",
      "pulls in", "pull in", "built on", "builds on", "build on", "uses code from",
      // casual/colloquial
      "grabs", "grab", "pulls from", "pull from", "leans on", "lean on",
      "is wired to", "are wired to", "is hooked up to", "are hooked up to",
      // gerund (g-drop normalization turns dialectal "importin'" into this)
      "importing",
    ],
  },
  // query-side union, not a stored predicate: ask.mjs traverses "uses" as
  // imports + calls + callsSymbol together (KIND_UNIONS).
  uses: {
    bare: "use",
    comment: "query-side union: imports (Module->Module) + calls (Module->Module) + callsSymbol (fn->fn).",
    verbs: [
      "uses", "use", "makes use of", "make use of",
      // casual: "what does app.mjs talk to" is the union question a newcomer
      // actually asks — imports and calls together, which is what "uses" is.
      "talks to", "talk to",
      // gerund (g-drop normalization)
      "using",
    ],
  },
  calls: {
    bare: "call",
    comment: "Function/Method -> Function/Class (symbol-grain) or Module -> Module (coarse): subject invokes object.",
    verbs: [
      // formal
      "invokes", "invoke",
      // neutral
      "calls", "call", "runs", "run", "executes", "execute",
      // casual/colloquial
      "hits", "hit", "triggers", "trigger", "fires", "fire", "kicks off", "kick off",
      // gerund (g-drop normalization turns dialectal "callin'" into this)
      "calling",
    ],
  },
  defines: {
    bare: "define",
    comment: "Module -> top-level Function/Class/Method/Attribute: subject declares object.",
    verbs: [
      "defines", "define", "declares", "declare",
      "has", "have", "holds", "hold",
      // gerund (g-drop normalization)
      "defining",
    ],
  },
  contains: {
    bare: "contain",
    comment: "Class -> Method/Attribute: subject's membership includes object.",
    verbs: [
      "contains", "contain", "lives in", "live in", "is defined in", "are defined in",
      "is part of", "are part of", "sits in", "sit in", "sits inside", "sit inside",
      // gerund (g-drop normalization)
      "containing",
    ],
  },
  tests: {
    bare: "test",
    comment: "Module -> Module: subject is a test module importing/covering object.",
    verbs: [
      "tests", "test", "covers", "cover", "verifies", "verify", "exercises", "exercise",
      "checks", "check", "makes sure of", "make sure of",
      // gerund (g-drop normalization)
      "testing",
    ],
  },
  inherits: {
    bare: "inherit from",
    comment: "Class -> Class: subject's declared base resolves to object (subclassOf).",
    verbs: [
      "inherits from", "inherit from",
      "inherits", "inherit",
      "extends", "extend", "subclasses", "subclass",
      "derives from", "derive from", "is a subclass of", "are a subclass of",
      "is a kind of", "are a kind of", "is built off", "are built off",
      "is built on top of", "are built on top of",
      // gerund, incl. compositional grammar's gerund-led boolean gate
      // ("classes inheriting from Base but not tested")
      "extending", "inheriting from", "inheriting", "subclassing", "extends from",
      ...INHERITS_REVERSE_VERB_LIST,
    ],
  },
  touches: {
    bare: "touch",
    comment: "Commit -> Module (coarse) or Commit -> symbol (fine, touchesSymbol): a commit's changed-line-range intersects object.",
    verbs: [
      "touched", "touches", "changed", "change", "modified", "modifies",
      "was changed in", "were changed in", "was edited in", "were edited in",
      "was modified by", "were modified by", "was tweaked in", "were tweaked in",
      "got changed in", "got edited in",
      // the same touch relation asked from the commit's side ("what did
      // commit <sha> touch"). "touched by"/"modified by"/"changed by" are absent
      // on purpose: they mark a passive AGENT, so swallowing the "by" here would
      // hide the passive from the strategy that reads it and invert the operands.
      "touch", "changed in",
      "landed in", "land in",
      // "was in"/"went into" only read as touch questions against a
      // sha-shaped object
      "was in", "were in", "went into", "included in",
      "updated", "edited",
      // gerund (g-drop normalization)
      "touching",
    ],
  },
  cochange: {
    bare: "co-change with",
    comment: "Module -> Module: subject and object are frequently committed together (changeCoupledWith).",
    verbs: [
      "changed with", "co-changes with", "co-change with", "changes alongside",
      "change alongside", "shares commits with", "share commits with",
      "tends to change together with", "tend to change together with",
      "moves together with", "move together with",
      "changed together with", "change together with", "changes together with",
      "changes with", "change with", "tends to change with", "tend to change with",
      "usually changes with",
    ],
  },
  reexports: {
    bare: "re-export",
    comment: "Module -> exported symbol: subject's public API surface (__all__/export list).",
    verbs: [
      "exports", "export", "re-exports", "re-export", "passes through", "pass through",
      "exposes", "expose",
      // gerund (g-drop normalization)
      "exporting",
    ],
  },
  // serves/denotes classify edges a PROVIDER declares (mgx:serves / mgx:denotes).
  // tmct's own indexer emits neither, so they are absent from a graph it built
  // and answer honestly empty there; a provider graph that carries them gets the
  // same one-hop traversal every other kind gets, instead of only /describe's
  // kind-agnostic edge walk.
  serves: {
    bare: "serve",
    comment: "subject provides or backs the object — a handler serving a route, a module serving a surface (mgx:serves).",
    verbs: [
      "serves", "serve",
      // gerund (g-drop normalization)
      "serving",
    ],
  },
  denotes: {
    bare: "denote",
    comment: "subject names the object — a glossary/lexicon term denoting a code entity (mgx:denotes).",
    verbs: [
      "denotes", "denote",
      // gerund (g-drop normalization)
      "denoting",
    ],
  },
};

/** The closed set of reverse `inherits` verb phrasings a strategy checks to
 *  decide whether to swap subject/object. The three "the"-definite forms are
 *  named here but not reachable through VERB_TO_KIND (see above). */
export const INHERITS_REVERSE_VERBS = Object.freeze([
  ...INHERITS_REVERSE_VERB_LIST,
  "is the superclass of", "are the superclass of", "is the parent class of",
]);

// ---- where/when/mentions markers: these questions carry no relation verb,
// so ask.mjs routes them by marker word instead of VERB_TO_KIND. ----

/** Definition-location markers: "where is X <marker>" (or bare "where is X"). */
export const WHERE_MARKERS = Object.freeze(["defined", "declared", "located", "implemented"]);

/** Temporal adverbs a locative question may trail ("where is disk-1 now"). They
 *  carry no meaning the graph can read — the answer is the same with or without
 *  one — so they are stripped rather than bound as part of the term. A closed set:
 *  the term itself is free text, and only a listed word may be taken off it. */
export const TRAILING_TEMPORAL_ADVERBS = Object.freeze(["now", "currently", "right now", "at the moment", "these days", "today"]);

/** Prose-mention markers: "where is X <marker>" -> the prose/mentions surface. */
export const MENTION_MARKERS = Object.freeze(["mentioned", "referenced"]);

// ---- trailing scope filler: "what is a Module in this graph" resolves the
// same term as "what is a Module". ----

/** Trailing filler clauses stripped from the end of a captured meta-whatis
 *  object, case-insensitive, before the term is used as a lookup key. */
export const TRAILING_SCOPE_FILLER = Object.freeze([
  "in this graph", "in the graph", "in this codebase", "in the codebase",
  "in this repo", "in the repo", "here",
]);

const TRAILING_SCOPE_FILLER_RE = new RegExp(
  `\\s+(?:${TRAILING_SCOPE_FILLER.join("|")})\\s*[?.!]*$`, "i",
);

/** Strip one trailing scope-filler clause off the end of a captured
 *  meta-whatis object. Applied once: no worked phrasing stacks two. */
export function stripTrailingScopeFiller(text) {
  return text.replace(TRAILING_SCOPE_FILLER_RE, "").trim();
}

/** Trailing bare discourse tags ("how many of those then"). "too" can stack
 *  ("is UserController a validator too then"), hence the double pass below. */
const TRAILING_DISCOURSE_TAG = Object.freeze(["then", "though", "too"]);

const TRAILING_DISCOURSE_TAG_RE = new RegExp(
  `\\s+(?:${TRAILING_DISCOURSE_TAG.join("|")})\\s*[?.!]*$`, "i",
);

/** Trailing comma-delimited discourse clauses ("what is a class, please
 *  explain"), anchored on a literal comma so this never fires mid-phrase. */
const TRAILING_DISCOURSE_CLAUSE = Object.freeze(["please explain", "explain"]);

const TRAILING_DISCOURSE_CLAUSE_RE = new RegExp(
  `,\\s*(?:${TRAILING_DISCOURSE_CLAUSE.join("|")})\\s*[?.!]*$`, "i",
);

/** Strip trailing discourse tags and comma-delimited clauses off a captured
 *  meta-whatis term. Applied up to twice for a stacked "too then". */
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

/** The bare possessive "has"/"have"/"holds"/"hold" is bucketed onto `defines`
 *  (RELATIONS.defines.verbs above) for genuine code shapes ("what modules
 *  does app.mjs have", "does createTask have tests") — but those reach the
 *  grammar/keyword-spot strategies pre-rewritten onto a different verb by
 *  normalize.mjs's PHRASING_FRAMES (has-tests -> "what tests X", members ->
 *  "what does X contain"), and the possession/property sense of "have" over a
 *  TAUGHT individual ("does whiskers have fur") is answered entirely by
 *  chat.mjs's own has-a/hasProperty readers, upstream of both strategies. So
 *  a bare have-family verb reaching either strategy's TWO-NAMED-ROLE "ask"
 *  shape ("does X have Y", free-text subject and object, no grain check) has
 *  no legitimate code question left to mean, and confidently framing it as
 *  "locate what a module/class defines" is worse than an honest miss — both
 *  grammar.mjs (T1/T2/T3) and keywords.mjs check this set to decline instead.
 *  Shared here (rather than declared per-file) so the two strategies' bundled
 *  builds never collide on the same top-level identifier. */
export const HAS_FAMILY_VERBS = Object.freeze(new Set(["has", "have", "holds", "hold"]));

/** "what is a kind of X" / "what is a subclass of X" collision fix: some
 *  inherits verbs are themselves phrased "is a <continuation>", which would
 *  otherwise collide with grammar.mjs's literal meta-whatis reading and
 *  manufacture a spurious {ambiguousParse}. Derived from VERB_TO_KIND so any
 *  future "is a/are a X of" verb is covered automatically. Excludes
 *  INHERITS_REVERSE_VERBS: those verbs' subject/object are swapped relative
 *  to storage direction, so suppressing their meta reading would produce a
 *  wrong answer instead of an honest ambiguity. */
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
  module: "Module", modules: "Module", mod: "Module", mods: "Module", file: "Module", files: "Module",
  // "Package" is a pseudo-type like "Change" below: no node is ever stored
  // with that class. ask.mjs derives packages from module labels, the same
  // derivation the architecture map uses.
  package: "Package", packages: "Package",
  attribute: "Attribute", attributes: "Attribute", field: "Attribute", fields: "Attribute",
  variable: "GlobalVariable", variables: "GlobalVariable", global: "GlobalVariable", globals: "GlobalVariable",
  // "Change" is a pseudo-type, not a node class: ask.mjs's traverse() reads it
  // as a wildcard over touch-traversal results (module or symbol grain).
  // Listed before commit/commits since findPhrase takes the first
  // same-length match in table order.
  change: "Change", changes: "Change",
  commit: "Commit", commits: "Commit",
});

export const MODIFIER_TO_KIND = Object.freeze({
  explicitly: "direct", directly: "direct",
  transitively: "transitive", indirectly: "transitive",
});

// ---- reversible-passive participles: past participles -> relation kind, for
// the agent-marked passive "X is <participle> by Y". Kept separate from
// VERB_TO_KIND because these aren't standalone active verbs ("defined" would
// otherwise clobber the WHERE_MARKERS routing); only consulted once a passive
// auxiliary + agent-marking "by" is confirmed. ----
export const PASSIVE_PARTICIPLE_TO_KIND = Object.freeze({
  imported: "imports", called: "calls", used: "uses",
  tested: "tests", covered: "tests", verified: "tests", exercised: "tests", checked: "tests",
  defined: "defines", declared: "defines",
  inherited: "inherits", extended: "inherits", subclassed: "inherits",
  contained: "contains",
  exported: "reexports", "re-exported": "reexports", exposed: "reexports",
  touched: "touches", changed: "touches", modified: "touches", edited: "touches", updated: "touches",
});

// ---- stacked reduced-relative clauses: a "<participle> <preposition>" bigram
// that opens a reduced relative modifying a head noun ("classes INHERITED FROM
// Widget DEFINED IN c.mjs"). Each entry names the relation kind and which role
// the following term fills:
//   role "object" — the surface is active-disguised, the preposition marks the
//     relation's OBJECT, so the answer is the SUBJECTS pointing at the term (a
//     reverse traversal): "inherited from Widget" -> the classes that inherit
//     Widget.
//   role "agent"  — a genuine passive whose "by"/"in" marks the AGENT, so the
//     answer is the term's own FORWARD targets: "defined in c.mjs" -> what
//     c.mjs defines.
// Only consulted by parseStackedReducedRelative, which requires TWO such
// bigrams on one head noun; a single reduced relative keeps its existing route.
// Naming senses and directionally-ambiguous bigrams ("imported from", "used
// in/for", "called <name>") are deliberately absent so they stay honest misses.
export const REDUCED_RELATIVE_CLAUSES = Object.freeze({
  "inherited from": { kind: "inherits", role: "object" },
  "extended from": { kind: "inherits", role: "object" },
  "subclassed from": { kind: "inherits", role: "object" },
  "defined in": { kind: "defines", role: "agent" },
  "declared in": { kind: "defines", role: "agent" },
  "contained in": { kind: "contains", role: "agent" },
  "imported by": { kind: "imports", role: "agent" },
  "called by": { kind: "calls", role: "agent" },
  "used by": { kind: "uses", role: "agent" },
  "tested by": { kind: "tests", role: "agent" },
  "covered by": { kind: "tests", role: "agent" },
  "touched by": { kind: "touches", role: "agent" },
  "changed by": { kind: "touches", role: "agent" },
  "exported by": { kind: "reexports", role: "agent" },
});

// ---- normalization: contractions/informal spellings expanded before parsing,
// shared by both parse strategies. ----
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

// ---- misspellings and wrong words: corrections, not synonyms — restore the
// canonical form before parsing (word-boundary, longest key first,
// case-insensitive), ahead of ask.mjs's bounded edit-distance fallback. The
// correction regex refuses to rewrite a word glued to a dotted extension
// ("revision.mjs" stays a module name). ----

/** Curated typos of this vocabulary's own keywords: entity nouns, relation
 *  verbs, and grammar anchor words (which/what/does/the). Values are always
 *  the canonical word. */
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
  "touchs": "touches", "tuoches": "touches", "touhced": "touched", "touchd": "touched",
  "defned": "defined",
  "chagned": "changed", "chnaged": "changed",
  "chagnes": "changes", "chnages": "changes",
  "calles": "calls",
  "exprot": "export", "exprots": "exports",
  "tets": "tests",
  // grammar anchor words
  "whcih": "which", "wich": "which", "whihc": "which",
  // "were" (the missing-h homophone slip of "where") is NOT curated here —
  // it's a load-bearing TEMPORAL_AUX word ("when were the modules touched").
  "wehre": "where", "whre": "where",
  "waht": "what", "wat": "what",
  "dat": "that",
  "dose": "does", "doess": "does",
  "teh": "the",
  "manyn": "many", "mnay": "many", "amny": "many", "mnany": "many", "hwo": "how",
  "coutn": "count", "conut": "count", "cuont": "count", "ocunt": "count",
  "numer": "number", "nubmer": "number", "numbr": "number", "nmuber": "number",
  "lst": "list", "lsit": "list", "ilst": "list",
  "shwo": "show", "hsow": "show",
  "dispaly": "display", "dsiplay": "display",
  "funtcions": "functions", "funciton": "function", "funcitons": "functions",
});

/** Words used incorrectly but with clear intent, mapped to the canonical
 *  schema term — corrections of usage, not alternative names (hence not in
 *  ENTITY_TO_TYPE). */
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

/** Trailing g-drop ("callin'", "hittin'"): -in' -> -ing. The apostrophe is
 *  required — bare "-in" endings are real words far more often than dropped
 *  g's ("cabin", "robin", "twin"). */
export const G_DROP = /\b([a-z]{3,})in'/gi;

/** Words stripped during normalization/keyword-spotting once they carry no
 *  grammatical weight — greetings, politeness, hedges, discourse fillers.
 *  Never strips a relation verb, entity noun, or modifier. */
export const FILLER_WORDS = Object.freeze([
  "um", "uh", "erm", "so", "like", "yo", "hey", "bru", "bro", "fam", "mate",
  "please", "could you", "can you", "would you", "tell me", "i wonder",
  "just wondering", "quickly", "real quick", "kinda", "sorta",
  "btw", "by the way", "you",
  "quick q",
]);

/** Deictic/pronoun terms resolved against an optional `contextId` (the graph
 *  viewer's currently-selected node). With no context, an honest miss. */
export const CONTEXT_PRONOUNS = Object.freeze(["this", "it", "that", "here", "this one", "that one"]);

// ---- negation frames: a small set of double-negative / negative-rhetorical
// constructions, normalized to the affirmative form. First match wins. ----
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

// ---- commit-content frames: "what was in commit <sha>" etc. rewrite to the
// canonical "what did <sha> touch" before either parse strategy runs. The
// sha-shaped tail keeps this from firing on a non-commit object. ----
export const COMMIT_CONTENT_FRAMES = Object.freeze([
  // "what was in commit ef74e44e25c8" / "what is in ef74e44e" / "what's in commit <sha>"
  { re: /^what\s+(?:is|was|were|are)\s+in\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
  // "what went into commit ef74e44e25c8" / casual "what got into <sha>"
  { re: /^what\s+(?:went|got)\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
  // "what made it into commit ef74e44e25c8"
  { re: /^what\s+made\s+it\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
]);

// ---- meta-vocabulary: trigger phrases for "what does cochange mean"-style
// term-explanation questions. Kept out of RELATIONS/VERB_TO_KIND — these name
// "explain this term" intent, not a graph relation to traverse. ----
export const META_MEANING_VERBS = Object.freeze([
  "mean", "means", "stand for", "stands for", "signify", "signifies",
  "represent", "represents", "refer to", "refers to",
]);

// ---- compositional grammar vocabulary — ask.mjs's parseComposite reads these
// to recognize relative clauses, boolean connectives, qualifiers, aggregates,
// superlatives, and anaphora that compose RELATIONS/ENTITY_TO_TYPE into
// multi-hop / set-algebra queries. ----

/** Relative-clause introducers: "<noun> that/which/who <predicate>". Read as
 *  a relative pronoun only after a noun and before a predicate — "that" is
 *  also a CONTEXT_PRONOUN, so position decides. */
export const RELATIVE_PRONOUNS = Object.freeze(["that", "which", "who"]);

/** Placeholder object nouns ("what calls something that imports X"): name no
 *  entity, stand in for the inner clause's result set (entityType null). */
export const PLACEHOLDER_NOUNS = Object.freeze([
  "something", "anything", "everything", "somethings", "things", "thing",
  "entities", "entity", "nodes", "node", "stuff", "code",
  "symbol", "symbols",
]);

/** Boolean connectives over same-subject clauses -> a set operation on result ids.
 *  "and" = intersection, "or" = union, "but not"/"and not"/"without"/"except" =
 *  difference. The do-support negations ("but do not import Y", the expanded
 *  form every "don't" reaches after the contraction pass) are difference too —
 *  the auxiliary is part of the connective, never of the branch. A bare "but"
 *  is contrastive coordination, which still intersects ("inheriting from X but
 *  untested" = both at once). Multi-word keys are matched longest-first by
 *  ask.mjs so "but do not" wins over "but not" wins over a bare "but".
 *  Left-associative in ask.mjs's fold. */
export const BOOLEAN_CONNECTIVES = Object.freeze({
  "but do not": "difference", "but does not": "difference",
  "and do not": "difference", "and does not": "difference",
  "but not": "difference", "and not": "difference", "except": "difference",
  "without": "difference",
  "and": "intersection", "plus": "intersection",
  "but": "intersection",
  "or": "union",
});

/** Subject qualifiers (adjectives) -> a post-filter over the result set, read
 *  off attributes/edges the graph already carries. `isAbstract` is never
 *  populated by any extractor today, so "abstract methods" honestly returns
 *  an empty set, not an error. */
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

/** Agent words naming no particular thing, for the "is X <qualifier> by <agent>"
 *  tail. "is X covered by tests" and "is X tested by anything" are asking the
 *  plain coverage property, so they stay on the qualifier-check path; a NAMED
 *  agent ("…by logger.mjs") is asking about that agent's own edges instead. */
export const GENERIC_AGENT_WORDS = Object.freeze(new Set([
  "tests", "test", "anything", "something", "anyone", "someone", "any",
]));

/** Aggregate/count triggers: "how many <kind> …", "count <kind>s", "number of
 *  <kind>". Bare "tally"/"sum"/"total" are deliberately excluded — they're
 *  identifier-fragment risks ("total price") and stay CASCADE_SYNONYMS-mapped
 *  instead. */
export const AGGREGATE_TRIGGERS = Object.freeze([
  "how many", "how much", "how many of", "number of",
  "total number of", "quantity of",
  "tally of", "sum of", "total of", "amount of",
  "count", "count up", "count of", "tot up",
]);

/** List triggers ("list functions", "show me the classes"). Read by
 *  ask.mjs's parseList: a trigger followed by an entity kind noun lists that
 *  class; an unknown kind is an honest miss. "tell me"/"gimme" are omitted —
 *  both normalize away before parseList runs. */
export const LIST_TRIGGERS = Object.freeze([
  "list", "show", "show me", "show us", "display", "print", "print out",
  "dump", "enumerate", "name", "give me", "get me", "spit out", "rattle off",
  "run down", "run through", "ls",
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
 *  {kind, dir}. dir "out" counts the ranked entity as subject; "in" as object.
 *  `sibling` adds a fine-grained kind to the tally; `filter` restricts to one class. */
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
  // participle degree-nouns rank by in-degree, same intent as "importers" etc
  imported: { kind: "imports", dir: "in" },
  "depended-on": { kind: "imports", dir: "in" },
  depended: { kind: "imports", dir: "in" },
  used: { kind: "imports", dir: "in", sibling: "callsSymbol" },
  called: { kind: "calls", dir: "in", sibling: "callsSymbol" },
});

/** Metric nouns whose edge kind targets exactly one entity class — lets
 *  parseSuperlative default `entityType` when no explicit noun is given
 *  ("what most needs a test"). */
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

// ---- progressive-relaxation cascade vocabulary: the tables ask.mjs's
// relaxParse reads when the direct parse of a query would miss. Only ever
// drops noise/unmatched words or normalises a near-canonical word; never
// invents a term or guesses an entity. ----

/** Politeness/filler/vocative/presentation-frame tokens the cascade may strip
 *  one at a time on a miss — never a content-vocabulary word, and never a
 *  token that resolves to a graph entity (ask.mjs guards both). */
export const CASCADE_NOISE = Object.freeze([
  "the", "a", "an", "some", "other", "about",
  "please", "pls", "plz", "kindly", "just", "simply", "maybe", "perhaps",
  "thanks", "thank", "ta", "cheers",
  "too", "also", "well", "either",
  "sorry", "oops", "actually", "mean", "meant", "rather",
  "hi", "hello", "hey", "yo", "hiya", "howdy", "ok", "okay",
  "matey", "mate", "buddy", "pal", "dude", "man", "bro", "bru", "fam",
  "friend", "sir", "maam", "folks", "guys", "everyone", "dear",
  "tmct",
  "show", "tell", "give", "list", "find", "me", "us", "lemme",
]);

/** Near-canonical words the cascade rewrites to the closed vocabulary once
 *  noise/unmatched tokens are gone. Kept tiny: only closes the count-family
 *  gap ("tally the classes") that AGGREGATE_TRIGGERS doesn't cover. */
export const CASCADE_SYNONYMS = Object.freeze({
  tally: "count", tallies: "count", sum: "count", total: "count", totals: "count",
});

/** Explicit help/orientation requests: when the whole query is one of these,
 *  ask.mjs shows the rephrase hint directly. */
export const HELP_TRIGGERS = Object.freeze([
  "help", "help me", "how do i ask", "how do i use this", "what can i ask",
  "what can you ask", "usage", "commands", "examples", "syntax", "options",
]);
