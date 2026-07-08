// ask.mjs — a mechanical (zero-model-call) natural-language query engine over the
// tmct graph. PLAN_MECHANICAL_CHAT.md (P0): a small, closed English grammar
// compiles a free-text question into a graph traversal over the SAME classified
// relation groups codegraph.mjs's other render functions read, then renders a
// templated, citation-faithful answer. No embeddings, no generative model calls —
// a miss is a stated blank, never a guess (the extraction pipeline's "no wrong
// edge" ethos, held at the query layer too). Term/keyword matching is TIERED
// (2026-07-02, two-level fuzzy): exact curated match always wins; a Node-only
// wink-nlp LEMMA/POS tier and a bounded Damerau-Levenshtein FUZZY tier fire only
// on a miss, a unique fuzzy hit is announced in the answer ("assuming you
// meant …"), and any tie surfaces as ambiguity — never a silently-broken guess.
//
// Four pure, independently-testable stages, orchestrated by ask():
//   parseQuery (grammar)  ->  resolveObject (mechanical term resolution)  ->
//   traverse (graph lookup)  ->  render (templates).
//
// §3.5/3.6 (2026-07-02, ELIZA/PARRY-style breadth; split into src/interpret/ for
// ROADMAP items 8/10/13): parseQuery normalizes the raw text (contractions,
// g-drop, filler-strip — interpret/normalize.mjs), rewrites recognized negative-
// rhetorical constructions to their affirmative form, then runs the REGISTERED
// parsing STRATEGIES over the same normalized text (interpret/pipeline.mjs) —
// the original anchored-template matcher (interpret/strategies/grammar.mjs:
// precise, fast, unweakened) and a keyword-spotting/decomposition matcher
// (interpret/strategies/keywords.mjs — ELIZA's own mechanism: find the keyword,
// decompose around it, tolerate reordering/casual phrasing) — and MERGES their
// results (interpret/merge.mjs): one strategy hit -> use it; hits that agree ->
// use it (high confidence); same-class hits that DISAGREE -> a genuine
// parse-level ambiguity, surfaced honestly; no hits -> the honest grammar miss.
// STRATEGIES is a plain registration array (interpret/pipeline.mjs) so further
// strategies (Phase 2's ACE grammar) join the same way, not a hardcoded
// two-branch special case.
//
// Where a parsed intent is temporal/churn-shaped (touched/since/cochange as a
// FILTER over commits, not a structural edge), this engine does NOT re-implement
// that — see PLAN_MECHANICAL_CHAT.md §2: matchQuery/nlToQuery (temporal.mjs) already
// own that surface for the Chronograph browser; ask.mjs's own `touches`/`cochange`
// verbs here answer "which modules touch/co-change with X" as ONE-HOP structural
// edges (mgx:touchedByCommit / mgx:changeCoupledWith), which is a different (and
// simpler) question than the browser's time-scrubbing view.

import { relationKind, impactClosure, normPath } from "./codegraph.mjs";
import {
  VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND,
  CONTEXT_PRONOUNS, META_MEANING_VERBS,
  WHERE_MARKERS, MENTION_MARKERS,
  RELATIVE_PRONOUNS, PLACEHOLDER_NOUNS, BOOLEAN_CONNECTIVES, QUALIFIERS,
  AGGREGATE_TRIGGERS, LIST_TRIGGERS, SUPERLATIVE_EXTREMES, EDGE_NOUN_TO_METRIC, ANAPHORA_TRIGGERS,
  MEMBERSHIP_KINDS, CASCADE_NOISE, CASCADE_SYNONYMS, HELP_TRIGGERS,
} from "./ask-vocab.mjs";
// The interpretation layer (ROADMAP items 8/10/13) — the movable conversational
// grammar, split out of this file: normalization pre-pass, the two parsing
// strategies, and the bounded-fuzzy service. Re-exported below where existing
// callers/tests import them from here.
import { normalizeQuery, applyNegationFrames, applyPhrasingFrames, matchNegationSet, STOPWORDS, splitWords, wordsOf } from "./interpret/normalize.mjs";
import { editDistance, fuzzyBound } from "./interpret/fuzzy.mjs";
import { parseAnchored } from "./interpret/strategies/grammar.mjs";
import { parseKeywordSpot, findPhrase } from "./interpret/strategies/keywords.mjs";
import { runStrategiesSync } from "./interpret/pipeline.mjs";
import { mergeStrategyResults } from "./interpret/merge.mjs";
import { lookupByProseTokens } from "./prose.mjs";

// Normalization stays importable from its original site (tests + chat surface).
export { normalizeQuery, applyNegationFrames };
// The OPTIONAL Node-only wink-nlp adapter (lemma/POS tier). BOUNDARY: the inlined
// viewer bundle (viz.mjs askSource) strips this import line and never inlines
// ask-nlp.mjs, so in the browser `nlpAdapter` is simply an undeclared identifier —
// defaultNlp() below reads it through `typeof`, the one operator that touches an
// undeclared name without throwing, and the portable single-file HTML degrades to
// adapter-less parsing (curated tables + bounded fuzzy still on) instead of
// shipping a ~1MB language model inside the page.
import { nlpAdapter } from "./ask-nlp.mjs";

/** Per-graph, per-kind memo for THIS file's own edgesOfKind copy — same WeakMap<graph,
 *  Map<kind, edge[]>> shape as codegraph.mjs's twin (and this file's own qualCache,
 *  below), kept as an independent cache rather than sharing codegraph.mjs's (same
 *  commit-boundary reasoning as the function copy itself: both derive the identical
 *  result from the identical relationKind classification, so two caches can never
 *  disagree, only duplicate a little memory). Correctness rests on the same
 *  invariant qualCache already relies on: a loaded graph's `relations` are never
 *  mutated in place (a refresh always builds a NEW graph object via parseEntities).
 *  Deliberately NAMED DIFFERENTLY from codegraph.mjs's `edgesOfKindCache` — the
 *  inlined viewer bundle (viz.mjs's askSource) literally CONCATENATES a stripped
 *  codegraph.mjs + this file into one classic script (test/ask-nlp.test.mjs pins
 *  this), so two `const`s with the same name would be a real SyntaxError there. */
const askEdgesOfKindCache = new WeakMap();

/** All edges of a classified relation kind, flattened across relation groups —
 *  a local copy of codegraph.mjs's private edgesOfKind (kept local rather than
 *  exported+imported to avoid coupling this file's commit boundary to concurrent
 *  in-flight edits elsewhere in codegraph.mjs; both read the same relationKind
 *  classification, so they cannot drift in meaning). Memoized per (graph, kind) —
 *  perf lever, HANDOVER follow-up #8: this is the query engine's hottest path,
 *  called repeatedly on the same (graph, kind) pair across a single query's
 *  compositional evaluation, and at monorepo scale (tens of thousands of modules)
 *  the repeated O(relations) scan is a real latency/GC cost — not a correctness
 *  fix (the stack-overflow bug this file's twin comment references is already
 *  fixed and unrelated). */
function edgesOfKind(graph, kind) {
  let byKind = askEdgesOfKindCache.get(graph);
  if (!byKind) { byKind = new Map(); askEdgesOfKindCache.set(graph, byKind); }
  const cached = byKind.get(kind);
  if (cached) return cached;
  const out = [];
  // Plain-loop append, NOT out.push(...g.edges): argument spread overflows the call
  // stack past ~100k edges on graph-scale relation groups (see codegraph.mjs twin).
  for (const g of graph.relations) {
    if (relationKind(g) !== kind) continue;
    for (const e of g.edges) out.push(e);
  }
  byKind.set(kind, out);
  return out;
}

// ---- §3 vocabulary — single-sourced in ./ask-vocab.mjs; the grammar, the
// rephrase-hint text, and the renderer's noun forms all derive from those
// three tables, so they cannot drift. ----

// Predicate kinds carrying a finer, symbol-grain sibling (module-coarse -> fn/method-precise).
// "which functions call X" should read off callsSymbol (fn->fn), not the module-coarse "calls".
const SYMBOL_GRAIN_SIBLING = { calls: "callsSymbol", touches: "touchesSymbol" };
const FINE_ENTITY_TYPES = new Set(["Function", "Method", "Class", "Attribute", "GlobalVariable"]);
// The fn/method FAMILY (0.8.2 WS1): callers of a symbol are recorded at whichever
// grain the extractor saw (a method Widget.render is class "Method"), but a person
// asking "which functions call X" means the callable family, not the storage class.
// Used ONLY as an empty-result fallback (see traverse's reverse symbol-grain path):
// an exact-class answer is never widened, so every non-empty answer is byte-stable.
const FINE_CLASS_SIBLING = { Function: "Method", Method: "Function" };

// Query-side UNION families (2026-07-02 query families): a parsed kind that is not
// itself a stored predicate but a curated union of stored kinds — "what uses X"
// honestly means the import graph AND the call graph together. Everything else
// maps to itself; grain selection (asked entity type) then narrows the union's
// subjects the same way it narrows a single kind's.
const KIND_UNIONS = { uses: ["imports", "calls", "callsSymbol"] };
const kindsFor = (kind) => KIND_UNIONS[kind] || [kind];

const OVERFLOW_CAP = 12;

const PLURAL_FORMS = {
  Function: ["function", "functions"], Method: ["method", "methods"],
  Class: ["class", "classes"], Module: ["module", "modules"],
  Attribute: ["attribute", "attributes"], GlobalVariable: ["variable", "variables"],
  Commit: ["commit", "commits"],
  // "Change" is ask-vocab.mjs's pseudo-type (a wildcard over the touch traversal's
  // results, never a node class) — it still needs noun forms for zero-hit templates.
  Change: ["change", "changes"],
};
function nounFor(entityType, n) {
  const [s, p] = PLURAL_FORMS[entityType] || ["result", "results"];
  return n === 1 ? s : p;
}

// Every relation KIND token is already the correct 3rd-person-singular verb form
// ("X imports Y", "X calls Y", "X touches Y") EXCEPT "cochange", the one kind whose
// name is a bare noun/verb stem ("X cochange Y" is wrong; "X cochanges Y" is right) —
// so the reverse-shape zero-hit template below reads off this table instead of
// unconditionally appending "s" (which used to double-pluralize every other kind:
// "callss", "importss", "touchess"). "reexports" -> "export" (Bug B3, HANDOVER
// follow-up #2): the raw internal kind identifier "reexports" leaked straight into
// the forward-miss prose ("X has no reexports edges in the index") — the human
// word for this relation is "export" ("X has no export edges in the index"),
// matching every other kind's already-natural phrasing.
const REVERSE_MISS_VERB = { cochange: "cochanges", reexports: "export" };
function verbFor(kind) {
  return REVERSE_MISS_VERB[kind] || kind;
}

// Leading-relation-verb strip for the tests-kind honest empty (0.8.2 WS1): the
// keyword strategy can match the "tests" NOUN as the relation verb and leave the
// user's OWN verb at the head of the object term ("do any tests touch f.mjs" →
// object "touch f.mjs"), which the old ^cover-only strip missed ("No tests cover
// touch app/lib/f.mjs."). The closed list is read from ask-vocab.mjs's exported
// VERB_TO_KIND (derived from the RELATIONS verb table — the source of truth,
// including the `tests` kind's own verbs: cover/check/verify/exercise/…), longest
// phrase first so multi-word verbs strip whole; a bare optional s/ing/ed tail keeps
// the previously-stripped inflections ("covering") without enumerating them. Only
// ever applied to the tests-kind zero-hit template's object — never to resolution.
const LEADING_RELATION_VERB_RE = new RegExp(
  `^(?:${Object.keys(VERB_TO_KIND)
    .sort((a, b) => b.length - a.length)
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})(?:s|ing|ed)?\\s+`,
  "i",
);

// ---- the parsing strategies + normalization + fuzzy service formerly defined
// here now live in src/interpret/ (items 8/10/13): interpret/normalize.mjs
// (normalizeQuery, applyNegationFrames, STOPWORDS, splitWords), interpret/
// strategies/grammar.mjs (parseAnchored, the anchored TEMPLATES), interpret/
// strategies/keywords.mjs (parseKeywordSpot, findPhrase), interpret/fuzzy.mjs
// (editDistance, fuzzyBound — also resolveObject's tier-5 budget below). ----

// ---- strategy merge — now the interpret PIPELINE (item 8): the registered
// strategies (interpret/pipeline.mjs STRATEGIES — grammar, keyword-spot, …) run
// over the normalized text and interpret/merge.mjs merges them: same-class
// agreement dedupes to one parse, same-class disagreement is the honest
// {ambiguousParse, candidates} surface, and distinct-class alternates carry the
// "if you mean X then …" surround (unused on this synchronous path — parseQuery
// keeps the winning parse only, byte-identical to the original two-way merge). ----

/** The default lemma/POS adapter: wink-nlp when this is a Node process with the
 *  optional deps installed, null otherwise. BOUNDARY (see the import comment):
 *  the inlined viewer bundle strips the ask-nlp.mjs import, so `nlpAdapter` is
 *  an UNDECLARED identifier there — `typeof` reads it without throwing and the
 *  browser path degrades to no adapter, same parse pipeline otherwise. */
function defaultNlp() {
  return typeof nlpAdapter === "function" ? nlpAdapter() : null;
}

/** Compile a free-text question into {shape, kind, entityType, modifier,
 *  object[, subject]}, or null if NO strategy fits — an honest grammar
 *  miss (§6.3), never a best-effort guess. When strategies parse and
 *  AGREE, returns that parse unchanged (no fallback ordering — either
 *  strategy's own result is equally valid once they agree, per §above: "use
 *  either"). When they parse but DISAGREE (different shape/kind/term),
 *  returns {ambiguousParse: true, candidates: [...]} — a genuine "this could
 *  mean more than one thing" case, distinct from resolveObject's later
 *  object-resolution ambiguity. Routed through interpret/pipeline.mjs +
 *  interpret/merge.mjs (item 8) — the two legacy strategies at their existing
 *  precedence produce identical winners. `opts.nlp` overrides the lemma/POS
 *  adapter (pass null to force the adapter-less browser behavior in a Node
 *  test); leaving it undefined picks the deterministic default (defaultNlp).
 *  Pure given (query, adapter) — the adapter itself is a fixed model, no
 *  sampling. */
export function parseQuery(query, { nlp = undefined } = {}) {
  const adapter = nlp === undefined ? defaultNlp() : nlp;
  const raw = String(query || "").trim().replace(/\s+/g, " ");
  if (!raw) return null;
  const text = applyPhrasingFrames(applyNegationFrames(normalizeQuery(raw)));
  if (!text) return null;
  // COMPOSITIONAL PARSE PATH (PLAN §5.16 P3) — the new PRIMARY layer: a recursive
  // descent over CLAUSES for the compositional shapes (nested/relative, boolean,
  // qualifiers, aggregates, superlatives, anaphora). It fires ONLY when a
  // compositional MARKER is present and returns null otherwise, so every plain
  // clause falls straight through to the unchanged strategy pipeline below — the
  // whole existing grammar is preserved bit-for-bit. When a marker IS present but
  // the phrase cannot be compiled, it returns an honest {node:"miss"} rather than
  // letting keyword-spot guess at a composition it never expressed.
  const composite = parseComposite(text, adapter);
  if (composite) return composite;
  const merged = mergeStrategyResults(runStrategiesSync(text, { nlp: adapter, raw }));
  return merged ? merged.parsed : null;
}

// ============================================================================
// §compositional grammar (PLAN §5.16 P3) — the step up from ELIZA keyword-
// spotting to a real recursive-descent grammar. Tokenize -> recursive-descent
// parse to an AST of nodes -> compile to graph traversal. The AST node shapes
// (all carry a `node` tag so traverse()/render() can branch without touching the
// simple-clause path):
//   {node:"clause",   clause}                    — a wrapped simple parse (the leaf)
//   {node:"allOfClass", entityType}              — every individual of a class
//   {node:"reverseSet"|"forwardSet", kind, entityType, inner}  — nested/relative:
//        the OBJECT (reverse) / SUBJECT (forward) of the outer edge is the id-set
//        produced by evaluating `inner` (another AST) — two-stage traversal.
//   {node:"membership", entityType, term}        — "<entity> of/in <term>"
//   {node:"qualifier", filters:[word…], inner}   — adjective post-filters on a set
//   {node:"boolean", entityType, atoms:[{op,kind,ast|filters}…]}  — set algebra
//        over the SAME subject (and/or/but-not); op ∈ seed/intersection/union/difference
//   {node:"count", entityType, base}             — aggregate: |eval(base)|
//   {node:"list", entityType, base, scoped}      — list the individuals of eval(base),
//        capped at OVERFLOW_CAP; `scoped` suppresses the "narrow with …" hint when the
//        list was already restricted (a module scope or predicate tail)
//   {node:"superlative", entityType, metric, metricNoun, extreme}  — rank by degree
//   {node:"anaphora", mode, filter}              — over ask()'s `prev` id array
//   {node:"miss", reason}                        — a compositional marker was seen
//        but could not compile: an honest stated miss, never a guess.
// The grammar COMPOSES the closed vocabulary (ask-vocab.mjs); it never opens it —
// every leaf still resolves through the existing curated clause parser + tiered
// resolveObject, so a term it can't resolve is still an honest object-miss.
// ============================================================================

// Depth cap on nesting (PLAN P3: "depth ≥2 nesting; guard against runaway with a
// sane hop cap and an honest 'too deep to resolve' if exceeded").
const MAX_COMPOSE_DEPTH = 4;
// A resolvable-later placeholder object term for the OUTER clause of a nested
// parse: the outer clause is parsed normally (so its verb/shape/grain classify),
// then its `object` is discarded and replaced at eval time by the inner set. Chosen
// to be plainly alphabetic (not a stopword, not vocabulary) so the clause parser
// treats it as an ordinary object term rather than dropping it.
const NEST_SENTINEL = "zzinnerset";
// Filler words dropped at the front of a relative predicate / anaphora filter.
// "then"/"though" (Tier-2 playtest, 5th pass): a trailing discourse tag on an
// otherwise-bare anaphora follow-up — "how many of those THEN", "which of
// them THOUGH" — used to be read as an (uncompilable) filter clause instead
// of being dropped as filler, so the follow-up MISSED at PARSE time with a
// generic "the follow-up filter didn't parse" instead of reaching the
// friendly eval-time "needs a previous answer" nudge when there was truly no
// prior set (or the correct count/list when there was one) — the exact same
// discourse-tag tolerance WHAT_ABOUT_RE already carries for "what about X
// then"/"what about X though".
const PRED_LEAD_SKIP = new Set(["that", "which", "who", "are", "is", "was", "were", "do", "does", "also", "still", "both", "and", "then", "though"]);
const FRAME_WORDS = new Set(["which", "what", "who", "list", "show", "find", "give", "me", "us", "all"]);

const entityNoun = (w) => (ENTITY_TO_TYPE[w] ? { entityType: ENTITY_TO_TYPE[w], placeholder: false }
  : (PLACEHOLDER_NOUNS.includes(w) ? { entityType: null, placeholder: true } : null));
const isGerundVerb = (w) => !!VERB_TO_KIND[w] && w.endsWith("ing");

/** Run the two legacy strategies on a FRAGMENT and return a single simple clause
 *  (or null). Deterministic tie-break: on strategy disagreement the anchored parse
 *  wins — a fragment fed from the composer is already shape-constrained, so the
 *  merge's "surface an ambiguity" behavior isn't wanted here. (Equivalent to the
 *  original two-strategy scan: anchored first, keyword-spot only on a miss.) */
function parseSimpleClause(text, nlp) {
  return parseAnchored(text) || parseKeywordSpot(text, nlp);
}

/** Top compositional dispatcher — first marker-matching production wins; a
 *  production returns null (not this shape → fall through) or an AST node (which
 *  may itself be {node:"miss"} when the marker was present but uncompilable). */
function parseComposite(text, nlp) {
  const w = splitWords(text);
  const lc = w.map((x) => x.toLowerCase());
  return parseNegation(text, nlp, 0)
    || parseForwardNegation(w, lc, nlp)
    || parseTemporal(w, lc, nlp, 0)
    || parseAnaphora(w, lc, nlp)
    || parseAggregate(w, lc, nlp)
    || parseSuperlative(w, lc, nlp)
    || parseFind(w, lc, nlp, 0)
    || parseList(w, lc, nlp, 0)
    || parseNested(w, lc, nlp, 0)
    || parseRelationalOrQualified(w, lc, nlp, 0);
}

// B1 NEGATION (Cycle 5, archive/PLAN_CYCLE_4.md) — the SET COMPLEMENT. "which X do not <verb>
// Y" / "X that don't <verb> Y" / "modules not importing Y" / "which X are not
// <qualifier>" compiles to allOfClass(kind) DIFFERENCE (the positive result set),
// reusing the EXISTING machinery: evalBoolean already folds a "difference" atom, and
// the allOfClass node is a ready-made bounded universe of a kind. The only new work is
// recognizing the negation marker (matchNegationSet, normalize.mjs) and assembling the
// boolean-difference AST — no new traversal primitive. Regression guards, all tested:
//   (1) honest-empty stays honest — an EMPTY complement ("which functions are not
//       exported", where the only function is exported) renders the standard honest
//       "nothing matches" miss, never invents a member and never re-trips the literal-
//       'not' trap (the "not" is consumed here, so it can't leak into an object term);
//   (2) BOUNDED UNIVERSE only — the universe is the queried kind within the loaded
//       graph; the "Change" pseudo-type (ask-vocab.mjs) is a wildcard, not a stored
//       enumerable class, so a complement over "changes" is REFUSED honestly rather
//       than answered over an empty universe;
//   (3) active-voice/positive queries are untouched — parseNegation returns null unless
//       matchNegationSet finds an explicit set-negation marker.
function complementAst(entityType, diffAtom) {
  return {
    node: "boolean",
    entityType,
    atoms: [
      { op: "seed", kind: "set", ast: { node: "allOfClass", entityType } },
      diffAtom,
    ],
  };
}

