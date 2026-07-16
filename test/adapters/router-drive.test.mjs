// router-drive.test.mjs — the capability router's product-facing library
// surface: src/router/drive.mjs (buildCapabilityPlanCtx/runCapabilityPlan)
// over a real on-disk graph and the real dispatchTool. Unlike
// test/adapters/router-resolver.test.mjs (which drives the pure router
// machinery directly), this file proves the wiring a library caller invokes —
// all the way to a correct composed answer or an honest refuse. The `tmct
// plan` CLI binary is covered from e2e/plan-cli.test.mjs, and the chat /plan
// command by the planning corpus lane.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ingestSchemaDocs } from "../../src/schema-docs.mjs";
import { buildCapabilityPlanCtx, runCapabilityPlan, declaredCapabilityNames } from "../../src/router/drive.mjs";
import { capabilityPlanDeps } from "../../src/chat.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));

// The known-good composed answers agentbench/cases.jsonl already pins for this
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
