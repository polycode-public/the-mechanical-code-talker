// chatbench/generate-envelope.mjs tests: buildEnvelope is a pure read+reshape
// over an already-graded run's own product.jsonl + summary.json (no model call,
// no I/O) — see the generator's own file header for why. Since no live chatbench
// judge run's summary.json/product.jsonl was available on this machine when
// these tests were authored, the fixtures below are hand-built to match the
// exact shapes chatbench/run.mjs's product rows and chatbench/judge.mjs's
// computeSummary() actually produce (tier1.pass, overall.{cases,mean,
// hardFailCount,voidCount,tier1PassCount}, samplesPerCase) rather than replaying
// a real run.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildEnvelope, SCHEMA_VERSION } from "../../chatbench/generate-envelope.mjs";

const productRow = (caseId, { tier1Pass = true } = {}) => ({
  caseId,
  tags: ["graded"],
  stamp: "9.9.9",
  tier1: { pass: tier1Pass, baselineFailTurns: [], improvedBaselineTurns: [] },
});

test("buildEnvelope reads tier1PassRate from product alone, over every case whether or not it was judged", () => {
  const productRows = [
    productRow("c1", { tier1Pass: true }),
    productRow("c2", { tier1Pass: true }),
    productRow("c3", { tier1Pass: false }),
    productRow("c4", { tier1Pass: true }), // never judged — still counts toward caseCount/tier1PassRate
  ];
  const summary = {
    stamp: "9.9.9",
    judgeModel: "claude-haiku-4-5-20251001",
    promptVersion: "judge-prompt-v2",
    samplesPerCase: 3,
    overall: { cases: 3, mean: 1.5, hardFailCount: 0, voidCount: 0, tier1PassCount: 2 },
  };
  const env = buildEnvelope({ productRows, summary, stamp: "9.9.9", chatbenchVersion: "9.9.9" });
  assert.equal(env.schemaVersion, SCHEMA_VERSION);
  assert.equal(env.generatedFrom.caseCount, 4);
  assert.equal(env.generatedFrom.judgedCaseCount, 3);
  assert.equal(env.capability.tier1PassRate, 3 / 4);
});

test("buildEnvelope reads hardFailRate/meanScore/voidRate only from the judged subset", () => {
  const productRows = [productRow("c1"), productRow("c2")];
  const summary = {
    stamp: "9.9.9",
    judgeModel: "claude-haiku-4-5-20251001",
    promptVersion: "judge-prompt-v2",
    samplesPerCase: 2,
    overall: { cases: 2, mean: 1.25, hardFailCount: 1, voidCount: 1, tier1PassCount: 2 },
  };
  const env = buildEnvelope({ productRows, summary, stamp: "9.9.9", chatbenchVersion: "9.9.9" });
  assert.equal(env.capability.hardFailRate, 0.5); // 1/2
  assert.equal(env.capability.meanScore, 1.25);
  assert.equal(env.capability.voidRate, 1 / 4); // 1 void / (2 cases * 2 samples)
});

test("buildEnvelope never fabricates a rate when its denominator is zero: no product rows -> null tier1PassRate", () => {
  const summary = {
    stamp: null, judgeModel: null, promptVersion: null, samplesPerCase: null,
    overall: { cases: 0, mean: null, hardFailCount: 0, voidCount: 0, tier1PassCount: 0 },
  };
  const env = buildEnvelope({ productRows: [], summary, stamp: null, chatbenchVersion: "9.9.9" });
  assert.equal(env.capability.tier1PassRate, null);
  assert.equal(env.capability.hardFailRate, null);
  assert.equal(env.capability.voidRate, null);
  assert.equal(env.capability.meanScore, null);
});

test("buildEnvelope degrades to product-only readings when no summary is available at all", () => {
  const productRows = [productRow("c1", { tier1Pass: true }), productRow("c2", { tier1Pass: false })];
  const env = buildEnvelope({ productRows, summary: null, stamp: "9.9.9", chatbenchVersion: "9.9.9" });
  assert.equal(env.capability.tier1PassRate, 0.5);
  assert.equal(env.generatedFrom.judgedCaseCount, 0);
  assert.equal(env.capability.hardFailRate, null);
  assert.equal(env.capability.meanScore, null);
  assert.equal(env.capability.voidRate, null);
});

test("buildEnvelope documents which fields are judge-derived vs deterministic, and that there is no ladder field", () => {
  const env = buildEnvelope({ productRows: [], summary: null, stamp: null, chatbenchVersion: "9.9.9" });
  assert.ok(!("ladder" in env), "CHATBENCH has no gated capability ladder to report");
  const notes = env.notes.join("\n");
  assert.match(notes, /tier1PassRate is DETERMINISTIC and judge-free/);
  assert.match(notes, /JUDGE-DERIVED/);
  assert.match(notes, /no ladder\/rung field/);
  assert.match(notes, /makes zero model calls/);
});