function parseNegation(text, nlp, depth = 0) {
  const neg = matchNegationSet(text);
  if (!neg) return null;                             // no set-negation marker → not this shape
  const noun = entityNoun(neg.entWord);
  // a set complement needs a CONCRETE, enumerable kind. A placeholder ("things") has no
  // bounded universe; the "Change" pseudo-type is a wildcard over the touch traversal,
  // never a stored class, so its complement is ill-defined and must be refused honestly.
  if (!noun || noun.placeholder || !noun.entityType) return null;
  const entityType = noun.entityType;
  if (entityType === "Change") {
    return { node: "miss", reason: `"${neg.entWord}" isn't an enumerable kind — a set complement needs a concrete kind (functions, classes, modules, …)` };
  }
  const predWords = splitWords(neg.predicate);
  const predLc = predWords.map((x) => x.toLowerCase());
  // (a) qualifier negation ("not tested" / "not exported"): difference the qualifier
  // set off the class — equivalent to the negated qualifier, an honest empty when none.
  if (predLc.length && predLc.every((x) => QUALIFIERS[x])) {
    return complementAst(entityType, { op: "difference", kind: "qual", filters: predLc });
  }
  const vh = findPhrase(predLc, VERB_TO_KIND);
  if (!vh) return { node: "miss", reason: "a negated set query needs a known relation verb (import, call, inherit from, test, …)" };
  const objWords = predWords.filter((_, i) => (i < vh.start || i >= vh.end) && !STOPWORDS.has(predLc[i]) && predLc[i] !== "from");
  // (b) existential object ("do not import anything" / "define nothing"): the complement
  // is the class MINUS the subjects that have ANY edge of this kind.
  if (!objWords.length) {
    return complementAst(entityType, { op: "difference", kind: "set", ast: { node: "existsEdge", entityType, kind: vh.kind } });
  }
  // (c) concrete object ("do not import a.mjs"): the class MINUS the POSITIVE result
  // set, parsed through the existing clause/relational machinery (never re-negating —
  // the reconstructed positive text carries no "not").
  const positive = parseSetPhrase(`which ${neg.entWord} ${neg.predicate}`, nlp, depth + 1);
  if (!positive || positive.node === "miss") {
    return { node: "miss", reason: (positive && positive.reason) || "the negated clause didn't parse" };
  }
  return complementAst(entityType, { op: "difference", kind: "set", ast: positive });
}

// B1 FORWARD NEGATION (Cycle 5, pron+neg) — the SUBJECT-side complement's mirror: "what
// does[n't] <subj> <verb>" ("what doesn't it import", "what does app/lib/e.mjs not import")
// is every individual of the verb's OBJECT grain that <subj> does NOT reach via that verb.
// Distinct from parseNegation (which negates a queried KIND — "which modules do not import
// X"): here the negation sits on a FORWARD clause whose subject is a named term or a focus
// pronoun, so the universe is inferred from the verb's own edges (imports → Module) rather
// than a stated kind noun. The subject is resolved LATE (at eval, through the same
// contextId a plain "it" uses), so pronoun-binding composes with the complement for free.
// Refused honestly (empty) when the verb's object grain is ambiguous or the subject can't
// resolve — never a guess. Runs AFTER parseNegation, so the stated-kind form is unaffected.
const FWD_NEG_FRAME = new Set(["what", "which", "thing", "things", "one", "ones", "stuff"]);
function parseForwardNegation(w, lc, nlp) {
  let i = 0;
  while (i < lc.length && FWD_NEG_FRAME.has(lc[i])) i += 1;
  if (!["do", "does", "did"].includes(lc[i])) return null;   // need the auxiliary lead
  i += 1;
  const rest = w.slice(i);
  const restLc = lc.slice(i);
  const notIdx = restLc.indexOf("not");
  if (notIdx < 0) return null;                                // no negation → not this shape
  const vh = findPhrase(restLc, VERB_TO_KIND);
  if (!vh) return null;                                       // no relation verb → not this shape
  // the subject term is whatever survives after removing "not", the verb phrase, "from",
  // and question scaffolding — a bare pronoun "it" (not a stopword) survives and binds to
  // the focus at eval time; a named module/symbol survives and resolves directly.
  const subjTokens = rest.filter((_, j) => j !== notIdx && (j < vh.start || j >= vh.end)
    && restLc[j] !== "from" && !STOPWORDS.has(restLc[j]));
  const subjectTerm = subjTokens.join(" ").trim();
  if (!subjectTerm) return null;
  return { node: "forwardComplement", kind: vh.kind, subjectTerm };
}

/** The single OBJECT class a forward relation kind points at across the loaded graph
 *  (imports → Module), or null when its objects span more than one class (an ambiguous
 *  grain the complement's universe can't be pinned to). Ext: endpoints have no individual,
 *  so they don't muddy the class vote. Used by the forwardComplement evaluator to bound
 *  the universe it differences the positive forward set out of. */
function kindObjectClass(graph, kind) {
  const classes = new Set();
  for (const k of kindsFor(kind)) {
    for (const e of edgesOfKind(graph, k)) {
      const o = graph.byId.get(e.object);
      if (o && o.class) classes.add(o.class);
    }
  }
  return classes.size === 1 ? [...classes][0] : null;
}

/** A set-producing sub-expression (used for nested inner clauses, boolean branches,
 *  and count restrictors): nested first, then the relational/qualifier/boolean
 *  parser, then a bare simple clause. Carries `depth` for the nesting cap. */
function parseSetPhrase(text, nlp, depth) {
  if (depth > MAX_COMPOSE_DEPTH) return { node: "miss", reason: "too deep to resolve" };
  // a set-negation clause can appear as a count restrictor ("how many classes are not
  // tested"), a list filter, or a boolean branch — try the complement frame first so
  // those compositions get the bounded-complement for free.
  const negated = parseNegation(text, nlp, depth);
  if (negated) return negated;
  const w = splitWords(text);
  const lc = w.map((x) => x.toLowerCase());
  const nested = parseNested(w, lc, nlp, depth);
  if (nested) return nested;
  const rel = parseRelationalOrQualified(w, lc, nlp, depth);
  if (rel) return rel;
  const clause = parseSimpleClause(text, nlp);
  if (clause) return { node: "clause", clause };
  return null;
}

/** NESTED / RELATIVE (object-position relative clause): "<outer verb> <placeholder
 *  |entity> that <inner>" — the noun before "that" is the OBJECT of the outer edge,
 *  constrained by the inner clause. Distinguished from a subject-relative ("functions
 *  that call X", handled by parseRelationalOrQualified) by requiring a VERB before the
 *  relative noun (i.e. the noun is not the leading subject). Returns a reverse/forward
 *  Set node, an honest miss (marker present, uncompilable), or null (no object-relative
 *  marker → let another production try). */
function parseNested(w, lc, nlp, depth) {
  for (let r = 1; r < lc.length; r += 1) {
    if (!RELATIVE_PRONOUNS.includes(lc[r])) continue;
    if (r + 1 >= lc.length) continue;               // nothing after "that"
    const noun = entityNoun(lc[r - 1]);
    if (!noun) continue;                            // "that" not preceded by a noun
    const head = w.slice(0, r - 1);                 // outer clause words, minus the placeholder noun
    if (!head.length) continue;                     // noun is the leading subject → subject-relative, not this shape
    const outer = parseSimpleClause([...head, NEST_SENTINEL].join(" "), nlp);
    if (!outer || (outer.shape !== "reverse" && outer.shape !== "forward")) continue;
    if (outer.modifier && outer.modifier !== "direct") continue; // no transitive-over-set closure primitive
    // build the inner sub-query: "which <placeholder-noun> <inner-text>" — recurses,
    // so the inner may itself be nested/boolean/qualified (depth ≥2).
    const innerText = `which ${lc[r - 1]} ${w.slice(r + 1).join(" ")}`;
    const inner = parseSetPhrase(innerText, nlp, depth + 1);
    if (!inner || inner.node === "miss") return inner ? { node: "miss", reason: inner.reason || "inner clause didn't parse" } : { node: "miss", reason: "inner clause didn't parse" };
    return { node: outer.shape === "reverse" ? "reverseSet" : "forwardSet", kind: outer.kind, entityType: outer.entityType, inner };
  }
  return null;
}

// TEMPORAL-OVER-RELATIVE (Phase 11 Track 1, lever 3) — "when did <relative set> [last]
// change". The flat when-shape (traverse) dates the commits touching ONE resolved term;
// this composes that same touches→commit→date-sort machinery as an OUTER operator over a
// NESTED inner set ("when did the modules that import X last change", "when were the
// functions that call Y last touched"). Fires only for a RELATIVE subject (a "that/which"
// marker) so the single-entity "when did X change" stays on the flat path untouched; a
// marker present but uncompilable inner is an honest miss, never a guess.
const TEMPORAL_AUX = new Set(["did", "was", "were", "do", "does", "has", "have", "had"]);
const TEMPORAL_TAIL = new Set([
  "change", "changed", "changes", "update", "updated", "updates",
  "modify", "modified", "modifies", "touch", "touched", "touches", "edit", "edited", "revise", "revised",
]);
const TEMPORAL_TRAIL_FILLER = new Set(["last", "recently", "ever", "get", "got", "been", "then", "now", "already"]);
const TEMPORAL_DET = new Set(["the", "a", "an", "all", "those", "these", "any"]);

function parseTemporal(w, lc, nlp, depth = 0) {
  if (lc[0] !== "when") return null;              // temporal questions lead with "when"
  let i = 1;
  if (!TEMPORAL_AUX.has(lc[i])) return null;      // need an auxiliary ("when did …")
  i += 1;
  // the change-verb tail — take the LAST occurrence so "…that import X last change" works.
  let t = -1;
  for (let k = lc.length - 1; k >= i; k -= 1) { if (TEMPORAL_TAIL.has(lc[k])) { t = k; break; } }
  if (t < 0) return null;                          // no change verb → not a temporal question
  let subjWords = w.slice(i, t);
  let subjLc = lc.slice(i, t);
  while (subjLc.length && TEMPORAL_TRAIL_FILLER.has(subjLc[subjLc.length - 1])) { subjWords = subjWords.slice(0, -1); subjLc = subjLc.slice(0, -1); }
  while (subjLc.length && TEMPORAL_DET.has(subjLc[0])) { subjWords = subjWords.slice(1); subjLc = subjLc.slice(1); }
  if (!subjWords.length) return null;
  // ONLY a relative/nested subject composes here; a bare named entity is the flat path's.
  if (!subjLc.some((x) => RELATIVE_PRONOUNS.includes(x))) return null;
  const framed = FRAME_WORDS.has(subjLc[0]) ? subjWords.join(" ") : `which ${subjWords.join(" ")}`;
  const inner = parseSetPhrase(framed, nlp, depth + 1);
  if (!inner || inner.node === "miss") return inner ? { node: "miss", reason: inner.reason || "the inner set of the temporal query didn't parse" } : { node: "miss", reason: "the inner set of the temporal query didn't parse" };
  const noun = entityNoun(subjLc[0]);
  return { node: "temporal", inner, entityType: (noun && noun.entityType) || null };
}

/** ANAPHORA over the previous result set: "which of those/them <filter>", "how many
 *  of those <filter>". Requires "of <pronoun>" (so a bare "those" in a term never
 *  fires). Returns a {node:"anaphora"} (mode count|list), a miss (filter present but
 *  uncompilable), or null. */
function parseAnaphora(w, lc, nlp) {
  // "which ones"/"which one" — a bare anaphoric re-LIST of the previous result set,
  // phrased as a QUESTION rather than the imperative ("list them") or pronoun-tail
  // ("count them") shapes the loop below already covers. Found live (0.9.14 Tier-2
  // playtest, third pass, numeric/quantifier relation touches): after "how many
  // modules import app/lib/a.mjs" / "which modules import app/lib/a.mjs", the
  // completely natural follow-up "which ones" fell straight through to the generic
  // orientation card — "ones" isn't an ANAPHORA_TRIGGERS pronoun and bare "which"
  // isn't a LIST_TRIGGERS head, so neither existing branch below ever fires for it.
  // Pinned to the WHOLE query (exactly two words) so it never shadows an ordinary
  // "which one of these two functions …" clause, which has more words after "one".
  if (lc.length === 2 && lc[0] === "which" && (lc[1] === "ones" || lc[1] === "one")) {
    return { node: "anaphora", mode: "list", filter: { type: "all" } };
  }
  let p = -1;
  let viaOf = false;
  for (let i = 1; i < lc.length; i += 1) {
    if (!ANAPHORA_TRIGGERS.includes(lc[i])) continue;
    if (lc[i - 1] === "of") { p = i; viaOf = true; break; } // "how many of those", "which of them"
    // BARE anaphoric pronoun as the FINAL word, directly after a count/list trigger
    // ("count them", "count those", "list them") — the discourse-reference count/list over
    // the previous answer with no "of" (Cycle 5, disc+count). Pinned to the terminal
    // position so a mid-sentence "these"/"those" used as a determiner ("list these
    // functions") is left for the ordinary list/clause path, not seized as an anaphor.
    const headSoFar = lc.slice(0, i).join(" ");
    if (i === lc.length - 1 && (AGGREGATE_TRIGGERS.includes(headSoFar) || LIST_TRIGGERS.includes(headSoFar))) { p = i; break; }
  }
  if (p < 0) return null;
  const head = (viaOf ? lc.slice(0, p - 1) : lc.slice(0, p)).join(" ");
  const mode = AGGREGATE_TRIGGERS.includes(head) || /^(how many|how much|count|number|quantity|total)\b/.test(head) ? "count" : "list";
  const filter = parsePredicateFilter(w.slice(p + 1), nlp);
  if (filter === undefined) return { node: "miss", reason: "the follow-up filter didn't parse" };
  return { node: "anaphora", mode, filter };
}

/** Parse a trailing filter (for anaphora, and any "of those that …" tail) into
 *  {type:"all"} | {type:"qual", filters} | {type:"clause", clause}. Returns
 *  undefined when a non-empty filter cannot be compiled (an honest miss upstream). */
function parsePredicateFilter(words, nlp) {
  let i = 0;
  const lc = words.map((x) => x.toLowerCase());
  while (i < lc.length && PRED_LEAD_SKIP.has(lc[i])) i += 1;
  const rest = words.slice(i);
  const restLc = lc.slice(i);
  if (!rest.length) return { type: "all" };
  if (restLc.every((x) => QUALIFIERS[x])) return { type: "qual", filters: restLc };
  const clause = parseSimpleClause(`what ${rest.join(" ")}`, nlp);
  if (clause && (clause.shape === "reverse" || clause.shape === "forward") && clause.object) {
    return { type: "clause", clause };
  }
  return undefined;
}

/** Trailing "and that's the whole question" filler an aggregate/list tail can carry
 *  ("how many classes are there", "list functions in total", "which classes exist in
 *  the index") — a count/list over a bare kind is frequently phrased with such a tail,
 *  and it must NOT be mistaken for a restrictor (that's the exact bug behind "how many
 *  classes are there" → the count-restrictor miss). Combined with STOPWORDS (which
 *  already carries are/there/is/in/the/…) at the call site, so only the non-stopword
 *  extras live here. A tail with ANY word outside this ∪ STOPWORDS is a real restrictor.
 *  "this"/"that" (0.9.14 Tier-2 playtest): "which classes exist IN THIS codebase"/
 *  "which methods exist in this codebase" used to miss — "codebase" alone was already
 *  filler, but the demonstrative right before it ("this"/"that") is not a STOPWORDS
 *  entry, so the tail read as non-filler and the whole thing fell through to the
 *  grammar wall instead of the bare list. */
const AGG_TAIL_FILLER = new Set([
  "total", "altogether", "overall", "exist", "exists", "existing", "present",
  "here", "now", "currently", "graph", "index", "codebase", "repo", "repository",
  "this", "that",
]);

/** AGGREGATE / COUNT: "how many <entity> [<restrictor>]", "count <entity>",
 *  "number of <entity> that …". A bare "how many classes" counts the class of
 *  individuals; a restrictor tail counts a clause's result set; a purely-filler tail
 *  ("… are there", "… in total") is treated as no restrictor (a bare count). */
function parseAggregate(w, lc, nlp) {
  const trig = AGGREGATE_TRIGGERS.find((t) => lc.slice(0, t.split(" ").length).join(" ") === t);
  if (!trig) return null;
  let i = trig.split(" ").length;
  while (i < lc.length && (lc[i] === "the" || lc[i] === "a" || lc[i] === "all")) i += 1;
  const quals = [];
  while (i < lc.length && QUALIFIERS[lc[i]]) { quals.push(lc[i]); i += 1; }
  const noun = i < lc.length ? entityNoun(lc[i]) : null;
  if (!noun) return { node: "miss", reason: "count needs a known entity kind (functions, classes, modules, …)" };
  const entWord = lc[i];
  i += 1;
  const tail = w.slice(i);
  const tailMeaningful = lc.slice(i).some((t) => !STOPWORDS.has(t) && !AGG_TAIL_FILLER.has(t));
  let base;
  if (tailMeaningful) {
    const setAst = parseSetPhrase(`which ${entWord} ${tail.join(" ")}`, nlp, 1);
    if (!setAst || setAst.node === "miss") return { node: "miss", reason: "the count restrictor didn't parse" };
    base = setAst;
  } else {
    base = { node: "allOfClass", entityType: noun.entityType };
  }
  if (quals.length) base = { node: "qualifier", filters: quals, inner: base };
  return { node: "count", entityType: noun.entityType, base };
}

// Determiners/objects skipped after a LIST trigger verb ("show me THE classes") — a
// superset of the aggregate skip so "give me all the modules" reaches the kind noun.
const LIST_SKIP = new Set(["the", "a", "an", "all", "me", "us"]);
const LIST_TRIGGERS_SORTED = [...LIST_TRIGGERS].sort((a, b) => b.split(" ").length - a.split(" ").length);
// The listable node classes, named in the honest miss and the empty-index message.
const LISTABLE_KINDS = "functions, classes, methods, modules, attributes, variables, or commits";
// SCOPE PREPOSITIONS (HANDOVER item 12.2/11.1): a leading "in"/"inside"/"under" right
// after the entity noun (past an optional copula) is an unambiguous LOCATION-SCOPE
// tail, never a reverse-clause predicate object — "which modules import X" has no
// preposition there at all. Narrowly scoped to just these three words so the
// interrogative exception below can't be mistaken for a general tail-acceptance.
const SCOPE_PREPOSITIONS = new Set(["in", "inside", "under"]);

/** LIST: "list <kind>", "show me the <kind>s", "what are the <kind>", "list <kind> in
 *  <module>". A sibling of the count node — it enumerates the individuals of a class
 *  (rendered under OVERFLOW_CAP) instead of counting them. Fires on a LIST_TRIGGERS
 *  verb, OR the bare interrogative "what/which <kind>" — but the interrogative form is
 *  gated to a filler-only tail so an ordinary reverse query ("which functions call X")
 *  is NOT hijacked into a list (it must stay a simple clause; the compat tests pin it).
 *  A scope/predicate tail ("in walk.mjs", "that call X") is delegated to parseSetPhrase
 *  (reusing membership/relational/boolean), and its `scoped` flag suppresses the
 *  "narrow with …" hint. An unknown kind after a clear imperative trigger ("list
 *  bananas") is an honest miss naming the listable kinds; anything less certain falls
 *  through (null) to the existing parser/cascade rather than guessing.
 *
 *  A single narrowly-scoped EXCEPTION to the interrogative gate (HANDOVER item
 *  12.2/11.1): "what/which <kind> [is|are] in|inside|under <scope>" — a leading scope
 *  preposition, past an optional copula, straight after the entity noun — is routed the
 *  SAME way the imperative "list <kind> in <scope>" already is. This does NOT widen the
 *  general decline: "which modules import X"/"which functions call X" have a VERB there,
 *  not a scope preposition, so they still fall through untouched. */
