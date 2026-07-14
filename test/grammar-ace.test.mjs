// grammar/ace.mjs tests — the 9-pattern ACE-OWL sub-fragment round-trips
// (sentence → expected OWL-labelled triples), the null-is-a-feature misses
// (generalized quantifiers, questions, undeclared verbs), residue naming
// unknown tokens, and case/whitespace tolerance. Pattern numbers refer to
// docs/references/schemas/ace-owl-fragment.md's table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAce, tokenize } from "../src/grammar/ace.mjs";
import { loadLexicon } from "../src/grammar/lexicon.mjs";

const triplesOf = (r) => r.triples.map((t) => [t.subject, t.predicate, t.object]);

test("pattern 1: 'every N1 is a N2' → rdfs:subClassOf", () => {
  const r = parseAce("every module is a unit");
  assert.equal(r.pattern, "subClassOf");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "tmct:module", predicate: "rdfs:subClassOf", object: "tmct:unit", kind: "rdfs:subClassOf" },
  ]);
});

test("pattern 2: 'PROPERNAME is a N' → rdf:type class assertion (declared name and code-shaped ref)", () => {
  const r1 = parseAce("tmct is a project");
  assert.equal(r1.pattern, "typeAssertion");
  assert.deepEqual(r1.triples, [
    { subject: "tmct:tmct", predicate: "rdf:type", object: "tmct:project", kind: "rdf:type" },
  ]);
  const r2 = parseAce("chat.mjs is a module");
  assert.deepEqual(r2.triples, [
    { subject: "tmct:chat.mjs", predicate: "rdf:type", object: "tmct:module", kind: "rdf:type" },
  ]);
});

test("pattern 3: 'N1 VERB N2' → object-property assertion, predicate from the verb lexicon", () => {
  const r = parseAce("modules import tests");
  assert.equal(r.pattern, "relation");
  assert.deepEqual(r.triples, [
    { subject: "tmct:module", predicate: "tmct:imports", object: "tmct:test", kind: "owl:ObjectProperty" },
  ]);
  const det = parseAce("the parser uses the lexicon");
  assert.deepEqual(triplesOf(det), [["tmct:parser", "tmct:uses", "tmct:lexicon"]]);
});

test("pattern 3: proper-name forms and verb+preposition ('depends on' → tmct:dependsOn)", () => {
  const r = parseAce("chat.mjs depends on sessions.mjs");
  assert.equal(r.pattern, "relation");
  assert.deepEqual(r.triples, [
    { subject: "tmct:chat.mjs", predicate: "tmct:dependsOn", object: "tmct:sessions.mjs", kind: "owl:ObjectProperty" },
  ]);
  assert.equal(parseAce("chat.mjs depends sessions.mjs"), null, "a declared preposition is required, not optional");
});

test("pattern 4: 'every N1 that VERBs a N2 is a N3' → someValuesFrom restriction, deterministic node names", () => {
  const r = parseAce("every module that imports a database is a service");
  assert.equal(r.pattern, "someValuesFrom");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "tmct:some-imports-database", predicate: "rdf:type", object: "owl:Restriction", kind: "owl:someValuesFrom" },
    { subject: "tmct:some-imports-database", predicate: "owl:onProperty", object: "tmct:imports", kind: "owl:someValuesFrom" },
    { subject: "tmct:some-imports-database", predicate: "owl:someValuesFrom", object: "tmct:database", kind: "owl:someValuesFrom" },
    { subject: "tmct:module-that-imports-database", predicate: "owl:intersectionOf", object: "tmct:module", kind: "owl:someValuesFrom" },
    { subject: "tmct:module-that-imports-database", predicate: "owl:intersectionOf", object: "tmct:some-imports-database", kind: "owl:someValuesFrom" },
    { subject: "tmct:module-that-imports-database", predicate: "rdfs:subClassOf", object: "tmct:service", kind: "owl:someValuesFrom" },
  ]);
});

test("pattern 5: 'every N has at least|at most|exactly n N2' → the three cardinality kinds, n carried", () => {
  const min = parseAce("every module has at least 1 test");
  assert.equal(min.pattern, "cardinality");
  assert.equal(min.n, 1);
  assert.deepEqual(min.triples, [
    { subject: "tmct:min-1-test", predicate: "rdf:type", object: "owl:Restriction", kind: "owl:minCardinality" },
    { subject: "tmct:min-1-test", predicate: "owl:onProperty", object: "tmct:has", kind: "owl:minCardinality" },
    { subject: "tmct:min-1-test", predicate: "owl:minCardinality", object: "1", kind: "owl:minCardinality", n: 1 },
    { subject: "tmct:min-1-test", predicate: "owl:onClass", object: "tmct:test", kind: "owl:minCardinality" },
    { subject: "tmct:module", predicate: "rdfs:subClassOf", object: "tmct:min-1-test", kind: "owl:minCardinality" },
  ]);
  const max = parseAce("every class has at most 3 dependencies");
  assert.equal(max.triples.find((t) => t.n != null).predicate, "owl:maxCardinality");
  assert.equal(max.triples.find((t) => t.predicate === "owl:onClass").object, "tmct:dependency");
  const exact = parseAce("every repository has exactly one license");
  assert.equal(exact.n, 1, "number words accepted");
  assert.equal(exact.triples.find((t) => t.n != null).predicate, "owl:cardinality");
});

