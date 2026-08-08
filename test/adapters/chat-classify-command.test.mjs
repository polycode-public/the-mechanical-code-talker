// /classify <term> — the chat surface over el-classify.mjs's bounded EL
// saturation pass: refuses without a term, derives and lists the entailed
// facts for a taught chain, states the budget wall when the pass truncates,
// and reports plainly when a term has nothing left to classify.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../src/services/chat.mjs";
import { appendFacts } from "../../src/adapters/memory/core.mjs";
import { SUBCLASS_PREDICATE } from "../../src/domain/syllogise.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-chat-classify-"));
}

test("/classify refuses without a term", async () => {
  const dir = await tmpRepo();
  try {
    const { answer, record } = await runTurn("/classify", { memoryDir: dir });
    assert.match(answer, /needs a term/);
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/classify derives and lists the entailed facts for a taught chain the EL rules close", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every cat is a mammal", { memoryDir: dir, sessionId: "classify-chain" });
    await runTurn("every mammal is an animal", { memoryDir: dir, sessionId: "classify-chain" });

    const { answer } = await runTurn("/classify cat", { memoryDir: dir, sessionId: "classify-chain" });
    assert.match(answer, /derived 1 entailed fact/);
    assert.match(answer, new RegExp(`cat ${SUBCLASS_PREDICATE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} animal`));
    assert.match(answer, /derived, not taught/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/classify reports the budget wall when the pass truncates", async () => {
  const dir = await tmpRepo();
  try {
    // A chain deeper than the classifier's default round cap (64):
    // saturateEl grows cat's known superclasses by exactly one hop per
    // round, so a chain longer than that cap ends the pass mid-closure —
    // deterministic (no row-count budget or hash-ordering involved) since
    // the chain is well under the 2000-row normalization budget.
    const rows = [];
    let prev = "cat";
    for (let i = 1; i <= 70; i += 1) {
      const next = `classify-chain-link-${i}`;
      rows.push({ subject: prev, predicate: SUBCLASS_PREDICATE, object: next });
      prev = next;
    }
    await appendFacts(dir, rows);

    const { answer } = await runTurn("/classify cat", { memoryDir: dir, sessionId: "classify-budget" });
    assert.match(answer, /derived \d+ entailed fact/);
    assert.match(answer, /classify-chain-link-\d+/);
    assert.match(answer, /budget of \d+ reached/);
    assert.match(answer, /tmct classify --budget <n>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/classify on a term with nothing left to derive reports that plainly", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every gribble is a wobbat", { memoryDir: dir, sessionId: "classify-nothing" });

    const { answer, record } = await runTurn("/classify gribble", { memoryDir: dir, sessionId: "classify-nothing" });
    assert.match(answer, /nothing new classifies/);
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