function parseList(w, lc, nlp, depth) {
  let i = 0;
  let interrogative = false;
  let matched = null;
  for (const t of LIST_TRIGGERS_SORTED) {
    const tw = t.split(" ");
    if (lc.slice(0, tw.length).join(" ") === t) { matched = t; i = tw.length; break; }
  }
  if (!matched) {
    if (lc[0] === "what" || lc[0] === "which") { interrogative = true; i = 1; }
    else return null;
  }
  while (i < lc.length && LIST_SKIP.has(lc[i])) i += 1;
  const quals = [];
  while (i < lc.length && QUALIFIERS[lc[i]]) { quals.push(lc[i]); i += 1; }
  const noun = i < lc.length ? entityNoun(lc[i]) : null;
  // "Change" is ask-vocab.mjs's pseudo-type (no node is ever class "Change"), so it is
  // not a listable class — fall through rather than render a false empty.
  if (!noun || noun.placeholder || noun.entityType === "Change") {
    // A clear imperative "list <one unknown plain word>" is an honest miss that NAMES
    // the kinds; a verb-led or multi-word tail, or the interrogative form, is too
    // uncertain to claim as a list — fall through to the existing parser/cascade.
    if (!interrogative && i < lc.length && i === lc.length - 1
      && /^[a-z]+$/.test(lc[i]) && !VERB_TO_KIND[lc[i]] && !PLACEHOLDER_NOUNS.includes(lc[i])) {
      return { node: "miss", reason: `"${lc[i]}" isn't a listable kind — try ${LISTABLE_KINDS}` };
    }
    return null;
  }
  const entityType = noun.entityType;
  const entWord = lc[i];
  i += 1;
  const tail = w.slice(i);
  const tailMeaningful = lc.slice(i).some((t) => !STOPWORDS.has(t) && !AGG_TAIL_FILLER.has(t));
  // SCOPE-PREPOSITION exception (HANDOVER 12.2/11.1): past an optional copula
  // ("is"/"are"), does the tail open with "in"/"inside"/"under"? If so this is a
  // location-scope tail ("what modules ARE IN app/lib"), not a reverse-clause
  // predicate — strip only the copula (the imperative form never has one: "list
  // modules in app/lib") so the membership-tail text this builds below is byte-
  // identical in shape to what the imperative path already builds.
  let scopeTailLc = lc.slice(i);
  let scopeTailWords = tail;
  if (scopeTailLc[0] === "is" || scopeTailLc[0] === "are") {
    scopeTailLc = scopeTailLc.slice(1);
    scopeTailWords = scopeTailWords.slice(1);
  }
  const scopedException = interrogative && SCOPE_PREPOSITIONS.has(scopeTailLc[0]);
  // The bare interrogative "what/which <kind>" is a list ONLY with an explicit
  // list-confirming filler tail ("… are there", "… that exist") or the scoped
  // exception just above: a real predicate ("which functions call X") is a reverse
  // query, and a *bare* "which methods" is left alone deliberately — otherwise the
  // relaxation cascade could drop an unknown qualifier ("which shiny methods" →
  // "which methods") and silently list everything, erasing the honest "unknown
  // qualifier" miss. Imperative triggers ("list methods") carry their own list
  // intent, so they need no such tail.
  if (interrogative && ((tailMeaningful && !scopedException) || tail.length === 0)) return null;
  let base;
  let scoped = false;
  if (tailMeaningful) {
    const useTail = scopedException ? scopeTailWords : tail;
    const setAst = parseSetPhrase(`which ${[...quals, entWord, ...useTail].join(" ")}`, nlp, (depth || 0) + 1);
    if (!setAst || setAst.node === "miss") return { node: "miss", reason: (setAst && setAst.reason) || "the list filter didn't parse" };
    base = setAst;
    scoped = true;
  } else {
    base = { node: "allOfClass", entityType };
    if (quals.length) base = { node: "qualifier", filters: quals, inner: base };
  }
  return { node: "list", entityType, base, scoped };
}

/** SUPERLATIVE: "which <entity> has the most/fewest <edge-noun>", "the most-connected
 *  <entity>", "the largest <entity>". Ranks individuals of <entity> by a degree
 *  metric over the classified edge groups. An unrecognized edge noun is an honest
 *  miss naming the supported ones. */
function parseSuperlative(w, lc, nlp) {
  // extreme (single word, or "most connected" two-word)
  let ext = null; let extIdx = -1;
  for (let i = 0; i < lc.length; i += 1) {
    const two = lc.slice(i, i + 2).join(" ");
    if (SUPERLATIVE_EXTREMES[two]) { ext = SUPERLATIVE_EXTREMES[two]; extIdx = i; break; }
    if (SUPERLATIVE_EXTREMES[lc[i]]) { ext = SUPERLATIVE_EXTREMES[lc[i]]; extIdx = i; break; }
  }
  if (!ext) return null;
  // entity noun anywhere (first match, deterministic)
  let entityType; let entWord = null;
  for (const x of lc) { const n = entityNoun(x); if (n && !n.placeholder) { entityType = n.entityType; entWord = x; break; } }
  if (!entWord) return { node: "miss", reason: "a superlative needs an entity kind (module, class, function, …)" };
  // edge noun after the extreme (imports/callers/methods/…)
  let metric = null; let metricNoun = null;
  for (let i = extIdx; i < lc.length; i += 1) {
    if (EDGE_NOUN_TO_METRIC[lc[i]]) { metric = EDGE_NOUN_TO_METRIC[lc[i]]; metricNoun = lc[i]; break; }
  }
  const connectivity = lc.includes("connected") || lc.slice(extIdx, extIdx + 2).join(" ") === "most connected"
    || ["largest", "biggest", "smallest"].includes(lc[extIdx]);
  if (!metric) {
    if (connectivity) { metric = EDGE_NOUN_TO_METRIC.connections; metricNoun = "connections"; }
    else return { node: "miss", reason: "name what to rank by (imports, callers, methods, tests, or connections)" };
  }
  return { node: "superlative", entityType, metric, metricNoun, extreme: ext };
}

// PREDICATE-FIND (Workstream 2 — new product feature): "find [me/us] [the/a] <term>
// <entityType>" (trailing-type — "find me the payment class") or "find [me/us]
// [the/a] <entityType> <linker> <term>" (leading-type-with-linker — "find the class
// named Foo"). A TYPE FILTER ∧ FUZZY PROPERTY-SURFACE MATCH, not a literal name
// lookup (contrast parseList's plain class enumeration) — reuses the same closed
// compositional grammar (evalSet's new "find" case, renderComposite's new branch)
// so it composes for free with qualifiers/booleans later (§6 generalization below).
const FIND_LINKERS = new Set(["called", "named", "about", "like", "containing", "matching", "with"]);

/** PREDICATE-FIND: see the file comment above. Triggered ONLY by a leading "find"
 *  (parseNegation, earlier in parseComposite's chain, already claims "find" as an
 *  optional lead before an EXPLICIT set-negation marker — "find modules that don't
 *  import X" reaches that production first and never reaches here). Reuses
 *  LIST_SKIP and entityNoun/ENTITY_TO_TYPE exactly as parseList does. A clear
 *  imperative "find <one unknown plain word>" (mirroring parseList's own single-
 *  trailing-word discipline) is an honest miss naming LISTABLE_KINDS — a
 *  PARSE-TIME miss, structurally distinct from evalSet("find")'s zero-hit SEARCH
 *  miss; anything less certain — a longer uncertain remainder, or ANY relative-
 *  clause marker present anywhere (that/which/who) — defers (null) to the existing
 *  parser/cascade, so "find the file that imports store" keeps parsing via the
 *  established parseNested/parseRelationalOrQualified relative-clause path (the
 *  §6 generalization below is the ONE place a term-bearing find-with-predicate
 *  shape is recognized, and it is a structurally separate production). */
function parseFind(w, lc, nlp, depth) {
  if (lc[0] !== "find") return null;
  let i = 1;
  while (i < lc.length && LIST_SKIP.has(lc[i])) i += 1;
  if (i >= lc.length) return null;

  // leading-type-with-linker: "find [me] [the] <entityType> <linker> <term…>"
  const leadNoun = entityNoun(lc[i]);
  if (leadNoun && !leadNoun.placeholder && leadNoun.entityType !== "Change"
    && i + 1 < lc.length && FIND_LINKERS.has(lc[i + 1])) {
    const term = w.slice(i + 2).join(" ").trim();
    if (term) return { node: "find", entityType: leadNoun.entityType, term };
    // a linker with nothing after it is too uncertain to claim — fall through.
  }

  // trailing-type: "find [me] [the] <term…> <entityType>"
  const lastNoun = entityNoun(lc[lc.length - 1]);
  if (lastNoun && !lastNoun.placeholder && lastNoun.entityType !== "Change") {
    const term = w.slice(i, lc.length - 1).join(" ").trim();
    if (term) return { node: "find", entityType: lastNoun.entityType, term };
  }

  // A relative-clause marker anywhere means a DIFFERENT production owns this text
  // (either the plain relative-clause path, or the §6 find-with-predicate
  // generalization inside parseRelationalOrQualified) — never claimed here.
  if (lc.some((t) => RELATIVE_PRONOUNS.includes(t))) return null;
  // A clear imperative single unknown trailing word (mirrors parseList's own rule).
  if (i === lc.length - 1 && /^[a-z]+$/.test(lc[i]) && !VERB_TO_KIND[lc[i]] && !PLACEHOLDER_NOUNS.includes(lc[i])) {
    return { node: "miss", reason: `"${lc[i]}" isn't a listable kind — try ${LISTABLE_KINDS}` };
  }
  return null;
}

/** RELATIONAL / BOOLEAN / QUALIFIER (subject-first): "[which] [<qualifier>…] <entity>
 *  [that] <predicate>", where <predicate> is one or more relation clauses joined by
 *  and/or/but-not over the SAME subject, a "<of|in> <term>" membership, or empty (a
 *  bare qualified class). Fires ONLY on a compositional marker — a leading qualifier,
 *  a relative pronoun, a gerund-led predicate, or a membership "of/in" — so a plain
 *  reverse query ("which functions call helper") and the bare-template ambiguous case
 *  ("which classes extends Base and couples to logging", no marker) both fall through
 *  to the existing strategies untouched. Returns an AST node, a miss, or null. */
/** §6 generalization (predicate-find, Workstream 2 follow-up) — detect the HEAD of
 *  "find [me/us] [the/a] <term…> <entityType> that|which|who <predicate>": mirrors
 *  parseFind's own trailing-type recognition (LIST_SKIP, entityNoun), but requires
 *  a relative-clause marker directly after the entity noun and a NON-EMPTY term
 *  before it. An EMPTY term ("find classes that…") is deliberately NOT this shape
 *  — it already reaches parseRelationalOrQualified's normal head-parsing below
 *  once "find" is skipped as a FRAME_WORD, with no find-seed needed. Returns
 *  {entityType, term, relIdx} (relIdx = the relative pronoun's token index) or
 *  null — null on anything less than an exact match (never a guess). */
function parseFindPredicateHead(w, lc) {
  if (lc[0] !== "find") return null;
  let i = 1;
  while (i < lc.length && LIST_SKIP.has(lc[i])) i += 1;
  let r = -1;
  for (let k = i + 1; k < lc.length; k += 1) { if (RELATIVE_PRONOUNS.includes(lc[k])) { r = k; break; } }
  if (r < 0) return null;
  const noun = entityNoun(lc[r - 1]);
  if (!noun || noun.placeholder || noun.entityType === "Change") return null;
  const term = w.slice(i, r - 1).join(" ").trim();
  if (!term) return null;
  return { entityType: noun.entityType, term, relIdx: r };
}

/** Build boolean/qualifier atoms for a predicate whose FIRST (seed) atom the
 *  caller already determined externally (the §6 generalization's find-seed,
 *  above) — `predLc`/`predWords` are the tokens AFTER the leading relative
 *  pronoun has already been consumed. Every atom's op defaults to
 *  "intersection" (a relative clause always RESTRICTS the seed) except where an
 *  explicit and/or/but-not connective says otherwise. Mirrors
 *  parseRelationalOrQualified's own branch-classification (qualifier-only /
 *  membership / verb-phrase clause) in miniature, duplicated rather than
 *  shared, so neither path risks regressing the other. */
function buildPredicateAtoms(entityType, subjPrefix, predLc, predWords, nlp, depth) {
  const { branches, ops } = splitBoolean(predLc, predWords);
  let prevVerb = null;
  const atoms = [];
  for (let b = 0; b < branches.length; b += 1) {
    const bw = branches[b];
    const blc = bw.map((x) => x.toLowerCase());
    const op = b === 0 ? "intersection" : ops[b - 1];
    if (bw.length && blc.every((x) => QUALIFIERS[x])) { atoms.push({ op, kind: "qual", filters: blc }); continue; }
    if (blc[0] === "of" || blc[0] === "in") {
      atoms.push({ op, kind: "set", ast: { node: "membership", entityType, term: bw.slice(1).join(" ") } });
      continue;
    }
    let phrase = bw;
    const vh = findPhrase(blc, VERB_TO_KIND);
    if (vh) prevVerb = bw.slice(vh.start, vh.end);
    else if (prevVerb) phrase = [...prevVerb, ...bw];
    const ast = parseBranchAst(`${subjPrefix} ${phrase.join(" ")}`, nlp, depth);
    if (!ast || ast.node === "miss") return { miss: (ast && ast.reason) || "a clause in the combination didn't parse" };
    atoms.push({ op, kind: "set", ast });
  }
  return { atoms };
}

function parseRelationalOrQualified(w, lc, nlp, depth) {
  // §6 generalization (predicate-find): seeds the SAME boolean/qualifier fold
  // below with a {node:"find",…} atom instead of the plain {node:"allOfClass"}
  // a bare qualified class gets — see parseFindPredicateHead's own doc above.
  const findHead = parseFindPredicateHead(w, lc);
  if (findHead) {
    const { entityType, term, relIdx } = findHead;
    const predLc = lc.slice(relIdx + 1);
    const predWords = w.slice(relIdx + 1);
    if (!predLc.length) return { node: "miss", reason: `a relative clause needs a predicate after "${lc[relIdx]}"` };
    const built = buildPredicateAtoms(entityType, `which ${lc[relIdx - 1]}`, predLc, predWords, nlp, depth + 1);
    if (built.miss) return { node: "miss", reason: built.miss };
    const atoms = [{ op: "seed", kind: "set", ast: { node: "find", entityType, term } }, ...built.atoms];
    return atoms.length === 1 ? atoms[0].ast : { node: "boolean", entityType, atoms };
  }

  let i = 0;
  while (i < lc.length && FRAME_WORDS.has(lc[i])) i += 1;
  const framed = i > 0;
  const quals = [];
  while (i < lc.length && QUALIFIERS[lc[i]]) { quals.push(lc[i]); i += 1; }
  const noun = i < lc.length ? entityNoun(lc[i]) : null;
  if (!noun) {
    // An unknown adjective sitting in the qualifier slot, right before a known entity
    // noun ("list payment modules", "which shiny methods") — try it as a predicate-find
    // fuzzy term FIRST ("payment" filtering Module labels/attributes) before declaring
    // it an unrecognized qualifier: a real, honest answer beats an error message, and a
    // genuine zero-hit still renders find's own honest "no <noun> found matching <term>"
    // miss (never a confident-wrong guess either way — same discipline as everywhere
    // else this AST node is produced). STOPWORDS are excluded so a normal question
    // auxiliary in that position ("what DID commit X touch") is left for the existing
    // parser, not mistaken for a term.
    const nextNoun = i + 1 < lc.length ? entityNoun(lc[i + 1]) : null;
    if ((framed || quals.length) && nextNoun && /^[a-z]+$/.test(lc[i])
      && !VERB_TO_KIND[lc[i]] && !STOPWORDS.has(lc[i])) {
      return { node: "find", entityType: nextNoun.entityType, term: w[i] };
    }
    return null;                                   // no subject entity → not this shape
  }
  const entityType = noun.entityType;
  const entWord = lc[i];
  i += 1;
  let predLc = lc.slice(i);
  let predWords = w.slice(i);
  let relFlag = false;
  if (predLc.length && RELATIVE_PRONOUNS.includes(predLc[0])) { relFlag = true; predLc = predLc.slice(1); predWords = predWords.slice(1); }
  const membershipLed = predLc[0] === "of" || predLc[0] === "in";
  const gerundLed = predLc.length > 0 && isGerundVerb(predLc[0]);
  // marker gate — the crux of backward-compat: without one of these, this is not a
  // compositional query and we must NOT hijack it from the existing parser.
  if (!(quals.length || relFlag || membershipLed || gerundLed)) return null;

  // empty predicate → a bare qualified class ("public methods")
  if (!predWords.length) {
    let base = { node: "allOfClass", entityType };
    if (!quals.length) return { node: "miss", reason: "nothing to filter or traverse" };
    return { node: "qualifier", filters: quals, inner: base };
  }

  const subjPrefix = noun.placeholder ? "what" : `which ${entWord}`;
  const { branches, ops } = splitBoolean(predLc, predWords);
  // build one atom per branch, borrowing a leading verb phrase across bare branches
  // ("importing X or Y" → the second branch inherits "importing").
  let prevVerb = null;
  const atoms = [];
  for (let b = 0; b < branches.length; b += 1) {
    const bw = branches[b];
    const blc = bw.map((x) => x.toLowerCase());
    const op = b === 0 ? "seed" : ops[b - 1];
    if (bw.length && blc.every((x) => QUALIFIERS[x])) { atoms.push({ op, kind: "qual", filters: blc }); continue; }
    if (blc[0] === "of" || blc[0] === "in") {
      atoms.push({ op, kind: "set", ast: { node: "membership", entityType, term: bw.slice(1).join(" ") } });
      continue;
    }
    let phrase = bw;
    const vh = findPhrase(blc, VERB_TO_KIND);
    if (vh) prevVerb = bw.slice(vh.start, vh.end);
    else if (prevVerb) phrase = [...prevVerb, ...bw];
    // a branch is a single predicate (top-level booleans are already split out), so
    // parse it as nested-or-simple — NOT back through parseSetPhrase, which would
    // re-detect the branch's own gerund/relative lead and recurse on identical text.
    const ast = parseBranchAst(`${subjPrefix} ${phrase.join(" ")}`, nlp, depth + 1);
    if (!ast || ast.node === "miss") return { node: "miss", reason: (ast && ast.reason) || "a clause in the combination didn't parse" };
    atoms.push({ op, kind: "set", ast });
  }
  // the first atom must be a base set, not a bare qualifier (a qualifier needs
  // something to filter). "public methods" already took the empty-predicate path above.
  if (atoms[0].kind !== "set") return { node: "miss", reason: "start with a clause, then combine with and/or/but-not" };

  let result;
  if (atoms.length === 1) {
    result = atoms[0].ast;
  } else {
    result = { node: "boolean", entityType, atoms };
  }
  if (quals.length) result = { node: "qualifier", filters: quals, inner: result };
  return result;
}

/** Parse a single boolean branch (one predicate over the subject) into a set-AST:
 *  nested (the branch has its own object-relative "that") or a plain simple clause.
 *  Deliberately does NOT re-enter parseRelationalOrQualified — the branch has no
 *  top-level boolean of its own (it was just split off one), so descending there
 *  would only re-detect its gerund/relative lead and recurse on the same text. */
function parseBranchAst(text, nlp, depth) {
  if (depth > MAX_COMPOSE_DEPTH) return { node: "miss", reason: "too deep to resolve" };
  const w = splitWords(text);
  const lc = w.map((x) => x.toLowerCase());
  const nested = parseNested(w, lc, nlp, depth);
  if (nested) return nested;
  const clause = parseSimpleClause(text, nlp);
  return clause ? { node: "clause", clause } : null;
}

/** Split a predicate word array on boolean connectives (longest key first, so
 *  "but not" beats a bare "not"). Returns {branches:[[word…]…], ops:[op…]} with
 *  branches.length === ops.length + 1. */
function splitBoolean(predLc, predWords) {
  const conns = Object.keys(BOOLEAN_CONNECTIVES).sort((a, z) => z.split(" ").length - a.split(" ").length);
  const branches = []; const ops = [];
  let start = 0; let i = 0;
  while (i < predLc.length) {
    let hit = null;
    for (const c of conns) {
      const cw = c.split(" ");
      if (predLc.slice(i, i + cw.length).join(" ") === c) { hit = { c, len: cw.length }; break; }
    }
    if (hit && i > start) {                        // a connective, and not at a branch start (avoid leading "and")
      branches.push(predWords.slice(start, i));
      ops.push(BOOLEAN_CONNECTIVES[hit.c]);
      i += hit.len; start = i;
    } else if (hit) { i += hit.len; start = i; }   // connective at branch start — skip it
    else i += 1;
  }
  branches.push(predWords.slice(start));
  return { branches, ops };
}

// ---- compositional EVALUATION — compile an AST to a graph traversal, reusing the
// same primitives (edgesOfKind, resolveObject, refineToEntities, traverse) the
// simple path uses. Pure given (graph, ast, opts). ----

/** Reverse traversal over a SET of object ids (the nested "callers of {X…}" step) —
 *  mirrors traverse()'s reverse general case (symbol-grain sibling + defines-refine),
 *  but membership-tests e.object against a set instead of a single id. */
function reverseOverSet(graph, kind, entityType, objectIds) {
  const symbolKind = SYMBOL_GRAIN_SIBLING[kind];
  if (symbolKind && FINE_ENTITY_TYPES.has(entityType)) {
    const edges = edgesOfKind(graph, symbolKind).filter((e) => objectIds.has(e.object));
    return uniqueById(edges.map((e) => graph.byId.get(e.subject)).filter((s) => s && s.class === entityType));
  }
  // GRAIN-AWARE OBJECT SET (Phase 11 Track 1, lever 3): when the inner set resolved to
  // FINE symbols (functions/methods/…), also scan the symbol-grain sibling — the coarse
  // edge (touches Commit→Module, calls Module→Module) can never point AT a symbol, so a
  // two-hop whose inner clause produced symbols ("which commits touched the functions
  // that call X") would falsely miss without it. Mirrors traverse()'s objIsFineSymbol
  // branch for the flat path; the module-coarse case is byte-unchanged (no fine ids).
  const objHasFine = !!symbolKind && [...objectIds].some((id) => FINE_ENTITY_TYPES.has(graph.byId.get(id)?.class));
  const scanKinds = objHasFine ? [...kindsFor(kind), symbolKind] : kindsFor(kind);
  const edges = scanKinds.flatMap((k) => edgesOfKind(graph, k)).filter((e) => objectIds.has(e.object));
  const subjects = uniqueById(edges.map((e) => graph.byId.get(e.subject)).filter(Boolean));
  if (!entityType || entityType === "Change") return subjects;
  const direct = subjects.filter((s) => s.class === entityType);
  if (direct.length) return direct;
  if (entityType !== "Module" && subjects.some((s) => s.class === "Module")) {
    return refineToEntities(graph, new Set(subjects.filter((s) => s.class === "Module").map((s) => s.id)), entityType);
  }
  return [];
}

