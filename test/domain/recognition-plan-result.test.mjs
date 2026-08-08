// recognition-plan-result.test.mjs — runCapabilityPlan's additive
// `recognition` field: a ctx carrying an observed trace also reports what
// that trace fits, and a ctx that carries none sees exactly the loop result
// it always did.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ingestSchemaDocs } from "../../src/tools/schema-docs.mjs";
import { buildCapabilityPlanCtx, runCapabilityPlan } from "../../src/domain/router/drive.mjs";
import { capabilityPlanDeps } from "../../src/services/chat.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const REQUEST = "of the modules impacted by app/lib/a.mjs, which are untested";
const TOOLS = ["tmct_impact", "tmct_untested"];

async function materializeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-recognition-plan-result-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const ingested = ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8")));
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(ingested));
  return dir;
}

const REPO = await materializeFixtureRepo();
after(() => rm(REPO, { recursive: true, force: true }));

async function buildCtx({ trace } = {}) {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  // buildCapabilityPlanCtx destructures a fixed parameter set — a trace rides
  // the ctx the same way runRecognition documents (ctx.trace), set after the
  // ctx is built rather than passed as a constructor option it would drop.
  if (trace) ctx.trace = trace;
  return ctx;
}

test("a plan run over a context with no trace returns exactly the loop result it always did", async () => {
  const ctx = await buildCtx();
  const result = await runCapabilityPlan(REQUEST, TOOLS, ctx);
  assert.equal(result.refused, false);
  assert.deepEqual(result.calls.map((c) => c.name), ["tmct_impact", "tmct_untested"]);
  assert.equal("recognition" in result, false, "no trace on the ctx means no recognition field at all");
});

test("a plan run over a context carrying a trace also reports what the trace fits", async () => {
  const ctx = await buildCtx({ trace: [{ name: "tmct_impact", input: {} }, { name: "tmct_untested", input: {} }] });
  const result = await runCapabilityPlan(REQUEST, TOOLS, ctx);
  assert.ok(result.recognition, "a trace on the ctx produces a recognition field");
  assert.equal(result.recognition.inferredGoal, "goal:coverage-gap");
  assert.equal(result.recognition.reject, false);
  assert.equal(result.recognition.ambiguousGoals, null);
  assert.match(result.recognition.why, /fits goal:coverage-gap/);
});

test("the recognition field never changes the calls, the refusal, or the why", async () => {
  const bare = await runCapabilityPlan(REQUEST, TOOLS, await buildCtx());
  const withTrace = await runCapabilityPlan(REQUEST, TOOLS, await buildCtx({ trace: [{ name: "tmct_impact", input: {} }] }));
  assert.equal(withTrace.refused, bare.refused);
  assert.deepEqual(withTrace.why, bare.why);
  assert.deepEqual(withTrace.calls, bare.calls);
  assert.ok(withTrace.recognition);
});
