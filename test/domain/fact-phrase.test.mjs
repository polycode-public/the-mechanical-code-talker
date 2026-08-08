import test from "node:test";
import assert from "node:assert/strict";
import { FACT_PREDICATE_PHRASES, predicatePhrase, factSentence } from "../../src/domain/fact-phrase.mjs";

test("predicatePhrase returns a curated phrase for every table entry", () => {
  assert.equal(predicatePhrase("rdfs:subClassOf"), "is a kind of");
  assert.equal(predicatePhrase("rdf:type"), "is a");
  assert.equal(predicatePhrase("mgx:hasA"), "has");
  assert.equal(predicatePhrase("mgx:causes"), "causes");
  assert.equal(predicatePhrase("mgx:desires"), "wants");
  assert.equal(predicatePhrase("mgx:currently-in"), "is in");
});

test("predicatePhrase falls back to the predicate's local name when there is no table entry", () => {
  assert.equal(predicatePhrase("mgx:eat"), "eat");
  assert.equal(predicatePhrase("mgx:some-unlisted-relation"), "some-unlisted-relation");
  assert.equal(predicatePhrase("nonamespace"), "nonamespace");
  assert.equal(predicatePhrase(""), "");
});

test("factSentence renders one sentence per predicate family", () => {
  assert.equal(factSentence({ subject: "a heart", predicate: "mgx:hasA", object: "a valve" }), "a heart has a valve");
  assert.equal(factSentence({ subject: "a robin", predicate: "rdfs:subClassOf", object: "a bird" }), "a robin is a kind of a bird");
  assert.equal(factSentence({ subject: "fire", predicate: "mgx:causes", object: "smoke" }), "fire causes smoke");
  assert.equal(factSentence({ subject: "a knife", predicate: "mgx:usedFor", object: "cutting" }), "a knife is used for cutting");
  assert.equal(factSentence({ subject: "a lamp", predicate: "mgx:currently-in", object: "the study" }), "a lamp is in the study");
  assert.equal(factSentence({ subject: "a dog", predicate: "mgx:bark", object: "loudly" }), "a dog bark loudly");
});
