// reasoning-config.test.mjs — the [reasoning] knob resolver: an absent
// tmct.toml (or an absent [reasoning] table) yields every shipped default, a
// set key wins over its default, an unset sibling keeps its default, and a
// corrupt value degrades to the default rather than propagating garbage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REASONING_CONFIG, resolveReasoningConfig } from "../../src/domain/reasoning-config.mjs";

test("resolveReasoningConfig: no toml at all yields every shipped default", () => {
  assert.deepEqual(resolveReasoningConfig(null), DEFAULT_REASONING_CONFIG);
  assert.deepEqual(resolveReasoningConfig(undefined), DEFAULT_REASONING_CONFIG);
});

test("resolveReasoningConfig: a toml with no [reasoning] table yields every shipped default", () => {
  assert.deepEqual(resolveReasoningConfig({}), DEFAULT_REASONING_CONFIG);
});

test("resolveReasoningConfig: a set key wins, every unset sibling keeps its default", () => {
  const cfg = resolveReasoningConfig({ reasoning: { classify_budget: 100000, classify_rounds: 128 } });
  assert.equal(cfg.classifyBudget, 100000);
  assert.equal(cfg.classifyRounds, 128);
  assert.equal(cfg.syllogiseBudget, DEFAULT_REASONING_CONFIG.syllogiseBudget);
  assert.equal(cfg.syllogiseDepth, DEFAULT_REASONING_CONFIG.syllogiseDepth);
  assert.equal(cfg.maxEnvironments, DEFAULT_REASONING_CONFIG.maxEnvironments);
  assert.equal(cfg.proveSteps, DEFAULT_REASONING_CONFIG.proveSteps);
  assert.equal(cfg.proveBranches, DEFAULT_REASONING_CONFIG.proveBranches);
  assert.equal(cfg.proveNodes, DEFAULT_REASONING_CONFIG.proveNodes);
});

test("resolveReasoningConfig: every documented key maps from its snake_case tmct.toml spelling", () => {
  const cfg = resolveReasoningConfig({
    reasoning: {
      syllogise_budget: 10, syllogise_depth: 5, classify_budget: 20, classify_rounds: 6,
      max_environments: 2, prove_steps: 30, prove_branches: 7, prove_nodes: 8,
    },
  });
  assert.deepEqual(cfg, {
    syllogiseBudget: 10, syllogiseDepth: 5, classifyBudget: 20, classifyRounds: 6,
    maxEnvironments: 2, proveSteps: 30, proveBranches: 7, proveNodes: 8,
  });
});

test("resolveReasoningConfig: a non-positive or non-integer value falls back to the default rather than propagating garbage", () => {
  const cfg = resolveReasoningConfig({ reasoning: { classify_budget: 0, classify_rounds: -5, prove_steps: 3.5, prove_branches: "nope" } });
  assert.equal(cfg.classifyBudget, DEFAULT_REASONING_CONFIG.classifyBudget);
  assert.equal(cfg.classifyRounds, DEFAULT_REASONING_CONFIG.classifyRounds);
  assert.equal(cfg.proveSteps, DEFAULT_REASONING_CONFIG.proveSteps);
  assert.equal(cfg.proveBranches, DEFAULT_REASONING_CONFIG.proveBranches);
});

test("resolveReasoningConfig: returns a fresh object each call — callers cannot mutate the shipped defaults", () => {
  const a = resolveReasoningConfig(null);
  a.classifyBudget = 999999;
  const b = resolveReasoningConfig(null);
  assert.equal(b.classifyBudget, DEFAULT_REASONING_CONFIG.classifyBudget);
});
