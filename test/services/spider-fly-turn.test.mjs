// spider-fly-turn.test.mjs — direct unit coverage for spiderFlyTurn's own
// gameConfig threading: a custom override reaches startSpiderFlyGame's own
// written facts through the opening turn, without going through the full
// chat session/corpus lane (that end-to-end wiring is covered by the
// games/spider-fly corpus lane instead).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spiderFlyTurn } from "../../src/services/spider-fly-turn.mjs";
import { DEFAULT_GAME_CONFIG } from "../../src/domain/game-config.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

test("spiderFlyTurn's opening move threads a custom gameConfig into startSpiderFlyGame's own written facts", async () => {
  const memoryDir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-turn-config-"));
  try {
    const gameConfig = {
      ...DEFAULT_GAME_CONFIG,
      spiderFly: { ...DEFAULT_GAME_CONFIG.spiderFly, spiderInitialMass: 42 },
    };
    const planHolder = { state: null };
    const result = await spiderFlyTurn("watch the spider and the fly", { planHolder, memoryDir, env: {}, gameConfig });
    assert.ok(result, "the opener is claimed by the spider-fly lane");

    const rows = readFactRows(await loadMemory(memoryDir));
    assert.ok(
      rows.some((r) => r.subject === "spider-1" && r.predicate === "mgx:mass" && r.object === "42"),
      "the custom spiderInitialMass reaches the freshly-started game's own written facts, not the shipped default of 15",
    );
  } finally {
    await rm(memoryDir, { recursive: true, force: true });
  }
});

test("spiderFlyTurn defaults to DEFAULT_GAME_CONFIG when no gameConfig is passed — every existing caller that omits it keeps working", async () => {
  const memoryDir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-turn-default-"));
  try {
    const planHolder = { state: null };
    const result = await spiderFlyTurn("watch the spider and the fly", { planHolder, memoryDir, env: {} });
    assert.ok(result);

    const rows = readFactRows(await loadMemory(memoryDir));
    assert.ok(
      rows.some((r) => r.subject === "spider-1" && r.predicate === "mgx:mass" && r.object === String(DEFAULT_GAME_CONFIG.spiderFly.spiderInitialMass)),
      "with no gameConfig override, the shipped default spiderInitialMass is what lands in the store",
    );
  } finally {
    await rm(memoryDir, { recursive: true, force: true });
  }
});
