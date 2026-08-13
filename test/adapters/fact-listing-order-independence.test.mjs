// A read over the fact store is a pure function of the fact SET. Arrival order
// is not part of the set, so the same facts ingested in any order must render
// the same bytes — not merely the same facts on shuffled lines. Two peers hold
// one fact set and their rows arrive in whatever order the mesh delivered them;
// if arrival leaked into a listing, they would answer the same question with
// different text and neither could tell which was right.
//
// The checks below drive the real chat turn, so they cover the whole path a
// reader sees: the fold, the rank, and the line rendering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createInMemoryStore, appendFacts, readFactRows, loadMemory } from "../../src/adapters/memory/core.mjs";
import { factOrderKey, compareFactsByContent } from "../../src/domain/memory/fact-order.mjs";
import { rankByBiasThenTrust } from "../../src/domain/memory/bias.mjs";

const EMPTY_GRAPH = parseEntities({ individuals: [], objectProperties: [] });
const fact = (subject, predicate, object) => ({ subject, predicate, object });

async function storeWith(rows, provenance = "corpus:test") {
  const memoryDir = createInMemoryStore();
  await appendFacts(memoryDir, rows.map((r) => ({ ...r, provenance })));
  return memoryDir;
}

const ask = (query, memoryDir, sessionId) =>
  runTurn(query, { graph: EMPTY_GRAPH, memoryDir, sessionId });

/** Every arrival order worth trying for one fact set: as given, reversed, and
 *  rotated — a fix that only handles reversal would pass the first two. */
const arrivalOrders = (rows) => [
  rows,
  [...rows].reverse(),
  [...rows.slice(2), ...rows.slice(0, 2)],
];

/** The same query against one fact set delivered several ways. Returns each
 *  rendering, so a caller can demand they are byte-identical. */
async function renderingsAcrossArrivals(rows, query) {
  const out = [];
  for (const [i, order] of arrivalOrders(rows).entries()) {
    const memoryDir = await storeWith(order);
    out.push((await ask(query, memoryDir, `arrival-${i}`)).answer);
  }
  return out;
}

const CACHE_FACTS = [
  fact("cache", "mgx:usedFor", "speeding up reads"),
  fact("cache", "rdfs:subClassOf", "store"),
  fact("cache", "mgx:hasProperty", "fast"),
  fact("cache", "mgx:madeOf", "memory"),
  fact("cache", "mgx:causes", "staleness"),
  fact("cache", "mgx:hasPrerequisite", "memory budget"),
];

test("'what do you know about X' renders byte-identical text however the facts arrived", async () => {
  const [first, ...rest] = await renderingsAcrossArrivals(CACHE_FACTS, "what do you know about cache");
  assert.match(first, /6 remembered facts about cache/, first);
  for (const other of rest) assert.equal(other, first);
});

test("'what is a X' renders byte-identical text however the facts arrived", async () => {
  const [first, ...rest] = await renderingsAcrossArrivals(CACHE_FACTS, "what is a cache");
  assert.match(first, /cache is a kind of store/, first);
  for (const other of rest) assert.equal(other, first);
});

test("a class listing renders byte-identical text however the members arrived", async () => {
  const rows = [
    fact("alpha", "rdfs:subClassOf", "letter"),
    fact("beta", "rdfs:subClassOf", "letter"),
    fact("gamma", "rdfs:subClassOf", "letter"),
    fact("delta", "rdfs:subClassOf", "letter"),
    fact("epsilon", "rdfs:subClassOf", "letter"),
  ];
  const [first, ...rest] = await renderingsAcrossArrivals(rows, "list letters");
  for (const other of rest) assert.equal(other, first);
});

test("the listing holds the same facts it always did — order changed, membership did not", async () => {
  const memoryDir = await storeWith(CACHE_FACTS);
  const answer = (await ask("what do you know about cache", memoryDir, "membership")).answer;
  for (const f of CACHE_FACTS) {
    assert.ok(answer.includes(f.object), `${f.object} is still listed: ${answer}`);
  }
});

test("two sources asserting one triple keep a fixed order, whichever was written first", async () => {
  const triple = fact("widget", "mgx:hasProperty", "blue");
  const before = createInMemoryStore();
  await appendFacts(before, [{ ...triple, provenance: "corpus:one" }]);
  await appendFacts(before, [{ ...triple, provenance: "corpus:two" }]);
  const after = createInMemoryStore();
  await appendFacts(after, [{ ...triple, provenance: "corpus:two" }]);
  await appendFacts(after, [{ ...triple, provenance: "corpus:one" }]);
  const a = await ask("what do you know about widget", before, "prov-a");
  const b = await ask("what do you know about widget", after, "prov-b");
  assert.equal(a.answer, b.answer);
});

test("the ranked order is the same list whichever way the fold hands the rows over", async () => {
  const forward = readFactRows(await loadMemory(await storeWith(CACHE_FACTS)));
  const a = rankByBiasThenTrust(forward, {}).map(factOrderKey);
  const b = rankByBiasThenTrust([...forward].reverse(), {}).map(factOrderKey);
  assert.deepEqual(a, b);
});

test("compareFactsByContent separates rows that differ only past the subject", () => {
  const a = fact("cache", "mgx:causes", "staleness");
  const b = fact("cache", "mgx:causes", "stale reads");
  assert.ok(compareFactsByContent(a, b) > 0);
  assert.ok(compareFactsByContent(b, a) < 0);
  assert.equal(compareFactsByContent(a, { ...a }), 0);
});

test("the content key cannot be forged by moving a delimiter between fields", () => {
  // A space-joined key would read both of these as "a b c" and call them equal.
  assert.notEqual(
    factOrderKey({ subject: "a b", predicate: "c", object: "", provenance: "" }),
    factOrderKey({ subject: "a", predicate: "b c", object: "", provenance: "" }),
  );
});
