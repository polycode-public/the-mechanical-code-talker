// The taught world-goal lane: a taught action family, bridged into the
// capability registry, is SELECTED for a "make every X <verb> <prep> Y"
// request by backward chaining over taught:world-effect and GROUNDED by pure
// simulation over the taught rules — the returned calls are never dispatched.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ingestSchemaDocs } from "../../src/schema-docs.mjs";
import {
  buildCapabilityPlanCtx, runCapabilityPlan, runTaughtPlan, declaredCapabilityNames,
} from "../../src/router/drive.mjs";
import { isCapability } from "../../src/router/registry.mjs";
import { actionFamilies, capabilityFromActionRules } from "../../src/router/taught.mjs";
import { runTurn, capabilityPlanDeps } from "../../src/chat.mjs";
import {
  appendRule, loadMemory, readRuleRows,
  RULE_KIND_ACTION_SIGNATURE, RULE_KIND_ACTION_EFFECT, RULE_KIND_ACTION_CONSTRAINT,
} from "../../src/adapters/memory/core.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));

async function materializeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-taught-plan-repo-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const ingested = ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8")));
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(ingested));
  return dir;
}

const REPO = await materializeFixtureRepo();
const GRAPH = { graphFile: join(REPO, ".tmct", "graph.json") };

// Teach the 3-disk hanoi family + board once, via real chat turns.
const MEMORY = await mkdtemp(join(tmpdir(), "tmct-taught-plan-mem-"));
const TEACH = [
  "remember that disk-1 is a disk.",
  "remember that disk-2 is a disk.",
  "remember that disk-3 is a disk.",
  "remember that peg-a is a peg.",
  "remember that peg-b is a peg.",
  "remember that peg-c is a peg.",
  "disk-1 is smaller than disk-2",
  "disk-1 is smaller than disk-3",
  "disk-2 is smaller than disk-3",
  "you can move a disk onto a peg.",
  "you can move a disk onto a disk.",
  "to move a disk onto a target, nothing may rest on the disk.",
  "to move a disk onto a target, nothing may rest on the target.",
  "to move a disk onto a disk, the disk must be smaller than the target.",
  "moving a disk onto a target makes the disk rest on the target.",
  "disk-1 rests on disk-2.",
  "disk-2 rests on disk-3.",
  "disk-3 rests on peg-a.",
];
for (const sentence of TEACH) {
  const r = await runTurn(sentence, { config: {}, memoryDir: MEMORY, sessionId: "taught-plan" });
  assert.equal(r.record.via, "assert", `teach failed: "${sentence}" -> ${r.answer}`);
}

after(async () => {
  clearCache();
  await rm(REPO, { recursive: true, force: true });
  await rm(MEMORY, { recursive: true, force: true });
});

const WORLD_GOAL = "make every disk rest on peg-c";

test("without a memoryDir the world goal refuses, naming the missing taught operator", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: GRAPH });
  const result = await runCapabilityPlan(WORLD_GOAL, declaredCapabilityNames(), ctx);
  assert.equal(result.refused, true);
  assert.match(String(result.why), /taught/i);
  assert.match(String(result.why), /rest-on/);
});

test("with a memoryDir the lane selects the taught record and simulates the 7-move plan, dispatching nothing", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: GRAPH, memoryDir: MEMORY });
  try {
    assert.ok(isCapability("taught:move onto"), "the ctx registered the taught family");
    assert.equal(ctx.disposers.length, 1);

    // Registration is idempotent: a second ctx over the same store adds nothing.
    const again = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: GRAPH, memoryDir: MEMORY });
    assert.equal(again.disposers.length, 0);

    const tools = declaredCapabilityNames();
    const dispatched = [];
    const realDispatch = ctx.dispatch;
    ctx.dispatch = async (name, input) => { dispatched.push(name); return realDispatch(name, input); };

    const result = await runCapabilityPlan(WORLD_GOAL, tools, ctx);
    assert.equal(result.refused, false);
    assert.equal(result.driver, "taught-0.1.0");
    assert.equal(result.calls.length, 7);
    assert.ok(result.calls.every((c) => c.name === "taught:move onto"));
    assert.deepEqual(result.calls[0].input, { subject: "disk-1", target: "peg-c" });
    assert.ok(result.proof.some((p) => p.pred === "taught:world-effect"), "the proof quotes taught:world-effect");
    assert.match(String(result.observed), /simulated/);
    assert.match(String(result.observed), /never dispatched/);
    assert.equal(dispatched.filter((n) => n.startsWith("taught:")).length, 0, "taught: records are never dispatched");
  } finally {
    for (const d of ctx.disposers) d();
  }
  assert.equal(isCapability("taught:move onto"), false, "the disposers unregistered the taught record");
});

test("runTaughtPlan passes on a non-world-goal request instead of claiming it", async () => {
  const ctx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config: GRAPH, memoryDir: MEMORY });
  try {
    assert.equal(await runTaughtPlan("who calls resolveOne", declaredCapabilityNames(), ctx), null);
  } finally {
    for (const d of ctx.disposers) d();
  }
});

test("a chat /plan world-goal turn consumes the taught action family and unregisters it before the turn ends", async () => {
  const { loadGraph } = await import("../../src/server.mjs");
  const source = await import("../../src/adapters/source.mjs");
  const planned = await runTurn("/plan make every disk rest on peg-c", {
    config: GRAPH, graph: await loadGraph(GRAPH, source), memoryDir: MEMORY, sessionId: "taught-plan-chat",
  });
  assert.match(String(planned.answer), /driver: taught-0\.1\.0/);
  const steps = String(planned.answer).match(/taught:move onto/g) || [];
  assert.equal(steps.length, 7, `expected the 7-move optimum in the reply:\n${planned.answer}`);
  assert.match(String(planned.answer), /simulated/);
  assert.match(String(planned.answer), /never dispatched/);
  // The turn's own cleanup unregistered the taught record: nothing leaks into
  // the process-global registry between turns.
  assert.equal(isCapability("taught:move onto"), false);
});

test("an action-constraint row bridges into the capability record as a precondition entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-taught-constraint-"));
  try {
    await appendRule(dir, {
      name: "haul onto",
      kind: RULE_KIND_ACTION_SIGNATURE,
      slots: { subjectClass: "cargo", targetClass: "zone" },
    });
    await appendRule(dir, {
      name: "haul onto",
      kind: RULE_KIND_ACTION_EFFECT,
      slots: { predicate: "sit-at", subjectRole: "subject", objectRole: "target" },
    });
    await appendRule(dir, {
      name: "haul onto",
      kind: RULE_KIND_ACTION_CONSTRAINT,
      slots: { left: "alpha", right: "beta", guard: "escort" },
    });
    const memory = await loadMemory(dir);
    const families = actionFamilies(readRuleRows(memory));
    assert.equal(families.size, 1);
    const cap = capabilityFromActionRules("haul onto", families.get("haul onto"));
    assert.deepEqual(cap.preconditions, [
      { pred: "taught:world-constraint", left: "alpha", right: "beta", guard: "escort" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
