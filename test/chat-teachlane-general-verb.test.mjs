// HANDOVER.md 2026-07-10 item 2 — a short general-verb or ownership teach
// sentence with NO "remember"/"note" wrapper silently failed to store, with no
// diagnostic at all: "grace mentors alan" and "sam owns TaskController" both
// produced the raw structural wall ("couldn't parse this as a graph
// question…") instead of storing or giving an honest teach-miss message.
//
// Root cause (traced through the real teachLane dispatch, not just isolated
// regex tests): teachLane requires an explicit "remember"/"note" wrapper (the
// `wrapped` variable) before it will even TRY generalVerbTeach — its own call
// site checked `if (wrapped && …)` only, so a bare "grace mentors alan" never
// reached generalVerbTeach at all. Separately, OWNS_TEACH_RE's bare-form gate
// (`chat.mjs` ~line 2350) required the OWNER's name to be Capitalized — "sam"
// (lowercase) failed this check even though the OBJECT, "TaskController", is
// an obviously code-shaped proper name. When neither shape matched and there
// was no wrapper, teachLane's final fallback (`if (!wrapped) return null`)
// returned null SILENTLY — no honest miss text at all — leaving the raw
// structural-grammar wall (already computed earlier in runTurn) to stand as
// the final answer.
//
// The fix: (1) OWNS_TEACH_RE's bare gate now accepts EITHER side capitalized
// (owner OR the owned thing), so "sam owns TaskController" stores. (2) a new,
// narrow BARE path for generalVerbTeach: a wink-nlp POS check (ask-nlp.mjs's
// nlpAdapter) confirms the sentence's first word is a genuine NOUN/PROPN —
// never a VERB — before trying it unwrapped. This is essential, not
// cosmetic: GENERAL_VERB_TEACH_RE's own shape is too permissive to trust bare
// ("tell me a joke" and "explain the class hierarchy to me" match the
// IDENTICAL subject-verb-object shape, with the imperative verb itself
// mistaken for the subject — confirmed live, both POS-tag as VERB, so the
// gate correctly excludes them). The QUESTION_LEAD_RE guard on this bare path
// also runs against correctMisspellings()-normalized text, not the raw typo'd
// text: "wich modules touch model.mjs" (a typo'd real structural question)
// POS-tags its uncorrected "wich" as a bare NOUN (wink's honest fallback for
// any unrecognized token, not a real signal) and would otherwise have been
// mis-stored as a fact instead of left for the structural grammar's own
// typo-tolerant retry to answer for real — this exact case is also pinned by
// the pre-existing test/chatflow-tier6.test.mjs "conversation 5" transcript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { readFactRows, loadMemory } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE_CONFIG = { graphFile: "test/fixtures/entities.fixture.json" };
const WALL = /couldn't parse this as a graph question/;
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-tlgv-${tag}-`));

test("HANDOVER item 2: bare 'sam owns TaskController' (lowercase owner, capitalized owned-thing, no wrapper) stores instead of the raw wall", async () => {
  const dir = await mem("owns-store");
  try {
    const r = await runTurn("sam owns TaskController", { config: FIXTURE_CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.doesNotMatch(r.answer, WALL, `must never be the raw structural wall -> ${r.answer}`);
    assert.equal(r.record.miss, false, `expected a real teach, got: ${r.answer}`);
    assert.match(r.answer, /^noted — remembered: taskcontroller is owned by sam/);

    const rows = readFactRows(await loadMemory(dir));
    const hit = rows.find((f) => f.predicate === "mgx:ownedBy" && f.subject === "taskcontroller" && f.object === "sam");
    assert.ok(hit, "expected a stored mgx:ownedBy fact for taskcontroller/sam");

    // retrievable: the SAME fact reads back via the existing yes/no ownership reader.
    const who = await runTurn("does sam own TaskController", { config: FIXTURE_CONFIG, memoryDir: dir });
    assert.match(who.answer, /^yes — you told me: taskcontroller is owned by sam/);
    assert.equal(who.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 2: bare 'grace mentors alan today' (no wrapper, POS-confirmed noun subject) stores instead of the raw wall", async () => {
  const dir = await mem("mentors-store");
  try {
    const r = await runTurn("grace mentors alan today", { config: FIXTURE_CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.doesNotMatch(r.answer, WALL, `must never be the raw structural wall -> ${r.answer}`);
    assert.equal(r.record.miss, false, `expected a real teach, got: ${r.answer}`);
    assert.match(r.answer, /^noted — remembered: grace mentors alan today/);

    const rows = readFactRows(await loadMemory(dir));
    const hit = rows.find((f) => f.subject === "grace" && f.object === "alan today");
    assert.ok(hit, "expected a stored general-verb fact for grace/alan today");

    // retrievable: the SAME general-verb query reader this codebase already ships.
    const who = await runTurn("does grace mentor alan today", { config: FIXTURE_CONFIG, memoryDir: dir });
    assert.match(who.answer, /^yes — you told me: grace mentors alan today/);
    assert.equal(who.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 2: the exact literal HANDOVER repro 'grace mentors alan' (3 bare words) is at least never the raw structural wall", async () => {
  // At exactly 3 words with no code-ish token, this sentence ALSO trips a
  // SEPARATE, already-documented, out-of-scope bug (isConversational()'s own
  // <=3-word "would-miss" race — HANDOVER.md explicitly rules this out as
  // "a different, unrelated class of bug elsewhere", not this item's target)
  // and resolves via the friendly orientation card instead of storing. That
  // pre-existing, unrelated short-circuit happens BEFORE runTurn ever reaches
  // teachLane at all — this item's fix is the teachLane dispatch bug itself
  // (proven above at 4+ words, and here for the literal, un-lengthened
  // sentence too: at minimum, the raw structural wall never stands, and
  // nothing is silently swallowed with zero diagnostic).
  const dir = await mem("mentors-literal");
  try {
    const r = await runTurn("grace mentors alan", { config: FIXTURE_CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.doesNotMatch(r.answer, WALL, `must never be the raw structural wall -> ${r.answer}`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 2 guard: bare imperative requests with the identical SVO shape are never mis-taught (the false-positive risk a wrapper-required gate exists to prevent)", async () => {
  const dir = await mem("guard-imperative");
  try {
    for (const q of ["tell me a joke", "explain the class hierarchy to me", "install the app please"]) {
      const r = await runTurn(q, { config: FIXTURE_CONFIG, memoryDir: dir, sessionId: "s1" });
      assert.doesNotMatch(r.answer, /^noted — remembered/, `must never mis-teach an imperative -> "${q}" -> ${r.answer}`);
    }
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 0, "none of the imperative requests above may have been silently stored as facts");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 2 guard: a typo'd structural question ('wich modules touch <name>') is left for the structural grammar's own typo tolerance, never mis-taught as a fact", async () => {
  const dir = await mem("guard-typo");
  try {
    const r = await runTurn("wich modules touch createTask", { config: FIXTURE_CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.doesNotMatch(r.answer, /^noted — remembered/, `must never mis-teach a typo'd question -> ${r.answer}`);
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 0, "the typo'd question must never be silently stored as a fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 2 regression: the pre-existing wrapped general-verb shape ('remember X verb Y') is unaffected", async () => {
  const dir = await mem("regression-wrapped");
  try {
    const r = await runTurn("remember margo eats ribs", { config: FIXTURE_CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^noted — remembered: margo eats ribs/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HANDOVER item 2 regression: the pre-existing bare-form OWNS shape (capitalized owner) is unaffected", async () => {
  const dir = await mem("regression-owns-capitalized");
  try {
    const r = await runTurn("Priya owns tasks.mjs", { config: FIXTURE_CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^noted — remembered: tasks\.mjs is owned by priya/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
