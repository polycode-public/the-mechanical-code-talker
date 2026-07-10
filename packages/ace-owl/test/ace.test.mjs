// ace.mjs tests — the 8-pattern ACE-OWL sub-fragment round-trips (sentence →
// expected OWL-labelled triples), the null-is-a-feature misses (generalized
// quantifiers, questions, undeclared verbs), residue naming unknown tokens,
// case/whitespace tolerance, and namespace injection. Pattern numbers refer
// to README.md's pattern table. Ported/adapted from tmct's own
// test/grammar-ace.test.mjs at extraction time (see README.md's Provenance).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAce, tokenize, PATTERNS, PATTERN_SUB_CLASS_OF, PATTERN_RELATION } from "../src/ace.mjs";
import { loadLexicon, DEFAULT_NS } from "../src/lexicon.mjs";

const triplesOf = (r) => r.triples.map((t) => [t.subject, t.predicate, t.object]);

test("pattern 1: 'every N1 is a N2' → rdfs:subClassOf, under the default neutral namespace", () => {
  const r = parseAce("every module is a unit");
  assert.equal(r.pattern, "subClassOf");
  assert.equal(r.pattern, PATTERN_SUB_CLASS_OF);
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: `${DEFAULT_NS}module`, predicate: "rdfs:subClassOf", object: `${DEFAULT_NS}unit`, kind: "rdfs:subClassOf" },
  ]);
});

test("pattern 2: 'PROPERNAME is a N' → rdf:type class assertion (declared name and code-shaped ref)", () => {
  const r1 = parseAce("Seonix is a project", loadLexicon({ properNames: ["Seonix"], nouns: { project: {} } }));
  assert.equal(r1.pattern, "typeAssertion");
  assert.deepEqual(r1.triples, [
    { subject: "ex:Seonix", predicate: "rdf:type", object: "ex:project", kind: "rdf:type" },
  ]);
  const r2 = parseAce("chat.mjs is a module");
  assert.deepEqual(r2.triples, [
    { subject: "ex:chat.mjs", predicate: "rdf:type", object: "ex:module", kind: "rdf:type" },
  ]);
});

test("pattern 3: 'N1 VERB N2' → object-property assertion, predicate from the verb lexicon", () => {
  const r = parseAce("modules import tests");
  assert.equal(r.pattern, PATTERN_RELATION);
  assert.deepEqual(r.triples, [
    { subject: "ex:module", predicate: "ex:imports", object: "ex:test", kind: "owl:ObjectProperty" },
  ]);
  const det = parseAce("the parser uses the lexicon");
  assert.deepEqual(triplesOf(det), [["ex:parser", "ex:uses", "ex:lexicon"]]);
});

test("pattern 3: proper-name forms and verb+preposition ('depends on' → ex:dependsOn)", () => {
  const r = parseAce("chat.mjs depends on sessions.mjs");
  assert.equal(r.pattern, "relation");
  assert.deepEqual(r.triples, [
    { subject: "ex:chat.mjs", predicate: "ex:dependsOn", object: "ex:sessions.mjs", kind: "owl:ObjectProperty" },
  ]);
  assert.equal(parseAce("chat.mjs depends sessions.mjs"), null, "a declared preposition is required, not optional");
});

test("pattern 4: 'every N1 that VERBs a N2 is a N3' → someValuesFrom restriction, deterministic node names", () => {
  const r = parseAce("every module that imports a database is a service");
  assert.equal(r.pattern, "someValuesFrom");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "ex:some-imports-database", predicate: "rdf:type", object: "owl:Restriction", kind: "owl:someValuesFrom" },
    { subject: "ex:some-imports-database", predicate: "owl:onProperty", object: "ex:imports", kind: "owl:someValuesFrom" },
    { subject: "ex:some-imports-database", predicate: "owl:someValuesFrom", object: "ex:database", kind: "owl:someValuesFrom" },
    { subject: "ex:module-that-imports-database", predicate: "owl:intersectionOf", object: "ex:module", kind: "owl:someValuesFrom" },
    { subject: "ex:module-that-imports-database", predicate: "owl:intersectionOf", object: "ex:some-imports-database", kind: "owl:someValuesFrom" },
    { subject: "ex:module-that-imports-database", predicate: "rdfs:subClassOf", object: "ex:service", kind: "owl:someValuesFrom" },
  ]);
});

