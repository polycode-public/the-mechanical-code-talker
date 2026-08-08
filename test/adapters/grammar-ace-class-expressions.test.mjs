// grammar/ace.mjs tests — patterns 10 through 16, the class-expression and
// role vocabulary phase 0 adds beside the original 9 (grammar-ace.test.mjs
// keeps those). Pattern numbers refer to
// docs/references/schemas/ace-owl-fragment.md's table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAce } from "../../src/domain/grammar/ace.mjs";

const triplesOf = (r) => r.triples.map((t) => [t.subject, t.predicate, t.object]);

test("pattern 10: 'every N1 is a N2 or a N3' → owl:unionOf, arms sorted by local name", () => {
  const r = parseAce("every pet is a cat or a dog");
  assert.equal(r.pattern, "union");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "tmct:cat-or-dog", predicate: "rdf:type", object: "owl:Class", kind: "owl:unionOf" },
    { subject: "tmct:cat-or-dog", predicate: "owl:unionOf", object: "tmct:cat", kind: "owl:unionOf" },
    { subject: "tmct:cat-or-dog", predicate: "owl:unionOf", object: "tmct:dog", kind: "owl:unionOf" },
    { subject: "tmct:pet", predicate: "rdfs:subClassOf", object: "tmct:cat-or-dog", kind: "owl:unionOf" },
  ]);
});

test("pattern 10: teaching the arms in the opposite order mints the identical node and triple list (idempotent re-teach)", () => {
  const forward = parseAce("every pet is a cat or a dog");
  const reversed = parseAce("every pet is a dog or a cat");
  assert.deepEqual(reversed.triples, forward.triples);
});

test("pattern 10: three arms fold left, still sorted", () => {
  const r = parseAce("every pet is a cat or a dog or a bird");
  assert.equal(r.pattern, "union");
  const union = r.triples.filter((t) => t.predicate === "owl:unionOf");
  assert.deepEqual(union.map((t) => t.object), ["tmct:bird", "tmct:cat", "tmct:dog"]);
  assert.equal(union[0].subject, "tmct:bird-or-cat-or-dog");
});

test("pattern 10: an undeclared arm declines with residue naming it, nothing stored", () => {
  const r = parseAce("every pet is a cat or a zorbnax");
  assert.equal(r.pattern, "union");
  assert.deepEqual(r.triples, []);
  assert.deepEqual(r.residue, ["zorbnax"]);
});

test("pattern 10: with no 'or' in the tail, falls through to the plain subclass pattern", () => {
  const r = parseAce("every pet is a cat");
  assert.equal(r.pattern, "subClassOf");
  assert.deepEqual(triplesOf(r), [["tmct:pet", "rdfs:subClassOf", "tmct:cat"]]);
});

test("pattern 11: 'everything that is not N1 is N2' → owl:complementOf", () => {
  const r = parseAce("everything that is not aquatic is terrestrial");
  assert.equal(r.pattern, "complement");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "tmct:not-aquatic", predicate: "rdf:type", object: "owl:Class", kind: "owl:complementOf" },
    { subject: "tmct:not-aquatic", predicate: "owl:complementOf", object: "tmct:aquatic", kind: "owl:complementOf" },
    { subject: "tmct:not-aquatic", predicate: "rdfs:subClassOf", object: "tmct:terrestrial", kind: "owl:complementOf" },
  ]);
});

test("pattern 11: accepts an articled N1 ('everything that is not a N1 is a N2')", () => {
  const r = parseAce("everything that is not a database is a service");
  assert.equal(r.pattern, "complement");
  assert.deepEqual(r.triples, [
    { subject: "tmct:not-database", predicate: "rdf:type", object: "owl:Class", kind: "owl:complementOf" },
    { subject: "tmct:not-database", predicate: "owl:complementOf", object: "tmct:database", kind: "owl:complementOf" },
    { subject: "tmct:not-database", predicate: "rdfs:subClassOf", object: "tmct:service", kind: "owl:complementOf" },
  ]);
});

test("pattern 11: an undeclared word on either side declines with residue naming it", () => {
  const r = parseAce("everything that is not zorbnax is terrestrial");
  assert.equal(r.pattern, "complement");
  assert.deepEqual(r.triples, []);
  assert.deepEqual(r.residue, ["zorbnax"]);
});

test("pattern 11: re-teaching the same sentence mints the identical complement node", () => {
  const a = parseAce("everything that is not aquatic is terrestrial");
  const b = parseAce("everything that is not aquatic is terrestrial");
  assert.deepEqual(a.triples, b.triples);
});

