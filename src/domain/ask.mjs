// ask.mjs — a mechanical (zero-model-call) natural-language query engine over
// the tmct graph. A small, closed English grammar compiles a free-text
// question into a graph traversal, then renders a templated, citation-faithful
// answer. A miss is a stated blank, never a guess.
//
// Four pure, independently-testable stages, orchestrated by ask():
//   parseQuery (grammar)  ->  resolveObject (mechanical term resolution)  ->
//   traverse (graph lookup)  ->  render (templates).
//
// Term/keyword matching is tiered: exact curated match always wins; a
// Node-only wink-nlp lemma/POS tier and a bounded Damerau-Levenshtein fuzzy
// tier fire only on a miss, a unique fuzzy hit is announced in the answer,
// and any tie surfaces as ambiguity.
//
// ask.mjs's own `touches`/`cochange` verbs answer one-hop structural edges
// (mgx:touchedByCommit / mgx:changeCoupledWith).

import { relationKind, impactClosure, moduleCountOf, normPath, HISTORY_CAP } from "./codegraph.mjs";
import { isTestPath } from "./module-paths.mjs";
import {
  RELATIONS,
  VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND,
  CONTEXT_PRONOUNS, META_MEANING_VERBS,
  WHERE_MARKERS, MENTION_MARKERS,
  RELATIVE_PRONOUNS, PLACEHOLDER_NOUNS, BOOLEAN_CONNECTIVES, QUALIFIERS,
  PASSIVE_PARTICIPLE_TO_KIND, GENERIC_AGENT_WORDS,
  AGGREGATE_TRIGGERS, LIST_TRIGGERS, SUPERLATIVE_EXTREMES, EDGE_NOUN_TO_METRIC, METRIC_IMPLIES_ENTITY, ANAPHORA_TRIGGERS,
  MEMBERSHIP_KINDS, CASCADE_NOISE, CASCADE_SYNONYMS, HELP_TRIGGERS,
  stripTrailingScopeFiller,
} from "./ask-vocab.mjs";
import { expandContractions, normalizeQuery, applyNegationFrames, applyPhrasingFrames, matchNegationSet, STOPWORDS, splitWords, wordsOf } from "./interpret/normalize.mjs";
import { editDistance, fuzzyBound } from "./interpret/fuzzy.mjs";
import { parseAnchored } from "./interpret/strategies/grammar.mjs";
import { parseKeywordSpot, findPhrase } from "./interpret/strategies/keywords.mjs";
import { runStrategiesSync } from "./interpret/pipeline.mjs";
import { mergeStrategyResults, alternateLines } from "./interpret/merge.mjs";
import { lookupByProseTokens, splitIdentifierWords } from "./prose.mjs";
import { pickPhrase } from "./answer-variants.mjs";

// Normalization stays importable from its original site (tests + chat surface).
export { normalizeQuery, applyNegationFrames };
import { defaultNlp } from "./interpret/nlp-registry.mjs";

// Per-graph, per-kind memo; a local copy of codegraph.mjs's private
// edgesOfKind. Named differently from codegraph.mjs's own cache: the inlined
// viewer bundle concatenates a stripped codegraph.mjs + this file into one
// script, so two same-named consts there would be a SyntaxError.
const askEdgesOfKindCache = new WeakMap();

function edgesOfKind(graph, kind) {
  let byKind = askEdgesOfKindCache.get(graph);
  if (!byKind) { byKind = new Map(); askEdgesOfKindCache.set(graph, byKind); }
  const cached = byKind.get(kind);
  if (cached) return cached;
  const out = [];
  // Plain-loop append: argument spread overflows the call stack past ~100k edges.
  for (const g of graph.relations) {
    if (relationKind(g) !== kind) continue;
    for (const e of g.edges) out.push(e);
  }
  byKind.set(kind, out);
  return out;
}

// Predicate kinds carrying a finer, symbol-grain sibling: "which functions
// call X" should read off callsSymbol (fn->fn), not module-coarse "calls".
const SYMBOL_GRAIN_SIBLING = { calls: "callsSymbol", touches: "touchesSymbol" };
const FINE_ENTITY_TYPES = new Set(["Function", "Method", "Class", "Attribute", "GlobalVariable"]);
// Empty-result fallback only: an exact-class answer is never widened.
const FINE_CLASS_SIBLING = { Function: "Method", Method: "Function" };

// Query-side union families: a parsed kind that isn't itself a stored
// predicate but a curated union of stored kinds ("what uses X" means imports
// + calls together).
const KIND_UNIONS = { uses: ["imports", "calls", "callsSymbol"] };
const kindsFor = (kind) => KIND_UNIONS[kind] || [kind];
const SYMBOL_GRAIN_KINDS = new Set(Object.values(SYMBOL_GRAIN_SIBLING));

const OVERFLOW_CAP = 12;

const PLURAL_FORMS = {
  Function: ["function", "functions"], Method: ["method", "methods"],
  Class: ["class", "classes"], Module: ["module", "modules"],
  Attribute: ["attribute", "attributes"], GlobalVariable: ["variable", "variables"],
  Commit: ["commit", "commits"],
  Change: ["change", "changes"],
  Fact: ["fact", "facts"], Utterance: ["utterance", "utterances"],
  Session: ["session", "sessions"], Source: ["source", "sources"], Rule: ["rule", "rules"],
};
function nounFor(entityType, n) {
  const [s, p] = PLURAL_FORMS[entityType] || ["result", "results"];
  return n === 1 ? s : p;
}

/** A class enum rendered as prose words ("GlobalVariable" -> "global
 *  variable"), lowercase to match nounFor's own convention. For the render
 *  sites that must name the enum itself rather than a curated PLURAL_FORMS
 *  noun. The typeof guard is the same viewer-bundle boundary the tier-4 prose
 *  fallback documents: viz.mjs's askSource strips the prose.mjs import. */