test("pattern 6: 'no N1 is a N2' → owl:disjointWith", () => {
  const r = parseAce("no test is a module");
  assert.equal(r.pattern, "disjointWith");
  assert.deepEqual(r.triples, [
    { subject: "tmct:test", predicate: "owl:disjointWith", object: "tmct:module", kind: "owl:disjointWith" },
  ]);
});

test("pattern 7: possessive with a data-typed noun → owl:DatatypeProperty, literal value verbatim", () => {
  const r = parseAce("tmct's license is MPL-2.0");
  assert.equal(r.pattern, "possessive");
  assert.deepEqual(r.triples, [
    { subject: "tmct:tmct", predicate: "tmct:license", object: "MPL-2.0", kind: "owl:DatatypeProperty" },
  ]);
  const of = parseAce("the version of tmct is 0.2.0");
  assert.deepEqual(of.triples, [
    { subject: "tmct:tmct", predicate: "tmct:version", object: "0.2.0", kind: "owl:DatatypeProperty" },
  ]);
});

test("pattern 7: possessive with an object-typed noun → owl:ObjectProperty, value resolved to a term", () => {
  const r = parseAce("chat.mjs's owner is Polycode");
  assert.equal(r.pattern, "possessive");
  assert.deepEqual(r.triples, [
    { subject: "tmct:chat.mjs", predicate: "tmct:owner", object: "tmct:Polycode", kind: "owl:ObjectProperty" },
  ]);
});

test("pattern 8: subclass-forming adjective as modifier → ADJ-N ⊑ N and ⊑ ADJ", () => {
  const r = parseAce("every legacy module is a risk");
  assert.equal(r.pattern, "subClassOf");
  assert.deepEqual(r.triples, [
    { subject: "tmct:legacy-module", predicate: "rdfs:subClassOf", object: "tmct:module", kind: "rdfs:subClassOf" },
    { subject: "tmct:legacy-module", predicate: "rdfs:subClassOf", object: "tmct:legacy", kind: "rdfs:subClassOf" },
    { subject: "tmct:legacy-module", predicate: "rdfs:subClassOf", object: "tmct:risk", kind: "rdfs:subClassOf" },
  ]);
});

test("pattern 8: data-typed adjective as modifier → subclass-with-hasValue restriction", () => {
  const r = parseAce("every flaky test is a risk");
  assert.deepEqual(r.triples, [
    { subject: "tmct:flaky-test", predicate: "rdfs:subClassOf", object: "tmct:test", kind: "rdfs:subClassOf" },
    { subject: "tmct:has-flaky", predicate: "rdf:type", object: "owl:Restriction", kind: "owl:hasValue" },
    { subject: "tmct:has-flaky", predicate: "owl:onProperty", object: "tmct:flaky", kind: "owl:hasValue" },
    { subject: "tmct:has-flaky", predicate: "owl:hasValue", object: "true", kind: "owl:hasValue" },
    { subject: "tmct:flaky-test", predicate: "rdfs:subClassOf", object: "tmct:has-flaky", kind: "owl:hasValue" },
    { subject: "tmct:flaky-test", predicate: "rdfs:subClassOf", object: "tmct:risk", kind: "rdfs:subClassOf" },
  ]);
});

test("pattern 8: copula — data adjective asserts the property, subclass adjective types/subsumes", () => {
  const d = parseAce("chat.mjs is deprecated");
  assert.equal(d.pattern, "adjective");
  assert.deepEqual(d.triples, [
    { subject: "tmct:chat.mjs", predicate: "tmct:deprecated", object: "true", kind: "owl:DatatypeProperty" },
  ]);
  const s = parseAce("ask.mjs is internal");
  assert.deepEqual(s.triples, [
    { subject: "tmct:ask.mjs", predicate: "rdf:type", object: "tmct:internal", kind: "rdf:type" },
  ]);
  const c = parseAce("every prototype is experimental");
  assert.deepEqual(c.triples, [
    { subject: "tmct:prototype", predicate: "rdfs:subClassOf", object: "tmct:experimental", kind: "rdfs:subClassOf" },
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

test("determinism: the same sentence always re-emits identical triples (idempotent appendFact ids)", () => {
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
    { subject: "tmct:Seonix", predicate: "rdf:type", object: "tmct:widget", kind: "rdf:type" },
  ]);
  assert.deepEqual(parseAce("Seonix is a widget").residue, ["Seonix", "widget"], "…and the core lexicon alone still declines");
});

test("pattern 9: 'N can VERB' → mgx:capableOf; a noun 'can' or multi-word tail falls through, 'cannot' never parses", () => {
  const r = parseAce("a module can bark");
  assert.equal(r.pattern, "capability");
  assert.deepEqual(r.triples, [
    { subject: "tmct:module", predicate: "mgx:capableOf", object: "tmct:bark", kind: "mgx:capableOf" },
  ]);
  // multi-word tail: not the closed "N can V" shape — no capability parse
  const multi = parseAce("a module can bark loudly");
  assert.notEqual(multi?.pattern, "capability");
  // negative modal: one token, never reaches the capability split
  assert.notEqual(parseAce("a module cannot bark")?.pattern, "capability");
});