test("pattern 12: 'PROPERNAME is not a N' where the subject is a declared proper name → owl:disjointWith", () => {
  const r = parseAce("GitHub is not a database");
  assert.equal(r.pattern, "negativeType");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "tmct:GitHub", predicate: "owl:disjointWith", object: "tmct:database", kind: "owl:disjointWith" },
  ]);
});

test("pattern 12: a code-ref-shaped subject also reads as an individual", () => {
  const r = parseAce("chat.mjs is not a database");
  assert.deepEqual(r.triples, [
    { subject: "tmct:chat.mjs", predicate: "owl:disjointWith", object: "tmct:database", kind: "owl:disjointWith" },
  ]);
});

test("pattern 12: a class-level subject (no declared proper name, no code-ref shape) declines — pattern 6 ('no N1 is a N2') owns that territory, unchanged", () => {
  const r = parseAce("a module is not a database");
  assert.notEqual(r?.pattern, "negativeType");
});

test("pattern 12: an undeclared class object declines with residue naming it", () => {
  const r = parseAce("GitHub is not a zorbnax");
  assert.equal(r.pattern, "negativeType");
  assert.deepEqual(r.triples, []);
  assert.deepEqual(r.residue, ["zorbnax"]);
});

test("pattern 13: 'the N1 N2s are exactly M1, M2 and M3' → owl:oneOf, positive rdf:type half, pairwise owl:differentFrom, members sorted", () => {
  const r = parseAce("the primary colours are exactly red, yellow and blue");
  assert.equal(r.pattern, "enumeration");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "tmct:primary-colours", predicate: "rdfs:subClassOf", object: "tmct:colours", kind: "rdfs:subClassOf" },
    { subject: "tmct:primary-colours", predicate: "rdfs:subClassOf", object: "tmct:primary", kind: "rdfs:subClassOf" },
    { subject: "tmct:primary-colours", predicate: "owl:oneOf", object: "tmct:blue", kind: "owl:oneOf" },
    { subject: "tmct:primary-colours", predicate: "owl:oneOf", object: "tmct:red", kind: "owl:oneOf" },
    { subject: "tmct:primary-colours", predicate: "owl:oneOf", object: "tmct:yellow", kind: "owl:oneOf" },
    { subject: "tmct:blue", predicate: "rdf:type", object: "tmct:primary-colours", kind: "owl:oneOf" },
    { subject: "tmct:red", predicate: "rdf:type", object: "tmct:primary-colours", kind: "owl:oneOf" },
    { subject: "tmct:yellow", predicate: "rdf:type", object: "tmct:primary-colours", kind: "owl:oneOf" },
    { subject: "tmct:blue", predicate: "owl:differentFrom", object: "tmct:red", kind: "owl:differentFrom" },
    { subject: "tmct:blue", predicate: "owl:differentFrom", object: "tmct:yellow", kind: "owl:differentFrom" },
    { subject: "tmct:red", predicate: "owl:differentFrom", object: "tmct:yellow", kind: "owl:differentFrom" },
  ]);
});

test("pattern 13: the member list is order-independent — teaching the members in a different order mints the identical triple list", () => {
  const forward = parseAce("the primary colours are exactly red, yellow and blue");
  const reversed = parseAce("the primary colours are exactly blue, red and yellow");
  assert.deepEqual(reversed.triples, forward.triples);
});

test("pattern 13: two members store one differentFrom pair, not the three-member closure", () => {
  const r = parseAce("the primary colours are exactly red and blue");
  const different = r.triples.filter((t) => t.predicate === "owl:differentFrom");
  assert.deepEqual(different, [
    { subject: "tmct:blue", predicate: "owl:differentFrom", object: "tmct:red", kind: "owl:differentFrom" },
  ]);
});

test("pattern 13: an undeclared member declines with residue naming it", () => {
  const r = parseAce("the primary colours are exactly red, zorbnax and blue");
  assert.equal(r.pattern, "enumeration");
  assert.deepEqual(r.triples, []);
  assert.deepEqual(r.residue, ["zorbnax"]);
});

test("pattern 14: 'PROPERNAME1 is not PROPERNAME2' where both sides are declared proper names → owl:differentFrom", () => {
  const r = parseAce("GitHub is not GitLab");
  assert.equal(r.pattern, "differentFrom");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "tmct:GitHub", predicate: "owl:differentFrom", object: "tmct:GitLab", kind: "owl:differentFrom" },
  ]);
});

