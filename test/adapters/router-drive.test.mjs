// router-drive.test.mjs — the capability router's product-facing library
// surface: src/domain/router/drive.mjs (buildCapabilityPlanCtx/runCapabilityPlan)
// over a real on-disk graph and the real dispatchTool. Unlike
// test/adapters/router-resolver.test.mjs (which drives the pure router
// machinery directly), this file proves the wiring a library caller invokes —
// all the way to a correct composed answer or an honest refuse. The `tmct
// plan` CLI binary is covered from test-e2e/plan-cli.test.mjs, and the chat /plan
// command by the planning corpus lane.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ingestSchemaDocs } from "../../src/tools/schema-docs.mjs";
import { buildCapabilityPlanCtx, runCapabilityPlan, declaredCapabilityNames } from "../../src/domain/router/drive.mjs";
import { capabilityPlanDeps } from "../../src/services/chat.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
// A real parsed repo (js-commander), where classes carry far more callable
// members than a plan budget of 8 steps can hop one at a time.
const LARGE_SCALE_GRAPH = fileURLToPath(new URL("../fixtures/large-scale/.tmct/graph.json", import.meta.url));

// The known-good composed answers test-benchmarks/agentbench/cases.jsonl already pins for this
// exact fixture + request (ab-c1-untested-in-impact / ab-c2-what-to-test) — the
// SAME ground truth the router's own benchmark grades against, not a
// hand-derived-here truth this file invents on its own.
const KNOWN_INTERSECT = ["app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "scripts/g.mjs"];
const KNOWN_KEYSTONE = ["app/lib/a.mjs"];

async function materializeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-router-drive-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const ingested = ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8")));
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(ingested));
  return dir;
}

const REPO = await materializeFixtureRepo();
after(() => rm(REPO, { recursive: true, force: true }));

test("runCapabilityPlan: a relative-filter request composes the real intersect answer", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();
  assert.ok(tools.includes("tmct_impact") && tools.includes("tmct_untested"));

  const result = await runCapabilityPlan("of the modules impacted by app/lib/a.mjs, which are untested", tools, ctx);
  assert.equal(result.refused, false);
  assert.equal(result.driver, "resolver-0.8.0");
  assert.deepEqual(result.calls.map((c) => c.name), ["tmct_impact", "tmct_untested"]);
  assert.deepEqual(result.composed, KNOWN_INTERSECT);
});

test("runCapabilityPlan: an ungrounded C1 request escalates to the goal-reasoner's keystone answer", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();

  const result = await runCapabilityPlan("what most needs a test in this codebase", tools, ctx);
  assert.equal(result.refused, false);
  assert.equal(result.driver, "goal-0.8.1");
  assert.deepEqual(result.composed, KNOWN_KEYSTONE);
});

test("runCapabilityPlan: an unresolvable entity is an honest refuse, never a crash or a guess", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();

  const result = await runCapabilityPlan("who calls zzzNoSuchSymbolzzz", tools, ctx);
  assert.equal(result.refused, true);
  assert.equal(result.terminated, true);
  assert.equal(result.calls.length, 0);
  assert.equal(result.composed ?? null, null); // goal-reasoner's refuse() sets composed:null; the resolver leaves it undefined — either way, no answer
  // both C1 (the direct resolver) and C2 (the goal-reasoner) declined — the
  // driver carries BOTH reasons, not just the last one.
  assert.ok(result.why, "carries a why for the final (C2) refusal");
  assert.ok(result.c1Why, "carries the C1 resolver's own refusal reason too");
});

test("runCapabilityPlan: a request over the budget is refused, not silently truncated", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();
  const nineSteps = Array.from({ length: 9 }, (_, i) => `describe app/lib/${String.fromCharCode(97 + (i % 6))}.mjs`).join(" and then ");
  const result = await runCapabilityPlan(nineSteps, tools, ctx);
  assert.equal(result.refused, true);
});

// ---- the member-filter fold, past the hop chain's plan budget --------------