test("pattern 5: 'every N has at least|at most|exactly n N2' → the three cardinality kinds, n carried", () => {
  const min = parseAce("every module has at least 1 test");
  assert.equal(min.pattern, "cardinality");
  assert.equal(min.n, 1);
  assert.deepEqual(min.triples, [
    { subject: "ex:min-1-test", predicate: "rdf:type", object: "owl:Restriction", kind: "owl:minCardinality" },
    { subject: "ex:min-1-test", predicate: "owl:onProperty", object: "ex:has", kind: "owl:minCardinality" },
    { subject: "ex:min-1-test", predicate: "owl:minCardinality", object: "1", kind: "owl:minCardinality", n: 1 },
    { subject: "ex:min-1-test", predicate: "owl:onClass", object: "ex:test", kind: "owl:minCardinality" },
    { subject: "ex:module", predicate: "rdfs:subClassOf", object: "ex:min-1-test", kind: "owl:minCardinality" },
  ]);
  const max = parseAce("every class has at most 3 dependencies");
  assert.equal(max.triples.find((t) => t.n != null).predicate, "owl:maxCardinality");
  assert.equal(max.triples.find((t) => t.predicate === "owl:onClass").object, "ex:dependency");
  const exact = parseAce("every repository has exactly one license");
  assert.equal(exact.n, 1, "number words accepted");
  assert.equal(exact.triples.find((t) => t.n != null).predicate, "owl:cardinality");
});

test("pattern 6: 'no N1 is a N2' → owl:disjointWith", () => {
  const r = parseAce("no test is a module");
  assert.equal(r.pattern, "disjointWith");
  assert.deepEqual(r.triples, [
    { subject: "ex:test", predicate: "owl:disjointWith", object: "ex:module", kind: "owl:disjointWith" },
  ]);
});

test("pattern 7: possessive with a data-typed noun → owl:DatatypeProperty, literal value verbatim", () => {
  const lex = loadLexicon({ properNames: ["Tmct"] });
  const r = parseAce("Tmct's license is MPL-2.0", lex);
  assert.equal(r.pattern, "possessive");
  assert.deepEqual(r.triples, [
    { subject: "ex:Tmct", predicate: "ex:license", object: "MPL-2.0", kind: "owl:DatatypeProperty" },
  ]);
  const of = parseAce("the version of Tmct is 0.2.0", lex);
  assert.deepEqual(of.triples, [
    { subject: "ex:Tmct", predicate: "ex:version", object: "0.2.0", kind: "owl:DatatypeProperty" },
  ]);
});

test("pattern 7: possessive with an object-typed noun → owl:ObjectProperty, value resolved to a term", () => {
  const r = parseAce("chat.mjs's owner is Polycode");
  assert.equal(r.pattern, "possessive");
  assert.deepEqual(r.triples, [
    { subject: "ex:chat.mjs", predicate: "ex:owner", object: "ex:Polycode", kind: "owl:ObjectProperty" },
  ]);
});

test("pattern 8: subclass-forming adjective as modifier → ADJ-N ⊑ N and ⊑ ADJ", () => {
  const r = parseAce("every legacy module is a risk");
  assert.equal(r.pattern, "subClassOf");
  assert.deepEqual(r.triples, [
    { subject: "ex:legacy-module", predicate: "rdfs:subClassOf", object: "ex:module", kind: "rdfs:subClassOf" },
    { subject: "ex:legacy-module", predicate: "rdfs:subClassOf", object: "ex:legacy", kind: "rdfs:subClassOf" },
    { subject: "ex:legacy-module", predicate: "rdfs:subClassOf", object: "ex:risk", kind: "rdfs:subClassOf" },
  ]);
});

test("pattern 8: data-typed adjective as modifier → subclass-with-hasValue restriction", () => {
  const r = parseAce("every flaky test is a risk");
  assert.deepEqual(r.triples, [
    { subject: "ex:flaky-test", predicate: "rdfs:subClassOf", object: "ex:test", kind: "rdfs:subClassOf" },
    { subject: "ex:has-flaky", predicate: "rdf:type", object: "owl:Restriction", kind: "owl:hasValue" },
    { subject: "ex:has-flaky", predicate: "owl:onProperty", object: "ex:flaky", kind: "owl:hasValue" },
    { subject: "ex:has-flaky", predicate: "owl:hasValue", object: "true", kind: "owl:hasValue" },
    { subject: "ex:flaky-test", predicate: "rdfs:subClassOf", object: "ex:has-flaky", kind: "owl:hasValue" },
    { subject: "ex:flaky-test", predicate: "rdfs:subClassOf", object: "ex:risk", kind: "rdfs:subClassOf" },
  ]);
});

test("pattern 8: copula — data adjective asserts the property, subclass adjective types/subsumes", () => {
  const d = parseAce("chat.mjs is deprecated");
  assert.equal(d.pattern, "adjective");
  assert.deepEqual(d.triples, [
    { subject: "ex:chat.mjs", predicate: "ex:deprecated", object: "true", kind: "owl:DatatypeProperty" },
  ]);
  const s = parseAce("ask.mjs is internal");
  assert.deepEqual(s.triples, [
    { subject: "ex:ask.mjs", predicate: "rdf:type", object: "ex:internal", kind: "rdf:type" },
  ]);
  const c = parseAce("every prototype is experimental");
  assert.deepEqual(c.triples, [
    { subject: "ex:prototype", predicate: "rdfs:subClassOf", object: "ex:experimental", kind: "rdfs:subClassOf" },
  ]);
});

