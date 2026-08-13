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
import { buildNewsItems } from "../../src/domain/news-feed.mjs";
import { renderMemory } from "../../src/adapters/memory/inspect.mjs";
import { selectFacts } from "../../src/domain/digest/select.mjs";
import { closerRootsFor } from "../../src/domain/digest/compose.mjs";
import { computeLedgerDataFromPayload, computeLedgerStats } from "../../src/services/ledger-viz.mjs";

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

test("the fold hands out exactly the order compareFactsByContent defines", async () => {
  const memory = await loadMemory(await storeWith(CACHE_FACTS));
  const folded = readFactRows(memory);
  const sorted = [...folded].sort(compareFactsByContent);
  assert.deepEqual(folded.map(factOrderKey), sorted.map(factOrderKey));
});

test("compareFactsByContent separates rows that differ only past the subject", () => {
  const a = fact("cache", "mgx:causes", "staleness");
  const b = fact("cache", "mgx:causes", "stale reads");
  assert.ok(compareFactsByContent(a, b) > 0);
  assert.ok(compareFactsByContent(b, a) < 0);
  assert.equal(compareFactsByContent(a, { ...a }), 0);
});

// The two readers below never went through the chat ranker, so neither
// inherited the tiebreak the lanes above got. They read the fold directly: the
// news card build ranks its rows and reads a trust chip off the strongest, and
// /memory samples each class and names the widest-corroborated fact. Both are
// order-independent because the fold hands out content order, so both are
// checked against the bytes rather than against a row list.

const NEWS_WINDOW_MS = 6 * 60 * 60 * 1000;
const NEWS_NOW = "2026-08-08T12:00:00.000Z";
const NEWS_OBSERVED = "2026-08-08T11:00:00.000Z";

/** A fact set wide enough for a card to have something to rank: one hub with
 *  several kinds of edge, two neighbours, and four separate sources so the
 *  trust chip has a real choice to make. */
const CEASEFIRE_FACTS = [
  { ...fact("ceasefire", "mgx:causes", "relief"), provenance: "news:hacker-news@item-1" },
  { ...fact("ceasefire", "rdf:type", "agreement"), provenance: "news:hacker-news@item-1" },
  { ...fact("ceasefire", "mgx:hasProperty", "fragile"), provenance: "research:wikipedia:ceasefire" },
  { ...fact("ceasefire", "rdfs:subClassOf", "truce"), provenance: "research:wikipedia:ceasefire" },
  { ...fact("relief", "rdf:type", "outcome"), provenance: "news:reuters@item-2" },
  { ...fact("truce", "rdf:type", "agreement"), provenance: "research:wikipedia:truce" },
  { ...fact("ceasefire", "mgx:usedFor", "stopping fighting"), provenance: "news:reuters@item-2" },
  { ...fact("ceasefire", "mgx:madeOf", "promises"), provenance: "news:bbc@item-3" },
];

/** The same set stored three ways: as given, reversed, and rotated. Each row
 *  keeps its own provenance, so the orders differ by arrival alone. */
async function storesAcrossArrivals(rows) {
  const stores = [];
  for (const order of arrivalOrders(rows)) {
    const memoryDir = createInMemoryStore();
    await appendFacts(memoryDir, order.map((r) => ({
      ...r, observedAt: NEWS_OBSERVED, createdAt: NEWS_OBSERVED,
    })));
    stores.push(await loadMemory(memoryDir));
  }
  return stores;
}

test("a news card is byte-identical however the facts arrived", async () => {
  const [first, ...rest] = (await storesAcrossArrivals(CEASEFIRE_FACTS)).map(
    (memory) => JSON.stringify(buildNewsItems(readFactRows(memory), {
      now: NEWS_NOW, windowMs: NEWS_WINDOW_MS,
    })),
  );
  const cards = JSON.parse(first);
  assert.ok(cards.length, "the fixture builds at least one card to compare");
  assert.ok(cards.every((c) => c.tier), "every card carries the trust chip tierOf reads off its strongest row");
  for (const other of rest) assert.equal(other, first);
});

test("the /memory listing is byte-identical however the facts arrived", async () => {
  const [first, ...rest] = (await storesAcrossArrivals(CEASEFIRE_FACTS)).map(
    (memory) => renderMemory({ memory, blocks: null }, { verbose: true }),
  );
  assert.match(first, /top facts by trust:/, first);
  for (const other of rest) assert.equal(other, first);
});

