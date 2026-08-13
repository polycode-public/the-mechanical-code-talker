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
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn, renderUnionLine, renderEnumerationLine } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createInMemoryStore, appendFacts, appendRule, readFactRows, loadMemory } from "../../src/adapters/memory/core.mjs";
import { saveBlock, retrieveBlocks } from "../../src/adapters/memory/blocks.mjs";
import { factOrderKey, compareFactsByContent } from "../../src/domain/memory/fact-order.mjs";
import { rankByBiasThenTrust } from "../../src/domain/memory/bias.mjs";
import { buildNewsItems } from "../../src/domain/news-feed.mjs";
import { renderMemory } from "../../src/adapters/memory/inspect.mjs";
import { selectFacts } from "../../src/domain/digest/select.mjs";
import { closerRootsFor } from "../../src/domain/digest/compose.mjs";
import { computeLedgerDataFromPayload, computeLedgerStats } from "../../src/services/ledger-viz.mjs";
import { deriveSubClassClosure, deriveTypePropagation } from "../../src/domain/syllogise.mjs";
import { buildTableauKb, findTableauViolations } from "../../src/domain/tableau.mjs";
import { compileDomain, stateFromFacts, stateKeyFor, movesFromRules } from "../../src/domain/domain.mjs";
import { ask as askGraph } from "../../src/domain/ask.mjs";

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

// ---- the chat layer's own sorts over store-derived data (chat.mjs) --------
// Every case-only pair the digest tests use is folded away here: fact terms
// go through normFactTerm, which lowercases. What survives the fold is an
// accent. Codepoint order puts every accented letter after the whole ASCII
// alphabet; locale collation files it next to its base letter, so "bull"
// leads "bétail" by codepoint and trails it under any locale-aware sort.
// Each pair below is chosen so the two orders disagree, which is what makes
// these assertions a locale check rather than a restatement of the code.

const LOCALE_SPLIT = ["bull", "bétail"];
const localeFirst = (pair) => [...pair].sort((a, b) => a.localeCompare(b))[0];
const codepointFirst = (pair) => [...pair].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];

test("the accented pair these chat checks rely on really does split the two orders", () => {
  assert.equal(codepointFirst(LOCALE_SPLIT), "bull");
  assert.equal(localeFirst(LOCALE_SPLIT), "bétail");
  assert.equal(codepointFirst(["zebra", "ñandu"]), "zebra");
  assert.equal(localeFirst(["zebra", "ñandu"]), "ñandu");
});

test("a union line reads the same both ways round, and in codepoint order", () => {
  const node = { subject: "herd animal", predicate: "rdfs:subClassOf", object: "u1", provenance: "corpus:pasture" };
  const member = (object) => ({ subject: "u1", predicate: "owl:unionOf", object, provenance: "corpus:pasture" });
  const [x, y] = LOCALE_SPLIT;
  const forward = renderUnionLine(node, [member(x), member(y)]);
  assert.equal(forward, "every herd animal is a bull or a bétail (source: corpus:pasture)");
  assert.equal(renderUnionLine(node, [member(y), member(x)]), forward);
});

test("an enumeration line reads the same both ways round, and in codepoint order", () => {
  const member = (object) => ({ subject: "creature", predicate: "owl:oneOf", object, provenance: "corpus:fauna" });
  const forward = renderEnumerationLine("creature", [member("zebra"), member("ñandu")]);
  assert.equal(forward, "the creatures are exactly zebra and ñandu (source: corpus:fauna)");
  assert.equal(renderEnumerationLine("creature", [member("ñandu"), member("zebra")]), forward);
});

// Two someValuesFrom restrictions on one class, both over the asked filler,
// so the existential chase has a real choice of which one to cite back.
const RESTRICTION_ROWS = [
  fact("heart", "rdfs:subClassOf", "rbull"),
  fact("rbull", "owl:onProperty", "tmct:contains"),
  fact("rbull", "owl:someValuesFrom", "valve"),
  fact("heart", "rdfs:subClassOf", "rbétail"),
  fact("rbétail", "owl:onProperty", "tmct:holds"),
  fact("rbétail", "owl:someValuesFrom", "valve"),
];