test("near-misses return null — the grammar declines, it never guesses", () => {
  assert.equal(parseAce("most modules are tested"), null, "generalized quantifier is outside the fragment");
  assert.equal(parseAce("please summarize the codebase"), null);
  assert.equal(parseAce("every module imports config"), null, "universal + bare relation is not one of the 8 patterns");
  assert.equal(parseAce("hello"), null);
  assert.equal(parseAce(""), null);
  assert.equal(parseAce(null), null);
  assert.equal(parseAce("chat.mjs is sessions.mjs"), null, "identity between individuals is not in the fragment");
  assert.equal(parseAce("every module is chat.mjs"), null, "a class cannot be subsumed by an individual");
  assert.equal(parseAce("GitLab pipeline is a service"), null, "declared words in an unparseable phrase: structural miss, no residue");
});

test("unknown lexicon words: structural fit → empty triples + residue naming the unknown tokens", () => {
  const r = parseAce("every widget is a gadget");
  assert.equal(r.pattern, "subClassOf");
  assert.deepEqual(r.triples, []);
  assert.deepEqual(r.residue, ["widget", "gadget"]);
  const v = parseAce("every gizmo that imports a module is a service");
  assert.deepEqual(v.residue, ["gizmo"]);
  const mid = parseAce("modules frobnicate tests");
  assert.equal(mid.pattern, "relation");
  assert.deepEqual(mid.triples, []);
  assert.deepEqual(mid.residue, ["frobnicate"], "known ends, unknown middle: the 'if you mean X…' hook");
});

test("case and whitespace tolerance: parses are invariant under casing, padding and terminal punctuation", () => {
  const canon = parseAce("every module is a unit");
  assert.deepEqual(parseAce("  EVERY   Module IS a  Unit.  "), canon);
  assert.deepEqual(parseAce("Every module is a unit!"), canon);
  const rel = parseAce("chat.mjs depends on sessions.mjs");
  assert.deepEqual(parseAce("  chat.mjs   DEPENDS ON sessions.mjs?"), rel);
});

test("determinism: the same sentence always re-emits identical triples (idempotent under content-addressing)", () => {
  const a = parseAce("every module that imports a database is a service");
  const b = parseAce("every module that imports a database is a service");
  assert.deepEqual(a, b);
});

test("tokenize: keeps code-shaped tokens intact, strips one trailing punctuation run only", () => {
  assert.deepEqual(tokenize("tmct imports chat.mjs."), ["tmct", "imports", "chat.mjs"]);
  assert.deepEqual(tokenize("a, b; c?"), ["a", "b", "c"]);
  assert.deepEqual(tokenize("  "), []);
});

test("parseAce honors a caller-extended lexicon (loadLexicon(extra) round-trip)", () => {
  const lex = loadLexicon({ nouns: { widget: {} }, properNames: ["Seonix"] });
  const r = parseAce("Seonix is a widget", lex);
  assert.deepEqual(r.triples, [
    { subject: "ex:Seonix", predicate: "rdf:type", object: "ex:widget", kind: "rdf:type" },
  ]);
  assert.deepEqual(parseAce("Seonix is a widget").residue, ["Seonix", "widget"], "…and the core lexicon alone still declines");
});

// ---- Namespace injection: the extraction seam (README.md "Namespacing") ----

test("namespace injection: a caller-supplied ns replaces the default 'ex:' everywhere a term is minted", () => {
  const tmctLex = loadLexicon(undefined, "tmct:");
  const r = parseAce("every module is a unit", tmctLex);
  assert.deepEqual(r.triples, [
    { subject: "tmct:module", predicate: "rdfs:subClassOf", object: "tmct:unit", kind: "rdfs:subClassOf" },
  ]);
  // a someValuesFrom restriction's synthesized node names also carry the caller's ns, cleanly
  // (no leaked default-ns fragments, no double-prefixing of the stripped inner terms)
  const restr = parseAce("every module that imports a database is a service", tmctLex);
  assert.deepEqual(restr.triples.map((t) => t.subject), [
    "tmct:some-imports-database", "tmct:some-imports-database", "tmct:some-imports-database",
    "tmct:module-that-imports-database", "tmct:module-that-imports-database", "tmct:module-that-imports-database",
  ]);
});

test("namespace injection: two lexicons with different ns are independently cached and never cross-contaminate", () => {
  const a = loadLexicon(undefined, "a:");
  const b = loadLexicon(undefined, "b:");
  assert.notEqual(a, b);
  assert.equal(a.ns, "a:");
  assert.equal(b.ns, "b:");
  assert.equal(loadLexicon(undefined, "a:"), a, "same-ns no-extra load is cached");
  assert.deepEqual(parseAce("every module is a unit", a).triples[0].subject, "a:module");
  assert.deepEqual(parseAce("every module is a unit", b).triples[0].subject, "b:module");
});

test("PATTERNS exports the full 8-pattern domain", () => {
  assert.deepEqual(PATTERNS, [
    "subClassOf", "typeAssertion", "relation", "someValuesFrom",
    "cardinality", "disjointWith", "possessive", "adjective",
  ]);
});
