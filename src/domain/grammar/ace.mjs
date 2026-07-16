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
//   pattern  one of the PATTERNS below (also exported individually).
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

// "a"/"an" are the only ACE determiners that are grammatically SINGULAR-ONLY —
// "the" and a bare/no determiner are number-neutral (see resolveNP's
// singularOnly below, and lexicon.mjs's lookupNoun doc for what this prunes).
const SINGULAR_ONLY_DET = new Set(["a", "an"]);

export const PATTERN_SUB_CLASS_OF = "subClassOf";
export const PATTERN_TYPE_ASSERTION = "typeAssertion";
export const PATTERN_RELATION = "relation";
export const PATTERN_SOME_VALUES_FROM = "someValuesFrom";
export const PATTERN_CARDINALITY = "cardinality";
export const PATTERN_DISJOINT_WITH = "disjointWith";
export const PATTERN_POSSESSIVE = "possessive";
export const PATTERN_ADJECTIVE = "adjective";
export const PATTERN_CAPABILITY = "capability";

/** The pattern field's full domain, in the README's table order. */
export const PATTERNS = Object.freeze([
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
    if (noun) return { term: `${ns}${noun.lemma}`, individual: false, noun, extras: [], unknown: [] };
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
  const np1 = resolveNP(lexicon, toks.slice(1, isIdx), { allowCompound: !everyAdjOnly });
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
  const np1 = resolveNP(lexicon, toks.slice(0, isIdx), { allowCompound: rest.length > 1 });
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
