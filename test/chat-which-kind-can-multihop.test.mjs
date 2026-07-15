// "which <kind> can <verb>" ties capable subjects to the kind through a
// bounded isa-family chain (findIsaChain, maxHops 3), not just a direct
// one-hop fact — and cites the chain on the answer line when it's longer
// than one hop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-wkc-${tag}-`));

test("a 2-hop member surfaces with its chain cited: sparrow -> bird -> animal answers 'which animals can hop'", async () => {
  const dir = await mem("two-hop");
  try {
    await runTurn("every sparrow is a bird", { config: CONFIG, memoryDir: dir, sessionId: "m1" });
    await runTurn("every bird is an animal", { config: CONFIG, memoryDir: dir, sessionId: "m1" });
    await runTurn("a sparrow can hop", { config: CONFIG, memoryDir: dir, sessionId: "m1" });

    const which = await runTurn("which animals can hop", { config: CONFIG, memoryDir: dir });
    assert.match(which.answer, /sparrow can hop/);
    assert.match(which.answer, /via: sparrow is a kind of bird/);
    assert.match(which.answer, /bird is a kind of animal/);
    assert.equal(which.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a direct one-hop member keeps its plain line — no chain citation", async () => {
  const dir = await mem("one-hop");
  try {
    await runTurn("every bird is an animal", { config: CONFIG, memoryDir: dir, sessionId: "m2" });
    await runTurn("a bird can fly", { config: CONFIG, memoryDir: dir, sessionId: "m2" });

    const which = await runTurn("which animals can fly", { config: CONFIG, memoryDir: dir });
    assert.match(which.answer, /bird can fly/);
    assert.doesNotMatch(which.answer, /via:/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a chain past the 3-hop budget does not count as membership — the honest 'nothing ties these' preamble stands", async () => {
  const dir = await mem("budget");
  try {
    await runTurn("every wren is a bird", { config: CONFIG, memoryDir: dir, sessionId: "m3" });
    await runTurn("every bird is a vertebrate", { config: CONFIG, memoryDir: dir, sessionId: "m3" });
    await runTurn("every vertebrate is an animal", { config: CONFIG, memoryDir: dir, sessionId: "m3" });
    await runTurn("every animal is an organism", { config: CONFIG, memoryDir: dir, sessionId: "m3" });
    // The habitual surface stores the capability ("wren" is fact-grounded by
    // the isa chain above; "wren" itself is outside the closed ACE lexicon).
    await runTurn("wrens sing", { config: CONFIG, memoryDir: dir, sessionId: "m3" });

    // wren -> organism is 4 hops: beyond the budget, so nothing provably ties
    // the capable subject to the asked kind.
    const which = await runTurn("which organisms can sing", { config: CONFIG, memoryDir: dir });
    assert.match(which.answer, /nothing I remember ties these to "organisms"/);
    assert.match(which.answer, /wren can sing/);

    // wren -> animal is 3 hops: exactly at the budget, so it counts and cites.
    const inBudget = await runTurn("which animals can sing", { config: CONFIG, memoryDir: dir });
    assert.match(inBudget.answer, /via: wren is a kind of bird/);
    assert.match(inBudget.answer, /vertebrate is a kind of animal/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
