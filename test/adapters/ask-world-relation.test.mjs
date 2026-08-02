// ask-world-relation.test.mjs — questions over a WORLD predicate, reachable
// through ask.mjs alone: the plural, multi-class listing ("list the locations
// of flies and spiders"), and the same question asked about ONE named
// individual ("where is ann").
//
// Three parts. The first drives ask() over a hand-built world payload, so the
// grammar, the class filter and the honest misses are checked without a game
// running. The second does the same over taught fact rows, where a placement
// arrives as whatever verb someone used rather than as the board's single
// predicate. The third boots the REAL spider-fly engine, ticks it, and asserts
// the answer matches foldSpiderFlyState's own placements exactly — the proof
// that the ask route and the page's fast-path snapshot agree about the board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ask, worldRelationGraphPayload } from "../../src/domain/ask.mjs";
import { WORLD_RELATIONS, WORLD_NOUN_TO_RELATION, WORLD_PREDICATES, locativePreposition } from "../../src/domain/ask-vocab.mjs";
import { memoryFactGraphPayload } from "../../src/domain/memory-facts.mjs";
import { createInMemoryStore, loadMemory, readFactRows, appendFacts } from "../../src/adapters/memory/core.mjs";
import { worldFactRows, agentKindOf, isLiveRenderableAgent, WORLD_NAME } from "../../src/domain/spider-fly-world.mjs";
import { startSpiderFlyGame, runSpiderFlyTick, foldSpiderFlyState } from "../../src/services/spider-fly-turn.mjs";

const BOARD_ROWS = [
  { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
  { subject: "spider-1", predicate: "mgx:feels", object: "calm" },
  { subject: "spider-1", predicate: "mgx:hasMass", object: "15" },
  { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-1-5" },
  { subject: "fly-1", predicate: "mgx:feels", object: "calm" },
  // a later turn moves both and sours the spider's mood
  { subject: "spider-1@turn4", predicate: "mgx:currently-in", object: "cell-3-3" },
  { subject: "spider-1@turn4", predicate: "mgx:feels", object: "angry" },
  { subject: "fly-1@turn4", predicate: "mgx:currently-in", object: "cell-2-4" },
  // a fly that only ever exists as a turn-stamped subject
  { subject: "fly-2@turn4", predicate: "mgx:currently-in", object: "cell-9-9" },
  // board geometry the projection must leave out
  { subject: "cell-2-2", predicate: "rdf:type", object: "cell" },
  { subject: "cell-2-2", predicate: "mgx:has-exit-north", object: "cell-2-1" },
];

const boardGraph = (rows = BOARD_ROWS) =>
  parseEntities(worldRelationGraphPayload(rows, { classOf: agentKindOf }));

test("world-relation listing: 'list the locations of flies and spiders' answers over mgx:currently-in", () => {
  const r = ask(boardGraph(), "list the locations of flies and spiders");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.content, "fly-1 is in cell-2-4; fly-2 is in cell-9-9; spider-1 is in cell-3-3.");
  assert.equal(r.tmct_ask.canonical.machine, "composite(worldRelation)");
});

test("world-relation listing: the equivalent phrasings all reach the same answer", () => {
  const graph = boardGraph();
  const base = ask(graph, "list the locations of flies and spiders").content;
  for (const q of [
    "show me the locations of flies and spiders",
    "list the positions of flies and spiders",
    "what are the locations of flies and spiders",
    "give me the whereabouts of flies and spiders",
    "list the places of spiders and flies",
    "where are the flies and spiders",
    "list the locations of flies, spiders",
  ]) {
    assert.equal(ask(graph, q).content, base, q);
  }
});

test("world-relation listing: the class filter is real — one class lists only its own", () => {
  const graph = boardGraph();
  assert.equal(ask(graph, "list the locations of spiders").content, "spider-1 is in cell-3-3.");
  assert.equal(ask(graph, "where are the flies").content, "fly-1 is in cell-2-4; fly-2 is in cell-9-9.");
});

test("world-relation listing: a singular 'where is the spider' reads the board, not the code index", () => {
  const r = ask(boardGraph(), "where is the spider");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.content, "spider-1 is in cell-3-3.");
});

