// The capability planner reaching a browser page's own memory store. A page
// that lives on the memory graph hands the engine a known-EMPTY code graph,
// which is nothing to plan over, so `/plan` routes it to
// buildCapabilityPlanCtx's memory-only mode: a term binds against the page's
// world facts, the tool that answers it reads the SAME open store the binding
// used, and a code-graph question refuses by naming the graph it hasn't got.
//
// The empty graph stays exactly where it was, and that is the point. chat.mjs
// reads an empty graph and a missing one differently (noCodeGraph), and a page
// earns its identity-led greeting, its teach pointer and its zero counts from
// the empty one — so the lanes those feed are pinned here beside the planner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createChatSession } from "../../src/surfaces/web/chat-browser-entry.mjs";
import { createLedgerSession } from "../../src/surfaces/web/ledger-browser-entry.mjs";
import { createMudSession } from "../../src/surfaces/web/mud-browser-entry.mjs";
import { createSpriteCatalogSession } from "../../src/surfaces/web/sprites-browser-entry.mjs";
import { appendFacts } from "../../src/adapters/memory/core.mjs";
import { buildCapabilityPlanCtx, runCapabilityPlan, declaredCapabilityNames } from "../../src/domain/router/drive.mjs";
import { capabilityPlanDeps, runTurn } from "../../src/services/chat.mjs";

// A synonym pair plus a related edge — the relation facts the memory-graph
// concept view is built from, written normalised exactly as the store writes
// them.
const RELATION_ROWS = [
  { subject: "couch", predicate: "mgx:synonym", object: "sofa", provenance: "corpus:test" },
  { subject: "sofa", predicate: "mgx:relatedTo", object: "cushion", provenance: "corpus:test" },
];

