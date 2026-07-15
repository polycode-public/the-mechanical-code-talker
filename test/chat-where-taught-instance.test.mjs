// "where is disk-1" about a taught individual answers its taught locative
// fact (mgx:rest-on family) instead of dying on the code-graph "no module
// matching" miss — and a teach turn recognized by the teach lane never
// carries a Canonical line restating the structural misparse it overrode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-where-${tag}-`));

async function teachBoard(dir, sessionId) {
  await runTurn("disk-1 is a disk.", { config: CONFIG, memoryDir: dir, sessionId });
  await runTurn("peg-a is a peg.", { config: CONFIG, memoryDir: dir, sessionId });
  return runTurn("disk-1 rests on peg-a.", { config: CONFIG, memoryDir: dir, sessionId });
}

test("'where is disk-1' answers the taught locative fact, not the module miss", async () => {
  const dir = await mem("hit");
  try {
    await teachBoard(dir, "w1");
    const turn = await runTurn("where is disk-1", { config: CONFIG, memoryDir: dir, sessionId: "w1" });
    assert.match(turn.answer, /disk-1 rests on peg-a/);
    assert.match(turn.answer, /source: teach:chat/);
    assert.doesNotMatch(turn.answer, /no module matching/);
    assert.equal(turn.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'where is disk-1 now' tolerates the trailing 'now' and reads the same fact", async () => {
  const dir = await mem("now");
  try {
    await teachBoard(dir, "w2");
    const turn = await runTurn("where is disk-1 now", { config: CONFIG, memoryDir: dir, sessionId: "w2" });
    assert.match(turn.answer, /disk-1 rests on peg-a/);
    assert.doesNotMatch(turn.answer, /no module matching/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a where question about a subject with no taught location keeps the honest code-graph miss", async () => {
  const dir = await mem("miss");
  try {
    await teachBoard(dir, "w3");
    const turn = await runTurn("where is nonexistent-9", { config: CONFIG, memoryDir: dir, sessionId: "w3" });
    assert.doesNotMatch(turn.answer, /rests on/);
    assert.equal(turn.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a non-locative taught relation never answers a where question", async () => {
  const dir = await mem("nonloc");
  try {
    const sessionId = "w4";
    await runTurn("ahab is a captain.", { config: CONFIG, memoryDir: dir, sessionId });
    await runTurn("remember that ahab likes mary", { config: CONFIG, memoryDir: dir, sessionId });
    const turn = await runTurn("where is ahab", { config: CONFIG, memoryDir: dir, sessionId });
    assert.doesNotMatch(turn.answer, /ahab likes mary/);
    assert.equal(turn.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a teach turn recognized by the teach lane carries no Canonical restatement of the structural misparse", async () => {
  const dir = await mem("canon");
  try {
    const taught = await teachBoard(dir, "w5");
    assert.match(taught.answer, /noted — remembered: disk-1 rests on peg-a/);
    assert.doesNotMatch(taught.answer, /Canonical:/);
    assert.equal(taught.record.canonical, null);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
