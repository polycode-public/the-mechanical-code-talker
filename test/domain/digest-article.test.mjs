// The article stage assembles paragraphs into a whole and keeps the full detail
// reachable behind an explicit escape — the narrative leads, nothing is lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { termArticle, researchRunArticle, sessionDigestArticle } from "../../src/domain/digest/article.mjs";

const factRow = (predicate, object, sourceTypes, provenance) => ({
  id: `${predicate}:${object}`, subject: "aardvark", predicate, object, sourceTypes, provenance,
});

const selection = {
  term: "aardvark",
  selected: [
    { family: "isa", row: factRow("rdfs:subClassOf", "mammal", ["referenceLive"], "research:Aardvark@0") },
  ],
  cut: [
    { row: factRow("rdfs:subClassOf", "entity", ["entailed"], "entailed:cax-sco"), reason: "uninformative-class" },
    { row: factRow("rdfs:subClassOf", "medium", ["extracted"], "extracted:aardvark"), reason: "below-floor" },
  ],
};
const composed = {
  term: "aardvark",
  paragraphs: [{ text: "An aardvark is a mammal.", sentences: [] }],
  provenanceRows: [factRow("rdfs:subClassOf", "mammal", ["referenceLive"], "research:Aardvark@0")],
};

test("a term article leads with the narrative paragraphs", () => {
  const art = termArticle(selection, composed);
  assert.equal(art.kind, "term-article");
  assert.deepEqual(art.paragraphs, ["An aardvark is a mammal."]);
});

test("the full fact list — spoken and cut alike — sits behind the escape", () => {
  const art = termArticle(selection, composed);
  assert.equal(art.detail.factCount, 3);
  assert.equal(art.detail.escapes.facts, "show the facts");
  const objects = art.detail.facts.map((f) => f.object).sort();
  assert.deepEqual(objects, ["entity", "mammal", "medium"]);
});

test("a term article names its sources", () => {
  const art = termArticle(selection, composed);
  assert.equal(art.sources.length, 1);
  assert.equal(art.sources[0].provenance, "research:Aardvark@0");
});

test("ancestry chains ride behind the 'show the chains' escape", () => {
  const art = termArticle(selection, composed, { chains: { mammal: ["mammal", "vertebrate", "animal"] } });
  assert.equal(art.detail.escapes.chains, "show the chains");
  assert.deepEqual(art.detail.chains, [{ object: "mammal", chain: ["mammal", "vertebrate", "animal"] }]);
});

test("a research-run article carries what it grounded and what it skipped", () => {
  const run = {
    term: "aardvark",
    grounded: ["Africa", "Afrikaans"],
    skipped: [{ topic: "Cambrian", reason: "off-topic" }],
    rows: [factRow("rdfs:subClassOf", "mammal", ["referenceLive"], "research:Aardvark@0")],
  };
  const art = researchRunArticle(run);
  assert.equal(art.kind, "research-run");
  assert.deepEqual(art.grounded, ["Africa", "Afrikaans"]);
  assert.deepEqual(art.skipped, [{ topic: "Cambrian", reason: "off-topic" }]);
  assert.equal(art.detail.factCount, 1);
});

test("a session digest counts what the conversation taught", () => {
  const art = sessionDigestArticle({ rows: [factRow("rdfs:subClassOf", "mammal", ["teach"], "teach:chat")] });
  assert.equal(art.kind, "session-digest");
  assert.equal(art.learnedCount, 1);
  assert.equal(art.detail.factCount, 1);
});