test("world-relation listing: the mood and mass relations answer the same shape", () => {
  const graph = boardGraph();
  assert.equal(ask(graph, "list the moods of flies and spiders").content, "fly-1 feels calm; spider-1 feels angry.");
  assert.equal(ask(graph, "list the masses of spiders").content, "spider-1 has mass 15.");
});

test("world-relation listing: a turn-stamped row wins over the starting one, and never leaks as its own class", () => {
  const payload = worldRelationGraphPayload(BOARD_ROWS, { classOf: agentKindOf });
  assert.deepEqual(payload.individuals.map((i) => i.id).sort(), ["fly-1", "fly-2", "spider-1"]);
  assert.deepEqual([...new Set(payload.individuals.map((i) => i.class))].sort(), ["fly", "spider"]);
  const placements = payload.objectProperties.find((g) => g.prop === "mgx:currently-in").examples;
  assert.deepEqual(
    placements.map((e) => `${e.subject}=${e.object}`).sort(),
    ["fly-1=cell-2-4", "fly-2=cell-9-9", "spider-1=cell-3-3"],
  );
});

test("world-relation projection: an epoch-stamped subject folds onto its own base, and the newer epoch wins", () => {
  const payload = worldRelationGraphPayload([
    { subject: "fox-1", predicate: "mgx:currently-in", object: "cell-1-1" },
    { subject: "fox-1@turn9", predicate: "mgx:currently-in", object: "cell-2-2" },
    { subject: "fox-1@epoch2@turn1", predicate: "mgx:currently-in", object: "cell-3-3" },
  ], { classOf: agentKindOf });
  assert.deepEqual(payload.individuals.map((i) => i.id), ["fox-1"], "never fox-1@epoch2");
  assert.deepEqual(
    payload.objectProperties.find((g) => g.prop === "mgx:currently-in").examples,
    [{ subject: "fox-1", object: "cell-3-3" }],
    "a recast's turn 1 outranks the previous run's turn 9",
  );
});

test("world-relation projection: board geometry stays out — only WORLD_PREDICATES rows are carried", () => {
  const payload = worldRelationGraphPayload(BOARD_ROWS, { classOf: agentKindOf });
  assert.ok(!payload.individuals.some((i) => i.id.startsWith("cell-")));
  for (const group of payload.objectProperties) assert.ok(WORLD_PREDICATES.includes(group.prop), group.prop);
});

test("world-relation projection: a null from classOf drops the subject entirely", () => {
  const payload = worldRelationGraphPayload(BOARD_ROWS, {
    classOf: (id) => (id.startsWith("fly-") ? "fly" : null),
  });
  assert.deepEqual(payload.individuals.map((i) => i.id).sort(), ["fly-1", "fly-2"]);
});

test("world-relation HONEST MISS: a class with no individual in this graph is never fabricated", () => {
  const graph = boardGraph();
  assert.equal(ask(graph, "list the locations of dogs").tmct_ask.miss, true);
  assert.equal(ask(graph, "list the locations of flies and dogs").tmct_ask.miss, true);
});

test("world-relation HONEST MISS: a real restrictor tail declines rather than silently dropping it", () => {
  const graph = boardGraph();
  const r = ask(graph, "list the locations of flies that are hungry");
  assert.equal(r.tmct_ask.miss, true);
  assert.notEqual(r.content, ask(graph, "list the locations of flies").content);
});

test("world-relation HONEST MISS: a relation with no rows misses instead of borrowing another's", () => {
  const graph = parseEntities(worldRelationGraphPayload(
    [{ subject: "fly-1", predicate: "mgx:currently-in", object: "cell-1-1" }],
    { classOf: agentKindOf },
  ));
  assert.equal(ask(graph, "list the locations of flies").tmct_ask.miss, false);
  assert.equal(ask(graph, "list the moods of flies").tmct_ask.miss, true);
});

