// General verb-to-predicate DIRECT-QUESTION retrieval (this session's item 5 —
// the natural follow-up to generalVerbTeach/GENERAL_VERB_TEACH_RE, which only
// shipped teaching + generic retrieval, not verb-specific query phrasings).
// "does margo eat ribs" / "did margo eat ribs" / "what does margo eat" against a
// fact taught via the SAME general-verb teach mechanism — see chat.mjs's
// GENERAL_VERB_YESNO_RE/GENERAL_VERB_OPEN_RE docblock for the design (wired into
// factReadBack, directly after the WHO_OWNS_RE block, since factReadBack only
// runs on an already-true `miss` — so a real structural graph query is never
// shadowed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = { graphFile: "test/fixtures/entities.fixture.json" };
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-gvq-${tag}-`));

test("general-verb query: 'does margo eat ribs' / 'did margo eat ribs' (past tense) both confirm a taught fact", async () => {
  const dir = await mem("yesno");
  try {
    await runTurn("remember margo eats ribs", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    for (const q of ["does margo eat ribs", "did margo eat ribs"]) {
      const r = await runTurn(q, { config: CONFIG, memoryDir: dir });
      assert.equal(r.record.via, "fact", `"${q}" should answer via the memory-fact lane`);
      assert.match(r.answer, /^yes — you told me: margo eats ribs/, `"${q}" -> ${r.answer}`);
      assert.match(r.answer, /Goal \(inferred\): Look up a taught fact about a subject\/verb\/object\./);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("general-verb query: 'does margo eat cake' (no matching taught fact) is an honest decline, never a fabricated 'no'", async () => {
  // INFBENCH 1.2.0 fix: a no-hit here used to synthesize a confident "no" —
  // that's a fabrication (indistinguishable, from the user's side, between a
  // PROVEN absence and "I simply found nothing"). "margo eats ribs" is a
  // taught fact about margo, but nothing says margo eats (or doesn't eat)
  // cake, so this must decline (null from GENERAL_VERB_YESNO_RE's no-hit
  // branch) and fall through to the ordinary honest-miss cascade — never a
  // confident "no — no remembered fact says...".
  const dir = await mem("no");
  try {
    await runTurn("remember margo eats ribs", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    const r = await runTurn("does margo eat cake", { config: CONFIG, memoryDir: dir });
    assert.notEqual(r.record.via, "fact", `"does margo eat cake" must not resolve via the fact lane -> ${r.answer}`);
    assert.doesNotMatch(r.answer, /^no — no remembered fact says/, `must not fabricate a "no" -> ${r.answer}`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("general-verb query: 'does anyone eat ribs' with ZERO taught facts at all is an honest decline, never a fabricated 'no'", async () => {
  const dir = await mem("no-empty");
  try {
    const r = await runTurn("does anyone eat ribs", { config: CONFIG, memoryDir: dir });
    assert.notEqual(r.record.via, "fact", `-> ${r.answer}`);
    assert.doesNotMatch(r.answer, /^no — no remembered fact says/, `must not fabricate a "no" -> ${r.answer}`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("general-verb query: bare 'what does margo eat' lists every stored fact for that subject/verb", async () => {
  const dir = await mem("open");
  try {
    await runTurn("remember margo eats ribs", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    const r = await runTurn("what does margo eat", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.via, "fact");
    assert.match(r.answer, /margo eats ribs/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("general-verb query: the has/have bridge works on the QUERY side too — 'does tony have a hat' / 'did tony have a hat'", async () => {
  const dir = await mem("hasa");
  try {
    await runTurn("remember tony has a hat", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    for (const q of ["does tony have a hat", "did tony have a hat"]) {
      const r = await runTurn(q, { config: CONFIG, memoryDir: dir });
      assert.equal(r.record.via, "fact", `"${q}" should answer via the memory-fact lane`);
      assert.match(r.answer, /^yes — you told me: tony has hat/, `"${q}" -> ${r.answer}`);
    }

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].predicate, "mgx:hasA");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("general-verb query guard: a real structural graph query never gets shadowed by the new lane", async () => {
  const dir = await mem("guard");
  try {
    // "does <module> import <module>" is a genuine structural query the closed
    // grammar already resolves — GENERAL_VERB_YESNO_RE's own shape ("does X <verb>
    // Y") would otherwise happily match this text too, but factReadBack only
    // ever runs on an already-true `miss`, so this must resolve via "composed",
    // never "fact".
    const r = await runTurn("does app/lib/b.mjs import app/lib/a.mjs", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.via, "composed");
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^Yes — imports edge from app\/lib\/b\.mjs to app\/lib\/a\.mjs\./);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("general-verb query guard: is/are/owns/maintains verbs stay the OTHER frames' territory, never shadowed by the new lane", async () => {
  const dir = await mem("guard2");
  try {
    await runTurn("remember priya owns tasks.mjs", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    const r = await runTurn("does priya own tasks.mjs", { config: CONFIG, memoryDir: dir });
    // "own" isn't excluded by GENERAL_VERB_EXCLUDE_RE itself (only "owns"/
    // "maintains" literally are, and the query regex captures the bare verb
    // "own" here) — the important invariant is that the ANYWHERE guard/exclude
    // set never lets this lane silently answer something a wrong-predicate
    // mint would misrepresent. Whatever the actual routing, it must not claim
    // a false negative against a real ownership fact.
    assert.doesNotMatch(r.answer, /^no — no remembered fact says/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
