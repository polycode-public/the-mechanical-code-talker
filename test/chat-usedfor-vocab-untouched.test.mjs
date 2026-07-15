// chat-usedfor-vocab-untouched.test.mjs — the describe-paraphrase phrasing
// frames ("what is X for" -> "what is a X") run on raw text before any lane
// knows whether X is a code-graph entity, so they carry an article/pronoun
// guard. This pins the vocabulary side of that boundary against the REAL
// default-persona bootstrap (corpus/tier2/human.jsonl, same graph-less
// first-run seeding wiring-facts-reverse.test.mjs exercises): the used-for
// question family over a plain noun must keep reaching the memory-facts
// readers, never a code-graph parse or miss.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const mem = () => mkdtemp(join(tmpdir(), "tmct-usedfor-vocab-"));

test("'what is for riding' / 'what can be used for riding' still surface the corpus-seeded usedFor fact", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const isFor = await s.turn("what is for riding");
    const canBe = await s.turn("what can be used for riding");
    await s.close();
    assert.match(isFor.answer, /horse is used for riding/);
    assert.match(canBe.answer, /horse is used for riding/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'what is a horse for' keeps its memory-side answer — never a code-graph vocabulary miss or module search", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what is a horse for");
    await s.close();
    // The article guard keeps the frame off this phrasing entirely, so the
    // memory side of the ladder answers about the horse — the exact strings a
    // code-graph misread would produce are pinned out.
    assert.match(r.answer, /horse/);
    assert.doesNotMatch(r.answer, /isn't a term in this graph's own vocabulary/);
    assert.doesNotMatch(r.answer, /no module matching/);
    assert.doesNotMatch(r.answer, /couldn't parse this as a graph question/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the forward form 'what is a horse used for' still filters to the usedFor facts", async () => {
  const dir = await mem();
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    const r = await s.turn("what is a horse used for");
    await s.close();
    assert.match(r.answer, /horse is used for riding/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