export function classDisplayName(cls) {
  const s = String(cls || "");
  if (typeof splitIdentifierWords === "function") {
    const words = splitIdentifierWords(s).join(" ");
    if (words) return words;
  }
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

// Every relation kind is already the correct 3rd-person-singular verb form
// except "cochange" ("X cochanges Y") and "reexports" (human word "export").
const REVERSE_MISS_VERB = { cochange: "cochanges", reexports: "export" };
function verbFor(kind) {
  return REVERSE_MISS_VERB[kind] || kind;
}

// The base (plural-subject) verb form a universal-over-a-set answer reads with:
// "all modules IMPORT X" / "…do not IMPORT X", not the stored 3rd-person
// "imports". Keyed on the stored relation kind, curated alongside the vocabulary.
const PLURAL_SUBJECT_VERB = {
  imports: "import", calls: "call", callsSymbol: "call", inherits: "inherit from",
  contains: "contain", tests: "test", touches: "touch", cochange: "cochange",
  reexports: "export", uses: "use",
};
const pluralVerbFor = (kind) => PLURAL_SUBJECT_VERB[kind] || verbFor(kind);

// Strips a leading relation verb from the tests-kind honest-empty object
// ("do any tests touch f.mjs" -> object "touch f.mjs"), so the miss template
// doesn't render "No tests cover touch f.mjs." Longest phrase first.
const LEADING_RELATION_VERB_RE = new RegExp(
  `^(?:${Object.keys(VERB_TO_KIND)
    .sort((a, b) => b.length - a.length)
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})(?:s|ing|ed)?\\s+`,
  "i",
);

/** Compile a free-text question into {shape, kind, entityType, modifier,
 *  object[, subject]}, or null if no strategy fits. When strategies parse and
 *  disagree, returns {ambiguousParse: true, candidates: [...]}. `opts.nlp`
 *  overrides the lemma/POS adapter (pass null to force adapter-less browser
 *  behavior in a Node test). */
// Collapses a spurious ambiguity: when an object term is itself a
// RELATIONS/VERB_TO_KIND keyword, keyword-spot can misread "what does X mean"
// as a reverse query with object "mean", colliding with the grammar
// strategy's clean "meta" parse. That reading never resolves to anything
// real, so it's pruned back to the meta parse alone. "imports" is excluded —
// its ambiguous answer is the intended one (matches chat.mjs's relationTermOf).
const FROZEN_META_AMBIGUOUS_TERMS = new Set(["imports"]);
function pruneSpuriousMeaningAmbiguity(parsed) {
  if (!parsed?.ambiguousParse || !Array.isArray(parsed.candidates) || parsed.candidates.length !== 2) return parsed;
  const metaC = parsed.candidates.find((c) => c?.shape === "meta");
  const other = parsed.candidates.find((c) => c !== metaC);
  if (!metaC || !other) return parsed;
  const term = String(metaC.object || "").trim().toLowerCase();
  if (!term || FROZEN_META_AMBIGUOUS_TERMS.has(term)) return parsed;
  const otherObject = String(other.object || "").trim().toLowerCase();
  if (!wordsOf(META_MEANING_VERBS).includes(otherObject)) return parsed;
  return metaC;
}

export function parseQuery(query, { nlp = undefined } = {}) {
  return parseQueryFull(query, { nlp }).parsed;
}

/** Sibling of `parseQuery` that also surfaces `merge.mjs`'s `class`/`alternates`.
 *  Returns `{parsed, alternates, class}`; `alternates`/`class` are `[]`/`null`
 *  on the compositional-parse path or a total miss. */
export function parseQueryFull(query, { nlp = undefined } = {}) {
  const adapter = nlp === undefined ? defaultNlp() : nlp;
  const raw = String(query || "").trim().replace(/\s+/g, " ");
  if (!raw) return { parsed: null, alternates: [], class: null };
  const text = applyPhrasingFrames(applyNegationFrames(normalizeQuery(raw)));
  if (!text) return { parsed: null, alternates: [], class: null };
  // Fires only when a compositional marker is present; every plain clause
  // falls through to the strategy pipeline below.
  const composite = parseComposite(text, adapter);
  if (composite) return { parsed: composite, alternates: [], class: null };
  const merged = mergeStrategyResults(runStrategiesSync(text, { nlp: adapter, raw }));
  if (!merged) return { parsed: null, alternates: [], class: null };
  return {
    parsed: pruneSpuriousMeaningAmbiguity(merged.parsed),
    alternates: merged.alternates || [],
    class: merged.class || null,
  };
}

// ============================================================================
// compositional grammar — recursive-descent tokenize -> AST -> compile to
// graph traversal, composing the closed vocabulary (ask-vocab.mjs) for
// multi-hop / set-algebra shapes (nested/relative, boolean, qualifiers,
// aggregates, superlatives, anaphora). Every AST node carries a `node` tag;
// {node:"miss"} means a compositional marker was seen but couldn't compile —
// an honest stated miss, never a guess. Every leaf still resolves through the
// same curated clause parser + tiered resolveObject.
// ============================================================================

const MAX_COMPOSE_DEPTH = 4;
// Placeholder object term for a nested clause's outer parse; its `object` is
// discarded and replaced at eval time by the inner set.
const NEST_SENTINEL = "zzinnerset";
const PRED_LEAD_SKIP = new Set(["that", "which", "who", "are", "is", "was", "were", "do", "does", "also", "still", "both", "and", "then", "though"]);
const FRAME_WORDS = new Set(["which", "what", "who", "list", "show", "find", "give", "me", "us", "all"]);
// A bare copula leading a boolean branch ("...and ARE untested") is discourse
// glue, not part of the qualifier.
const COPULA_WORDS = new Set(["are", "is", "was", "were"]);
function dropLeadCopula(bw, blc) {
  return blc.length && COPULA_WORDS.has(blc[0]) ? { bw: bw.slice(1), blc: blc.slice(1) } : { bw, blc };
}

const entityNoun = (w) => (ENTITY_TO_TYPE[w] ? { entityType: ENTITY_TO_TYPE[w], placeholder: false }
  : (PLACEHOLDER_NOUNS.includes(w) ? { entityType: null, placeholder: true } : null));
const isGerundVerb = (w) => !!VERB_TO_KIND[w] && w.endsWith("ing");

/** Run the two legacy strategies on a fragment, anchored parse taking priority
 *  on disagreement (a composer-fed fragment is already shape-constrained). */
function parseSimpleClause(text, nlp) {
  return parseAnchored(text) || parseKeywordSpot(text, nlp);
}

/** Top compositional dispatcher — first marker-matching production wins. */
function parseComposite(text, nlp) {
  const w = splitWords(text);
  const lc = w.map((x) => x.toLowerCase());
  return parseExistence(w, lc)
    || parseQualifierCheck(w, lc)
    || parseUniversal(w, lc, nlp)
    || parseNegation(text, nlp, 0)
    || parseNegatedAsk(w, lc, nlp)
    || parseForwardNegation(w, lc, nlp)
    || parseTemporal(w, lc, nlp, 0)
    || parseCommitFilter(w, lc)
    || parseAnaphora(w, lc, nlp)
    || parseAggregate(w, lc, nlp)
    || parseSuperlative(w, lc, nlp)
    || parseFind(w, lc, nlp, 0)
    || parseList(w, lc, nlp, 0)
    || parseNested(w, lc, nlp, 0)
    || parsePluralAnaphoraObject(w, lc, nlp)
    || parseRelationalOrQualified(w, lc, nlp, 0);
}

// Negation as set complement: "which X do not <verb> Y" compiles to
// allOfClass(kind) DIFFERENCE (the positive result set). The "Change"
// pseudo-type has no bounded enumerable universe, so a complement over
// "changes" is refused honestly rather than answered over an empty universe.
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

// Universal over a set: "do all <kind> <verb> X" / "does every module import X"
// holds iff the bounded complement (the <kind> that do NOT <verb> X) is empty;
// a non-empty complement is a grounded "no" that names the counterexamples.
// Reuses the very allOfClass-minus-positive complement parseNegation builds for
// "which <kind> do not <verb> X", so the two shapes can never disagree on the
// set they compute. The object is grounded at eval — an unknown one still misses
// honestly rather than reading every member as a counterexample.
const UNIVERSAL_DET = new Set(["all", "every", "each"]);
function parseUniversal(w, lc, nlp) {
  if (!["do", "does", "did"].includes(lc[0])) return null;   // needs the polar auxiliary
  if (!UNIVERSAL_DET.has(lc[1])) return null;                // needs a universal determiner
  const noun = entityNoun(lc[2]);
  if (!noun || noun.placeholder || !noun.entityType) return null;  // needs a concrete kind noun
  const entityType = noun.entityType;
  if (entityType === "Change") {
    return { node: "miss", reason: `"${lc[2]}" isn't an enumerable kind — a universal check needs a concrete kind (functions, classes, modules, …)` };
  }
  const entWord = lc[2];
  const predWords = w.slice(3);
  const predLc = lc.slice(3);
  if (!predWords.length) return null;
  const vh = findPhrase(predLc, VERB_TO_KIND);
  if (!vh) return { node: "miss", reason: "a universal check needs a known relation verb (import, call, inherit from, test, …)" };
  const objWords = predWords.filter((_, i) => (i < vh.start || i >= vh.end) && !STOPWORDS.has(predLc[i]) && predLc[i] !== "from");
  const object = objWords.join(" ").trim();
  if (!object) return null;                                  // "do all modules import" — no object to ground against
  const positive = parseSetPhrase(`which ${entWord} ${predWords.join(" ")}`, nlp, 1);
  if (!positive || positive.node === "miss") {
    return { node: "miss", reason: (positive && positive.reason) || "the universal clause didn't parse" };
  }
  return {
    node: "universal", entityType, kind: vh.kind, object,
    complement: complementAst(entityType, { op: "difference", kind: "set", ast: positive }),
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

// FORWARD NEGATION — the subject-side complement's mirror: "what
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

/** The full set of OBJECT classes observed across every edge of the given stored
 *  kinds (already expanded past any query-side union — callers pass `kindsFor(kind)`
 *  or an equivalent list). Ext: endpoints have no individual, so they don't muddy
 *  the class vote. Shared by `kindObjectClass` (collapses to a single class or null)
 *  and the forward branch's grain check (needs the full set, not the collapse). */
function classesForKinds(graph, kinds) {
  const classes = new Set();
  for (const k of kinds) {
    for (const e of edgesOfKind(graph, k)) {
      const o = graph.byId.get(e.object);
      if (o && o.class) classes.add(o.class);
    }
  }
  return classes;
}

/** The single OBJECT class a forward relation kind points at across the loaded graph
 *  (imports → Module), or null when its objects span more than one class (an ambiguous
 *  grain the complement's universe can't be pinned to). Used by the forwardComplement
 *  evaluator to bound the universe it differences the positive forward set out of.
 *
 *  A union kind's symbol-grain member (callsSymbol) points at symbols by design —
 *  the fine view, served by its own reverse branch. The union's canonical object
 *  grain is defined by its coarse members, so the vote excludes the symbol-grain
 *  siblings; without this "uses" collapses to null and a Class-resolved object
 *  never up-refines to its containing module. */
function kindObjectClass(graph, kind) {
  const kinds = kindsFor(kind);
  const coarse = kinds.filter((k) => !SYMBOL_GRAIN_KINDS.has(k));
  const classes = classesForKinds(graph, coarse.length ? coarse : kinds);
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
 *  marker → let another production try).
 *
 *  The marker is either an explicit relative pronoun ("the module THAT imports X") or a
 *  REDUCED relative clause with the pronoun dropped ("the module IMPORTING X" — a gerund
 *  verb right where the pronoun+verb would go means the same thing): without recognizing
 *  the gerund form, "who touched the module importing X" falls through to the legacy
 *  strategy pipeline, which misreads the leading verb "touched" as the flat ASK shape's
 *  subject term instead of resolving to a real entity. */
function parseNested(w, lc, nlp, depth) {
  for (let r = 1; r < lc.length; r += 1) {
    const isPronoun = RELATIVE_PRONOUNS.includes(lc[r]);
    const isGerundMarker = !isPronoun && isGerundVerb(lc[r]);
    if (!isPronoun && !isGerundMarker) continue;
    if (isPronoun && r + 1 >= lc.length) continue;  // nothing after "that"
    const noun = entityNoun(lc[r - 1]);
    if (!noun) continue;                            // marker not preceded by a noun
    const head = w.slice(0, r - 1);                 // outer clause words, minus the placeholder noun
    if (!head.length) continue;                     // noun is the leading subject → subject-relative, not this shape
    const outer = parseSimpleClause([...head, NEST_SENTINEL].join(" "), nlp);
    if (!outer || (outer.shape !== "reverse" && outer.shape !== "forward")) continue;
    if (outer.modifier && outer.modifier !== "direct") continue; // no transitive-over-set closure primitive
    // build the inner sub-query: "which <placeholder-noun> <inner-text>" — recurses,
    // so the inner may itself be nested/boolean/qualified (depth ≥2). An explicit
    // relative pronoun is consumed (skip past it, start at r+1); a gerund marker IS
    // the predicate's own verb, so it stays in the inner text (start AT r).
    const innerText = `which ${lc[r - 1]} ${w.slice(isPronoun ? r + 1 : r).join(" ")}`;
    const inner = parseSetPhrase(innerText, nlp, depth + 1);
    if (!inner || inner.node === "miss") return inner ? { node: "miss", reason: inner.reason || "inner clause didn't parse" } : { node: "miss", reason: "inner clause didn't parse" };
    return { node: outer.shape === "reverse" ? "reverseSet" : "forwardSet", kind: outer.kind, entityType: outer.entityType, inner };
  }
  return null;
}

// Plural anaphora object: "those"/"them" standing alone as a reverse-clause
// object ("what tests cover those") or forward-clause subject ("what do
// those import") refer to the full id set of ask()'s `prev`. Reuses
// reverseSet/forwardSet's traversal with a {node:"prevSet"} inner leaf.
const PLURAL_ANAPHORA_OBJECT = new Set(["those", "them"]);
function parsePluralAnaphoraObject(w, lc, nlp) {
  for (let i = 0; i < lc.length; i += 1) {
    if (!PLURAL_ANAPHORA_OBJECT.has(lc[i])) continue;
    if (lc[i - 1] === "of") continue; // "…of those/them" — parseAnaphora's own shape
    const isTerminal = i === lc.length - 1;
    const leadsAVerb = i + 1 < lc.length && !!VERB_TO_KIND[lc[i + 1]];
    if (!isTerminal && !leadsAVerb) continue; // a determiner use ("those functions") — not a bare pronoun
    const head = [...w.slice(0, i), NEST_SENTINEL, ...w.slice(i + 1)];
    const outer = parseSimpleClause(head.join(" "), nlp);
    if (!outer || (outer.shape !== "reverse" && outer.shape !== "forward")) continue;
    if (outer.object !== NEST_SENTINEL) continue;
    if (outer.modifier && outer.modifier !== "direct") continue; // no transitive-over-set closure primitive
    return { node: outer.shape === "reverse" ? "reverseSet" : "forwardSet", kind: outer.kind, entityType: outer.entityType, inner: { node: "prevSet" } };
  }
  return null;
}

// Temporal-over-relative: "when did <relative set> [last] change" composes
// the flat when-shape's touches->commit->date-sort machinery over a nested
// inner set. Fires only for a relative subject; single-entity "when did X
// change" stays on the flat path.
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

// Commit filter: "what changed since/before/after/on <date-or-commit>" is a
// date-qualified survey of every recorded commit, distinct from the flat
// when-shape above (which dates one named entity's touch history). "in"/
// "during" are deliberately excluded — "what changed in <commit>" means that
// commit's own touch-set instead.
const COMMIT_FILTER_OPS = new Set(["since", "before", "after", "on"]);
function parseCommitFilter(w, lc) {
  if (lc[0] !== "what" || lc[1] !== "changed") return null;
  let i = 2;
  if (lc[i] === "ever") i += 1;
  if (!COMMIT_FILTER_OPS.has(lc[i])) return null;
  const op = lc[i];
  const pivotRaw = w.slice(i + 1).join(" ").trim();
  if (!pivotRaw) return { node: "miss", reason: `"what changed ${op}" needs a date or commit afterward` };
  return { node: "commitFilter", op, pivotRaw };
}

// Minimal code-identifier token shape: dotted paths, Capitalized symbols, or
// lowerCamelCase. Duplicated from chat.mjs's NAME_TOKEN_RE rather than
// imported, since chat.mjs only imports ask.mjs lazily.
const ANAPHORA_NAME_TOKEN_RE = /\b[\w-]+(?:[/.][\w-]+)+\b|\b[A-Z][A-Za-z0-9_]*\b|\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/;

/** Distinct code-identifier-shaped tokens in `words`, first-occurrence order.
 *  Feeds parseAnaphora's in-sentence candidate set: if the same sentence
 *  already names 2+ real candidates, they're the referent instead of `prev`. */
function inSentenceNameTokens(words) {
  const seen = new Set();
  const out = [];
  for (const raw of words) {
    if (!raw || !ANAPHORA_NAME_TOKEN_RE.test(raw)) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

/** ANAPHORA over the previous result set: "which of those/them <filter>", "how many
 *  of those <filter>". Requires "of <pronoun>" (so a bare "those" in a term never
 *  fires). Returns a {node:"anaphora"} (mode count|list), a miss (filter present but
 *  uncompilable), or null. */
function parseAnaphora(w, lc, nlp) {
  // Bare "which ones"/"which one": an anaphoric re-list phrased as a
  // question. Pinned to the whole two-word query so it never shadows
  // "which one of these two functions …".
  if (lc.length === 2 && lc[0] === "which" && (lc[1] === "ones" || lc[1] === "one")) {
    return { node: "anaphora", mode: "list", filter: { type: "all" } };
  }
  let p = -1;
  let viaOf = false;
  for (let i = 1; i < lc.length; i += 1) {
    if (!ANAPHORA_TRIGGERS.includes(lc[i])) continue;
    if (lc[i - 1] === "of") { p = i; viaOf = true; break; } // "how many of those", "which of them"
    // bare pronoun as the final word after a count/list trigger ("count them")
    const headSoFar = lc.slice(0, i).join(" ");
    if (i === lc.length - 1 && (AGGREGATE_TRIGGERS.includes(headSoFar) || LIST_TRIGGERS.includes(headSoFar))) { p = i; break; }
  }
  if (p < 0) return null;
  const head = (viaOf ? lc.slice(0, p - 1) : lc.slice(0, p)).join(" ");
  const mode = AGGREGATE_TRIGGERS.includes(head) || /^(how many|how much|count|number|quantity|total)\b/.test(head) ? "count" : "list";
  const filter = parsePredicateFilter(w.slice(p + 1), nlp);
  if (filter === undefined) return { node: "miss", reason: "the follow-up filter didn't parse" };
  // In-sentence candidate set: if this utterance already names 2+ real code
  // identifiers before the trigger, those are the referent instead of `prev`.
  const cutIdx = viaOf ? p - 1 : p;
  const candidateTerms = inSentenceNameTokens(w.slice(0, cutIdx));
  const ast = { node: "anaphora", mode, filter };
  if (candidateTerms.length >= 2) ast.candidateTerms = candidateTerms;
  return ast;
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

/** Existence: "is there a/an <kind> [called|named <term>] [in <module>] [anywhere]".
 *  Answered directly against class/kind membership rather than the relation-
 *  verb machinery — otherwise "is there a class called Store" would misparse
 *  "called" as a `calls` verb and answer a different question. A relative
 *  clause or verb phrase ("is there a class THAT CALLS Store") is left
 *  untouched for the relation parsers below. */
function parseExistence(w, lc) {
  let i;
  if (lc[0] === "is" && lc[1] === "there") i = 2;
  else if (lc[0] === "are" && lc[1] === "there") i = 2;
  else return null;
  const article = lc[i];
  if (article === "a" || article === "an" || article === "any") i += 1;
  else return null;
  const noun = i < lc.length ? entityNoun(lc[i]) : null;
  if (!noun || noun.placeholder || !noun.entityType) return null;
  const entityType = noun.entityType;
  i += 1;

  let rest = lc.slice(i);
  let restW = w.slice(i);
  // trailing filler — "anywhere" / "at all" — stripped so it never gets misread as
  // a (nonexistent) module/name term below.
  if (rest.length && rest[rest.length - 1] === "anywhere") {
    rest = rest.slice(0, -1); restW = restW.slice(0, -1);
  } else if (rest.length >= 2 && rest[rest.length - 2] === "at" && rest[rest.length - 1] === "all") {
    rest = rest.slice(0, -2); restW = restW.slice(0, -2);
  }

  if (!rest.length) return { node: "exists", entityType, term: null, scopeModule: null };

  if (rest[0] === "called" || rest[0] === "named") {
    if (rest.length < 2) return { node: "miss", reason: `"${rest[0]}" needs a name afterward` };
    const inIdx = rest.indexOf("in", 1);
    if (inIdx > 0) {
      const term = restW.slice(1, inIdx).join(" ").trim();
      const scopeModule = restW.slice(inIdx + 1).join(" ").trim();
      if (!term || !scopeModule) return { node: "miss", reason: `a named existence check needs both a name and a module after "in"` };
      return { node: "exists", entityType, term, scopeModule };
    }
    const term = restW.slice(1).join(" ").trim();
    return term ? { node: "exists", entityType, term, scopeModule: null }
      : { node: "miss", reason: `"${rest[0]}" needs a name afterward` };
  }

  if (rest[0] === "in") {
    const scopeModule = restW.slice(1).join(" ").trim();
    return scopeModule ? { node: "exists", entityType, term: null, scopeModule }
      : { node: "miss", reason: `"in" needs a module afterward` };
  }

  return null; // a relative clause / verb phrase / anything else — genuinely a
               // different (relationship) question; leave it for the parsers below.
}

/** The "in <scope>" tail of a qualifier check ("is Task.title public in Task").
 *  A tail naming the whole index restricts nothing, so TRAILING_SCOPE_FILLER —
 *  the table the meta-whatis reader already strips with — takes "in this
 *  codebase" off first and the check runs unscoped, exactly as it reads.
 *  Returns {scope}, a miss node, or null when there's no "in" tail at all. */
function parseQualifierScope(qualifier, tailWords) {
  if (!tailWords.length) return null;
  const withQualifier = `${qualifier} ${tailWords.join(" ")}`;
  const tail = stripTrailingScopeFiller(withQualifier).slice(qualifier.length).trim();
  const rest = splitWords(tail);
  const inIdx = rest.findIndex((x) => x.toLowerCase() === "in");
  if (inIdx < 0) return null;
  const scope = rest.slice(inIdx + 1).join(" ").trim();
  return scope ? { scope } : { node: "miss", reason: `"in" needs a scope afterward` };
}

/** Qualifier-check: "is <term> [a/an] <qualifier> [<kind>] [in <scope>]?" — a
 *  single-entity yes/no property check ("is Task.title public"), the missing
 *  single-entity sibling of the qualifier post-filter over a set. Guarded off
 *  "is/are there …" (parseExistence's shape). An "in <scope>" tail rides the
 *  parse and eval checks the term is really inside that scope, so
 *  "is Task.title public in SomeOtherClass" can't answer off the term alone. */
function parseQualifierCheck(w, lc) {
  if (lc[0] !== "is" && lc[0] !== "are") return null;
  if (lc[1] === "there") return null; // parseExistence's own shape
  let qualIdx = -1;
  let negated = false;
  for (let i = 1; i < lc.length; i += 1) {
    if (QUALIFIERS[lc[i]]) { qualIdx = i; negated = lc[i - 1] === "not"; break; }
  }
  if (qualIdx < 0) return null; // no qualifier word at all → not this shape
  // "is X tested by logger.mjs" asks about logger.mjs's own edges, not X's
  // coverage property, so it declines here and reads as a passive instead. Two
  // guards keep the decline narrow: the qualifier must have a relation
  // counterpart ("is X public by Y" is not a sentence), and the agent must name
  // something — "is X covered by tests" is still the plain coverage question.
  const byIdx = lc.indexOf("by", qualIdx + 1);
  if (byIdx > 0 && PASSIVE_PARTICIPLE_TO_KIND[lc[qualIdx]]) {
    let agentIdx = byIdx + 1;
    while (agentIdx < lc.length && (lc[agentIdx] === "the" || lc[agentIdx] === "a" || lc[agentIdx] === "an")) agentIdx += 1;
    const agent = lc[agentIdx];
    if (agent && !GENERIC_AGENT_WORDS.has(agent)) return null;
  }
  const tail = parseQualifierScope(lc[qualIdx], w.slice(qualIdx + 1));
  if (tail?.node === "miss") return tail;
  let termStart = 1;
  if (lc[termStart] === "the") termStart += 1;
  let termEnd = negated ? qualIdx - 1 : qualIdx;
  if (termEnd > termStart && (lc[termEnd - 1] === "a" || lc[termEnd - 1] === "an")) termEnd -= 1;
  const term = termEnd > termStart ? w.slice(termStart, termEnd).join(" ").trim() : "";
  if (!term) return { node: "miss", reason: `"is/are <qualifier>" needs a named thing to check first` };
  return { node: "qualCheck", term, qualifier: lc[qualIdx], negated, scope: tail?.scope || null };
}

/** Negated polar: "does X not <verb> Y" — its positive twin's yes/no question
 *  asked for the edge's ABSENCE. The sentence re-parses through the anchored
 *  grammar with "not" dropped, and the `negated` flag rides the parse the same
 *  way parseQualifierCheck's does: eval folds it into the answer and render
 *  states whichever polarity holds.
 *
 *  It lives here rather than in the grammar because the strategy pipeline reads
 *  the same sentence at positive polarity ("not" is no stopword) and the merge
 *  would call the two readings an ambiguity. Declining to a composite production
 *  is what keeps the sentence out of that merge. */
function parseNegatedAsk(w, lc, nlp) {
  // The copular leads carry the PASSIVE twin ("is X not imported by Y") —
  // without them the strategies read the sentence at positive polarity (the
  // "not" drops as noise) and the bare "Yes" answers the un-negated question.
  // parseQualifierCheck ran first, so "is X not deprecated" keeps its lane.
  // The positive re-parse runs the SAME simple-clause pair the composer's
  // fragments use — the passive lives in the keyword strategy, which the
  // anchored grammar alone never reaches.
  if (!["do", "does", "did", "is", "are", "was", "were"].includes(lc[0])) return null;
  const notIdx = lc.indexOf("not", 1);
  if (notIdx < 0) return null;
  const positive = parseSimpleClause(w.filter((_, i) => i !== notIdx).join(" "), nlp);
  if (!positive || positive.shape !== "ask") return null;
  return { ...positive, negated: true };
}

/** Trailing filler an aggregate/list tail can carry ("how many classes are
 *  there", "list functions in total") that must not be mistaken for a
 *  restrictor. Combined with STOPWORDS at the call site. */
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

const LIST_SKIP = new Set(["the", "a", "an", "all", "me", "us"]);
const LIST_TRIGGERS_SORTED = [...LIST_TRIGGERS].sort((a, b) => b.split(" ").length - a.split(" ").length);
const LISTABLE_KINDS = "functions, classes, methods, modules, attributes, variables, or commits";
// A leading "in"/"inside"/"under" right after the entity noun is an
// unambiguous location-scope tail, never a reverse-clause predicate object.
const SCOPE_PREPOSITIONS = new Set(["in", "inside", "under"]);

/** List: "list <kind>", "show me the <kind>s", "what are the <kind>". A
 *  sibling of the count node — enumerates individuals (capped at
 *  OVERFLOW_CAP) instead of counting them. Fires on a LIST_TRIGGERS verb or
 *  the bare interrogative "what/which <kind>", gated to a filler-only tail so
 *  "which functions call X" isn't hijacked into a list. One exception:
 *  "what/which <kind> [is|are] in|inside|under <scope>" routes the same way
 *  the imperative "list <kind> in <scope>" does. */
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
  // SCOPE-PREPOSITION exception: past an optional copula
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
  // edge noun after the extreme (imports/callers/methods/…) — computed BEFORE
  // the entity-noun check below, so a metric with a single implied entity class
  // (METRIC_IMPLIES_ENTITY) can supply a default when no explicit noun is given.
  let metric = null; let metricNoun = null;
  for (let i = extIdx; i < lc.length; i += 1) {
    if (EDGE_NOUN_TO_METRIC[lc[i]]) { metric = EDGE_NOUN_TO_METRIC[lc[i]]; metricNoun = lc[i]; break; }
  }
  // Fallback: a passive-verb-led phrasing puts the participle metric word BEFORE
  // the extreme, not after ("which function IS CALLED the most" — cf. "which
  // module is MOST imported", the already-supported order where the participle
  // trails "most" and the forward scan above already catches it). Scan backward
  // from just before the extreme, taking the CLOSEST metric word — the natural
  // reading when one exists at all. Only a fallback (never overrides a forward
  // hit), so it can't touch any phrasing that already resolves correctly today.
  if (!metric) {
    for (let i = extIdx - 1; i >= 0; i -= 1) {
      if (EDGE_NOUN_TO_METRIC[lc[i]]) { metric = EDGE_NOUN_TO_METRIC[lc[i]]; metricNoun = lc[i]; break; }
    }
  }
  const connectivity = lc.includes("connected") || lc.slice(extIdx, extIdx + 2).join(" ") === "most connected"
    || ["largest", "biggest", "smallest"].includes(lc[extIdx]);
  if (!metric && connectivity) { metric = EDGE_NOUN_TO_METRIC.connections; metricNoun = "connections"; }
  // entity noun anywhere (first match, deterministic); else default from a
  // metric that implies exactly one entity class ("test(s)" always ranks
  // Modules, the one declared exception — see METRIC_IMPLIES_ENTITY — so "what
  // most needs a test" resolves without also requiring the word "module").
  let entityType; let entWord = null;
  for (const x of lc) { const n = entityNoun(x); if (n && !n.placeholder) { entityType = n.entityType; entWord = x; break; } }
  if (!entWord) {
    entityType = metricNoun ? METRIC_IMPLIES_ENTITY[metricNoun] : undefined;
    if (!entityType) return { node: "miss", reason: "a superlative needs an entity kind (module, class, function, …)" };
  }
  if (!metric) return { node: "miss", reason: "name what to rank by (imports, callers, methods, tests, or connections)" };
  // A need/lack verb measures the ABSENCE of the metric, so it inverts the
  // ranking direction: "what most needs a test" asks for the FEWEST tests,
  // and answering the most-tested module is the exact inverse of the question.
  const NEED_LACK_WORDS = ["needs", "need", "needing", "lacks", "lack", "lacking", "misses", "missing"];
  const extreme = lc.some((x) => NEED_LACK_WORDS.includes(x))
    ? (ext === "most" ? "fewest" : "most")
    : ext;
  return { node: "superlative", entityType, metric, metricNoun, extreme };
}

// Predicate-find: "find me the payment class" (trailing-type) or "find the
// class named Foo" (leading-type-with-linker) — a type filter + fuzzy
// property-surface match, not a literal name lookup.
const FIND_LINKERS = new Set(["called", "named", "about", "like", "containing", "matching", "with"]);

/** A relative-clause marker anywhere defers to the existing relative-clause
 *  path ("find the file that imports store"); this only handles the
 *  term-bearing find-with-predicate shape. */
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
  // (either the plain relative-clause path, or the find-with-predicate
  // generalization inside parseRelationalOrQualified) — never claimed here.
  if (lc.some((t) => RELATIVE_PRONOUNS.includes(t))) return null;
  // A clear imperative single unknown trailing word (mirrors parseList's own rule).
  if (i === lc.length - 1 && /^[a-z]+$/.test(lc[i]) && !VERB_TO_KIND[lc[i]] && !PLACEHOLDER_NOUNS.includes(lc[i])) {
    return { node: "miss", reason: `"${lc[i]}" isn't a listable kind — try ${LISTABLE_KINDS}` };
  }
  return null;
}

/** Relational/boolean/qualifier (subject-first): "[which] [<qualifier>…]
 *  <entity> [that] <predicate>" where predicate is relation clauses joined by
 *  and/or/but-not, a membership "<of|in> <term>", or empty (bare qualified
 *  class). Fires only on a compositional marker, so a plain reverse query
 *  falls through to the existing strategies untouched. */
/** Detects the head of "find [me/us] [the/a] <term…> <entityType>
 *  that|which|who <predicate>". Returns {entityType, term, relIdx} or null —
 *  an empty term ("find classes that…") is deliberately not this shape. */
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

/** Build boolean/qualifier atoms for a predicate whose first (seed) atom the
 *  caller already determined externally. Every atom's op defaults to
 *  "intersection" except where an explicit and/or/but-not connective says
 *  otherwise. */
function buildPredicateAtoms(entityType, subjPrefix, predLc, predWords, nlp, depth) {
  const { branches, ops } = splitBoolean(predLc, predWords);
  let prevVerb = null;
  const atoms = [];
  for (let b = 0; b < branches.length; b += 1) {
    const bw = branches[b];
    const blc = bw.map((x) => x.toLowerCase());
    const op = b === 0 ? "intersection" : ops[b - 1];
    const qc = dropLeadCopula(bw, blc);
    if (qc.blc.length && qc.blc.every((x) => QUALIFIERS[x])) { atoms.push({ op, kind: "qual", filters: qc.blc }); continue; }
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

// The closed set of temporal-lead words a bare "<lead> commits"
// query can use — see the dedicated recentCommits AST node this feeds, below.
const RECENT_COMMIT_LEAD = new Set(["recent", "latest", "newest"]);

function parseRelationalOrQualified(w, lc, nlp, depth) {
  // predicate-find generalization: seeds the SAME boolean/qualifier fold
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
    // An unknown adjective before a known entity noun ("list payment
    // modules") tries as a predicate-find fuzzy term before declaring an
    // unrecognized qualifier.
    const nextNoun = i + 1 < lc.length ? entityNoun(lc[i + 1]) : null;
    // "recent/latest/newest commits" with nothing further is a sort
    // direction, not a search term for the word itself.
    if (RECENT_COMMIT_LEAD.has(lc[i]) && nextNoun && nextNoun.entityType === "Commit" && i + 2 === lc.length) {
      return { node: "recentCommits" };
    }
    // Same lead past an optional copula + determiner ("what IS THE newest commit").
    if (COPULA_WORDS.has(lc[i])) {
      let j = i + 1;
      if (j < lc.length && (lc[j] === "the" || lc[j] === "a" || lc[j] === "an")) j += 1;
      const leadNoun = j + 1 < lc.length ? entityNoun(lc[j + 1]) : null;
      if (RECENT_COMMIT_LEAD.has(lc[j]) && leadNoun && leadNoun.entityType === "Commit" && j + 2 === lc.length) {
        return { node: "recentCommits" };
      }
    }
    // CASCADE_NOISE_SET excluded alongside STOPWORDS: "what about classes"
    // would otherwise misread "about" as a fuzzy find term.
    if ((framed || quals.length) && nextNoun && /^[a-z]+$/.test(lc[i])
      && !VERB_TO_KIND[lc[i]] && !STOPWORDS.has(lc[i]) && !CASCADE_NOISE_SET.has(lc[i])) {
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
  // A boolean branch that collapses to qualifier words alone (past an
  // optional copula) is the compositional shape too ("functions that call X
  // and are untested").
  const boolQualLed = predWords.length > 0 && splitBoolean(predLc, predWords).branches.some((bw) => {
    const { blc } = dropLeadCopula(bw, bw.map((x) => x.toLowerCase()));
    return blc.length && blc.every((x) => QUALIFIERS[x]);
  });
  // A bare "call X and call Y" chain is also compositional when every branch
  // after the first either repeats the same verb kind or is a bare object
  // that inherits it — narrower than "any verb+verb and" so the legacy
  // ambiguous-parse case (different explicit verbs per branch) stays untouched.
  const sameVerbBranches = predWords.length > 0 ? splitBoolean(predLc, predWords).branches : [];
  let sameVerbLed = false;
  if (sameVerbBranches.length > 1) {
    const firstBlc = sameVerbBranches[0].map((x) => x.toLowerCase());
    const firstVh = findPhrase(firstBlc, VERB_TO_KIND);
    if (firstVh && firstVh.start === 0) {
      sameVerbLed = sameVerbBranches.slice(1).every((bw) => {
        const blc = bw.map((x) => x.toLowerCase());
        const vh = findPhrase(blc, VERB_TO_KIND);
        return vh && vh.start === 0 ? vh.kind === firstVh.kind : !vh;
      });
    }
  }
  // A later AND-branch with its own different but recognized verb ("which
  // functions call X and test Y") is also compositional — narrowed to a
  // single-word later verb so a multi-word verb phrase ("couples to") stays
  // on the legacy ambiguous-parse path.
  let differentVerbLed = false;
  if (sameVerbBranches.length > 1) {
    const firstBlc = sameVerbBranches[0].map((x) => x.toLowerCase());
    const firstVh = findPhrase(firstBlc, VERB_TO_KIND);
    if (firstVh && firstVh.start === 0) {
      differentVerbLed = sameVerbBranches.slice(1).every((bw) => {
        const blc = bw.map((x) => x.toLowerCase());
        const vh = findPhrase(blc, VERB_TO_KIND);
        return !!vh && vh.start === 0 && vh.end - vh.start === 1;
      });
    }
  }
  // Marker gate: without one of these, this isn't a compositional query.
  if (!(quals.length || relFlag || membershipLed || gerundLed || boolQualLed || sameVerbLed || differentVerbLed)) return null;

  // empty predicate → a bare qualified class ("public methods")
  if (!predWords.length) {
    let base = { node: "allOfClass", entityType };
    if (!quals.length) return { node: "miss", reason: "nothing to filter or traverse" };
    return { node: "qualifier", filters: quals, inner: base, entityType };
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
    const qc = dropLeadCopula(bw, blc);
    if (qc.blc.length && qc.blc.every((x) => QUALIFIERS[x])) { atoms.push({ op, kind: "qual", filters: qc.blc }); continue; }
    if (blc[0] === "of" || blc[0] === "in") {
      atoms.push({ op, kind: "set", ast: { node: "membership", entityType, term: bw.slice(1).join(" ") } });
      continue;
    }
    let phrase = bw;
    const vh = findPhrase(blc, VERB_TO_KIND);
    if (vh) prevVerb = bw.slice(vh.start, vh.end);
    else if (prevVerb) phrase = [...prevVerb, ...bw];
    // Parse as nested-or-simple, not back through parseSetPhrase (which would
    // re-detect this branch's own gerund/relative lead and recurse).
    const ast = parseBranchAst(`${subjPrefix} ${phrase.join(" ")}`, nlp, depth + 1);
    if (!ast || ast.node === "miss") return { node: "miss", reason: (ast && ast.reason) || "a clause in the combination didn't parse" };
    atoms.push({ op, kind: "set", ast });
  }
  if (atoms[0].kind !== "set") return { node: "miss", reason: "start with a clause, then combine with and/or/but-not" };

  let result;
  if (atoms.length === 1) {
    result = atoms[0].ast;
  } else {
    result = { node: "boolean", entityType, atoms };
  }
  if (quals.length) result = { node: "qualifier", filters: quals, inner: result, entityType };
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
  // GRAIN-AWARE OBJECT SET: when the inner set resolved to
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

/** Module individuals whose path lives strictly under the directory named by
 *  `term` — a proper path-segment prefix match, never a bare substring, so
 *  "src/lib" cannot spuriously catch "src/libfoo/x.mjs". */
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
  const testedModules = new Set();
  // The TEST modules themselves — the subjects of the same edges. A coverage
  // qualifier is a claim about SOURCE modules, so these are neither tested nor
  // untested and are excluded from both (see qualHolds). renderUntested and
  // untestedModules have always excluded them; this route did not.
  const testModules = new Set();
  for (const e of edgesOfKind(graph, "tests")) { testedModules.add(e.object); testModules.add(e.subject); }
  const moduleOfSymbol = new Map();
  for (const e of edgesOfKind(graph, "defines")) moduleOfSymbol.set(e.object, e.subject);
  c = { exported, testedModules, testModules, moduleOfSymbol };
  qualCache.set(graph, c);
  return c;
}
// Known divergence (not a bug, do not merge): this moduleIdOf is
// defines-edge-keyed, while codegraph.mjs's own (codegraph.mjs:1198) is
// site-attribute-keyed; the two can disagree for a symbol whose site
// attribute and defines edge point at different modules, so this file keeps
// its own copy rather than importing codegraph.mjs's.
function moduleIdOf(graph, ind) {
  if (!ind) return null;
  if (ind.class === "Module") return ind.id;
  return qualSets(graph).moduleOfSymbol.get(ind.id) || null;
}

/** Meta fallback to real entities: after a SchemaClass/SchemaPredicate miss,
 *  an exact case-insensitive unique label match against real code-entity
 *  classes, so "what is a Record" answers even though Record isn't a graph
 *  vocabulary term. Uniqueness is global across all these classes together —
 *  a name colliding across two classes stays an honest miss. Returns null on
 *  anything less than a unique exact hit.
 *
 *  Module is absent by design, not by omission: chat.mjs's module-overview
 *  lane already orients a module in far more detail (defines/imports/coverage
 *  counts) and gates itself on this lookup missing, so claiming modules here
 *  would replace that answer with a thinner one. */
const META_FALLBACK_CLASSES = new Set(["Class", "Function", "Method", "GlobalVariable", "Attribute"]);
export function metaFallbackEntityAnswer(graph, term) {
  const termLc = String(term || "").trim().toLowerCase();
  if (!termLc) return null;
  const hits = (graph?.individuals || []).filter((i) => META_FALLBACK_CLASSES.has(i.class) && String(i.label).toLowerCase() === termLc);
  if (hits.length !== 1) return null;
  const hit = hits[0];
  const mid = moduleIdOf(graph, hit);
  const modLabel = (mid && graph.byId.get(mid)?.label)
    || String((hit.attributes || []).find((a) => a.key === "site")?.value || "").split(":")[0]
    || null;
  const noun = nounFor(hit.class, 1);
  const article = noun === "attribute" ? "an" : "a";
  const definedIn = modLabel ? `, ${pickPhrase("defined-in", hit.id, "defined in")} ${modLabel}` : "";
  const followUp = hit.class === "Class" ? ` or "which classes inherit from ${hit.label}"` : "";
  return {
    text: `${hit.label} is ${article} ${noun} in this codebase${definedIn} — try "describe ${hit.label}"${followUp}.`,
    hit, modLabel,
  };
}

// ---- membership inheritance cascade: "<kind> of <owner>" walks up `inherits`
// when the owner's own surface has nothing, mirroring computeFind's
// narrow-then-broaden pass below. ----

/** Own-only membership hits for exactly one owner id (never an ancestor),
 *  filtered to `entityType` when given. */
function membershipOwnSet(graph, id, entityType) {
  const objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, new Set([id]))));
  return entityType ? objs.filter((o) => o.class === entityType) : objs;
}

/** Resolve a "<kind> of/in <term>" owner term to either a directory scope (a
 *  bare path prefix with no exact node) or a single container individual.
 *  Routed through resolveTermOrContext (not a bare resolveObject) so a
 *  context pronoun ("methods of that") binds to the standing focus instead of
 *  risking a false-positive substring hit. */
function resolveMembershipOwner(graph, term, contextId = null) {
  const r = resolveTermOrContext(graph, term, contextId);
  if (!(r.match && r.tier === 1)) {
    const dirMods = directoryScopeModules(graph, term);
    if (dirMods.length) return { kind: "dir", mods: dirMods };
  }
  if (!r.match) return { kind: "miss" };
  return { kind: "single", id: r.match.id, entityClass: r.match.class, label: r.match.label };
}

/** The narrow-then-walk inheritance cascade behind a "<kind> of <owner>"
 *  query: the owner's own (optionally `filterFn`-filtered) members win
 *  outright when non-empty; only when empty does it walk `ancestorsOf`
 *  nearest-first. `filterFn` is applied inside the walk, not after, so a
 *  qualified query ("public methods of TaskController") correctly walks up
 *  when the owner has members but none satisfy the qualifier. */
function computeMembership(graph, ownerId, ownerClass, entityType, filterFn) {
  const pass = filterFn || (() => true);
  const own = membershipOwnSet(graph, ownerId, entityType).filter(pass);
  if (own.length || !inheritsApplicable(graph, ownerClass)) {
    return { own, inherited: [], viaId: null, viaLabel: null };
  }
  for (const ancId of ancestorsOf(graph, ownerId)) {
    const anc = graph.byId.get(ancId);
    if (!anc) continue;
    const ancOwn = membershipOwnSet(graph, ancId, entityType).filter(pass);
    if (ancOwn.length) return { own, inherited: ancOwn, viaId: ancId, viaLabel: anc.label };
  }
  return { own, inherited: [], viaId: null, viaLabel: null };
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
      const sets = qualSets(graph);
      // A TEST module is neither tested nor untested. Coverage is a claim about
      // SOURCE modules, so asking whether a test covers itself is a category
      // error that made "show me the untested modules" list the test modules as
      // their own gaps. Excluded on BOTH polarities, by the same two tests the
      // tool applies: the edge subject (a module that tests something) and the
      // path shape (a test-named module that happens to test nothing).
      const mind = mid ? graph.byId?.get?.(mid) : null;
      if (mid && (sets.testModules.has(mid) || (mind && isTestPath(String(mind.label).toLowerCase())))) return false;
      // An entity whose defining module can't be resolved (a class with no
      // defines edge) is not a test module — it reads as "not tested", so it
      // stays in the untested set instead of dropping out of both polarities.
      return (!!mid && sets.testedModules.has(mid)) === spec.value;
    }
    default: return false;
  }
}

// ---- predicate-find: the narrow-then-broaden inheritance cascade over
// `inherits` edges, detected dynamically via inheritsApplicable rather than
// hardcoded to "Class". ----

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
/** Does `entityType` participate in an `inherits`-style subsumption relation
 *  today? When false, the broad (ancestor/sibling) pass is a no-op and
 *  predicate-find degrades to a flat own-label+attributes match. */
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

/** Does `ind`'s own property surface (label, or an attribute value) contain
 *  every token of the fuzzy term? Returns "label" | "attr" | null. */
function ownSurfaceHit(ind, termTokens) {
  const labelLc = String(ind.label || "").toLowerCase();
  if (termTokens.every((tok) => labelLc.includes(tok))) return "label";
  const attrs = (ind.attributes || []).map((a) => String(a.value ?? "").toLowerCase());
  if (termTokens.every((tok) => attrs.some((v) => v.includes(tok)))) return "attr";
  return null;
}
// Own-label hits rank above inheritance-chain hits above attribute-only hits;
// tie-break by shorter label.
const FIND_TIER = { label: 3, chain: 2, attr: 1 };
function sortFindHits(hits) {
  return hits.slice()
    .sort((a, b) => (FIND_TIER[b.via] - FIND_TIER[a.via]) || (String(a.ind.label).length - String(b.ind.label).length))
    .map((h) => h.ind);
}

/** A bounded-fuzzy (Damerau-Levenshtein) near-match of the whole term against
 *  `ind`'s label or any of its components. Used only by the broad pass —
 *  always rendered "related, not exact", since it's a near-miss by construction. */
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

/** The narrow-then-broaden search behind "find": narrow tests every
 *  `entityType` individual's own surface (plus descendants' surfaces, when
 *  the type participates in `inherits`) for every term token; a non-empty
 *  narrow pass is the whole answer. Only when narrow is empty does broad walk
 *  up to superclasses/siblings with a bounded-fuzzy near-match, always
 *  rendered "related, not exact". Returns {narrow, broad} — broad is only
 *  ever non-empty when narrow is empty. */
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
    // Predicate-find as a set atom: the narrow-then-broaden cascade's result,
    // transparently flattened ("related, not exact" is a render concern).
    case "find": {
      const { narrow, broad } = computeFind(graph, ast.entityType, ast.term);
      return narrow.length ? narrow : broad;
    }
    // Subjects with any edge of a kind; an existential negation differences
    // this off allOfClass to yield "modules that import nothing".
    case "existsEdge": {
      const subs = new Set(kindsFor(ast.kind).flatMap((k) => edgesOfKind(graph, k)).map((e) => e.subject));
      return graph.individuals.filter((i) => subs.has(i.id) && (!ast.entityType || i.class === ast.entityType));
    }
    // Forward complement: the verb's object-grain universe minus what the
    // subject reaches via that verb ("what doesn't it import").
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
    // The previous list-shaped answer's own id set. Only reached with a real,
    // non-empty `prev` — the no-`prev` case is intercepted earlier as an
    // honest "needs a previous answer" miss.
    case "prevSet": {
      const prev = opts && opts.prev;
      return Array.isArray(prev) ? prev.map((id) => graph.byId.get(id)).filter(Boolean) : [];
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
      const owner = resolveMembershipOwner(graph, ast.term, opts && opts.contextId);
      if (owner.kind === "dir") {
        if (!ast.entityType || ast.entityType === "Module") return owner.mods;
        const ids = new Set(owner.mods.map((m) => m.id));
        const objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, ids)));
        return objs.filter((o) => o.class === ast.entityType);
      }
      if (owner.kind === "miss") return [];
      // The owner's own members win outright when non-empty;
      // only an EMPTY own set walks up `inherits` (computeMembership) — see its
      // own doc above. evalSet's flat-array embedding (a find-seed inside a
      // boolean/qualifier fold) transparently flattens own vs. inherited,
      // same as evalSet's "find" case does for computeFind's narrow/broad split;
      // the DISCLOSED (never-silent) version lives in evalMembershipComposite,
      // below, for the top-level (and qualifier-wrapped) membership query shapes.
      const { own, inherited } = computeMembership(graph, owner.id, owner.entityClass, ast.entityType);
      return own.length ? own : inherited;
    }
    case "qualifier": {
      // a qualifier wrapping a MEMBERSHIP inner needs the filter applied INSIDE
      // the inheritance walk, at each level, not once after a flat resolve —
      // see computeMembership's own doc: a
      // class can own a non-empty member set that the qualifier alone empties
      // out, which must still walk up rather than stopping on the unfiltered own
      // set). evalMembershipComposite is the single source of truth for this;
      // reused here (matches-only) so evalSet's embedded-atom shape and the
      // top-level composite path can never drift on WHICH set they compute.
      if (ast.inner.node === "membership") return evalMembershipComposite(graph, ast, opts).matches;
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
/** The opposite of a qualifier, for a complement — or null where it has none.
 *
 *  A qualifier carrying a BOOLEAN value is three-valued in practice: tested,
 *  untested, or not a subject of the question at all. A test module is neither
 *  tested nor untested, so "modules that are not tested" is NOT the set
 *  complement of "tested modules" — complementing would hand back every
 *  individual the question does not apply to. Asking the OPPOSITE qualifier
 *  drops those from both sides, and makes this route agree with the
 *  QUALIFIERS-keyed one ("untested modules") that already reads it that way.
 *
 *  Qualifiers with no boolean polarity (visibility, exported, attr) have no
 *  opposite to ask and keep the plain complement, which is the right reading
 *  for them: "not exported" really is everything that is not exported. */
const oppositeQualifierSpec = (spec) => (spec && typeof spec.value === "boolean" ? { ...spec, value: !spec.value } : null);

function evalBoolean(graph, ast, opts) {
  let acc = [];
  for (const atom of ast.atoms) {
    if (atom.op === "seed") { acc = evalSet(graph, atom.ast, opts); continue; }
    if (atom.kind === "qual") {
      const holds = (ind) => atom.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f]));
      const complementHolds = (ind) => atom.filters.every((f) => {
        const opposite = oppositeQualifierSpec(QUALIFIERS[f]);
        return opposite ? qualHolds(graph, ind, opposite) : !qualHolds(graph, ind, QUALIFIERS[f]);
      });
      acc = atom.op === "difference" ? acc.filter(complementHolds) : acc.filter(holds);
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

/** Resolve parseAnaphora's in-sentence candidateTerms to real graph entities,
 *  de-duplicated by resolved id. Returns null (not []) when fewer than 2
 *  resolve, so the caller falls back to opts.prev either way. */
function resolveInSentenceCandidates(graph, terms) {
  if (!Array.isArray(terms) || terms.length < 2) return null;
  const seen = new Set();
  const resolved = [];
  for (const term of terms) {
    const r = resolveObject(graph, term);
    if (r && r.match && !seen.has(r.match.id)) { seen.add(r.match.id); resolved.push(r.match); }
  }
  return resolved.length >= 2 ? resolved : null;
}

/** Anaphora over the candidate set: the current utterance's in-sentence named
 *  entities, tried first, or ask()'s `prev` id array otherwise. No candidate
 *  set at all is an honest miss. */
function evalAnaphora(graph, ast, opts) {
  const inSentence = resolveInSentenceCandidates(graph, ast.candidateTerms);
  let baseItems = inSentence;
  if (!baseItems) {
    const prev = opts && opts.prev;
    if (!Array.isArray(prev) || !prev.length) return { compositeMiss: true, reason: "no-prev", matches: [] };
    baseItems = prev.map((id) => graph.byId.get(id)).filter(Boolean);
  }
  let items = baseItems;
  const f = ast.filter;
  if (f && f.type === "qual") {
    items = items.filter((ind) => f.filters.every((q) => qualHolds(graph, ind, QUALIFIERS[q])));
  } else if (f && f.type === "clause") {
    const r = resolveObject(graph, f.clause.object);
    if (!r.match) items = [];
    else {
      // Include the symbol-grain sibling so a fn->fn "call" filter tests
      // callsSymbol, not just module-coarse "calls".
      const sib = SYMBOL_GRAIN_SIBLING[f.clause.kind];
      const kinds = [...kindsFor(f.clause.kind), ...(sib ? [sib] : [])];
      const ok = new Set(kinds.flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.object === r.match.id).map((e) => e.subject));
      items = items.filter((ind) => ok.has(ind.id));
    }
  }
  // A count over a prior set names the entity kind when survivors share a
  // class; fall back to the prior set's own class when the filter empties it,
  // so the honest-empty render still names what was checked.
  const sameClass = (list) => (list.length && list.every((x) => x.class === list[0].class) ? list[0].class : null);
  const common = items.length ? sameClass(items) : sameClass(baseItems);
  if (ast.mode === "count") return { compositeKind: "count", count: items.length, entityType: common, matches: [] };
  return { compositeKind: "set", matches: items, entityType: common };
}