test("world-relation listing never intercepts a code-graph question", () => {
  const graph = parseEntities({
    individuals: [
      { id: "m:a", label: "a.mjs", class: "Module" },
      { id: "m:b", label: "b.mjs", class: "Module" },
    ],
    objectProperties: [{ prop: "mgx:importsNamespace", predicate: "imports", examples: [{ subject: "m:a", object: "m:b" }] }],
  });
  // "modules" resolves as a class here, but a code graph carries no world
  // predicate, so the fallback finds nothing and the code answer stands.
  assert.match(ask(graph, "where is a.mjs defined").content, /a\.mjs/);
  assert.equal(ask(graph, "list the locations of modules").tmct_ask.miss, true);
  assert.equal(ask(graph, "which modules import b.mjs").tmct_ask.miss, false);
});

// Pieces named after their own class ("pod-1" in class "pod") tie in the name
// resolver against the word the question uses: "pods" is one edit from the
// "pod" component of every id, and "pod" is a prefix of every label. That tie
// is a reference to the class, not a second reading of the question, so the
// board still answers.
const podBoard = (n) => parseEntities(worldRelationGraphPayload(
  Array.from({ length: n }, (_, i) => ({ subject: `pod-${i + 1}`, predicate: "mgx:currently-in", object: `cell-${i + 1}-1` })),
  { classOf: (id) => id.replace(/-\d+$/, "") },
));

test("a name tie against the pieces' own class noun still answers off the board, at any number of pieces", () => {
  for (const n of [2, 3, 5]) {
    const expected = `${Array.from({ length: n }, (_, i) => `pod-${i + 1} is in cell-${i + 1}-1`).join("; ")}.`;
    for (const q of ["where are the pods", "where is the pod", "list the locations of pods"]) {
      const r = ask(podBoard(n), q);
      assert.equal(r.tmct_ask.ambiguous, false, `${q} (${n} pods)`);
      assert.equal(r.tmct_ask.miss, false, `${q} (${n} pods)`);
      assert.equal(r.content, expected, `${q} (${n} pods)`);
      assert.equal(r.tmct_ask.canonical.machine, "composite(worldRelation)", `${q} (${n} pods)`);
    }
  }
});

test("a real module-name collision keeps its ambiguity — no class in the graph carries that noun", () => {
  const graph = parseEntities({
    individuals: [
      { id: "m:1", label: "src/store.mjs", class: "Module" },
      { id: "m:2", label: "src/core/store.mjs", class: "Module" },
    ],
    objectProperties: [],
  });
  const r = ask(graph, "where is store");
  assert.equal(r.tmct_ask.ambiguous, true);
  assert.match(r.content, /matches more than one module ambiguously/);
  assert.match(r.content, /src\/store\.mjs/);
  assert.match(r.content, /src\/core\/store\.mjs/);
});

test("a module collision inside a live world graph is still an ambiguity, and the world pieces still answer", () => {
  const graph = parseEntities({
    individuals: [
      { id: "m:1", label: "src/store.mjs", class: "Module" },
      { id: "m:2", label: "src/core/store.mjs", class: "Module" },
      { id: "pod-1", label: "pod-1", class: "pod" },
      { id: "pod-2", label: "pod-2", class: "pod" },
    ],
    objectProperties: [{
      prop: "mgx:currently-in",
      predicate: "mgx:currently-in",
      examples: [{ subject: "pod-1", object: "cell-1-1" }, { subject: "pod-2", object: "cell-2-1" }],
    }],
  });
  assert.equal(ask(graph, "where is store").tmct_ask.ambiguous, true);
  assert.equal(ask(graph, "where are the pods").content, "pod-1 is in cell-1-1; pod-2 is in cell-2-1.");
});