test("member-filter: a class with more callable members than the plan budget still folds, over every member", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: LARGE_SCALE_GRAPH } });
  const tools = declaredCapabilityNames();

  const result = await runCapabilityPlan("which methods of Command end up calling createCommand", tools, ctx);
  assert.equal(result.refused, false, "the answer costs one graph pass, so the hop chain's length must not decide it");
  assert.equal(result.composed.length, 23);
  assert.ok(result.composed.includes("Command.parse") && result.composed.includes("Command.unknownOption"));

  // The trace names exactly the calls that were made: the one grounded members
  // read, and no per-member hop, because none was dispatched.
  assert.deepEqual(result.calls, [{ name: "tmct_members", input: { class: "Command" } }]);
  const fold = result.proof.find((s) => s.step === "graph-fold");
  assert.deepEqual(
    { members: fold.members, hops: fold.hops, condition: fold.condition },
    { members: 99, hops: 0, condition: "createCommand" },
  );
  assert.ok(result.why.some((w) => /no per-member callees hop was dispatched/.test(w)));
});

test("member-filter: a class whose hop chain fits the budget still emits one callees hop per member", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: LARGE_SCALE_GRAPH } });
  const tools = declaredCapabilityNames();

  const result = await runCapabilityPlan("which methods of DualOptions end up calling camelcase", tools, ctx);
  assert.equal(result.refused, false);
  assert.deepEqual(result.calls, [
    { name: "tmct_members", input: { class: "DualOptions" } },
    { name: "tmct_callees", input: { symbol: "DualOptions.constructor" } },
    { name: "tmct_callees", input: { symbol: "DualOptions.valueFromOption" } },
  ]);
  assert.deepEqual(result.composed, ["DualOptions.constructor", "DualOptions.valueFromOption"]);
  assert.equal(result.proof.some((s) => s.step === "graph-fold"), false, "the hops are the trace here, so there is no fold step to stand in for them");
});

// ---- TOOL-7: the observe-and-replan branch --------------------------------

test("runCapabilityPlan: a RECOVER request dispatches the fallback once the primary is OBSERVED empty, signaling recovered:true", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();

  // Button has no recorded callers — the primary comes up empty, so the fallback
  // (describe it) actually fires, and the plan signals the replan rather than
  // treating an unconditional second step as a "recovery".
  const result = await runCapabilityPlan("list the callers of Button, and if there are none, describe it instead", tools, ctx);
  assert.equal(result.refused, false);
  assert.equal(result.recovered, true);
  assert.deepEqual(result.calls, [
    { name: "tmct_callers", input: { symbol: "Button" } },
    { name: "tmct_describe", input: { symbol: "Button" } },
  ]);
});

test("runCapabilityPlan: a RECOVER request whose primary is NOT empty stops after one call — the fallback is never dispatched", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();

  // fnAlpha DOES have a recorded caller (Widget.render calls it) — the guard
  // holds, so the plan stops at the primary alone: the bug this rung exists to
  // fix was the primary getting emitted twice with the fallback tacked on
  // unconditionally, never actually observing the guard.
  const result = await runCapabilityPlan("list the callers of fnAlpha, and if there are none, describe it instead", tools, ctx);
  assert.equal(result.refused, false);
  assert.deepEqual(result.calls, [{ name: "tmct_callers", input: { symbol: "fnAlpha" } }]);
  assert.ok(!result.recovered, "the guard did not hold — no recovery to signal");
});

// ---- TOOL-8: the tied-candidate composer ----------------------------------

test("runCapabilityPlan: a bare term tied between a module and its own test module enumerates BOTH reads, never an arbitrary pick", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();

  const result = await runCapabilityPlan("what depends on b", tools, ctx);
  assert.equal(result.refused, true);
  assert.equal(result.calls.length, 0, "an honest refusal, never an arbitrary pick");
  assert.ok(Array.isArray(result.candidateResults), "carries one dispatched read per tied candidate");
  const names = result.candidateResults.map((c) => `${c.name}(${c.input.module})`).sort();
  assert.deepEqual(names, [
    "tmct_impact(app/lib/b.mjs)",
    "tmct_impact(app/unit-tests/b.test.mjs)",
  ]);
});

test("runCapabilityPlan: a term with a clear best match keeps today's single-call plan — the composer does not fire on a non-tie", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();

  // app/lib/c.mjs carries no test-module sibling in the fixture — a clear best
  // match, so the plan dispatches its one obvious call and never enumerates.
  const result = await runCapabilityPlan("what depends on c", tools, ctx);
  assert.equal(result.refused, false);
  assert.deepEqual(result.calls, [{ name: "tmct_impact", input: { module: "app/lib/c.mjs" } }]);
  assert.equal(result.candidateResults, undefined);
});
