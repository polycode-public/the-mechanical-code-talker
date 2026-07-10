// HANDOVER.md 2026-07-10 item 4 / PLAN_INFERENCE_TESTING.md INF-B2 §4 stage 4:
// cls-svf1 (someValuesFrom restriction-class membership, OWL 2 RL Table 8) had a
// solid kernel rule (src/syllogise.mjs's deriveSomeValuesFromApplication, 100%
// on INFBENCH's kernel arm) but no live chat-query wiring — INFBENCH's 10 new
// b2Svf1Apply positive cases all showed "unproven" on the chat arm purely
// because nobody had copied the cax-dw live-chase pattern (chat.mjs's isaAsk
// block) for this rule yet. This file pins the fix: chat.mjs now runs the SAME
// live, read-only proof chase cax-dw already gets, so a taught restriction
// ("every N1 that VERBs a N2 is a N3") answers its own membership query
// directly from chat, not just from the offline `tmct syllogise` batch pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";

const CONFIG = {};
const mem = () => mkdtemp(join(tmpdir(), "tmct-svf1-"));

test("HANDOVER item 4: a taught someValuesFrom restriction answers 'is X a <restriction>' live from chat", async () => {
  const dir = await mem();
  try {
    const taught = await runTurn("every pipeline that imports a method is a formatter", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.match(taught.answer, /some-imports-method owl:onProperty imports/);
    assert.match(taught.answer, /some-imports-method owl:someValuesFrom method/);

    await runTurn("e70.mjs imports e71.mjs", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    await runTurn("e71.mjs is a method", { config: CONFIG, memoryDir: dir, sessionId: "s1" });

    const asked = await runTurn("is e70.mjs a some-imports-method", { config: CONFIG, memoryDir: dir });
    assert.match(asked.answer, /^yes —/, "the restriction-class membership resolves live, not just via the offline syllogise pass");
    assert.equal(asked.record.miss, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("HANDOVER item 4 guard: the restriction chase never fires without BOTH a taught property edge and the target's taught type", async () => {
  const dir = await mem();
  try {
    await runTurn("every pipeline that imports a method is a formatter", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    // e70.mjs imports e71.mjs, but e71.mjs was never taught to be a method —
    // the premise is incomplete, so this must stay an honest miss, never a guess.
    await runTurn("e70.mjs imports e71.mjs", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    const asked = await runTurn("is e70.mjs a some-imports-method", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(asked.answer, /^yes —/, "an incomplete premise never fabricates a yes");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("HANDOVER item 4 guard: an untaught restriction name is an honest miss, not a crash", async () => {
  const dir = await mem();
  try {
    const asked = await runTurn("is e70.mjs a some-imports-method", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(asked.answer, /^yes —/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