test("pattern 14: two code-ref-shaped individuals also mint owl:differentFrom", () => {
  const r = parseAce("chat.mjs is not sessions.mjs");
  assert.deepEqual(r.triples, [
    { subject: "tmct:chat.mjs", predicate: "owl:differentFrom", object: "tmct:sessions.mjs", kind: "owl:differentFrom" },
  ]);
});

test("pattern 14: a class-level object routes to pattern 12 (negativeType) instead — the two never collide", () => {
  const r = parseAce("GitHub is not a database");
  assert.equal(r.pattern, "negativeType");
});

test("pattern 15: 'every N1 has a N2' (bare, no cardinality) → someValuesFrom restriction", () => {
  const r = parseAce("every heart has a valve");
  assert.equal(r.pattern, "bareExistential");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "tmct:some-has-valve", predicate: "rdf:type", object: "owl:Restriction", kind: "owl:someValuesFrom" },
    { subject: "tmct:some-has-valve", predicate: "owl:onProperty", object: "tmct:has", kind: "owl:someValuesFrom" },
    { subject: "tmct:some-has-valve", predicate: "owl:someValuesFrom", object: "tmct:valve", kind: "owl:someValuesFrom" },
    { subject: "tmct:heart", predicate: "rdfs:subClassOf", object: "tmct:some-has-valve", kind: "owl:someValuesFrom" },
  ]);
});

test("pattern 15: the general verb form ('contains') mints a restriction on that verb's own predicate", () => {
  const r = parseAce("every heart contains a valve");
  assert.equal(r.pattern, "bareExistential");
  assert.deepEqual(r.triples, [
    { subject: "tmct:some-contains-valve", predicate: "rdf:type", object: "owl:Restriction", kind: "owl:someValuesFrom" },
    { subject: "tmct:some-contains-valve", predicate: "owl:onProperty", object: "tmct:contains", kind: "owl:someValuesFrom" },
    { subject: "tmct:some-contains-valve", predicate: "owl:someValuesFrom", object: "tmct:valve", kind: "owl:someValuesFrom" },
    { subject: "tmct:heart", predicate: "rdfs:subClassOf", object: "tmct:some-contains-valve", kind: "owl:someValuesFrom" },
  ]);
});

test("pattern 15: 'at least'/'at most'/'exactly' still claim the sentence first — the cardinality pattern is untouched", () => {
  const r = parseAce("every module has at least 1 test");
  assert.equal(r.pattern, "cardinality");
});

test("pattern 15: re-teaching the same sentence mints the identical restriction node (idempotent)", () => {
  const a = parseAce("every heart has a valve");
  const b = parseAce("every heart has a valve");
  assert.deepEqual(a.triples, b.triples);
});

test("pattern 15: a two-word object (a curated compound has-a shape another teach frame owns) declines rather than guessing a compound", () => {
  const r = parseAce("every Component has a render method");
  assert.equal(r, null);
});

test("pattern 15: an undeclared object declines with residue naming it", () => {
  const r = parseAce("every heart has a zorbnax");
  assert.equal(r.pattern, "bareExistential");
  assert.deepEqual(r.triples, []);
  assert.deepEqual(r.residue, ["zorbnax"]);
});

test("pattern 16: 'VERB is transitive' (3sg surface) → owl:TransitiveProperty on the minted predicate", () => {
  const r = parseAce("contains is transitive");
  assert.equal(r.pattern, "transitiveRole");
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.triples, [
    { subject: "tmct:contains", predicate: "rdf:type", object: "owl:TransitiveProperty", kind: "owl:TransitiveProperty" },
  ]);
});

test("pattern 16: the gerund surface ('containing') folds to the same verb and predicate", () => {
  const r = parseAce("containing is transitive");
  assert.equal(r.pattern, "transitiveRole");
  assert.deepEqual(r.triples, [
    { subject: "tmct:contains", predicate: "rdf:type", object: "owl:TransitiveProperty", kind: "owl:TransitiveProperty" },
  ]);
});

test("pattern 16: 'having is transitive' folds through the have/has irregular the lexicon already carries", () => {
  const r = parseAce("having is transitive");
  assert.deepEqual(r.triples, [
    { subject: "tmct:has", predicate: "rdf:type", object: "owl:TransitiveProperty", kind: "owl:TransitiveProperty" },
  ]);
});

test("pattern 16: an undeclared verb falls through to the ordinary copula decline rather than a hard crash", () => {
  const r = parseAce("zorbnaxing is transitive");
  assert.notEqual(r?.pattern, "transitiveRole");
  assert.deepEqual(r?.triples ?? [], []);
});