/** Forward traversal over a SET of subject ids (the "things {X…} call/define" step). */
function forwardOverSet(graph, kind, subjectIds) {
  const edges = kindsFor(kind).flatMap((k) => edgesOfKind(graph, k)).filter((e) => subjectIds.has(e.subject));
  return uniqueById(edges.map((e) => graph.byId.get(e.object)).filter(Boolean));
}

function uniqueById(inds) {
  const seen = new Set(); const out = [];
  for (const x of inds) if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
  return out;
}

/** The Module individuals whose path lives strictly UNDER the directory named by
 *  `term` — a proper path-segment prefix match (normPath(label).startsWith(dir +
 *  "/")), never a bare substring, so "src/lib" cannot spuriously catch
 *  "src/libfoo/x.mjs". Mirrors renderArchitecture's own pkg-prefix scoping
 *  (codegraph.mjs) but returns individuals rather than a summary string — this is
 *  the "membership" AST node's directory-scope branch (see its call site above). */
function directoryScopeModules(graph, term) {
  const norm = normPath(term);
  if (!norm) return [];
  const prefix = `${norm}/`;
  return graph.individuals.filter((i) => i.class === "Module" && normPath(i.label).startsWith(prefix));
}

// Per-graph memo for the qualifier attribute/edge sets (exported symbols, tested
// modules, symbol→module map) — computed once, so a qualifier filter over a large
// result set stays cheap and deterministic.
const qualCache = new WeakMap();
function qualSets(graph) {
  let c = qualCache.get(graph);
  if (c) return c;
  const exported = new Set();
  for (const e of edgesOfKind(graph, "reexports")) {
    exported.add(String(e.object).toLowerCase());
    const ind = graph.byId.get(e.object);
    if (ind) exported.add(String(ind.label).toLowerCase());
  }
  const testedModules = new Set(edgesOfKind(graph, "tests").map((e) => e.object));
  const moduleOfSymbol = new Map();
  for (const e of edgesOfKind(graph, "defines")) moduleOfSymbol.set(e.object, e.subject);
  c = { exported, testedModules, moduleOfSymbol };
  qualCache.set(graph, c);
  return c;
}
// KNOWN DIVERGENCE (not a bug, do not merge): this moduleIdOf is DEFINES-EDGE-keyed
// (walks the `defines` edge Module->symbol, built once in qualSets above), while
// codegraph.mjs's own moduleIdOf (codegraph.mjs:1198) is SITE-ATTRIBUTE-keyed (reads
// the individual's `site` attribute / a `fn:<path>#name` id shape) — the two can
// disagree for a symbol whose site attribute and defines edge point at different
// modules (a genuine, currently-untested cross-file edge case), so this file
// deliberately keeps its own copy rather than importing codegraph.mjs's.
function moduleIdOf(graph, ind) {
  if (!ind) return null;
  if (ind.class === "Module") return ind.id;
  return qualSets(graph).moduleOfSymbol.get(ind.id) || null;
}

/** Does an individual satisfy one qualifier (spec from QUALIFIERS)? Reads only
 *  attributes/edges the graph already carries — an unpopulated attribute (e.g.
 *  isAbstract) simply yields false, an honest empty rather than an error. */
function qualHolds(graph, ind, spec) {
  if (!spec) return false;
  switch (spec.via) {
    case "visibility": {
      const v = String((ind.attributes || []).find((a) => a.key === "visibility")?.value || "public").toLowerCase();
      return v === spec.value;
    }
    case "attr":
      return !!(ind.attributes || []).find((a) => a.key === spec.attr)?.value;
    case "exported": {
      const ex = qualSets(graph).exported;
      return ex.has(String(ind.label).toLowerCase()) || ex.has(String(ind.id).toLowerCase());
    }
    case "tested": {
      const mid = moduleIdOf(graph, ind);
      return (!!mid && qualSets(graph).testedModules.has(mid)) === spec.value;
    }
    default: return false;
  }
}

// ---- predicate-find (Workstream 2) — the narrow-then-broaden inheritance cascade
// over `inherits` edges (Class->Class today; ANY entityType that later gains such
// edges between individuals of the SAME class extends automatically — detected
// dynamically via inheritsApplicable, never hardcoded to "Class"). ----

/** All `inherits` edges (subject inherits FROM object — the derived class is the
 *  subject, the base class is the object; RELATIONS.inherits' own comment). */
function inheritsEdges(graph) {
  return edgesOfKind(graph, "inherits");
}
/** Direct subclasses of `id` (edges whose OBJECT is id). */
function directChildrenOf(graph, id) {
  return inheritsEdges(graph).filter((e) => e.object === id).map((e) => e.subject);
}
/** Direct superclasses of `id` (edges whose SUBJECT is id). */
function directParentsOf(graph, id) {
  return inheritsEdges(graph).filter((e) => e.subject === id).map((e) => e.object);
}
/** Every descendant (subclass, transitively) of `id` — cycle-safe BFS. */
function descendantsOf(graph, id) {
  const out = new Set();
  const queue = [...directChildrenOf(graph, id)];
  while (queue.length) {
    const next = queue.shift();
    if (out.has(next)) continue;
    out.add(next);
    for (const c of directChildrenOf(graph, next)) if (!out.has(c)) queue.push(c);
  }
  return out;
}
/** Every ancestor (superclass, transitively) of `id` — cycle-safe BFS. */
function ancestorsOf(graph, id) {
  const out = new Set();
  const queue = [...directParentsOf(graph, id)];
  while (queue.length) {
    const next = queue.shift();
    if (out.has(next)) continue;
    out.add(next);
    for (const p of directParentsOf(graph, next)) if (!out.has(p)) queue.push(p);
  }
  return out;
}
/** Does `entityType` participate in an `inherits`-style subsumption relation TODAY —
 *  at least one inherits edge whose subject AND object are both individuals of this
 *  class? Detected dynamically (never hardcoded to "Class") so the cascade below
 *  extends automatically to any future type that gains such edges; when false, the
 *  broad (ancestor/sibling) pass is simply a no-op and predicate-find degrades to a
 *  flat own-label+attributes match — the common case for Module/Function today.
 *  Memoized per graph (a WeakMap so it never leaks/needs manual invalidation). */
const inheritsApplicableCache = new WeakMap();
function inheritsApplicable(graph, entityType) {
  let byType = inheritsApplicableCache.get(graph);
  if (!byType) { byType = new Map(); inheritsApplicableCache.set(graph, byType); }
  if (byType.has(entityType)) return byType.get(entityType);
  const ok = inheritsEdges(graph).some((e) => {
    const s = graph.byId.get(e.subject); const o = graph.byId.get(e.object);
    return !!s && !!o && s.class === entityType && o.class === entityType;
  });
  byType.set(entityType, ok);
  return ok;
}

/** Does `ind`'s OWN property surface (label, or an attribute value) contain EVERY
 *  token of the fuzzy term (AND across tokens, same tokenizer resolveObject's own
 *  tier-3 uses)? Returns "label" | "attr" | null — the provenance tag findSortHits
 *  scores label hits above attribute-only hits (per the match-scope design). */
function ownSurfaceHit(ind, termTokens) {
  const labelLc = String(ind.label || "").toLowerCase();
  if (termTokens.every((tok) => labelLc.includes(tok))) return "label";
  const attrs = (ind.attributes || []).map((a) => String(a.value ?? "").toLowerCase());
  if (termTokens.every((tok) => attrs.some((v) => v.includes(tok)))) return "attr";
  return null;
}
// own-label hits rank above inheritance-chain hits above attribute-only hits (the
// match-scope design's stated scoring); tie-break by shorter label (the same
// convention resolveObject's own tiers use for a scored tie).
const FIND_TIER = { label: 3, chain: 2, attr: 1 };
function sortFindHits(hits) {
  return hits.slice()
    .sort((a, b) => (FIND_TIER[b.via] - FIND_TIER[a.via]) || (String(a.ind.label).length - String(b.ind.label).length))
    .map((h) => h.ind);
}

/** A BOUNDED-FUZZY (Damerau-Levenshtein, same budget resolveObject's own tier-5
 *  uses) near-match of the WHOLE term against `ind`'s label or any of its
 *  components. Used ONLY by the broad pass below — never the narrow pass, whose
 *  exact-substring `ownSurfaceHit` test already runs against EVERY individual of
 *  the type (ancestors and siblings included, being ordinary pool members too),
 *  so an exact-substring re-test in the broad pass would be logically vacuous: if
 *  narrow found nothing, no individual's own surface can contain the term as a
 *  substring, full stop. Fuzzy near-matching is what makes the broad pass find
 *  something narrow genuinely couldn't (a typo'd or partial name on a relative),
 *  which is also why a broad-pass hit is always rendered "related, not exact" —
 *  it is a near-miss by construction, not a confident equal. */
function fuzzyFindHit(ind, term) {
  const tLc = String(term || "").trim().toLowerCase();
  if (tLc.length < 4) return false; // same floor resolveObject's tier-5 uses
  const bound = fuzzyBound(tLc);
  if (editDistance(String(ind.label || "").toLowerCase(), tLc, bound) <= bound) return true;
  for (const comp of componentSet(ind.label)) {
    if (editDistance(comp, tLc, bound) <= bound) return true;
  }
  return false;
}

/** The narrow-then-broaden search behind evalSet's "find" case and evalComposite's
 *  dedicated "find" handling (predicate-find, Workstream 2):
 *   1. NARROW — for each `entityType` individual, a hit if its OWN surface matches
 *      every term token, OR (when the type participates in `inherits` today) any of
 *      its DESCENDANTS' own surface does — a subclass genuinely IS a kind of its
 *      superclass, so a hit anywhere in the subtree counts as the candidate itself
 *      matching. If this pass finds ≥1 hit anywhere in the pool, it is the WHOLE
 *      answer — never silently widened when a specific answer exists (the same
 *      discipline Bug C's grain-aware resolution establishes). Every individual of
 *      the type is tested here, ancestors and siblings included (they are ordinary
 *      pool members too) — so an EMPTY narrow pass means no individual's own
 *      surface anywhere in the pool contains the term as a substring.
 *   2. BROAD — only when the narrow pass is EMPTY across the WHOLE pool AND the
 *      type participates in `inherits`: for each candidate, walk UP to its
 *      superclass(es); a bounded-FUZZY near-match (fuzzyFindHit, above — never a
 *      repeat of narrow's exact test, which the previous point shows would find
 *      nothing new) on a superclass's own surface counts, and so does one on that
 *      superclass's OTHER direct children (siblings) — always rendered as
 *      "related, not exact" (renderComposite), never an unqualified match.
 *  Returns {narrow, broad} — `broad` is only ever non-empty when `narrow` is empty.
 *  When the type has no inherits edges at all, the broad pass is a no-op and this
 *  degrades to a flat own-label+attributes match (Module/Function today). */
function computeFind(graph, entityType, term) {
  const pool = graph.individuals.filter((i) => i.class === entityType);
  const termTokens = [...componentSet(term)];
  if (!termTokens.length || !pool.length) return { narrow: [], broad: [] };
  const cascade = inheritsApplicable(graph, entityType);

  const narrowHits = [];
  for (const ind of pool) {
    const own = ownSurfaceHit(ind, termTokens);
    if (own) { narrowHits.push({ ind, via: own }); continue; }
    if (!cascade) continue;
    const viaChain = [...descendantsOf(graph, ind.id)].some((did) => {
      const d = graph.byId.get(did);
      return !!d && !!ownSurfaceHit(d, termTokens);
    });
    if (viaChain) narrowHits.push({ ind, via: "chain" });
  }
  if (narrowHits.length || !cascade) return { narrow: sortFindHits(narrowHits), broad: [] };

  const broadHits = new Map(); // id -> {ind, via}
  for (const ind of pool) {
    for (const ancId of ancestorsOf(graph, ind.id)) {
      if (!broadHits.has(ancId)) {
        const anc = graph.byId.get(ancId);
        if (anc && anc.class === entityType && fuzzyFindHit(anc, term)) {
          broadHits.set(ancId, { ind: anc, via: "chain" });
        }
      }
      for (const sibId of directChildrenOf(graph, ancId)) {
        if (sibId === ind.id || broadHits.has(sibId)) continue;
        const sib = graph.byId.get(sibId);
        if (sib && sib.class === entityType && fuzzyFindHit(sib, term)) broadHits.set(sibId, { ind: sib, via: "chain" });
      }
    }
  }
  return { narrow: [], broad: sortFindHits([...broadHits.values()]) };
}

/** Compile a set-producing AST into an array of individuals. */
function evalSet(graph, ast, opts) {
  switch (ast.node) {
    case "clause": return traverse(graph, ast.clause, opts).matches || [];
    case "allOfClass": return graph.individuals.filter((i) => i.class === ast.entityType);
    // predicate-find (Workstream 2), embedded as a set atom (§6 generalization —
    // a find-seed inside a boolean/qualifier fold): the narrow-then-broaden
    // cascade's result, transparently flattened (the "related, not exact" framing
    // is a top-level RENDER concern — evalComposite's dedicated "find" handling
    // below, not this generic embedding).
    case "find": {
      const { narrow, broad } = computeFind(graph, ast.entityType, ast.term);
      return narrow.length ? narrow : broad;
    }
    // the SUBJECTS that have ANY edge of a kind (the existential "modules that import
    // anything") — the positive set an existential negation ("do not import anything")
    // differences off allOfClass to yield "modules that import nothing".
    case "existsEdge": {
      const subs = new Set(kindsFor(ast.kind).flatMap((k) => edgesOfKind(graph, k)).map((e) => e.subject));
      return graph.individuals.filter((i) => subs.has(i.id) && (!ast.entityType || i.class === ast.entityType));
    }
    // forward complement: the verb's object-grain universe MINUS what the (late-resolved,
    // focus-bindable) subject reaches via that verb — "what doesn't it import".
    case "forwardComplement": {
      const r = resolveTermOrContext(graph, ast.subjectTerm, opts && opts.contextId);
      if (!r.match) return [];                              // unresolved subject / focus-less pronoun → honest empty
      const universeType = kindObjectClass(graph, ast.kind);
      if (!universeType) return [];                         // ambiguous object grain → refuse honestly
      const positive = new Set(forwardOverSet(graph, ast.kind, new Set([r.match.id])).map((x) => x.id));
      return graph.individuals.filter((i) => i.class === universeType && !positive.has(i.id));
    }
    case "reverseSet": {
      const ids = new Set(evalSet(graph, ast.inner, opts).map((i) => i.id));
      return reverseOverSet(graph, ast.kind, ast.entityType, ids);
    }
    case "forwardSet": {
      const ids = new Set(evalSet(graph, ast.inner, opts).map((i) => i.id));
      return forwardOverSet(graph, ast.kind, ids);
    }
    case "membership": {
      // DIRECTORY SCOPE ("modules in src/lib", "files in src/handlers"): a bare
      // path term with no exact node of its own is a DIRECTORY, not a single
      // container individual — resolveObject's fuzzy tiers used to land it on ONE
      // arbitrarily-chosen module whose label merely CONTAINS the path substring
      // (e.g. "src/lib" fuzzy-matching "src/lib/logger.mjs"), then traversed that
      // one module's own membership edges for entityType "Module" — which a module
      // never has, so the answer was a false-empty ("no modules in this index.")
      // even though several modules genuinely live under the directory. An EXACT
      // node match (tier 1 — a real file/symbol named that) still wins outright
      // (unchanged single-container-node behavior, e.g. "methods in widget.mjs");
      // only when there is no exact match do we try directory-prefix scope first.
      const r = resolveObject(graph, ast.term);
      if (!(r.match && r.tier === 1)) {
        const dirMods = directoryScopeModules(graph, ast.term);
        if (dirMods.length) {
          if (!ast.entityType || ast.entityType === "Module") return dirMods;
          const ids = new Set(dirMods.map((m) => m.id));
          const objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, ids)));
          return objs.filter((o) => o.class === ast.entityType);
        }
      }
      if (!r.match) return [];
      const ids = new Set([r.match.id]);
      const objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, ids)));
      return ast.entityType ? objs.filter((o) => o.class === ast.entityType) : objs;
    }
    case "qualifier": {
      const base = evalSet(graph, ast.inner, opts);
      return base.filter((ind) => ast.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f])));
    }
    case "boolean": return evalBoolean(graph, ast, opts);
    case "anaphora": return evalAnaphora(graph, ast, opts).matches;
    default: return [];
  }
}

/** Fold a boolean AST left-to-right into a result set. A qualifier atom acts as a
 *  set filter on the accumulator (intersection keeps satisfiers, difference removes
 *  them); a set atom contributes its own id-set for the op. */
function evalBoolean(graph, ast, opts) {
  let acc = [];
  for (const atom of ast.atoms) {
    if (atom.op === "seed") { acc = evalSet(graph, atom.ast, opts); continue; }
    if (atom.kind === "qual") {
      const holds = (ind) => atom.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f]));
      acc = atom.op === "difference" ? acc.filter((i) => !holds(i)) : acc.filter((i) => holds(i));
      continue;
    }
    const oids = new Set(evalSet(graph, atom.ast, opts).map((i) => i.id));
    if (atom.op === "intersection") acc = acc.filter((i) => oids.has(i.id));
    else if (atom.op === "difference") acc = acc.filter((i) => !oids.has(i.id));
    else if (atom.op === "union") {
      const seen = new Set(acc.map((i) => i.id));
      for (const other of evalSet(graph, atom.ast, opts)) if (!seen.has(other.id)) { seen.add(other.id); acc.push(other); }
    }
  }
  return acc;
}

/** Anaphora over ask()'s `prev` id array — filter/count the previous answer's ids.
 *  No prev supplied → honest miss (never a guess), like an unresolved pronoun. */
function evalAnaphora(graph, ast, opts) {
  const prev = opts && opts.prev;
  if (!Array.isArray(prev) || !prev.length) return { compositeMiss: true, reason: "no-prev", matches: [] };
  let items = prev.map((id) => graph.byId.get(id)).filter(Boolean);
  const f = ast.filter;
  if (f && f.type === "qual") {
    items = items.filter((ind) => f.filters.every((q) => qualHolds(graph, ind, QUALIFIERS[q])));
  } else if (f && f.type === "clause") {
    const r = resolveObject(graph, f.clause.object);
    if (!r.match) items = [];
    else {
      // include the symbol-grain sibling so a fn->fn "call" filter tests callsSymbol,
      // not just the module-coarse "calls" edge (mirrors traverse()'s reverse path).
      const sib = SYMBOL_GRAIN_SIBLING[f.clause.kind];
      const kinds = [...kindsFor(f.clause.kind), ...(sib ? [sib] : [])];
      const ok = new Set(kinds.flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.object === r.match.id).map((e) => e.subject));
      items = items.filter((ind) => ok.has(ind.id));
    }
  }
  // a count over a prior set names the entity kind when the survivors share a class.
  const common = items.length && items.every((x) => x.class === items[0].class) ? items[0].class : null;
  if (ast.mode === "count") return { compositeKind: "count", count: items.length, entityType: common, matches: [] };
  return { compositeKind: "set", matches: items, entityType: common };
}

// Structural kinds counted for "most-connected" (total degree). Symbol-grain and
// commit-history kinds are excluded so "connections" reads as the code-structure
// degree a developer means, not every recorded touch.
const DEGREE_KINDS = ["imports", "calls", "callsSymbol", "inherits", "contains", "tests"];
/** Degree of an individual under a superlative metric ({kind, dir, sibling?, filter?}). */
function degreeMetric(graph, ind, metric) {
  const kinds = metric.kind === "*" ? DEGREE_KINDS : [metric.kind, ...(metric.sibling ? [metric.sibling] : [])];
  let n = 0;
  for (const k of kinds) for (const e of edgesOfKind(graph, k)) {
    const out = e.subject === ind.id; const inc = e.object === ind.id;
    if (metric.dir === "out" && out) {
      if (metric.filter) { const o = graph.byId.get(e.object); if (!o || o.class !== metric.filter) continue; }
      n += 1;
    } else if (metric.dir === "in" && inc) n += 1;
    else if (metric.dir === "both" && (out || inc)) n += 1;
  }
  return n;
}
/** TEMPORAL over a nested set (lever 3) — the commits that touched ANY member of the
 *  inner set, newest commit date first. Reuses the SAME touches→commit→date-sort the
 *  flat when-shape runs (mgx:commitDate is ISO-8601, so a lexical sort IS a date sort;
 *  undated commits sort last and render says so). `entityType` is the inner noun, only
 *  for phrasing. An empty inner set (nothing resolved) or no touching commit is an
 *  honest empty — never a guess. */
function evalTemporal(graph, ast, opts) {
  const inner = evalSet(graph, ast.inner, opts);
  const ids = new Set(inner.map((i) => i.id));
  if (!ids.size) return { compositeKind: "temporal", matches: [], entityType: ast.entityType, innerCount: 0 };
  // reverseOverSet(touches) collects the touching commits across BOTH grains (its
  // grain-aware object-set branch reads touchesSymbol when the inner set is symbols).
  const commits = reverseOverSet(graph, "touches", "Commit", ids);
  const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
  commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return { compositeKind: "temporal", matches: commits, entityType: ast.entityType, innerCount: inner.length };
}

