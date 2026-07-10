// HANDOVER.md 2026-07-10 item 10: a batch of smaller parsing gaps found in the
// same persona sweep (item 2/3's own sweep) that each resolve to a safe honest
// miss but land on the wrong lane — a batch pass since several share the same
// narrow-closed-set root cause.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn, createSession } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

test("HANDOVER item 10: 'what can you actually do' reaches orientation, not the grammar wall", async () => {
  const g = await graph();
  for (const q of ["what can you actually do", "what do you actually do", "ok so what can you actually do"]) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.match(r.answer, /^I'm tmct/, `"${q}" reaches the capability card`);
    assert.equal(r.record.miss, false);
  }
});

test("HANDOVER item 10: 'do you have feelings'/'are you sentient' get an honest personality decline, not a literal module lookup", async () => {
  const g = await graph();
  for (const q of ["do you have feelings", "do you have emotions", "are you sentient", "can you feel things"]) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.match(r.answer, /^No — I don't have feelings/, `"${q}" gets the feelings decline`);
    assert.doesNotMatch(r.answer, /no module matching/);
    assert.equal(r.record.miss, false);
  }
});

test("HANDOVER item 10: 'are you secretly GPT' resolves identity, not a mis-segmented graph query", async () => {
  const g = await graph();
  const r = await runTurn("are you secretly GPT", { config: CONFIG, graph: g });
  assert.match(r.answer, /^No — no LLM involved/);
  assert.equal(r.record.miss, false);
});

test("HANDOVER item 10: 'mod X imports' behaves identically to 'module X imports' — the abbreviation resolves the same entity type", async () => {
  const g = await graph();
  const mod = await runTurn("mod store.mjs imports", { config: CONFIG, graph: g });
  const module_ = await runTurn("module store.mjs imports", { config: CONFIG, graph: g });
  assert.equal(mod.answer, module_.answer, "'mod' and 'module' must resolve identically, not just avoid an outright crash");
});

test("HANDOVER item 10: 'please describe about Task' strips the redundant 'about' before resolving", async () => {
  const g = await graph();
  const doubled = await runTurn("please describe about TaskController", { config: CONFIG, graph: g });
  const plain = await runTurn("please describe TaskController", { config: CONFIG, graph: g });
  assert.equal(doubled.answer, plain.answer, "the doubled verb ('describe about X') must resolve the same as the clean form ('describe X')");
});

test("HANDOVER item 10: 'what is cache' (dropped article) resolves the same curated definition as 'what is a cache'", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-item10-cache-"));
  try {
    const s = await createSession({ repoPath: dir, env: {} });
    const articled = await s.turn("what is a cache");
    const bare = await s.turn("what is cache");
    await s.close();
    assert.match(articled.answer, /cache/i);
    assert.equal(bare.answer, articled.answer, "the bare form must resolve the same curated definition as the articled form");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
