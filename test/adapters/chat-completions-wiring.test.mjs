// chat-completions-wiring.test.mjs — HANDOVER.md 2026-07-10 item 7: "wire
// src/completions/ into live chat dispatch". BENCHMARK_CONVERSATION_1.4.1.md round 3's own
// architecturally-confirmed gap: "can you give me a detailed summary of how the task
// system works" hit the plain grammar wall with NO inferred goal at all, even though
// src/completions/'s extractive multi-sentence pipeline (generateCompletion(),
// src/completions/complete.mjs) already existed and could answer it when called
// directly — it was simply unreachable from any real chat turn. This suite proves the
// new (4e) COMPLETIONS RESCUE lane (src/chat.mjs) closes that gap:
//   (a) the target phrase now produces real, grounded, multi-sentence prose instead of
//       the grammar wall, for "Widget" — a real Class this repo's own committed fixture
//       graph (test/fixtures/entities.fixture.json) has real facts about (defined in
//       app/lib/b.mjs, contains a render method + a name attribute, inherits from Base,
//       Widget.render calls fnAlpha) — mirrored here as seeded memory BLOCKS (the
//       corpus src/completions/search.mjs's broadSearch() actually retrieves from);
//   (b) an unrelated/unknown subject still declines honestly — never fabricates;
//   (c) the new trigger phrase does NOT shadow the EXISTING describe-wrapper lane
//       (test/chat-ux.test.mjs's own "describe-wrapper rescue" tests) for phrasings
//       that lane already owns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runTurn } from "../../src/chat.mjs";
import { saveBlock } from "../../src/adapters/memory/blocks.mjs";
import { parseEntities } from "../../src/codegraph.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import * as source from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }
const mem = () => mkdtemp(join(tmpdir(), "tmct-completions-wiring-"));

// Real facts about Widget (a Class in the committed fixture graph): defined in
// app/lib/b.mjs, contains a render method + a name attribute, inherits from Base,
// Widget.render calls fnAlpha. Phrased as ordinary prose BLOCKS (not "Q: .../A: ..."
// pairs — that shape is recallFromBlocks' own W2 memory-recall lane's territory, a
// DIFFERENT lane this suite must not accidentally exercise instead), the same shape
// test/completions-complete.test.mjs's own fixture uses.
const WIDGET_BLOCKS = {
  "blk-widget-1": "Widget is a Class defined in app/lib/b.mjs. Widget contains a render method and a name attribute. This detail is not important here.",
  "blk-widget-2": "Widget.render calls fnAlpha to do its core work. The render method is the main entry point callers use. This detail is not important here.",
  "blk-widget-3": "Widget inherits from Base, sharing its shared structure. Button in turn inherits from Widget. This detail is not important here.",
};

async function seedWidgetRepo() {
  const dir = await mem();
  for (const [id, text] of Object.entries(WIDGET_BLOCKS)) await saveBlock(dir, { id, text });
  return dir;
}

test("COMPLETIONS RESCUE: \"give me a detailed summary of how X works\" now answers with real, grounded multi-sentence prose instead of the grammar wall", async () => {
  const dir = await seedWidgetRepo();
  try {
    const g = await graph();
    const { answer, record } = await runTurn(
      "can you give me a detailed summary of how the Widget works",
      { config: CONFIG, graph: g, memoryDir: dir },
    );
    assert.equal(record.via, "completion", "answered via the new COMPLETIONS RESCUE lane, not the grammar wall");
    assert.equal(record.miss, false, "a real completion is not recorded as a miss");
    assert.doesNotMatch(answer, /couldn't parse this as a graph question/, "the plain grammar wall must be gone");
    // multi-sentence, and every word traces back to the seeded Widget blocks — nothing
    // invented (src/completions/ is purely extractive by construction).
    assert.ok((answer.match(/[.!?]/g) || []).length >= 2, "a real completion reads as multiple sentences");
    assert.match(answer, /Widget/, "the answer is actually about the asked-about subject");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("COMPLETIONS RESCUE: the \"explain in detail how X works\" and bare \"detailed overview of X\" siblings also reach the pipeline", async () => {
  const dir = await seedWidgetRepo();
  try {
    const g = await graph();
    const r1 = await runTurn("explain in detail how the Widget works", { config: CONFIG, graph: g, memoryDir: dir });
    assert.equal(r1.record.via, "completion");
    assert.equal(r1.record.miss, false);

    clearCache();
    const r2 = await runTurn("give me a detailed overview of the Widget", { config: CONFIG, graph: g, memoryDir: dir });
    assert.equal(r2.record.via, "completion");
    assert.equal(r2.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("COMPLETIONS RESCUE guard: an unrelated/unknown subject declines honestly — never fabricates, falls through to the ordinary miss", async () => {
  const dir = await seedWidgetRepo(); // real corpus present, but about a DIFFERENT subject
  try {
    const g = await graph();
    const { answer, record } = await runTurn(
      "give me a detailed summary of how zzznonexistentThing works",
      { config: CONFIG, graph: g, memoryDir: dir },
    );
    assert.notEqual(record.via, "completion", "nothing groundable exists for this term — must not claim the turn");
    assert.equal(record.miss, true, "an honest miss, not a fabricated completion");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("COMPLETIONS RESCUE guard: with no memoryDir at all, the lane declines immediately (no corpus to search)", async () => {
  const g = await graph();
  const { record } = await runTurn("give me a detailed summary of how the Widget works", { config: CONFIG, graph: g });
  assert.notEqual(record.via, "completion");
});

// ---- must not shadow the EXISTING describe-wrapper lane (test/chat-ux.test.mjs's own
// "describe-wrapper rescue" tests) — re-asserted here, unmodified, against the SAME
// fixture graph, to prove this new (4e) lane sits strictly AFTER (4d) and never
// preempts it. ----

test("describe-wrapper rescue still owns its own phrasings, unshadowed by the new COMPLETIONS RESCUE lane", async () => {
  const g = await graph();
  const r1 = await runTurn("can you describe Widget for me", { config: CONFIG, graph: g });
  assert.equal(r1.record.via, "describe");
  assert.equal(r1.record.miss, false);
  assert.match(r1.answer, /^Widget — Class/);

  const r2 = await runTurn("can you tell me more about Widget", { config: CONFIG, graph: g });
  assert.equal(r2.record.via, "describe");
  assert.match(r2.answer, /^Widget — Class/);
});

test("describe-wrapper rescue guard: 'tell me about <enumerable concept>' still reaches the relation force, never the describe rescue or the completions rescue", async () => {
  const g = await graph();
  const r = await runTurn("tell me about inheritance", { config: CONFIG, graph: g });
  assert.notEqual(r.record.via, "describe");
  assert.notEqual(r.record.via, "completion");
  assert.equal(r.record.miss, false);
  assert.match(r.answer, /class deriving its structure and behaviour from another/);
});
