// game-config.test.mjs — direct unit coverage for src/domain/game-config.mjs's
// resolveGameConfig: the no-toml default fill, a partial override merging over
// the defaults without dropping unset siblings, and the snake_case -> camelCase
// mapping for every recognized key in every table. That last one is the test
// that earns its keep: a typo'd key map entry silently drops the override and
// nothing else notices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GAME_CONFIG, resolveGameConfig, massScaleFor, mudiiiMassScaleFor } from "../../src/domain/game-config.mjs";

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

test("resolveGameConfig: mud game defaults resolve correctly for at least two species", () => {
  const resolved = resolveGameConfig(null);
  assert.equal(resolved.mud.moleInitialMass, DEFAULT_GAME_CONFIG.mud.moleInitialMass);
  assert.equal(resolved.mud.moleSpeed, 1);
  assert.equal(resolved.mud.badgerInitialMass, DEFAULT_GAME_CONFIG.mud.badgerInitialMass);
  assert.equal(resolved.mud.badgerSpeed, 2, "larger animals have higher speed");
  assert.equal(resolved.mud.groundhogDigReach, 2, "larger animals have higher dig reach");
});

test("resolveGameConfig: a partial [games.mud] override merges over the defaults without dropping unset siblings", () => {
  const toml = { games: { mud: { mole_speed: 3 } } };
  const resolved = resolveGameConfig(toml);
  assert.equal(resolved.mud.moleSpeed, 3, "the set key overrides the default");
  assert.equal(resolved.mud.moleInitialMass, DEFAULT_GAME_CONFIG.mud.moleInitialMass, "every unset sibling keeps its default");
  assert.equal(resolved.mud.badgerSpeed, DEFAULT_GAME_CONFIG.mud.badgerSpeed, "unrelated species are untouched");
  assert.deepEqual(resolved.spiderFly, DEFAULT_GAME_CONFIG.spiderFly, "an unrelated table is completely untouched");
});

test("resolveGameConfig: [games.mud] snake_case keys map onto camelCase counterparts", () => {
  const toml = {
    games: {
      mud: {
        mole_initial_mass: 10,
        mole_speed: 2,
        badger_initial_mass: 25,
        badger_dig_reach: 3,
        groundhog_mass_decrement_per_turn: 0.5,
      },
    },
  };
  const resolved = resolveGameConfig(toml);
  assert.equal(resolved.mud.moleInitialMass, 10);
  assert.equal(resolved.mud.moleSpeed, 2);
  assert.equal(resolved.mud.badgerInitialMass, 25);
  assert.equal(resolved.mud.badgerDigReach, 3);
  assert.equal(resolved.mud.groundhogMassDecrementPerTurn, 0.5);
});

test("resolveGameConfig returns a fully populated object of the same shape every time, never sparse", () => {
  const resolved = resolveGameConfig({ games: { "spider-fly": { spider_vision_radius: 2 } } });
  assert.deepEqual(Object.keys(resolved).sort(), ["adventure", "guessNumber", "mud", "mudiii", "planning", "spiderFly"]);
  assert.deepEqual(Object.keys(resolved.spiderFly).sort(), Object.keys(DEFAULT_GAME_CONFIG.spiderFly).sort());
  assert.deepEqual(Object.keys(resolved.mud).sort(), Object.keys(DEFAULT_GAME_CONFIG.mud).sort());
  assert.deepEqual(Object.keys(resolved.mudiii).sort(), Object.keys(DEFAULT_GAME_CONFIG.mudiii).sort());
  assert.deepEqual(Object.keys(resolved.guessNumber).sort(), Object.keys(DEFAULT_GAME_CONFIG.guessNumber).sort());
  assert.deepEqual(Object.keys(resolved.adventure).sort(), Object.keys(DEFAULT_GAME_CONFIG.adventure).sort());
  assert.deepEqual(Object.keys(resolved.planning).sort(), Object.keys(DEFAULT_GAME_CONFIG.planning).sort());
});

test("resolveGameConfig: the mudiii table arrives fully populated with no toml at all", () => {
  const resolved = resolveGameConfig(null);
  assert.deepEqual(resolved.mudiii, {
    predatorInitialMass: 20,
    predatorMassDecrementPerTurn: 0.08,
    predatorVisionRadius: 4,
    preyInitialMass: 8,
    preyMassDecrementPerTurn: 0.06,
    preyVisionRadius: 3,
    preySpawnIntervalTurns: 5,
    foodSpawnIntervalTurns: 3,
    spawnedFoodMass: 2,
    placedFoodMass: 2,
    maxPreyPopulation: 6,
    maxFoodItems: 8,
    foodVisionGated: true,
  });
  assert.ok(
    resolved.mudiii.predatorVisionRadius > resolved.mudiii.preyVisionRadius,
    "the predator out-sees its prey, which is what lets it stalk something that cannot see it back",
  );
});

