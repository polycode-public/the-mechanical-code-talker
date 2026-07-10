// memory/trust.mjs tests — the pure, deterministic trust function over hand-built
// Source fixtures (PLAN_PROVENANCE_TRUST step (c)): source-type prior, noisy-OR
// corroboration, the bounded recency nudge, and the entailed hook.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTrust, recencyNudge, SOURCE_PRIOR, RECENCY_FLOOR,
  SOURCE_RELIABILITY_MIN, SOURCE_RELIABILITY_MAX,
} from "../src/memory/trust.mjs";

// A fixture Source individual of a given type, as it lives in a memory payload.
const src = (id, type) => ({ id, class: "Source", attributes: [{ prop: "mgx:sourceType", key: "sourceType", value: type }] });

// A fixture Source individual carrying a bounded mgx:sourceReliability nudge
// alongside its type — B1's per-Source actor-level trust attribute.
const srcWithReliability = (id, type, reliability) => ({
  id, class: "Source",
  attributes: [
    { prop: "mgx:sourceType", key: "sourceType", value: type },
    { prop: "mgx:sourceReliability", key: "sourceReliability", value: reliability },
  ],
});

// A fixed "now" so recency is deterministic across runs.
const NOW = Date.parse("2026-07-05T00:00:00.000Z");
const FRESH = "2026-07-05T00:00:00.000Z"; // age 0 → recency 1.0
const round = (n, p = 6) => Number(n.toFixed(p));

test("source-type prior: a lone source scores its prior × a ~1.0 recency (fresh)", () => {
  const sources = {
    "src:operator-chat": src("src:operator-chat", "operator"),
    "src:corpus:conceptnet": src("src:corpus:conceptnet", "corpus"),
    "src:learned:web:abc": src("src:learned:web:abc", "web"),
  };
  const trustOf = (id) => computeTrust({ sourceIds: [id], createdAt: FRESH }, sources, { now: NOW }).score;
  assert.equal(trustOf("src:operator-chat"), SOURCE_PRIOR.operator); // 1.0
  assert.equal(trustOf("src:corpus:conceptnet"), SOURCE_PRIOR.corpus); // 0.7
  assert.equal(trustOf("src:learned:web:abc"), SOURCE_PRIOR.web); // 0.4
});

test("corroboration via noisy-OR: two independent web sources beat one; capped at 1", () => {
  const sources = {
    w1: src("w1", "web"), w2: src("w2", "web"),
    op: src("op", "operator"),
  };
  // 1 − (1−0.4)² = 0.64
  assert.equal(computeTrust({ sourceIds: ["w1", "w2"], createdAt: FRESH }, sources, { now: NOW }).score, 0.64);
  // operator alone is already 1.0; adding a web source can't exceed the cap
  assert.equal(computeTrust({ sourceIds: ["op", "w1"], createdAt: FRESH }, sources, { now: NOW }).score, 1);
  // DISTINCT sources only — a repeated id is not double-counted
  assert.equal(computeTrust({ sourceIds: ["w1", "w1"], createdAt: FRESH }, sources, { now: NOW }).score, 0.4);
});

test("no sources → 0; unknown source id contributes nothing", () => {
  const sources = { op: src("op", "operator") };
  assert.equal(computeTrust({ sourceIds: [], createdAt: FRESH }, sources, { now: NOW }).score, 0);
  assert.equal(computeTrust({ sourceIds: ["ghost"], createdAt: FRESH }, sources, { now: NOW }).score, 0);
});

test("recency nudge is bounded to [0.9, 1.0], half-life decayed, and never dominates", () => {
  assert.equal(recencyNudge(FRESH, NOW), 1); // age 0
  // one half-life old → floor + half the band = 0.95
  const oneHalfLife = new Date(NOW - 30 * 24 * 3600 * 1000).toISOString();
  assert.ok(Math.abs(recencyNudge(oneHalfLife, NOW) - 0.95) < 1e-9);
  // ancient → approaches the floor, never below it
  const ancient = new Date(NOW - 3650 * 24 * 3600 * 1000).toISOString();
  const r = recencyNudge(ancient, NOW);
  assert.ok(r >= RECENCY_FLOOR && r < 0.9001);
  // unknown/unparseable timestamp → 1.0 (no penalty)
  assert.equal(recencyNudge("", NOW), 1);
  assert.equal(recencyNudge("not-a-date", NOW), 1);
});

test("recency breaks ties but never flips a source-type ordering by itself", () => {
  const sources = { op: src("op", "operator"), c: src("c", "corpus") };
  const ancient = new Date(NOW - 3650 * 24 * 3600 * 1000).toISOString();
  // a decade-old operator fact still outranks a brand-new corpus fact
  const oldOp = computeTrust({ sourceIds: ["op"], createdAt: ancient }, sources, { now: NOW }).score;
  const freshCorpus = computeTrust({ sourceIds: ["c"], createdAt: FRESH }, sources, { now: NOW }).score;
  assert.ok(oldOp > freshCorpus, `${oldOp} > ${freshCorpus}: recency is a nudge, not a dominator`);
});

