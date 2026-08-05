// The two generic fact lanes a catalog-shaped question needs, exercised over a
// store seeded the way the sprite catalog's own page seeds one — flat
// {subject, predicate, object} rows carrying folded verb-plus-noun predicates
// (mgx:take-parameter, mgx:accept-emotion) that no teach sentence can mint.
//
//  - the membership and taught-class-count lanes read a class named by a noun
//    PHRASE ("sprite class"), not just a single word, and still read a
//    single-word class carrying a restrictor tail exactly as they did.
//  - the object-fronted property lane rejoins a question's own two ends into
//    the predicate the rows were stored under, so "what emotions does a person
//    sprite accept" reads mgx:accept-emotion with no table of property words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createInMemoryStore, appendFacts } from "../../src/adapters/memory/core.mjs";

const EMPTY_GRAPH = parseEntities({ individuals: [], objectProperties: [] });

async function storeWith(rows) {
  const memoryDir = createInMemoryStore();
  await appendFacts(memoryDir, rows.map((r) => ({ ...r, provenance: "corpus:test" })));
  return memoryDir;
}

const fact = (subject, predicate, object) => ({ subject, predicate, object });

/** A miniature of the real sprite-facts row set: two classes, each typed into
 *  the same multi-word class, one carrying a parameter and its values. */
function spriteRows() {
  return [
    fact("person sprite", "rdf:type", "sprite class"),
    fact("cabinet sprite", "rdf:type", "sprite class"),
    fact("person sprite", "mgx:take-parameter", "emotion"),
    fact("person sprite", "mgx:accept-emotion", "happy"),
    fact("person sprite", "mgx:accept-emotion", "sad"),
    fact("cabinet sprite", "mgx:take-parameter", "material"),
    fact("cabinet sprite", "mgx:accept-material", "wood"),
    fact("cabinet sprite", "mgx:offer-variant", "left"),
  ];
}

const turn = async (query, memoryDir) =>
  runTurn(query, { graph: EMPTY_GRAPH, memoryDir, sessionId: "noun-phrase-lanes" });

test("a class named by a two-word noun phrase enumerates its members, which a single leading word never reaches", async () => {
  const memoryDir = await storeWith(spriteRows());
  const r = await turn("list the sprite classes", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.match(r.answer, /person sprite is a sprite class/);
  assert.match(r.answer, /cabinet sprite is a sprite class/);
});

test("the plural of a multi-word class name folds to the singular the rows are stored under", async () => {
  const memoryDir = await storeWith(spriteRows());
  // Stored as "sprite class"; asked as "sprite classes".
  const r = await turn("how many sprite classes are there?", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.match(r.answer, /^2 sprite classes\. Say "list sprite classes" to see them\.$/);
});

test("a single-word class carrying a real restrictor tail still reads the class as one word", async () => {
  const memoryDir = await storeWith([
    fact("poodle", "rdfs:subClassOf", "animal"),
    fact("spider", "rdfs:subClassOf", "animal"),
  ]);
  const r = await turn("list the animals in the graph", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.match(r.answer, /poodle/);
  assert.match(r.answer, /spider/);
});

test("a restrictor tail the lane can't read still declines by name rather than answering as if it weren't asked", async () => {
  const memoryDir = await storeWith([fact("poodle", "rdfs:subClassOf", "animal")]);
  const r = await turn("list the animals that bark loudly", memoryDir);
  assert.equal(r.record?.miss, true, r.answer);
  assert.match(r.answer, /but not the "that bark loudly" part/);
});

test("the longer class name wins only when it is really on record, so a shorter reading is never shadowed", async () => {
  // "sprite" alone is a class here too, so the two readings compete directly.
  const memoryDir = await storeWith([
    ...spriteRows(),
    fact("goblin", "rdf:type", "sprite"),
  ]);
  const classes = await turn("list the sprite classes", memoryDir);
  assert.match(classes.answer, /person sprite is a sprite class/);
  assert.doesNotMatch(classes.answer, /goblin/, "the two-word reading answers with its own members only");

  const sprites = await turn("list the sprites", await storeWith([fact("goblin", "rdf:type", "sprite")]));
  assert.match(sprites.answer, /goblin/, "the one-word class still answers on its own");
});

test("an object-fronted property question rejoins its verb and noun into the stored folded predicate", async () => {
  const memoryDir = await storeWith(spriteRows());
  const r = await turn("what parameters does a person sprite take?", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.match(r.answer, /person sprite takes parameter emotion/);
  assert.doesNotMatch(r.answer, /material/, "another class's parameter never leaks into this answer");
});

test("the property lane folds the asked plural onto the singular the predicate names", async () => {
  const memoryDir = await storeWith(spriteRows());
  // The rows are stored under mgx:accept-emotion; the question says "emotions".
  const r = await turn("what emotions does a person sprite accept?", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.match(r.answer, /accepts emotion happy/);
  assert.match(r.answer, /accepts emotion sad/);
});

test("the property lane reads the verb from the sentence, so a different verb reaches a different predicate", async () => {
  const memoryDir = await storeWith(spriteRows());
  const offered = await turn("what variants does a cabinet sprite offer?", memoryDir);
  assert.match(offered.answer, /cabinet sprite offers variant left/);

  const accepted = await turn("what materials does a cabinet sprite accept?", memoryDir);
  assert.match(accepted.answer, /cabinet sprite accepts material wood/);
  assert.doesNotMatch(accepted.answer, /left/, "the offer rows are a different claim and stay out");
});

test("an object-fronted property question with nothing on record is an honest miss, never a borrowed answer", async () => {
  const memoryDir = await storeWith(spriteRows());
  const r = await turn("what colours does a person sprite accept?", memoryDir);
  assert.equal(r.record?.miss, true, r.answer);
  assert.doesNotMatch(r.answer, /happy|sad|emotion/, "the emotion rows never stand in for a colour question");
});

test("the property lane never answers about a subject that has no such rows", async () => {
  const memoryDir = await storeWith(spriteRows());
  const r = await turn("what parameters does a dragon sprite take?", memoryDir);
  assert.equal(r.record?.miss, true, r.answer);
  assert.doesNotMatch(r.answer, /emotion|material/);
});