// Structural kinds counted for "most-connected" (total degree). Symbol-grain and
// commit-history kinds are excluded so "connections" reads as the code-structure
// degree a developer means, not every recorded touch.
const DEGREE_KINDS = ["imports", "calls", "callsSymbol", "inherits", "contains", "tests"];
/** Degree of an individual under a superlative metric ({kind, dir, sibling?,
 *  filter?}). Exported so chat.mjs's answerEdgeCount shares this computation
 *  for a single-entity query. */
export function degreeMetric(graph, ind, metric) {
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
/** Every Commit individual, newest date first (ISO-8601 sorts correctly
 *  lexically). */
function evalRecentCommits(graph) {
  const commits = graph.individuals.filter((i) => i.class === "Commit");
  const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
  commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return { compositeKind: "recentCommits", matches: commits };
}

const COMMIT_FILTER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Resolves the pivot (a literal ISO date, or a named commit whose own date
 *  becomes the pivot), then filters every Commit's date against it. An
 *  unresolvable pivot declines honestly (pivotResolved:false). */
function evalCommitFilter(graph, ast) {
  const { op, pivotRaw } = ast;
  const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "").slice(0, 10);
  let pivotDate = null;
  let pivotId = null;
  if (COMMIT_FILTER_DATE_RE.test(pivotRaw)) {
    pivotDate = pivotRaw;
  } else {
    const { match, ambiguous } = resolveObject(graph, pivotRaw, { expectedClass: "Commit" });
    if (match && !ambiguous && match.class === "Commit" && dateOf(match)) {
      pivotId = match.id;
      pivotDate = dateOf(match);
    }
  }
  if (!pivotDate) return { compositeKind: "commitFilter", op, pivotRaw, pivotResolved: false, matches: [] };
  const matches = graph.individuals
    .filter((i) => i.class === "Commit" && i.id !== pivotId && dateOf(i))
    .filter((c) => {
      const d = dateOf(c);
      if (op === "since") return d >= pivotDate;
      if (op === "before") return d < pivotDate;
      if (op === "after") return d > pivotDate;
      return d === pivotDate; // "on"
    })
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return { compositeKind: "commitFilter", op, pivotRaw, pivotDate, pivotResolved: true, matches };
}

/** Temporal over a nested set: the commits that touched any member of the
 *  inner set, newest date first. `entityType` is the inner noun, for phrasing only. */