test("determinism: same inputs → byte-identical score + auditable inputs", () => {
  const sources = { op: src("op", "operator"), c: src("c", "corpus") };
  const a = computeTrust({ sourceIds: ["op", "c"], createdAt: FRESH }, sources, { now: NOW });
  const b = computeTrust({ sourceIds: ["op", "c"], createdAt: FRESH }, sources, { now: NOW });
  assert.deepEqual(a, b);
  assert.deepEqual(a.inputs, { sourceTypes: ["corpus", "operator"], corroboration: 2, createdAt: FRESH, recency: 1 });
});

// ---- B1: mgx:sourceReliability — a bounded per-Source nudge on the type prior

test("mgx:sourceReliability absent → byte-identical to current (pre-B1) behavior", () => {
  const withoutAttr = { op: src("op", "operator"), c: src("c", "corpus") };
  const withNeutralAttr = { op: srcWithReliability("op", "operator", 1.0), c: srcWithReliability("c", "corpus", 1.0) };
  for (const sourceIds of [["op"], ["c"], ["op", "c"]]) {
    const a = computeTrust({ sourceIds, createdAt: FRESH }, withoutAttr, { now: NOW });
    const b = computeTrust({ sourceIds, createdAt: FRESH }, withNeutralAttr, { now: NOW });
    assert.deepEqual(b, a, `attribute absent vs. explicit neutral 1.0 must score identically for ${sourceIds}`);
  }
  // and matches the plain fixture numbers from the very first test in this file
  assert.equal(computeTrust({ sourceIds: ["op"], createdAt: FRESH }, withoutAttr, { now: NOW }).score, SOURCE_PRIOR.operator);
});

test("mgx:sourceReliability present: above-neutral raises a source's contribution, below-neutral lowers it", () => {
  const boosted = { w: srcWithReliability("w", "web", SOURCE_RELIABILITY_MAX) }; // 0.4 × 1.5 = 0.6
  const neutral = { w: srcWithReliability("w", "web", 1.0) };                    // 0.4 × 1.0 = 0.4
  const dampened = { w: srcWithReliability("w", "web", SOURCE_RELIABILITY_MIN) }; // 0.4 × 0.5 = 0.2

  const hi = computeTrust({ sourceIds: ["w"], createdAt: FRESH }, boosted, { now: NOW }).score;
  const mid = computeTrust({ sourceIds: ["w"], createdAt: FRESH }, neutral, { now: NOW }).score;
  const lo = computeTrust({ sourceIds: ["w"], createdAt: FRESH }, dampened, { now: NOW }).score;

  assert.ok(hi > mid && mid > lo, `${hi} > ${mid} > ${lo}: reliability nudges the right direction`);
  assert.equal(mid, SOURCE_PRIOR.web, "neutral reliability reproduces the un-nudged prior exactly");
  assert.equal(hi, round(SOURCE_PRIOR.web * SOURCE_RELIABILITY_MAX));
  assert.equal(lo, round(SOURCE_PRIOR.web * SOURCE_RELIABILITY_MIN));
});

test("mgx:sourceReliability: an operator source's effective prior stays capped at 1 (never inflates past the noisy-OR ceiling)", () => {
  // operator prior is already 1.0; a 1.5x reliability nudge must clamp, not
  // push the per-source term above 1 (which would corrupt the noisy-OR math).
  const sources = { op: srcWithReliability("op", "operator", SOURCE_RELIABILITY_MAX) };
  const score = computeTrust({ sourceIds: ["op"], createdAt: FRESH }, sources, { now: NOW }).score;
  assert.equal(score, 1, "clamped to the [0,1] probability ceiling, never 1.5");
});

test("mgx:sourceReliability: an out-of-range or unparseable stored value is clamped/ignored, never trusted blindly", () => {
  const tooHigh = { w: srcWithReliability("w", "web", 9) };
  const tooLow = { w: srcWithReliability("w", "web", -9) };
  const junk = { w: srcWithReliability("w", "web", "not-a-number") };
  assert.equal(computeTrust({ sourceIds: ["w"], createdAt: FRESH }, tooHigh, { now: NOW }).score, round(SOURCE_PRIOR.web * SOURCE_RELIABILITY_MAX));
  assert.equal(computeTrust({ sourceIds: ["w"], createdAt: FRESH }, tooLow, { now: NOW }).score, round(SOURCE_PRIOR.web * SOURCE_RELIABILITY_MIN));
  assert.equal(computeTrust({ sourceIds: ["w"], createdAt: FRESH }, junk, { now: NOW }).score, SOURCE_PRIOR.web, "unparseable → neutral, not zero");
});

test("entailed hook: min(premise trusts) × rule-confidence when premises are supplied; bare prior otherwise", () => {
  const sources = { e: src("e", "entailed") };
  // no premises → the bare entailed prior (0.3)
  assert.equal(computeTrust({ sourceIds: ["e"], createdAt: FRESH }, sources, { now: NOW }).score, SOURCE_PRIOR.entailed);
  // premises supplied → weakest premise × rule confidence
  const withPremises = computeTrust(
    { sourceIds: ["e"], createdAt: FRESH }, sources,
    { now: NOW, premiseTrusts: [0.9, 0.6, 0.8], ruleConfidence: 0.5 },
  );
  assert.equal(withPremises.score, 0.3); // min(0.9,0.6,0.8)=0.6 × 0.5 = 0.30
});
