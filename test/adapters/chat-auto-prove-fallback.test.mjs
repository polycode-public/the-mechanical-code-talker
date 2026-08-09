// chat-auto-prove-fallback.test.mjs — a plain isa-shaped question that every
// live chase misses falls through to a bounded, automatic tableau proof:
// two-sided and proved-only (an entailed negation may answer no; a
// counter-model never does), guarded against certifying out of an
// inconsistency, gated on the module actually holding a DL-only axiom
// shape so an ordinary miss never pays for a proof it can't use, and
// switchable off through [reasoning] ask_prove_fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-auto-prove-"));
}

test("E3's premises taught, asked as a plain question, answer yes citing both premises", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every pet is a cat or a dog", { memoryDir: dir, sessionId: "s1" });
    await runTurn("rex is a pet", { memoryDir: dir, sessionId: "s1" });
    await runTurn("rex is not a cat", { memoryDir: dir, sessionId: "s1" });

    const { answer, record } = await runTurn("is rex a dog", { memoryDir: dir, sessionId: "s1" });
    assert.match(answer, /^yes —/);
    assert.match(answer, /rex is a pet/);
    assert.match(answer, /rex is not a cat/);
    assert.match(answer, /pet is a kind of cat-or-dog/);
    assert.match(answer, /in every case, rex is a dog\./);
    assert.equal(record.miss, false);
    assert.equal(record.via, "fact");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("E4's premises taught, asked plainly, answer yes as a class subsumption — the subject has no isa facts at all, proving the insertion point dominates the branch's own return null", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("everything that is not aquatic is terrestrial", { memoryDir: dir, sessionId: "s1" });
    await runTurn("a stone is not aquatic", { memoryDir: dir, sessionId: "s1" });

    const { answer, record } = await runTurn("is a stone a terrestrial", { memoryDir: dir, sessionId: "s1" });
    assert.match(answer, /^yes —/);
    assert.match(answer, /so stone is a terrestrial\./);
    assert.equal(record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an entailed negation renders no, grounded in the store — not a counter-model", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every pet is a cat or a dog", { memoryDir: dir, sessionId: "s1" });
    await runTurn("rex is a pet", { memoryDir: dir, sessionId: "s1" });
    await runTurn("rex is not a cat", { memoryDir: dir, sessionId: "s1" });
    await runTurn("no dog is a fish", { memoryDir: dir, sessionId: "s1" });

    const { answer, record } = await runTurn("is rex a fish", { memoryDir: dir, sessionId: "s1" });
    assert.match(answer, /^no —/);
    assert.match(answer, /dog is not a fish/);
    assert.match(answer, /so rex is not a fish\./);
    assert.equal(record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a counter-model (both the entailment and its negation disprove) leaves the miss unchanged — never rendered as no", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every pet is a cat or a dog", { memoryDir: dir, sessionId: "s1" });
    await runTurn("rex is a pet", { memoryDir: dir, sessionId: "s1" }); // no negation taught — rex could be either

    const { answer, record } = await runTurn("is rex a dog", { memoryDir: dir, sessionId: "s1" });
    assert.ok(!/^yes —/.test(answer) && !/^no —/.test(answer), "neither a guessed yes nor a guessed no");
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the ex-falso guard: an individual whose class carries a min/max cardinality clash gets the clash report, never a certified yes", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every bicycle has at least 2 wheels", { memoryDir: dir, sessionId: "s1" });
    await runTurn("every bicycle has at most 0 wheels", { memoryDir: dir, sessionId: "s1" });
    await runTurn("beryl is a bicycle", { memoryDir: dir, sessionId: "s1" });

    const { answer } = await runTurn("is beryl a wheel", { memoryDir: dir, sessionId: "s1" });
    assert.match(answer, /^I can't answer that — what I've been told about beryl is inconsistent:/);
    assert.match(answer, /min-2-wheel owl:minCardinality 2/);
    assert.match(answer, /max-0-wheel owl:maxCardinality 0/);
    assert.ok(!/^yes —/.test(answer), "an inconsistent subject must never render a confident yes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a miss whose module has no DL-shaped row is byte-identical whether the fallback is on or off — the prover never runs", async () => {
  const dirOn = await tmpRepo();
  const dirOff = await tmpRepo();
  try {
    await writeFile(join(dirOff, "tmct.toml"), "[reasoning]\nask_prove_fallback = false\n");
    for (const dir of [dirOn, dirOff]) {
      await runTurn("every dog is an animal", { memoryDir: dir, sessionId: "s1" });
      await runTurn("rex is a dog", { memoryDir: dir, sessionId: "s1" });
    }
    const on = await runTurn("is rex a fish", { memoryDir: dirOn, sessionId: "s1" });
    const off = await runTurn("is rex a fish", { memoryDir: dirOff, sessionId: "s1" });
    const stripTs = (s) => s.replace(/@[^)]*\)/g, ")");
    assert.equal(stripTs(on.answer), stripTs(off.answer));
    assert.equal(on.record.miss, true);
  } finally {
    await rm(dirOn, { recursive: true, force: true });
    await rm(dirOff, { recursive: true, force: true });
  }
});

