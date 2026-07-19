// game-config.test.mjs — direct unit coverage for src/domain/game-config.mjs's
// resolveGameConfig: the no-toml default fill, a partial [games.spider-fly]
// override merging over the defaults without dropping unset siblings, and
// the snake_case -> camelCase mapping for every recognized key across all
// three tables ([games.spider-fly], [games.guess-number], [planning]).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GAME_CONFIG, resolveGameConfig } from "../../src/domain/game-config.mjs";

test("resolveGameConfig returns the full shipped defaults when given no toml input at all", () => {
  assert.deepEqual(resolveGameConfig(null), DEFAULT_GAME_CONFIG);
  assert.deepEqual(resolveGameConfig(undefined), DEFAULT_GAME_CONFIG);
  assert.deepEqual(resolveGameConfig({}), DEFAULT_GAME_CONFIG);
});

test("resolveGameConfig: a partial [games.spider-fly] override merges over the defaults without dropping unset siblings", () => {
  const toml = { games: { "spider-fly": { spider_mass_decrement_per_turn: 2 } } };
  const resolved = resolveGameConfig(toml);
  assert.equal(resolved.spiderFly.spiderMassDecrementPerTurn, 2, "the set key overrides the default");
  assert.equal(resolved.spiderFly.spiderInitialMass, DEFAULT_GAME_CONFIG.spiderFly.spiderInitialMass, "every unset sibling keeps its default");
  assert.equal(resolved.spiderFly.flyInitialMass, DEFAULT_GAME_CONFIG.spiderFly.flyInitialMass);
  assert.equal(resolved.spiderFly.spiderVisionRadius, DEFAULT_GAME_CONFIG.spiderFly.spiderVisionRadius);
  assert.equal(resolved.spiderFly.flyVisionRadius, DEFAULT_GAME_CONFIG.spiderFly.flyVisionRadius);
  assert.deepEqual(resolved.guessNumber, DEFAULT_GAME_CONFIG.guessNumber, "an unrelated table is completely untouched");
  assert.deepEqual(resolved.planning, DEFAULT_GAME_CONFIG.planning);
});

test("resolveGameConfig: every [games.spider-fly] snake_case key maps onto its camelCase counterpart", () => {
  const toml = {
    games: {
      "spider-fly": {
        spider_initial_mass: 20,
        spider_mass_decrement_per_turn: 0.25,
        fly_initial_mass: 12,
        fly_mass_decrement_per_turn: 2,
        spider_vision_radius: 6,
        fly_vision_radius: 7,
        egg_hatch_delay_turns: 4,
        fly_spawn_interval_turns: 5,
        egg_lay_mass_threshold: 30,
        egg_hatch_count: 3,
        min_hatchling_mass: 4,
        web_duration_turns: 8,
      },
    },
  };
  const resolved = resolveGameConfig(toml);
  assert.deepEqual(resolved.spiderFly, {
    spiderInitialMass: 20,
    spiderMassDecrementPerTurn: 0.25,
    flyInitialMass: 12,
    flyMassDecrementPerTurn: 2,
    spiderVisionRadius: 6,
    flyVisionRadius: 7,
    eggHatchDelayTurns: 4,
    flySpawnIntervalTurns: 5,
    eggLayMassThreshold: 30,
    eggHatchCount: 3,
    minHatchlingMass: 4,
    webDurationTurns: 8,
  });
});

test("resolveGameConfig: every [games.guess-number] snake_case key maps onto its camelCase counterpart", () => {
  const toml = { games: { "guess-number": { default_lo: 5, default_hi: 50, max_bound: 1000 } } };
  const resolved = resolveGameConfig(toml);
  assert.deepEqual(resolved.guessNumber, { defaultLo: 5, defaultHi: 50, maxBound: 1000 });
  assert.deepEqual(resolved.spiderFly, DEFAULT_GAME_CONFIG.spiderFly, "an unrelated table is completely untouched");
});

test("resolveGameConfig: [planning] max_depth maps onto maxDepth", () => {
  const resolved = resolveGameConfig({ planning: { max_depth: 12 } });
  assert.deepEqual(resolved.planning, { maxDepth: 12 });
});

test("resolveGameConfig: a partial [games.guess-number] override leaves the unset sibling at its default", () => {
  const resolved = resolveGameConfig({ games: { "guess-number": { default_hi: 200 } } });
  assert.equal(resolved.guessNumber.defaultHi, 200);
  assert.equal(resolved.guessNumber.defaultLo, DEFAULT_GAME_CONFIG.guessNumber.defaultLo);
  assert.equal(resolved.guessNumber.maxBound, DEFAULT_GAME_CONFIG.guessNumber.maxBound);
});

test("resolveGameConfig returns a fully populated object of the same shape every time, never sparse", () => {
  const resolved = resolveGameConfig({ games: { "spider-fly": { spider_vision_radius: 2 } } });
  assert.deepEqual(Object.keys(resolved).sort(), ["guessNumber", "planning", "spiderFly"]);
  assert.deepEqual(Object.keys(resolved.spiderFly).sort(), Object.keys(DEFAULT_GAME_CONFIG.spiderFly).sort());
  assert.deepEqual(Object.keys(resolved.guessNumber).sort(), Object.keys(DEFAULT_GAME_CONFIG.guessNumber).sort());
  assert.deepEqual(Object.keys(resolved.planning).sort(), Object.keys(DEFAULT_GAME_CONFIG.planning).sort());
});

test("DEFAULT_GAME_CONFIG.spiderFly.spiderMassDecrementPerTurn is 0.5 (slowed from the shipped 1) — the operator's own starve-too-fast fix", () => {
  assert.equal(DEFAULT_GAME_CONFIG.spiderFly.spiderMassDecrementPerTurn, 0.5);
});
