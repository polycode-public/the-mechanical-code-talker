// router-memory-binding.test.mjs — memory-graph binding as a first-class
// parameter kind. A slot declared KINDS.MemoryTerm binds through
// resolveMemoryTerm (the conversational-memory sibling of resolveObject), and
// buildCapabilityPlanCtx builds a working planning context from a memory store
// alone — no code graph anywhere. The code-graph binding path's own coverage
// lives in test/adapters/router-resolver.test.mjs and router-drive.test.mjs;
// this file proves the memory path is a strict addition beside it.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  VOCAB, PRECOND, KINDS, MEMORY_KINDS, registerCapability,
} from "../../src/domain/router/registry.mjs";
import { resolveMemoryTerm, isMemoryTermSlot, resolveOne } from "../../src/domain/router/resolver.mjs";
import { buildCapabilityPlanCtx, runCapabilityPlan, declaredCapabilityNames } from "../../src/domain/router/drive.mjs";
import { capabilityPlanDeps } from "../../src/services/chat.mjs";
import { openConfiguredMemoryBackend, appendFacts } from "../../src/adapters/memory/core.mjs";

// Hand-built fact rows in the readFactRows shape resolveMemoryTerm reads: a
// synonym pair plus a related edge (the SKOS concept tier) and a world
// placement (the fact-term tier). Subjects/objects are written normalised,
// exactly as the store writes them.
const ROWS = [
  { subject: "couch", predicate: "mgx:synonym", object: "sofa", provenance: "corpus:test" },
  { subject: "sofa", predicate: "mgx:relatedTo", object: "cushion", provenance: "corpus:test" },
  { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-3", provenance: "world:test" },
];

// ---- resolveMemoryTerm, the binding oracle ----------------------------------

test("resolveMemoryTerm: a term with synonym/related facts mints a SKOS concept (tier memory-concept)", () => {
  for (const term of ["sofa", "couch", "cushion"]) {
    const r = resolveMemoryTerm(ROWS, term);
    assert.equal(r.ambiguous, false, term);
    assert.equal(r.tier, "memory-concept", term);
    assert.deepEqual(r.match, { label: term, class: "skos:Concept" }, term);
  }
});

test("resolveMemoryTerm: a world-fact subject or object binds with no synonym facts at all (tier memory-fact-term)", () => {
  for (const term of ["spider-1", "cell-3"]) {
    const r = resolveMemoryTerm(ROWS, term);
    assert.equal(r.ambiguous, false, term);
    assert.equal(r.tier, "memory-fact-term", term);
    assert.deepEqual(r.match, { label: term, class: KINDS.MemoryTerm }, term);
  }
});

test("resolveMemoryTerm: case and article variants of a stored term still bind — the store's own normalisation, no fuzzy tier", () => {
  assert.equal(resolveMemoryTerm(ROWS, "Spider-1").tier, "memory-fact-term");
  assert.equal(resolveMemoryTerm(ROWS, "the sofa").tier, "memory-concept");
  assert.equal(resolveMemoryTerm(ROWS, "sofas").match, null, "a near-miss inflection is a miss, never a guess");
});

test("resolveMemoryTerm: an unknown term, an empty term and an empty store all miss honestly", () => {
  assert.deepEqual(resolveMemoryTerm(ROWS, "zzznotaterm"), { match: null });
  assert.deepEqual(resolveMemoryTerm(ROWS, ""), { match: null });
  assert.deepEqual(resolveMemoryTerm([], "sofa"), { match: null });
});

// ---- the registry-driven oracle switch --------------------------------------

test("MEMORY_KINDS names exactly the kinds that bind in the memory graph", () => {
  assert.deepEqual([...MEMORY_KINDS], [KINDS.MemoryTerm]);
});

test("isMemoryTermSlot: keyed on the declared parameter kind, not the arg name or the capability's origin", () => {
  assert.equal(isMemoryTermSlot("tmct_related", "term"), true);
  assert.equal(isMemoryTermSlot("tmct_describe", "symbol"), false);
  assert.equal(isMemoryTermSlot("tmct_search", "query"), false, "a free-text slot is not memory-bound");
  assert.equal(isMemoryTermSlot("no_such_capability", "term"), false);

  const unregister = registerCapability({
    name: "probe_world_position",
    label: "position",
    question: "where a world individual currently is",
    readOnly: true,
    parameters: [{ type: VOCAB.Parameter, name: "place", kind: KINDS.MemoryTerm, arg: "place", required: true, note: "" }],
    preconditions: [
      { type: VOCAB.Precondition, pred: PRECOND.memoryFacts },
      { type: VOCAB.Precondition, pred: PRECOND.resolves, param: "place", as: KINDS.MemoryTerm },
    ],
    effects: { add: [{ type: VOCAB.Effect, pred: "cap:knows", topic: "position", of: "?place" }], del: [] },
  });
  try {
    assert.equal(isMemoryTermSlot("probe_world_position", "place"), true,
      "a runtime-registered capability's MemoryTerm slot is memory-bound by its declared kind alone");
  } finally {
    unregister();
  }
  assert.equal(isMemoryTermSlot("probe_world_position", "place"), false);
});

// ---- resolveOne over a graphless context ------------------------------------

test("resolveOne: a MemoryTerm slot binds through ctx.resolveMemoryTerm with no code graph and no ctx.resolve at all", async () => {
  const dispatched = [];
  const ctx = {
    resolveMemoryTerm: (term) => resolveMemoryTerm(ROWS, term),
    dispatch: async (name, input) => { dispatched.push({ name, input }); return { ok: true, text: "couch [concept:couch]" }; },
  };
  const r = await resolveOne("another word for sofa", ["tmct_related"], ctx);
  assert.ok(!r.refused, r.reason);
  assert.deepEqual(r.selected, { name: "tmct_related", input: { term: "sofa" } });
  assert.ok(r.proof.some((s) => s.pred === "cap:memory-facts" && s.ok), "proof carries the memory-facts gate");
  assert.ok(r.proof.some((s) => s.pred === "cap:resolves" && s.param === "term" && s.value === "sofa" && s.ok),
    "proof carries the memory-graph resolves step with the bound value");
  assert.ok(r.why.some((w) => /resolveMemoryTerm/.test(w)), "the why-chain names the memory oracle");
  assert.deepEqual(dispatched, [{ name: "tmct_related", input: { term: "sofa" } }]);
});

test("resolveOne: a world-fact term with no synonym facts binds a MemoryTerm slot — the memory graph's individuals are reachable", async () => {
  const ctx = {
    resolveMemoryTerm: (term) => resolveMemoryTerm(ROWS, term),
    dispatch: async (name, input) => ({ ok: true, text: `[${name}] ${input.term}` }),
  };
  const r = await resolveOne("what's related to spider-1", ["tmct_related"], ctx);
  assert.ok(!r.refused, r.reason);
  assert.deepEqual(r.selected, { name: "tmct_related", input: { term: "spider-1" } });
  assert.ok(r.why.some((w) => /memory-fact-term/.test(w)), "the why-chain names the fact-term tier");
});

test("resolveOne: a term the memory graph never mentions refuses honestly — never guessed, never code-graph-resolved", async () => {
  const ctx = { resolveMemoryTerm: (term) => resolveMemoryTerm(ROWS, term) };
  const r = await resolveOne("another word for zzznotaterm", ["tmct_related"], ctx);
  assert.equal(r.refused, true);
  assert.deepEqual(r.selected, null);
  assert.match(r.reason, /memory graph holds no facts/);
});

// ---- the memory-only drive context ------------------------------------------
// A throwaway repo whose .tmct/graph.json is NEVER written: no code graph
// exists on disk or in memory. The configured memory backend under the same
// repo root is the one store both sides read — the ctx's own oracles through
// `memoryDir`, and the real dispatchTool through `config`'s repo derivation.

const REPO = await mkdtemp(join(tmpdir(), "tmct-router-memory-only-"));
const CONFIG = { graphFile: join(REPO, ".tmct", "graph.json") };
const BACKEND = await openConfiguredMemoryBackend(REPO);
await appendFacts(BACKEND.dir, ROWS);
after(async () => {
  await BACKEND.close();
  await rm(REPO, { recursive: true, force: true });
});

const memoryOnlyCtx = () => buildCapabilityPlanCtx({
  ...capabilityPlanDeps(), source: null, config: CONFIG, memoryDir: BACKEND.dir,
});

test("buildCapabilityPlanCtx: memory-only mode builds with no code graph and carries the memory oracles", async () => {
  const ctx = await memoryOnlyCtx();
  try {
    assert.equal(ctx.graph, null);
    assert.equal(typeof ctx.resolveMemoryTerm, "function");
    assert.equal(typeof ctx.readTaughtStore, "function");
    assert.deepEqual(ctx.resolve("anything"), { match: null, ambiguous: false, candidates: [] },
      "the code-graph oracle misses every term instead of guessing");
    const bound = await ctx.resolveMemoryTerm("sofa");
    assert.equal(bound.tier, "memory-concept", "the memory oracle reads the seeded store");
  } finally {
    for (const d of ctx.disposers || []) d();
  }
});

test("buildCapabilityPlanCtx: no graph, no source and no memoryDir is a wiring error, stated plainly", async () => {
  await assert.rejects(() => buildCapabilityPlanCtx({ dispatchTool: async () => "" }), /memory-only mode/);
});

test("runCapabilityPlan: a memory-graph question grounds end-to-end through the real tool layer with no code graph anywhere", async () => {
  const ctx = await memoryOnlyCtx();
  try {
    const result = await runCapabilityPlan("another word for sofa", declaredCapabilityNames(), ctx);
    assert.equal(result.refused, false);
    assert.deepEqual(result.calls, [{ name: "tmct_related", input: { term: "sofa" } }]);
    assert.match(String(result.observed), /couch/, "the observed answer carries the real synonym");
    assert.ok(result.proof.some((s) => s.pred === "cap:memory-facts" && s.ok));
    assert.ok(result.proof.some((s) => s.pred === "cap:resolves" && s.param === "term" && s.ok));
  } finally {
    for (const d of ctx.disposers || []) d();
  }
});

test("runCapabilityPlan: a code-graph entity question in a memory-only context refuses honestly at binding", async () => {
  const ctx = await memoryOnlyCtx();
  try {
    const result = await runCapabilityPlan("who calls fnAlpha", declaredCapabilityNames(), ctx);
    assert.equal(result.refused, true);
    assert.equal(result.calls.length, 0);
  } finally {
    for (const d of ctx.disposers || []) d();
  }
});

test("runCapabilityPlan: a no-arg code-graph capability refuses at dispatch, naming the missing code graph", async () => {
  const ctx = await memoryOnlyCtx();
  try {
    const result = await runCapabilityPlan("list the untested symbols", declaredCapabilityNames(), ctx);
    assert.equal(result.refused, true);
    assert.match(`${result.why ?? ""} ${result.c1Why ?? ""}`, /code graph/);
  } finally {
    for (const d of ctx.disposers || []) d();
  }
});

test("runCapabilityPlan: the taught world-goal lane is wired in memory-only mode — an untaught goal refuses by naming the missing operator, never by crashing on the absent graph", async () => {
  const ctx = await memoryOnlyCtx();
  try {
    const result = await runCapabilityPlan("make every disk rest on peg-c", declaredCapabilityNames(), ctx);
    assert.equal(result.refused, true);
    assert.equal(result.driver, "taught-0.1.0");
    assert.match(String(result.why), /teach the action rules first/);
  } finally {
    for (const d of ctx.disposers || []) d();
  }
});