function evalSuperlative(graph, ast) {
  const pool = graph.individuals.filter((i) => i.class === ast.entityType);
  const scored = pool.map((ind) => ({ ind, score: degreeMetric(graph, ind, ast.metric) }))
    .sort((a, z) => (ast.extreme === "most" ? z.score - a.score : a.score - z.score));
  if (!scored.length) return { compositeKind: "superlative", entityType: ast.entityType, matches: [] };
  const best = scored[0].score;
  const winners = scored.filter((s) => s.score === best).map((s) => s.ind);
  return { compositeKind: "superlative", entityType: ast.entityType, metricNoun: ast.metricNoun, extreme: ast.extreme, score: best, matches: winners };
}

/** Compile any compositional AST to a result object traverse() returns for the
 *  simple path — {matches, …} plus compositeKind/compositeMiss flags render() reads. */
export function evalComposite(graph, ast, opts = {}) {
  if (ast.node === "miss") return { compositeMiss: true, reason: ast.reason || null, matches: [] };
  if (ast.node === "count") return { compositeKind: "count", count: evalSet(graph, ast.base, opts).length, entityType: ast.entityType, matches: [] };
  if (ast.node === "list") return { compositeKind: "list", matches: evalSet(graph, ast.base, opts), entityType: ast.entityType, scoped: ast.scoped };
  if (ast.node === "superlative") return evalSuperlative(graph, ast);
  if (ast.node === "temporal") return evalTemporal(graph, ast, opts);
  if (ast.node === "anaphora") return evalAnaphora(graph, ast, opts);
  // predicate-find (Workstream 2), TOP-LEVEL: unlike evalSet's "find" case (used
  // when a find-seed is embedded inside a boolean/qualifier fold, §6), this keeps
  // the broad-pass provenance so renderComposite can label a "related, not exact"
  // hit distinctly rather than presenting it as an unqualified match.
  if (ast.node === "find") {
    const { narrow, broad } = computeFind(graph, ast.entityType, ast.term);
    return {
      compositeKind: "find", entityType: ast.entityType, term: ast.term,
      matches: narrow.length ? narrow : broad, broad: !narrow.length && broad.length > 0,
    };
  }
  return { compositeKind: "set", matches: evalSet(graph, ast, opts), entityType: ast.entityType || null };
}

// ---- compositional RENDER — templated, same "honest miss vs cited hit" discipline
// as renderCore. ----

const compositeList = (matches) => listJoin(matches.slice(0, OVERFLOW_CAP)
  .map((m) => (["Function", "Method"].includes(m.class) ? `${m.label}()` : m.label)))
  + (matches.length > OVERFLOW_CAP ? `, …and ${matches.length - OVERFLOW_CAP} more` : "");

/** A compositional worked example for the rephrase hint (§honest miss now shows a
 *  compositional phrasing too). */
export function compositionalHint() {
  return 'compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", "find me the payment class", or (after a listing) "which of those are tested"';
}

/** A short citation line for a SINGLE predicate-find hit — the module it lives in,
 *  when known (mirrors the plain reverse-shape render's grouping convention, just
 *  condensed to one line since there is exactly one hit to cite). */
function describeFindHit(ind) {
  const label = ["Function", "Method"].includes(ind.class) ? `${ind.label}()` : ind.label;
  if (ind.class === "Module") return label;
  const mod = moduleLabelOf(ind);
  return mod && mod !== "(unknown module)" ? `${label} in ${mod}` : label;
}

