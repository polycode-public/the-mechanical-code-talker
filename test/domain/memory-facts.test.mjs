// The open-vocabulary projection: a page whose only store is taught facts hands
// ask() a graph of those facts, and a question about them answers from the real
// rows. The closed-catalog counterpart is sprite-facts.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { memoryFactGraphPayload, MEMORY_TERM_CLASS } from "../../src/domain/memory-facts.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ask } from "../../src/domain/ask.mjs";
import { createChatSession } from "../../src/surfaces/web/chat-browser-entry.mjs";
import { createLedgerSession } from "../../src/surfaces/web/ledger-browser-entry.mjs";
import { graphAsk } from "../../src/surfaces/web/engine-surface.mjs";

const TAUGHT_ROWS = [
  { id: "fact:1", subject: "blue", predicate: "rdfs:subClassOf", object: "peg" },
  { id: "fact:2", subject: "red", predicate: "rdfs:subClassOf", object: "peg" },
  { id: "fact:3", subject: "peg", predicate: "rdfs:subClassOf", object: "toy" },
  { id: "fact:4", subject: "ann", predicate: "mgx:life-in", object: "paris" },
];

const graphOf = (rows) => parseEntities(memoryFactGraphPayload(rows));
const answerOf = (graph, query) => String(ask(graph, query).content);
const classesOf = (payload, id) => payload.individuals.filter((i) => i.id === id).map((i) => i.class);

test("counts and lists a class nobody wrote into a vocabulary table, straight off a taught membership row", () => {
  const graph = graphOf(TAUGHT_ROWS);
  assert.match(answerOf(graph, "how many pegs are there"), /^2 /);
  assert.match(answerOf(graph, "list pegs"), /blue and red/);
});

test("lists a class over the terms actually taught it, never over a term entailed into it", () => {
  const payload = memoryFactGraphPayload(TAUGHT_ROWS);
  assert.deepEqual(classesOf(payload, "blue"), [MEMORY_TERM_CLASS, "peg"]);

  const subClassEdges = payload.objectProperties.find((g) => g.prop === "rdfs:subClassOf").examples;
  assert.equal(subClassEdges.length, 3, "one edge per stored row, and no derived fourth");

  const answer = answerOf(graphOf(TAUGHT_ROWS), "list toys");
  assert.match(answer, /peg/);
  assert.doesNotMatch(answer, /blue|red/, "a peg taught as a toy does not make every peg a toy here");
});

test("the class a term resolves through is the last one it was taught, not term", () => {
  const payload = memoryFactGraphPayload([
    { subject: "ann", predicate: "rdfs:subClassOf", object: "person" },
    { subject: "ann", predicate: "rdfs:subClassOf", object: "teacher" },
  ]);
  const graph = parseEntities(payload);
  assert.equal(graph.byId.get("ann").class, "teacher");
  assert.match(answerOf(graph, "list persons"), /ann/, "the earlier class stays askable too");
});

test("every term the store mentions is countable, typed or not", () => {
  // blue, red, peg, toy, ann, paris
  assert.match(answerOf(graphOf(TAUGHT_ROWS), "how many terms are there"), /^6 /);
});

test("a row never becomes an individual of its own, so its terms stay unambiguous", () => {
  const rows = [
    { subject: "ann", predicate: "rdf:type", object: "person" },
    { subject: "ann", predicate: "mgx:currently-in", object: "paris" },
  ];
  assert.deepEqual(
    memoryFactGraphPayload(rows).individuals.map((i) => i.id),
    ["ann", "ann", "person", "paris"],
  );
  assert.doesNotMatch(answerOf(graphOf(rows), "where are the persons"), /ambiguous/);
});

test("a taught predicate is never read as a code relation kind, so a code question keeps its honest miss", () => {
  const graph = graphOf([{ subject: "fabric", predicate: "mgx:change", object: "colour" }]);
  const answer = answerOf(graph, "what does fabric touch");
  assert.equal(ask(graph, "what does fabric touch").tmct_ask.miss, true);
  assert.doesNotMatch(answer, /colour/, "a fact about changing colour is not an answer about touching");
});

test("a taught world predicate still reaches the world-relation lane", () => {
  const graph = graphOf([
    { subject: "ann", predicate: "rdf:type", object: "person" },
    { subject: "ann", predicate: "mgx:currently-in", object: "paris" },
  ]);
  assert.match(answerOf(graph, "where are the persons"), /ann is in paris/);
});

test("stays proportional to the store, so a deep taxonomy cannot outgrow the page that has to scan it", () => {
  const rows = [];
  for (let depth = 0; depth < 200; depth++) rows.push({ subject: `c${depth}`, predicate: "rdfs:subClassOf", object: `c${depth + 1}` });
  for (let term = 0; term < 2000; term++) rows.push({ subject: `t${term}`, predicate: "rdf:type", object: `c${term % 200}` });

  // A row contributes at most its two terms and one class entry, whatever the
  // taxonomy above it looks like.
  const payload = memoryFactGraphPayload(rows);
  assert.ok(payload.individuals.length <= rows.length * 3,
    `${payload.individuals.length} individuals from ${rows.length} rows`);
});

test("a row with no object is dropped rather than projected as a half edge", () => {
  const payload = memoryFactGraphPayload([
    { subject: "blue", predicate: "rdfs:subClassOf", object: "" },
    { subject: "", predicate: "rdfs:subClassOf", object: "peg" },
    null,
  ]);
  assert.deepEqual(payload, { individuals: [], objectProperties: [] });
});

for (const [label, open] of [["chat", createChatSession], ["ledger", createLedgerSession]]) {
  test(`the ${label} page's ask route answers over facts taught this session while the turn engine keeps its empty index`, async () => {
    const session = open({});
    await session.turn("blue is a peg");
    await session.turn("red is a peg");

    await session.refreshGraph();
    const { answer, miss } = await graphAsk("list pegs", {}, session);
    assert.equal(miss, false);
    assert.match(answer, /blue and red/);

    const counted = await session.turn("how many modules are there");
    assert.match(counted.answer, /0 modules/, "the turn engine still reads the known-empty code index");
  });
}
