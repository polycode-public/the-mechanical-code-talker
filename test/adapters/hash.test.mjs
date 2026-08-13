// hash.test.mjs — locks the single-sourced content hashes (src/domain/hash.mjs).
//
// fnv1aHex keys the narrow content addresses (paraphrase/answer-variant pools,
// per-URL web Source ids, committed-corpus dedupe); factIdFor keys the fact-id
// namespace (`fact:<hex>`) off a 64-bit SHA-256 truncation. A silent change to
// either would re-key its namespace and split the graph, so the exact bytes are
// pinned here as golden values. If a future refactor of a hash trips these, that
// is the intended alarm — do NOT "fix" the test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fnv1a32, fnv1aHex, factIdFor, factIdForTriple, legacyFactIdFor, normFactTerm } from "../../src/domain/hash.mjs";

test("fnv1a32 golden values are stable", () => {
  assert.equal(fnv1a32("the mechanical code talker"), 969701681);
  assert.equal(fnv1a32(""), 0x811c9dc5); // empty string = the FNV offset basis
});

test("fnv1aHex golden values are stable (fact-id namespace)", () => {
  assert.equal(fnv1aHex("the mechanical code talker"), "39cc7931");
  assert.equal(fnv1aHex("a"), "e40c292c");
});

test("fnv1aHex is always an 8-char zero-padded hex string", () => {
  // A short/low-hash input must still pad to 8 chars.
  for (const s of ["", "a", "z", "\0", "hello world", "\0\0"]) {
    assert.match(fnv1aHex(s), /^[0-9a-f]{8}$/);
  }
});

test("fnv1a32 and fnv1aHex agree (hex is the padded hex of the int)", () => {
  for (const s of ["", "cache", "a module\0rdfs:subClassOf\0component"]) {
    assert.equal(fnv1aHex(s), (fnv1a32(s) >>> 0).toString(16).padStart(8, "0"));
  }
});

test("determinism and dispersion", () => {
  assert.equal(fnv1a32("graded-smoke"), fnv1a32("graded-smoke"));
  assert.notEqual(fnv1a32("a"), fnv1a32("b"));
});

test("factIdFor is a 64-bit SHA-256 truncation: fact: + 16 lowercase hex", () => {
  for (const [s, p, o] of [["a", "mgx:causes", "b"], ["", "", ""], ["cache", "rdfs:subClassOf", "component"]]) {
    assert.match(factIdFor(s, p, o), /^fact:[0-9a-f]{16}$/);
  }
});

test("two triples that shared one 32-bit id now get distinct fact ids", () => {
  // Brute-forced FNV-1a collision: both triples hashed to fact:495ee929 under
  // the old 32-bit scheme, so the store merged two distinct facts into one.
  const a = ["thing23102", "mgx:atLocation", "value3156"];
  const b = ["thing26033", "mgx:causes", "value6087"];
  assert.equal(legacyFactIdFor(...a), "fact:495ee929", "the old scheme collided");
  assert.equal(legacyFactIdFor(...a), legacyFactIdFor(...b), "the old scheme collided");
  assert.notEqual(factIdForTriple(...a), factIdForTriple(...b), "the wide id keeps them apart");
});

// normFactTerm's fact-id guard must change nothing else: every existing
// prefix-strip case below has to come out exactly as it did before the
// guard existed. Only a term that is exactly "fact:" + 16 lowercase hex
// takes the new path.
test("normFactTerm still strips every non-fact-id prefix form the same way", () => {
  assert.equal(normFactTerm("/c/en/foo_bar"), "foo bar", "ConceptNet URI");
  assert.equal(normFactTerm("tmct:Foo_bar"), "foo bar", "tmct CURIE");
  assert.equal(normFactTerm("mgx:causes"), "causes", "predicate-shaped CURIE used as a term");
  assert.equal(normFactTerm("fact"), "fact", "bare word, no colon, untouched");
  assert.equal(normFactTerm("fact:not-hex-at-all"), "not-hex-at-all", "fact: prefix with a non-hex tail still strips");
  assert.equal(normFactTerm("fact:1a2b3c4d5e6f778"), "1a2b3c4d5e6f778", "15 hex chars is short of an id, still strips");
  assert.equal(normFactTerm("fact:1a2b3c4d5e6f77889"), "1a2b3c4d5e6f77889", "17 hex chars overshoots an id, still strips");
});

test("normFactTerm exempts a real fact group id, unchanged apart from lowercasing", () => {
  assert.equal(normFactTerm("fact:1a2b3c4d5e6f7788"), "fact:1a2b3c4d5e6f7788", "already-lowercase id survives whole");
  assert.equal(normFactTerm("FACT:1A2B3C4D5E6F7788"), "fact:1a2b3c4d5e6f7788", "mixed-case id lowercases but does not strip");
  assert.equal(normFactTerm("Fact:1a2b3c4d5e6f7788"), "fact:1a2b3c4d5e6f7788", "mixed-case prefix alone lowercases but does not strip");
});

test("a fact-id-shaped subject/object now hashes apart from its bare hex tail", () => {
  const prefixed = factIdForTriple("fact:1a2b3c4d5e6f7788", "mgx:causes", "smoke");
  const bare = factIdForTriple("1a2b3c4d5e6f7788", "mgx:causes", "smoke");
  assert.notEqual(prefixed, bare, "a reference to a fact must not collide with a taught word of the same hex");
});
