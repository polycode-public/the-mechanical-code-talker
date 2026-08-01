// game-config.mjs — the shipped defaults for every game's tuning knobs
// (spider-fly's mass economy, guess-the-number's default/max bounds, the
// shared plan lane's search-depth cap) and the pure function that folds a
// normalized tmct.toml's [games]/[planning] tables over them.
//
// Every other game parameter lives in the game's own taught-English world
// definition (data/games/hanoi-3.txt and friends) and never needs a knob
// here — only a genuine magic number with no taught-fact home does.
//
// Pure: no filesystem access, no module-level mutable state. resolveGameConfig
// is safe to call once per session and the result handed around freely —
// several games/tests running in the same process never share or mutate one
// another's resolved config.

export const DEFAULT_GAME_CONFIG = Object.freeze({
  spiderFly: Object.freeze({
    spiderInitialMass: 15,
    spiderMassDecrementPerTurn: 0.5,
    flyInitialMass: 10,
    flyMassDecrementPerTurn: 1,
    spiderVisionRadius: 4,
    flyVisionRadius: 4,
    eggHatchDelayTurns: 3,
    flySpawnIntervalTurns: 3,
    eggLayMassThreshold: 25,
    eggHatchCount: 2,
    minHatchlingMass: 3,
    webDurationTurns: 10,
  }),
  // The drains are what make a mud character mortal: every scripted turn
  // charges one, and a character whose mass reaches zero starves and takes no
  // more turns. They are sized against the demo page's own default run (400
  // shared turns, so roughly 200 each for two animals) — an animal that never
  // eats dies about two thirds of the way through, and one that forages does
  // not. A drain that emptied a starting mass in twenty turns would end every
  // run before it had shown anything.
  mud: Object.freeze({
    moleInitialMass: 8,
    moleMassDecrementPerTurn: 0.06,
    moleSpeed: 1,
    moleDigReach: 1,
    voleInitialMass: 6,
    voleMassDecrementPerTurn: 0.05,
    voleSpeed: 1,
    voleDigReach: 1,
    badgerInitialMass: 20,
    badgerMassDecrementPerTurn: 0.08,
    badgerSpeed: 2,
    badgerDigReach: 2,
    groundhogInitialMass: 12,
    groundhogMassDecrementPerTurn: 0.06,
    groundhogSpeed: 2,
    groundhogDigReach: 2,
    meerkatInitialMass: 9,
    meerkatMassDecrementPerTurn: 0.05,
    meerkatSpeed: 1,
    meerkatDigReach: 1,
  }),
  // The town square's knobs are keyed by role, not by species: its cast is a
  // predator/prey pair by construction, so a later pair is a new roles object
  // and no edit here. (mud above went the other way because its cast is
  // authored per world.) The drains sit on mud's scale against the deck's own
  // 400-turn default: a prey that never eats starves after about 133 turns, a
  // predator after 250.
  //
  // maxPreyPopulation and maxFoodItems are the two knobs that keep that
  // arithmetic from running away. Prey arrive every 5 turns and live ~133, so
  // an uncapped 400-turn run ends with roughly 80 of them on a 144-cell board
  // — a solid carpet of goblins, and every tick paying for their planning.
  // Food spawns faster still. Both caps are checked before a spawn, so
  // reaching one simply skips that turn's arrival.
  mudiii: Object.freeze({
    predatorInitialMass: 20,
    predatorMassDecrementPerTurn: 0.08,
    predatorVisionRadius: 4,
    preyInitialMass: 8,
    preyMassDecrementPerTurn: 0.06,
    preyVisionRadius: 3,
    preySpawnIntervalTurns: 5,
    foodSpawnIntervalTurns: 3,
    spawnedFoodMass: 1,
    placedFoodMass: 2,
    maxPreyPopulation: 6,
    maxFoodItems: 8,
  }),
  guessNumber: Object.freeze({
    defaultLo: 1,
    defaultHi: 100,
    maxBound: 1_000_000_000,
  }),
  // Whether the adventure surface accepts teaching. One knob behind a page
  // checkbox, the CLI flag and the corpus rows, so all three agree.
  adventure: Object.freeze({
    teach: false,
  }),
  planning: Object.freeze({
    maxDepth: 300,
  }),
});

// snake_case tmct.toml key -> camelCase internal key, one map per table —
// mirrors how toml-config.mjs's normalizeConfig maps every other section
// (e.g. [tune]) onto its own internal shape.
const SPIDER_FLY_KEY_MAP = Object.freeze({
  spider_initial_mass: "spiderInitialMass",
  spider_mass_decrement_per_turn: "spiderMassDecrementPerTurn",
  fly_initial_mass: "flyInitialMass",
  fly_mass_decrement_per_turn: "flyMassDecrementPerTurn",
  spider_vision_radius: "spiderVisionRadius",
  fly_vision_radius: "flyVisionRadius",
  egg_hatch_delay_turns: "eggHatchDelayTurns",
  fly_spawn_interval_turns: "flySpawnIntervalTurns",
  egg_lay_mass_threshold: "eggLayMassThreshold",
  egg_hatch_count: "eggHatchCount",
  min_hatchling_mass: "minHatchlingMass",
  web_duration_turns: "webDurationTurns",
});

