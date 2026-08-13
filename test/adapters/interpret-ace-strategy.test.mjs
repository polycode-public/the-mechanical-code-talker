// interpret-ace-strategy.test.mjs — the Stage-2 ACE pipeline adapter
// (interpret/strategies/ace.mjs). Two guarantees: it ADDS declarative-fragment
// reach to interpret(), and it is BYTE-STABLE on the sync parseQuery path
// because runStrategiesSync skips async strategies.

import { test } from "node:test";
import assert from "node:assert/strict";

import { STRATEGIES, runStrategiesSync, interpret } from "../../src/domain/interpret/pipeline.mjs";
import { runAce, aceStrategy } from "../../src/domain/interpret/strategies/ace.mjs";
import { parseQuery } from "../../src/domain/ask.mjs";

test("registration: the ACE strategy is registered, its own class, and ASYNC (so the sync path skips it)", () => {
  assert.ok(STRATEGIES.some((s) => s.id === "ace"), "ace strategy registered");
  assert.equal(aceStrategy.class, "ace-fact", "ACE is its own distinct class");
  const r = aceStrategy.run("every module is a component");
  assert.equal(typeof r.then, "function", "run() returns a Promise — runStrategiesSync will skip it");
});

test("adapter: a CLEAN ACE parse emits one 'ace-fact' candidate; residue-only / miss emits nothing", () => {
  const clean = runAce("every module is a component"); // subClassOf — clean triples
  assert.ok(clean && clean.class === "ace-fact" && clean.candidates.length === 1, "clean fragment -> a candidate");
  // a query sentence that merely LOOKS relation-shaped (ACE residue = 'which') -> null
  assert.equal(runAce("which modules import walk.mjs"), null, "residue-only structural fit contributes nothing");
  assert.equal(runAce("hello there"), null, "a total miss contributes nothing");
});

test("byte-stability: the SYNC path (runStrategiesSync / parseQuery) NEVER sees the ACE strategy", () => {
  // a declarative fragment ACE parses cleanly: the sync path still returns NO
  // ace-fact result, and parseQuery stays null (unchanged from before Stage 2).
  const sync = runStrategiesSync("every module is a component", { nlp: null, raw: "every module is a component" });
  assert.ok(!sync.some((r) => r.class === "ace-fact"), "the sync path skips the async ACE strategy");
  assert.equal(parseQuery("every module is a component", { nlp: null }), null, "parseQuery byte-stable (still null)");
});

test("reach: interpret() DOES gain the ACE reading, as its own class, without displacing a graph-query winner", async () => {
  // nothing graph-query parses -> ACE is the winner (added reach).
  const rec = await interpret("every module is a component", { nlp: null });
  assert.equal(rec.class, "ace-fact");
  // a real query still wins graph-query; interpret()'s winner == parseQuery's parse
  // (ACE is at most a distinct-class alternate, never the winner here).
  const q = "which modules import walk.mjs";
  const rec2 = await interpret(q, { nlp: null });
  assert.equal(rec2.class, "graph-query");
  assert.deepEqual(rec2.parsed, parseQuery(q, { nlp: null }));
});
