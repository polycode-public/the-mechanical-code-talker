// Bare "john likes mary" stays wrapper-required: it stores NOTHING and gets
// a nudge at the wrapped form ("remember that john likes mary"), which does
// store. Question shapes are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-nvn-${tag}-`));

test("bare 'john likes mary' nudges at the wrapped form and stores nothing", async () => {
  const dir = await mem("nudge");
  try {
    const turn = await runTurn("john likes mary", { config: CONFIG, memoryDir: dir, sessionId: "n1" });
    assert.match(turn.answer, /to store that, say: "remember that john likes mary"/);
    assert.equal(turn.record.miss, true);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the nudge's suggested wrapped form round-trips: 'remember that john likes mary' stores", async () => {
  const dir = await mem("roundtrip");
  try {
    const taught = await runTurn("remember that john likes mary", { config: CONFIG, memoryDir: dir, sessionId: "n2" });
    assert.equal(taught.record.miss, false);
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "john" && r.predicate === "mgx:like" && r.object === "mary"));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'is john happy' is a question, never a nudge, and stores nothing", async () => {
  const dir = await mem("question");
  try {
    const turn = await runTurn("is john happy", { config: CONFIG, memoryDir: dir, sessionId: "n3" });
    // The pre-existing property-question miss ("I don't know anything about
    // "john" yet — teach me directly …") stands; the bare-declarative nudge
    // never claims a question shape.
    assert.doesNotMatch(turn.answer, /to store that, say/);
    assert.match(turn.answer, /I don't know anything about "john" yet/);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an adverb tail ('dog barks loudly') never nudges — the shape wants a name on both sides", async () => {
  const dir = await mem("adverb");
  try {
    const turn = await runTurn("dog barks loudly", { config: CONFIG, memoryDir: dir, sessionId: "n4" });
    assert.doesNotMatch(turn.answer, /to store that, say/);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