test("an exhausted run is byte-identical to the fallback-disabled miss and carries budgetExhausted", async () => {
  const dirExhausted = await tmpRepo();
  const dirDisabled = await tmpRepo();
  try {
    await writeFile(join(dirExhausted, "tmct.toml"), "[reasoning]\nask_prove_steps = 1\nask_prove_branches = 1\nask_prove_nodes = 1\n");
    await writeFile(join(dirDisabled, "tmct.toml"), "[reasoning]\nask_prove_fallback = false\n");
    for (const dir of [dirExhausted, dirDisabled]) {
      await runTurn("every pet is a cat or a dog", { memoryDir: dir, sessionId: "s1" });
      await runTurn("rex is a pet", { memoryDir: dir, sessionId: "s1" });
      await runTurn("rex is not a cat", { memoryDir: dir, sessionId: "s1" });
    }
    const exhausted = await runTurn("is rex a dog", { memoryDir: dirExhausted, sessionId: "s1" });
    const disabled = await runTurn("is rex a dog", { memoryDir: dirDisabled, sessionId: "s1" });
    const stripTs = (s) => s.replace(/@[^)]*\)/g, ")");
    assert.equal(stripTs(exhausted.answer), stripTs(disabled.answer));
    assert.equal(exhausted.record.budgetExhausted, true);
    assert.equal(disabled.record.budgetExhausted, undefined);
  } finally {
    await rm(dirExhausted, { recursive: true, force: true });
    await rm(dirDisabled, { recursive: true, force: true });
  }
});

test("ask_prove_fallback = false restores today's miss text on a shape the fallback would otherwise flip to yes", async () => {
  const dir = await tmpRepo();
  try {
    await writeFile(join(dir, "tmct.toml"), "[reasoning]\nask_prove_fallback = false\n");
    await runTurn("every pet is a cat or a dog", { memoryDir: dir, sessionId: "s1" });
    await runTurn("rex is a pet", { memoryDir: dir, sessionId: "s1" });
    await runTurn("rex is not a cat", { memoryDir: dir, sessionId: "s1" });

    const { answer, record } = await runTurn("is rex a dog", { memoryDir: dir, sessionId: "s1" });
    assert.ok(!/^yes —/.test(answer), "the fallback must not fire while disabled");
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a plain subclass chain (no DL shape at all) still offers /syllogise on a chain longer than the immediate chase follows, unaffected by the fallback", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("widget-alpha is a link-zero", { memoryDir: dir, sessionId: "s1" });
    await runTurn("every link-zero is a link-one", { memoryDir: dir, sessionId: "s1" });
    await runTurn("every link-one is a link-two", { memoryDir: dir, sessionId: "s1" });
    await runTurn("every link-two is a link-three", { memoryDir: dir, sessionId: "s1" });
    await runTurn("every link-three is a link-four", { memoryDir: dir, sessionId: "s1" });
    await runTurn("every link-four is a link-five", { memoryDir: dir, sessionId: "s1" });

    const { answer, record } = await runTurn("is widget-alpha a link-five", { memoryDir: dir, sessionId: "s1" });
    assert.ok(!/^yes —/.test(answer) && !/^no —/.test(answer));
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
