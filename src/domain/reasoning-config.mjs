// reasoning-config.mjs — the shipped defaults for the reasoning-lane tuning
// knobs (syllogise's own budget/depth, the EL classifier's budget/rounds, the
// shared environment-set cap, and the DL tableau's step/branch/node budgets
// phase 3 reads) and the pure function that folds a normalized tmct.toml's
// `[reasoning]` table over them — the same precedent resolveGameConfig sets
// for `[games.*]`/`[planning]`.
//
// Pure: no filesystem access, no module-level mutable state.

export const DEFAULT_REASONING_CONFIG = Object.freeze({
  syllogiseBudget: 50,
  syllogiseDepth: 32,
  classifyBudget: 2000,
  classifyRounds: 64,
  maxEnvironments: 4,
  proveSteps: 5000,
  proveBranches: 256,
  proveNodes: 512,
  // The automatic /prove fallback's OWN, tighter budget — kept apart from
  // prove_steps/branches/nodes above so raising the command's budget never
  // slows every ordinary question that falls through to it on a miss.
  askProveFallback: true,
  askProveSteps: 1000,
  askProveBranches: 64,
  askProveNodes: 128,
});

// snake_case tmct.toml key -> camelCase internal key — mirrors game-config.mjs's own KEY_MAP tables.
const REASONING_KEY_MAP = Object.freeze({
  syllogise_budget: "syllogiseBudget",
  syllogise_depth: "syllogiseDepth",
  classify_budget: "classifyBudget",
  classify_rounds: "classifyRounds",
  max_environments: "maxEnvironments",
  prove_steps: "proveSteps",
  prove_branches: "proveBranches",
  prove_nodes: "proveNodes",
  ask_prove_steps: "askProveSteps",
  ask_prove_branches: "askProveBranches",
  ask_prove_nodes: "askProveNodes",
});

// The one boolean knob in this table — folded through clampBoolean, never
// clampPositiveInt, because clampPositiveInt rejects 0 and would silently
// restore the default the moment someone tried to set ask_prove_fallback = 0.
const REASONING_BOOLEAN_KEY_MAP = Object.freeze({
  ask_prove_fallback: "askProveFallback",
});

/** A positive-integer knob, clamped to its shipped default when the raw value
 *  is missing, non-numeric, non-integer or not positive — a corrupt tmct.toml
 *  value degrades to the default, never a crash. */
function clampPositiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** A boolean knob, clamped to its shipped default when the raw value isn't
 *  literally `true` or `false` — the same corrupt-value-degrades-to-default
 *  contract clampPositiveInt gives every numeric knob. */
function clampBoolean(raw, fallback) {
  return typeof raw === "boolean" ? raw : fallback;
}

/**
 * Fold a normalized tmct.toml's `reasoning` table (the raw sparse pass-through
 * src/adapters/toml-config.mjs's normalizeConfig produces — snake_case keys,
 * present only when actually set in the file) over DEFAULT_REASONING_CONFIG.
 * `toml` may be null/undefined (no tmct.toml, or one that failed to load) —
 * every key then falls back to its default. Returns a fully populated object
 * of the same shape as DEFAULT_REASONING_CONFIG.
 */
export function resolveReasoningConfig(toml) {
  const raw = toml?.reasoning || {};
  const out = { ...DEFAULT_REASONING_CONFIG };
  for (const [tomlKey, camelKey] of Object.entries(REASONING_KEY_MAP)) {
    if (raw[tomlKey] !== undefined) out[camelKey] = clampPositiveInt(raw[tomlKey], DEFAULT_REASONING_CONFIG[camelKey]);
  }
  for (const [tomlKey, camelKey] of Object.entries(REASONING_BOOLEAN_KEY_MAP)) {
    if (raw[tomlKey] !== undefined) out[camelKey] = clampBoolean(raw[tomlKey], DEFAULT_REASONING_CONFIG[camelKey]);
  }
  return out;
}