const mudWorld = {
  name: "mud-garden",
  facts: [
    { subject: "garden", predicate: "rdf:type", object: "room" },
    { subject: "garden", predicate: "mgx:is-origin", object: "true" },
    { subject: "burrow-1", predicate: "rdf:type", object: "room" },
    { subject: "garden", predicate: "mgx:has-exit-down", object: "burrow-1" },
    { subject: "burrow-1", predicate: "mgx:has-exit-up", object: "garden" },
    { subject: "mole-1", predicate: "rdf:type", object: "adventurer" },
    { subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { subject: "mole-1", predicate: "mgx:hasMass", object: "8" },
  ],
  rules: [
    { name: "go", ruleKind: "action-signature", slots: { subjectClass: "adventurer", targetClass: "room" } },
    { name: "go", ruleKind: "action-effect", slots: { predicate: "currently-in", subjectRole: "subject", objectRole: "target" } },
  ],
  opening: "a vegetable garden",
};

test("a page session's /plan grounds a memory-graph request end to end, against that page's own seeded facts", async () => {
  const session = createChatSession({});
  await appendFacts(session.memoryDir, RELATION_ROWS);

  const { answer } = await session.turn("/plan another word for sofa");

  assert.doesNotMatch(answer, /no graph loaded/, "the planner runs on a page that has only a memory store");
  assert.match(answer, /tmct_related/, "the plan names the capability it chose");
  assert.match(answer, /"term":"sofa"/, "the term bound through the memory oracle, not the code graph");
  assert.match(answer, /couch/, "the executed call answered from this session's own store");
});

test("a page session's /plan refuses a code-graph question by naming the missing graph, never by guessing", async () => {
  const session = createChatSession({});
  await appendFacts(session.memoryDir, RELATION_ROWS);

  const { answer } = await session.turn("/plan who calls fnAlpha");

  assert.match(answer, /no plan found/, "a code-graph entity has nothing to bind against here");
  assert.doesNotMatch(answer, /fnAlpha calls|fnAlpha is called/, "the miss is honest — no invented caller list");
});

test("a page session's /plan misses honestly on a term its store has no facts for", async () => {
  const session = createChatSession({});
  await appendFacts(session.memoryDir, RELATION_ROWS);

  const { answer } = await session.turn("/plan another word for wardrobe");

  assert.match(answer, /no plan found/);
  assert.doesNotMatch(answer, /sofa|couch|cushion/, "an unbound term never borrows a neighbour's answer");
});

test("the ledger page reaches the planner over the facts a dock turn just taught it", async () => {
  const session = createLedgerSession({});
  await appendFacts(session.memoryDir, RELATION_ROWS);

  const { answer } = await session.turn("/plan another word for sofa");

  assert.match(answer, /couch/, "the store the page teaches into is the store the planner reads");
});

test("a mud character's window plans over the one shared world store every character acts in", async () => {
  const session = await createMudSession(mudWorld, { characters: ["mole-1"] });
  await appendFacts(session.memoryDir, RELATION_ROWS);

  const { answer } = await session.windows["mole-1"].turn("/plan another word for sofa");

  assert.match(answer, /tmct_related/);
  assert.match(answer, /couch/, "a per-character window plans against the shared memoryDir, not a private empty graph");
});

test("a mud character's ordinary world commands are unchanged by the planner wiring", async () => {
  const session = await createMudSession(mudWorld, { characters: ["mole-1"] });
  const window = session.windows["mole-1"];

  const look = await window.turn("look");
  assert.equal(typeof look.answer, "string");
  assert.ok(look.answer.length > 0, "a world command still answers with no code graph anywhere");

  await window.turn("go down");
  const snap = await session.snapshot();
  assert.equal(snap.state.placements.get("mole-1")?.object, "burrow-1", "the move still lands in the world store");
});

test("the sprites page keeps answering from its seeded rows while the planner runs beside it", async () => {
  const session = await createSpriteCatalogSession({
    factRows: [{ subject: "spider", predicate: "rdf:type", object: "creature" }],
  });
  assert.equal(session.factCount, 1);

  const { answer } = await session.turn("what is a spider");
  assert.match(answer, /creature/, "the page's own seeded rows still answer its own questions");
});

test("the page keeps its known-empty-graph answers: the planner reads the memory store, the chat lanes still read the empty index", async () => {
  const greeting = await createChatSession({}).turn("hello");
  assert.match(greeting.answer, /I'm tmct/, "the identity-led greeting an empty index earns, not the code-graph one a missing index earns");

  const claim = await createChatSession({}).turn("is a dog a mammal");
  assert.match(claim.answer, /you can teach me/, "the teach pointer an empty index earns stays on the answer");

  const count = await createChatSession({}).turn("how many modules are there");
  assert.match(count.answer, /0 modules/, "an empty index counts zero rather than declining as unknown");
});

test("a session holding a real code graph still plans as a code graph, memory store or not", async () => {
  const { loadGraph } = await import("../../src/tools/server.mjs");
  const source = await import("../../src/adapters/source.mjs");
  const config = { graphFile: fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url)) };

  const { answer } = await runTurn("/plan of the modules impacted by a.mjs, which are untested", {
    config, source, graph: await loadGraph(config, source), memoryDir: null, env: {},
  });

  assert.doesNotMatch(answer, /no graph loaded/, "a populated index is never diverted to the memory-only route");
});

test("/plan with neither a code graph nor a memory store still refuses, naming both routes", async () => {
  const { answer } = await runTurn("/plan another word for sofa", {
    config: null, source: null, graph: null, memoryDir: null, env: {},
  });

  assert.match(answer, /no graph loaded/);
  assert.match(answer, /memory store/, "the refusal names the memory route as well as the code graph");
});

test("a memory-only planning context dispatches against the caller's own open store, with no config to derive one from", async () => {
  const session = createChatSession({});
  await appendFacts(session.memoryDir, RELATION_ROWS);

  const ctx = await buildCapabilityPlanCtx({
    ...capabilityPlanDeps(), source: null, config: null, memoryDir: session.memoryDir,
  });
  try {
    assert.equal(ctx.graph, null, "no code graph is built or loaded");
    const result = await runCapabilityPlan("another word for sofa", declaredCapabilityNames(), ctx);
    assert.equal(result.refused, false);
    assert.deepEqual(result.calls, [{ name: "tmct_related", input: { term: "sofa" } }]);
    assert.match(String(result.observed), /couch/,
      "binding and dispatch read one store — an in-memory one no config could have found");
  } finally {
    for (const dispose of ctx.disposers || []) dispose();
  }
});