test("the content key cannot be forged by moving a delimiter between fields", () => {
  // A space-joined key would read both of these as "a b c" and call them equal.
  assert.notEqual(
    factOrderKey({ subject: "a b", predicate: "c", object: "", provenance: "" }),
    factOrderKey({ subject: "a", predicate: "b c", object: "", provenance: "" }),
  );
});

// ---- the digest layer's own tiebreaks (select.mjs, compose.mjs) -----------
// Neither of these reads the fold directly — both take an already-derived
// list (candidate rows, ancestry chains) and pick among tied entries by
// label. The tiebreak has to be codepoint order for the same reason as the
// fold itself: a locale-dependent pick means two readers holding the same
// graph name a different dominant sense or a different ontology root.

test("selectFacts breaks a tied dominant sense by codepoint order, not locale order", () => {
  // "Bravo" sorts before "apple" in codepoint order (B is 0x42, a is 0x61)
  // but after it under locale-aware collation (which folds case) — so this
  // pair only comes out the same way under both orders by coincidence, and
  // it doesn't here: a locale-aware tiebreak would pick "apple".
  const row = (object) => ({
    id: `isa:${object}`, subject: "critter", predicate: "rdfs:subClassOf", object,
    provenance: "", sourceTypes: ["reference"], trust: 0.5, environments: [],
  });
  const store = {
    totalSubjects: 20, classSubjectCounts: { Bravo: 1, apple: 1 },
    // Disjoint two-deep ancestries: enough evidence for each class to count
    // as real, and no shared ancestor, so the two land in separate clusters
    // of equal (tied) provenance weight.
    subClassEdges: [
      ["Bravo", "topB"], ["topB", "rootB"],
      ["apple", "topA"], ["topA", "rootA"],
    ],
  };
  const out = selectFacts("critter", [row("Bravo"), row("apple")], store, { budget: 5 });
  assert.equal(out.senses.dominantLabel, "Bravo");
});

test("closerRootsFor breaks a tied root count by codepoint order, not locale order", () => {
  const r = (o) => ({ id: o, object: o });
  const chains = { a: ["a", "Bravo"], b: ["b", "apple"] };
  const { roots } = closerRootsFor(chains, [r("a"), r("b")], 1);
  assert.deepEqual(roots, ["Bravo"]);
});

// ---- the ledger viz layer's own tiebreaks (ledger-viz.mjs) -----------------

test("the ledger row listing is byte-identical however the facts arrived", async () => {
  // All three facts share one createdAt so the primary recency sort ties and
  // the id tiebreak is what's under test — arrival order must not leak into
  // which id sorts where.
  const TS = "2026-08-01T00:00:00.000Z";
  const rows = [
    { ...fact("widget", "mgx:hasProperty", "blue"), createdAt: TS },
    { ...fact("widget", "mgx:hasProperty", "green"), createdAt: TS },
    { ...fact("widget", "mgx:hasProperty", "red"), createdAt: TS },
  ];
  const [first, ...rest] = await Promise.all(arrivalOrders(rows).map(async (order) => {
    const memoryDir = createInMemoryStore();
    await appendFacts(memoryDir, order);
    const data = computeLedgerDataFromPayload(await loadMemory(memoryDir), {});
    return data.rows.map((r) => r.id);
  }));
  for (const other of rest) assert.deepEqual(other, first);
});

test("the ledger's corpus-bundle leaderboard breaks a tied count by codepoint order, not locale order", () => {
  const row = (src) => ({ src, p: "rdfs:subClassOf", phrase: "is a kind of", prov: "corpus", trustTier: 1, createdAt: "" });
  const stats = computeLedgerStats([row("corpus:apple"), row("corpus:Bravo")], [], []);
  assert.deepEqual(stats.bundles.map((b) => b.key), ["corpus:Bravo", "corpus:apple"]);
});

test("the ledger's predicate leaderboard breaks a tied count by codepoint order, not locale order", () => {
  const row = (predicate) => ({ p: predicate, phrase: predicate, src: "corpus:x", prov: "corpus", trustTier: 1, createdAt: "" });
  const stats = computeLedgerStats([row("apple"), row("Bravo")], [], []);
  assert.deepEqual(stats.predicates.map((p) => p.predicate), ["Bravo", "apple"]);
});
