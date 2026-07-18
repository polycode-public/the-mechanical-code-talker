// memory/trust.mjs tests — the pure, deterministic trust function over hand-built
// Source fixtures (PLAN_PROVENANCE_TRUST step (c)): source-type prior, noisy-OR
// corroboration, the bounded recency nudge, and the entailed hook.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeTrust, recencyNudge, SOURCE_PRIOR, RECENCY_FLOOR,
  SOURCE_RELIABILITY_MIN, SOURCE_RELIABILITY_MAX, SOURCE_RELIABILITY_NEUTRAL,
  sessionReliabilityFrom, provenanceTagToSource,
} from "../../src/domain/memory/trust.mjs";
import { appendFact, loadMemory, provSourceClassFor, SOURCE_CLASS } from "../../src/adapters/memory/core.mjs";

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

// ---- B3: sessionReliabilityFrom — actor-level (session-scoped) reliability

test("sessionReliabilityFrom: zero assertions is exactly neutral (no track record, no opinion)", () => {
  assert.equal(sessionReliabilityFrom({ factsAsserted: 0, factsContradicted: 0 }), SOURCE_RELIABILITY_NEUTRAL);
  assert.equal(sessionReliabilityFrom({}), SOURCE_RELIABILITY_NEUTRAL);
});

test("sessionReliabilityFrom: bounded to [MIN, MAX] — a huge clean/dirty track record asymptotically approaches, never exceeds, the edge", () => {
  const nearMax = sessionReliabilityFrom({ factsAsserted: 100000, factsContradicted: 0 });
  const nearMin = sessionReliabilityFrom({ factsAsserted: 100000, factsContradicted: 100000 });
  assert.ok(nearMax <= SOURCE_RELIABILITY_MAX && nearMax > 1.49, `${nearMax} approaches but never exceeds the max`);
  assert.ok(nearMin >= SOURCE_RELIABILITY_MIN && nearMin < 0.51, `${nearMin} approaches but never drops below the min`);
  // negative/garbage inputs never go out of range or throw
  assert.ok(sessionReliabilityFrom({ factsAsserted: -5, factsContradicted: -5 }) >= SOURCE_RELIABILITY_MIN);
  assert.ok(sessionReliabilityFrom({ factsAsserted: NaN, factsContradicted: NaN }) <= SOURCE_RELIABILITY_MAX);
});

test("sessionReliabilityFrom: monotonic — more uncontradicted assertions raise it, more contradictions lower it", () => {
  const grows = [1, 2, 5, 10, 30].map((n) => sessionReliabilityFrom({ factsAsserted: n, factsContradicted: 0 }));
  for (let i = 1; i < grows.length; i += 1) assert.ok(grows[i] >= grows[i - 1], `${grows} must be non-decreasing`);
  assert.ok(grows.at(-1) > grows[0], "a real track record clears a thin one");

  const shrinks = [0, 1, 2, 5, 10].map((c) => sessionReliabilityFrom({ factsAsserted: 10, factsContradicted: c }));
  for (let i = 1; i < shrinks.length; i += 1) assert.ok(shrinks[i] <= shrinks[i - 1], `${shrinks} must be non-increasing`);
  assert.ok(shrinks.at(-1) < shrinks[0], "heavy contradiction clearly beats a clean record down");
});

test("sessionReliabilityFrom: confidence-scaled — a THIN track record (few assertions) stays close to neutral either way", () => {
  const oneGood = sessionReliabilityFrom({ factsAsserted: 1, factsContradicted: 0 });
  const oneBad = sessionReliabilityFrom({ factsAsserted: 1, factsContradicted: 1 });
  // neither a single success nor a single contradiction saturates to the
  // extreme — this is the exact regression this shape fixes: a lone,
  // uncontradicted teach fact must still score below the operator prior
  // (0.95 x reliability < 1.0), which a naive un-scaled formula broke by
  // maxing a single success straight to 1.5.
  assert.ok(oneGood > SOURCE_RELIABILITY_NEUTRAL && oneGood < SOURCE_RELIABILITY_MAX, `${oneGood} stays a modest nudge, not the ceiling`);
  assert.ok(oneBad < SOURCE_RELIABILITY_NEUTRAL && oneBad > SOURCE_RELIABILITY_MIN, `${oneBad} stays a modest nudge, not the floor`);
  assert.ok(SOURCE_PRIOR.teach * oneGood < 1, "a lone uncontradicted teach fact's effective prior still stays under the operator's 1.0");
});

test("sessionReliabilityFrom: deterministic and pure — same inputs, same output, no I/O", () => {
  const a = sessionReliabilityFrom({ factsAsserted: 7, factsContradicted: 2 });
  const b = sessionReliabilityFrom({ factsAsserted: 7, factsContradicted: 2 });
  assert.equal(a, b);
});

// ---- reference: a shipped-pack article as a Source ------------------------

test("a lone reference source scores its 0.6 prior × recency, ranked between corpus and corpusWeak", () => {
  const sources = { ref: src("ref", "reference") };
  assert.equal(SOURCE_PRIOR.reference, 0.6);
  assert.ok(SOURCE_PRIOR.corpus > SOURCE_PRIOR.reference && SOURCE_PRIOR.reference > SOURCE_PRIOR.corpusWeak);
  assert.equal(computeTrust({ sourceIds: ["ref"], createdAt: FRESH }, sources, { now: NOW }).score, SOURCE_PRIOR.reference);
  const oneHalfLife = new Date(NOW - 30 * 24 * 3600 * 1000).toISOString();
  const decayed = computeTrust({ sourceIds: ["ref"], createdAt: oneHalfLife }, sources, { now: NOW }).score;
  assert.equal(decayed, round(SOURCE_PRIOR.reference * recencyNudge(oneHalfLife, NOW)));
});

