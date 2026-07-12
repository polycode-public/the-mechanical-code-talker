// chat-why-isa-paraphrase-trigger-1.8.14.test.mjs — BENCHMARK_CONVERSATION_1.8.14.md
// item 9 (skeptical-power-user persona): the syllogise-verified proof render — the
// isaAsk block in src/chat.mjs, which cites the graph's own inherits-bridge and/or
// a taught-fact chase — only ever fired on the bare "is X a Y" yes/no form. A "why"/
// "explain how you know" wrapper around the EXACT SAME question hit the bare grammar
// wall instead, even though the underlying answer is real, sourced, and already
// worked for the plain phrasing. Verbatim: "why is TaskController a handler" and
// "explain how you know TaskController is a handler" both failed while "is
// TaskController a handler" answered correctly with the full two-hop proof.
//
// Fixed via matchWhyIsa (src/chat.mjs, defined right after ISA_ASK_RE): a pure text
// rewrite back onto ISA_ASK_RE's own "is X a Y" shape — "why is X a Y" strips its
// "why " lead, "explain how you know X is Y" reorders into "is X a Y" — mirroring
// CONFIRM_TAG_RE's existing "rewrite the wrapper away and re-try ISA_ASK_RE"
// precedent. Wired into BOTH ISA_ASK_RE match sites (the memory-only isa check and
// the graph-grounded proof-chase/bridge block), so both "why"/"explain how you know"
// reach the identical answer the plain form already produces — never a new answer
// path, never a fabricated proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }
const mem = () => mkdtemp(join(tmpdir(), "tmct-why-isa-"));

test("'why is X a Y' and 'explain how you know X is Y' reach the SAME sourced two-hop proof as the plain 'is X a Y' form", async () => {
  const dir = await mem();
  try {
    const g = await graph();
    // Widget inherits Base (test/fixtures/entities.fixture.json) — the CLASS↔
    // INSTANCE BRIDGE the isaAsk block's own proof cites.
    await runTurn("base is a kind of handler", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
    const plain = await runTurn("is Widget a handler", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
    assert.match(plain.answer, /^yes — the code graph says Widget inherits Base/, "sanity: the plain form must already answer with the sourced bridge proof");
    assert.equal(plain.record.miss, false);

    const why = await runTurn("why is Widget a handler", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
    assert.equal(why.answer, plain.answer, "'why is X a Y' must answer identically to the plain form");
    assert.equal(why.record.miss, false);

    const explain = await runTurn("explain how you know Widget is a handler", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
    assert.equal(explain.answer, plain.answer, "'explain how you know X is Y' must answer identically to the plain form");
    assert.equal(explain.record.miss, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("'why is X untested' (the existing WHY_UNTESTED_RE lane) is unaffected by the new rewrite", async () => {
  const dir = await mem();
  try {
    const g = await graph();
    const r = await runTurn("why is Widget untested", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s2" });
    assert.doesNotMatch(r.answer, /^yes —/, "must never be misread as an isa-ask 'why is X a Y' proof");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("'why is X a Y' with no matching fact still declines honestly, same as the plain form", async () => {
  const dir = await mem();
  try {
    const g = await graph();
    const plain = await runTurn("is Widget a gizmo", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s3" });
    const why = await runTurn("why is Widget a gizmo", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s3" });
    assert.equal(plain.record.miss, why.record.miss);
    assert.doesNotMatch(why.answer, /^yes —/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
