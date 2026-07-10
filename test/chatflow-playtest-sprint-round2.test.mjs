// SKILL_BENCHMARK_CONVERSATION.md capped sprint, round 2 (2026-07-10) — two fresh
// dead-ends found continuing round 1's conversation:
//   (1) a STACKED trailing discourse tag ("too then") only had the outermost tag
//       stripped, leaving the inner one ("too") still glued to the captured
//       isa-ask term;
//   (2) "is Task auditable" ("every Record is auditable" taught, Task inherits
//       Record) said "I don't know anything about Task yet" — the property
//       yes/no reader (IS_ADJECTIVE_YESNO_RE) had no class↔instance inheritance
//       bridge at all, unlike the isaAsk block's own bridge for noun-kind facts.
//       A genuine teach-then-INFER gap, exactly the shape SKILL_BENCHMARK_
//       CONVERSATION.md's own discipline asks every round to test for.
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
const mem = () => mkdtemp(join(tmpdir(), "tmct-r2-"));

test("round 2: a STACKED trailing discourse tag ('X too then') resolves the same as the plain form", async () => {
  const dir = await mem();
  try {
    const g = await graph();
    await runTurn("every module is a validator", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
    const plain = await runTurn("is app/lib/a.mjs a validator", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
    for (const q of ["is app/lib/a.mjs a validator too then", "is app/lib/a.mjs a validator then too", "is app/lib/a.mjs a validator too"]) {
      const r = await runTurn(q, { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s1" });
      assert.equal(r.answer, plain.answer, `"${q}" must resolve the same as the plain form`);
      assert.match(r.answer, /^yes —/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("round 2: 'is X ADJ' bridges the class↔instance inherits chain, mirroring isaAsk's own bridge", async () => {
  const dir = await mem();
  try {
    const g = await graph();
    await runTurn("every Base is auditable", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s2" });
    // Widget extends Base (test/fixtures/entities.fixture.json) — a taught
    // property on the ANCESTOR must be found for the descendant, named
    // explicitly via the inherits relationship, never a silent subject swap.
    const bridged = await runTurn("is Widget auditable", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s2" });
    assert.match(bridged.answer, /^yes — the code graph says Widget inherits Base, and you told me: base is auditable/);
    assert.equal(bridged.record.miss, false);

    const direct = await runTurn("is Base auditable", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s2" });
    assert.match(direct.answer, /^yes — you told me: base is auditable/, "a direct hit is unaffected — no bridge wording when none was needed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("round 2 guard: 'is X ADJ' inheritance bridge never fabricates for an unrelated entity", async () => {
  const dir = await mem();
  try {
    const g = await graph();
    await runTurn("every Base is auditable", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s3" });
    // fnAlpha (a Function, test/fixtures/entities.fixture.json) doesn't inherit
    // anything — must stay an honest decline, never a fabricated yes.
    const r = await runTurn("is fnAlpha auditable", { config: CONFIG, graph: g, memoryDir: dir, sessionId: "s3" });
    assert.doesNotMatch(r.answer, /^yes —/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
