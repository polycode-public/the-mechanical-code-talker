// Entailed trust must be premise-derived, not the bare 0.3 floor. That holds
// for cax-dw/cls-svf1 via syllogise()'s materializing batch pass
// (test/syllogise.test.mjs). This file closes the SAME trust-hook gap for
// three later rules — scm-svf1 (`deriveSomeValuesFromSubsumption`), cardinality
// monotonicity (`proveCardinalityAtLeast`), and cax-maxc0
// (`proveMaxCardinalityZeroDenial`) — none of which wired premiseTrusts/
// ruleConfidence at all before this fix (confirmed by grep: only
// CAX_DW_RULE_CONFIDENCE/CLS_SVF1_RULE_CONFIDENCE existed).
//
// scm-svf1 now ALSO joined syllogise()'s batch pass (a genuine, persisted Fact
// — see test/syllogise.test.mjs's own "syllogise: scm-svf1" tests for that
// half). Cardinality monotonicity and cax-maxc0 remain genuinely LIVE-CHASE
// ONLY (src/domain/syllogise.mjs's own CARDINALITY_RULE_CONFIDENCE/
// CAX_MAXC0_RULE_CONFIDENCE doc comments explain why: neither ever produces an
// enumerable Fact for trust.mjs's entailed hook to attach to) — so THEIR
// premise-derived trust is computed live, in chat.mjs, via the shared
// `entailedTrustFrom` helper, and surfaced onto the turn's own `record.
// entailedTrust` (chat.mjs, this session) rather than a stored `mgx:
// trustScore`. These tests exercise that live path end to end via `runTurn`,
// not just the pure kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../src/services/chat.mjs";
import { appendFact, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { CARDINALITY_RULE_CONFIDENCE, CAX_MAXC0_RULE_CONFIDENCE, SCM_SVF_RULE_CONFIDENCE } from "../../src/domain/syllogise.mjs";

const CONFIG = {};
const mem = () => mkdtemp(join(tmpdir(), "tmct-trust-live-"));
const round6 = (n) => Number(n.toFixed(6));

test("cardinality monotonicity: record.entailedTrust is min(premiseTrusts) × CARDINALITY_RULE_CONFIDENCE, not undefined/a flat default", async () => {
  const dir = await mem();
  try {
    await runTurn("every cat has exactly 4 legs", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    const before = readFactRows(await loadMemory(dir));
    const restrictionTrust = before.find((r) => r.predicate === "rdfs:subClassOf" && r.subject === "cat").trust;

    const asked = await runTurn("does every cat have at least 2 legs", { config: CONFIG, memoryDir: dir });
    assert.match(asked.answer, /^yes —/);
    assert.equal(typeof asked.record.entailedTrust, "number", "the live proof carries a computed trust figure, not undefined");
    assert.equal(asked.record.entailedTrust, round6(restrictionTrust * CARDINALITY_RULE_CONFIDENCE));
    assert.ok(asked.record.entailedTrust < restrictionTrust, "strictly below its weakest premise — never outranks a stated fact");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("cardinality monotonicity: mixed trust tiers — min() actually picks the WEAKER premise", async () => {
  const dir = await mem();
  try {
    // "every suite has exactly 3 tests" via the ordinary ACE lane (operator, 1.0),
    // then swap in a corpus-sourced onClass row so the scaffolding sits at a
    // DIFFERENT (lower) tier — min() must pick that up, not just the restriction edge.
    await runTurn("every suite has exactly 3 tests", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    await appendFact(dir, { subject: "suite", predicate: "rdf:type", object: "irrelevant-noop", provenance: "corpus:conceptnet /r/IsA" });
    const before = readFactRows(await loadMemory(dir));
    const restrictionTrust = before.find((r) => r.predicate === "rdfs:subClassOf" && r.subject === "suite").trust;

    const asked = await runTurn("does every suite have at least 2 tests", { config: CONFIG, memoryDir: dir });
    assert.match(asked.answer, /^yes —/);
    assert.equal(asked.record.entailedTrust, round6(restrictionTrust * CARDINALITY_RULE_CONFIDENCE));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("cax-maxc0: record.entailedTrust is min(premiseTrusts) × CAX_MAXC0_RULE_CONFIDENCE, not undefined", async () => {
  const dir = await mem();
  try {
    await runTurn("every cache has at most 0 queues", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    const before = readFactRows(await loadMemory(dir));
    const restrictionTrust = before.find((r) => r.predicate === "rdfs:subClassOf" && r.subject === "cache").trust;

    const asked = await runTurn("does a cache have a queue", { config: CONFIG, memoryDir: dir });
    assert.match(asked.answer, /^no —/);
    assert.equal(typeof asked.record.entailedTrust, "number");
    assert.equal(asked.record.entailedTrust, round6(restrictionTrust * CAX_MAXC0_RULE_CONFIDENCE));
    assert.ok(asked.record.entailedTrust < restrictionTrust, "strictly below its weakest premise");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("scm-svf1 (live chase): record.entailedTrust is min(premiseTrusts) × SCM_SVF_RULE_CONFIDENCE across the WHOLE chain, "
  + "mirrors syllogise()'s own batch-pass trust test for the same rule", async () => {
  const dir = await mem();
  try {
    await runTurn("every pipeline that imports a method is a formatter", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    await runTurn("every pipeline that imports a fixture is a suite", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    // "method ⊑ fixture" at teach-tier (0.95, not operator's 1.0) so min() is
    // meaningfully picking the weaker link, same discipline as the cax-dw/
    // cls-svf1 batch-pass trust tests.
    await appendFact(dir, { subject: "method", predicate: "rdfs:subClassOf", object: "fixture", provenance: "teach:chat:s1" });
    await appendFact(dir, { subject: "e80.mjs", predicate: "rdf:type", object: "some-imports-method", provenance: "ace:chat:s1" });

    const before = readFactRows(await loadMemory(dir));
    const subTrust = before.find((r) => r.predicate === "rdfs:subClassOf" && r.subject === "method" && r.object === "fixture").trust;
    const typeTrust = before.find((r) => r.predicate === "rdf:type" && r.subject === "e80.mjs").trust;
    assert.notEqual(subTrust, typeTrust, "premises must sit at DIFFERENT trust tiers for min() to matter");

    const asked = await runTurn("is e80.mjs a some-imports-fixture", { config: CONFIG, memoryDir: dir });
    assert.match(asked.answer, /^yes —/);
    assert.match(asked.answer, /entailed:someValuesFromSubsumption/, "the schema-level scm-svf1 step is cited honestly, not silently folded in");
    assert.equal(typeof asked.record.entailedTrust, "number");
    assert.equal(asked.record.entailedTrust, round6(Math.min(subTrust, typeTrust) * SCM_SVF_RULE_CONFIDENCE));
    assert.ok(asked.record.entailedTrust < Math.min(subTrust, typeTrust), "strictly below its weakest premise — never outranks a stated fact");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("record shape: a turn that answers via any OTHER lane carries no entailedTrust key at all (byte-identical record shape elsewhere)", async () => {
  const dir = await mem();
  try {
    await runTurn("chat.mjs is a module", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    const asked = await runTurn("what kind of thing is chat.mjs", { config: CONFIG, memoryDir: dir });
    assert.ok(!("entailedTrust" in asked.record), "no entailedTrust key on an unrelated turn's record");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