test("an existential restriction answer cites the same premise however the rows arrived", async () => {
  const answers = await renderingsAcrossArrivals(RESTRICTION_ROWS, "does a heart contain a valve");
  const [first, ...rest] = answers;
  assert.equal(first, "yes — heart is a kind of rbull (source: corpus:test)");
  for (const other of rest) assert.equal(other, first);
});

test("/capabilities lists taught action families in codepoint order, whichever was taught first", async () => {
  const rules = LOCALE_SPLIT.map((name) => ({
    name, kind: "action-signature", slots: { subjectClass: `${name}-subject`, targetClass: `${name}-target` },
  }));
  const listings = [];
  for (const [i, order] of [rules, [...rules].reverse()].entries()) {
    const memoryDir = createInMemoryStore();
    for (const r of order) await appendRule(memoryDir, { ...r, provenance: "corpus:test" });
    const answer = (await ask("/capabilities", memoryDir, `caps-${i}`)).answer;
    listings.push(answer.split("\n").filter((line) => line.includes("taught:")));
  }
  assert.deepEqual(listings[0], [
    "  taught:bull — subject: bull-subject, target: bull-target",
    "  taught:bétail — subject: bétail-subject, target: bétail-target",
  ]);
  assert.deepEqual(listings[1], listings[0]);
});

// ---- block retrieval's own tiebreak (adapters/memory/blocks.mjs) ----------
// This one decides WHICH blocks come back, not just what order they print in:
// two blocks tied on score and rank, k=1, and the id comparison alone picks
// the winner. A locale-aware comparison would hand a different block's text
// to the reader off the same store.

test("a tied block set retrieves the same block, in codepoint order by id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-block-order-"));
  const shared = "the herd grazes on the upland pasture at dawn";
  for (const id of LOCALE_SPLIT) await saveBlock(dir, { id, text: shared });
  // A third, unrelated block keeps the query tokens off every block, so their
  // idf weight stays above zero and the pair scores at all.
  await saveBlock(dir, { id: "decoy", text: "compilers emit bytecode for a virtual machine" });

  const query = "herd grazes upland pasture";
  const both = await retrieveBlocks(dir, query, 3);
  assert.equal(both[0].score, both[1].score, "the pair really is tied on score");
  assert.equal(both[0].rank, both[1].rank, "the pair really is tied on rank");
  assert.deepEqual((await retrieveBlocks(dir, query, 1)).map((b) => b.id), ["bull"]);
});

// ---- the reasoning layer: order decides the CONCLUSION, not the listing ----
// Everything above checks that one fact set renders the same bytes whatever
// order it arrived in. The derivation and query layers raise the stakes: their
// sorts get read at [0], or cut at a budget, or walked as a rule-firing order,
// so the comparator picks which fact the engine concludes FROM. A locale-
// dependent compare there lets two machines forward-chain one graph into two
// different fact sets, or answer one question with two different commits.
//
// "zebra" against "éclair" is the pair that separates the two orders: codepoint
// puts "zebra" first (z is 0x7A, é is 0x00E9), while locale collation files é
// beside e and puts "éclair" first. Both survive normFactTerm's lowercasing,
// which a case-only pair like "Bravo"/"apple" would not.

test("locale and codepoint disagree about the pair the reasoning proofs rest on", () => {
  assert.ok("zebra" < "éclair", "codepoint puts zebra first");
  assert.ok("zebra".localeCompare("éclair") > 0, "locale puts éclair first");
});

// ---- syllogise.mjs: the budget cut, and the premise the proof cites --------

test("a budget-limited subclass closure keeps the codepoint-first derivation, not the locale-first one", () => {
  // Two independent two-hop chains, each entailing exactly one new edge. A
  // budget of 1 admits one of them, and the candidate sort alone decides
  // which — so this pins a DERIVED FACT SET, not a row order.
  const edges = [
    ["éclair", "pastry"], ["pastry", "food"],
    ["zebra", "equine"], ["equine", "animal"],
  ];
  const derived = deriveSubClassClosure(edges, { budget: 1 });
  assert.equal(derived.length, 1);
  assert.deepEqual(derived[0], { subject: "zebra", object: "animal", via: "equine" });
});

