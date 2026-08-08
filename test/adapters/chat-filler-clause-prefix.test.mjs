// runTurn's strip-and-retry rescue for a whole-line miss whose only problem is
// a closed filler clause ahead of a real question — the retry itself, not the
// fillerClausePrefix regex (interpret.test.mjs owns that).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../src/services/chat.mjs";

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-filler-retry-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run a scripted sequence of turns against one store, threading `last` turn
 *  to turn so discourse continuations ("what about X") resolve the same way
 *  the shell would. */
async function driveAgainstStore(dir, sessionId, queries) {
  const out = [];
  let last = null;
  for (const q of queries) {
    const r = await runTurn(q, { memoryDir: dir, sessionId, last });
    out.push(r);
    last = r.last;
  }
  return out;
}

test("a filler-clause prefix in front of a discourse continuation answers as the bare continuation", async () => {
  await withStore(async (dirA) => {
    await withStore(async (dirB) => {
      const teach = ["a dog is a kind of animal.", "a cat is a kind of animal."];
      for (const t of teach) await runTurn(t, { memoryDir: dirA, sessionId: "s1" });
      for (const t of teach) await runTurn(t, { memoryDir: dirB, sessionId: "s1" });
      const [, filler] = await driveAgainstStore(dirA, "s1", ["what is a dog", "oh nice. um what about cats"]);
      const [, clean] = await driveAgainstStore(dirB, "s1", ["what is a dog", "what about cats"]);
      assert.equal(filler.answer, clean.answer);
    });
  });
});

test("a filler-clause prefix in front of a definition question answers as the bare question", async () => {
  await withStore(async (dir) => {
    await runTurn("a horse is a kind of animal.", { memoryDir: dir, sessionId: "s1" });
    const filler = await runTurn("one more random thing, what is a horse", { memoryDir: dir, sessionId: "s1" });
    const clean = await runTurn("what is a horse", { memoryDir: dir, sessionId: "s1" });
    assert.equal(filler.answer, clean.answer);
  });
});

test("a declarative remainder behind a filler clause keeps its ordinary path and never retries", async () => {
  await withStore(async (dir) => {
    await runTurn("a liquid is a kind of substance.", { memoryDir: dir, sessionId: "s1" });
    const { answer, record } = await runTurn("well water is a kind of liquid.", { memoryDir: dir, sessionId: "s1" });
    // The first dispatch itself stores the fact (never a miss), so the retry
    // never fires — "well" stays part of the subject.
    assert.match(answer, /^noted — remembered.*well water/);
    assert.equal(record.miss, false);
  });
});

test("a filler clause in front of an ungrounded question keeps the original miss", async () => {
  await withStore(async (dir) => {
    // A throwaway first turn so the miss below isn't the session's own cold
    // start (a different, unrelated bootstrap message) — the retry's own
    // internal re-dispatch would otherwise change which of those two miss
    // shapes surfaces, muddying what this test is actually checking.
    await runTurn("a dog is a kind of animal.", { memoryDir: dir, sessionId: "s1" });
    const { answer, record } = await runTurn("anyway what is a zzz-nonexistent-term", { memoryDir: dir, sessionId: "s1" });
    assert.equal(record?.miss, true);
    assert.doesNotMatch(answer, /zzz-nonexistent-term is a kind of|noted — remembered/);
  });
});

test("the retry answers once — the transcript echo quotes the line the user typed", async () => {
  await withStore(async (dir) => {
    await runTurn("a horse is a kind of animal.", { memoryDir: dir, sessionId: "s1" });
    const { answer, record, logLines } = await runTurn("anyway what is a horse", { memoryDir: dir, sessionId: "s1" });
    assert.match(answer, /horse/i);
    assert.equal(record.input, "anyway what is a horse");
    assert.equal(logLines[1], "> anyway what is a horse");
  });
});
