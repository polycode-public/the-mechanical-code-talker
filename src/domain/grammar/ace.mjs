// grammar/ace.mjs — tmct's deterministic ACE-OWL sub-fragment parser.
// Implements the 9 controlled-English sentence patterns of
// docs/references/schemas/ace-owl-fragment.md and nothing more: fitting the
// grammar is a strong signal, missing it is a FEATURE — parseAce returns null
// (or an empty-triples result carrying the unknown words as `residue`) and the
// interpretation pipeline (src/domain/interpret/) falls through to the tolerant
// strategies. No NLP dependency: tokenization is whitespace + trailing
// punctuation, morphology is the lexicon's suffix fold.
//
// parseAce(sentence, lexicon) → { pattern, triples, residue } | null
//   pattern  one of the PATTERNS below.
//   triples  [{ subject, predicate, object, kind, n? }] — OWL-labelled string
//            triples shaped for src/adapters/memory/core.mjs's appendFact (which
//            normalizes subject/object via normFactTerm: "tmct:module" is
//            stored as "module"; the predicate keeps its vocabulary casing).
//   residue  [] on a clean parse; the unknown tokens when the sentence FITS a
//            pattern structurally but uses undeclared words (triples is then
//            empty — feeds the pipeline's "if you mean X…" surround).
//   null     the sentence does not fit the fragment at all.
//
// Term style: classes/individuals are `tmct:<lexeme>` CURIEs; predicates are
// OWL/RDF(S) vocabulary terms or the lexicon verb's tmct:<3sg> predicate
// (lexicon.mjs's predicateOf). Restriction/intersection nodes get READABLE
// deterministic names (tmct:some-imports-test) instead of blank nodes, so the
// same sentence always re-emits the same triples and appendFact stays
// idempotent; an intersection flattens to repeated owl:intersectionOf triples
// (documented in ontology/tmct-core.ttl).

import {
  loadLexicon, lookupNoun, lookupVerb, lookupAdjective, lookupProperName,
  predicateOf, numberOf, classify,
} from "./lexicon.mjs";
import { fuzzyMatchInSet } from "../interpret/fuzzy.mjs";

// "a"/"an" are the only ACE determiners that are grammatically SINGULAR-ONLY —
// "the" and a bare/no determiner are number-neutral (see resolveNP's
// singularOnly below, and lexicon.mjs's lookupNoun doc for what this prunes).
const SINGULAR_ONLY_DET = new Set(["a", "an"]);

const PATTERN_SUB_CLASS_OF = "subClassOf";
const PATTERN_TYPE_ASSERTION = "typeAssertion";
const PATTERN_RELATION = "relation";
const PATTERN_SOME_VALUES_FROM = "someValuesFrom";
const PATTERN_CARDINALITY = "cardinality";
const PATTERN_DISJOINT_WITH = "disjointWith";
const PATTERN_POSSESSIVE = "possessive";
const PATTERN_ADJECTIVE = "adjective";
const PATTERN_CAPABILITY = "capability";

/** The pattern field's full domain, in the README's table order. */
const PATTERNS = Object.freeze([
  PATTERN_SUB_CLASS_OF, PATTERN_TYPE_ASSERTION, PATTERN_RELATION, PATTERN_SOME_VALUES_FROM,
  PATTERN_CARDINALITY, PATTERN_DISJOINT_WITH, PATTERN_POSSESSIVE, PATTERN_ADJECTIVE,
  PATTERN_CAPABILITY,
]);

