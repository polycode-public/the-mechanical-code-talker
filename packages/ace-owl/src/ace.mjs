// ace.mjs — a deterministic recursive-descent parser over 8 controlled-
// English sentence patterns (a small sub-fragment inspired by Attempto
// Controlled English / ACE — see README.md's pattern table), turning
// controlled-English sentences into a NEUTRAL OWL-labelled triple shape. No
// NLP dependency: tokenization is whitespace + one trailing-punctuation
// strip, morphology is the lexicon's suffix fold (lexicon.mjs). Fitting a
// pattern is a strong signal; missing is a FEATURE — parseAce returns null
// (or an empty-triples result carrying the unknown words as `residue`), and
// it is the CALLER's job to fall through to a more tolerant strategy.
//
// parseAce(sentence, lexicon) → { pattern, triples, residue } | null
//   pattern  one of the PATTERNS below (also exported individually).
//   triples  [{ subject, predicate, object, kind, n? }] — OWL-labelled
//            string triples in the library's neutral interchange shape. A
//            consumer that stores or reasons over these normalizes them on
//            its own side (CURIE-stripping, content-addressing, …) — this
//            library only emits stable, deterministic strings.
//   residue  [] on a clean parse; the unknown tokens when the sentence FITS a
//            pattern structurally but uses undeclared words (triples is then
//            empty — feeds a "did you mean X…" surround, left to the caller).
//   null     the sentence does not fit the fragment at all.
//
// Namespace: classes/individuals are minted as `${lexicon.ns}<lexeme>` CURIEs
// (lexicon lemma for nouns, canonical spelling for proper names, the literal
// token for code-shaped references like chat.mjs); predicates are the
// OWL/RDF(S) vocabulary terms or the lexicon verb's `${lexicon.ns}<3sg>`
// predicate (lexicon.mjs's predicateOf). Restriction and intersection class
// expressions get READABLE deterministic node names (`${ns}some-imports-
// test`, `${ns}module-that-imports-test`) instead of blank nodes, so the same
// sentence always re-emits the same triples and a content-addressed store
// stays idempotent. An intersection is flattened to repeated
// owl:intersectionOf triples (one per member) — the flat-JSON stand-in for an
// RDF list. `lexicon.ns` defaults to lexicon.mjs's DEFAULT_NS ("ex:") when a
// caller's loadLexicon() call didn't set one; every term this module mints is
// namespaced off `lexicon.ns`, never a hardcoded prefix — the seam that makes
// the SAME implementation usable by any downstream project (see README.md).

import {
  loadLexicon, lookupNoun, lookupVerb, lookupAdjective, lookupProperName,
  predicateOf, numberOf, classify,
} from "./lexicon.mjs";

export const PATTERN_SUB_CLASS_OF = "subClassOf";
export const PATTERN_TYPE_ASSERTION = "typeAssertion";
export const PATTERN_RELATION = "relation";
export const PATTERN_SOME_VALUES_FROM = "someValuesFrom";
export const PATTERN_CARDINALITY = "cardinality";
export const PATTERN_DISJOINT_WITH = "disjointWith";
export const PATTERN_POSSESSIVE = "possessive";
export const PATTERN_ADJECTIVE = "adjective";

/** The pattern field's full domain, in the README's table order. */
export const PATTERNS = Object.freeze([
  PATTERN_SUB_CLASS_OF, PATTERN_TYPE_ASSERTION, PATTERN_RELATION, PATTERN_SOME_VALUES_FROM,
  PATTERN_CARDINALITY, PATTERN_DISJOINT_WITH, PATTERN_POSSESSIVE, PATTERN_ADJECTIVE,
]);

const DET = new Set(["a", "an", "the"]);
// A token SHAPED like a code reference (a path, file, symbol or CURIE) is an
// individual by form — a deterministic tokenizer rule, not a guess: declared
// proper names cover words; this covers chat.mjs, src/ask.mjs, Foo#bar.
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
 *  pattern-8 adjective triples (subclass axioms / hasValue restriction). */
function resolveNP(lexicon, tokensIn) {
  const ns = lexicon.ns;
  const tokens = stripDet(tokensIn);
  if (tokens.length === 1) {
    const t = tokens[0];
    const proper = lookupProperName(lexicon, t);
    if (proper) return { term: `${ns}${proper}`, individual: true, extras: [], unknown: [] };
    if (CODE_REF.test(t)) return { term: `${ns}${t}`, individual: true, extras: [], unknown: [] };
    const noun = lookupNoun(lexicon, t);
    if (noun) return { term: `${ns}${noun.lemma}`, individual: false, noun, extras: [], unknown: [] };
    return { term: null, individual: false, extras: [], unknown: [t] };
  }
  if (tokens.length === 2) {
    const adj = lookupAdjective(lexicon, tokens[0]);
    const noun = lookupNoun(lexicon, tokens[1]);
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
  const np1 = resolveNP(lexicon, toks.slice(1, isIdx));
  const rest = toks.slice(isIdx + 1);
  if (rest.length === 1) {
    const adj = lookupAdjective(lexicon, rest[0]);
    if (adj) return adjectiveCopula(lexicon, PATTERN_ADJECTIVE, np1, adj);
  }
  const np2 = resolveNP(lexicon, rest);
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
  const np1 = resolveNP(lexicon, toks.slice(1, isIdx));
  const np2 = resolveNP(lexicon, toks.slice(isIdx + 1));
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
  const np1 = resolveNP(lexicon, toks.slice(0, isIdx));
  const rest = toks.slice(isIdx + 1);
  if (!rest.length) return null;
  if (rest.length === 1) {
    const adj = lookupAdjective(lexicon, rest[0]);
    if (adj) return adjectiveCopula(lexicon, PATTERN_ADJECTIVE, np1, adj);
  }
  const np2 = resolveNP(lexicon, rest);
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

/** Parse one sentence against the 8-pattern ACE-OWL sub-fragment. See the file
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
  return parseRelation(lexicon, toks, lower);
}
