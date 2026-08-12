// The read-time screen on cross-sense isa walks.
//
// A WordNet-derived band flattens two senses of a word onto one label:
// "region" is a geographic area and an anatomical one, and both rows store the
// same six characters. subClassOf transitivity then walks across the join —
// russia ⊑ country ⊑ geographical area ⊑ region ⊑ body part. The offline
// closure already refuses that step. These pin the same refusal on the chat
// surface's own live walks: the subtype BFS behind "what do you know about X",
// the chain the fact list renders, and the proof chase behind "is X a Y".
//
// They also pin what the screen must never touch: a stated fact, a term
// genuinely under two senses, and a clean lineage with no join in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createInMemoryStore, appendFacts } from "../../src/adapters/memory/core.mjs";

const EMPTY_GRAPH = parseEntities({ individuals: [], objectProperties: [] });
const SUBCLASS_OF = "rdfs:subClassOf";

// The committed chain in the shape the bands really store it. Every row is
// true of ONE sense of its subject; `region` is where the two senses meet.
// `dog` carries a clean lineage with no join anywhere in it, as the control.
const SENSE_MIXED_EDGES = [
  ["russia", "country"],
  ["country", "place"],
  ["country", "geographical area"],
  ["country", "administrative district"],
  ["geographical area", "region"],
  ["region", "location"],
  ["region", "body part"],
  ["body part", "part"],
  ["dog", "canine"],
  ["canine", "carnivore"],
  ["carnivore", "mammal"],
  ["mammal", "organism"],
];

async function storeOver(edges, extraRows = []) {
  const memoryDir = createInMemoryStore();
  await appendFacts(memoryDir, [
    ...edges.map(([subject, object]) => ({ subject, predicate: SUBCLASS_OF, object, provenance: "teach:test" })),
    ...extraRows.map((r) => ({ provenance: "teach:test", ...r })),
  ]);
  return memoryDir;
}

const ask = async (query, memoryDir) =>
  runTurn(query, { graph: EMPTY_GRAPH, memoryDir, sessionId: "cross-sense-read-walk" });

test("the subtype walk behind 'what do you know about' stops at the sense join", async () => {
  const memoryDir = await storeOver(SENSE_MIXED_EDGES, [
    { subject: "russia", predicate: "mgx:hasA", object: "capital" },
  ]);
  const r = await ask("what do you know about body part", memoryDir);
  assert.doesNotMatch(r.answer, /russia/i, r.answer);
  assert.doesNotMatch(r.answer, /capital/i, r.answer);
  // Everything genuinely under the anatomical sense still answers.
  assert.match(r.answer, /region is a kind of body part/);
  assert.match(r.answer, /body part is a kind of part/);
});

test("a term genuinely under both senses keeps its place in the subtype walk", async () => {
  const memoryDir = await storeOver(SENSE_MIXED_EDGES);
  const r = await ask("what do you know about body part", memoryDir);
  // `geographical area` sits under place AND body part at the same level, so
  // the screen leaves both branches alone.
  assert.match(r.answer, /geographical area is a kind of region/);
});

test("a clean lineage still walks end to end", async () => {
  const memoryDir = await storeOver(SENSE_MIXED_EDGES);
  const r = await ask("what do you know about organism", memoryDir);
  for (const line of [/dog is a kind of canine/, /canine is a kind of carnivore/, /carnivore is a kind of mammal/]) {
    assert.match(r.answer, line, r.answer);
  }
});

test("the geographic sense's own subtype walk is untouched", async () => {
  const memoryDir = await storeOver(SENSE_MIXED_EDGES);
  const r = await ask("what do you know about place", memoryDir);
  assert.match(r.answer, /russia is a kind of country/, r.answer);
});

test("the proof chase declines to promise a chain that crosses the join", async () => {
  const memoryDir = await storeOver(SENSE_MIXED_EDGES);
  const r = await ask("is russia a body part", memoryDir);
  assert.doesNotMatch(r.answer, /^yes/i, r.answer);
  // /syllogise closes over the same edges under the same gate, so offering it
  // here would send the reader after a fact that never lands.
  assert.doesNotMatch(r.answer, /syllogise/, r.answer);
  assert.match(r.answer, /can't confirm/i, r.answer);
});

test("the same recovery is still offered for a clean chain that really does close", async () => {
  const memoryDir = await storeOver(SENSE_MIXED_EDGES);
  const r = await ask("is a dog an organism", memoryDir);
  assert.match(r.answer, /syllogise/, r.answer);
});

test("a stated fact across the join still answers yes", async () => {
  const memoryDir = await storeOver(SENSE_MIXED_EDGES);
  const r = await ask("is a region a body part", memoryDir);
  assert.match(r.answer, /^yes/i, r.answer);
  assert.match(r.answer, /region is a kind of body part/);
});

test("a chase whose subject sits under both senses still closes", async () => {
  const memoryDir = await storeOver(SENSE_MIXED_EDGES);
  const r = await ask("is a geographical area a body part", memoryDir);
  assert.match(r.answer, /^yes/i, r.answer);
});

test("the rendered superclass chain stops before the sense it does not belong to", async () => {
  // `region` is the only parent geographical area has, so an unscreened chain
  // would read "…→ region → body part" off a geographic subject.
  const memoryDir = await storeOver([
    ["moscow", "geographical area"],
    ["geographical area", "region"],
    ["region", "body part"],
    ["region", "location"],
    ["body part", "part"],
    ["geographical area", "place"],
  ]);
  const r = await ask("what do you know about moscow", memoryDir);
  assert.doesNotMatch(r.answer, /body part/, r.answer);
});

test("the screen's verdicts do not depend on the order the facts arrived in", async () => {
  const queries = [
    "what do you know about body part",
    "what do you know about organism",
    "is russia a body part",
    "is a dog an organism",
    "is a region a body part",
  ];
  const linesOf = (answer) => String(answer).split("\n").map((l) => l.trim()).sort().join("|");
  for (const query of queries) {
    const forward = await ask(query, await storeOver(SENSE_MIXED_EDGES));
    const reversed = await ask(query, await storeOver([...SENSE_MIXED_EDGES].reverse()));
    assert.equal(linesOf(forward.answer), linesOf(reversed.answer), `"${query}" answered differently on reversed input`);
    assert.equal(!!forward.record?.miss, !!reversed.record?.miss, `"${query}" changed its miss verdict on reversed input`);
  }
});
