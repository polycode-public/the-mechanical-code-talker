// grammar/ace.mjs — tmct's deterministic ACE-OWL sub-fragment parser (ROADMAP
// Phase 2, item 2). Implements the 8 controlled-English sentence patterns of
// docs/references/schemas/ace-owl-fragment.md and nothing more: fitting the
// grammar is a strong signal, missing it is a FEATURE — parseAce returns null
// (or an empty-triples result carrying the unknown words as `residue`) and the
// interpretation pipeline (src/interpret/) falls through to the tolerant
// strategies. No NLP dependency: tokenization is whitespace + trailing
// punctuation, morphology is the lexicon's suffix fold.
//
// parseAce(sentence, lexicon) → { pattern, triples, residue } | null
//   pattern  one of: subClassOf | typeAssertion | relation | someValuesFrom |
//            cardinality | disjointWith | possessive | adjective
//   triples  [{ subject, predicate, object, kind, n? }] — OWL-labelled string
//            triples shaped for src/memory/core.mjs's appendFact (which
//            normalizes subject/object via normFactTerm: "tmct:module" is
//            stored as "module"; the predicate keeps its vocabulary casing).
//   residue  [] on a clean parse; the unknown tokens when the sentence FITS a
//            pattern structurally but uses undeclared words (triples is then
//            empty — feeds the pipeline's "if you mean X…" surround).
//   null     the sentence does not fit the fragment at all.
//
// Term style: classes/individuals are `tmct:<lexeme>` CURIEs (lexicon lemma
// for nouns, canonical spelling for proper names, the literal token for
// code-shaped references like chat.mjs); predicates are the OWL/RDF(S)
// vocabulary terms or the lexicon verb's tmct:<3sg> predicate. Restriction
// and intersection class expressions get READABLE deterministic node names
// (tmct:some-imports-test, tmct:module-that-imports-test) instead of blank
// nodes, so the same sentence always re-emits the same triples and appendFact
// stays idempotent. An intersection is flattened to repeated
// owl:intersectionOf triples (one per member) — the flat-JSON stand-in for an
// RDF list, documented in ontology/tmct-core.ttl.

import {
  loadLexicon, lookupNoun, lookupVerb, lookupAdjective, lookupProperName,
  predicateOf, numberOf, classify,
} from "./lexicon.mjs";

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

const local = (term) => String(term).replace(/^tmct:/, "");

const stripDet = (tokens) =>
  tokens.length > 1 && DET.has(tokens[0].toLowerCase()) ? tokens.slice(1) : tokens;

/** Resolve a 1–2 word noun phrase: PROPERNAME | code-ref | NOUN | ADJ NOUN.
 *  Returns { term, individual, extras, unknown } — `term` null on a miss with
 *  the undeclared tokens in `unknown` (empty `unknown` = structurally
 *  unparseable phrase → the caller returns a hard null). `extras` carries the
 *  pattern-8 adjective triples (subclass axioms / hasValue restriction). */