// A chat or ledger session stores what a visitor taught, so its placements
// arrive as whatever verb they used, folded with the preposition they said it
// with ("ann lives in paris" -> mgx:life-in) rather than as the single
// predicate a game board writes. memory-facts.mjs projects those rows straight
// through, so this is the graph an individual-level locative fact reaches ask()
// as.
const taughtGraph = (rows) => parseEntities(memoryFactGraphPayload(rows));

const ANN_ROWS = [
  { subject: "ann", predicate: "mgx:life-in", object: "paris" },
  { subject: "ann", predicate: "rdf:type", object: "person" },
];

test("a named individual's taught locative fact answers the bare where question", () => {
  const r = ask(taughtGraph(ANN_ROWS), "where is ann");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.tmct_ask.ambiguous, false);
  assert.equal(r.content, "ann is in paris.");
  assert.equal(r.tmct_ask.canonical.machine, "composite(worldRelation)");
});

test("the auxiliary-fronted and adverb-trailed phrasings of that question reach the same answer", () => {
  const graph = taughtGraph(ANN_ROWS);
  for (const q of ["where does ann live", "where's ann", "where is ann now", "where does ann live now"]) {
    assert.equal(ask(graph, q).content, "ann is in paris.", q);
  }
});

test("the answer reads under the preposition the fact was taught with, never the relation's default", () => {
  const graph = taughtGraph([
    { subject: "cat", predicate: "mgx:sit-under", object: "the table" },
    { subject: "disk-1", predicate: "mgx:rest-on", object: "peg-a" },
  ]);
  assert.equal(ask(graph, "where is cat").content, "cat is under the table.");
  assert.equal(ask(graph, "where is disk-1").content, "disk-1 is on peg-a.");
});

test("two taught locative facts about one subject are both reported — neither supersedes the other", () => {
  const r = ask(taughtGraph([
    { subject: "ann", predicate: "mgx:life-in", object: "paris" },
    { subject: "ann", predicate: "mgx:work-at", object: "the bakery" },
  ]), "where is ann");
  assert.equal(r.content, "ann is in paris; ann is at the bakery.");
});

test("HONEST MISS: an individual with no locative fact keeps the code-location miss", () => {
  const graph = taughtGraph([
    { subject: "ann", predicate: "mgx:like", object: "pizza" },
    { subject: "ann", predicate: "rdf:type", object: "person" },
  ]);
  for (const q of ["where is ann", "where does ann live"]) {
    assert.equal(ask(graph, q).tmct_ask.miss, true, q);
    assert.match(ask(graph, q).content, /no recorded code location/, q);
  }
});

test("HONEST MISS: an individual this graph never heard of is never placed", () => {
  assert.equal(ask(taughtGraph(ANN_ROWS), "where is bob").tmct_ask.miss, true);
});

test("a class noun over taught locative facts lists every member, individual lane or not", () => {
  const r = ask(taughtGraph([
    { subject: "disk-1", predicate: "mgx:rest-on", object: "peg-a" },
    { subject: "disk-2", predicate: "mgx:rest-on", object: "peg-b" },
    { subject: "disk-1", predicate: "rdf:type", object: "disk" },
    { subject: "disk-2", predicate: "rdf:type", object: "disk" },
  ]), "where are the disks");
  assert.equal(r.tmct_ask.ambiguous, false);
  assert.equal(r.content, "disk-1 is on peg-a; disk-2 is on peg-b.");
});

test("a board that states its own placement predicate is unchanged by the taught-locative lane", () => {
  const graph = boardGraph();
  assert.equal(ask(graph, "where are the flies").content, "fly-1 is in cell-2-4; fly-2 is in cell-9-9.");
  assert.equal(ask(graph, "where is spider-1").content, "spider-1 is in cell-3-3.");
  assert.equal(ask(graph, "list the locations of flies and spiders").content, "fly-1 is in cell-2-4; fly-2 is in cell-9-9; spider-1 is in cell-3-3.");
});

