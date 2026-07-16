// chat-completions-graphservice.test.mjs — HANDOVER.md item 1: "completionsRescueAnswer
// never passes a graphService adapter through to broadSearch". src/completions/search.mjs's
// broadSearch() always accepted an optional Repository-Interface `graphService` (its own
// docblock names createGraphService(graph), src/adapters/providers/graph-service.mjs, as the reference
// shape) but nothing in live chat ever constructed and passed one through — so the
// (4e) COMPLETIONS RESCUE lane (src/chat.mjs's completionsRescueAnswer) could ONLY ever see
// memory BLOCKS saved via an explicit saveBlock() call (src/adapters/memory/blocks.mjs). Ordinary chat
// teaching/asking never calls saveBlock(), so "give me a detailed summary of how X works"
// declined for ANY subject on its first real mention in a session, no matter how much the
// already-loaded graph (or any taught Facts) actually knew about it. Confirmed live twice in
// the session that filed this item, for "src/core/store.mjs" and "TaskController".
//
// test/chat-completions-wiring.test.mjs (the ORIGINAL wiring suite, unmodified by this fix)
// only ever exercises the case with pre-seeded memory BLOCKS — never the graph-only,
// first-mention case this file is about. Every test below seeds NO blocks at all (a fresh,
// truly empty memoryDir) — the graph (and, in one case, a taught Fact) is the ONLY source of
// grounding, proving the regression is actually fixed rather than re-proving the
// already-passing pre-seeded-block path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runTurn } from "../../src/chat.mjs";
import { appendFact } from "../../src/adapters/memory/core.mjs";
import { parseEntities } from "../../src/codegraph.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import * as source from "../../src/adapters/source.mjs";

// Same committed fixture graph test/chat-completions-wiring.test.mjs uses: Widget is a real
// Class (defined in app/lib/b.mjs, contains a render method + a name attribute, inherits from
// Base, Widget.render calls fnAlpha)
const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }
const freshMemoryDir = () => mkdtemp(join(tmpdir(), "tmct-completions-graphservice-"));

test("COMPLETIONS RESCUE + real graphService: a subject's first-ever mention answers from the GRAPH ALONE — no pre-seeded block required", async () => {
  const dir = await freshMemoryDir(); // deliberately empty — no saveBlock() call anywhere in this test
  try {
    const g = await graph();
    const { answer, record } = await runTurn(
      "give me a detailed summary of how the Widget works",
      { config: CONFIG, graph: g, memoryDir: dir },
    );
    assert.equal(record.via, "completion", "answered via the COMPLETIONS RESCUE lane, from the graph alone, not a decline");
    assert.equal(record.miss, false, "a real completion is not recorded as a miss");
    assert.doesNotMatch(answer, /couldn't parse this as a graph question/, "the adapter must not leak ask()'s own unhelpful rephrase-hint");
    assert.match(answer, /Widget/, "the answer is genuinely about the asked-about subject");
    assert.match(answer, /Class/i, "real graph-sourced content — Widget's actual class, never fabricated");
    assert.ok((answer.match(/[.!?]/g) || []).length >= 2, "reads as multiple real sentences, not one bare label");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("COMPLETIONS RESCUE + real graphService: a module (not just a Class) also answers from the graph alone on first mention", async () => {
  const dir = await freshMemoryDir();
  try {
    const g = await graph();
    const { answer, record } = await runTurn(
      "give me a detailed summary of how app/lib/b.mjs works",
      { config: CONFIG, graph: g, memoryDir: dir },
    );
    assert.equal(record.via, "completion");
    assert.equal(record.miss, false);
    assert.match(answer, /app\/lib\/b\.mjs/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("COMPLETIONS RESCUE + real graphService: a TAUGHT FACT (no code-graph entity, no block) also grounds the completion", async () => {
  const dir = await freshMemoryDir();
  try {
    // "Frobnicator" exists in NEITHER the fixture graph NOR any memory block — the only
    // thing that knows anything about it is this one taught Fact, exercising the adapter's
    // readFactRows() half (search.mjs's own graph-search/graph-ask alone would find nothing).
    await appendFact(dir, {
      subject: "Frobnicator",
      predicate: "is",
      object: "a caching layer used by the task queue",
      provenance: "teach:chat",
    });
    const g = await graph();
    const { answer, record } = await runTurn(
      "give me a detailed summary of how the Frobnicator works",
      { config: CONFIG, graph: g, memoryDir: dir },
    );
    assert.equal(record.via, "completion", "a taught Fact alone must be enough to ground a completion");
    assert.equal(record.miss, false);
    assert.match(answer, /frobnicator/i);
    assert.match(answer, /caching layer/i);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("COMPLETIONS RESCUE guard: a subject truly unknown to the graph, memory, AND blocks still declines honestly", async () => {
  const dir = await freshMemoryDir();
  try {
    const g = await graph();
    const { record } = await runTurn(
      "give me a detailed summary of how zzznonexistentThing works",
      { config: CONFIG, graph: g, memoryDir: dir },
    );
    assert.notEqual(record.via, "completion", "nothing groundable exists anywhere — must not claim the turn");
    assert.equal(record.miss, true, "an honest miss, not a fabricated completion");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