test("resolveGameConfig: every [games.mudiii] snake_case key maps onto its camelCase counterpart", () => {
  const toml = {
    games: {
      mudiii: {
        predator_initial_mass: 30,
        predator_mass_decrement_per_turn: 0.1,
        predator_vision_radius: 6,
        prey_initial_mass: 12,
        prey_mass_decrement_per_turn: 0.09,
        prey_vision_radius: 5,
        prey_spawn_interval_turns: 7,
        food_spawn_interval_turns: 4,
        spawned_food_mass: 3,
        placed_food_mass: 5,
        max_prey_population: 9,
        max_food_items: 11,
        food_vision_gated: false,
      },
    },
  };
  assert.deepEqual(resolveGameConfig(toml).mudiii, {
    predatorInitialMass: 30,
    predatorMassDecrementPerTurn: 0.1,
    predatorVisionRadius: 6,
    preyInitialMass: 12,
    preyMassDecrementPerTurn: 0.09,
    preyVisionRadius: 5,
    preySpawnIntervalTurns: 7,
    foodSpawnIntervalTurns: 4,
    spawnedFoodMass: 3,
    placedFoodMass: 5,
    maxPreyPopulation: 9,
    maxFoodItems: 11,
    foodVisionGated: false,
  });
});

test("resolveGameConfig: a partial [games.mudiii] override merges over the defaults without dropping unset siblings", () => {
  const resolved = resolveGameConfig({ games: { mudiii: { prey_vision_radius: 1 } } });
  assert.equal(resolved.mudiii.preyVisionRadius, 1, "the set key overrides the default");
  assert.equal(resolved.mudiii.preyInitialMass, DEFAULT_GAME_CONFIG.mudiii.preyInitialMass, "every unset sibling keeps its default");
  assert.equal(resolved.mudiii.predatorVisionRadius, DEFAULT_GAME_CONFIG.mudiii.predatorVisionRadius, "the other role is untouched");
  assert.equal(resolved.mudiii.maxPreyPopulation, DEFAULT_GAME_CONFIG.mudiii.maxPreyPopulation);
  assert.deepEqual(resolved.mud, DEFAULT_GAME_CONFIG.mud, "an unrelated table is completely untouched");
});

test("the mudiii drains size both roles' lifespans to the same order as the deck's 400-turn default run", () => {
  const { mudiii } = DEFAULT_GAME_CONFIG;
  const preyLifespan = mudiii.preyInitialMass / mudiii.preyMassDecrementPerTurn;
  const predatorLifespan = mudiii.predatorInitialMass / mudiii.predatorMassDecrementPerTurn;
  assert.ok(preyLifespan > 100 && preyLifespan < 200, `a prey that never eats starves after ${preyLifespan} turns`);
  assert.ok(predatorLifespan > 200 && predatorLifespan < 300, `a predator that never eats starves after ${predatorLifespan} turns`);
});

test("resolveGameConfig: [games.adventure] teach defaults off and takes an override", () => {
  assert.equal(resolveGameConfig(null).adventure.teach, false);
  assert.equal(resolveGameConfig({ games: { adventure: { teach: true } } }).adventure.teach, true);
});

test("mudiiiMassScaleFor reads each role's starting mass off a resolved mudiii section, one source for both HUD bars", () => {
  const { mudiii } = DEFAULT_GAME_CONFIG;
  assert.equal(mudiiiMassScaleFor("predator", mudiii), 20);
  assert.equal(mudiiiMassScaleFor("prey", mudiii), 8);
});

test("mudiiiMassScaleFor: a role with no denominator (a crumb, a prop, a cast the config doesn't name) is null, never a guessed number", () => {
  assert.equal(mudiiiMassScaleFor("food", DEFAULT_GAME_CONFIG.mudiii), null);
  assert.equal(mudiiiMassScaleFor("predator", {}), null);
  assert.equal(mudiiiMassScaleFor("predator", undefined), null);
});

test("DEFAULT_GAME_CONFIG.spiderFly.spiderMassDecrementPerTurn is 0.5 (slowed from the shipped 1) — the operator's own starve-too-fast fix", () => {
  assert.equal(DEFAULT_GAME_CONFIG.spiderFly.spiderMassDecrementPerTurn, 0.5);
});

test("massScaleFor reads the spider/fly mass denominator off the given config, one shared source for a HUD bar and a sprite's expression", () => {
  const config = { maxSpiderMass: 25, maxFlyMass: 10 };
  assert.equal(massScaleFor("spider", config), 25);
  assert.equal(massScaleFor("fly", config), 10);
});

test("massScaleFor: a class with no denominator (an egg, or anything the config doesn't name) is null, never a guessed number", () => {
  const config = { maxSpiderMass: 25, maxFlyMass: 10 };
  assert.equal(massScaleFor("egg", config), null);
  assert.equal(massScaleFor("spider", {}), null);
  assert.equal(massScaleFor("spider", undefined), null);
});