test("a graph stating placement outright is not doubled up by its own support rows", () => {
  // A hanoi board carries both: mgx:rest-on says what a disk sits directly on,
  // mgx:currently-in says which peg it ends up standing on. The peg is the
  // answer to "where"; the support row must not be read alongside it.
  const graph = parseEntities({
    individuals: [
      { id: "disk-1", label: "disk-1", class: "disk" },
      { id: "disk-2", label: "disk-2", class: "disk" },
    ],
    objectProperties: [
      { prop: "mgx:rest-on", predicate: "mgx:rest-on", examples: [{ subject: "disk-1", object: "disk-2" }, { subject: "disk-2", object: "peg-a" }] },
      { prop: "mgx:currently-in", predicate: "mgx:currently-in", examples: [{ subject: "disk-1", object: "peg-a" }, { subject: "disk-2", object: "peg-a" }] },
    ],
  });
  assert.equal(ask(graph, "where are the disks").content, "disk-1 is in peg-a; disk-2 is in peg-a.");
});

test("locativePreposition reads the folded tail, and only the folded tail", () => {
  assert.equal(locativePreposition("mgx:rest-on"), "on");
  assert.equal(locativePreposition("mgx:life-in"), "in");
  assert.equal(locativePreposition("mgx:work-at"), "at");
  assert.equal(locativePreposition("mgx:hide-inside"), "inside");
  for (const p of ["mgx:feels", "mgx:hasMass", "mgx:smaller-than", "mgx:top-disk", "mgx:moves-onto", "mgx:usedFor", ""]) {
    assert.equal(locativePreposition(p), null, p);
  }
});

test("WORLD_RELATIONS: every listing noun maps back to exactly one relation, and none collides with a code entity noun", async () => {
  const { ENTITY_TO_TYPE } = await import("../../src/domain/ask-vocab.mjs");
  const seen = new Map();
  for (const [token, { nouns, predicate, reads }] of Object.entries(WORLD_RELATIONS)) {
    assert.ok(predicate.startsWith("mgx:"), `${token} should name a stored mgx: predicate`);
    assert.ok(reads, `${token} needs a sentence phrase`);
    for (const noun of nouns) {
      assert.ok(!seen.has(noun), `"${noun}" claimed by both ${seen.get(noun)} and ${token}`);
      seen.set(noun, token);
      assert.equal(WORLD_NOUN_TO_RELATION[noun], token);
      assert.ok(!ENTITY_TO_TYPE[noun], `"${noun}" collides with the code-graph entity noun table`);
    }
  }
});

test("the live spider-fly board answers through ask() and agrees with the engine's own fold", async () => {
  const memoryDir = createInMemoryStore();
  await appendFacts(memoryDir, [...worldFactRows()].map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: `world:${WORLD_NAME}`,
  })));
  await startSpiderFlyGame(memoryDir, { flyCount: 2 });
  for (let i = 0; i < 4; i += 1) await runSpiderFlyTick(memoryDir, {});

  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldSpiderFlyState(rows);
  const graph = parseEntities(worldRelationGraphPayload(rows, {
    classOf: (id) => (isLiveRenderableAgent(id, state) ? agentKindOf(id) : null),
  }));

  const expected = [...state.placements.entries()]
    .filter(([id]) => isLiveRenderableAgent(id, state) && /^(?:spider|fly)-\d+$/.test(id))
    .map(([id, place]) => `${id} is in ${place.cell}`)
    .sort();

  const r = ask(graph, "list the locations of flies and spiders");
  assert.equal(r.tmct_ask.miss, false);
  assert.ok(expected.length >= 2, "sanity: the ticked board should hold at least a spider and a fly");
  assert.equal(r.content, `${expected.join("; ")}.`);
  // an eaten or starved agent is off the board, so it is never named
  for (const dead of state.removed) assert.ok(!r.content.includes(`${dead} is in`), dead);
});