function renderComposite(parsed, result) {
  if (result.compositeMiss) {
    if (result.reason === "no-prev") {
      return { content: `"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.`, miss: true, ambiguous: false };
    }
    return { content: `couldn't compile this compositional question${result.reason ? ` (${result.reason})` : ""}. ${compositionalHint()}.`, miss: true, ambiguous: false };
  }
  if (result.compositeKind === "count") {
    const noun = result.entityType ? nounFor(result.entityType, result.count) : (result.count === 1 ? "result" : "results");
    return { content: `${result.count} ${noun}.`, miss: false, ambiguous: false, matches: [] };
  }
  if (result.compositeKind === "list") {
    if (!result.matches.length) {
      return { content: `no ${nounFor(result.entityType, 2)} in this index.`, miss: true, ambiguous: false, matches: [] };
    }
    // an unscoped list that overflowed the cap gets a light hint to narrow by module —
    // but only for kinds that live IN a module (a "modules in <module>" or "commits in
    // <module>" scope is meaningless); the scoped forms are already narrow, no hint.
    const scopeable = !["Module", "Commit"].includes(result.entityType);
    const hint = (!result.scoped && scopeable && result.matches.length > OVERFLOW_CAP)
      ? ` — narrow with "${nounFor(result.entityType, 2)} in <module>"`
      : "";
    return { content: `${compositeList(result.matches)}${hint}.`, miss: false, ambiguous: false, matches: result.matches };
  }
  // predicate-find (Workstream 2): zero hits -> an honest miss naming BOTH the type
  // and the term; the broad ("related, not exact") pass is ALWAYS clearly labeled,
  // never presented as an unqualified match — the confident-wrong discipline Bug
  // C's grain-aware resolution established; one hit -> a short citation; many hits
  // -> the standard compositeList/OVERFLOW_CAP convention, reused verbatim.
  if (result.compositeKind === "find") {
    const typeNoun = nounFor(result.entityType, 1);
    if (!result.matches.length) {
      return { content: `no ${nounFor(result.entityType, 2)} found matching "${result.term}".`, miss: true, ambiguous: false, matches: [] };
    }
    const cited = result.matches.length === 1 ? describeFindHit(result.matches[0]) : compositeList(result.matches);
    if (result.broad) {
      return {
        content: `no exact ${typeNoun} named "${result.term}", but found a related ${result.matches.length === 1 ? typeNoun : nounFor(result.entityType, 2)}: ${cited}.`,
        miss: false, ambiguous: false, matches: result.matches, relatedNotExact: true,
      };
    }
    return { content: `${cited}.`, miss: false, ambiguous: false, matches: result.matches };
  }
  if (result.compositeKind === "superlative") {
    if (!result.matches.length) return { content: `no ${nounFor(result.entityType, 2)} to rank in this index.`, miss: true, ambiguous: false };
    const lead = result.extreme === "most" ? "the most" : "the fewest";
    const tie = result.matches.length > 1 ? ` (${result.matches.length}-way tie)` : "";
    return {
      content: `${compositeList(result.matches)} — ${lead} ${result.metricNoun} (${result.score})${tie}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  // temporal (lever 3): the newest touching commit + its date over the inner set;
  // honest empty when nothing in the set was touched, undated commits said out loud —
  // the same discipline as the flat when-shape, now over a composed set.
  if (result.compositeKind === "temporal") {
    const n = result.innerCount || 0;
    const setNoun = result.entityType ? nounFor(result.entityType, n || 2) : (n === 1 ? "entity" : "entities");
    const wasWere = n === 1 ? "was" : "were";
    if (!n) {
      return { content: `nothing in the index matches the inner set, so there is no change history to date.`, miss: true, ambiguous: false, matches: [] };
    }
    if (!result.matches.length) {
      return { content: `no recorded commit touched the ${n} ${setNoun} in that set in this index.`, miss: true, ambiguous: false, matches: [] };
    }
    const newest = result.matches[0];
    const date = (newest.attributes || []).find((a) => a.key === "date")?.value || "";
    if (!date) {
      return { content: `the ${setNoun} in that set ${wasWere} last touched by commit ${newest.label}, but this index records no commit dates — regenerate the graph to attach mgx:commitDate.`, miss: true, ambiguous: false, matches: result.matches };
    }
    const msg = (newest.attributes || []).find((a) => a.key === "message")?.value || "";
    const day = String(date).slice(0, 10);
    const more = result.matches.length - 1;
    return {
      content: `the ${setNoun} in that set ${wasWere} last touched by commit ${newest.label} on ${day}${msg ? ` ("${msg}")` : ""}${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  // set-producing
  if (!result.matches.length) {
    return { content: `nothing in the index matches that${result.entityType ? ` (${nounFor(result.entityType, 2)})` : ""}.`, miss: true, ambiguous: false, matches: [] };
  }
  return { content: `${compositeList(result.matches)}.`, miss: false, ambiguous: false, matches: result.matches };
}

/** The rephrase hint shown on a grammar miss — generated from the SAME tables the parser
 *  uses, so it can never suggest a phrasing the grammar doesn't actually support (§6.3). */
export function rephraseHint() {
  return '"which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit\'s own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph\'s own vocabulary). '
    + compositionalHint();
}

// ---- §4 object-term resolution — mechanical, no embeddings, tiered, stop at first hit ----

function componentSet(s) {
  return new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/** Resolve a free-text object/subject term against the graph's individuals, in priority
 *  order (§4, generalized beyond the module-coupling worked example to cover every verb
 *  family's object grain — `inherits`/`calls` resolve against Class/Function names, not
 *  just modules): a sha-shaped term ("[commit ]<hex≥7>") first resolves against Commit
 *  individuals by unique id/label prefix (see the inline comment), then (1) exact
 *  label/id match, (2) an `ext:` unresolved-target match (today
 *  ext: targets are edge-endpoint STRINGS with no individual of their own — e.g. an
 *  unimported inherits base, or any import target — so this tier returns a synthetic
 *  {id:"ext:<name>", label:<name>, class:null} match rather than an `individuals` lookup;
 *  see PLAN_MECHANICAL_CHAT.md §10 on why external `imports` targets land here rather
 *  than tier 1/3 today), (3) boundary-aware substring/component match, (4) a prose-index
 *  fallback (PLAN_PROSE_INDEX.md §6): the term, tokenized the same way as a docstring, is
 *  looked up against `graph.proseIndex` via `lookupByProseTokens` — an exact WORD-level
 *  overlap match against a symbol's decomposed-identifier or doc-comment tokens, never a
 *  substring/fuzzy guess (the same "no wrong edge" standard as tiers 1-3, just over a
 *  different token source: prose rather than the literal identifier). Only ever consulted
 *  once every literal-identifier tier above has failed, and the result is tagged
 *  `matchedVia: "prose"` so a caller can tell the match came from prose content rather
 *  than the symbol's own name — the render layer does not currently read this (it treats
 *  a resolved match as a resolved match, same "honest miss vs genuine hit" binary tiers
 *  1-3 already use), but the field is there for any caller that wants to surface it. (5)
 *  a bounded Damerau-Levenshtein pass against labels AND label components (two-level
 *  fuzzy, 2026-07-02): a UNIQUE within-bound match resolves, tagged `matchedVia:
 *  "fuzzy"` so render() can say "assuming you meant <label>" out loud; multiple
 *  matches at the same best distance are an honest ambiguity listing the candidates.
 *  Never applied to sha-shaped terms (the commit namespace is exact-or-ambiguous
 *  only) nor to terms under 4 chars (the bound would cover half of everything).
 *  (6) no match at all — an honest miss. Returns {match, candidates, tier, ambiguous
 *  [, matchedVia]} — ambiguous on a true tier-3 score tie, a tier-4 overlap-count
 *  tie, or a tier-5 distance tie.
 *
 *  `opts.expectedClass` (grain-aware resolution, Bug C+D fix): when set, narrows
 *  the candidate POOL to `i.class === expectedClass` before every pool-driven tier
 *  (exact/tier-3/tier-5) — the ranking code within each tier is untouched, only the
 *  universe it ranks over shrinks. The ext: tier (synthetic matches with
 *  `class: null`, never a real individual) is skipped outright when a class is
 *  expected — it can never BE that class. The prose tier (tier 4) filters its hits
 *  to the expected class before picking a winner. Every existing call site passes
 *  no 3rd argument, so `expectedClass` defaults to null and behavior is
 *  byte-identical to before this option existed — this is purely opt-in narrowing
 *  for a caller (traverse()'s reverse case) that already knows what class the
 *  relation's object slot expects ("which modules import logger" must never
 *  resolve "logger" to a same-stem Class). */
export function resolveObject(graph, term, { expectedClass = null } = {}) {
  const t = String(term || "").trim();
  if (!t) return { match: null, candidates: [], tier: null, ambiguous: false };
  const tLc = t.toLowerCase();
  const pool = expectedClass ? graph.individuals.filter((i) => i.class === expectedClass) : graph.individuals;

  // commit-sha tier (checked first, only for sha-shaped terms): "ef74e44e25c8",
  // "commit ef74e44e25c8", "commit:ef74e44", or a full 40-char sha resolve against
  // Commit individuals by id/label prefix (ids are commit:<full-sha>, labels the
  // 12-char short sha), case-insensitive. A UNIQUE prefix is exact-grade over the
  // closed commit namespace (tier 1); a prefix shared by more than one commit is an
  // honest ambiguity listing the candidates — never "the first one"; a hex-looking
  // word matching NO commit falls through to the ordinary tiers unchanged (it may
  // be a real code identifier).
  const shaTerm = tLc.match(/^(commit[:\s])?([0-9a-f]{7,40})$/);
  if (shaTerm) {
    const sha = shaTerm[2];
    const hits = pool.filter((i) => i.class === "Commit"
      && (String(i.id).toLowerCase().startsWith(`commit:${sha}`) || String(i.label).toLowerCase().startsWith(sha)));
    if (hits.length === 1) return { match: hits[0], candidates: [], tier: 1, ambiguous: false };
    if (hits.length > 1) return { match: hits[0], candidates: hits.slice(1, 5), tier: 1, ambiguous: true };
    // the explicit "commit" noun declares intent — with no matching commit, falling
    // through would let the WORD "commit" component-match the Commit schema node (or
    // any identifier containing it): a guess, not a resolution. Bare hex still falls
    // through (it may be a real code identifier).
    if (shaTerm[1]) return { match: null, candidates: [], tier: null, ambiguous: false };
  }

  const exact = pool.find((i) => String(i.label).toLowerCase() === tLc || String(i.id).toLowerCase() === tLc);
  if (exact) return { match: exact, candidates: [], tier: 1, ambiguous: false };

  // ext: targets never have their own individual (they're a raw edge-endpoint id) — find
  // the actual (case-preserved) id off a real edge rather than reconstructing it, so a
  // typo'd term can't silently "resolve" to an ext: id nothing in the graph references.
  const extLc = `ext:${tLc}`;
  let extId = null;
  outer: for (const g of graph.relations) {
    for (const e of g.edges) {
      if (String(e.object).toLowerCase() === extLc) { extId = e.object; break outer; }
    }
  }
  // ext: matches are synthetic (class: null, no real individual) — with a class
  // expected, they can never satisfy it, so skip this tier entirely rather than
  // returning a match whose class silently doesn't match what the caller asked for.
  if (extId && !expectedClass) return { match: { id: extId, label: t, class: null }, candidates: [], tier: 2, ambiguous: false };

  // tier 3 — two disjoint regimes (dotted-symbol fix, 2026-07-02, advisor-verified
  // bug): a DOTTED term with no slash ("res.json", "Widget.render", "walk.mjs") is
  // symbol-shaped (object.member / Class.method / a bare file name), and the old
  // any-substring-of-any-label pass let it land on a module whose PATH merely
  // contains the text ("res.json" -> test/res.json.js — the wrong grain presented
  // as if the term were that file). Such terms now match only (a) symbol labels
  // (whole-term containment, or the ".member" suffix when the owner alias differs:
  // "res.json" -> Response.json), and (b) module labels by EXACT basename equality
  // ("walk.mjs" -> src/walk.mjs — extension-stripped basename equality is
  // deliberately NOT used; that is precisely the phantom-path vector). Symbol
  // matches outrank module matches. Undotted/slashed terms keep the original pass.
  const scored = [];
  const dotted = !tLc.includes("/") && /^[\w$]+(\.[\w$]+)+$/.test(tLc);
  if (dotted) {
    const lastSeg = tLc.split(".").pop();
    for (const m of pool) {
      const label = String(m.label || "").toLowerCase();
      if (m.class === "Module") {
        if (label.split("/").pop() === tLc) scored.push({ ind: m, score: 1000 - Math.abs(label.length - tLc.length) });
      } else if (label.includes(tLc)) {
        scored.push({ ind: m, score: 2000 - Math.abs(label.length - tLc.length) });
      } else if (label.endsWith(`.${lastSeg}`)) {
        scored.push({ ind: m, score: 1500 - Math.abs(label.length - tLc.length) });
      }
    }
  } else {
    const termComps = componentSet(t);
    for (const m of pool) {
      const label = String(m.label || "").toLowerCase();
      if (label.includes(tLc)) {
        scored.push({ ind: m, score: 1000 - Math.abs(label.length - tLc.length) });
        continue;
      }
      const overlap = [...termComps].filter((c) => componentSet(m.label).has(c)).length;
      if (overlap > 0) scored.push({ ind: m, score: overlap * 10 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length) {
    const [best, ...rest] = scored;
    const tied = rest.filter((x) => x.score === best.score);
    return {
      match: best.ind,
      candidates: rest.slice(0, 4).map((x) => x.ind),
      tier: 3,
      ambiguous: tied.length > 0,
    };
  }

  // tier 4: prose-index fallback (PLAN_PROSE_INDEX.md §6) — see the function doc above.
  // The typeof guard is the same viewer-bundle boundary as defaultNlp(): viz.mjs's
  // askSource strips the prose.mjs import but does not inline prose.mjs, so in the
  // browser `lookupByProseTokens` is an undeclared identifier — without the guard,
  // ANY term reaching this tier threw a ReferenceError in the page instead of
  // rendering the honest miss (a real, previously-untested viewer bug).
  // DOTTED terms never consult prose: "res.json" word-matches test/res.json.js's
  // own path tokens, which is the tier-3 phantom-path bug reappearing through a
  // side door — a dotted term names an identifier, and identifiers resolve by
  // label (tiers above) or the bounded fuzzy pass below, or they honestly miss.
  let proseResult = null;
  const proseHits = !dotted && typeof lookupByProseTokens === "function"
    ? lookupByProseTokens(graph.proseIndex, t).filter((h) => !expectedClass || graph.byId.get(h.id)?.class === expectedClass)
    : [];
  if (proseHits.length) {
    const [best, ...rest] = proseHits;
    const bestInd = graph.byId.get(best.id);
    if (bestInd) {
      const tied = rest.filter((h) => h.score === best.score);
      proseResult = {
        match: bestInd,
        candidates: rest.slice(0, 4).map((h) => graph.byId.get(h.id)).filter(Boolean),
        tier: 4,
        ambiguous: tied.length > 0,
        matchedVia: "prose",
      };
      // A UNIQUE SEMANTIC prose hit stands — fuzzy is never consulted (lower
      // tiers fire only on a miss). Two prose outcomes yield to tier 5 instead:
      // (a) an AMBIGUOUS tie — a typo'd identifier ("bulidContextBundle") often
      // word-overlaps several symbols' prose tokens at the same score while its
      // 1-edit NAME match is unique; (b) a hit that only exists because the
      // prose SPELL layer corrected the query token (via:"spell") — the same
      // typo tier 5 resolves with stronger (name) evidence and announces out
      // loud, exactly the division of labour prose.mjs's own spell-layer
      // comment specifies. If tier 5 cannot resolve uniquely either, the
      // stashed prose result is surfaced as-is.
      if (!proseResult.ambiguous && best.via !== "spell") return proseResult;
    }
  }

  // tier 5: bounded fuzzy (see the function doc) — every exact tier above missed
  // (or tier 4 tied), so a typo'd identifier gets one honest chance against labels
  // and their components. sha-shaped terms never reach here (guard above);
  // sub-4-char terms are excluded because a 1-edit budget on 3 chars matches far
  // too much to ever be a unique intent.
  if (!shaTerm && tLc.length >= 4) {
    const bound = fuzzyBound(tLc);
    let best = bound + 1;
    let hits = [];
    for (const m of pool) {
      let d = editDistance(String(m.label || "").toLowerCase(), tLc, bound);
      if (d > 0) {
        for (const comp of componentSet(m.label)) {
          if (d <= 0) break;
          d = Math.min(d, editDistance(comp, tLc, bound));
        }
      }
      if (d < best) { best = d; hits = [m]; }
      else if (d === best && d <= bound) hits.push(m);
    }
    if (best <= bound && hits.length === 1) {
      return { match: hits[0], candidates: [], tier: 5, ambiguous: false, matchedVia: "fuzzy" };
    }
    if (best <= bound && hits.length > 1 && !proseResult) {
      // equidistant fuzzy tie with no prose evidence either — honest ambiguity.
      const [bestInd, ...rest] = hits;
      return { match: bestInd, candidates: rest.slice(0, 4), tier: 5, ambiguous: true, matchedVia: "fuzzy" };
    }
  }
  // fuzzy couldn't resolve uniquely: surface the prose tie (when there was one)
  // exactly as before, else the honest miss.
  return proseResult || { match: null, candidates: [], tier: null, ambiguous: false };
}

/** Resolve a term that may be a context pronoun ("this"/"it"/"that"/"here") —
 *  when `contextId` is given, resolve straight to that graph entity (a real
 *  click/focus in the caller's UI, not a guess); with no contextId, an honest
 *  miss explaining exactly what's missing, distinct from "no such name in the
 *  index". A non-pronoun term always falls through to the ordinary
 *  resolveObject tiers. */
function resolveTermOrContext(graph, term, contextId) {
  if (CONTEXT_PRONOUNS.includes(String(term || "").trim().toLowerCase())) {
    if (!contextId) return { match: null, candidates: [], tier: null, ambiguous: false, unresolvedPronoun: true };
    const ind = graph.byId.get(contextId);
    return ind
      ? { match: ind, candidates: [], tier: 1, ambiguous: false }
      : { match: null, candidates: [], tier: null, ambiguous: false, unresolvedPronoun: true };
  }
  return resolveObject(graph, term);
}

// ---- traversal — orchestrates codegraph.mjs's edgesOfKind; grain-refines a module-coarse
// edge (e.g. imports: Module->Module) down to a finer requested entityType via `defines`
// (Module -> top-level Function/Class/Method/Attribute), never re-implementing edge scans. ----

function refineToEntities(graph, moduleIds, entityType) {
  const out = [];
  for (const e of edgesOfKind(graph, "defines")) {
    if (!moduleIds.has(e.subject)) continue;
    const ind = graph.byId.get(e.object);
    if (ind && ind.class === entityType) out.push(ind);
  }
  return out;
}

/** Everything a commit touched, across BOTH stored grains — touches (Commit->Module)
 *  and touchesSymbol (Commit->fn/method/class) — narrowed by the asked entity type:
 *  "modules"/"files" keeps the coarse grain only, a fine type keeps its own symbol
 *  class only, and null/"Change" ("which changes touch commit X") keeps the union.
 *  The result carries `commitSubject` so render() cites the commit and groups the
 *  touched entities by class instead of pretending the commit was a search target. */
function commitTouches(graph, commit, entityType, extra = {}) {
  // "Commit" counts as wildcard here too: in "what was touched by commit X" the
  // keyword-spotter consumes "commit" as the entity keyword though it belongs to
  // the object noun phrase — and no commit ever touches another commit (no
  // Commit->Commit edges exist), so honoring it as a class filter could only
  // ever manufacture a false blank.
  const wildcard = !entityType || entityType === "Change" || entityType === "Commit";
  const wantCoarse = wildcard || entityType === "Module";
  const wantFine = wildcard || FINE_ENTITY_TYPES.has(entityType);
  const kinds = [...(wantCoarse ? ["touches"] : []), ...(wantFine ? ["touchesSymbol"] : [])];
  let matches = kinds
    .flatMap((k) => edgesOfKind(graph, k))
    .filter((e) => e.subject === commit.id)
    .map((e) => graph.byId.get(e.object))
    .filter(Boolean);
  if (entityType && FINE_ENTITY_TYPES.has(entityType)) matches = matches.filter((m) => m.class === entityType);
  return {
    matches, objMatch: commit, commitSubject: true, ambiguous: false, candidates: [],
    traversal: `${kinds.join("+")} edges where subject = commit ${commit.label}`,
    ...extra,
  };
}

/** Safety net (paired with the render-branch fix earlier in this file's history): a
 *  {shape, kind, entityType} combination must be explicitly listed here to receive
 *  real non-"direct" modifier behavior. Anything parsing to a non-"direct" modifier
 *  that ISN'T listed gets an honest "not supported yet" response from render() —
 *  never a silent fallback to direct-only behavior. This means a future
 *  MODIFIER_TO_KIND addition that forgets to wire traverse()/render() for it fails
 *  loud here, by construction, rather than quietly behaving as if the modifier had
 *  never been given (the exact bug class this file's own render-routing fix, above,
 *  just caught). Today's only non-"direct" value is "transitive" (PLAN_MECHANICAL_
 *  CHAT.md P1), wired below for reverse-shape imports/calls closures over
 *  impactClosure (codegraph.mjs) — module-coarse only; the fine-grained
 *  callsSymbol/touchesSymbol siblings and every other predicate kind have no
 *  closure primitive yet, and forward-shape currently never parses a non-"direct"
 *  modifier at all (both parsing strategies hardcode modifier:"direct" for it). */
function modifierIsWired(shape, kind, entityType) {
  return shape === "reverse" && (kind === "imports" || kind === "calls") && (!entityType || entityType === "Module");
}
// Matches renderImpact's own default (codegraph.mjs) — impactClosure is reused as-is,
// not reimplemented, so its own depth convention is the honest one to inherit.
const TRANSITIVE_MAX_DEPTH = 8;

/** Compile a parsed query into a graph lookup. Pure given (graph, parsed, opts).
 *  `opts.contextId` resolves a context pronoun ("this"/"it"/…) when the parse
 *  needed one. Returns {matches, objMatch, candidates, traversal, ambiguous,
 *  answer?, unresolvedPronoun?} — `answer` only set for the "ask" shape.
 *  `matches` is always an array of individuals (or edge records for "ask"). */
export function traverse(graph, parsed, { contextId = null, prev = null } = {}) {
  if (!parsed) return { matches: [], objMatch: null, candidates: [], traversal: null, ambiguous: false };
  // compositional AST (PLAN §5.16 P3) — the new grammar's nodes carry a `node` tag;
  // everything else (simple clauses, ambiguousParse) flows through the original path
  // below completely unchanged.
  if (parsed.node) return evalComposite(graph, parsed, { contextId, prev });
  if (parsed.ambiguousParse) return { matches: [], objMatch: null, candidates: [], traversal: null, ambiguous: false };
  const { shape, kind, entityType } = parsed;

  // meta: a question about the graph's OWN vocabulary ("what does cochange mean", "what
  // is a Commit") — looked up against the SchemaClass/SchemaPredicate individuals
  // schema-docs.mjs's ingestSchemaDocs merged into the graph, not a code-edge traversal.
  // Matched by exact (case-insensitive) label ("cochange", "Commit") OR the raw `token`
  // attribute a SchemaPredicate also carries ("mgx:callsSymbol") — never substring/fuzzy,
  // same discipline as resolveObject's own tiers: a real term match or an honest miss.
  if (shape === "meta") {
    const term = String(parsed.object || "").trim();
    const termLc = term.toLowerCase();
    const match = (graph.individuals || []).find((i) => {
      if (i.class !== "SchemaClass" && i.class !== "SchemaPredicate") return false;
      if (String(i.label).toLowerCase() === termLc) return true;
      const token = (i.attributes || []).find((a) => a.key === "token")?.value;
      return token && String(token).toLowerCase() === termLc;
    });
    if (!match) {
      // META FALLBACK TO REAL ENTITIES (0.8.2 WS1): "what is a Record" used to say
      // "'Record' isn't a term in this graph's own vocabulary" even when Record is a
      // code-graph Class individual. After the SchemaClass/SchemaPredicate miss, try
      // an exact case-insensitive UNIQUE label match against class === "Class"
      // individuals; a unique hit renders a describe-style one-liner (see render's
      // metaCodeClass branch). Anything less than a unique exact hit keeps the
      // honest vocabulary miss — never a guess.
      const classHits = (graph.individuals || []).filter((i) => i.class === "Class" && String(i.label).toLowerCase() === termLc);
      if (classHits.length === 1) {
        const hit = classHits[0];
        const mid = moduleIdOf(graph, hit);
        const modLabel = (mid && graph.byId.get(mid)?.label)
          || String((hit.attributes || []).find((a) => a.key === "site")?.value || "").split(":")[0]
          || null;
        return {
          matches: [hit], objMatch: hit, candidates: [], ambiguous: false,
          metaCodeClass: true, metaModuleLabel: modLabel,
          traversal: `schema lookup for "${term}" (miss), then unique Class individual by label`,
        };
      }
      return { matches: [], objMatch: null, candidates: [], traversal: `schema lookup for "${term}"`, ambiguous: false };
    }
    return {
      matches: [match], objMatch: match, candidates: [],
      traversal: `schema lookup for "${term}"`, ambiguous: false,
    };
  }

  // mentions: "where is X mentioned" (2026-07-02 query families) — the prose
  // surface, not an edge traversal: list the individuals whose decomposed
  // identifier / doc-comment tokens contain the term's words (the same index
  // resolveObject's tier 4 consults, surfaced directly). The term itself is NOT
  // resolved to an entity first — the question is about mentions of the words,
  // which is exactly what the prose index stores. typeof guard: same viewer-
  // bundle boundary as tier 4 (prose.mjs is never inlined).
  if (shape === "mentions") {
    const term = String(parsed.object || "").trim();
    const hits = typeof lookupByProseTokens === "function" ? lookupByProseTokens(graph.proseIndex, term) : [];
    const matches = hits.map((h) => graph.byId.get(h.id)).filter(Boolean);
    return {
      matches, objMatch: null, candidates: [], ambiguous: false, mentionsShape: true,
      traversal: `proseIndex word lookup for "${term}"`,
    };
  }

  // §modifier support gate (safety net, see modifierIsWired's own doc above) — checked
  // BEFORE object resolution, so an unsupported modifier+kind combination gets its own
  // honest capability-gap message rather than masquerading as an object-miss, or worse,
  // silently behaving as if "transitively"/"indirectly" had never been said.
  if (parsed.modifier && parsed.modifier !== "direct" && !modifierIsWired(shape, kind, entityType)) {
    return {
      matches: [], objMatch: null, candidates: [], ambiguous: false,
      unsupportedModifier: true,
      traversal: `modifier "${parsed.modifier}" requested for a "${kind}" query — no closure traversal exists for this combination yet`,
    };
  }

  if (shape === "ask") {
    const subj = resolveTermOrContext(graph, parsed.subject, contextId);
    const obj = resolveTermOrContext(graph, parsed.object, contextId);
    if (!subj.match || !obj.match) {
      return {
        matches: [], objMatch: obj.match, candidates: obj.candidates, traversal: null, ambiguous: false, answer: null,
        unresolvedPronoun: !!(subj.unresolvedPronoun || obj.unresolvedPronoun),
      };
    }
    // touches edges are stored commit -> entity, so when the question names the
    // commit on the OBJECT side ("was walk.mjs touched by commit X"), orient the
    // edge test by where the commit actually is instead of failing on direction;
    // a commit subject is also checked at the symbol grain ("does commit X touch
    // <function>" lives on touchesSymbol, not the module-coarse kind).
    let [from, to] = [subj.match, obj.match];
    let kinds = kindsFor(kind); // "uses" checks the whole union ("does X use Y")
    if (kind === "touches") {
      if (to.class === "Commit" && from.class !== "Commit") [from, to] = [to, from];
      if (from.class === "Commit") kinds = ["touches", "touchesSymbol"];
    }
    const edges = kinds.flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.subject === from.id && e.object === to.id);
    return {
      matches: edges, answer: edges.length > 0, objMatch: obj.match, subjMatch: subj.match,
      candidates: [], traversal: `${kinds.join("+")} edge from ${from.label} to ${to.label}`, ambiguous: false,
    };
  }

  // reverse and forward both resolve one named term ("object" in the parsed shape — for
  // forward it is the query's grammatical subject, e.g. "what does X import" -> parsed.object = X).
  const { match: objMatch, candidates, ambiguous, unresolvedPronoun, matchedVia } = resolveTermOrContext(graph, parsed.object, contextId);
  if (!objMatch) return { matches: [], objMatch: null, candidates, traversal: null, ambiguous: false, unresolvedPronoun };

  // where: "where is X [defined]" (2026-07-02 query families) — the resolved
  // entity IS the answer; render() reads its class + site attribute ("path:
  // start[-end]", seon:startsAt) for the module/line citation.
  if (shape === "where") {
    const site = (objMatch.attributes || []).find((a) => a.key === "site")?.value || null;
    return {
      matches: [objMatch], objMatch, candidates, ambiguous, matchedVia, whereShape: true, site,
      traversal: site ? `site attribute of ${objMatch.label}` : `class + defining module of ${objMatch.label}`,
    };
  }

  // when: "when did X change" / "when was X last touched" (2026-07-02 query
  // families) — the commits whose touch edges reach X, newest commit date first
  // (mgx:commitDate, ISO-8601, so a lexical sort IS the date sort; undated
  // commits sort last and render() says so honestly). Checked BEFORE the
  // commit-as-subject flip: "when did <sha> change" asks for the commit's own
  // date, not its touched files, so a Commit object answers with itself.
  if (shape === "when") {
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    let commits;
    if (objMatch.class === "Commit") {
      commits = [objMatch];
    } else {
      const edges = ["touches", "touchesSymbol"].flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.object === objMatch.id);
      const seen = new Set();
      commits = [];
      for (const e of edges) {
        if (seen.has(e.subject)) continue;
        seen.add(e.subject);
        const c = graph.byId.get(e.subject);
        if (c && c.class === "Commit") commits.push(c);
      }
      commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    }
    return {
      matches: commits, objMatch, candidates, ambiguous, matchedVia, whenShape: true,
      traversal: `touches+touchesSymbol edges where object = ${objMatch.label}, newest commit date first`,
    };
  }

  // commit-as-subject flip: touches edges are stored commit -> entity, so when the
  // RESOLVED term of a touches question is itself a Commit — "which changes touch
  // commit ef74e44e25c8" (reverse), "what did commit abc1234 touch" (forward),
  // "what changed in abc1234" (casual reverse) — the honest reading is "what did
  // that commit touch": read the edges FROM the commit, grain-selected by the asked
  // entity type, instead of scanning for edges INTO it (a commit is never a touch
  // target, so the un-flipped scan would render a misleading blank).
  if (kind === "touches" && objMatch.class === "Commit") {
    return commitTouches(graph, objMatch, entityType, { candidates, ambiguous, matchedVia });
  }

  if (shape === "forward") {
    // FORWARD CALL UNION (0.8.2 WS1): a kind with a symbol-grain sibling scans the
    // UNION coarse+sibling when the resolved SUBJECT is itself a fine symbol —
    // "what does Widget.render call" lives on callsSymbol (fn->fn), which the
    // module-coarse scan alone can never reach (a coarse edge's subject is a
    // module, so a Function/Method subject rendered a false "no calls edges" while
    // the reverse direction answered). Module subjects never carry a sibling edge,
    // so their scan — and the traversal receipt — stays byte-identical. The receipt
    // names what was actually scanned ("calls+callsSymbol edges where subject = X").
    const fwdSibling = SYMBOL_GRAIN_SIBLING[kind];
    const subjIsFineSymbol = !!(fwdSibling && objMatch.class && FINE_ENTITY_TYPES.has(objMatch.class));
    const fwdKinds = subjIsFineSymbol ? [...new Set([...kindsFor(kind), fwdSibling])] : kindsFor(kind);
    const edges = fwdKinds.flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.subject === objMatch.id);
    const targets = edges.map((e) => graph.byId.get(e.object)).filter(Boolean);
    // dedupe only on the widened scan — the coarse-only path keeps its exact shape.
    const matches = subjIsFineSymbol ? uniqueById(targets) : targets;
    return { matches, objMatch, candidates, traversal: `${fwdKinds.join("+")} edges where subject = ${objMatch.label}`, ambiguous, matchedVia };
  }

  // reverse + transitive (PLAN_MECHANICAL_CHAT.md P1): the gate above guarantees kind is
  // "imports" or "calls" and entityType is null/"Module" here. Reuses impactClosure
  // (codegraph.mjs) AS-IS rather than reimplementing a closure — impactClosure's own
  // dependents map is a REVERSE closure over imports+calls edges TOGETHER (renderImpact's
  // "what would break" framing), not a strict single-predicate chain, so a query for
  // "transitively imports" and one for "transitively calls" both resolve to the SAME
  // mixed reverse-dependency closure. That's a real, deliberate scope decision (matching
  // the plan's own instruction to wire onto "renderImpact's existing closure traversal"
  // rather than build a new predicate-pure one) — the traversal receipt below says so
  // honestly rather than implying a narrower single-predicate result than what was
  // actually computed.
  if (parsed.modifier === "transitive") {
    const levels = impactClosure(graph, objMatch, { maxDepth: TRANSITIVE_MAX_DEPTH });
    const matches = levels.flat().map((d) => graph.byId.get(d.id)).filter(Boolean);
    return {
      matches, objMatch, candidates, ambiguous, matchedVia,
      traversal: `reverse dependency closure over imports+calls edges from ${objMatch.label} (impactClosure, maxDepth=${TRANSITIVE_MAX_DEPTH})`,
    };
  }

  // reverse: "which <entityType> R <objMatch>". GRAIN-AWARE (Cycle 5, lever 3): a kind
  // that carries a symbol-grain sibling reads off the SIBLING when a fine SUBJECT grain
  // was asked for ("which functions call X" → callsSymbol). It ALSO reads off the sibling
  // when the RESOLVED OBJECT is itself a fine symbol, for EVERY kind with a sibling — not
  // only touches: the module-coarse edge (calls Module→Module, touches Commit→Module) can
  // NEVER point at a function/method, so a bare "what calls fnAlpha" scanning the coarse
  // `calls` edges returned a FALSE empty ("No modules found …") while the graph records a
  // real symbol-level caller (Widget.render --callsSymbol--> fnAlpha). The honest answer
  // reads off callsSymbol at symbol grain; a truly-uncalled symbol still renders the
  // honest empty, now with the accurate callsSymbol receipt. (Previously scoped to touches
  // only, which left this exact callsSymbol caller invisible — a genuine correctness bug.)
  const symbolKind = SYMBOL_GRAIN_SIBLING[kind];
  const objIsFineSymbol = !!(objMatch.class && FINE_ENTITY_TYPES.has(objMatch.class));
  if (symbolKind && (FINE_ENTITY_TYPES.has(entityType) || objIsFineSymbol)) {
    const edges = edgesOfKind(graph, symbolKind).filter((e) => e.object === objMatch.id);
    const subjects = uniqueById(edges.map((e) => graph.byId.get(e.subject)).filter(Boolean));
    let matches = (!entityType || entityType === "Change") ? subjects : subjects.filter((i) => i.class === entityType);
    let widenNote = "";
    // FINE-GRAIN FAMILY FALLBACK (0.8.2 WS1): when the exact-class filter comes back
    // EMPTY and the asked grain is Function/Method, retry with the family sibling —
    // "which functions call fnAlpha" must not hide the recorded caller Widget.render
    // just because the extractor stored it as class Method. Fallback-only by
    // construction (the exact filter must be empty first), so every currently
    // non-empty answer is byte-identical; the widening is said in the traversal.
    const siblingClass = FINE_CLASS_SIBLING[entityType];
    if (!matches.length && siblingClass) {
      const widened = subjects.filter((i) => i.class === siblingClass);
      if (widened.length) {
        matches = widened;
        widenNote = `, widened to ${siblingClass} subjects (no ${entityType} recorded)`;
      }
    }
    return { matches, objMatch, candidates, traversal: `${symbolKind} edges where object = ${objMatch.label}${widenNote}`, ambiguous, matchedVia };
  }

  // §grain-aware object resolution (Bug C+D, HANDOVER follow-up #2, checked BEFORE
  // the edge filter below): a predicate's OBJECT slot carries one particular class
  // (kindObjectClass) — resolveObject itself is blind to that, so a same-stem term
  // ("logger") can resolve to the WRONG grain (a Class named Logger) instead of the
  // Module the "imports"/"calls"/… edge actually points at, and the edge filter
  // below then legitimately returns [] for the wrong-grain id — a confident-wrong
  // empty, not an honest miss. `wantClass` is null for a kind whose edges span more
  // than one object class (e.g. "contains") — no grain check applies there, byte-
  // identical to before. objMatch.class === null (an ext: synthetic match, no real
  // individual — see resolveObject's tier 2) is likewise never grain-checked: it has
  // no better class to compare against, and is already the most specific resolution
  // available.
  let gObjMatch = objMatch;
  let gCandidates = candidates;
  let gAmbiguous = ambiguous;
  let gMatchedVia = matchedVia;
  let grainRefinedNote = "";
  const wantClass = kindObjectClass(graph, kind);
  if (wantClass && gObjMatch.class && gObjMatch.class !== wantClass) {
    // (1) retry resolution SCOPED to the expected class — "logger" now only
    // considers Module individuals, so it lands on src/lib/logger.mjs instead of
    // the same-stem Class (fixes Bug C).
    const retry = resolveObject(graph, parsed.object, { expectedClass: wantClass });
    if (retry.match && !retry.ambiguous) {
      gObjMatch = retry.match;
      gCandidates = retry.candidates;
      gAmbiguous = retry.ambiguous;
      gMatchedVia = retry.matchedVia;
    } else if ((kind === "tests" || kind === "cochange") && gObjMatch.class !== "Module") {
      // (2) tests/cochange are always Module->Module — no same-grain alternative
      // exists (the retry above genuinely found nothing), but the resolved
      // fine-grain entity (a Function, say) DOES live in a module, and that
      // module is the real, honest subject of a tests/cochange question ("does
      // createTask have tests" — fixes Bug D). Up-refine via the same moduleIdOf
      // qualHolds's "tested" case already uses (see its divergence comment above).
      const mid = moduleIdOf(graph, gObjMatch);
      const mod = mid && graph.byId.get(mid);
      if (mod) {
        grainRefinedNote = `, refined from ${gObjMatch.label} to its containing module`;
        gObjMatch = mod;
      } else {
        return {
          matches: [], objMatch: gObjMatch, candidates: gCandidates, ambiguous: gAmbiguous, matchedVia: gMatchedVia,
          wrongGrainMiss: true, wantClass,
          traversal: `"${parsed.object}" resolved to ${gObjMatch.class} ${gObjMatch.label} (grain mismatch: this "${kind}" question needs a ${wantClass}, and no containing module could be found to refine to)`,
        };
      }
    } else {
      // (3) neither a same-grain resolution nor an up-refinement applies — an
      // honest wrong-grain miss, distinct from both "unresolved" (the existing
      // objMatch-null branch below, untouched) and "resolved + genuinely empty".
      return {
        matches: [], objMatch: gObjMatch, candidates: gCandidates, ambiguous: gAmbiguous, matchedVia: gMatchedVia,
        wrongGrainMiss: true, wantClass,
        traversal: `"${parsed.object}" resolved to ${gObjMatch.class} ${gObjMatch.label} (grain mismatch: this "${kind}" question needs a ${wantClass})`,
      };
    }
  }

  // General case: some predicates are already fine-grained (inherits: Class->Class, contains:
  // Class->Member) and some are module-coarse (imports/calls/tests/cochange: Module->Module).
  // Rather than assume one or the other, check what the edge's actual subjects ARE: if they
  // already match the requested entityType, use them directly (inherits); only when they're
  // Module individuals and a FINER entityType was asked for do we refine via `defines`
  // (imports) — never blindly treat an edge's subject id as if it were always a module id.
  let edges = kindsFor(kind).flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.object === gObjMatch.id);
  // cochange (Module<->Module, mgx:changeCoupledWith) is a SYMMETRIC relation but
  // stored as ONE directed edge per pair (extractor convention, not a meaningful
  // subject/object direction) — "which modules cochange with X" must also match
  // when X is the STORED SUBJECT of the pair, reading the OTHER endpoint (Track-1
  // trio, temporal lever). Flip subject<->object on that side so the subjects-
  // collection loop below (which reads e.subject) picks up the partner uniformly;
  // the object-side match above is untouched, so an existing non-empty answer is
  // byte-identical.
  if (kind === "cochange") {
    edges = edges.concat(
      kindsFor(kind).flatMap((k) => edgesOfKind(graph, k))
        .filter((e) => e.subject === gObjMatch.id)
        .map((e) => ({ ...e, subject: e.object, object: e.subject })),
    );
  }
  let extNote = "";
  if (!edges.length && gObjMatch.class) {
    // Unresolved ext:<Name> endpoints with the SAME name as the resolved entity:
    // the extractor declined to assert identity (e.g. commander's every "class X
    // extends Command" edge points at ext:Command, never the Class node), so a
    // strict id match renders a FALSE blank. Count them by NAME instead and say
    // so in the receipt — name-grade evidence, labeled as such, same standard as
    // resolveObject's own ext: tier.
    const extId = `ext:${String(gObjMatch.label).toLowerCase()}`;
    edges = kindsFor(kind).flatMap((k) => edgesOfKind(graph, k)).filter((e) => String(e.object).toLowerCase() === extId);
    if (edges.length) extNote = ` (by name, via unresolved ${extId} references)`;
  }
  // dedupe by id: a union kind ("uses") can reach the same subject through two
  // legs (a module that both imports AND calls X), and one answer must list it once.
  const subjects = [];
  const seenSubjects = new Set();
  for (const e of edges) {
    const s = graph.byId.get(e.subject);
    if (s && !seenSubjects.has(s.id)) { seenSubjects.add(s.id); subjects.push(s); }
  }
  let matches, grainNote = "";
  // "Change" (ask-vocab.mjs's pseudo-type) is a wildcard here: "which changes touch
  // walk.mjs" means the touch edges' own subjects — the commits — not a node class
  // to filter by (no individual is ever class "Change", so filtering would always
  // produce a false blank).
  if (!entityType || entityType === "Change") {
    matches = subjects;
  } else {
    const direct = subjects.filter((s) => s.class === entityType);
    if (direct.length) {
      matches = direct;
    } else if (entityType !== "Module" && subjects.some((s) => s.class === "Module")) {
      const moduleIds = new Set(subjects.filter((s) => s.class === "Module").map((s) => s.id));
      matches = refineToEntities(graph, moduleIds, entityType);
      grainNote = `, then ${entityType} defined in the matched module(s)`;
    } else {
      matches = [];
    }
  }
  return {
    matches, objMatch: gObjMatch, candidates: gCandidates,
    traversal: `${kindsFor(kind).join("+")} edges where object = ${gObjMatch.label}${extNote}${grainNote}${grainRefinedNote}`,
    ambiguous: gAmbiguous, matchedVia: gMatchedVia,
  };
}

// ---- §5 templated renderer — string interpolation + grouping/pluralization/overflow rules,
// never generation; every sentence is read off a matched edge/individual. ----

function moduleLabelOf(ind) {
  if (ind.class === "Module") return ind.label;
  const site = (ind.attributes || []).find((a) => a.key === "site")?.value;
  if (site) return String(site).split(":")[0];
  const m = String(ind.id || "").match(/^fn:(.+)#/);
  return m ? m[1] : "(unknown module)";
}

function symbolLabelOf(ind) {
  const label = String(ind.label || ind.id || "");
  return ["Function", "Method"].includes(ind.class) ? `function ${label}()` : label;
}

/** A FRIENDLY commit reference for a "who touched X" list — the raw sha alone reads as
 *  noise, so when the Commit individual carries an author (mgx:commitAuthor → key
 *  "author") name them beside it. The label is already the graph's short ref (the
 *  builder stores sha.slice(0,12)), so it is used verbatim. Degrades gracefully: a
 *  commit with no recorded author renders the sha alone, exactly as before. */
function commitRefOf(ind) {
  const sha = String(ind.label || ind.id || "");
  const author = (ind.attributes || []).find((a) => a.key === "author")?.value;
  return author ? `${sha} (${author})` : sha;
}

function listJoin(syms) {
  return syms.length > 1 ? `${syms.slice(0, -1).join(", ")} and ${syms[syms.length - 1]}` : syms[0];
}

/** One-line, honest rephrasing of a candidate parse — used to describe a
 *  parse-level disagreement between strategies without pretending to pick
 *  a winner. Template only, reads straight off the parsed fields. */
function describeParse(p) {
  const obj = p.object ?? p.subject ?? "?";
  const ent = p.entityType ? nounFor(p.entityType, 2) + " that " : "";
  return `${ent}${p.kind} "${obj}"`;
}

/** Render a compiled query result into {content, miss, ambiguous, matches?, candidates?}.
 *  Every branch is a template, not generation — §5's grouping/pluralization/overflow rules.
 *  A tier-5 fuzzy object resolution is ANNOUNCED, not silent: the answer is prefixed
 *  "assuming you meant <label>:" so the correction is on the record next to the result
 *  (an unannounced fuzzy hit would be indistinguishable from an exact one — a guess). */
export function render(parsed, result) {
  const r = renderCore(parsed, result);
  if (result && result.matchedVia === "fuzzy" && result.objMatch && !r.ambiguous) {
    r.content = `assuming you meant ${result.objMatch.label}: ${r.content}`;
  }
  return r;
}

function renderCore(parsed, result) {
  if (!parsed) {
    return { content: `couldn't parse this as a graph question. Try: ${rephraseHint()}`, miss: true, ambiguous: false };
  }
  if (parsed.node) return renderComposite(parsed, result);
  if (parsed.ambiguousParse) {
    const options = parsed.candidates.map((p, i) => `${i + 1}) ${describeParse(p)}`).join(" or ");
    return {
      content: `this could mean more than one thing: ${options} — try rephrasing more specifically.`,
      miss: false, ambiguous: true, candidates: parsed.candidates.map(describeParse),
    };
  }
  if (result.unresolvedPronoun) {
    return {
      content: `"${parsed.object ?? parsed.subject}" needs a selected node to refer to — click a node first, or name it directly.`,
      miss: true, ambiguous: false,
    };
  }
  if (result.unsupportedModifier) {
    return {
      content: `the "${parsed.modifier}" modifier isn't supported for "${parsed.kind}" queries yet — only imports/calls (module-level) have a transitive closure today.`,
      miss: true, ambiguous: false,
    };
  }
  // wrong-grain honest miss (Bug C+D, traverse()'s general reverse case): the term
  // resolved to a REAL entity, just not the class this predicate's object slot
  // needs, and no same-grain alternative (nor an up-refinement to a containing
  // module) exists — distinct from both the objMatch-null "unresolved" miss below
  // and a resolved-but-genuinely-empty answer.
  if (result.wrongGrainMiss) {
    const gotNoun = result.objMatch.class ? nounFor(result.objMatch.class, 1) : "term";
    const wantNoun = nounFor(result.wantClass, 1);
    return {
      content: `"${parsed.object}" resolved to the ${gotNoun} ${result.objMatch.label}, but this question needs a ${wantNoun} — no ${wantNoun} named "${parsed.object}" was found in the index.`,
      miss: true, ambiguous: false,
    };
  }
  if (parsed.shape === "meta") {
    if (!result.objMatch) {
      return {
        content: `"${parsed.object}" isn't a term in this graph's own vocabulary (no matching class or predicate).`,
        miss: true, ambiguous: false,
      };
    }
    // meta fallback hit (0.8.2 WS1, see traverse's meta branch): the term is not
    // schema vocabulary but IS a unique code-graph Class — a describe-style
    // one-liner pointing at the real entity, instead of the false vocabulary miss.
    if (result.metaCodeClass) {
      const label = result.objMatch.label;
      const definedIn = result.metaModuleLabel ? `, defined in ${result.metaModuleLabel}` : "";
      return {
        content: `${label} is a class in this codebase${definedIn} — try "describe ${label}" or "which classes inherit from ${label}".`,
        miss: false, ambiguous: false, matches: result.matches,
      };
    }
    const doc = (result.objMatch.attributes || []).find((a) => a.key === "doc")?.value || "";
    const kindWord = result.objMatch.class === "SchemaClass" ? "a class in the graph's schema" : "a predicate (relation) in the graph's schema";
    return { content: `${result.objMatch.label} is ${kindWord}: ${doc}`, miss: false, ambiguous: false, matches: result.matches };
  }
  // mentions: the prose surface — checked before the generic objMatch-null miss
  // below, because a mentions result deliberately carries no resolved object
  // (the question is about the term's words, not a graph entity).
  if (result.mentionsShape) {
    if (!result.matches.length) {
      return {
        content: `"${parsed.object}" is not mentioned in any indexed identifier or doc-comment prose.`,
        miss: true, ambiguous: false,
      };
    }
    const shown = result.matches.slice(0, OVERFLOW_CAP).map((m) => `${m.label} (${nounFor(m.class, 1)})`);
    const extra = result.matches.length > OVERFLOW_CAP ? `, …and ${result.matches.length - OVERFLOW_CAP} more` : "";
    return {
      content: `"${parsed.object}" is mentioned in the prose tokens of ${listJoin(shown)}${extra}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  if (!result.objMatch && (!result.candidates || result.candidates.length === 0) && parsed.shape !== "ask") {
    // name what kind of thing was looked for: a sha-shaped term was checked against
    // the commit namespace, a dotted slash-free term against symbol labels — a
    // generic "no module matching" would misreport both.
    const objText = String(parsed.object || "").trim();
    const what = /^(?:commit[:\s])?[0-9a-f]{7,40}$/i.test(objText) ? "commit"
      : (!objText.includes("/") && /^[\w$]+(\.[\w$]+)+$/.test(objText) ? "symbol" : "module");
    return {
      content: `no ${what} matching "${parsed.object}" found in the index.`,
      miss: true, ambiguous: false, candidates: [],
    };
  }
  if (result.ambiguous) {
    // the candidates say what KIND of thing is ambiguous — a shared commit-sha
    // prefix must read "more than one commit", not "module". Name the actual
    // candidates in the prose (not just the structured `candidates` field) —
    // "narrow the term" is not itself actionable if the reader can't see what
    // it's ambiguous between; mirrors the mentionsShape branch's listing above.
    const pool = [result.objMatch, ...(result.candidates || [])].filter(Boolean);
    const noun = pool.length && pool.every((i) => i.class === "Commit") ? "commit" : "module";
    const shown = pool.slice(0, OVERFLOW_CAP).map((i) => i.label);
    const extra = pool.length > OVERFLOW_CAP ? `, …and ${pool.length - OVERFLOW_CAP} more` : "";
    return {
      content: `"${parsed.object}" matches more than one ${noun} ambiguously — did you mean ${listJoin(shown)}${extra}? Try one of those.`,
      miss: false, ambiguous: true, candidates: pool.map((i) => i.label),
    };
  }
  // where: the resolved entity's own location, cited off the site attribute.
  if (result.whereShape) {
    const ind = result.objMatch;
    if (ind.class === "Module") {
      return { content: `${ind.label} is a module — the label is its repo path.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (ind.class === "Commit") {
      return { content: `${ind.label} is a commit, not a code location — try "what did commit ${ind.label} touch".`, miss: true, ambiguous: false };
    }
    const m = String(result.site || "").match(/^(.*):(\d+)(?:-(\d+))?$/);
    if (m) {
      const lines = m[3] && m[3] !== m[2] ? `lines ${m[2]}-${m[3]}` : `line ${m[2]}`;
      return { content: `${symbolLabelOf(ind)} is defined in ${m[1]} at ${lines}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    return {
      content: `${symbolLabelOf(ind)} is defined in ${moduleLabelOf(ind)} (no line span recorded in this index).`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  // when: newest touching commit + its date; undated commits are said out loud
  // (honest miss with the precise re-index hint), never silently skipped.
  if (result.whenShape) {
    const subject = result.objMatch.label;
    if (!result.matches.length) {
      return { content: `no recorded commit touches ${subject} in this index.`, miss: true, ambiguous: false };
    }
    const newest = result.matches[0];
    const date = (newest.attributes || []).find((a) => a.key === "date")?.value || "";
    if (!date) {
      return {
        content: `commit ${newest.label} touched ${subject}, but this index records no commit dates — regenerate the graph to attach mgx:commitDate.`,
        miss: true, ambiguous: false,
      };
    }
    const msg = (newest.attributes || []).find((a) => a.key === "message")?.value || "";
    const day = String(date).slice(0, 10);
    if (newest.id === result.objMatch.id) {
      return { content: `commit ${newest.label} is dated ${day}${msg ? ` ("${msg}")` : ""}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    const more = result.matches.length - 1;
    return {
      content: `${subject} was last touched by commit ${newest.label} on ${day}${msg ? ` ("${msg}")` : ""}${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  // commit-as-subject answers ("which changes touch commit X", "what did commit X
  // touch"): cite the commit, group the touched entities by CLASS — modules and
  // symbols are different grains of the same answer, and flattening them into one
  // undifferentiated list would hide which is which. Same OVERFLOW_CAP as the
  // other list templates; zero hits is the standard honest blank, commit cited.
  if (result.commitSubject) {
    const cite = `commit ${result.objMatch.label}`;
    if (!result.matches.length) {
      return {
        content: `${cite} touched nothing recorded in the index.`,
        miss: true, ambiguous: false,
      };
    }
    const byClass = new Map();
    for (const m of result.matches.slice(0, OVERFLOW_CAP)) {
      const cls = m.class || "Module";
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push(["Function", "Method"].includes(cls) ? `${m.label}()` : m.label);
    }
    const clauses = [...byClass.entries()].map(([cls, labels]) => `${nounFor(cls, labels.length)} ${listJoin(labels)}`);
    const extra = result.matches.length > OVERFLOW_CAP ? `; …and ${result.matches.length - OVERFLOW_CAP} more` : "";
    return { content: `${cite} touched ${clauses.join("; ")}${extra}.`, miss: false, ambiguous: false, matches: result.matches };
  }
  if (parsed.shape === "ask") {
    if (!result.objMatch || !result.subjMatch) {
      return { content: `couldn't resolve one of the terms in this question.`, miss: true, ambiguous: false };
    }
    // the yes render is plain words — the traversal string IS "<kind> edge from
    // <A> to <B>", so it reads as the sentence itself, not a parenthetical receipt
    // (the receipt still rides on the result's traversal field for why/verbose).
    return {
      content: result.answer ? `Yes — ${result.traversal}.` : `No — no ${parsed.kind} edge found from ${result.subjMatch.label} to ${result.objMatch.label}.`,
      miss: !result.answer, ambiguous: false,
    };
  }
  if (!result.matches.length) {
    // forward: parsed.object is the GIVEN subject ("what does X import" -> X), not a
    // search target — "No modules found that X." reads as broken grammar (and X's own
    // relation edges are simply absent, not "not found"), so this shape gets its own,
    // subject-first phrasing rather than reusing reverse's "found ... that OBJECT" template.
    if (parsed.shape === "forward") {
      return {
        content: `${result.objMatch.label} has no ${verbFor(parsed.kind)} edges in the index.`,
        miss: true, ambiguous: false,
      };
    }
    // "what tests cover X" / "what tests X" — the tests themselves are the search
    // target (no explicit entity keyword → entityType null), and "tests" reads as a
    // verb phrase, so the generic "No <modules> found whose module directly tests <obj>"
    // template garbles: it mislabels the searched kind as "modules" and lets the user's
    // leaked verb ride into the object ("…tests cover touch X"). Any leading relation
    // verb (cover/touch/check/verify/… — LEADING_RELATION_VERB_RE, built from the
    // ask-vocab verb table) is stripped, so the honest empty reads as the natural
    // "No tests cover X." The frozen entity-keyword form ("which modules test X",
    // entityType="Module") keeps its pinned wording below.
    if (parsed.kind === "tests" && !parsed.entityType) {
      const stripped = String(parsed.object || "").replace(LEADING_RELATION_VERB_RE, "").trim();
      const obj = stripped || String(parsed.object || "").trim();
      return {
        content: `No tests cover ${obj}.`,
        miss: true, ambiguous: false,
      };
    }
    // NOTE (Cycle 5): a voice-nit rephrasing ("that directly <verb>") was reverted —
    // the frozen v1 cases.jsonl pins the "whose module directly <verb>s X" wording
    // (hm-empty-result-calls / tf-wat-calls / ns-wondering), and the case set is
    // append-only/sacred mid-arc, so the honest-miss phrasing stays as-is.
    const entityWord = nounFor(parsed.entityType || "Module", 2);
    return {
      content: `No ${entityWord} found whose module directly ${verbFor(parsed.kind)} ${parsed.object}.`,
      miss: true, ambiguous: false,
    };
  }
  // Route by the MATCHED entities' actual class, not just the parsed hint — a reverse
  // query phrased without an explicit entity keyword ("what imports X", entityType null)
  // still resolves to Module individuals for a module-level relation like "imports", and
  // grouping those by-module (module label as its own "symbol" label) reads as nonsense
  // ("in a.mjs there is a.mjs"). The fine-grained per-symbol grouping below is only
  // meaningful when the matches are sub-module entities (functions/classes/etc) — a
  // Commit list ("which commits touched X") has no containing module to group by, so
  // anything that is not a fine entity takes the flat join.
  if (parsed.shape === "forward" || parsed.entityType === "Module" || result.matches.every((m) => !FINE_ENTITY_TYPES.has(m.class))) {
    // A reverse "who touched X" resolves to Commit individuals — render friendly refs
    // (short sha + author) instead of the raw stored sha; every other flat list (module
    // labels, etc.) keeps its own label verbatim.
    const shown = result.matches.slice(0, OVERFLOW_CAP).map((m) => m.class === "Commit" ? commitRefOf(m) : m.label);
    const extra = result.matches.length > OVERFLOW_CAP ? `, …and ${result.matches.length - OVERFLOW_CAP} more` : "";
    return { content: shown.join(" and ") + extra + ".", miss: false, ambiguous: false, matches: result.matches };
  }
  // reverse, fine-grained entity: group by module, one clause per module (§5 grouping rule) —
  // the FIRST module states "in {module} there is …"; each SUBSEQUENT module states
  // "there is … in {module}" (module trails, not leads), matching the plan's worked example.
  const byModule = new Map();
  for (const m of result.matches.slice(0, OVERFLOW_CAP)) {
    const mod = moduleLabelOf(m);
    if (!byModule.has(mod)) byModule.set(mod, []);
    byModule.get(mod).push(symbolLabelOf(m));
  }
  const clauses = [...byModule.entries()].map(([mod, syms], i) => {
    const list = listJoin(syms);
    return i === 0 ? `in ${mod} there is ${list}` : `there is ${list} in ${mod}`;
  });
  const extra = result.matches.length > OVERFLOW_CAP ? ` …and ${result.matches.length - OVERFLOW_CAP} more` : "";
  return { content: clauses.join(" and ") + extra + ".", miss: false, ambiguous: false, matches: result.matches };
}

// ============================================================================
// §progressive-relaxation cascade (SHRDLU in a code graph, with a Zork parser's
// forgiveness) — a controlled loop that wraps the WHOLE existing parse and runs
// ONLY when the direct parse of the normalized query would MISS. A clean direct hit
// never enters the cascade (it stays instant and exact); the cascade only ever DROPS
// noise/unmatched words or NORMALISES a near-canonical word to the closed vocabulary,
// re-attempting the full parse (compositional + templates + keyword-spot) after each
// transform, and bottoms out in the SAME honest miss + rephrase hint the engine
// already returned — never inventing a term or guessing an entity. Deterministic:
// same input → same cascade path. All of it is plain JS over the already-imported
// tables + resolveObject/parseQuery, so it survives the viewer bundle's import strip.
// ============================================================================


/** Every token the CLOSED grammar gives QUERY MEANING to — relation verbs, entity
 *  nouns, modifiers, qualifiers, aggregate/superlative triggers, edge-degree nouns,
 *  boolean connectives, placeholder nouns, anaphora/meta/where/mention markers,
 *  relative pronouns, and the small synonym keys. The noise-strip pass will NEVER
 *  remove one of these, and the drop-unmatched pass always keeps them: they carry the
 *  intent, only the packaging around them is negotiable. */
const CONTENT_VOCAB = new Set([
  ...wordsOf(Object.keys(VERB_TO_KIND)), ...wordsOf(Object.keys(ENTITY_TO_TYPE)),
  ...wordsOf(Object.keys(MODIFIER_TO_KIND)), ...wordsOf(Object.keys(QUALIFIERS)),
  ...wordsOf(AGGREGATE_TRIGGERS), ...wordsOf(Object.keys(SUPERLATIVE_EXTREMES)),
  ...wordsOf(Object.keys(EDGE_NOUN_TO_METRIC)), ...wordsOf(Object.keys(BOOLEAN_CONNECTIVES)),
  ...wordsOf(PLACEHOLDER_NOUNS), ...wordsOf(ANAPHORA_TRIGGERS), ...wordsOf(META_MEANING_VERBS),
  ...wordsOf(WHERE_MARKERS), ...wordsOf(MENTION_MARKERS), ...wordsOf(RELATIVE_PRONOUNS),
  ...wordsOf(Object.keys(CASCADE_SYNONYMS)),
]);

/** Structural scaffolding words — question words, articles-in-questions, frame verbs,
 *  and context pronouns. Not "content", but they hold a sentence together, so the
 *  drop-unmatched pass keeps them (dropping "what"/"of" would corrupt the grammar);
 *  the noise-strip pass may still remove the few of these that are ALSO curated noise
 *  ("the"/"a"/"show"/"me") — the two sets overlap on purpose. */
const STRUCTURAL_WORDS = new Set([...STOPWORDS, ...FRAME_WORDS, ...CONTEXT_PRONOUNS]);
const CASCADE_NOISE_SET = new Set(wordsOf(CASCADE_NOISE));
/** Every token that carries NO graph meaning of its own — curated noise (articles,
 *  politeness, vocatives, presentation frames) PLUS the structural scaffolding
 *  (question words, context pronouns). The bare-kind-noun terminal rule (relaxParse's
 *  Layer 4) treats a query as "just a kind noun wrapped in packaging" only when every
 *  non-kind token is one of these — so an unknown qualifier ("shiny") or a relation
 *  verb, being neither, still blocks the default and preserves the honest miss. */
const NOISE_OR_SCAFFOLD = new Set([...CASCADE_NOISE_SET, ...STRUCTURAL_WORDS]);

/** The aggregate/list TRIGGER words the cascade's drop-unmatched pass will fuzzy-correct
 *  a typo toward (Gap 2, trigger-typo work). Curated (not derived from LIST_TRIGGERS'
 *  multi-word phrases) so the target set stays clean single verbs — "many", "count",
 *  "list", "show", … — and never drags in a stray "down"/"off"/"out" from a phrasal
 *  trigger that would mis-correct an unrelated token. */
const TRIGGER_FUZZY_WORDS = [
  "many", "count", "number", "quantity", "total", "tally",
  "list", "show", "display", "print", "dump", "enumerate", "name",
];
/** Closed-vocab words a plain unknown may be fuzzy-corrected TOWARD before the cascade
 *  discards it: relation verbs, entity kind nouns, and the aggregate/list triggers. A
 *  correction fires only on a token already bound for the drop pile (grammar doesn't own
 *  it, no entity resolves) and only for a UNIQUE within-bound target, so it strictly
 *  beats dropping — a typo of a trigger keeps its intent instead of being lost. Excludes
 *  STOPWORDS/structural words (a random unknown must never bend into "what"/"the") and
 *  <4-char words (at the small bound they match half of English). */
const CASCADE_FUZZY_TARGETS = [...new Set([
  ...wordsOf(Object.keys(VERB_TO_KIND)),
  ...Object.keys(ENTITY_TO_TYPE),
  ...TRIGGER_FUZZY_WORDS,
])].filter((wd) => /^[a-z]+$/.test(wd) && wd.length >= 4 && !STOPWORDS.has(wd));

/** UNIQUE within-bound fuzzy correction of `w` toward CASCADE_FUZZY_TARGETS, or null —
 *  a distance tie between two distinct targets is refused (honest-miss discipline at the
 *  vocabulary level, cf. fuzzyVocabWord). */
function fuzzyCascadeWord(w) {
  const bound = fuzzyBound(w);
  let best = bound + 1; let hit = null; let tied = false;
  for (const target of CASCADE_FUZZY_TARGETS) {
    const d = editDistance(w, target, Math.min(best, bound));
    if (d < best) { best = d; hit = target; tied = false; }
    else if (d === best && d <= bound && target !== hit) tied = true;
  }
  return best <= bound && !tied ? hit : null;
}

/** The typo→schema-term trap guard (chatbench cycle 2, CHATBENCH_001 L3 — the
 *  tf-modles hard fail). A term that resolves ONLY via the tier-5 bounded-fuzzy
 *  pass onto one of the graph's OWN vocabulary individuals (a SchemaClass/
 *  SchemaPredicate that ingestSchemaDocs merged in), while the same word ALSO
 *  fuzzy-corrects to an entity KIND NOUN of the closed grammar ("modles" →
 *  "modules"), is a typo'd kind noun, not a question about the schema term:
 *  without this guard, "which modles import a.mjs" silently pivoted onto the
 *  CLASS Module and confidently answered a question the visitor never asked
 *  ("No — no imports edge found from Module to app/lib/a.mjs"). Reporting the
 *  parse unanswerable sends it to the relaxation cascade, whose drop-unmatched
 *  layer restores the kind noun (fuzzyCascadeWord) and whose winning re-parse is
 *  ANNOUNCED as a repair receipt ('read as "which modules import a.mjs" — …').
 *  If the cascade cannot produce a real answer, the original parse still stands
 *  (ask() keeps the direct parse when relaxParse returns null), so a genuine
 *  schema-adjacent question is never turned into a new kind of miss. Exact and
 *  substring/prose matches are untouched — the guard reads matchedVia:"fuzzy"
 *  only, and only when the kind-noun reading exists. */
function schemaTypoTrap(resolution, term) {
  if (!resolution?.match || resolution.matchedVia !== "fuzzy" || resolution.ambiguous) return false;
  const cls = resolution.match.class;
  if (cls !== "SchemaClass" && cls !== "SchemaPredicate") return false;
  const lc = String(term || "").trim().toLowerCase();
  const kindNoun = fuzzyCascadeWord(lc);
  return !!kindNoun && kindNoun !== lc && !!ENTITY_TO_TYPE[kindNoun];
}

/** Is `parsed` a genuinely ANSWERABLE query — one that both parsed AND (for the simple
 *  clauses) resolves its named term(s) to a graph entity? A composite non-miss node,
 *  an ambiguous parse, and a meta/mentions surface all count; an unresolved-context
 *  pronoun is its OWN specific honest miss (kept, not relaxed). Returns:
 *    true       — a real, executable answer (even if it later renders an empty set / "No")
 *    "ambiguous"/"pronoun" — a specific outcome to keep, distinct from relaxable
 *    false      — no parse at all, a compositional {node:"miss"}, an unresolved term,
 *                 or a fuzzy-only schema-individual hit with a kind-noun reading
 *                 (schemaTypoTrap above — relaxable, so the cascade can re-read it)
 *  ask() starts the cascade ONLY on `false`, and accepts a relaxed attempt ONLY on the
 *  strict `true` (so the cascade can never "rescue" a query into another kind of miss). */
function answerable(graph, parsed, contextId) {
  if (!parsed) return false;
  if (parsed.ambiguousParse) return "ambiguous";
  if (parsed.node) return parsed.node !== "miss";
  if (parsed.shape === "meta" || parsed.shape === "mentions") return true;
  const o = resolveTermOrContext(graph, parsed.object, contextId);
  if (o.unresolvedPronoun) return "pronoun";
  if (!o.match || schemaTypoTrap(o, parsed.object)) return false;
  if (parsed.shape === "ask") {
    const s = resolveTermOrContext(graph, parsed.subject, contextId);
    if (s.unresolvedPronoun) return "pronoun";
    return s.match && !schemaTypoTrap(s, parsed.subject) ? true : false;
  }
  return true;
}

/** Whole-query help/orientation request → show the hint directly (never the relaxation
 *  loop, never a pretend answer). Matches only when the ENTIRE normalized query is a
 *  curated HELP_TRIGGER, so a symbol named "help" in a real question is untouched. */
function isHelpRequest(query) {
  const q = String(query || "").trim().toLowerCase().replace(/[?.!\s]+$/, "");
  return HELP_TRIGGERS.includes(q);
}

/** The relaxation cascade. Given a query whose direct parse MISSED, walk three
 *  increasingly-permissive layers, re-attempting the full parse after each transform,
 *  and return the FIRST attempt that yields an answerable parse (with a trace of what
 *  it did) — or null if none does (caller then falls back to the original honest miss):
 *    1. NOISE-STRIP    — remove one curated noise token (leftmost) at a time, never one
 *                        that is content vocab or resolves to an entity, re-parsing each
 *                        time, until a parse answers or no noise tokens remain.
 *    2. DROP-UNMATCHED — drop the plain-lowercase words that are NEITHER grammar NOR a
 *                        resolvable entity (an unknown "frobnicate"); identifier-shaped
 *                        tokens (dotted files, shas, CamelCase) are never dropped —
 *                        they are content that may honestly fail to resolve.
 *    3. SYNONYM        — rewrite surviving near-canonical words to the closed vocab.
 *  Bounded (one token removed per noise iteration; hard guard) and deterministic. */
export function relaxParse(graph, query, { nlp = undefined, contextId = null, prev = null } = {}) {
  const from = applyNegationFrames(normalizeQuery(String(query || "")));
  let tokens = splitWords(from);
  if (!tokens.length) return null;
  const dropped = [];
  const steps = [];

  // Two literal-resolution guards (never the fuzzy/prose tiers, whose loose near-
  // matches would let a noise word masquerade as an entity):
  //  · resolvesExact  — EXACT label/id or ext: match only (tier ≤ 2). Used to protect a
  //    curated NOISE word from being stripped: only a token that literally NAMES an
  //    entity ("a module called `the`") is safe-listed. A mere substring coincidence
  //    ("me" ⊂ "Method", tier 3) must NOT block stripping a genuine filler word.
  //  · resolvesLiteral — exact/ext/substring/component (tier ≤ 3). Used to KEEP an
  //    identifier-shaped content token ("logging" ⊂ "src/logging.mjs") through the
  //    drop-unmatched pass, and to hold a synonym rewrite off a real entity name.
  const resolvesExact = (t) => {
    const r = resolveObject(graph, t);
    return !!r.match && r.tier != null && r.tier <= 2;
  };
  const resolvesLiteral = (t) => {
    const r = resolveObject(graph, t);
    return !!r.match && r.tier != null && r.tier <= 3;
  };
  // Does a term string carry at least one REAL word — one the grammar doesn't already
  // own as vocabulary/scaffolding? Guards against a relaxation that drops the actual
  // asked term and lets a bare marker slide into its place ("where is [X] defined" →
  // "where is defined", "defined" is a WHERE_MARKER, never the thing being located).
  const hasRealTerm = (s) => splitWords(String(s || "")).some((w) => {
    const lc = w.toLowerCase();
    return !CONTENT_VOCAB.has(lc) && !STRUCTURAL_WORDS.has(lc);
  });
  // Accept a relaxed attempt ONLY if it is a genuinely answerable parse (terms resolve)
  // AND it renders a REAL positive answer — never another empty/miss (relaxation earns a
  // win only by turning a miss into an answer, never a differently-worded miss) — and
  // never by promoting a bare marker to the asked term.
  const TERM_SHAPES = new Set(["reverse", "forward", "where", "when", "ask"]);
  const attempt = (toks) => {
    const text = toks.join(" ");
    const p = parseQuery(text, { nlp });
    if (answerable(graph, p, contextId) !== true) return null;
    if (p && !p.node && TERM_SHAPES.has(p.shape)) {
      if (p.object != null && !hasRealTerm(p.object)) return null;
      if (p.shape === "ask" && p.subject != null && !hasRealTerm(p.subject)) return null;
    }
    const rendered = render(p, traverse(graph, p, { contextId, prev }));
    return rendered.miss ? null : { parsed: p, text };
  };
  const done = (hit) => ({ parsed: hit.parsed, from, to: hit.text, dropped: [...dropped], steps });

  // Layer 1 — NOISE-STRIP (one lowest-value token at a time)
  let guard = 0;
  const hardCap = Math.max(tokens.length, 1) + 12;
  for (; guard < hardCap; guard += 1) {
    let idx = -1;
    for (let i = 0; i < tokens.length; i += 1) {
      const lc = tokens[i].toLowerCase();
      if (CASCADE_NOISE_SET.has(lc) && !CONTENT_VOCAB.has(lc) && !resolvesExact(tokens[i])) { idx = i; break; }
    }
    if (idx < 0) break;
    const removed = tokens[idx];
    tokens = tokens.filter((_, i) => i !== idx);
    dropped.push(removed);
    steps.push(`strip noise "${removed}" → "${tokens.join(" ")}"`);
    const hit = attempt(tokens);
    if (hit) return done(hit);
  }

  // Layer 2 — DROP-UNMATCHED (plain-lowercase unknowns beside the real terms)
  const survivors = [];
  const nowDropped = [];
  const corrected = [];
  for (const t of tokens) {
    const lc = t.toLowerCase();
    const plain = /^[a-z]+$/.test(lc);
    if (!plain || CONTENT_VOCAB.has(lc) || STRUCTURAL_WORDS.has(lc) || resolvesLiteral(t)) {
      survivors.push(t);
      continue;
    }
    // Gap 2 — before dropping an unmatched plain token, try a bounded fuzzy-correct to a
    // UNIQUE closed-vocab word (verbs, entity kinds, aggregate/list triggers): a typo of
    // a TRIGGER ("manyn"→"many", "coutn"→"count", "liist"→"list") is restored, not
    // discarded, so the count/list intent survives. Only a unique within-bound hit; else
    // the token is genuinely unrecoverable and drops exactly as before.
    const fix = fuzzyCascadeWord(lc);
    if (fix && fix !== lc) { survivors.push(fix); corrected.push(`${t}→${fix}`); continue; }
    nowDropped.push(t);
  }
  if ((corrected.length || nowDropped.length) && survivors.length) {
    tokens = survivors;
    dropped.push(...nowDropped);
    if (corrected.length) steps.push(`fuzzy-correct ${JSON.stringify(corrected)} → "${tokens.join(" ")}"`);
    if (nowDropped.length) steps.push(`drop unmatched ${JSON.stringify(nowDropped)} → "${tokens.join(" ")}"`);
    const hit = attempt(tokens);
    if (hit) return done(hit);
  }

  // Layer 3 — SYNONYM-NORMALISE the survivors onto the canonical vocabulary
  let changed = false;
  const normed = tokens.map((t) => {
    const lc = t.toLowerCase();
    if (CASCADE_SYNONYMS[lc] && !resolvesLiteral(t)) { changed = true; return CASCADE_SYNONYMS[lc]; }
    return t;
  });
  if (changed) {
    steps.push(`normalise synonyms → "${normed.join(" ")}"`);
    const hit = attempt(normed);
    if (hit) return done(hit);
  }

  // Layer 4 (terminal) — BARE KIND NOUN → a bounded DEFAULT ACTION. When noise-strip,
  // drop-unmatched and synonym-normalise have all failed to yield an answerable parse,
  // give the operator's "vague enough to land" case a sensible answer instead of an
  // honest miss: a query that is ONLY a kind noun (class/classes, function/functions,
  // module, method, attribute, variable, commit, …) wrapped in articles/noise/question
  // words DEFAULTS TO A COUNT of that kind ("the classes" / "classes" / "tell me the
  // classes" → "20 classes."). Count, not list: a bare unscoped list of 647 functions is
  // noise, whereas the count is the cheap useful answer the asker can then drill into
  // ("list them"). Deterministic — count for every kind, no cardinality cap.
  //
  // We classify the ORIGINAL normalized tokens (`from`), NOT the layer-mutated `tokens`:
  // drop-unmatched has by now EATEN any unknown qualifier, so "the shiny classes" would
  // otherwise look identical to a bare "classes". Reading the whole phrase keeps the
  // discipline exact — the rule fires ONLY when every non-kind token is pure packaging
  // (NOISE_OR_SCAFFOLD). A dangling unknown qualifier ("the shiny classes"), a relation
  // verb, a marker, or a real term is neither noise nor a kind noun, so it lands in
  // `others`, blocks the default, and the honest miss (or the real compositional query,
  // if a lower layer already rescued it) stands.
  const bareLc = splitWords(from).map((t) => t.toLowerCase());
  const kindWords = [];
  const others = [];
  for (const t of bareLc) {
    if (NOISE_OR_SCAFFOLD.has(t)) continue;
    // real entity kinds only — "change"/"changes" is ask-vocab's pseudo-type (never a
    // node class), so it is not a countable kind; it falls into `others`.
    const et = ENTITY_TO_TYPE[t];
    if (et && et !== "Change") kindWords.push(t);
    else others.push(t);
  }
  if (kindWords.length === 1 && others.length === 0) {
    // reuse the whole aggregate pipeline (parseAggregate → count node → renderer): a
    // synthesized "count <kind>" is the exact query the cascade's other count paths land.
    const hit = attempt(["count", kindWords[0]]);
    if (hit) { steps.push(`bare kind "${kindWords[0]}" → count`); return done(hit); }
  }
  // A LONE unknown noun wrapped only in packaging ("the bananas") is left to the generic
  // honest miss (the rephrase hint already NAMES the kinds): a crisper "isn't a listable
  // kind" miss here would fire on every one-word non-query the same way ("tell me a joke"),
  // which chat.mjs's own surface deliberately answers with the general hint — so the
  // bare-noun default is a COUNT of a KNOWN kind only, never a re-worded miss.

  return null; // exhausted — the honest bottom of the cascade (caller keeps the original miss)
}

// ---- orchestration — the tmct_ask entry point (§6.3: parse -> resolve -> traverse -> render) ----

/** Answer a free-text question over the graph, mechanically. `opts.contextId`
 *  resolves a context pronoun ("this"/"it"/…) — wired from a UI's currently-
 *  selected node when one exists; omit it in the bare CLI surface, where
 *  a pronoun then produces an honest miss rather than a guess. `opts.nlp`
 *  overrides the lemma/POS adapter (see parseQuery) — leave it undefined and
 *  a Node process picks up wink automatically while the inlined viewer stays
 *  adapter-less by construction. `opts.prev` is the id array of the LAST answer's
 *  matches — thread it from a chat loop so a follow-up anaphora question ("which of
 *  those are tested", "how many of them call X") filters/counts the prior result
 *  set; omit it and anaphora questions produce an honest "needs a previous answer"
 *  miss. Returns the full {content, tmct_ask:
 *  {mechanical,parsed,matches,traversal,miss,ambiguous,candidates?}} envelope
 *  §6.2 specifies. Zero generative model calls. */
export function ask(graph, query, { contextId = null, nlp = undefined, prev = null } = {}) {
  // Explicit help/orientation request → the rephrase hint directly (the honest bottom
  // of the cascade, reached on demand), never a pretend answer or a relaxation attempt.
  if (isHelpRequest(query)) {
    return {
      content: rephraseHint(),
      tmct_ask: {
        mechanical: true, parsed: null, matches: [], traversal: null,
        miss: true, ambiguous: false, matchedVia: null, help: true, relaxed: null,
      },
    };
  }
  const direct = parseQuery(query, { nlp });
  // The relaxation cascade fires ONLY when the DIRECT parse would miss (no parse, a
  // compositional {node:"miss"}, or an unresolved named term) — a clean hit, an
  // ambiguous parse, an unresolved-pronoun miss, and a real-but-empty answer all keep
  // the direct parse untouched (a hit stays instant and exact).
  let parsed = direct;
  let relaxed = null;
  if (answerable(graph, direct, contextId) === false) {
    const r = relaxParse(graph, query, { nlp, contextId, prev });
    if (r) { parsed = r.parsed; relaxed = { from: r.from, to: r.to, dropped: r.dropped, steps: r.steps }; }
  }
  const result = traverse(graph, parsed, { contextId, prev });
  const rendered = render(parsed, result);
  // If relaxation materially rewrote the query and produced a real answer, note it
  // lightly (terse, honest) so the reader knows how the question was read.
  const content = (relaxed && !rendered.miss && relaxed.to !== relaxed.from)
    ? `read as "${relaxed.to}" — ${rendered.content}`
    : rendered.content;
  return {
    content,
    tmct_ask: {
      mechanical: true,
      parsed: (parsed && !parsed.ambiguousParse) ? parsed : null,
      matches: (result.matches || []).map((m) => ({
        id: m.id, label: m.label, type: m.class, module: m.class ? moduleLabelOf(m) : undefined,
      })),
      traversal: result.traversal || null,
      miss: !!rendered.miss,
      ambiguous: !!rendered.ambiguous,
      // The relaxation trace: null when the direct parse was used as-is (a clean hit or
      // an honest miss the cascade couldn't/shouldn't rescue), else what the cascade
      // dropped/normalised to reach an answer. A caller can assert relaxed===null to
      // prove the cascade never touched a direct hit.
      relaxed,
      // Confidence provenance: "prose" when resolveObject fell through to the tier-4
      // prose-index fallback (PLAN_PROSE_INDEX.md §6 — matched what the symbol talks
      // about, not its name); "fuzzy" when the tier-5 bounded-edit-distance pass
      // resolved a typo'd term (the rendered content also announces it: "assuming you
      // meant <label>"); null for every literal-identifier tier.
      matchedVia: result.matchedVia || null,
      ...(rendered.ambiguous ? { candidates: rendered.candidates } : {}),
    },
  };
}
