import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FACT_PREDICATE_PHRASES, predicatePhrase, factSentence } from "../../src/domain/fact-phrase.mjs";

const CHAT_SOURCE = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "src", "services", "chat.mjs");

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

/** Extracts the literal FACT_PREDICATE_PHRASES object out of chat.mjs's own
 *  source text and evaluates it as JS. chat.mjs does not export the table (it
 *  is a private module-level const), so the only way to compare the two
 *  tables is to read the source and pull the object literal out by its
 *  markers — exactly the check this test exists to make loud the moment the
 *  two drift. */
function chatModulePredicatePhrases() {
  const source = fs.readFileSync(CHAT_SOURCE, "utf8");
  const start = source.indexOf("const FACT_PREDICATE_PHRASES = {");
  assert.ok(start >= 0, "chat.mjs no longer declares FACT_PREDICATE_PHRASES — update or drop this pin");
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.ok(end > braceStart, "could not find the closing brace of chat.mjs's FACT_PREDICATE_PHRASES");
  const literal = source.slice(braceStart, end);
  return new Function(`"use strict"; return (${literal});`)();
}

test("chat.mjs's private FACT_PREDICATE_PHRASES still matches this module's copy verbatim", () => {
  assert.deepEqual(chatModulePredicatePhrases(), FACT_PREDICATE_PHRASES);
});
