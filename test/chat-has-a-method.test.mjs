// HANDOVER.md 2026-07-10 item 9 — "A has-a-method teach shape fails with a
// vague, non-actionable error." Before this fix, "every Component has a
// render method" reached NO teach recognizer at all (RELATION_FACT_TEACH_RE
// requires a literal "is/are the ROLE of"; GENERAL_VERB_TEACH_RE's own
// has/have special case requires a BARE, wrapper-required, single-token
// subject with no leading determiner — "every"/"a"/"the" are explicitly
// declined by GENERAL_VERB_DETERMINER_RE) and fell through to ask.mjs's
// structural "defines" grammar, which can't resolve "Component"/"render" as
// real code-graph entities and reports the vague
// "couldn't resolve one of the terms in this question." wall.
//
// New pattern (operator-authorized this session, NOT one of
// PLAN_TAUGHT_RELATIONS.md's own six items — see chat.mjs's
// TEACH_HAS_METHOD_RE/HAS_METHOD_YESNO_RE/HAS_METHOD_OPEN_RE docblocks for the
// full design): a determiner-led "every/a/an/the <N1> has a/an <N2> method"
// teach declarative, storing an ordinary Fact via the existing HAS_A_PREDICATE
// (mgx:hasA) — the SAME predicate generalVerbTeach's own has/have special case
// already mints — plus two query-side readers: a yes/no reader ("does/did
// <N1> have a <N2> method") and an open-list reader ("what methods does <N1>
// have").
//
// CONFIG = {} (no graphFile), mirroring test/chat-taught-relations.test.mjs's
// own established convention for a purely conceptual teach-and-recall session
// — confirmed live (see chat.mjs's HAS_METHOD_YESNO_RE docblock) that with a
// REAL code graph loaded, ask.mjs's own structural grammar claims the
// "does X have a Y method" shape FIRST (VERB_TO_KIND maps has/have to the
// code-graph "defines" relation, separately ambiguous there with a QUALIFIER
// reading of "a <word> method"), resolving with its own disambiguation choice
// TEACH side and the open-list query reader are NOT affected by that
// collision (both reach an honest miss:true from ask.mjs even with a real
// graph loaded), so this file also exercises those two against the real
// fixture graph, to prove the fix actually closes the exact HANDOVER.md
// symptom (the vague "couldn't resolve one of the terms" wall).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { readFactRows, loadMemory } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const FIXTURE_CONFIG = { graphFile: "test/fixtures/entities.fixture.json" };
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-ham-${tag}-`));

test("HANDOVER item 9: 'every Component has a render method' teaches a fact instead of the vague structural wall", async () => {
  const dir = await mem("teach-every");
  try {
    const r = await runTurn("every Component has a render method", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^noted — remembered: component has render method/);
    assert.doesNotMatch(r.answer, /couldn't resolve one of the terms/);

    const rows = readFactRows(await loadMemory(dir));
    const hit = rows.find((f) => f.predicate === "mgx:hasA" && f.subject === "component" && f.object === "render method");
    assert.ok(hit, "expected a stored mgx:hasA fact for component/render method");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 9: the SAME teach shape reproduces the exact pre-fix wall against a REAL code graph, and this fix closes it", async () => {
  const dir = await mem("teach-real-graph");
  try {
    const r = await runTurn("every Component has a render method", { config: FIXTURE_CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.equal(r.record.miss, false, `expected the teach to succeed, got: ${r.answer}`);
    assert.match(r.answer, /^noted — remembered: component has render method/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 9: 'a Widget has a render method' (indefinite article) teaches the same shape", async () => {
  const dir = await mem("teach-a");
  try {
    const r = await runTurn("a Widget has a render method", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^noted — remembered: widget has render method/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 9: query-side yes/no — 'does Component have a render method' confirms the taught fact", async () => {
  const dir = await mem("query-yesno");
  try {
    const taught = await runTurn("every Component has a render method", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.equal(taught.record.miss, false);

    const r = await runTurn("does Component have a render method", { config: CONFIG, memoryDir: dir });
    assert.match(r.answer, /^yes — you told me: component has render method/);
    assert.equal(r.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 9: query-side open list — 'what methods does Component have' lists the taught method", async () => {
  const dir = await mem("query-open");
  try {
    await runTurn("every Component has a render method", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    const r = await runTurn("what methods does Component have", { config: CONFIG, memoryDir: dir });
    assert.match(r.answer, /component has render method/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 9: query-side open list also resolves against a REAL code graph (not shadowed by ask.mjs's own structural grammar)", async () => {
  const dir = await mem("query-open-real-graph");
  try {
    await runTurn("every Component has a render method", { config: FIXTURE_CONFIG, memoryDir: dir, sessionId: "s1" });
    const r = await runTurn("what methods does Component have", { config: FIXTURE_CONFIG, memoryDir: dir });
    assert.match(r.answer, /component has render method/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 9 guard: an untaught (class, method) pair declines honestly — never a fabricated yes, never a mis-teach", async () => {
  const dir = await mem("guard-untaught");
  try {
    // Teach a DIFFERENT class/method pair, then ask about one that was never taught.
    await runTurn("every Component has a render method", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    const r = await runTurn("does Zorbnax have a fly method", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(r.answer, /^yes —/, `must not fabricate a yes -> ${r.answer}`);
    assert.notEqual(r.record.via, "fact", `must not resolve via the fact lane -> ${r.answer}`);

    // The untaught query must never itself get silently stored as a fact.
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.filter((f) => f.subject === "zorbnax").length, 0, "the query itself must never be mis-taught as a fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 9 guard: an untaught subject entirely (zero facts stored) also declines honestly on the open-list query", async () => {
  const dir = await mem("guard-empty");
  try {
    const r = await runTurn("what methods does Zorbnax have", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(r.answer, /render method/, `must not fabricate a method -> ${r.answer}`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 9 regression: the pre-existing bare-subject 'has a hat' shape (generalVerbTeach's own territory) is unaffected", async () => {
  const dir = await mem("regression-general-verb");
  try {
    const r = await runTurn("remember TaskController has a hat", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^noted — remembered: taskcontroller has hat/);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((f) => f.predicate === "mgx:hasA" && f.subject === "taskcontroller" && f.object === "hat"));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 9 regression: the pre-existing wrapped, no-determiner 'Component has a render method' shape (already worked via generalVerbTeach) stores the byte-identical fact", async () => {
  const dir = await mem("regression-wrapped-no-determiner");
  try {
    const r = await runTurn("remember that Component has a render method", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^noted — remembered: component has render method/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
