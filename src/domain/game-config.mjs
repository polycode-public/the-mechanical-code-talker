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
  guessNumber: Object.freeze({
    defaultLo: 1,
    defaultHi: 100,
    maxBound: 1_000_000_000,
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
    guessNumber: mergeSection(DEFAULT_GAME_CONFIG.guessNumber, games["guess-number"], GUESS_NUMBER_KEY_MAP),
    planning: mergeSection(DEFAULT_GAME_CONFIG.planning, toml?.planning, PLANNING_KEY_MAP),
  };
}
