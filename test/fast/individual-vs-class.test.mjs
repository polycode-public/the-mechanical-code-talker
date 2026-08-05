// Two pure, cheap probes for the individual-vs-class predicate split, kept
// out of the corpus lanes (test/services/chat-individual-vs-class.test.mjs
// carries the full behavior suite) because both run in well under a
// millisecond: a table-driven unit over readsAsIndividualName's own G5
// rungs, and one call into the optimistic extractor's PROPN-tagged path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLexicon, readsAsIndividualName } from "../../src/domain/grammar/lexicon.mjs";
import { optimisticTriples } from "../../src/services/extract-facts.mjs";

const lex = loadLexicon();

test("readsAsIndividualName: every G5 rung, in order (a proper name, a code ref, a hyphenated coinage, capitalized-as-typed, lexicon-absent, plural-fold-only) reads true; a lowercase lexicon noun reads false", () => {
  const table = [
    ["tmct", true, "a declared proper name (G5a)"],
    ["chat.mjs", true, "a code-ref shape (G5b)"],
    ["groundhog-1", true, "a hyphenated coinage (G5c)"],
    ["Rover", true, "capitalized as typed, over a lexicon noun (G5d — 'rover' is a wanderer)"],
    ["fido", true, "lexicon-absent (G5e)"],
    ["whiskers", true, "matched only through the plural fold (G5f — 'whisker')"],
    ["cache", false, "a lowercase, exact-match lexicon noun — none of G5a-f fire"],
    ["rover", false, "lowercase — an exact lexicon-noun match, G5d never fires on typed case alone"],
  ];
  for (const [surface, expected, why] of table) {
    assert.equal(readsAsIndividualName(surface, lex), expected, `${surface}: ${why}`);
  }
});

test("optimisticTriples: a wink-tagged PROPN copula subject stores rdf:type, not rdfs:subClassOf", () => {
  const triples = optimisticTriples("Earth is the third planet from the Sun and the only place known where life exists.");
  assert.deepEqual(triples, [{ subject: "earth", predicate: "rdf:type", object: "planet" }]);
});