function evalTemporal(graph, ast, opts) {
  const inner = evalSet(graph, ast.inner, opts);
  const ids = new Set(inner.map((i) => i.id));
  if (!ids.size) return { compositeKind: "temporal", matches: [], entityType: ast.entityType, innerCount: 0 };
  // reverseOverSet(touches) collects touching commits across both grains.
  const commits = reverseOverSet(graph, "touches", "Commit", ids);
  const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
  commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return { compositeKind: "temporal", matches: commits, entityType: ast.entityType, innerCount: inner.length };
}

function evalSuperlative(graph, ast) {
  let pool = graph.individuals.filter((i) => i.class === ast.entityType);
  // A tests-metric ranking over Modules surveys COVERAGE, and a test module
  // is never a coverage target — the same exclusion renderUntested (the
  // /untested surface) applies, so the two surveys can't disagree about the
  // same set ("what most needs a test" used to name b.test.mjs).
  if (ast.metric?.kind === "tests" && ast.entityType === "Module") {
    const testSubjects = new Set(edgesOfKind(graph, "tests").map((e) => e.subject));
    pool = pool.filter((i) => !testSubjects.has(i.id) && !isTestPath(String(i.label).toLowerCase()));
  }
  const scored = pool.map((ind) => ({ ind, score: degreeMetric(graph, ind, ast.metric) }))
    .sort((a, z) => (ast.extreme === "most" ? z.score - a.score : a.score - z.score));
  if (!scored.length) return { compositeKind: "superlative", entityType: ast.entityType, matches: [] };
  const best = scored[0].score;
  const winners = scored.filter((s) => s.score === best).map((s) => s.ind);
  return { compositeKind: "superlative", entityType: ast.entityType, metricNoun: ast.metricNoun, extreme: ast.extreme, score: best, matches: winners };
}

/** Top-level "<kind> of/in <owner>" membership eval, covering both a bare
 *  membership node and a qualifier node wrapping one. Keeps inheritance
 *  provenance (`inheritedNotOwn`/`viaLabel`/`ownerLabel`) so renderComposite
 *  can disclose an ancestor-sourced answer instead of presenting it as the
 *  owner's own. */
function evalMembershipComposite(graph, ast, opts) {
  const qualNode = ast.node === "qualifier" && ast.inner.node === "membership" ? ast : null;
  const memNode = qualNode ? qualNode.inner : ast;
  const entityType = memNode.entityType;
  const filterFn = qualNode
    ? (ind) => qualNode.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f]))
    : null;
  const owner = resolveMembershipOwner(graph, memNode.term, opts && opts.contextId);
  if (owner.kind === "dir") {
    let objs;
    if (!entityType || entityType === "Module") objs = owner.mods;
    else {
      const ids = new Set(owner.mods.map((m) => m.id));
      objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, ids))).filter((o) => o.class === entityType);
    }
    if (filterFn) objs = objs.filter(filterFn);
    return { compositeKind: "set", matches: objs, entityType };
  }
  if (owner.kind === "miss") return { compositeKind: "set", matches: [], entityType };
  const { own, inherited, viaLabel } = computeMembership(graph, owner.id, owner.entityClass, entityType, filterFn);
  const inheritedNotOwn = !own.length && inherited.length > 0;
  return {
    compositeKind: "membership", entityType, matches: inheritedNotOwn ? inherited : own,
    inheritedNotOwn, viaLabel, ownerLabel: owner.label,
  };
}

/** Existence eval — a direct membership/name check against the graph, never
 *  routed through the relation-verb machinery. `expectedClass` pins the
 *  resolve pool so "is there a class called Store" can't resolve to a
 *  same-named function/module. */
function evalExists(graph, ast) {
  const { entityType, term, scopeModule } = ast;
  let scopeMatch = null;
  if (scopeModule) {
    const r = resolveObject(graph, scopeModule, { expectedClass: "Module" });
    if (!r.match) return { compositeKind: "exists", entityType, term, scopeModule, scopeMiss: true, matches: [] };
    scopeMatch = r.match;
  }
  if (term) {
    const r = resolveObject(graph, term, { expectedClass: entityType });
    const inScope = !scopeMatch || (r.match && moduleIdOf(graph, r.match) === scopeMatch.id);
    const hit = r.match && inScope;
    return {
      compositeKind: "exists", entityType, term, scopeModule, scopeMatch,
      matches: hit ? [r.match] : [],
    };
  }
  const pool = scopeMatch
    ? refineToEntities(graph, new Set([scopeMatch.id]), entityType)
    : graph.individuals.filter((i) => i.class === entityType);
  return { compositeKind: "exists", entityType, term: null, scopeModule, scopeMatch, matches: pool };
}

/** Is `ind` inside a resolved qualifier-check scope? Read off the containment
 *  the graph already carries: a directory or module scope matches the term's
 *  own defining module, and a container scope (a class over its attributes and
 *  methods) matches a MEMBERSHIP_KINDS edge. Anything the graph doesn't state
 *  is not contained. */
function withinScope(graph, ind, owner) {
  const moduleId = moduleIdOf(graph, ind);
  if (owner.kind === "dir") return owner.mods.some((m) => m.id === ind.id || m.id === moduleId);
  return moduleId === owner.id || membershipOwnSet(graph, owner.id).some((o) => o.id === ind.id);
}

/** Qualifier-check eval: resolves the term (a context pronoun binds through
 *  contextId), then reads qualHolds(). `holds` means "the statement as asked
 *  is true" (negation already folded in). An "in <scope>" tail is resolved and
 *  checked first: the property is only reported for a term the scope really
 *  contains, so the tail can never ride along unread. */
function evalQualCheck(graph, ast, opts) {
  const { term, qualifier, negated, scope } = ast;
  const r = resolveTermOrContext(graph, term, opts.contextId);
  if (r.unresolvedPronoun) return { compositeKind: "qualCheck", qualCheckMiss: "pronoun", term, matches: [] };
  if (!r.match) return { compositeKind: "qualCheck", qualCheckMiss: "unresolved", term, matches: [] };
  if (scope) {
    const owner = resolveMembershipOwner(graph, scope, opts.contextId);
    if (owner.kind === "miss") return { compositeKind: "qualCheck", qualCheckMiss: "scope", term, scope, matches: [] };
    if (!withinScope(graph, r.match, owner)) {
      return {
        compositeKind: "qualCheck", qualCheckMiss: "outsideScope",
        term, scope, subjectLabel: r.match.label,
        scopeLabel: owner.kind === "dir" ? scope : owner.label, matches: [],
      };
    }
  }
  const rawHolds = qualHolds(graph, r.match, QUALIFIERS[qualifier]);
  const holds = negated ? !rawHolds : rawHolds;
  return { compositeKind: "qualCheck", subject: r.match, qualifier, negated, holds, matches: [r.match] };
}

/** Universal-over-a-set: the object is grounded first (an unknown one is an
 *  honest miss, never a blanket "no"), then the answer is read off the bounded
 *  complement — empty means every member satisfies it, non-empty is the "no"
 *  whose members are the counterexamples. */
function evalUniversal(graph, ast, opts) {
  const r = resolveObject(graph, ast.object);
  if (!r || !r.match) {
    return { compositeKind: "universal", universalMiss: "unresolved", object: ast.object, matches: [] };
  }
  const all = evalSet(graph, { node: "allOfClass", entityType: ast.entityType }, opts);
  const counter = evalBoolean(graph, ast.complement, opts);
  const holds = counter.length === 0;
  return {
    compositeKind: "universal", entityType: ast.entityType, kind: ast.kind,
    object: r.match.label, holds, total: all.length, counter,
    matches: holds ? all : counter,
  };
}

/** Compile any compositional AST to a result object traverse() returns for the
 *  simple path — {matches, …} plus compositeKind/compositeMiss flags render() reads. */
function evalComposite(graph, ast, opts = {}) {
  if (ast.node === "miss") return { compositeMiss: true, reason: ast.reason || null, matches: [] };
  if (ast.node === "exists") return evalExists(graph, ast);
  if (ast.node === "qualCheck") return evalQualCheck(graph, ast, opts);
  if (ast.node === "universal") return evalUniversal(graph, ast, opts);
  if (ast.node === "count") return { compositeKind: "count", count: evalSet(graph, ast.base, opts).length, entityType: ast.entityType, matches: [] };
  if (ast.node === "list") return { compositeKind: "list", matches: evalSet(graph, ast.base, opts), entityType: ast.entityType, scoped: ast.scoped };
  if (ast.node === "superlative") return evalSuperlative(graph, ast);
  if (ast.node === "temporal") return evalTemporal(graph, ast, opts);
  if (ast.node === "recentCommits") return evalRecentCommits(graph);
  if (ast.node === "commitFilter") return evalCommitFilter(graph, ast);
  if (ast.node === "anaphora") return evalAnaphora(graph, ast, opts);
  // Membership inheritance cascade, top-level (keeps disclosure provenance
  // the embedded evalSet path drops).
  if (ast.node === "membership" || (ast.node === "qualifier" && ast.inner.node === "membership")) {
    return evalMembershipComposite(graph, ast, opts);
  }
  // Predicate-find, top-level: keeps broad-pass provenance so renderComposite
  // can label a "related, not exact" hit distinctly.
  if (ast.node === "find") {
    const { narrow, broad } = computeFind(graph, ast.entityType, ast.term);
    return {
      compositeKind: "find", entityType: ast.entityType, term: ast.term,
      matches: narrow.length ? narrow : broad, broad: !narrow.length && broad.length > 0,
    };
  }
  // Plural-anaphora object: an empty `prev` means "those"/"them" has no
  // antecedent, an honest miss rather than evalSet's misleading empty-set message.
  if ((ast.node === "reverseSet" || ast.node === "forwardSet") && ast.inner.node === "prevSet"
    && !(Array.isArray(opts.prev) && opts.prev.length)) {
    return { compositeMiss: true, reason: "no-prev", matches: [] };
  }
  return { compositeKind: "set", matches: evalSet(graph, ast, opts), entityType: ast.entityType || null };
}

// ---- compositional render: templated, same "honest miss vs cited hit"
// discipline as renderCore. ----

const compositeList = (matches) => listJoin(matches.slice(0, OVERFLOW_CAP)
  .map((m) => (["Function", "Method"].includes(m.class) ? `${m.label}()` : m.label)))
  + (matches.length > OVERFLOW_CAP ? `, …and ${matches.length - OVERFLOW_CAP} more` : "");

/** A compositional worked example for the rephrase hint. */
function compositionalHint() {
  return 'compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", "find me the payment class", or (after a listing) "which of those are tested"';
}

/** A short citation line for a single predicate-find hit — the module it
 *  lives in, when known. */
function describeFindHit(ind) {
  const label = ["Function", "Method"].includes(ind.class) ? `${ind.label}()` : ind.label;
  if (ind.class === "Module") return label;
  const mod = moduleLabelOf(ind);
  return mod && mod !== "(unknown module)" ? `${label} in ${mod}` : label;
}

function renderComposite(parsed, result, graph) {
  if (result.compositeMiss) {
    if (result.reason === "no-prev") {
      return { content: `"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.`, miss: true, ambiguous: false };
    }
    return { content: `couldn't compile this compositional question${result.reason ? ` (${result.reason})` : ""}. ${compositionalHint()}.`, miss: true, ambiguous: false };
  }
  if (result.compositeKind === "exists") {
    if (result.scopeMiss) {
      return { content: `no module matching "${result.scopeModule}" found in the index.`, miss: true, ambiguous: false };
    }
    const kindSingular = nounFor(result.entityType, 1);
    const kindPlural = nounFor(result.entityType, 2);
    const scopeSuffix = result.scopeMatch ? ` in ${result.scopeMatch.label}` : "";
    if (result.term) {
      if (!result.matches.length) {
        return { content: `No — no ${kindSingular} named "${result.term}" found${scopeSuffix}.`, miss: true, ambiguous: false };
      }
      const hit = result.matches[0];
      const modLabel = moduleLabelOf(hit);
      const definedIn = hit.class === "Module" ? "" : (modLabel && modLabel !== "(unknown module)" ? `, ${pickPhrase("defined-in", hit.id, "defined in")} ${modLabel}` : "");
      return { content: `Yes — ${hit.label} is a ${kindSingular}${definedIn}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (!result.matches.length) {
      return { content: `No — no ${kindPlural} found${scopeSuffix}.`, miss: true, ambiguous: false };
    }
    return { content: `Yes — ${compositeList(result.matches)}${scopeSuffix}.`, miss: false, ambiguous: false, matches: result.matches };
  }
  if (result.compositeKind === "qualCheck") {
    if (result.qualCheckMiss === "pronoun") {
      return { content: `"${result.term}" needs a selected node to refer to — click a node first, or name it directly.`, miss: true, ambiguous: false };
    }
    if (result.qualCheckMiss === "unresolved") {
      return { content: `couldn't find "${result.term}" in the index to check.`, miss: true, ambiguous: false };
    }
    if (result.qualCheckMiss === "scope") {
      return { content: `couldn't find "${result.scope}" in the index to check inside.`, miss: true, ambiguous: false };
    }
    if (result.qualCheckMiss === "outsideScope") {
      return { content: `No — ${result.subjectLabel} isn't in ${result.scopeLabel}.`, miss: true, ambiguous: false };
    }
    const label = result.subject.label;
    const truePhrase = result.negated ? `not ${result.qualifier}` : result.qualifier;
    const falsePhrase = result.negated ? result.qualifier : `not ${result.qualifier}`;
    return {
      content: `${result.holds ? "Yes" : "No"} — ${label} is ${result.holds ? truePhrase : falsePhrase}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  if (result.compositeKind === "universal") {
    if (result.universalMiss === "unresolved") {
      return { content: `couldn't find "${result.object}" in the index to check.`, miss: true, ambiguous: false, matches: [] };
    }
    const kindPlural = nounFor(result.entityType, result.total);
    const verb = pluralVerbFor(result.kind);
    if (result.holds) {
      return { content: `Yes — all ${result.total} ${kindPlural} ${verb} ${result.object}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    const n = result.counter.length;
    return {
      content: `No — ${n} of ${result.total} ${kindPlural} do not ${verb} ${result.object}: ${compositeList(result.counter)}.`,
      miss: false, ambiguous: false, matches: result.counter,
    };
  }
  if (result.compositeKind === "count") {
    const noun = result.entityType ? nounFor(result.entityType, result.count) : (result.count === 1 ? "result" : "results");
    return { content: `${result.count} ${noun}.`, miss: false, ambiguous: false, matches: [] };
  }
  if (result.compositeKind === "list") {
    if (!result.matches.length) {
      return { content: `no ${nounFor(result.entityType, 2)} in this index.`, miss: true, ambiguous: false, matches: [] };
    }
    // Kinds that don't live in a module (or have no module-scope parse at
    // all, like memory-graph classes) get no narrow-by-module hint.
    const scopeable = !["Module", "Commit", "Fact", "Utterance", "Session", "Source", "Rule"].includes(result.entityType);
    const hint = (!result.scoped && scopeable && result.matches.length > OVERFLOW_CAP)
      ? ` — narrow with "${nounFor(result.entityType, 2)} in <module>"`
      : "";
    return { content: `${compositeList(result.matches)}${hint}.`, miss: false, ambiguous: false, matches: result.matches };
  }
  // A non-empty inherited result is disclosed out loud ("X has no own <kind>
  // — inherited from <ancestor>: …"), never silently presented as the owner's own.
  if (result.compositeKind === "membership") {
    if (!result.matches.length) {
      return { content: `nothing in the index matches that${result.entityType ? ` (${nounFor(result.entityType, 2)})` : ""}. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false, matches: [] };
    }
    if (result.inheritedNotOwn) {
      const kindPlural = nounFor(result.entityType, 2);
      const ownerPhrase = result.ownerLabel ? `${result.ownerLabel} has no own ${kindPlural}` : `no own ${kindPlural}`;
      return {
        content: `${ownerPhrase} — inherited from ${result.viaLabel}: ${compositeList(result.matches)}.`,
        miss: false, ambiguous: false, matches: result.matches, inheritedNotOwn: true,
      };
    }
    return { content: `${compositeList(result.matches)}.`, miss: false, ambiguous: false, matches: result.matches };
  }
  // predicate-find: zero hits -> an honest miss naming BOTH the type
  // and the term; the broad ("related, not exact") pass is ALWAYS clearly labeled,
  // never presented as an unqualified match; one hit -> a short citation; many hits
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
  // Bare "recent/latest/newest commits" — a real dated commit
  // list, newest first, capped at HISTORY_CAP for consistency with renderFileHistory/
  // renderSymbolHistory's own listing convention (codegraph.mjs) — never the false
  // "no Commit found matching 'recent'" find-miss this would otherwise fall into.
  if (result.compositeKind === "recentCommits") {
    if (!result.matches.length) return { content: `no commits recorded in this index.`, miss: true, ambiguous: false, matches: [] };
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    const shown = result.matches.slice(0, HISTORY_CAP).map((c) => {
      const day = dateOf(c).slice(0, 10);
      const msg = (c.attributes || []).find((a) => a.key === "message")?.value || "";
      return `${c.label}${day ? ` (${day})` : ""}${msg ? ` — ${msg}` : ""}`;
    });
    const tail = result.matches.length > HISTORY_CAP ? ` …+${result.matches.length - HISTORY_CAP} more` : "";
    return {
      content: `${result.matches.length} recent commit(s): ${shown.join(", ")}${tail}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  // "what changed since/before/after/on
  // <date-or-commit>" — same dated-list rendering convention as recentCommits just
  // above, scoped to the resolved pivot. An unresolvable pivot names itself and the
  // two supported pivot shapes (never a silent guess); a resolved pivot with no
  // qualifying commits is an honest empty (never the generic orientation blurb).
  if (result.compositeKind === "commitFilter") {
    if (!result.pivotResolved) {
      return {
        content: `"${result.pivotRaw}" isn't a recognized date (yyyy-mm-dd) or a known commit — try "what changed since 2026-06-01" or "what changed before <commit>".`,
        miss: true, ambiguous: false, matches: [],
      };
    }
    if (!result.matches.length) {
      return { content: `no commits recorded ${result.op} ${result.pivotRaw}.`, miss: true, ambiguous: false, matches: [] };
    }
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    const shown = result.matches.slice(0, HISTORY_CAP).map((c) => {
      const day = dateOf(c).slice(0, 10);
      const msg = (c.attributes || []).find((a) => a.key === "message")?.value || "";
      return `${c.label}${day ? ` (${day})` : ""}${msg ? ` — ${msg}` : ""}`;
    });
    const tail = result.matches.length > HISTORY_CAP ? ` …+${result.matches.length - HISTORY_CAP} more` : "";
    return {
      content: `${result.matches.length} commit(s) changed ${result.op} ${result.pivotRaw}: ${shown.join(", ")}${tail}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
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
      return { content: `nothing in the index matches the inner set, so there is no change history to date. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false, matches: [] };
    }
    if (!result.matches.length) {
      return { content: `no recorded commit touched the ${n} ${setNoun} in that set in this index. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false, matches: [] };
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
    return { content: `nothing in the index matches that${result.entityType ? ` (${nounFor(result.entityType, 2)})` : ""}. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false, matches: [] };
  }
  return { content: `${compositeList(result.matches)}.`, miss: false, ambiguous: false, matches: result.matches };
}

/** The rephrase hint shown on a grammar miss — generated from the same
 *  tables the parser uses, so it can never suggest an unsupported phrasing. */
export function rephraseHint() {
  // `touches` is a Commit->Module/symbol edge, so a Function/Class/Module is
  // never the subject of a touch; the real reverse subject is Commit
  // ("which commits touched <name>" below).
  return '"which <functions|classes|modules> <imports|calls|uses|inherits from|tests> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which commits touched <name>" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit\'s own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph\'s own vocabulary). '
    + compositionalHint();
}

/** A short, honest nudge for the touches/history-family of correct-but-
 *  unhelpful misses, pointing at "who touched X" / "/describe X" shapes that
 *  produce a real answer elsewhere. Reused verbatim by every miss template
 *  in this family.
 *
 *  A graph with no modules holds no index to rephrase against, so the shapes
 *  above would send the reader off to look up entities that cannot be there.
 *  It gets a line that says what the store actually holds instead. A NULL
 *  graph is UNKNOWN, not empty (see chat.mjs's noCodeGraph), so it keeps the
 *  index-shaped advice. */
function touchesRephraseHint(graph = null) {
  if (graph && moduleCountOf(graph) === 0) {
    return "This store holds no code index, so it records no modules or commits to look through.";
  }
  return 'Try "who touched <a module that actually has commits>" or "/describe <module>" to see what\'s in the index.';
}

// ---- object-term resolution — mechanical, no embeddings, tiered, stop at first hit ----