const DET = new Set(["a", "an", "the"]);
// A token SHAPED like a code reference (a path, file, symbol or CURIE) is an
// individual by form — a deterministic tokenizer rule, not a guess: declared
// proper names cover words; this covers chat.mjs, src/domain/ask.mjs, Foo#bar.
const CODE_REF = /[./\\#:@]/;

/** Whitespace tokenizer: curly quotes normalized, commas/semicolons dropped,
 *  ONE trailing punctuation run stripped (so "chat.mjs." keeps its dots). */
export function tokenize(sentence) {
  return String(sentence ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[,;]/g, " ")
    .replace(/[?!.]+\s*$/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Strip a lexicon's own namespace prefix off a term, for use inside a
 *  synthesized deterministic node name (so "${ns}some-${ns}imports-${ns}test"
 *  reads as "${ns}some-imports-test"). A term outside the lexicon's own
 *  namespace (a rare cross-namespace reference) is returned unchanged. */
function local(lexicon, term) {
  const s = String(term);
  const ns = lexicon.ns;
  return ns && s.startsWith(ns) ? s.slice(ns.length) : s;
}

const stripDet = (tokens) =>
  tokens.length > 1 && DET.has(tokens[0].toLowerCase()) ? tokens.slice(1) : tokens;

/** Resolve a 1–2 word noun phrase: PROPERNAME | code-ref | NOUN | ADJ NOUN.
 *  Returns { term, individual, extras, unknown } — `term` null on a miss with
 *  the undeclared tokens in `unknown` (empty `unknown` = structurally
 *  unparseable phrase → the caller returns a hard null). `extras` carries the
 *  pattern-8 adjective triples (subclass axioms / hasValue restriction).
 *
 *  `singularOnly` is grammatical-agreement pruning (see lexicon.mjs's
 *  lookupNoun doc): true only when the ORIGINAL (pre-strip) phrase opened
 *  with "a"/"an" — the one signal that a singular-plural-fold collision
 *  (die/dice, person/people, tooth/teeth) can be resolved by, rather than
 *  silently committing to whichever the lexicon happens to fold to first. */
function resolveNP(lexicon, tokensIn, { allowCompound = false } = {}) {
  const ns = lexicon.ns;
  const singularOnly = tokensIn.length > 1 && SINGULAR_ONLY_DET.has(tokensIn[0].toLowerCase());
  const tokens = stripDet(tokensIn);
  if (tokens.length === 1) {
    const t = tokens[0];
    const proper = lookupProperName(lexicon, t);
    if (proper) return { term: `${ns}${proper}`, individual: true, extras: [], unknown: [] };
    if (CODE_REF.test(t)) return { term: `${ns}${t}`, individual: true, extras: [], unknown: [] };
    const noun = lookupNoun(lexicon, t, { singularOnly });
    // `folded` marks a match that only exists because lookupNoun's own
    // trailing-"-s" strip or irregular-plural table rewrote the surface word
    // — never an exact lexicon hit. parseCopula (below) uses this to keep a
    // proper name that happens to fold to an unrelated dictionary word
    // ("whiskers" -> "whisker") from silently losing its spelling.
    if (noun) return { term: `${ns}${noun.lemma}`, individual: false, noun, folded: noun.lemma.toLowerCase() !== t.toLowerCase(), extras: [], unknown: [] };
    return { term: null, individual: false, extras: [], unknown: [t] };
  }
  if (tokens.length === 2) {
    const adj = lookupAdjective(lexicon, tokens[0]);
    const noun = lookupNoun(lexicon, tokens[1], { singularOnly });
    if (adj && noun) {
      const term = `${ns}${adj.lemma}-${noun.lemma}`;
      const extras = [
        { subject: term, predicate: "rdfs:subClassOf", object: `${ns}${noun.lemma}`, kind: "rdfs:subClassOf" },
      ];
      if (adj.type === "subclass") {
        // the adjective itself denotes a class: legacy-module ⊑ module, ⊑ legacy
        extras.push({ subject: term, predicate: "rdfs:subClassOf", object: `${ns}${adj.lemma}`, kind: "rdfs:subClassOf" });
      } else {
        // data adjective: subclass-with-restriction on the boolean-ish property
        const r = `${ns}has-${adj.lemma}`;
        extras.push(
          { subject: r, predicate: "rdf:type", object: "owl:Restriction", kind: "owl:hasValue" },
          { subject: r, predicate: "owl:onProperty", object: adj.property || `${ns}${adj.lemma}`, kind: "owl:hasValue" },
          { subject: r, predicate: "owl:hasValue", object: adj.value ?? "true", kind: "owl:hasValue" },
          { subject: term, predicate: "rdfs:subClassOf", object: r, kind: "owl:hasValue" },
        );
      }
      return { term, individual: false, noun, extras, unknown: [] };
    }
    // Two plain NOUNS in a row are ONE compound noun ("guinea pig", "sports
    // car"), space-joined to match the corpus's own multi-word concepts
    // ("schema person"), so the taught fact and the query side unify.
    // STRICTLY OPT-IN per call site (allowCompound): only the patterns where
    // a compound subject is safe request it — capability, quantified
    // membership, disjointness, and the articled-complement copula. The
    // generic relation walk and the bare-adjective copula never do, so a
    // question lead ("does dog have…") or a property sentence ("checkout
    // flow is deprecated") can never silently become an ACE teach. A
    // DECLARED proper name in either slot ("GitLab pipeline") keeps the
    // structural miss below — a name in the wrong slot, not a compound.
    if (allowCompound
      && !lookupProperName(lexicon, tokens[0]) && !lookupProperName(lexicon, tokens[1])
      && /^[a-z][a-z'-]*$/i.test(tokens[0]) && /^[a-z][a-z'-]*$/i.test(tokens[1])) {
      const n0 = lookupNoun(lexicon, tokens[0], { singularOnly: false });
      const n1 = lookupNoun(lexicon, tokens[1], { singularOnly });
      if (n0 && n1) {
        return { term: `${ns}${tokens[0].toLowerCase()} ${tokens[1].toLowerCase()}`, individual: false, noun: n1, extras: [], unknown: [] };
      }
    }
    // only genuinely undeclared words are residue — a declared word in the
    // wrong slot ("GitLab pipeline") is a structural miss, not an unknown
    const unknown = tokens.filter((t) => !classify(t, lexicon));
    return { term: null, individual: false, extras: [], unknown };
  }
  // 0 or 3+ tokens: not a fragment NP. Name the undeclared words if any.
  return { term: null, individual: false, extras: [], unknown: tokens.filter((t) => !classify(t, lexicon)) };
}

/** A bare single-token subject (no determiner of its own) that resolveNP only
 *  resolved via a fold, immediately followed by an indefinite-article object
 *  ("whiskers is A CAT", "every whiskers is A CAT"), is the canonical
 *  individual-naming shape ("john is a man") wearing a proper name that
 *  happens to fold to an unrelated dictionary word ("whiskers" ->
 *  "whisker"). Trusting the fold here silently rewrites the taught subject's
 *  spelling; declining it and reporting the token as unknown lets the
 *  caller's own novel-individual fallback store the literal typed word
 *  instead — the same honest-miss-over-guess call this file's
 *  exact/irregular-only folds already make everywhere else. Shared by
 *  parseCopula and parseEvery, the two patterns whose subject slot can hold
 *  a bare single token immediately followed by "a"/"an". */
function declineFoldedBareSubject(np, subjectToks, objectHead) {
  if (np.term != null && !np.individual && np.folded
    && subjectToks.length === 1 && /^an?$/i.test(objectHead)) {
    return { term: null, individual: false, extras: [], unknown: [subjectToks[0]] };
  }
  return np;
}

/** The shared miss result: a structural fit with undeclared words returns the
 *  pattern + residue (triples empty); a fit with only declared-but-unusable
 *  phrasing returns null — the honest fall-through either way. */
function missOrNull(pattern, nps, extraUnknown = []) {
  const residue = [...extraUnknown, ...nps.flatMap((np) => np.unknown)];
  return residue.length ? { pattern, triples: [], residue } : null;
}

const hit = (pattern, nps, triples, more = {}) => ({
  pattern,
  triples: [...nps.flatMap((np) => np.extras), ...triples],
  residue: [],
  ...more,
});

/** Pattern 3 — "N1 VERB N2" / "PROPERNAME VERBs PROPERNAME" → object-property
 *  assertion. Also the no-declared-verb 3-token shape: both ends resolvable →
 *  residue names the middle token (the future "if you mean X…" hook). */
function parseRelation(lexicon, toks, lower) {
  for (let i = 1; i < toks.length - 1; i += 1) {
    const verb = lookupVerb(lexicon, lower[i]);
    if (!verb) continue;
    let objStart = i + 1;
    if (verb.prep) {
      if (lower[objStart] !== verb.prep) continue;
      objStart += 1;
      if (objStart >= toks.length) continue;
    }
    const np1 = resolveNP(lexicon, toks.slice(0, i));
    const np2 = resolveNP(lexicon, toks.slice(objStart));
    if (np1.term == null || np2.term == null) return missOrNull(PATTERN_RELATION, [np1, np2]);
    return hit(PATTERN_RELATION, [np1, np2], [
      { subject: np1.term, predicate: predicateOf(verb, lexicon.ns), object: np2.term, kind: "owl:ObjectProperty" },
    ]);
  }
  const content = toks.filter((t) => !DET.has(t.toLowerCase()));
  if (content.length === 3 && !classify(content[1], lexicon)) {
    const np1 = resolveNP(lexicon, [content[0]]);
    const np2 = resolveNP(lexicon, [content[2]]);
    if (np1.term != null && np2.term != null) return { pattern: PATTERN_RELATION, triples: [], residue: [content[1]] };
  }
  return null;
}

// ---- ambiguity: an additive scan a caller opts into to see every surviving
// reading, never displacing parseRelation's own greedy first-match path. ----

/** Pattern 3 — every verb-position split (not just the first), keeping only
 *  complete, valid parses; a dead-end split is pruned, not surfaced. */
function parseRelationHits(lexicon, toks, lower) {
  const hits = [];
  for (let i = 1; i < toks.length - 1; i += 1) {
    const verb = lookupVerb(lexicon, lower[i]);
    if (!verb) continue;
    let objStart = i + 1;
    if (verb.prep) {
      if (lower[objStart] !== verb.prep) continue;
      objStart += 1;
      if (objStart >= toks.length) continue;
    }
    const np1 = resolveNP(lexicon, toks.slice(0, i));
    const np2 = resolveNP(lexicon, toks.slice(objStart));
    if (np1.term == null || np2.term == null) continue; // dead end
    hits.push({
      i,
      verbLemma: verb.lemma,
      subject: np1.term,
      object: np2.term,
      result: hit(PATTERN_RELATION, [np1, np2], [
        { subject: np1.term, predicate: predicateOf(verb, lexicon.ns), object: np2.term, kind: "owl:ObjectProperty" },
      ]),
    });
  }
  return hits;
}

/** Public ambiguity surface: null unless 2+ independent, complete
 *  relation-pattern readings survive, in which case all are returned, each
 *  labeled by the token read as its verb. */
export function parseAceAmbiguous(sentence, lexicon = loadLexicon()) {
  const toks = tokenize(sentence);
  if (toks.length < 4) return null; // 3 tokens: exactly one verb position is even possible
  const lower = toks.map((t) => t.toLowerCase());
  if (lower[0] === "every" || lower[0] === "no") return null;
  if (/'s$/.test(lower[0]) && lower[0].length > 2) return null;
  if (lower[0] === "the" && lower.includes("of") && lower.includes("is")) return null;
  if (lower.indexOf("is") > 0) return null;
  const hits = parseRelationHits(lexicon, toks, lower);
  if (hits.length < 2) return null;
  return {
    pattern: PATTERN_RELATION,
    sentence,
    readings: hits.map(({ i, verbLemma, subject, object, result }) => ({
      i, verbLemma, subject, object, ...result,
    })),
  };
}

/** Pattern 8 (copula arm) — "X is ADJ": data adjective → datatype-property
 *  assertion; subclass adjective → rdf:type (individual) / rdfs:subClassOf. */
function adjectiveCopula(lexicon, pattern, np1, adj) {
  const ns = lexicon.ns;
  if (np1.term == null) return missOrNull(pattern, [np1]);
  if (adj.type === "data") {
    return hit(pattern, [np1], [
      { subject: np1.term, predicate: adj.property || `${ns}${adj.lemma}`, object: adj.value ?? "true", kind: "owl:DatatypeProperty" },
    ]);
  }
  const predicate = np1.individual ? "rdf:type" : "rdfs:subClassOf";
  return hit(pattern, [np1], [
    { subject: np1.term, predicate, object: `${ns}${adj.lemma}`, kind: predicate },
  ]);
}

/** Pattern 4 — "every N1 that VERBs a N2 is a N3" → someValuesFrom restriction:
 *  (N1 ⊓ ∃VERB.N2) ⊑ N3, flattened onto readable deterministic node names. */
function parseRestriction(lexicon, toks, lower, thatIdx) {
  const ns = lexicon.ns;
  const isIdx = lower.indexOf("is", thatIdx + 2);
  if (isIdx < 0 || thatIdx + 1 >= isIdx) return null;
  const verb = lookupVerb(lexicon, lower[thatIdx + 1]);
  const np1 = resolveNP(lexicon, toks.slice(1, thatIdx));
  let objStart = thatIdx + 2;
  if (verb?.prep) {
    if (lower[objStart] !== verb.prep) return null;
    objStart += 1;
  }
  const np2 = resolveNP(lexicon, toks.slice(objStart, isIdx));
  const np3 = resolveNP(lexicon, toks.slice(isIdx + 1));
  if (!verb) return missOrNull(PATTERN_SOME_VALUES_FROM, [np1, np2, np3], [toks[thatIdx + 1]]);
  if (np1.term == null || np2.term == null || np3.term == null) {
    return missOrNull(PATTERN_SOME_VALUES_FROM, [np1, np2, np3]);
  }
  if (np1.individual || np2.individual || np3.individual) return null; // class-level pattern only
  const pred = predicateOf(verb, ns);
  const k = "owl:someValuesFrom";
  const r = `${ns}some-${local(lexicon, pred)}-${local(lexicon, np2.term)}`;
  const inter = `${ns}${local(lexicon, np1.term)}-that-${local(lexicon, pred)}-${local(lexicon, np2.term)}`;
  return hit(PATTERN_SOME_VALUES_FROM, [np1, np2, np3], [
    { subject: r, predicate: "rdf:type", object: "owl:Restriction", kind: k },
    { subject: r, predicate: "owl:onProperty", object: pred, kind: k },
    { subject: r, predicate: "owl:someValuesFrom", object: np2.term, kind: k },
    { subject: inter, predicate: "owl:intersectionOf", object: np1.term, kind: k },
    { subject: inter, predicate: "owl:intersectionOf", object: r, kind: k },
    { subject: inter, predicate: "rdfs:subClassOf", object: np3.term, kind: k },
  ]);
}

/** Pattern 5 — "every N has at least|at most|exactly n N2" → cardinality
 *  restriction on `${ns}has` (owl:onClass records the counted class — the
 *  qualified-form question is left as a documented open point, see README). */
function parseCardinality(lexicon, toks, lower, hasIdx) {
  const ns = lexicon.ns;
  let kind = null;
  let nIdx = -1;
  if (lower[hasIdx + 1] === "at" && lower[hasIdx + 2] === "least") { kind = "owl:minCardinality"; nIdx = hasIdx + 3; }
  else if (lower[hasIdx + 1] === "at" && lower[hasIdx + 2] === "most") { kind = "owl:maxCardinality"; nIdx = hasIdx + 3; }
  else if (lower[hasIdx + 1] === "exactly") { kind = "owl:cardinality"; nIdx = hasIdx + 2; }
  else return null;
  const n = numberOf(lower[nIdx]);
  if (n == null || nIdx + 1 >= toks.length) return null;
  const np1 = resolveNP(lexicon, toks.slice(1, hasIdx));
  const np2 = resolveNP(lexicon, toks.slice(nIdx + 1));
  if (np1.term == null || np2.term == null) return missOrNull(PATTERN_CARDINALITY, [np1, np2]);
  if (np1.individual || np2.individual) return null;
  const tag = { "owl:minCardinality": "min", "owl:maxCardinality": "max", "owl:cardinality": "exactly" }[kind];
  const r = `${ns}${tag}-${n}-${local(lexicon, np2.term)}`;
  return hit(PATTERN_CARDINALITY, [np1, np2], [
    { subject: r, predicate: "rdf:type", object: "owl:Restriction", kind },
    { subject: r, predicate: "owl:onProperty", object: `${ns}has`, kind },
    { subject: r, predicate: kind, object: String(n), kind, n },
    { subject: r, predicate: "owl:onClass", object: np2.term, kind },
    { subject: np1.term, predicate: "rdfs:subClassOf", object: r, kind },
  ], { n });
}

/** Patterns 1, 4, 5 and 8's "every …" arm. */
function parseEvery(lexicon, toks, lower) {
  const thatIdx = lower.indexOf("that");
  if (thatIdx > 1) return parseRestriction(lexicon, toks, lower, thatIdx);
  const hasIdx = lower.indexOf("has");
  if (hasIdx > 1 && (lower[hasIdx + 1] === "at" || lower[hasIdx + 1] === "exactly")) {
    return parseCardinality(lexicon, toks, lower, hasIdx);
  }
  const isIdx = lower.indexOf("is");
  if (isIdx <= 1 || isIdx === toks.length - 1) return null;
  const rest = toks.slice(isIdx + 1);
  const everyAdjOnly = rest.length === 1 ? lookupAdjective(lexicon, rest[0]) : null;
  const subjectToks = toks.slice(1, isIdx);
  // Same fold-vs-individual ambiguity parseCopula guards against — a
  // determiner-less "every whiskers is a cat" reaches the identical
  // single-token resolveNP fold ("whiskers" -> "whisker") assertCandidates
  // manufactures as a candidate phrasing whenever the bare payload has no
  // determiner of its own, so this needs the same declineFoldedBareSubject
  // guard or that candidate alone re-opens the bug parseCopula just closed.
  const np1 = declineFoldedBareSubject(
    resolveNP(lexicon, subjectToks, { allowCompound: !everyAdjOnly }), subjectToks, rest[0],
  );
  if (everyAdjOnly) return adjectiveCopula(lexicon, PATTERN_ADJECTIVE, np1, everyAdjOnly);
  const np2 = resolveNP(lexicon, rest, { allowCompound: true });
  if (np1.term == null || np2.term == null) return missOrNull(PATTERN_SUB_CLASS_OF, [np1, np2]);
  if (np1.individual || np2.individual) return null; // "every X is chat.mjs" — not the fragment
  return hit(PATTERN_SUB_CLASS_OF, [np1, np2], [
    { subject: np1.term, predicate: "rdfs:subClassOf", object: np2.term, kind: "rdfs:subClassOf" },
  ]);
}

/** Pattern 6 — "no N1 is a N2" → owl:disjointWith. */
function parseDisjoint(lexicon, toks, lower) {
  const isIdx = lower.indexOf("is");
  if (isIdx <= 1 || isIdx === toks.length - 1) return null;
  const np1 = resolveNP(lexicon, toks.slice(1, isIdx), { allowCompound: true });
  const np2 = resolveNP(lexicon, toks.slice(isIdx + 1), { allowCompound: true });
  if (np1.term == null || np2.term == null) return missOrNull(PATTERN_DISJOINT_WITH, [np1, np2]);
  if (np1.individual || np2.individual) return null;
  return hit(PATTERN_DISJOINT_WITH, [np1, np2], [
    { subject: np1.term, predicate: "owl:disjointWith", object: np2.term, kind: "owl:disjointWith" },
  ]);
}

/** Pattern 7 — "N1's N2 is VALUE" / "the N2 of N1 is VALUE": data or object
 *  property assertion per the possessive noun's DECLARED typing (undeclared
 *  typing defaults to data — a literal value is the honest floor). */
function buildPossessive(lexicon, ownerToks, headToks, valueToks) {
  const ns = lexicon.ns;
  const owner = resolveNP(lexicon, ownerToks);
  if (headToks.length !== 1) return null;
  const head = lookupNoun(lexicon, headToks[0]);
  if (!head) return missOrNull(PATTERN_POSSESSIVE, [owner], [headToks[0]]);
  if (owner.term == null) return missOrNull(PATTERN_POSSESSIVE, [owner]);
  if (!valueToks.length) return null;
  const predicate = `${ns}${head.lemma}`;
  if ((head.property || "data") === "object") {
    const value = resolveNP(lexicon, valueToks);
    if (value.term == null) return missOrNull(PATTERN_POSSESSIVE, [owner, value]);
    return hit(PATTERN_POSSESSIVE, [owner, value], [
      { subject: owner.term, predicate, object: value.term, kind: "owl:ObjectProperty" },
    ]);
  }
  return hit(PATTERN_POSSESSIVE, [owner], [
    { subject: owner.term, predicate, object: valueToks.join(" "), kind: "owl:DatatypeProperty" },
  ]);
}

function parsePossessive(lexicon, toks, lower) {
  const ownerRaw = toks[0].replace(/'s$/i, "");
  const isIdx = lower.indexOf("is");
  if (isIdx < 2 || !ownerRaw) return null;
  return buildPossessive(lexicon, [ownerRaw], toks.slice(1, isIdx), toks.slice(isIdx + 1));
}

function parseOfForm(lexicon, toks, lower) {
  const ofIdx = lower.indexOf("of");
  const isIdx = lower.indexOf("is", ofIdx + 1);
  if (ofIdx < 2 || isIdx < ofIdx + 2) return null;
  return buildPossessive(lexicon, toks.slice(ofIdx + 1, isIdx), toks.slice(1, ofIdx), toks.slice(isIdx + 1));
}

/** Patterns 2 (class assertion), 1's bare-copula variant, and 8's copula arm. */
function parseCopula(lexicon, toks, lower, isIdx) {
  const rest = toks.slice(isIdx + 1);
  if (!rest.length) return null;
  const subjectToks = toks.slice(0, isIdx);
  // parseAce never reaches here for "are", only singular "is" — see
  // declineFoldedBareSubject's own docblock for why a bare single-token
  // subject that only resolves by folding needs this guard.
  const np1 = declineFoldedBareSubject(
    resolveNP(lexicon, subjectToks, { allowCompound: rest.length > 1 }), subjectToks, rest[0],
  );
  if (rest.length === 1) {
    const adj = lookupAdjective(lexicon, rest[0]);
    if (adj) return adjectiveCopula(lexicon, PATTERN_ADJECTIVE, np1, adj);
  }
  const np2 = resolveNP(lexicon, rest, { allowCompound: true });
  if (np1.term == null || np2.term == null) {
    return missOrNull(np1.individual ? PATTERN_TYPE_ASSERTION : PATTERN_SUB_CLASS_OF, [np1, np2]);
  }
  if (np2.individual) return null; // "chat.mjs is sessions.mjs" — identity is not in the fragment
  if (np1.individual) {
    return hit(PATTERN_TYPE_ASSERTION, [np1, np2], [
      { subject: np1.term, predicate: "rdf:type", object: np2.term, kind: "rdf:type" },
    ]);
  }
  return hit(PATTERN_SUB_CLASS_OF, [np1, np2], [
    { subject: np1.term, predicate: "rdfs:subClassOf", object: np2.term, kind: "rdfs:subClassOf" },
  ]);
}

/** Parse one sentence against the 9-pattern ACE-OWL sub-fragment. See the file
 *  header for the result contract; `lexicon` defaults to the committed core
 *  under the library's own neutral DEFAULT_NS ("ex:") when the caller doesn't
 *  supply one. */
export function parseAce(sentence, lexicon = loadLexicon()) {
  const toks = tokenize(sentence);
  if (toks.length < 3) return null;
  const lower = toks.map((t) => t.toLowerCase());
  if (lower[0] === "every") return parseEvery(lexicon, toks, lower);
  if (lower[0] === "no") return parseDisjoint(lexicon, toks, lower);
  if (/'s$/.test(lower[0]) && lower[0].length > 2) return parsePossessive(lexicon, toks, lower);
  if (lower[0] === "the" && lower.includes("of") && lower.includes("is")) {
    return parseOfForm(lexicon, toks, lower);
  }
  const isIdx = lower.indexOf("is");
  if (isIdx > 0) return parseCopula(lexicon, toks, lower, isIdx);
  const canIdx = lower.indexOf("can");
  if (canIdx > 0 && canIdx < toks.length - 1) {
    const cap = parseCapability(lexicon, toks, canIdx);
    if (cap) return cap;
  }
  return parseRelation(lexicon, toks, lower);
}

// ---- the imperative command pattern -----------------------------------------
// A subjectless action command ("go north", "take the key", "unlock the
// cabinet with the key"). Unlike the nine assertion/question patterns above,
// this one produces no OWL triple — an imperative has no truth value to
// assert, it has an ACTION NAME to resolve against the taught action
// families — so parseImperative returns a structured command instead
// (precedent: parseCardinality's own non-triple `n`). It is a separate
// export, never folded into parseAce: every triple pattern requires an
// explicit subject noun phrase, and parseAce's callers expect triples.
//
// The verb set is CLOSED (an unlisted verb is a hard null, never a guess),
// and object phrases resolve through the same lexicon-noun gate as every
// other pattern: a structural fit over an undeclared word rides out as
// `residue` so the caller can name it; a declared word in an unusable shape
// is a hard null.
//
// The leading verb token(s) resolve through three tiers, each a ZERO
// behaviour change over the one before it for anything that already worked:
// an exact IMPERATIVE_VERBS match; failing that, VERB_SYNONYMS (a PHRASING a
// player already means literally — "pick up"/"grab" for "take"), greedy on a
// 2-token prefix before falling back to 1 token; failing that, a bounded
// fuzzy TYPO repair (distance <= 1, via the existing interpret/fuzzy.mjs
// matcher) against the same verb vocabulary. Only the fuzzy tier is a
// correction of an ERROR rather than a recognised alternate wording, so only
// it is reported back on the command (`corrected`) for the caller to name in
// its response — a synonym executes silently, a typo fix does not.

const IMPERATIVE_VERBS = new Set(["go", "take", "drop", "open", "unlock", "close", "give", "look", "talk", "examine", "dig", "eat", "put"]);
const IMPERATIVE_DIRECTIONS = new Set(["north", "south", "east", "west", "up", "down"]);

// The object pronouns an imperative object slot may carry ("examine it", "take
// them", "talk to him"). This parser only MARKS such a slot with the bare
// pronoun as its term — the antecedent lives in the running world, not the
// sentence, so binding it to a concrete object is the adventure lane's job (it
// alone holds the session's FOCUS). Kept out of resolveNP's lexicon gate on
// purpose: a pronoun is never a declared noun, so without this it rides out as
// residue and mis-declines as an unknown word.
export const OBJECT_PRONOUNS = new Set(["it", "them", "him", "her"]);

const VERB_SYNONYMS = new Map([
  ["pick up", "take"], ["pick", "take"], ["grab", "take"],
  ["put down", "drop"], ["set down", "drop"], ["leave", "drop"],
  ["talk to", "talk"], ["speak to", "talk"], ["speak with", "talk"], ["talk", "talk"], ["speak", "talk"],
  ["chat with", "talk"], ["converse with", "talk"],
  ["look at", "examine"], ["examine", "examine"], ["inspect", "examine"],
  ["have a look at", "examine"], ["take a look at", "examine"], ["check out", "examine"],
  ["shut", "close"],
]);
// The longest entry's token count — resolveImperativeVerb tries prefixes
// longest-first down to 2, so a multi-word idiom ("have a look at") is
// consumed whole before any shorter prefix inside it gets a chance to match.
const VERB_SYNONYM_MAX_PREFIX = Math.max(...[...VERB_SYNONYMS.keys()].map((k) => k.split(" ").length));

// Every leading SURFACE word the exact tiers below recognise as the start of
// a command: a bare IMPERATIVE_VERBS word, or the first token of any
// VERB_SYNONYMS key (single- or multi-word alike — "pick", "have", "chat" are
// each only ever a key's own first word, never a key on their own, so they'd
// otherwise have nothing to fuzzy-repair a typo onto). Corrects the SURFACE
// word, not the canonical verb, so the existing exact-match tiers below (in
// particular the multi-word prefix loop) still resolve the rest of the phrase
// after repair — "hav a look at" -> "have a look at" -> examine, not just "look".
const VERB_SURFACE_WORDS = [...new Set([...IMPERATIVE_VERBS, ...[...VERB_SYNONYMS.keys()].map((k) => k.split(" ")[0])])];
const IMPERATIVE_FUZZY_BOUND = 1; // this project's existing distance-1 tolerance elsewhere (interpret/fuzzy.mjs)

// A small, hand-checked exemption (same idiom as this file's own
// NEVER_CANONICALIZE): common English words one edit from a closed verb, that
// mean something else entirely and would otherwise get silently reinterpreted
// and EXECUTED as that verb ("wake"/"make" -> "take" would actually take an
// object; "walk" -> "talk" is the same shape and breaks a real command).
// Checked against this repo's own WordNet corpus, not guessed.
const NEVER_FUZZY_VERB = new Set(["walk", "wake", "make"]);

/** The three deterministic (non-fuzzy) tiers: a 2+-token VERB_SYNONYMS prefix
 *  FIRST (so "talk to"/"look at" resolve as themselves rather than as the
 *  bare exact verbs "talk"/"look" they'd otherwise short-circuit on, leaving
 *  their "to"/"at" stranded in the object phrase), then an exact
 *  IMPERATIVE_VERBS match, then the 1-token VERB_SYNONYMS form. `consumed` is
 *  how many leading tokens the match ate. Null when none of the three match. */
function exactImperativeVerb(toks) {
  const first = toks[0].toLowerCase();
  const lower = toks.map((t) => t.toLowerCase());
  for (let n = Math.min(VERB_SYNONYM_MAX_PREFIX, toks.length); n >= 2; n -= 1) {
    const hit = VERB_SYNONYMS.get(lower.slice(0, n).join(" "));
    if (hit) return { verb: hit, consumed: n };
  }
  if (IMPERATIVE_VERBS.has(first)) return { verb: first, consumed: 1 };
  const oneHit = VERB_SYNONYMS.get(first);
  if (oneHit) return { verb: oneHit, consumed: 1 };
  return null;
}

/** Resolve the leading verb token(s) to a canonical, recognised verb: the
 *  three exact tiers above, failing that a bounded fuzzy TYPO repair
 *  (distance <= 1, via the existing interpret/fuzzy.mjs matcher) of the
 *  leading token against every recognised surface word, single- or
 *  multi-word idiom alike, then the exact tiers retried against the
 *  corrected token — so a typo'd idiom lead word ("hav a look at") is
 *  repaired to its real word first ("have a look at") and still resolves the
 *  whole idiom, not just a bare-verb guess. Only the fuzzy tier is a
 *  correction of an ERROR rather than a recognised alternate wording, so only
 *  it is reported back on the command (`corrected`) for the caller to name in
 *  its response — a synonym executes silently, a typo fix does not. */
function resolveImperativeVerb(toks) {
  const exact = exactImperativeVerb(toks);
  if (exact) return { ...exact, corrected: null };
  const first = toks[0].toLowerCase();
  if (NEVER_FUZZY_VERB.has(first)) return null;
  const fixedFirst = fuzzyMatchInSet(first, VERB_SURFACE_WORDS, IMPERATIVE_FUZZY_BOUND);
  if (!fixedFirst) return null;
  const retried = exactImperativeVerb([fixedFirst, ...toks.slice(1)]);
  if (!retried) return null;
  return { ...retried, corrected: { from: first, to: fixedFirst } };
}

/** Resolve one imperative object phrase to its bare lexicon term. A lone
 *  object pronoun ("it", "them", "him", "her") rides through as its own term
 *  for the lane to bind against the session focus — never a lexicon lookup,
 *  never residue. */
function imperativeNP(lexicon, tokens) {
  if (tokens.length === 1 && OBJECT_PRONOUNS.has(tokens[0].toLowerCase())) {
    return { term: tokens[0].toLowerCase(), unknown: [] };
  }
  const np = resolveNP(lexicon, tokens);
  if (np.term == null) return { term: null, unknown: np.unknown };
  return { term: local(lexicon, np.term), unknown: [] };
}

/**
 * Parse one imperative command against the closed verb set (plus its
 * tolerated synonyms and typo repairs). Returns `{ pattern: "imperative",
 * verb, residue, corrected?, object?, indirectObject?, instrument?,
 * direction? }`, a residue-carrying miss for a structural fit over
 * undeclared words (`residue` non-empty, no slots), or null when the
 * sentence is not an imperative of this fragment at all. `corrected`, when
 * present, is the list of `{ from, to }` typo repairs the fuzzy tier made —
 * the caller's cue to say what it read the line as, so a genuine miss is
 * never confused with a silent auto-correct.
 */
export function parseImperative(sentence, lexicon = loadLexicon()) {
  const toks = tokenize(sentence);
  if (!toks.length) return null;
  const resolved = resolveImperativeVerb(toks);
  if (!resolved) return null;
  const verb = resolved.verb;
  const rest = toks.slice(resolved.consumed);
  const lower = rest.map((t) => t.toLowerCase());
  const corrected = resolved.corrected ? [resolved.corrected] : [];
  const command = (fields) => ({
    pattern: "imperative", verb, residue: [],
    ...(corrected.length ? { corrected } : {}),
    ...fields,
  });
  const miss = (unknown) => (unknown.length
    ? { pattern: "imperative", verb, residue: unknown, ...(corrected.length ? { corrected } : {}) }
    : null);

  if (verb === "look") {
    if (!rest.length || (rest.length === 1 && lower[0] === "around")) return command({});
    // "look <object>" — a bare noun after look reads as a close look at that
    // thing, routed through the same object handler examine/talk share (which
    // resolves presence and declines an absent thing by name). "look at <x>"
    // never reaches here — its 2-token synonym prefix already resolved to
    // examine — so this arm only ever sees the bare-noun form.
    const object = imperativeNP(lexicon, rest);
    if (object.term == null) return miss(object.unknown);
    return command({ object: object.term });
  }
  if (verb === "examine" || verb === "talk" || verb === "eat") {
    if (!rest.length) return null;
    const object = imperativeNP(lexicon, rest);
    if (object.term == null) return miss(object.unknown);
    return command({ object: object.term });
  }
  if (verb === "go" || verb === "dig") {
    if (rest.length === 1) {
      if (IMPERATIVE_DIRECTIONS.has(lower[0])) return command({ direction: lower[0] });
      const fuzzyDir = fuzzyMatchInSet(lower[0], [...IMPERATIVE_DIRECTIONS], IMPERATIVE_FUZZY_BOUND);
      if (fuzzyDir) {
        corrected.push({ from: lower[0], to: fuzzyDir });
        return command({ direction: fuzzyDir });
      }
    }
    return null;
  }
  if (verb === "give") {
    const toIdx = lower.indexOf("to");
    if (toIdx < 1 || toIdx === rest.length - 1) return null;
    const object = imperativeNP(lexicon, rest.slice(0, toIdx));
    const indirect = imperativeNP(lexicon, rest.slice(toIdx + 1));
    if (object.term == null || indirect.term == null) return miss([...object.unknown, ...indirect.unknown]);
    return command({ object: object.term, indirectObject: indirect.term });
  }
  if (verb === "put") {
    const inIdx = lower.indexOf("in");
    if (inIdx < 1 || inIdx === rest.length - 1) return null;
    const object = imperativeNP(lexicon, rest.slice(0, inIdx));
    const container = imperativeNP(lexicon, rest.slice(inIdx + 1));
    if (object.term == null || container.term == null) return miss([...object.unknown, ...container.unknown]);
    return command({ object: object.term, indirectObject: container.term });
  }
  if (verb === "unlock") {
    const withIdx = lower.indexOf("with");
    if (withIdx !== -1) {
      if (withIdx < 1 || withIdx === rest.length - 1) return null;
      const object = imperativeNP(lexicon, rest.slice(0, withIdx));
      const instrument = imperativeNP(lexicon, rest.slice(withIdx + 1));
      if (object.term == null || instrument.term == null) return miss([...object.unknown, ...instrument.unknown]);
      return command({ object: object.term, instrument: instrument.term });
    }
    // fall through to the plain-object arm: "unlock the cabinet" is a valid
    // command whose missing instrument is the CALLER's precondition to name.
  }
  if (!rest.length) return null;
  const object = imperativeNP(lexicon, rest);
  if (object.term == null) return miss(object.unknown);
  return command({ object: object.term });
}

/** Pattern 9 — "N can VERB" → mgx:capableOf. The modal is not a relation
 *  verb: without this, parseRelation reads "can" through lookupVerb and
 *  asserts a generic object property ("dog cans swim") that no capability
 *  reader ever finds. Returns null (never a miss record) unless BOTH sides
 *  resolve, so a noun "can" ("trash can holds garbage") still falls through
 *  to parseRelation. "cannot"/"can't" stays unparsed — the fact vocabulary
 *  has no negative-capability predicate, and a silently dropped negation
 *  would invert the taught meaning. */
function parseCapability(lexicon, toks, canIdx) {
  const np1 = resolveNP(lexicon, toks.slice(0, canIdx), { allowCompound: true });
  if (np1.term == null) return null;
  // The capability's object is a VERB ("swim"), not a lexicon noun, so
  // resolveNP is the wrong resolver for it: accept exactly one bare word,
  // stored as a plain term — the same grain the corpus's own CapableOf
  // objects ("bark", "run") already use.
  const rest = toks.slice(canIdx + 1);
  if (rest.length !== 1 || !/^[a-z][a-z-]*$/i.test(rest[0])) return null;
  return hit(PATTERN_CAPABILITY, [np1], [
    { subject: np1.term, predicate: "mgx:capableOf", object: `${lexicon.ns}${rest[0].toLowerCase()}`, kind: "mgx:capableOf" },
  ]);
}