test("a subclass closure cites the codepoint-first middle term as the premise it reasoned through", () => {
  // One conclusion (fennec ⊑ carnivore) reachable through two middle terms.
  // Dedup keeps the first candidate per (subject, object) key, so the
  // comparator picks which premise the derivation records in `via` — the fact
  // a proof goes on to name. The two middles are otherwise interchangeable.
  const edges = [
    ["fennec", "élevage"], ["élevage", "carnivore"],
    ["fennec", "vulpine"], ["vulpine", "carnivore"],
  ];
  const derived = deriveSubClassClosure(edges, { budget: 50 });
  const hit = derived.find((d) => d.subject === "fennec" && d.object === "carnivore");
  assert.equal(hit.via, "vulpine", "locale order would cite élevage instead");
});

test("type propagation under a budget derives the same facts however the type edges arrived", () => {
  const subClassEdges = [["équidé", "mammal"], ["zebra", "équidé"], ["mammal", "animal"]];
  const typeEdges = [["marty", "zebra"], ["ouessant", "équidé"], ["stripes", "mammal"]];
  const [first, ...rest] = arrivalOrders(typeEdges).map((order) =>
    deriveTypePropagation(order, subClassEdges, { budget: 3 })
      .map((d) => `${d.subject}|${d.object}|${d.via}`));
  assert.equal(first.length, 3, "the budget bites, so the cut is what's under test");
  for (const other of rest) assert.deepEqual(other, first);
});

// ---- tableau.mjs: the KB the prover reads, and the verdict it returns ------

test("the tableau KB is identical however the OWL rows arrived, and orders its assertions by codepoint", () => {
  const rows = [
    { id: "f1", subject: "zebra", predicate: "rdfs:subClassOf", object: "equine" },
    { id: "f2", subject: "éclair", predicate: "rdfs:subClassOf", object: "pastry" },
    { id: "f3", subject: "marty", predicate: "rdf:type", object: "zebra" },
    { id: "f4", subject: "élodie", predicate: "rdf:type", object: "éclair" },
    { id: "f5", subject: "equine", predicate: "owl:disjointWith", object: "pastry" },
  ];
  const shapeOf = (kb) => JSON.stringify({
    axioms: kb.axioms.map((a) => a.from.join(",")),
    assertions: kb.assertions.map((a) => a.ind),
    individuals: kb.individuals,
  });
  const [first, ...rest] = arrivalOrders(rows).map((order) => shapeOf(buildTableauKb(order)));
  for (const other of rest) assert.equal(other, first);
  assert.deepEqual(buildTableauKb(rows).assertions.map((a) => a.ind), ["marty", "élodie"],
    "locale collation would file élodie beside e and put it first");
});

test("a tableau contradiction verdict and its premises survive any arrival order of the rows", () => {
  // élodie is typed into two disjoint classes, so the prover must find her
  // unsatisfiable and name the same rows for it every time.
  const rows = [
    { id: "f1", subject: "élodie", predicate: "rdf:type", object: "zebra" },
    { id: "f2", subject: "élodie", predicate: "rdf:type", object: "éclair" },
    { id: "f3", subject: "zebra", predicate: "owl:disjointWith", object: "éclair" },
    { id: "f4", subject: "marty", predicate: "rdf:type", object: "zebra" },
  ];
  const [first, ...rest] = arrivalOrders(rows).map((order) =>
    findTableauViolations(buildTableauKb(order))
      .map((v) => `${v.subject}|${v.kind}|${[...v.premises].join(",")}`));
  assert.equal(first.length, 1, "exactly one individual contradicts itself");
  assert.match(first[0], /^élodie\|/);
  for (const other of rest) assert.deepEqual(other, first);
});

// ---- domain.mjs: which plan the planner finds -----------------------------

test("the planner walks taught actions in codepoint order, so one taught domain yields one first move", () => {
  // Two action families whose names separate the two orders. movesFromRules
  // walks domain.actions in compiled order and the planner takes the first
  // shortest path it reaches, so the action order IS the plan chosen when two
  // moves are equally good.
  const rules = [
    { id: "r1", name: "zap", kind: "action-signature", slots: { subjectClass: "token", targetClass: "slot" } },
    { id: "r2", name: "zap", kind: "action-effect", slots: { predicate: "sit-on", subjectRole: "subject", objectRole: "target" } },
    { id: "r3", name: "élever", kind: "action-signature", slots: { subjectClass: "token", targetClass: "slot" } },
    { id: "r4", name: "élever", kind: "action-effect", slots: { predicate: "sit-on", subjectRole: "subject", objectRole: "target" } },
  ];
  const facts = [
    { subject: "t1", predicate: "rdfs:subClassOf", object: "token" },
    { subject: "s1", predicate: "rdfs:subClassOf", object: "slot" },
    { subject: "s2", predicate: "rdfs:subClassOf", object: "slot" },
    { subject: "t1", predicate: "mgx:sit-on", object: "s1" },
  ];
  const domain = compileDomain(facts, rules);
  assert.deepEqual(domain.actions.map((a) => a.name), ["zap", "élever"],
    "locale order would compile élever first and hand the planner a different first move");
  assert.equal(movesFromRules(stateFromFacts(facts, domain), domain)[0].action.name, "zap");
});