function resolveNP(lexicon, tokensIn) {
  const tokens = stripDet(tokensIn);
  if (tokens.length === 1) {
    const t = tokens[0];
    const proper = lookupProperName(lexicon, t);
    if (proper) return { term: `tmct:${proper}`, individual: true, extras: [], unknown: [] };
    if (CODE_REF.test(t)) return { term: `tmct:${t}`, individual: true, extras: [], unknown: [] };
    const noun = lookupNoun(lexicon, t);
    if (noun) return { term: `tmct:${noun.lemma}`, individual: false, noun, extras: [], unknown: [] };
    return { term: null, individual: false, extras: [], unknown: [t] };
  }
  if (tokens.length === 2) {
    const adj = lookupAdjective(lexicon, tokens[0]);
    const noun = lookupNoun(lexicon, tokens[1]);
    if (adj && noun) {
      const term = `tmct:${adj.lemma}-${noun.lemma}`;
      const extras = [
        { subject: term, predicate: "rdfs:subClassOf", object: `tmct:${noun.lemma}`, kind: "rdfs:subClassOf" },
      ];
      if (adj.type === "subclass") {
        // the adjective itself denotes a class: legacy-module ⊑ module, ⊑ legacy
        extras.push({ subject: term, predicate: "rdfs:subClassOf", object: `tmct:${adj.lemma}`, kind: "rdfs:subClassOf" });
      } else {
        // data adjective: subclass-with-restriction on the boolean-ish property
        const r = `tmct:has-${adj.lemma}`;
        extras.push(
          { subject: r, predicate: "rdf:type", object: "owl:Restriction", kind: "owl:hasValue" },
          { subject: r, predicate: "owl:onProperty", object: adj.property || `tmct:${adj.lemma}`, kind: "owl:hasValue" },
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
    if (np1.term == null || np2.term == null) return missOrNull("relation", [np1, np2]);
    return hit("relation", [np1, np2], [
      { subject: np1.term, predicate: predicateOf(verb), object: np2.term, kind: "owl:ObjectProperty" },
    ]);
  }
  const content = toks.filter((t) => !DET.has(t.toLowerCase()));
  if (content.length === 3 && !classify(content[1], lexicon)) {
    const np1 = resolveNP(lexicon, [content[0]]);
    const np2 = resolveNP(lexicon, [content[2]]);
    if (np1.term != null && np2.term != null) return { pattern: "relation", triples: [], residue: [content[1]] };
  }
  return null;
}

/** Pattern 8 (copula arm) — "X is ADJ": data adjective → datatype-property
 *  assertion; subclass adjective → rdf:type (individual) / rdfs:subClassOf. */
function adjectiveCopula(pattern, np1, adj) {
  if (np1.term == null) return missOrNull(pattern, [np1]);
  if (adj.type === "data") {
    return hit(pattern, [np1], [
      { subject: np1.term, predicate: adj.property || `tmct:${adj.lemma}`, object: adj.value ?? "true", kind: "owl:DatatypeProperty" },
    ]);
  }
  const predicate = np1.individual ? "rdf:type" : "rdfs:subClassOf";
  return hit(pattern, [np1], [
    { subject: np1.term, predicate, object: `tmct:${adj.lemma}`, kind: predicate },
  ]);
}

/** Pattern 4 — "every N1 that VERBs a N2 is a N3" → someValuesFrom restriction:
 *  (N1 ⊓ ∃VERB.N2) ⊑ N3, flattened onto readable deterministic node names. */
function parseRestriction(lexicon, toks, lower, thatIdx) {
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
  if (!verb) return missOrNull("someValuesFrom", [np1, np2, np3], [toks[thatIdx + 1]]);
  if (np1.term == null || np2.term == null || np3.term == null) {
    return missOrNull("someValuesFrom", [np1, np2, np3]);
  }
  if (np1.individual || np2.individual || np3.individual) return null; // class-level pattern only
  const pred = predicateOf(verb);
  const k = "owl:someValuesFrom";
  const r = `tmct:some-${local(pred)}-${local(np2.term)}`;
  const inter = `tmct:${local(np1.term)}-that-${local(pred)}-${local(np2.term)}`;
  return hit("someValuesFrom", [np1, np2, np3], [
    { subject: r, predicate: "rdf:type", object: "owl:Restriction", kind: k },
    { subject: r, predicate: "owl:onProperty", object: pred, kind: k },
    { subject: r, predicate: "owl:someValuesFrom", object: np2.term, kind: k },
    { subject: inter, predicate: "owl:intersectionOf", object: np1.term, kind: k },
    { subject: inter, predicate: "owl:intersectionOf", object: r, kind: k },
    { subject: inter, predicate: "rdfs:subClassOf", object: np3.term, kind: k },
  ]);
}

/** Pattern 5 — "every N has at least|at most|exactly n N2" → cardinality
 *  restriction on tmct:has (owl:onClass records the counted class — the
 *  qualified-form question is noted in docs/references/schemas/owl2-vocabulary.md). */
function parseCardinality(lexicon, toks, lower, hasIdx) {
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
  if (np1.term == null || np2.term == null) return missOrNull("cardinality", [np1, np2]);
  if (np1.individual || np2.individual) return null;
  const tag = { "owl:minCardinality": "min", "owl:maxCardinality": "max", "owl:cardinality": "exactly" }[kind];
  const r = `tmct:${tag}-${n}-${local(np2.term)}`;
  return hit("cardinality", [np1, np2], [
    { subject: r, predicate: "rdf:type", object: "owl:Restriction", kind },
    { subject: r, predicate: "owl:onProperty", object: "tmct:has", kind },
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
    if (adj) return adjectiveCopula("adjective", np1, adj);
  }
  const np2 = resolveNP(lexicon, rest);
  if (np1.term == null || np2.term == null) return missOrNull("subClassOf", [np1, np2]);
  if (np1.individual || np2.individual) return null; // "every X is chat.mjs" — not the fragment
  return hit("subClassOf", [np1, np2], [
    { subject: np1.term, predicate: "rdfs:subClassOf", object: np2.term, kind: "rdfs:subClassOf" },
  ]);
}

/** Pattern 6 — "no N1 is a N2" → owl:disjointWith. */
function parseDisjoint(lexicon, toks, lower) {
  const isIdx = lower.indexOf("is");
  if (isIdx <= 1 || isIdx === toks.length - 1) return null;
  const np1 = resolveNP(lexicon, toks.slice(1, isIdx));
  const np2 = resolveNP(lexicon, toks.slice(isIdx + 1));
  if (np1.term == null || np2.term == null) return missOrNull("disjointWith", [np1, np2]);
  if (np1.individual || np2.individual) return null;
  return hit("disjointWith", [np1, np2], [
    { subject: np1.term, predicate: "owl:disjointWith", object: np2.term, kind: "owl:disjointWith" },
  ]);
}

/** Pattern 7 — "N1's N2 is VALUE" / "the N2 of N1 is VALUE": data or object
 *  property assertion per the possessive noun's DECLARED typing (undeclared
 *  typing defaults to data — a literal value is the honest floor). */
function buildPossessive(lexicon, ownerToks, headToks, valueToks) {
  const owner = resolveNP(lexicon, ownerToks);
  if (headToks.length !== 1) return null;
  const head = lookupNoun(lexicon, headToks[0]);
  if (!head) return missOrNull("possessive", [owner], [headToks[0]]);
  if (owner.term == null) return missOrNull("possessive", [owner]);
  if (!valueToks.length) return null;
  const predicate = `tmct:${head.lemma}`;
  if ((head.property || "data") === "object") {
    const value = resolveNP(lexicon, valueToks);
    if (value.term == null) return missOrNull("possessive", [owner, value]);
    return hit("possessive", [owner, value], [
      { subject: owner.term, predicate, object: value.term, kind: "owl:ObjectProperty" },
    ]);
  }
  return hit("possessive", [owner], [
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
    if (adj) return adjectiveCopula("adjective", np1, adj);
  }
  const np2 = resolveNP(lexicon, rest);
  if (np1.term == null || np2.term == null) {
    return missOrNull(np1.individual ? "typeAssertion" : "subClassOf", [np1, np2]);
  }
  if (np2.individual) return null; // "chat.mjs is sessions.mjs" — identity is not in the fragment
  if (np1.individual) {
    return hit("typeAssertion", [np1, np2], [
      { subject: np1.term, predicate: "rdf:type", object: np2.term, kind: "rdf:type" },
    ]);
  }
  return hit("subClassOf", [np1, np2], [
    { subject: np1.term, predicate: "rdfs:subClassOf", object: np2.term, kind: "rdfs:subClassOf" },
  ]);
}

/** Parse one sentence against the 8-pattern ACE-OWL sub-fragment. See the file
 *  header for the result contract; `lexicon` defaults to the committed core. */
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