function componentSet(s) {
  return new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/** A minimal, closed derivational-suffix normalizer for tier 3's
 *  Module-basename bridge (not a general stemmer): strips one gerund/agent-noun
 *  suffix ("ing"/"er"/"ers"/"or"/"ors") and collapses a doubled trailing
 *  consonant ("logging"/"logger" -> "log"). Length-floored at 5 to avoid
 *  short-word false matches; returns the word unchanged when no suffix matches. */
function derivationalStem(w) {
  if (w.length < 5) return w;
  const stripped = w.replace(/(ing|ers|ors|er|or)$/, "");
  if (stripped === w) return w;
  return stripped.length >= 3 && stripped[stripped.length - 1] === stripped[stripped.length - 2]
    ? stripped.slice(0, -1)
    : stripped;
}

/** Strip explicit separator characters only (path slashes, hyphens,
 *  underscores, trailing extension) — never camelCase boundaries — so a
 *  label collapses to the same joined lowercase token a naming-convention-
 *  blind user would type ("PaymentSystem"/"payment-system" -> "paymentsystem"). */
function joinedForm(label) {
  return String(label || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[/\-_.]+/g, "");
}

/** Same joined-token normalization as joinedForm(), applied to the query side
 *  of a multi-word term: a leading article is stripped first so "the payment
 *  system" and "payment system" produce the identical joined form. */
function joinedQueryForm(term) {
  return String(term || "")
    .trim()
    .replace(/^(?:the|a|an)\s+/i, "")
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
}

/** Resolve a free-text object/subject term against the graph's individuals, in
 *  priority order: a sha-shaped term first resolves against Commit
 *  individuals by unique id/label prefix, then (1) exact label/id match, (2)
 *  an `ext:` unresolved-target match (a synthetic match with no real
 *  individual), (3) boundary-aware substring/component match, (4) a
 *  prose-index fallback (exact word-level overlap against decomposed-
 *  identifier or doc-comment tokens, tagged `matchedVia: "prose"`), (5) a
 *  bounded Damerau-Levenshtein pass against labels and components, tagged
 *  `matchedVia: "fuzzy"` — never applied to sha-shaped or sub-4-char terms.
 *  (6) no match: an honest miss. Returns {match, candidates, tier, ambiguous
 *  [, matchedVia]}; ambiguous on a same-tier score/distance tie.
 *
 *  `opts.expectedClass`, when set, narrows the candidate pool before every
 *  pool-driven tier — opt-in grain-aware resolution so "which modules import
 *  logger" never resolves "logger" to a same-stem Class. */
function resolveObjectCore(graph, term, { expectedClass = null } = {}) {
  const t = String(term || "").trim();
  if (!t) return { match: null, candidates: [], tier: null, ambiguous: false };
  const tLc = t.toLowerCase();
  const pool = expectedClass ? graph.individuals.filter((i) => i.class === expectedClass) : graph.individuals;

  // Commit-sha tier: a hex-looking term resolves against Commit individuals
  // by id/label prefix. A unique prefix is exact-grade (tier 1); a shared
  // prefix is an honest ambiguity; no match falls through (it may be a real
  // code identifier) unless the explicit "commit" noun declared intent.
  const shaTerm = tLc.match(/^(commit[:\s])?([0-9a-f]{7,40})$/);
  if (shaTerm) {
    const sha = shaTerm[2];
    const hits = pool.filter((i) => i.class === "Commit"
      && (String(i.id).toLowerCase().startsWith(`commit:${sha}`) || String(i.label).toLowerCase().startsWith(sha)));
    if (hits.length === 1) return { match: hits[0], candidates: [], tier: 1, ambiguous: false };
    if (hits.length > 1) return { match: hits[0], candidates: hits.slice(1, 5), tier: 1, ambiguous: true };
    if (shaTerm[1]) return { match: null, candidates: [], tier: null, ambiguous: false };
  }

  const exact = pool.find((i) => String(i.label).toLowerCase() === tLc || String(i.id).toLowerCase() === tLc);
  if (exact) return { match: exact, candidates: [], tier: 1, ambiguous: false };

  // ext: targets have no individual of their own; find the case-preserved id
  // off a real edge so a typo'd term can't silently "resolve" to one.
  const extLc = `ext:${tLc}`;
  let extId = null;
  outer: for (const g of graph.relations) {
    for (const e of g.edges) {
      if (String(e.object).toLowerCase() === extLc) { extId = e.object; break outer; }
    }
  }
  if (extId && !expectedClass) return { match: { id: extId, label: t, class: null }, candidates: [], tier: 2, ambiguous: false };

  // "store.mjs and logger.mjs" names two operands, and every tier below reads a
  // term as ONE. Tier 3's slashStem deliberately resolves past trailing junk, so
  // the second operand is dropped and the first is answered about with full
  // confidence: "is model.mjs called by store.mjs and logger.mjs" returns a flat
  // Yes that is only ever about store.mjs. Nothing here reads coordination, so a
  // miss is the answer.
  //
  // Gated on both sides resolving to DIFFERENT individuals on their own, which is
  // what makes this a coordination rather than a name: a label that merely
  // contains the word was already claimed by the exact tier above, and a side that
  // resolves to nothing was never an operand. Neither part carries an " and " of
  // its own, so the recursion is one level deep.
  const andParts = t.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (andParts.length > 1) {
    const operandIds = new Set();
    for (const part of andParts) {
      const r = resolveObjectCore(graph, part, { expectedClass });
      if (r.match && !r.ambiguous) operandIds.add(r.match.id);
    }
    if (operandIds.size > 1) return { match: null, candidates: [], tier: null, ambiguous: false };
  }

  // Tier 3, two regimes: a dotted term with no slash ("res.json") is
  // symbol-shaped, so it matches only symbol labels or a module by exact
  // basename equality (never a phantom substring-of-path match); undotted/
  // slashed terms keep the original containment pass.
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
    // Raw containment has no minimum-length floor, so a short word is a
    // near-certain accidental substring of some real label ("so"->sendJson).
    // Gating it at the same floor tier 5's fuzzy pass uses (>= 4 chars, below)
    // closes it; a whole-token component match is unaffected since it
    // requires exact segment equality, not a substring.
    const termComps = [...componentSet(t)];
    // A slashed term's final path segment, extension stripped — the
    // filename stem, isolated from surrounding noise ("app/lib/f.mjs but
    // untested" must not strand "f.mjs but untested" as a bogus stem).
    const pathToken = tLc.split(/\s+/).find((tok) => tok.includes("/"));
    const slashStem = pathToken ? pathToken.split("/").pop().replace(/\.[a-z0-9]+$/, "") : null;
    // Compound-term bridge: a query with 2+ space-separated words ("payment
    // system") is compared against each candidate's own joinedForm(), since
    // the literal tLc comparisons above/below never match a spaceless label
    // ("PaymentSystem"). Single-word queries are unaffected.
    const qWords = t.trim().replace(/^(?:the|a|an)\s+/i, "").trim().split(/\s+/).filter(Boolean);
    const isMultiWord = qWords.length >= 2;
    const qJoined = isMultiWord ? joinedQueryForm(t) : null;
    for (const m of pool) {
      const label = String(m.label || "").toLowerCase();
      // Basename-exact/prefix/suffix tier: a bare term that IS a file's
      // basename outranks a sibling that merely shares a directory/component.
      // Prefix/suffix shares tier 5's sub-4-char floor; exact equality is
      // never an accidental substring, so it stays unguarded (short real
      // identifiers like "db"/"fs" must still resolve).
      const stem = label.split("/").pop().replace(/\.[a-z0-9]+$/, "");
      if (stem === tLc) { scored.push({ ind: m, score: 5000 }); continue; }
      if (tLc.length >= 4 && (stem.startsWith(tLc) || stem.endsWith(tLc))) {
        scored.push({ ind: m, score: 4000 - Math.abs(stem.length - tLc.length) });
        continue;
      }
      // Compound-term bridge, multi-word analog of the tier above: an exact
      // joined-form match scores the same as exact-stem; a containment match
      // scores below every single-word tier but above raw overlap, and is
      // gated on an explicit separator so a pure-camelCase label is left to
      // tier 4's prose fallback instead (frozen test: "total price" ->
      // calculateTotalPrice must resolve via matchedVia:"prose", not tier 3).
      if (isMultiWord) {
        const candJoined = joinedForm(m.label);
        if (candJoined && candJoined === qJoined) { scored.push({ ind: m, score: 5000 }); continue; }
        const hasExplicitSeparator = /[/_-]/.test(m.label) || /\.[a-z0-9]+$/i.test(String(m.label || ""));
        if (candJoined && hasExplicitSeparator && qJoined.length >= 4 && candJoined.includes(qJoined)) {
          scored.push({ ind: m, score: 2000 - Math.abs(candJoined.length - qJoined.length) });
          continue;
        }
      }
      // Derivational-suffix basename bridge: a term that's a Module's own
      // basename one suffix-swap away ("logging" for basename "logger") is
      // still a name match — Module-only, so it can't collide with a
      // same-stem Class. Guarded against tier 5's territory: a near-miss typo
      // ("loging" for "logging") must still fall through to bounded-fuzzy.
      if (m.class === "Module") {
        const termRoot = derivationalStem(tLc);
        if (termRoot !== tLc && termRoot === derivationalStem(stem)) {
          const bound = fuzzyBound(tLc);
          if (editDistance(stem, tLc, bound) > bound) {
            scored.push({ ind: m, score: 3000 - Math.abs(stem.length - tLc.length) });
            continue;
          }
        }
      }
      if (tLc.length >= 4 && label.includes(tLc)) {
        scored.push({ ind: m, score: 1000 - Math.abs(label.length - tLc.length) });
        continue;
      }
      const labelComps = componentSet(m.label);
      const overlap = termComps.filter((c) => labelComps.has(c)).length;
      // For a slashed term, the stem MUST be among the label's own components
      // — an ANY-overlap match otherwise lets a NONEXISTENT path land on a
      // real module that merely shares its generic directory/extension
      // segments ("src", "mjs") with every other module in the pool (found
      // via the existence recognizer's "is there a class in src/nope.mjs"
      // scope clause: it would otherwise ambiguously "match"
      // src/core/model.mjs even though no such module exists — the same
      // accidental-match disease as the short-word substring bug just above,
      // just triggered by GENERIC components instead of raw containment).
      // A leaked leading VERB ("cover app/lib/b.mjs", "touch app/lib/f.mjs" —
      // router-interface.test.mjs's own frozen contract) still resolves: the
      // stem ("b"/"f") is a real component of the target label even though
      // "cover"/"touch" themselves never overlap anything, so overlap>0 and
      // the stem gate both hold.
      if (overlap > 0 && (!slashStem || labelComps.has(slashStem))) {
        // Normalized by the TERM's own component count (not a flat overlap*10): a
        // 1-of-3-component partial match ("verify" out of "verify-shipped"'s two
        // components, or similar) must never outscore a clean exact/prefix/suffix
        // stem hit from the tier above, nor a fuller-fraction overlap on another
        // candidate. termComps.length > 0 is guaranteed here (overlap > 0 requires
        // at least one termComps entry to have matched).
        scored.push({ ind: m, score: (overlap / termComps.length) * 10 });
      }
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

  // tier 4: prose-index fallback — see the function doc above.
  // The typeof guard is the same viewer-bundle boundary as defaultNlp(): viz.mjs's
  // askSource strips the prose.mjs import but does not inline prose.mjs, so in the
  // browser `lookupByProseTokens` is an undeclared identifier — without the guard,
  // ANY term reaching this tier threw a ReferenceError in the page instead of
  // rendering the honest miss (a real, previously-untested viewer bug).
  // DOTTED or SLASHED terms never consult prose: "res.json" word-matches
  // test/res.json.js's own path tokens, which is the tier-3 phantom-path bug
  // reappearing through a side door — a dotted term names an identifier, and
  // identifiers resolve by label (tiers above) or the bounded fuzzy pass
  // below, or they honestly miss. The SAME side door was open for SLASHED
  // path terms too: "src/nope.mjs" — a nonexistent module — no longer false-matches tier 3
  // (the AND-across-components fix just above), but fell through to THIS
  // prose tier and ambiguously "matched" real modules anyway, because
  // lookupByProseTokens scores by ANY-token overlap  and "src"/"mjs" are near-universal path/
  // extension tokens shared by every module in the pool — the identical
  // accidental-match disease, just one tier further down. A slash-shaped term
  // names a literal path exactly like a dotted term names a literal symbol;
  // neither is prose, so neither should ever reach the prose fallback.
  const pathShaped = dotted || tLc.includes("/");
  let proseResult = null;
  const proseHits = !pathShaped && typeof lookupByProseTokens === "function"
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

  // Tier 5: bounded fuzzy, one honest chance for a typo'd identifier. Sub-4-char
  // terms are excluded — a 1-edit budget on 3 chars matches far too much.
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
      const [bestInd, ...rest] = hits;
      return { match: bestInd, candidates: rest.slice(0, 4), tier: 5, ambiguous: true, matchedVia: "fuzzy" };
    }
  }
  return proseResult || { match: null, candidates: [], tier: null, ambiguous: false };
}

/** A leading article is pure noise on a structural entity term ("the logger" ==
 *  "logger") — mirrors memory/core.mjs's normFactTerm article-strip for taught
 *  facts, applied here on the graph-resolution side instead. */
const LEADING_ARTICLE_RE = /^(?:the|a|an)\s+/i;

/** A trailing generic grain word ("the logger MODULE") is a type hint to
 *  disambiguate which grain is meant, but tier 3's plain word-overlap scoring
 *  can't read grammatical role — it becomes an ordinary component and can tie
 *  the module against a same-stem Class/Method. Reuses ENTITY_TO_TYPE. */
const TRAILING_GRAIN_WORD_RE = new RegExp(`\\s+(${Object.keys(ENTITY_TO_TYPE).join("|")})$`, "i");

/** Words of `term` that neither the resolved label nor the closed grammar
 *  vocabulary can account for. A word is placed when the label's own letters
 *  carry it (so "payment system" is placed by PaymentSystem, and a component
 *  match is placed by construction), when a derivational bridge reaches one of
 *  the label's components ("logging" for "logger"), or when it is a word the
 *  grammar or the curated noise list already gives a job to (a leaked relation
 *  verb in "cover app/lib/b.mjs" is the parser's residue, not the user's).
 *  Everything else is a word this index has no reading for at all. */
function unplacedTermWords(term, label) {
  const labelJoined = joinedForm(label);
  const labelComps = [...componentSet(label)];
  const out = [];
  for (const w of componentSet(term)) {
    if (labelJoined.includes(w)) continue;
    if (labelComps.some((c) => derivationalStem(c) === derivationalStem(w))) continue;
    if (CONTENT_VOCAB.has(w) || NOISE_OR_SCAFFOLD.has(w)) continue;
    out.push(w);
  }
  return out;
}

/** Tier 3 scores candidates by how much of the term overlaps each label, so a
 *  term can narrow to exactly one candidate on a SUBSET of its own words and
 *  the leftovers go unread: "the deprecated legacy model.mjs" outscores every
 *  other module on "model"/"mjs" alone and answers about model.mjs, a
 *  different thing from what was asked for. A same-tier tie is already an
 *  honest ambiguity; a term carrying words the index has no reading for is the
 *  same failure with one candidate instead of five, so it declines the same
 *  way, naming the words it could not place and the near-match it would
 *  otherwise have silently answered about.
 *
 *  Tier 3 only: the prose and fuzzy tiers resolve BY not matching the label
 *  (doc-comment words, a typo'd spelling), and announce themselves in the
 *  answer where tier 3 says nothing.
 *
 *  The AMBIGUOUS case is the same failure with several candidates instead of
 *  one: a tie spread over candidates that ALL leave the same words unread is
 *  not a real ambiguity between readings of the question — it is the question
 *  not matching, several ways at once, and enumerating every candidate would
 *  answer each of them to a question none of them is. A word placed by ANY
 *  candidate keeps the honest ambiguity (that candidate may be the one meant). */
function declineOnUnplacedWords(result, term) {
  if (!result?.match || result.tier !== 3 || result.matchedVia) return result;
  if (result.ambiguous) {
    const pool = [result.match, ...(result.candidates || [])];
    const shared = pool
      .map((m) => new Set(unplacedTermWords(term, m.label)))
      .reduce((acc, s) => acc.filter((w) => s.has(w)), unplacedTermWords(term, pool[0].label));
    if (!shared.length) return result;
    return {
      match: null, candidates: [], tier: null, ambiguous: false,
      unplacedWords: shared, nearestLabel: listJoin(pool.slice(0, 4).map((m) => m.label)),
    };
  }
  const unplaced = unplacedTermWords(term, result.match.label);
  if (!unplaced.length) return result;
  return {
    match: null, candidates: [], tier: null, ambiguous: false,
    unplacedWords: unplaced, nearestLabel: result.match.label,
  };
}

/** resolveObject: a grain-aware disambiguation pre-pass wrapping
 *  resolveObjectCore, only when the caller hasn't pinned an expectedClass.
 *  Tries a trailing grain word (narrows the pool, retries the head noun),
 *  then a plain leading-article strip. Either retry is used only on an
 *  unambiguous hit; any miss/tie falls through unchanged to the original term.
 *  Whatever tier answers, a term with unreadable words left over declines
 *  instead of resolving past them. */