test("a reference-sourced fact never outranks a teach- or operator-sourced fact on the same triple", () => {
  const sources = { ref: src("ref", "reference"), t: src("t", "teach"), op: src("op", "operator") };
  const ancient = new Date(NOW - 3650 * 24 * 3600 * 1000).toISOString();
  const freshReference = computeTrust({ sourceIds: ["ref"], createdAt: FRESH }, sources, { now: NOW }).score;
  const ancientTeach = computeTrust({ sourceIds: ["t"], createdAt: ancient }, sources, { now: NOW }).score;
  const ancientOperator = computeTrust({ sourceIds: ["op"], createdAt: ancient }, sources, { now: NOW }).score;
  assert.ok(ancientTeach > freshReference, `${ancientTeach} > ${freshReference}: even a decade-old teach fact beats a fresh pack article`);
  assert.ok(ancientOperator > freshReference, `${ancientOperator} > ${freshReference}: the operator always beats the pack`);
});

test("a reference provenance tag round-trips: pack and article split on the first two colons, @revid and spaces kept", () => {
  assert.deepEqual(provenanceTagToSource("reference:simplewiki:Otter@9184482"),
    { kind: "reference", pack: "simplewiki", article: "Otter@9184482" });
  assert.deepEqual(provenanceTagToSource("reference:simplewiki:Polar bear@9184482"),
    { kind: "reference", pack: "simplewiki", article: "Polar bear@9184482" });
  // unknown-tag behaviour unchanged: a near-miss spelling is no Source at all
  assert.equal(provenanceTagToSource("refference:simplewiki:Otter"), null);
  assert.equal(provenanceTagToSource("reference-pack:simplewiki:Otter"), null);
  // and the corpus head-split contract is untouched
  assert.deepEqual(provenanceTagToSource("corpus:conceptnet /r/IsA"), { kind: "corpus", name: "conceptnet" });
});

test("a reference-tagged fact materialises a per-article DocumentSource with sourceType reference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ref-trust-"));
  try {
    await appendFact(dir, {
      subject: "otter", predicate: "rdfs:subClassOf", object: "mammal",
      provenance: "reference:simplewiki:Otter@9184482", createdAt: FRESH,
    });
    const m = await loadMemory(dir);
    const source = m.individuals.find((i) => i.class === SOURCE_CLASS && i.id === "src:reference:simplewiki:Otter@9184482");
    assert.ok(source, "one Source per pack article, id keyed pack:article@revid");
    const typeAttr = source.attributes.find((a) => a.prop === "mgx:sourceType");
    assert.equal(typeAttr?.value, "reference");
    assert.deepEqual(provSourceClassFor("reference"), { subClass: "tmct:DocumentSource", prov: "prov:Entity" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- child pack: a lazy learn-on-miss ConceptNet fact as a Source ---------

test("a child-pack provenance tag parses to the corpus tier — same 0.7 Source as the bulk conceptnet import", () => {
  assert.deepEqual(provenanceTagToSource("child:conceptnet:penguin"),
    { kind: "corpus", name: "conceptnet" });
  // the per-term tail never changes the Source identity: two different misses
  // resolve to the one shared ConceptNet corpus Source
  assert.deepEqual(provenanceTagToSource("child:conceptnet:owl"),
    { kind: "corpus", name: "conceptnet" });
  // a multiword term keeps its spaces in the tag but not in the Source name
  assert.deepEqual(provenanceTagToSource("child:conceptnet:polar bear"),
    { kind: "corpus", name: "conceptnet" });
  // near-miss spellings are no Source at all
  assert.equal(provenanceTagToSource("children:conceptnet:penguin"), null);
});

test("a child-tagged fact scores the 0.7 corpus prior and materialises the shared conceptnet corpus Source", async () => {
  const sources = { c: src("c", "corpus") };
  assert.equal(computeTrust({ sourceIds: ["c"], createdAt: FRESH }, sources, { now: NOW }).score, SOURCE_PRIOR.corpus);
  const dir = await mkdtemp(join(tmpdir(), "tmct-child-trust-"));
  try {
    await appendFact(dir, {
      subject: "penguin", predicate: "rdfs:subClassOf", object: "bird",
      provenance: "child:conceptnet:penguin", createdAt: FRESH,
    });
    const m = await loadMemory(dir);
    const source = m.individuals.find((i) => i.class === SOURCE_CLASS && i.id === "src:corpus:conceptnet");
    assert.ok(source, "a child fact materialises the shared conceptnet corpus Source");
    assert.equal(source.attributes.find((a) => a.prop === "mgx:sourceType")?.value, "corpus");
    const fact = m.individuals.find((i) => i.class === "Fact");
    // the corpus tier, above corpusWeak — the exact value tracks recency from
    // createdAt, so the assertion is the tier band, not a frozen number
    const score = Number(fact.attributes.find((a) => a.prop === "mgx:trustScore")?.value);
    assert.ok(score > SOURCE_PRIOR.corpusWeak && score <= SOURCE_PRIOR.corpus, `${score} sits at the corpus tier`);
    assert.deepEqual(JSON.parse(fact.attributes.find((a) => a.prop === "mgx:trustInputs")?.value).sourceTypes, ["corpus"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
