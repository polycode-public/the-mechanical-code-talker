// SKILL_BENCHMARK_CONVERSATION.md capped sprint, round 1 (2026-07-10) — two real
// dead-ends found in a fresh curious-user conversation against examples/mini-webapp,
// both fixed the same way: a bare trailing/wrapping discourse tag glued onto
// ISA_ASK_RE's captured term, the same class of bug item 8 fixed for metaTermOf's
// bare "what is X" shape but not yet extended to the yes/no isa-ask shape.
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
const mem = () => mkdtemp(join(tmpdir(), "tmct-r1-"));

test("round 1: 'is X a Y then' resolves the class-instance bridge instead of walling on the trailing tag", async () => {
  const dir = await mem();
  try {
    const g = await graph();
    await runTurn("every module is a validator", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
    const withThen = await runTurn("is app/lib/a.mjs a validator then", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
    const withoutThen = await runTurn("is app/lib/a.mjs a validator", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
    assert.equal(withThen.answer, withoutThen.answer);
    assert.match(withThen.answer, /^yes —/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("round 1: a confirmation-check wrapper ('so X is a Y, right?') resolves a genuinely taught/grounded fact", async () => {
  const dir = await mem();
  try {
    await runTurn("every dog is a thing", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    await runTurn("every animal is a thing", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    await runTurn("a dog is an animal", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    const r = await runTurn("so a dog is an animal, right?", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    assert.match(r.answer, /^yes — you told me: dog is a kind of animal/);
    assert.equal(r.record.miss, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("round 1 guard: the confirmation-tag rewrite never fabricates a yes for an ungrounded/untaught pair — falls through to the ordinary honest miss", async () => {
  const dir = await mem();
  try {
    const r = await runTurn("so john is a man now right?", { config: CONFIG, memoryDir: dir, sessionId: "s3" });
    assert.doesNotMatch(r.answer, /^yes —/);
    assert.equal(r.record.miss, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("round 1 guard: OPINION_NUDGE_RE's own 'is the code good' ordering is unaffected by the confirmation-tag rewrite", async () => {
  const g = await graph();
  const r = await runTurn("is the code good", { config: CONFIG, graph: g });
  assert.match(r.answer, /don't hold opinions/);
});
