// "which <kind> is <superlative>" answered from taught mgx:<comparative>-than
// facts: the superlative maps onto its comparative base by closed morphology,
// and the answer is given ONLY when the taught pairs form a single
// unambiguous total chain (cited); a partial order declines and names the
// missing comparison.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-sup-${tag}-`));

test("a total smaller-than chain answers 'which disk is smallest' with the chain cited", async () => {
  const dir = await mem("total");
  try {
    await runTurn("disk-1 is smaller than disk-2", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    await runTurn("disk-2 is smaller than disk-3", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    await runTurn("disk-1 is smaller than disk-3", { config: CONFIG, memoryDir: dir, sessionId: "s1" });

    const which = await runTurn("which disk is smallest", { config: CONFIG, memoryDir: dir });
    assert.match(which.answer, /^disk-1 — /);
    assert.match(which.answer, /disk-1 is smaller than disk-2/);
    assert.match(which.answer, /disk-2 is smaller than disk-3/);
    assert.match(which.answer, /so disk-1 is the smallest disk/);
    assert.equal(which.record.miss, false);

    const what = await runTurn("what is the smallest disk", { config: CONFIG, memoryDir: dir });
    assert.match(what.answer, /^disk-1 — /);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a partial order declines and names the pair nothing compares", async () => {
  const dir = await mem("partial");
  try {
    await runTurn("disk-1 is smaller than disk-2", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    await runTurn("disk-1 is smaller than disk-3", { config: CONFIG, memoryDir: dir, sessionId: "s2" });

    const which = await runTurn("which disk is smallest", { config: CONFIG, memoryDir: dir });
    assert.match(which.answer, /I can't pick the smallest disk/);
    assert.match(which.answer, /disk-2/);
    assert.match(which.answer, /disk-3/);
    assert.match(which.answer, /is smaller than/);
    assert.equal(which.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the doubled-consonant and irregular superlatives map onto their taught comparative bases (biggest -> bigger, best -> better)", async () => {
  const dir = await mem("morph");
  try {
    await runTurn("rock-1 is bigger than rock-2", { config: CONFIG, memoryDir: dir, sessionId: "s3" });
    const rocks = await runTurn("which rock is biggest", { config: CONFIG, memoryDir: dir });
    assert.match(rocks.answer, /^rock-1 — /);
    assert.match(rocks.answer, /so rock-1 is the biggest rock/);

    await runTurn("plan-a is better than plan-b", { config: CONFIG, memoryDir: dir, sessionId: "s3" });
    const plans = await runTurn("which plan is best", { config: CONFIG, memoryDir: dir });
    assert.match(plans.answer, /^plan-a — /);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a superlative with no taught pairs for its base falls through — no fabricated ordering from the wrong predicate", async () => {
  const dir = await mem("wrong-base");
  try {
    await runTurn("disk-1 is smaller than disk-2", { config: CONFIG, memoryDir: dir, sessionId: "s4" });
    // No bigger-than facts exist — the reader must not answer from the
    // smaller-than pairs, and the ordinary miss stands.
    const which = await runTurn("which disk is biggest", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(which.answer, /^disk-/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
