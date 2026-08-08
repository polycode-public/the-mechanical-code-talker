// The research-source choice vocabulary: what a config value, CLI flag, or
// chat toggle can name, and which registered source name it resolves to.
// research-source-contract.test.mjs already runs the shared adapter contract
// against every source THAT FILE imports; this file covers the mapping layer
// on top — normalizeResearchChoice and researchSourceNameFor — including the
// two knowledge-base sources phase 2 adds (wiktionary, dbpedia-lookup).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RESEARCH_SOURCE_CHOICES,
  DEFAULT_RESEARCH_SOURCE_CHOICE,
  normalizeResearchChoice,
  researchSourceNameFor,
  researchSources,
} from "../../src/adapters/corpus/research-source.mjs";
import { getResearchProvider, registerResearchProvider, SIMPLE_WIKIPEDIA_ORIGIN } from "../../src/adapters/corpus/wikipedia-live.mjs";
// Side-effect imports: registers the "wikidata", "wiktionary" and
// "dbpedia-lookup" research sources so getResearchProvider has entries to
// build for every new choice.
import "../../src/adapters/corpus/wikidata-live.mjs";
import "../../src/adapters/corpus/wiktionary-live.mjs";
import "../../src/adapters/corpus/dbpedia-lookup-live.mjs";

test("the choice vocabulary carries every source phase 2 adds, defaulting to wikipedia", () => {
  assert.deepEqual([...RESEARCH_SOURCE_CHOICES], ["wikipedia", "wikidata", "simple-wikipedia", "wiktionary", "dbpedia"]);
  assert.equal(DEFAULT_RESEARCH_SOURCE_CHOICE, "wikipedia");
});

test("an absent, empty or unrecognized choice normalizes to the default", () => {
  for (const bad of [undefined, null, "", "made-up-source"]) {
    assert.equal(normalizeResearchChoice(bad), "wikipedia");
  }
});

test("every choice word normalizes to itself and resolves to a registered source name", () => {
  const registered = new Set(researchSources().map((entry) => entry.name));
  for (const choice of RESEARCH_SOURCE_CHOICES) {
    assert.equal(normalizeResearchChoice(choice), choice);
    const sourceName = researchSourceNameFor(choice);
    assert.ok(registered.has(sourceName), `"${choice}" resolves to unregistered source "${sourceName}"`);
  }
});

test("wikipedia and simple-wikipedia are synonyms for the same registered source", () => {
  assert.equal(researchSourceNameFor("wikipedia"), "simple-wikipedia");
  assert.equal(researchSourceNameFor("simple-wikipedia"), "simple-wikipedia");
});

test("dbpedia is the short choice word for the dbpedia-lookup source", () => {
  assert.equal(researchSourceNameFor("dbpedia"), "dbpedia-lookup");
});

test("wiktionary resolves to itself", () => {
  assert.equal(researchSourceNameFor("wiktionary"), "wiktionary");
});

test("getResearchProvider({source}) builds a provider for each new choice, and simple-wikipedia still targets simple.wikipedia.org", async () => {
  try {
    registerResearchProvider(null);
    const wiktionary = getResearchProvider({ source: "wiktionary" });
    assert.equal(wiktionary.name, "wiktionary");
    assert.equal(wiktionary.origin, "https://en.wiktionary.org");

    const dbpedia = getResearchProvider({ source: "dbpedia" });
    assert.equal(dbpedia.name, "dbpedia-lookup");
    assert.equal(dbpedia.origin, "https://lookup.dbpedia.org");

    const wikipedia = getResearchProvider({ source: "wikipedia" });
    assert.equal(wikipedia.origin, SIMPLE_WIKIPEDIA_ORIGIN);
  } finally {
    registerResearchProvider(null);
  }
});