export function resolveObject(graph, term, opts = {}) {
  const { expectedClass = null } = opts;
  if (!expectedClass) {
    const raw = String(term || "").trim();
    const stripped = raw.replace(LEADING_ARTICLE_RE, "").trim();
    const grainMatch = stripped.match(TRAILING_GRAIN_WORD_RE);
    if (grainMatch) {
      const head = stripped.slice(0, grainMatch.index).trim();
      const grainClass = ENTITY_TO_TYPE[grainMatch[1].toLowerCase()];
      if (head && grainClass) {
        const rGrain = declineOnUnplacedWords(resolveObjectCore(graph, head, { expectedClass: grainClass }), head);
        if (rGrain?.match?.id && !rGrain.ambiguous) return rGrain;
      }
    }
    if (stripped && stripped !== raw) {
      const rStripped = declineOnUnplacedWords(resolveObjectCore(graph, stripped, opts), stripped);
      if (rStripped?.match?.id && !rStripped.ambiguous) return rStripped;
    }
    return declineOnUnplacedWords(resolveObjectCore(graph, term, opts), term);
  }
  // The pinned-class branch honors the same contract — a term carrying words
  // the index has no reading for declines instead of resolving past them
  // ("the old Task" pinned to Class must not silently swallow "old").
  return declineOnUnplacedWords(resolveObjectCore(graph, term, opts), term);
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

// ---- entry-point survey for the where-defined shape: "where is the (main)
// entry point defined" names a ROLE, not a label, so resolveObject can only
// miss it (or accidentally substring-match something unrelated). A closed
// basename vocabulary stands in for the role; every candidate is ranked
// deterministically and the ranking is disclosed in the answer, never a
// silently picked single winner. ----

/** The where-defined object phrasings that ask for the entry-point role. */
const ENTRY_POINT_QUERY_RE = /^(?:the\s+)?(?:main\s+|primary\s+)?entry[\s-]?points?(?:\s+(?:of|to|for)\s+(?:this|the)\s+(?:codebase|code|repo|repository|project|app))?$/i;
/** Module basenames conventionally used as a program's entry point. */
const ENTRY_POINT_BASENAMES = new Set(["index", "main", "app", "server", "cli", "__main__"]);
/** Directory segments marking test/fixture territory — ranked below real code. */
const TEST_FIXTURE_PATH_SEGMENTS = new Set(["test", "tests", "__tests__", "fixture", "fixtures", "spec", "specs", "testdata"]);

const moduleStemOf = (label) => String(label).toLowerCase().split("/").pop().replace(/\.[a-z0-9]+$/, "");
const isTestFixturePath = (label) => String(label).toLowerCase().split("/").slice(0, -1)
  .some((seg) => TEST_FIXTURE_PATH_SEGMENTS.has(seg));

/** All entry-point-basename Modules, best first: a basename the query itself
 *  names ("MAIN entry point" -> main.mjs) beats root proximity (fewer path
 *  segments), which beats a non-test path over a test/fixture one; a full tie
 *  falls back to label order so the ranking is stable. */
function rankEntryPointModules(graph, term) {
  const queryWords = new Set(String(term || "").toLowerCase().split(/[\s-]+/).filter(Boolean));
  return (graph.individuals || [])
    .filter((i) => i.class === "Module" && ENTRY_POINT_BASENAMES.has(moduleStemOf(i.label)))
    .map((ind) => ({
      ind,
      named: queryWords.has(moduleStemOf(ind.label)) ? 1 : 0,
      depth: String(ind.label).split("/").length,
      fixture: isTestFixturePath(ind.label) ? 1 : 0,
    }))
    .sort((a, b) => (b.named - a.named) || (a.depth - b.depth) || (a.fixture - b.fixture)
      || String(a.ind.label).localeCompare(String(b.ind.label)))
    .map((x) => x.ind);
}

/** Safety net: a {shape, kind, entityType} combination must be explicitly
 *  listed here to receive real non-"direct" modifier behavior; anything else
 *  gets an honest "not supported yet" response, never a silent fallback to
 *  direct-only behavior. */
function modifierIsWired(shape, kind, entityType) {
  return shape === "reverse" && (kind === "imports" || kind === "calls") && (!entityType || entityType === "Module");
}
const TRANSITIVE_MAX_DEPTH = 8; // matches renderImpact's own default (codegraph.mjs)

/** Compile a parsed query into a graph lookup. Pure given (graph, parsed, opts).
 *  `opts.contextId` resolves a context pronoun ("this"/"it"/…) when the parse
 *  needed one. Returns {matches, objMatch, candidates, traversal, ambiguous,
 *  answer?, unresolvedPronoun?} — `answer` only set for the "ask" shape.
 *  `matches` is always an array of individuals (or edge records for "ask"). */
export function traverse(graph, parsed, { contextId = null, prev = null, pinnedObjMatch = null } = {}) {
  if (!parsed) return { matches: [], objMatch: null, candidates: [], traversal: null, ambiguous: false };
  // Compositional AST nodes carry a `node` tag; everything else flows through
  // the original path below unchanged.
  if (parsed.node) return evalComposite(graph, parsed, { contextId, prev });
  // Every candidate in a same-class parse-level tie is independently
  // resolvable, so each is traversed and rendered for real here instead of
  // just describing the ambiguity with no content behind it.
  if (parsed.ambiguousParse) {
    const branches = parsed.candidates.map((c) => {
      const branchResult = traverse(graph, c, { contextId, prev });
      return { parsed: c, result: branchResult, rendered: render(c, branchResult, graph) };
    });
    return { matches: [], objMatch: null, candidates: parsed.candidates, traversal: null, ambiguous: true, branches };
  }
  const { shape, kind, entityType } = parsed;

  // meta: a question about the graph's own vocabulary, looked up against the
  // SchemaClass/SchemaPredicate individuals schema-docs.mjs merged into the
  // graph, not a code-edge traversal. Exact label or `token` attribute match only.
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
      const fallback = metaFallbackEntityAnswer(graph, term);
      if (fallback) {
        return {
          matches: [fallback.hit], objMatch: fallback.hit, candidates: [], ambiguous: false,
          metaCodeClass: true, metaFallbackText: fallback.text,
          traversal: `schema lookup for "${term}" (miss), then unique code-entity individual by label`,
        };
      }
      return { matches: [], objMatch: null, candidates: [], traversal: `schema lookup for "${term}"`, ambiguous: false };
    }
    return {
      matches: [match], objMatch: match, candidates: [],
      traversal: `schema lookup for "${term}"`, ambiguous: false,
    };
  }

  // mentions: "where is X mentioned" — the prose surface (resolveObject's
  // tier-4 index), not an edge traversal or entity resolution.
  if (shape === "mentions") {
    const term = String(parsed.object || "").trim();
    const hits = typeof lookupByProseTokens === "function" ? lookupByProseTokens(graph.proseIndex, term) : [];
    const matches = hits.map((h) => graph.byId.get(h.id)).filter(Boolean);
    return {
      matches, objMatch: null, candidates: [], ambiguous: false, mentionsShape: true,
      traversal: `proseIndex word lookup for "${term}"`,
    };
  }

  // where + an entry-point ROLE phrasing: checked before object resolution,
  // which could only miss the role term or accidentally land on an unrelated
  // partial match.
  if (shape === "where" && ENTRY_POINT_QUERY_RE.test(String(parsed.object || "").trim())) {
    const ranked = rankEntryPointModules(graph, parsed.object);
    return {
      matches: ranked, objMatch: ranked[0] || null, candidates: ranked.slice(1, 5),
      ambiguous: false, entryPointShape: true,
      traversal: `Module individuals with an entry-point basename (${[...ENTRY_POINT_BASENAMES].join("/")}), ranked query-named basename first, then shallower path, then non-test path`,
    };
  }

  // Checked before object resolution, so an unsupported modifier+kind
  // combination gets its own honest capability-gap message.
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
    // A tied, ambiguous fuzzy/prose match must decline here too (this shape
    // otherwise never checked `ambiguous`), or a coin-flip candidate's raw id
    // could leak into the Yes/No render's sentence.
    if (!subj.match || !obj.match || subj.ambiguous || obj.ambiguous) {
      return {
        matches: [], objMatch: obj.match, candidates: obj.candidates, traversal: null, ambiguous: false, answer: null,
        unresolvedPronoun: !!(subj.unresolvedPronoun || obj.unresolvedPronoun),
      };
    }
    // touches edges are stored commit -> entity; orient by where the commit
    // actually is when it's named on the object side.
    let [from, to] = [subj.match, obj.match];
    if (kind === "touches" && to.class === "Commit" && from.class !== "Commit") [from, to] = [to, from];
    // Both operands are named, so the yes/no wants the symbol-grain sibling
    // unconditionally: a callsSymbol-only edge is still a real call, and reading
    // the coarse kind alone answers No to a question the graph can answer Yes.
    const sibling = SYMBOL_GRAIN_SIBLING[kind];
    const kinds = [...new Set(sibling ? [...kindsFor(kind), sibling] : kindsFor(kind))];
    const edges = kinds.flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.subject === from.id && e.object === to.id);
    return {
      matches: edges, answer: parsed.negated ? edges.length === 0 : edges.length > 0,
      objMatch: obj.match, subjMatch: subj.match,
      candidates: [], traversal: `${kinds.join("+")} edge from ${from.label} to ${to.label}`, ambiguous: false,
    };
  }

  // reverse and forward both resolve one named term ("object" in the parsed
  // shape). altObject pruning: noise-strip.mjs's bare "where"/"mentions"
  // reading may carry `parsed.altObject` — a variant with a plausibly-noise
  // light verb also dropped. Tried here (where both readings and the graph
  // are available together): the alt reading wins only when the primary
  // misses/ties and the alt resolves cleanly; two clean, different resolves
  // become a genuine ambiguity, never a silent guess.
  // A recursive traverse() call for an already-tied candidate arrives with
  // `pinnedObjMatch` set — skip re-resolution entirely rather than
  // re-resolving by label text, which risks a spurious new tie.
  let objRes;
  if (pinnedObjMatch) {
    objRes = { match: pinnedObjMatch, candidates: [], ambiguous: false, matchedVia: null };
  } else {
    objRes = resolveTermOrContext(graph, parsed.object, contextId);
    if (parsed.altObject && parsed.altObject !== parsed.object) {
      const altRes = resolveTermOrContext(graph, parsed.altObject, contextId);
      const primaryClean = !!objRes.match && !objRes.ambiguous;
      const altClean = !!altRes.match && !altRes.ambiguous;
      if (!primaryClean && altClean) {
        objRes = altRes;
      } else if (primaryClean && altClean && objRes.match.id !== altRes.match.id) {
        objRes = { ...objRes, ambiguous: true, candidates: [altRes.match, ...(objRes.candidates || [])] };
      }
    }
    // Test-variant collision ("which tests cover b.mjs"): a "tests"-kind
    // query's bare object may also name its own conventional test-variant
    // sibling ("b.mjs" -> "b.test.mjs"), a different real Module. Scoped to
    // kind==="tests" and a bare (unslashed) term only.
    if (parsed.kind === "tests" && objRes.match && !objRes.ambiguous && !String(parsed.object || "").includes("/")) {
      const stripTestInfix = (base) => base.replace(/\.(?:test|spec|tests)(?=\.[^.]+$)/, "");
      const termBase = stripTestInfix(String(parsed.object || "").trim().toLowerCase());
      const collision = (graph.individuals || []).find((i) => {
        if (i.class !== "Module" || i.id === objRes.match.id) return false;
        const base = String(i.label || "").toLowerCase().split("/").pop();
        return base !== stripTestInfix(base) && stripTestInfix(base) === termBase;
      });
      if (collision) objRes = { ...objRes, ambiguous: true, candidates: [collision, ...(objRes.candidates || [])] };
    }
  }
  const { match: objMatch, candidates, ambiguous, unresolvedPronoun, matchedVia, unplacedWords, nearestLabel } = objRes;
  if (!objMatch) {
    return {
      matches: [], objMatch: null, candidates, traversal: null, ambiguous: false, unresolvedPronoun,
      unplacedWords, nearestLabel,
    };
  }
  // BREADTH-FIRST ENTITY-TIE RESOLUTION: mirrors the
  // parsed.ambiguousParse branch above — every tied candidate is independently
  // traversed and rendered for real (via the pinnedObjMatch short-circuit just
  // above), never left as a bare name list. Capped at OVERFLOW_CAP BEFORE
  // traversing (not just before rendering) to avoid wasted work on candidates
  // that won't be shown. One accepted, narrow trade-off: a general reverse-case
  // query whose grain-refine retry below would previously have silently
  // recovered to a different class-correct match now short-circuits to branches
  // instead — not exercised by any pinned test/bench case today.
  if (ambiguous) {
    const pool = uniqueById([objMatch, ...(candidates || [])]).slice(0, OVERFLOW_CAP);
    const branches = pool.map((c) => {
      const branchResult = traverse(graph, parsed, { contextId, prev, pinnedObjMatch: c });
      return { candidate: c, result: branchResult, rendered: render(parsed, branchResult, graph) };
    });
    return { matches: [], objMatch, candidates, traversal: null, ambiguous: true, branches };
  }

  // where: "where is X [defined]" — the resolved
  // entity IS the answer; render() reads its class + site attribute ("path:
  // start[-end]", seon:startsAt) for the module/line citation.
  if (shape === "where") {
    const site = (objMatch.attributes || []).find((a) => a.key === "site")?.value || null;
    return {
      matches: [objMatch], objMatch, candidates, ambiguous, matchedVia, whereShape: true, site,
      traversal: site ? `site attribute of ${objMatch.label}` : `class + defining module of ${objMatch.label}`,
    };
  }

  // when: "when did X change" / "when was X last touched" — the commits whose touch edges reach X, newest commit date first
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

  // who-last: "who last touched X" — the SAME
  // newest-commit-first resolution as "when" just above (single most-recent
  // toucher, not the full touch history), rendered as the commit's AUTHOR
  // instead of its date. A dedicated shape rather than reusing "when" outright:
  // render() needs to know to answer with "who", not "when", off the same
  // sorted commit list.
  if (shape === "whoLast") {
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    const edges = ["touches", "touchesSymbol"].flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.object === objMatch.id);
    const seen = new Set();
    const commits = [];
    for (const e of edges) {
      if (seen.has(e.subject)) continue;
      seen.add(e.subject);
      const c = graph.byId.get(e.subject);
      if (c && c.class === "Commit") commits.push(c);
    }
    commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    return {
      matches: commits, objMatch, candidates, ambiguous, matchedVia, whoLastShape: true,
      traversal: `touches+touchesSymbol edges where object = ${objMatch.label}, newest commit's author`,
    };
  }

  // Commit-as-subject flip: touches edges are stored commit -> entity, so
  // when the resolved term is itself a Commit, read edges FROM it instead of
  // scanning for edges into it (a commit is never a touch target).
  if (kind === "touches" && objMatch.class === "Commit") {
    return commitTouches(graph, objMatch, entityType, { candidates, ambiguous, matchedVia });
  }

  if (shape === "forward") {
    // A kind with a symbol-grain sibling scans the union coarse+sibling when
    // the resolved subject is itself a fine symbol ("what does Widget.render
    // call" lives on callsSymbol, not the module-coarse edge).
    const fwdSibling = SYMBOL_GRAIN_SIBLING[kind];
    const subjIsFineSymbol = !!(fwdSibling && objMatch.class && FINE_ENTITY_TYPES.has(objMatch.class));
    const fwdKinds = subjIsFineSymbol ? [...new Set([...kindsFor(kind), fwdSibling])] : kindsFor(kind);
    // A kind whose real target classes never include the asked entityType
    // (nor its FINE_CLASS_SIBLING partner) can never honestly answer it — an
    // honest decline, not a blind filter producing a false empty.
    if (entityType && entityType !== "Change") {
      const wantClasses = classesForKinds(graph, fwdKinds);
      const siblingClass = FINE_CLASS_SIBLING[entityType];
      // An edge-less kind (wantClasses empty) is not a grain mismatch — there
      // is nothing to name after "only …", and the render leaked a literal
      // "undefined" there. Fall through to the plain empty-edges answer.
      if (wantClasses.size && !wantClasses.has(entityType) && !(siblingClass && wantClasses.has(siblingClass))) {
        return {
          matches: [], objMatch, candidates, ambiguous, matchedVia,
          forwardGrainMiss: true, wantClasses: [...wantClasses],
          traversal: `${fwdKinds.join("+")} edges where subject = ${objMatch.label} (grain mismatch: this "${kind}" relation never targets a ${classDisplayName(entityType)})`,
        };
      }
    }
    const edges = fwdKinds.flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.subject === objMatch.id);
    const targets = edges.map((e) => graph.byId.get(e.object)).filter(Boolean);
    // Dedupe unconditionally: a forward answer enumerates distinct targets, so
    // reaching one twice is never information. It matters for a query-side
    // union (KIND_UNIONS' "uses" scans imports+calls+callsSymbol), where a
    // module that both imports AND calls another was listed twice — the
    // reverse traversal already collapses these, so the two directions
    // disagreed about the same pair.
    const deduped = uniqueById(targets);
    // Keep only matches of the asked class, so a forward answer never leaks
    // a wrong-class match once an entityType was actually asked for.
    let matches = deduped;
    let filterNote = "";
    if (entityType && entityType !== "Change") {
      matches = deduped.filter((m) => m.class === entityType);
      const siblingClass = FINE_CLASS_SIBLING[entityType];
      if (!matches.length && siblingClass) {
        const widened = deduped.filter((m) => m.class === siblingClass);
        if (widened.length) {
          matches = widened;
          filterNote = `, widened to ${siblingClass} subjects (no ${entityType} recorded)`;
        }
      }
    }
    return { matches, objMatch, candidates, traversal: `${fwdKinds.join("+")} edges where subject = ${objMatch.label}${filterNote}`, ambiguous, matchedVia };
  }

  // Reverse + transitive: reuses impactClosure (codegraph.mjs) as-is.
  // impactClosure's dependents map is a reverse closure over imports+calls
  // edges together, so "transitively imports" and "transitively calls" both
  // resolve to the same mixed closure — a deliberate scope decision, stated
  // honestly in the traversal receipt below.
  if (parsed.modifier === "transitive") {
    const levels = impactClosure(graph, objMatch, { maxDepth: TRANSITIVE_MAX_DEPTH });
    const matches = levels.flat().map((d) => graph.byId.get(d.id)).filter(Boolean);
    return {
      matches, objMatch, candidates, ambiguous, matchedVia,
      traversal: `reverse dependency closure over imports+calls edges from ${objMatch.label} (impactClosure, maxDepth=${TRANSITIVE_MAX_DEPTH})`,
    };
  }

  // reverse: "which <entityType> R <objMatch>". Grain-aware: a kind with a
  // symbol-grain sibling reads off the sibling when a fine subject grain was
  // asked for, or when the resolved object is itself a fine symbol — the
  // module-coarse edge can never point at a function/method, so a bare "what
  // calls fnAlpha" would otherwise return a false empty. A union kind's own
  // symbol-grain member ("uses" carries callsSymbol) plays the same sibling
  // role here, so "what uses <symbol>" walks the same grain ladder as "what
  // calls <symbol>" instead of skipping it.
  const symbolKind = SYMBOL_GRAIN_SIBLING[kind] || kindsFor(kind).find((k) => SYMBOL_GRAIN_KINDS.has(k)) || null;
  const objIsFineSymbol = !!(objMatch.class && FINE_ENTITY_TYPES.has(objMatch.class));
  if (symbolKind && (FINE_ENTITY_TYPES.has(entityType) || objIsFineSymbol)) {
    const edges = edgesOfKind(graph, symbolKind).filter((e) => e.object === objMatch.id);
    const subjects = uniqueById(edges.map((e) => graph.byId.get(e.subject)).filter(Boolean));
    let matches = (!entityType || entityType === "Change") ? subjects : subjects.filter((i) => i.class === entityType);
    let widenNote = "";
    // Fallback-only: when the exact-class filter is empty and the asked
    // grain is Function/Method, retry with the family sibling class.
    const siblingClass = FINE_CLASS_SIBLING[entityType];
    if (!matches.length && siblingClass) {
      const widened = subjects.filter((i) => i.class === siblingClass);
      if (widened.length) {
        matches = widened;
        widenNote = `, widened to ${siblingClass} subjects (no ${entityType} recorded)`;
      }
    }
    // Class-to-module up-refinement: an empty touchesSymbol/callsSymbol
    // lookup on a resolved Class with no recorded `contains` members should
    // still answer from the class's containing module's real touches/calls,
    // rather than a confident-looking-but-wrong "nothing touched/calls it".
    // Not widened to Function/Method — symbol-level counting precision there
    // is a separate, deliberate guarantee this must not erode.
    const upRefineEligible = (kind === "touches" || kind === "calls" || kind === "uses") && objMatch.class === "Class"
      && !edgesOfKind(graph, "contains").some((e) => e.subject === objMatch.id);
    const upRefineModule = upRefineEligible ? graph.byId.get(moduleIdOf(graph, objMatch) || "") : null;
    if (matches.length || !(upRefineEligible && upRefineModule)) {
      return { matches, objMatch, candidates, traversal: `${symbolKind} edges where object = ${objMatch.label}${widenNote}`, ambiguous, matchedVia };
    }
  }

  // Grain-aware object resolution, checked before the edge filter below: a
  // predicate's object slot carries one particular class (kindObjectClass),
  // but resolveObject is blind to that — a same-stem term ("logger") could
  // resolve to the wrong grain (Class Logger) instead of the Module the edge
  // actually targets, producing a confident-wrong empty.
  let gObjMatch = objMatch;
  let gCandidates = candidates;
  let gAmbiguous = ambiguous;
  let gMatchedVia = matchedVia;
  let grainRefinedNote = "";
  const wantClass = kindObjectClass(graph, kind);
  if (wantClass && gObjMatch.class && gObjMatch.class !== wantClass) {
    // (1) retry resolution scoped to the expected class.
    const retry = resolveObject(graph, parsed.object, { expectedClass: wantClass });
    if (retry.match && !retry.ambiguous) {
      gObjMatch = retry.match;
      gCandidates = retry.candidates;
      gAmbiguous = retry.ambiguous;
      gMatchedVia = retry.matchedVia;
    } else if (wantClass === "Module") {
      // (2) up-refine to the containing module (any kind whose real
      // object-class is always Module): the resolved fine-grain entity lives
      // in a module, and that module is the real subject of the question.
      const mid = moduleIdOf(graph, gObjMatch);
      const mod = mid && graph.byId.get(mid);
      if (mod) {
        grainRefinedNote = `, refined from ${gObjMatch.label} to its containing module`;
        gObjMatch = mod;
      } else {
        return {
          matches: [], objMatch: gObjMatch, candidates: gCandidates, ambiguous: gAmbiguous, matchedVia: gMatchedVia,
          wrongGrainMiss: true, wantClass,
          traversal: `"${parsed.object}" resolved to ${classDisplayName(gObjMatch.class)} ${gObjMatch.label} (grain mismatch: this "${kind}" question needs a ${classDisplayName(wantClass)}, and no containing module could be found to refine to)`,
        };
      }
    } else {
      // (3) neither applies — an honest wrong-grain miss, distinct from
      // "unresolved" and "resolved + genuinely empty".
      return {
        matches: [], objMatch: gObjMatch, candidates: gCandidates, ambiguous: gAmbiguous, matchedVia: gMatchedVia,
        wrongGrainMiss: true, wantClass,
        traversal: `"${parsed.object}" resolved to ${classDisplayName(gObjMatch.class)} ${gObjMatch.label} (grain mismatch: this "${kind}" question needs a ${classDisplayName(wantClass)})`,
      };
    }
  }

  // General case: some predicates are already fine-grained (inherits) and
  // some are module-coarse (imports/calls/tests/cochange). Check what the
  // edge's actual subjects are: use them directly if they already match the
  // requested entityType; only refine via `defines` when they're Modules and
  // a finer entityType was asked for.
  let edges = kindsFor(kind).flatMap((k) => edgesOfKind(graph, k)).filter((e) => e.object === gObjMatch.id);
  // cochange is symmetric but stored as one directed edge per pair, so
  // "which modules cochange with X" must also match when X is the stored
  // subject — flip subject<->object on that side.
  if (kind === "cochange") {
    edges = edges.concat(
      kindsFor(kind).flatMap((k) => edgesOfKind(graph, k))
        .filter((e) => e.subject === gObjMatch.id)
        .map((e) => ({ ...e, subject: e.object, object: e.subject })),
    );
  }
  let extNote = "";
  if (!edges.length && gObjMatch.class) {
    // Unresolved ext:<Name> endpoints sharing the resolved entity's name: the
    // extractor declined to assert identity, so a strict id match renders a
    // false blank. Count them by name instead and say so in the receipt.
    const extId = `ext:${String(gObjMatch.label).toLowerCase()}`;
    edges = kindsFor(kind).flatMap((k) => edgesOfKind(graph, k)).filter((e) => String(e.object).toLowerCase() === extId);
    if (edges.length) extNote = ` (by name, via unresolved ${extId} references)`;
  }
  // Dedupe by id: a union kind ("uses") can reach the same subject through
  // two legs, and one answer must list it once.
  const subjects = [];
  const seenSubjects = new Set();
  for (const e of edges) {
    const s = graph.byId.get(e.subject);
    if (s && !seenSubjects.has(s.id)) { seenSubjects.add(s.id); subjects.push(s); }
  }
  let matches, grainNote = "";
  // "Change" is a wildcard: "which changes touch walk.mjs" means the touch
  // edges' own subjects (commits), not a node class to filter by.
  if (!entityType || entityType === "Change") {
    matches = subjects;
  } else {
    const direct = subjects.filter((s) => s.class === entityType);
    if (direct.length) {
      matches = direct;
    } else if (entityType !== "Module" && subjects.some((s) => s.class === "Module")) {
      const moduleIds = new Set(subjects.filter((s) => s.class === "Module").map((s) => s.id));
      matches = refineToEntities(graph, moduleIds, entityType);
      grainNote = `, then ${classDisplayName(entityType)} defined in the matched module(s)`;
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

// ---- templated renderer: string interpolation + grouping/pluralization/
// overflow rules, never generation. ----

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

/** A friendly commit reference for a "who touched X" list: names the author
 *  beside the sha when recorded, else renders the sha alone. */
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

/** The base verb form for a relation ("imports" -> "import"), for the frames
 *  that need an infinitive. Unknown kinds fall back to the token itself rather
 *  than being coerced into a guessed base form. */
function bareVerbFor(kind) {
  return RELATIONS[kind]?.bare || kind;
}

/** English gloss of a SET-COMPLEMENT AST — the shape parseNegation compiles
 *  "which X do not <verb> Y" into (allOfClass DIFFERENCE the positive set).
 *  Restates the question in the same grammar the positive canonical uses
 *  ('modules that imports "store.mjs"'), so the negated and positive readings
 *  of one question are told apart by reading the line, which is the whole point
 *  of printing it. Returns null for any other boolean shape rather than
 *  glossing it wrongly. */
function complementGloss(parsed) {
  // Exactly two atoms: a third would be silently dropped from the gloss,
  // restating a narrower question than the one that was asked.
  if (!Array.isArray(parsed.atoms) || parsed.atoms.length !== 2) return null;
  const [seed, diff] = parsed.atoms;
  if (seed.op !== "seed" || seed.ast?.node !== "allOfClass" || diff.op !== "difference") return null;
  const noun = nounFor(parsed.entityType, 2);
  if (diff.kind === "qual") return `${noun} that are not ${diff.filters.join(" and not ")}`;
  if (diff.kind !== "set" || !diff.ast) return null;
  if (diff.ast.node === "existsEdge") return `${noun} that do not ${bareVerbFor(diff.ast.kind)} anything`;
  // The positive leg parseNegation differenced off the class: a single clause
  // ("which modules do not import store.mjs") is the shape this gloss reads.
  // Anything deeper is a nested composite and gets no gloss rather than a
  // confidently wrong one.
  const leaf = diff.ast.node === "clause" ? diff.ast.clause : diff.ast;
  if (!leaf || leaf.node || !leaf.kind) return null;
  const obj = leaf.object ?? leaf.subject;
  if (obj == null) return null;
  return `${noun} that do not ${bareVerbFor(leaf.kind)} ${JSON.stringify(String(obj))}`;
}

/** The canonical restatement of what a query was understood to mean: an
 *  English gloss (`english`) and a compact `shape(kind, args...)` notation
 *  (`machine`), both read off `parsed`'s already-compiled fields. A
 *  compositional AST with no gloss of its own falls back to naming its node
 *  type — coarse, but never a wrong restatement. */
function canonicalOf(parsed) {
  if (!parsed) return null;
  if (parsed.ambiguousParse) {
    return {
      english: `ambiguous: ${parsed.candidates.map(describeParse).join(" — or — ")}`,
      machine: `ambiguousParse(${parsed.candidates.map((c) => canonicalOf(c)?.machine).join(", ")})`,
    };
  }
  if (parsed.node) {
    const gloss = parsed.node === "boolean" ? complementGloss(parsed) : null;
    return {
      english: gloss || `a compositional query (${parsed.node})`,
      machine: `composite(${parsed.node})`,
    };
  }
  const q = (s) => JSON.stringify(String(s ?? ""));
  const args = [];
  if (parsed.kind) args.push(parsed.kind);
  if (parsed.negated) args.push("negated");
  if (parsed.entityType) args.push(`entityType=${parsed.entityType}`);
  if (parsed.modifier && parsed.modifier !== "direct") args.push(`modifier=${parsed.modifier}`);
  if (parsed.subject != null) args.push(`subject=${q(parsed.subject)}`);
  if (parsed.object != null) args.push(q(parsed.object));
  const machine = `${parsed.shape}(${args.join(", ")})`;
  let english;
  if (parsed.shape === "ask") {
    english = `does "${parsed.subject}" ${parsed.negated ? "not " : ""}${verbFor(parsed.kind)} "${parsed.object}"?`;
  } else if (parsed.shape === "meta") {
    english = `what does "${parsed.object}" mean, in this graph's own vocabulary?`;
  } else if (parsed.shape === "mentions") {
    english = `where is "${parsed.object}" mentioned?`;
  } else if (parsed.shape === "where") {
    english = `where is "${parsed.object}" defined?`;
  } else {
    const ent = parsed.entityType ? nounFor(parsed.entityType, 2) + " that " : "";
    english = parsed.shape === "forward"
      ? `what "${parsed.object}" itself ${verbFor(parsed.kind)}`
      : `${ent}${verbFor(parsed.kind)} "${parsed.object}"`;
  }
  return { english, machine };
}

/** Render a compiled query result into {content, miss, ambiguous, matches?,
 *  candidates?}. A tier-5 fuzzy object resolution is announced, not silent:
 *  prefixed "assuming you meant <label>:" so the correction is on the record. */
export function render(parsed, result, graph = null) {
  const r = renderCore(parsed, result, graph);
  if (result && result.matchedVia === "fuzzy" && result.objMatch && !r.ambiguous) {
    r.content = `assuming you meant ${result.objMatch.label}: ${r.content}`;
  }
  return r;
}

function renderCore(parsed, result, graph) {
  if (!parsed) {
    return { content: `couldn't parse this as a graph question. Try: ${rephraseHint()}`, miss: true, ambiguous: false };
  }
  if (parsed.node) return renderComposite(parsed, result, graph);
  if (parsed.ambiguousParse) {
    // Each branch was actually resolved in traverse() above (never guessed at) —
    // show every reading's real, effective answer, not just its one-line label, so
    // the same input always reproduces the same full multi-reading answer (copy the
    // same prompt back in and get the identical result, not a coin flip).
    if (result.branches && result.branches.length) {
      const options = result.branches
        .map((b, i) => `${i + 1}) as ${describeParse(b.parsed)}: ${b.rendered.content}`)
        .join("\n");
      return {
        content: `this could mean more than one thing:\n${options}\n(ask one of these directly, or try rephrasing more specifically, to get just that reading)`,
        miss: false, ambiguous: true, candidates: parsed.candidates.map(describeParse),
        candidateParses: parsed.candidates,
      };
    }
    // Fallback (no `result.branches` — e.g. a caller invoking render() directly
    // with a hand-built result, bypassing traverse()): the old bare-label listing.
    const options = parsed.candidates.map((p, i) => `${i + 1}) ${describeParse(p)}`).join(" or ");
    return {
      content: `this could mean more than one thing: ${options} — try rephrasing more specifically.`,
      miss: false, ambiguous: true, candidates: parsed.candidates.map(describeParse),
      candidateParses: parsed.candidates,
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
  // forward-shape honest miss: the resolved SUBJECT
  // is real, but the asked entityType can never appear among this kind's own real
  // target classes at all — distinct from wrongGrainMiss above (which is about the
  // resolved OBJECT term's class on the reverse side) and from the plain forward
  // zero-hit template below (which is a genuinely empty edge scan, not a class the
  // relation can never produce).
  if (result.forwardGrainMiss) {
    const wantNouns = result.wantClasses.map((c) => nounFor(c, 2));
    return {
      content: `${result.objMatch.label}'s "${verbFor(parsed.kind)}" relation in this index never produces ${nounFor(parsed.entityType, 2)} — only ${listJoin(wantNouns)}.`,
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
    // meta fallback hit (see traverse's meta branch, metaFallbackEntityAnswer): the term is not
    // schema vocabulary but IS a unique code-graph entity (Class/Function/Method/
    // GlobalVariable/Attribute) — its pre-rendered describe-style one-liner is
    // passed straight through, so this stays byte-identical to whatever chat.mjs's
    // bare "what is X" last-resort lane produces by calling the SAME function.
    if (result.metaCodeClass) {
      return { content: result.metaFallbackText, miss: false, ambiguous: false, matches: result.matches };
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
  // entry-point survey: every candidate is disclosed with the rank order,
  // never a silently picked single winner; zero candidates is an honest miss
  // naming the closed basename vocabulary that was searched.
  if (result.entryPointShape) {
    if (!result.matches.length) {
      return {
        content: `no entry-point module found in the index — no module basename matches ${listJoin([...ENTRY_POINT_BASENAMES])}.`,
        miss: true, ambiguous: false, candidates: [],
      };
    }
    const [top, ...rest] = result.matches;
    const shownRest = rest.slice(0, OVERFLOW_CAP).map((i) => i.label);
    const extra = rest.length > OVERFLOW_CAP ? `, …and ${rest.length - OVERFLOW_CAP} more` : "";
    const also = rest.length ? ` — also matched: ${listJoin(shownRest)}${extra}` : "";
    return {
      content: `ranked ${result.matches.length} entry-point match${result.matches.length === 1 ? "" : "es"}; top: ${top.label}${also}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  if (!result.objMatch && (!result.candidates || result.candidates.length === 0) && parsed.shape !== "ask") {
    // Name what kind of thing was looked for: a sha-shaped term reads as
    // "commit", a dotted slash-free term as "symbol" (both keep priority over
    // entityType); otherwise fall back to the parsed AST's own entityType.
    const objText = String(parsed.object || "").trim();
    const fallback = parsed.entityType && PLURAL_FORMS[parsed.entityType] ? nounFor(parsed.entityType, 1) : "module";
    const what = /^(?:commit[:\s])?[0-9a-f]{7,40}$/i.test(objText) ? "commit"
      : (!objText.includes("/") && /^[\w$]+(\.[\w$]+)+$/.test(objText) ? "symbol" : fallback);
    // Words the term carried that nothing in the index reads (resolveObject's
    // unplaced-word decline) are named here with the near match they would
    // otherwise have been quietly dropped in favour of: the reader gets to
    // decide whether the near match was the question.
    if (result.unplacedWords?.length) {
      const quoted = listJoin(result.unplacedWords.map((w) => `"${w}"`));
      const was = result.unplacedWords.length === 1 ? "names" : "name";
      const near = result.nearestLabel ? ` Did you mean ${result.nearestLabel}?` : "";
      return {
        content: `no ${what} matching "${parsed.object}" found in the index. ${quoted} ${was} nothing here, and reading past ${result.unplacedWords.length === 1 ? "it" : "them"} would answer a different question.${near}`,
        miss: true, ambiguous: false, candidates: [],
      };
    }
    return {
      content: `no ${what} matching "${parsed.object}" found in the index. ${touchesRephraseHint(graph)}`,
      miss: true, ambiguous: false, candidates: [],
    };
  }
  if (result.ambiguous) {
    // Name the actual candidates in the prose, not just the structured field
    // — "narrow the term" isn't actionable if the reader can't see the options.
    let pool = [result.objMatch, ...(result.candidates || [])].filter(Boolean);
    let branches = result.branches;
    // A relation question's object slot is a code entity, so a Commit/Session
    // candidate (a prose-tier hit on a commit MESSAGE) is grain noise in the
    // did-you-mean — dropped, along with its branch, unless the question is
    // itself about touches/history where a commit genuinely fits.
    if (parsed.kind && parsed.kind !== "touches" && !pool.every((i) => i.class === "Commit")) {
      const grainOk = (i) => !["Commit", "Session", "Source", "Utterance"].includes(i?.class);
      const kept = pool.filter(grainOk);
      if (kept.length) {
        pool = kept;
        if (branches?.length) branches = branches.filter((b) => grainOk(b.candidate));
      }
    }
    // The nearest REAL neighbour joins the list: a misremembered symbol
    // ("saveTask") shares an identifier word with the real one ("saveStore"),
    // which no containment/prose tier ever surfaces. Ranked by shared
    // camelCase-split words (≥3 chars), edit distance breaking ties.
    if (graph && !/[/.]/.test(String(parsed.object || ""))) {
      const tLc = String(parsed.object || "").toLowerCase();
      const termWords = new Set(splitIdentifierWords(String(parsed.object || "")).filter((w) => w.length >= 3));
      const already = new Set(pool.map((i) => i.id));
      let nearest = null;
      let bestShared = 0;
      let bestD = Infinity;
      if (termWords.size) {
        for (const i of graph.individuals) {
          if (!["Function", "Method", "Class", "GlobalVariable", "Attribute"].includes(i.class) || already.has(i.id)) continue;
          const shared = splitIdentifierWords(String(i.label)).filter((w) => termWords.has(w)).length;
          if (!shared || shared < bestShared) continue;
          const d = editDistance(String(i.label).toLowerCase(), tLc, 8);
          if (shared > bestShared || d < bestD) { nearest = i; bestShared = shared; bestD = d; }
        }
      }
      if (nearest) pool = [...pool, nearest];
    }
    const noun = pool.length && pool.every((i) => i.class === "Commit") ? "commit" : "module";
    const shown = pool.slice(0, OVERFLOW_CAP).map((i) => i.label);
    const extra = pool.length > OVERFLOW_CAP ? `, …and ${pool.length - OVERFLOW_CAP} more` : "";
    const lead = `"${parsed.object}" matches more than one ${noun} ambiguously — did you mean ${listJoin(shown)}${extra}? Try one of those. If you're not sure, narrow it to one name.`;
    const content = (branches && branches.length)
      ? `${lead}\n${branches.map((b, i) => `${i + 1}) ${b.candidate.label}: ${b.rendered.content}`).join("\n")}`
      : lead;
    return {
      content, miss: false, ambiguous: true, candidates: pool.map((i) => i.label),
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
      // "is defined in" stays unvaried here on purpose — pinned ground truth
      // for "where is X defined". The other two "defined in" call sites
      // answer a different query shape and carry the phrasing variety instead.
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
      return { content: `no recorded commit touches ${subject} in this index. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false };
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
      return { content: `commit ${newest.label} ${pickPhrase("is-dated", newest.id, "is dated")} ${day}${msg ? ` ("${msg}")` : ""}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    const more = result.matches.length - 1;
    return {
      content: `${subject} was last touched by commit ${newest.label} on ${day}${msg ? ` ("${msg}")` : ""}${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  // who-last: newest touching commit's author. "who last touched X" would
  // otherwise fall into the ordinary reverse-list render and name every
  // toucher; this answers with just the most recent one.
  if (result.whoLastShape) {
    const subject = result.objMatch.label;
    if (!result.matches.length) {
      return { content: `no recorded commit touches ${subject} in this index. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false };
    }
    const newest = result.matches[0];
    const author = (newest.attributes || []).find((a) => a.key === "author")?.value;
    if (!author) {
      return {
        content: `commit ${newest.label} last touched ${subject}, but this index records no commit author — regenerate the graph to attach mgx:commitAuthor.`,
        miss: true, ambiguous: false,
      };
    }
    const more = result.matches.length - 1;
    return {
      content: `${subject} was last touched by ${author} (commit ${newest.label})${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
      miss: false, ambiguous: false, matches: result.matches,
    };
  }
  // Commit-as-subject answers: cite the commit, group touched entities by
  // class — modules and symbols are different grains, so flattening would
  // hide which is which.
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
    // The edge sentence and the no-edge sentence each state what the graph
    // holds; the question's polarity only decides which one carries the Yes.
    const edgeFound = `${result.traversal}.`;
    const noEdge = `no ${parsed.kind} edge found from ${result.subjMatch.label} to ${result.objMatch.label}.`;
    const holds = parsed.negated ? noEdge : edgeFound;
    const fails = parsed.negated ? edgeFound : noEdge;
    return {
      content: `${result.answer ? "Yes" : "No"} — ${result.answer ? holds : fails}`,
      // A miss is the absence of a citation, which the polarity never changes:
      // "no edge found" cites nothing whether it arrives as a Yes or a No.
      miss: !result.matches.length, ambiguous: false,
    };
  }
  if (!result.matches.length) {
    // Forward: parsed.object is the given subject, not a search target, so it
    // gets its own subject-first phrasing rather than reverse's template.
    if (parsed.shape === "forward") {
      // The index stores membership on either contains (Class -> member) or
      // defines (Module -> symbol), and MEMBERSHIP_KINDS declares the two
      // equivalent for a members-of question — so before reporting "no
      // contains edges" for a subject whose members live on defines, the
      // sibling kind is consulted over the SAME resolved subject. Adopted
      // only on a real match; anything else keeps the honest empty.
      if (MEMBERSHIP_KINDS.includes(parsed.kind) && graph && result.objMatch) {
        for (const alt of MEMBERSHIP_KINDS) {
          if (alt === parsed.kind) continue;
          const altParsed = { ...parsed, kind: alt };
          const altResult = traverse(graph, altParsed, { pinnedObjMatch: result.objMatch });
          if (altResult?.matches?.length && !altResult.ambiguous) return renderCore(altParsed, altResult, graph);
        }
      }
      return {
        content: `${result.objMatch.label} has no ${verbFor(parsed.kind)} edges in the index.`,
        miss: true, ambiguous: false,
      };
    }
    // "what tests cover X" has no explicit entity keyword and "tests" reads
    // as a verb phrase, so any leaked leading relation verb is stripped
    // before rendering the honest empty.
    if (parsed.kind === "tests" && !parsed.entityType) {
      const stripped = String(parsed.object || "").replace(LEADING_RELATION_VERB_RE, "").trim();
      const obj = stripped || String(parsed.object || "").trim();
      return {
        content: `No tests cover ${obj}.`,
        miss: true, ambiguous: false,
      };
    }
    const entityWord = nounFor(parsed.entityType || "Module", 2);
    return {
      content: `No ${entityWord} found whose module directly ${verbFor(parsed.kind)} ${parsed.object}. ${touchesRephraseHint(graph)}`,
      miss: true, ambiguous: false,
    };
  }
  // Route by the matched entities' actual class, not just the parsed hint —
  // grouping module-level matches by-module would read as nonsense ("in
  // a.mjs there is a.mjs"). Fine-grained grouping only applies to sub-module
  // entities.
  if (parsed.shape === "forward" || parsed.entityType === "Module" || result.matches.every((m) => !FINE_ENTITY_TYPES.has(m.class))) {
    // A reverse "who touched X" resolves to Commit individuals — render
    // friendly refs (short sha + author) instead of the raw stored sha.
    const shown = result.matches.slice(0, OVERFLOW_CAP).map((m) => m.class === "Commit" ? commitRefOf(m) : m.label);
    const extra = result.matches.length > OVERFLOW_CAP ? `, …and ${result.matches.length - OVERFLOW_CAP} more` : "";
    return { content: shown.join(" and ") + extra + ".", miss: false, ambiguous: false, matches: result.matches };
  }
  // reverse, fine-grained entity: group by module, one clause per module —
  // the FIRST module states "in {module} there is …"; each SUBSEQUENT module states
  // "there is … in {module}" (module trails, not leads).
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
// progressive-relaxation cascade: a controlled loop that runs only when the
// direct parse of the normalized query would miss. Only ever drops noise/
// unmatched words or normalises a near-canonical word, re-attempting the
// full parse after each transform, bottoming out in the same honest miss +
// rephrase hint — never inventing a term or guessing an entity.
// ============================================================================

/** Every token the closed grammar gives query meaning to. The noise-strip
 *  pass will never remove one of these, and the drop-unmatched pass always
 *  keeps them: they carry the intent, only the packaging is negotiable. */
const CONTENT_VOCAB = new Set([
  ...wordsOf(Object.keys(VERB_TO_KIND)), ...wordsOf(Object.keys(ENTITY_TO_TYPE)),
  ...wordsOf(Object.keys(MODIFIER_TO_KIND)), ...wordsOf(Object.keys(QUALIFIERS)),
  ...wordsOf(AGGREGATE_TRIGGERS), ...wordsOf(Object.keys(SUPERLATIVE_EXTREMES)),
  ...wordsOf(Object.keys(EDGE_NOUN_TO_METRIC)), ...wordsOf(Object.keys(BOOLEAN_CONNECTIVES)),
  ...wordsOf(PLACEHOLDER_NOUNS), ...wordsOf(ANAPHORA_TRIGGERS), ...wordsOf(META_MEANING_VERBS),
  ...wordsOf(WHERE_MARKERS), ...wordsOf(MENTION_MARKERS), ...wordsOf(RELATIVE_PRONOUNS),
  ...wordsOf(Object.keys(CASCADE_SYNONYMS)),
]);

/** Structural scaffolding words — question words, frame verbs, context
 *  pronouns. Not "content", but they hold a sentence together, so the
 *  drop-unmatched pass keeps them; the noise-strip pass may still remove the
 *  few that are also curated noise ("the"/"a"/"show"/"me"). */
const STRUCTURAL_WORDS = new Set([...STOPWORDS, ...FRAME_WORDS, ...CONTEXT_PRONOUNS]);
const CASCADE_NOISE_SET = new Set(wordsOf(CASCADE_NOISE));
/** Every token that carries no graph meaning of its own. The bare-kind-noun
 *  terminal rule treats a query as "just a kind noun wrapped in packaging"
 *  only when every non-kind token is one of these. */
const NOISE_OR_SCAFFOLD = new Set([...CASCADE_NOISE_SET, ...STRUCTURAL_WORDS]);

/** The aggregate/list trigger words the cascade's drop-unmatched pass will
 *  fuzzy-correct a typo toward. Curated to clean single verbs so a phrasal
 *  trigger's stray word ("down"/"off") never mis-corrects an unrelated token. */
const TRIGGER_FUZZY_WORDS = [
  "many", "count", "number", "quantity", "total", "tally",
  "list", "show", "display", "print", "dump", "enumerate", "name",
];
/** Closed-vocab words a plain unknown may be fuzzy-corrected toward before
 *  the cascade discards it. Only fires on a unique within-bound target;
 *  excludes stopwords and <4-char words (too many accidental matches). */
const CASCADE_FUZZY_TARGETS = [...new Set([
  ...wordsOf(Object.keys(VERB_TO_KIND)),
  ...Object.keys(ENTITY_TO_TYPE),
  ...TRIGGER_FUZZY_WORDS,
])].filter((wd) => /^[a-z]+$/.test(wd) && wd.length >= 4 && !STOPWORDS.has(wd));

/** Real words that carry their own intent and are never a typo of the closed
 *  vocabulary: the corrector must not rewrite them at all. "impact" sits two
 *  edits from "import", and rewriting it answers the reverse question in the
 *  asker's own words — an unrecognised impact phrasing must decline instead. */
const CASCADE_FUZZY_REAL_WORDS = new Set(["impact", "impacts", "impacted"]);

/** Unique within-bound fuzzy correction of `w` toward CASCADE_FUZZY_TARGETS,
 *  or null — a distance tie between two distinct targets is refused. The
 *  4-char floor holds on the word being corrected as well as on the targets:
 *  a 1-edit budget on three letters reaches real vocabulary from words that
 *  were never a typo of it ("old" -> "hold"), and the correction is announced
 *  as though the asker had typed it. */
function fuzzyCascadeWord(w) {
  if (w.length < 4 || CASCADE_FUZZY_REAL_WORDS.has(w)) return null;
  const bound = fuzzyBound(w);
  let best = bound + 1; let hit = null; let tied = false;
  for (const target of CASCADE_FUZZY_TARGETS) {
    const d = editDistance(w, target, Math.min(best, bound));
    if (d < best) { best = d; hit = target; tied = false; }
    else if (d === best && d <= bound && target !== hit) tied = true;
  }
  return best <= bound && !tied ? hit : null;
}

/** The typo->schema-term trap guard: a term that resolves only via tier-5
 *  bounded-fuzzy onto a schema individual, while the same word also
 *  fuzzy-corrects to an entity kind noun ("modles" -> "modules"), is a
 *  typo'd kind noun, not a schema question. Reporting it unanswerable sends
 *  it to the relaxation cascade instead of confidently answering the wrong
 *  question. Exact/substring/prose matches are untouched. */
function schemaTypoTrap(resolution, term) {
  if (!resolution?.match || resolution.matchedVia !== "fuzzy" || resolution.ambiguous) return false;
  const cls = resolution.match.class;
  if (cls !== "SchemaClass" && cls !== "SchemaPredicate") return false;
  const lc = String(term || "").trim().toLowerCase();
  const kindNoun = fuzzyCascadeWord(lc);
  return !!kindNoun && kindNoun !== lc && !!ENTITY_TO_TYPE[kindNoun];
}

/** Is `parsed` a genuinely answerable query — one that both parsed and (for
 *  simple clauses) resolves its named term(s)? Returns true (real, executable
 *  answer), "ambiguous"/"pronoun" (a specific outcome to keep, not relaxed),
 *  or false (no parse, a compositional miss, an unresolved term, or a
 *  schemaTypoTrap hit — relaxable). ask() starts the cascade only on false. */
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

/** Whole-query help/orientation request -> show the hint directly. Matches
 *  only when the entire normalized query is a curated HELP_TRIGGER. */
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
function relaxParse(graph, query, { nlp = undefined, contextId = null, prev = null } = {}) {
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
  // Does a term string carry at least one real word, one the grammar doesn't
  // already own as vocabulary/scaffolding? Guards against a relaxation that
  // drops the actual asked term and lets a bare marker slide into its place.
  // A bare context pronoun is the one exception — it resolves through
  // contextId, so it counts as a real term.
  const hasRealTerm = (s) => {
    const whole = String(s || "").trim().toLowerCase();
    if (CONTEXT_PRONOUNS.includes(whole)) return true;
    return splitWords(whole).some((w) => {
      const lc = w.toLowerCase();
      return !CONTENT_VOCAB.has(lc) && !STRUCTURAL_WORDS.has(lc);
    });
  };
  // Accept a relaxed attempt only if it's genuinely answerable and renders a
  // real positive answer — relaxation earns a win only by turning a miss
  // into an answer, never a differently-worded miss.
  const TERM_SHAPES = new Set(["reverse", "forward", "where", "when", "ask"]);
  const attempt = (toks) => {
    const text = toks.join(" ");
    const p = parseQuery(text, { nlp });
    if (answerable(graph, p, contextId) !== true) return null;
    if (p && !p.node && TERM_SHAPES.has(p.shape)) {
      if (p.object != null && !hasRealTerm(p.object)) return null;
      if (p.shape === "ask" && p.subject != null && !hasRealTerm(p.subject)) return null;
    }
    const rendered = render(p, traverse(graph, p, { contextId, prev }), graph);
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
  //
  // Words INSIDE the term survive this layer's DROP (its fuzzy-correct still
  // repairs them — a typo is a word the asker meant, and the receipt shows the
  // spelling it was read as). "what imports the deprecated legacy model.mjs"
  // names a thing the asker believes exists; drop "deprecated" and "legacy"
  // and the survivors answer about model.mjs, a different thing, under a
  // receipt that reads as though the question was merely tidied. Layer 1's
  // curated noise list earns that receipt because every word it removes is
  // packaging. This layer drops whatever it doesn't recognize, so inside the
  // term it holds off and lets the original miss stand, unknown words and all.
  const termParse = parseQuery(tokens.join(" "), { nlp });
  const termWords = new Set();
  if (termParse && !termParse.node && TERM_SHAPES.has(termParse.shape)) {
    for (const part of [termParse.object, termParse.subject]) {
      for (const w of splitWords(String(part || "").toLowerCase())) termWords.add(w);
    }
  }
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
    // Before dropping an unmatched token, try a bounded fuzzy-correct to a
    // unique closed-vocab word, so a typo'd trigger ("manyn"->"many") is
    // restored rather than discarded.
    const fix = fuzzyCascadeWord(lc);
    if (fix && fix !== lc) { survivors.push(fix); corrected.push(`${t}→${fix}`); continue; }
    if (termWords.has(lc)) { survivors.push(t); continue; }
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

  // Layer 4 (terminal) — bare kind noun -> a bounded default action. A query
  // that is only a kind noun wrapped in articles/noise/question words
  // defaults to a count of that kind ("the classes" -> "20 classes."), never
  // a list (unscoped lists of hundreds are noise; count is the cheap useful
  // answer). Classifies the original normalized tokens (`from`), not the
  // layer-mutated `tokens` — drop-unmatched has already eaten any unknown
  // qualifier, so "the shiny classes" must be told apart from bare "classes".
  const bareLc = splitWords(from).map((t) => t.toLowerCase());
  const kindWords = [];
  const others = [];
  for (const t of bareLc) {
    if (NOISE_OR_SCAFFOLD.has(t)) continue;
    // "Change" is ask-vocab's pseudo-type, never a node class, so it's not countable.
    const et = ENTITY_TO_TYPE[t];
    if (et && et !== "Change") kindWords.push(t);
    else others.push(t);
  }
  if (kindWords.length === 1 && others.length === 0) {
    // Reuse the whole aggregate pipeline: a synthesized "count <kind>" is the
    // exact query the cascade's other count paths land.
    const hit = attempt(["count", kindWords[0]]);
    if (hit) { steps.push(`bare kind "${kindWords[0]}" → count`); return done(hit); }
  }

  return null; // exhausted — the honest bottom of the cascade
}

// ---- orchestration — the tmct_ask entry point (parse -> resolve -> traverse -> render) ----

/** Answer a free-text question over the graph, mechanically. `opts.contextId`
 *  resolves a context pronoun, wired from a UI's currently-selected node;
 *  omit it in the bare CLI surface. `opts.nlp` overrides the lemma/POS
 *  adapter. `opts.prev` is the id array of the last answer's matches, for
 *  anaphora follow-ups; omit it and anaphora questions produce an honest
 *  "needs a previous answer" miss. Returns {content, tmct_ask:
 *  {mechanical,parsed,matches,traversal,miss,ambiguous,candidates?}}. Zero
 *  generative model calls. */
const LAST_COMMIT_PHRASE_RE = /\b(?:the\s+)?(?:last|latest|most\s+recent)\s+commit\b/i;

/** resolveObject has no notion of "the newest Commit individual", and the
 *  bare word "commit" itself component-matches the Commit SchemaClass node,
 *  so "what did the last commit touch" used to render a false empty. Fixed
 *  by textual substitution before the normal parse/resolve pipeline runs:
 *  the phrase is swapped for "commit <newest-sha>". A graph with no commits,
 *  or no dated commit, leaves the query text untouched. */
// A bare "when was/did commit X" with no change-verb tail (the shape left
// once "the latest commit" is substituted out) needs a "touched" tail
// appended, since grammar.mjs's T8 "when" template requires a verb to fire.
const BARE_WHEN_COMMIT_RE = /^when\s+(?:was|were|is|did|does|do)\s+commit\s+[0-9a-fA-F:]+$/i;

function substituteLastCommitPhrase(graph, query) {
  const q = String(query || "");
  if (!graph || !LAST_COMMIT_PHRASE_RE.test(q)) return q;
  const commits = graph.individuals.filter((i) => i.class === "Commit");
  if (!commits.length) return q;
  const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
  const newest = [...commits].sort((a, b) => dateOf(b).localeCompare(dateOf(a)))[0];
  if (!newest) return q;
  const out = q.replace(LAST_COMMIT_PHRASE_RE, `commit ${newest.label}`);
  const bareTrimmed = out.trim().replace(/[?.!]+$/, "");
  return BARE_WHEN_COMMIT_RE.test(bareTrimmed) ? `${bareTrimmed} touched` : out;
}

// ---- dynamic memory-graph class count/list: a "list/count all X of class Y"
// shape for memory-graph classes (Fact/Utterance/Session/Source/Rule, or any
// taught class), reachable via ask.mjs alone. ENTITY_TO_TYPE is a closed
// code-graph noun table, so this instead resolves against whatever classes
// actually have an individual in this graph, reusing the same count/list
// AST + traverse()/render() path every code-graph query runs through. Fires
// only as a fallback after the normal cascade already produced an honest
// miss, and is skipped for any noun ENTITY_TO_TYPE already owns. ----
function singularCandidates(word) {
  const w = String(word || "").toLowerCase();
  const c = new Set([w]);
  if (w.endsWith("ies")) c.add(`${w.slice(0, -3)}y`);
  if (w.endsWith("ses")) c.add(w.slice(0, -2));
  else if (w.endsWith("es")) c.add(w.slice(0, -2));
  if (w.endsWith("s") && w.length > 1) c.add(w.slice(0, -1));
  return [...c];
}
function resolveDynamicClass(graph, word) {
  const cands = singularCandidates(word);
  for (const ind of graph?.individuals || []) {
    if (ind?.class && cands.includes(String(ind.class).toLowerCase())) return ind.class;
  }
  return null;
}
const DYNAMIC_LIST_TRIGGER_RE = /^(?:list|show(?:\s+me)?)\s+(?:all\s+|the\s+)?([a-z][a-z'-]*)\s*(.*)$/i;
const DYNAMIC_COUNT_TRIGGER_RE = /^(?:how\s+many|number\s+of|count(?:\s+the)?)\s+([a-z][a-z'-]*)\s*(.*)$/i;
// A closed set of harmless trailing fillers; anything else (a real
// restrictor like "that mention X") is left alone.
const DYNAMIC_TAIL_OK_RE = /^(?:are there(?:\s+in\s+total)?|is there|do you know(?:\s+about)?|do you have|exist(?:s)?|are known|in (?:the |a )?(?:graph|memory)|you know(?:\s+about)?)?[?.!\s]*$/i;

/** Compile "list/how many <memory-class-noun>" into the same count/list AST
 *  every code-graph count/list query already builds, or null when this isn't
 *  that shape. */
function dynamicClassQuery(graph, query) {
  const q = String(query || "").trim();
  const listM = q.match(DYNAMIC_LIST_TRIGGER_RE);
  const countM = !listM ? q.match(DYNAMIC_COUNT_TRIGGER_RE) : null;
  const m = listM || countM;
  if (!m || !DYNAMIC_TAIL_OK_RE.test(m[2] || "")) return null;
  if (ENTITY_TO_TYPE[m[1].toLowerCase()]) return null;
  const entityType = resolveDynamicClass(graph, m[1]);
  if (!entityType) return null;
  const base = { node: "allOfClass", entityType };
  return listM ? { node: "list", entityType, base, scoped: false } : { node: "count", entityType, base };
}

// Matches T5's own bare-object capture (grammar.mjs meta-whatis), reused below to
// extract the term for the article-insertion fallback rather than duplicating it.
const BARE_META_WHATIS_RE = /^what\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;

// "what is X for" / "what is X used for" with a bare entity term — the lead
// refuses a/an articles and pronouns so the vocabulary phrasings ("what is a
// horse for", "what is it for") never read as an entity term; a leading "the"
// is entity-term noise (resolveObject's own article strip) and is dropped.
const WHATIS_FOR_FALLBACK_RE = /^what\s+is\s+(?:the\s+)?(?!(?:an?|it|this|that|these|those)\s)(.+?)\s+(?:used\s+)?for[?.!\s]*$/i;

export function ask(graph, query, { contextId = null, nlp = undefined, prev = null } = {}) {
  if (isHelpRequest(query)) {
    return {
      content: rephraseHint(),
      tmct_ask: {
        mechanical: true, parsed: null, canonical: null, matches: [], traversal: null,
        miss: true, ambiguous: false, matchedVia: null, help: true, relaxed: null,
      },
    };
  }
  query = substituteLastCommitPhrase(graph, query);
  const directFull = parseQueryFull(query, { nlp });
  const direct = directFull.parsed;
  // The relaxation cascade fires only when the direct parse would miss; a
  // clean hit, an ambiguous parse, an unresolved-pronoun miss, and a
  // real-but-empty answer all keep the direct parse untouched.
  let parsed = direct;
  let relaxed = null;
  if (answerable(graph, direct, contextId) === false) {
    const r = relaxParse(graph, query, { nlp, contextId, prev });
    if (r) { parsed = r.parsed; relaxed = { from: r.from, to: r.to, dropped: r.dropped, steps: r.steps }; }
  }
  let result = traverse(graph, parsed, { contextId, prev });
  let rendered = render(parsed, result, graph);
  // Dynamic memory-graph class count/list fallback, only once everything
  // above already produced an honest miss.
  if (rendered.miss && !rendered.ambiguous) {
    const dyn = dynamicClassQuery(graph, query);
    if (dyn) {
      const dynResult = traverse(graph, dyn, { contextId, prev });
      const dynRendered = render(dyn, dynResult, graph);
      if (!dynRendered.miss) { parsed = dyn; result = dynResult; rendered = dynRendered; relaxed = null; }
    }
  }
  // Bare "what is X" (no article) meta fallback, narrow to ask() and never
  // touching the outer `parsed` even on a miss — chat.mjs's own gates key off
  // `!envelope.parsed`, so populating it here would steal turns from lanes
  // like moduleOrientLane ("what is X for"). Fires only once nothing else parsed.
  if (parsed === null && rendered.miss && !rendered.ambiguous) {
    // The contraction is written out first, or "what's X" reads as a different
    // question from "what is X" on the apostrophe alone. Only the contraction
    // pass, never normalizeQuery's fuller one — the filler strip would let
    // "please describe X"-shaped turns in through a lead they didn't type.
    const bareM = expandContractions(String(query || "")).trim().match(BARE_META_WHATIS_RE);
    const bareTerm = bareM?.[1]?.trim();
    if (bareTerm && !/\s+(?:for|about)$/i.test(bareTerm)) {
      const bareParsed = parseQuery(`what is a ${bareTerm}`, { nlp });
      if (bareParsed?.shape === "meta") {
        result = traverse(graph, bareParsed, { contextId, prev });
        rendered = render(bareParsed, result, graph);
      }
    }
  }
  // "what is X for" — the purpose paraphrase of the same bare-whatis intent,
  // excluded from the block above (and from the phrasing frames) because
  // chat.mjs's module-overview lane owns this phrasing and gates on an ask()
  // miss. The meta reading is adopted ONLY when it actually answers (a unique
  // metaFallback entity); on a miss, every byte — parsed, canonical, the miss
  // text — stays exactly as the lane cascade expects. Article/pronoun-led
  // terms ("what is a horse for") belong to the memory-facts readers and are
  // never claimed.
  if (parsed === null && rendered.miss && !rendered.ambiguous) {
    const forM = normalizeQuery(String(query || "")).match(WHATIS_FOR_FALLBACK_RE);
    const forTerm = forM?.[1]?.trim();
    if (forTerm) {
      const forParsed = parseQuery(`what is a ${forTerm}`, { nlp });
      if (forParsed?.shape === "meta") {
        const forResult = traverse(graph, forParsed, { contextId, prev });
        const forRendered = render(forParsed, forResult, graph);
        if (!forRendered.miss && !forRendered.ambiguous) {
          result = forResult;
          rendered = forRendered;
        }
      }
    }
  }
  // If relaxation materially rewrote the query and produced a real answer,
  // note it lightly so the reader knows how the question was read.
  let content = (relaxed && !rendered.miss && relaxed.to !== relaxed.from)
    ? `read as "${relaxed.to}" — ${rendered.content}`
    : rendered.content;
  // A genuine distinct-class alternate reading (merge.mjs's `alternates`)
  // is surfaced on a real direct hit, computing each alternate's own real
  // answer directly rather than via alternateLines' fallback-prone
  // "ask it that way" pointer — an alternate that can't be answered for
  // real is dropped silently. Skipped when relaxation rewrote the query,
  // since directFull's alternates would no longer describe the question
  // actually answered.
  if (!relaxed && !rendered.miss && !rendered.ambiguous && directFull.alternates.length) {
    const answered = directFull.alternates
      .map((a) => {
        const altResult = traverse(graph, a.parsed, { contextId, prev });
        const altRendered = render(a.parsed, altResult, graph);
        return altRendered.miss ? null : { a, text: altRendered.content };
      })
      .filter(Boolean);
    if (answered.length) {
      const lines = alternateLines(answered.map((x) => x.a), {
        answerFor: (a) => answered.find((x) => x.a === a)?.text || null,
      });
      content = `${content}\n${lines.join("\n")}`;
    }
  }
  return {
    content,
    tmct_ask: {
      mechanical: true,
      parsed: (parsed && !parsed.ambiguousParse) ? parsed : null,
      canonical: canonicalOf(parsed),
      matches: (result.matches || []).map((m) => ({
        id: m.id, label: m.label, type: m.class, module: m.class ? moduleLabelOf(m) : undefined,
      })),
      traversal: result.traversal || null,
      miss: !!rendered.miss,
      ambiguous: !!rendered.ambiguous,
      // null when the direct parse was used as-is; a caller can assert
      // relaxed===null to prove the cascade never touched a direct hit.
      relaxed,
      // "prose" (tier-4 prose-index fallback) or "fuzzy" (tier-5 bounded
      // edit-distance, announced in the content as "assuming you meant …");
      // null for every literal-identifier tier.
      matchedVia: result.matchedVia || null,
      ...(rendered.ambiguous ? { candidates: rendered.candidates, candidateParses: rendered.candidateParses } : {}),
    },
  };
}
