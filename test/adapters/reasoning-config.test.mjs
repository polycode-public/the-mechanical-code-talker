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
  assert.equal(cfg.askProveFallback, DEFAULT_REASONING_CONFIG.askProveFallback);
  assert.equal(cfg.askProveSteps, DEFAULT_REASONING_CONFIG.askProveSteps);
  assert.equal(cfg.askProveBranches, DEFAULT_REASONING_CONFIG.askProveBranches);
  assert.equal(cfg.askProveNodes, DEFAULT_REASONING_CONFIG.askProveNodes);
});

test("resolveReasoningConfig: every documented key maps from its snake_case tmct.toml spelling", () => {
  const cfg = resolveReasoningConfig({
    reasoning: {
      syllogise_budget: 10, syllogise_depth: 5, classify_budget: 20, classify_rounds: 6,
      max_environments: 2, prove_steps: 30, prove_branches: 7, prove_nodes: 8,
      ask_prove_fallback: false, ask_prove_steps: 40, ask_prove_branches: 9, ask_prove_nodes: 11,
    },
  });
  assert.deepEqual(cfg, {
    syllogiseBudget: 10, syllogiseDepth: 5, classifyBudget: 20, classifyRounds: 6,
    maxEnvironments: 2, proveSteps: 30, proveBranches: 7, proveNodes: 8,
    askProveFallback: false, askProveSteps: 40, askProveBranches: 9, askProveNodes: 11,
  });
});

test("resolveReasoningConfig: a non-positive or non-integer value falls back to the default rather than propagating garbage", () => {
  const cfg = resolveReasoningConfig({ reasoning: { classify_budget: 0, classify_rounds: -5, prove_steps: 3.5, prove_branches: "nope" } });
  assert.equal(cfg.classifyBudget, DEFAULT_REASONING_CONFIG.classifyBudget);
  assert.equal(cfg.classifyRounds, DEFAULT_REASONING_CONFIG.classifyRounds);
  assert.equal(cfg.proveSteps, DEFAULT_REASONING_CONFIG.proveSteps);
  assert.equal(cfg.proveBranches, DEFAULT_REASONING_CONFIG.proveBranches);
});

test("resolveReasoningConfig: ask_prove_steps = 0 clamps to its default rather than disabling the fallback's budget", () => {
  const cfg = resolveReasoningConfig({ reasoning: { ask_prove_steps: 0 } });
  assert.equal(cfg.askProveSteps, DEFAULT_REASONING_CONFIG.askProveSteps);
});

test("resolveReasoningConfig: ask_prove_fallback = false turns the fallback off, and a corrupt value degrades to its default", () => {
  assert.equal(resolveReasoningConfig({ reasoning: { ask_prove_fallback: false } }).askProveFallback, false);
  assert.equal(resolveReasoningConfig({ reasoning: { ask_prove_fallback: "nope" } }).askProveFallback, DEFAULT_REASONING_CONFIG.askProveFallback);
  assert.equal(resolveReasoningConfig({ reasoning: { ask_prove_fallback: 0 } }).askProveFallback, DEFAULT_REASONING_CONFIG.askProveFallback);
});

test("resolveReasoningConfig: returns a fresh object each call — callers cannot mutate the shipped defaults", () => {
  const a = resolveReasoningConfig(null);
  a.classifyBudget = 999999;
  const b = resolveReasoningConfig(null);
  assert.equal(b.classifyBudget, DEFAULT_REASONING_CONFIG.classifyBudget);
});