const MUD_KEY_MAP = Object.freeze({
  mole_initial_mass: "moleInitialMass",
  mole_mass_decrement_per_turn: "moleMassDecrementPerTurn",
  mole_speed: "moleSpeed",
  mole_dig_reach: "moleDigReach",
  vole_initial_mass: "voleInitialMass",
  vole_mass_decrement_per_turn: "voleMassDecrementPerTurn",
  vole_speed: "voleSpeed",
  vole_dig_reach: "voleDigReach",
  badger_initial_mass: "badgerInitialMass",
  badger_mass_decrement_per_turn: "badgerMassDecrementPerTurn",
  badger_speed: "badgerSpeed",
  badger_dig_reach: "badgerDigReach",
  groundhog_initial_mass: "groundhogInitialMass",
  groundhog_mass_decrement_per_turn: "groundhogMassDecrementPerTurn",
  groundhog_speed: "groundhogSpeed",
  groundhog_dig_reach: "groundhogDigReach",
  meerkat_initial_mass: "meerkatInitialMass",
  meerkat_mass_decrement_per_turn: "meerkatMassDecrementPerTurn",
  meerkat_speed: "meerkatSpeed",
  meerkat_dig_reach: "meerkatDigReach",
});

const MUDIII_KEY_MAP = Object.freeze({
  predator_initial_mass: "predatorInitialMass",
  predator_mass_decrement_per_turn: "predatorMassDecrementPerTurn",
  predator_vision_radius: "predatorVisionRadius",
  prey_initial_mass: "preyInitialMass",
  prey_mass_decrement_per_turn: "preyMassDecrementPerTurn",
  prey_vision_radius: "preyVisionRadius",
  prey_spawn_interval_turns: "preySpawnIntervalTurns",
  food_spawn_interval_turns: "foodSpawnIntervalTurns",
  spawned_food_mass: "spawnedFoodMass",
  placed_food_mass: "placedFoodMass",
  max_prey_population: "maxPreyPopulation",
  max_food_items: "maxFoodItems",
});

const ADVENTURE_KEY_MAP = Object.freeze({
  teach: "teach",
});

const GUESS_NUMBER_KEY_MAP = Object.freeze({
  default_lo: "defaultLo",
  default_hi: "defaultHi",
  max_bound: "maxBound",
});

const PLANNING_KEY_MAP = Object.freeze({
  max_depth: "maxDepth",
});

/** `defaults` with every key `keyMap` names overridden by its raw snake_case
 *  counterpart in `raw`, when actually present — every unset sibling keeps
 *  the default, so the result is always fully populated. */
function mergeSection(defaults, raw, keyMap) {
  const out = { ...defaults };
  if (!raw || typeof raw !== "object") return out;
  for (const [tomlKey, camelKey] of Object.entries(keyMap)) {
    if (raw[tomlKey] !== undefined) out[camelKey] = raw[tomlKey];
  }
  return out;
}

/** The species a mud character id names — "mole-1" -> "mole" — which is how
 *  every per-species knob above is keyed. Pure. */
export function mudSpeciesOf(characterId) {
  return String(characterId).replace(/-\d+$/, "");
}

/** What one turn costs `characterId` in mass, from the resolved `mud` section.
 *  Zero for a species the config carries no drain for: a knob nobody set is not
 *  a reason to invent a number and starve something with it. Pure. */
export function mudMassDrainPerTurn(mudConfig, characterId) {
  const drain = mudConfig?.[`${mudSpeciesOf(characterId)}MassDecrementPerTurn`];
  return Number.isFinite(drain) ? drain : 0;
}

/** The mass denominator a spider-and-fly class's HUD bar and sprite
 *  expression both scale against — "how full" reads the same on either. `cls`
 *  is "spider" or "fly"; any other class (an egg, or a class this world adds
 *  later) has no denominator and gets null, never a guessed number. `config`
 *  is the page's own `{ maxSpiderMass, maxFlyMass }` pair. Pure. */
export function massScaleFor(cls, config) {
  if (cls === "spider") return config?.maxSpiderMass ?? null;
  if (cls === "fly") return config?.maxFlyMass ?? null;
  return null;
}

/** The mass denominator a town-square HUD bar scales against, from a resolved
 *  `mudiii` section. `role` is "predator" or "prey"; anything else — a crumb,
 *  a prop, a role a later cast adds — has no denominator and gets null, never
 *  a guessed number. Separate from massScaleFor above on purpose: that one
 *  takes a species literal off the spider-and-fly page, and folding a second
 *  vocabulary into it would turn a two-line read into a registry. Pure. */
export function mudiiiMassScaleFor(role, config) {
  if (role === "predator") return config?.predatorInitialMass ?? null;
  if (role === "prey") return config?.preyInitialMass ?? null;
  return null;
}

/**
 * Fold a normalized tmct.toml's `games`/`planning` tables (the raw sparse
 * pass-through src/adapters/toml-config.mjs's normalizeConfig produces —
 * snake_case keys, present only when actually set in the file) over
 * DEFAULT_GAME_CONFIG. `toml` may be null/undefined (no tmct.toml, or one
 * that failed to load) — every key then falls back to its default. Returns a
 * fully populated object of the same shape as DEFAULT_GAME_CONFIG; toml value
 * wins per key when present, default otherwise.
 */
export function resolveGameConfig(toml) {
  const games = toml?.games ?? {};
  return {
    spiderFly: mergeSection(DEFAULT_GAME_CONFIG.spiderFly, games["spider-fly"], SPIDER_FLY_KEY_MAP),
    mud: mergeSection(DEFAULT_GAME_CONFIG.mud, games.mud, MUD_KEY_MAP),
    mudiii: mergeSection(DEFAULT_GAME_CONFIG.mudiii, games.mudiii, MUDIII_KEY_MAP),
    guessNumber: mergeSection(DEFAULT_GAME_CONFIG.guessNumber, games["guess-number"], GUESS_NUMBER_KEY_MAP),
    adventure: mergeSection(DEFAULT_GAME_CONFIG.adventure, games.adventure, ADVENTURE_KEY_MAP),
    planning: mergeSection(DEFAULT_GAME_CONFIG.planning, toml?.planning, PLANNING_KEY_MAP),
  };
}
