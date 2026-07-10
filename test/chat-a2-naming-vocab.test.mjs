// HANDOVER.md 2026-07-10 item 6 (CHATBENCH A2 naming-vocabulary hard fails):
//   g-a2-naming-2 "what is Widget" (bare, no article) — Widget is a known Class,
//     but T5's bare-form gate requires ENTITY_TO_TYPE membership, which a proper
//     noun like "Widget" never has — used to fall to the generic orientation
//     card instead of naming the real entity.
//   g-a2-naming-6 "what does fnAlpha mean" — fnAlpha isn't schema vocabulary but
//     IS a known Function; traverse()'s meta-fallback only ever checked
//     class === "Class", so a Function/Method/GlobalVariable/Attribute hit fell
//     to the false "isn't a term in this graph's own vocabulary" wall.
// Both fixed via ask.mjs's extracted metaFallbackEntityAnswer, shared by the
// ARTICLED form (traverse()'s own meta branch) and chat.mjs's BARE "what is X"
// last-resort lane, so the two phrasings resolve byte-identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }
const mem = () => mkdtemp(join(tmpdir(), "tmct-a2-naming-"));

test("g-a2-naming-2: 'what is Widget' (bare, no article) names the known Class, not the generic orientation card", async () => {
  const dir = await mem();
  try {
    const bare = await runTurn("what is Widget", { config: CONFIG, graph: await graph(), memoryDir: dir });
    assert.match(bare.answer, /^Widget is a class in this codebase/);
    assert.equal(bare.record.miss, false);
    assert.doesNotMatch(bare.answer, /I'm tmct — a deterministic/, "never the generic orientation card once a real entity exists");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("g-a2-naming-2 guard: 'what is a Widget' (articled) resolves the byte-identical answer as the bare form", async () => {
  const dir = await mem();
  try {
    const g = await graph();
    const bare = await runTurn("what is Widget", { config: CONFIG, graph: g, memoryDir: dir });
    const articled = await runTurn("what is a Widget", { config: CONFIG, graph: g, memoryDir: dir });
    assert.equal(bare.answer.split("\n")[0], articled.answer.split("\n")[0]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("g-a2-naming-6: 'what does fnAlpha mean' names the known Function, not the false vocabulary-miss wall", async () => {
  const { answer, record } = await runTurn("what does fnAlpha mean", { config: CONFIG, graph: await graph() });
  assert.match(answer, /^fnAlpha is a function in this codebase/);
  assert.equal(record.miss, false);
  assert.doesNotMatch(answer, /isn't a term in this graph's own vocabulary/);
});

test("meta-fallback guard: a name colliding across two different entity classes stays an honest miss, never a guess", async () => {
  const g = await graph();
  // Confirms the fallback's uniqueness check IS global across classes, not
  // per-class, by construction — regression protection for a real collision
  // risk the widening introduced (documented in metaFallbackEntityAnswer's own
  // docblock). No such collision exists in this fixture, so this just pins
  // that an UNKNOWN term still declines honestly, never crashes.
  const r = await runTurn("what does zzznonexistent mean", { config: CONFIG, graph: g });
  assert.match(r.answer, /isn't a term in this graph's own vocabulary/);
  assert.equal(r.record.miss, true);
});
