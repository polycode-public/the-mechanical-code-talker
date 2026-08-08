// /prove <question> — the chat surface over the DL tableau (tableau.mjs):
// refuses without a question and on any shape other than "is X a Y", proves
// an entailment citing the taught facts it rests on (naming a case-split
// conclusion as reasoning by cases when a real disjunction fired), reads a
// satisfiable counter-model as a genuine "no" rather than a miss, and lands
// on the honest budget wall — never a guess — when the search runs out,
// naming the [reasoning] knob a wider search would raise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";
import { appendFacts } from "../../src/adapters/memory/core.mjs";
import { SUBCLASS_PREDICATE } from "../../src/domain/syllogise.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-chat-prove-"));
}

test("/prove refuses without a question", async () => {
  const dir = await tmpRepo();
  try {
    const { answer, record } = await runTurn("/prove", { memoryDir: dir });
    assert.match(answer, /needs a question/);
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/prove refuses a shape other than \"is X a Y\", naming what works", async () => {
  const dir = await tmpRepo();
  try {
    const { answer, record } = await runTurn("/prove tell me about rex", { memoryDir: dir });
    assert.match(answer, /only reads a yes\/no shape/);
    assert.match(answer, /is rex a dog/);
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/prove proves disjunction elimination (E3), citing the union, the subclass link and the negation, as reasoning by cases", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every pet is a cat or a dog", { memoryDir: dir, sessionId: "prove-e3" });
    await runTurn("rex is a pet", { memoryDir: dir, sessionId: "prove-e3" });
    await runTurn("rex is not a cat", { memoryDir: dir, sessionId: "prove-e3" });

    const { answer, record } = await runTurn("/prove is rex a dog", { memoryDir: dir, sessionId: "prove-e3" });
    assert.match(answer, /^yes —/);
    assert.match(answer, /rex is a pet/);
    assert.match(answer, /rex is not a cat/);
    assert.match(answer, /pet is a kind of cat-or-dog/);
    assert.match(answer, /in every case, rex is a dog\./);
    assert.equal(record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/prove proves a complement-class subsumption (E4) as a single deduction, not a case split", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("everything that is not aquatic is terrestrial", { memoryDir: dir, sessionId: "prove-e4" });
    await runTurn("a stone is not aquatic", { memoryDir: dir, sessionId: "prove-e4" });

    const { answer, record } = await runTurn("/prove is a stone a terrestrial", { memoryDir: dir, sessionId: "prove-e4" });
    assert.match(answer, /^yes —/);
    assert.match(answer, /stone is not an? aquatic/);
    assert.match(answer, /so stone is a terrestrial\./);
    assert.ok(!/in every case/.test(answer), "a complement-class subsumption is one deduction, not a case analysis");
    assert.equal(record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/prove reads an unentailed question as a disproof, not a miss, and names what constrains the counter-model", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("rex is a dog", { memoryDir: dir, sessionId: "prove-disproof" });

    const { answer, record } = await runTurn("/prove is rex a cat", { memoryDir: dir, sessionId: "prove-disproof" });
    assert.match(answer, /^no —/);
    assert.match(answer, /rex is not a cat/);
    assert.match(answer, /rex is a dog/);
    assert.equal(record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/prove lands on the honest budget wall when the search exhausts, naming the config knob", async () => {
  const dir = await tmpRepo();
  try {
    const N = 20;
    const rows = [];
    let prev = "prove-budget-link-0";
    rows.push({ subject: "rex", predicate: "rdf:type", object: prev });
    for (let i = 1; i <= N; i += 1) {
      const next = `prove-budget-link-${i}`;
      rows.push({ subject: prev, predicate: SUBCLASS_PREDICATE, object: next });
      prev = next;
    }
    await appendFacts(dir, rows);
    await writeFile(join(dir, "tmct.toml"), "[reasoning]\nprove_steps = 10\n");

    const { answer, record } = await runTurn(`/prove is rex a ${prev}`, { memoryDir: dir, sessionId: "prove-budget" });
    assert.match(answer, /can't prove or disprove that within my budget \(10 steps\)/);
    assert.match(answer, /Nothing was guessed/);
    assert.match(answer, /prove_steps/);
    assert.equal(record.miss, true);
    assert.equal(record.budgetExhausted, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