test("a compiled domain, its state and its legal moves are identical however the taught rows arrived", () => {
  const facts = [
    { subject: "t1", predicate: "rdfs:subClassOf", object: "token" },
    { subject: "t2", predicate: "rdfs:subClassOf", object: "token" },
    { subject: "épée", predicate: "rdfs:subClassOf", object: "slot" },
    { subject: "s1", predicate: "rdfs:subClassOf", object: "slot" },
    { subject: "t1", predicate: "mgx:sit-on", object: "s1" },
    { subject: "t2", predicate: "mgx:sit-on", object: "épée" },
  ];
  const rules = [
    { id: "r1", name: "put on", kind: "action-signature", slots: { subjectClass: "token", targetClass: "slot" } },
    { id: "r2", name: "put on", kind: "action-effect", slots: { predicate: "sit-on", subjectRole: "subject", objectRole: "target" } },
  ];
  const [first, ...rest] = arrivalOrders(facts).map((order) => {
    const domain = compileDomain(order, rules);
    const state = stateFromFacts(order, domain);
    return `${stateKeyFor(state)}\n--\n${movesFromRules(state, domain).map((m) => m.action.label).join("|")}`;
  });
  for (const other of rest) assert.equal(other, first);
});

// ---- ask.mjs: which commit the answer names -------------------------------

const commitGraph = (individuals, relations) => ({
  individuals, byId: new Map(individuals.map((i) => [i.id, i])), relations, truncated: [], proseIndex: {},
});

const datedCommit = (sha, date, author) => ({
  id: `commit:${sha}`, label: sha.slice(0, 12), class: "Commit",
  attributes: [{ key: "date", value: date }, { key: "author", value: author }],
});

test("\"who last touched X\" names one commit however the graph's edges were walked", () => {
  // Three commits share a date, so the date sort ties outright and the id
  // tiebreak is the whole answer. Without one the reply names whichever commit
  // the edge walk reached first — the same arrival-order leak the fold above
  // closes, routed through the code graph instead of the fact listing.
  const DATE = "2026-08-01T09:00:00Z";
  const mod = { id: "module:app.mjs", label: "app.mjs", class: "Module" };
  const commits = [
    datedCommit("aaaaaaaaaaaa0000", DATE, "ada"),
    datedCommit("cccccccccccc0000", DATE, "cyd"),
    datedCommit("bbbbbbbbbbbb0000", DATE, "bo"),
  ];
  const edges = commits.map((c) => ({ subject: c.id, object: mod.id }));
  const [first, ...rest] = arrivalOrders(edges).map((order) =>
    askGraph(commitGraph([mod, ...commits], [{ predicate: "seon:touches", edges: order }]),
      "who last touched app.mjs").content);
  for (const other of rest) assert.equal(other, first);
  assert.match(first, /ada/, "the codepoint-smallest commit id breaks the dated tie");
});

test("\"the latest commit\" resolves to one commit however the graph listed them", () => {
  const commits = [
    datedCommit("aaaaaaaaaaaa0000", "2026-08-02T09:00:00Z", "ada"),
    datedCommit("bbbbbbbbbbbb0000", "2026-08-02T09:00:00Z", "bo"),
    datedCommit("cccccccccccc0000", "2026-07-01T09:00:00Z", "cyd"),
  ];
  const [first, ...rest] = arrivalOrders(commits).map((order) =>
    askGraph(commitGraph(order, []), "when was the latest commit").content);
  for (const other of rest) assert.equal(other, first);
  assert.match(first, /aaaaaaaaaaaa/, "the dated tie falls to the codepoint-smallest commit id");
});
