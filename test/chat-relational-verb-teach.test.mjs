// Verb-inflected relational teach: "ahab fathered john" stores the same
// mgx:<role> fact "ahab is the father of john" stores, via the same
// generalVerbPredicate mint, so every read-back answers both phrasings
// identically. Non-relational pasts ("the build failed") never store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-rvt-${tag}-`));

test("'ahab fathered john' stores ahab mgx:father john and 'who is the father of john' answers ahab", async () => {
  const dir = await mem("store");
  try {
    const taught = await runTurn("ahab fathered john", { config: CONFIG, memoryDir: dir, sessionId: "v1" });
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /noted — remembered: ahab fathers john/);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "ahab" && r.predicate === "mgx:father" && r.object === "john"));

    const who = await runTurn("who is the father of john", { config: CONFIG, memoryDir: dir });
    assert.match(who.answer, /ahab/);
    assert.equal(who.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a doubled-consonant past ('bunny hopped fence') strips to the verb base for the minted predicate", async () => {
  const dir = await mem("doubled");
  try {
    const taught = await runTurn("bunny hopped fence", { config: CONFIG, memoryDir: dir, sessionId: "v2" });
    assert.equal(taught.record.miss, false);
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "bunny" && r.predicate === "mgx:hop" && r.object === "fence"));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a determiner-led past declarative ('the build failed') stores nothing", async () => {
  const dir = await mem("no-det");
  try {
    await runTurn("the build failed", { config: CONFIG, memoryDir: dir, sessionId: "v3" });
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an intransitive past with an adverb tail ('john failed spectacularly') stores nothing", async () => {
  const dir = await mem("no-adv");
  try {
    await runTurn("john failed spectacularly", { config: CONFIG, memoryDir: dir, sessionId: "v4" });
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a question lead ('who fathered john') never stores through the past-verb frame", async () => {
  const dir = await mem("no-question");
  try {
    await runTurn("who fathered john", { config: CONFIG, memoryDir: dir, sessionId: "v5" });
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
