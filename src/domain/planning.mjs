// planning.mjs — a domain-agnostic bounded state-space search primitive,
// generalizing syllogise.mjs's findIsaChain (fixed pre-loaded edges) to
// on-demand successor generation via applyActions(state). Pure, no I/O.

/** Default state-identity key: plain values compare by `String()`, plain
 *  objects by a stable-ish `JSON.stringify` (good enough for a toy/plain-
 *  object state; a caller with a richer state shape should pass its own
 *  `stateKey` that canonicalizes the fields that actually matter). */
function defaultStateKey(state) {
  if (state && typeof state === "object") return JSON.stringify(state);
  return String(state);
}

/** One-hop expansion of `startState` into an initial frontier — shared by
 *  findActionPath and findReachableSet below. */
function seedFrontier(startState, applyActions) {
  const frontier = [];
  for (const { action, nextState } of applyActions(startState) || []) {
    frontier.push({ state: nextState, actions: [action], states: [startState, nextState] });
  }
  return frontier;
}

/**
 * Bounded, cycle-safe, shortest-path-first BFS over a state space whose
 * successors are generated on demand via `applyActions(state)`, checked
 * against `isGoal` before each expansion up to `opts.maxDepth` hops.
 * Returns `{ actions, states }` (the full plan) or `null` on an honest miss.
 */
export function findActionPath(startState, isGoal, applyActions, { maxDepth = 50, stateKey = defaultStateKey } = {}) {
  if (isGoal(startState)) return { actions: [], states: [startState] };

  let frontier = seedFrontier(startState, applyActions);

  // Check-then-extend: never extend past maxDepth.
  const seen = new Set([stateKey(startState)]);
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    for (const entry of frontier) if (isGoal(entry.state)) return { actions: entry.actions, states: entry.states };
    if (depth === maxDepth) break; // budget exhausted — do not extend further
    const next = [];
    for (const entry of frontier) {
      const key = stateKey(entry.state);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const { action, nextState } of applyActions(entry.state) || []) {
        const nk = stateKey(nextState);
        if (seen.has(nk)) continue;
        next.push({ state: nextState, actions: [...entry.actions, action], states: [...entry.states, nextState] });
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Bounded, cycle-safe BFS enumeration of every state reachable from
 * `startState` within `maxDepth` hops (no `isGoal` — excludes `startState`
 * itself). Shares seedFrontier with findActionPath but keeps its own
 * expand-loop (collect-everything vs. early-return-on-first-hit). Returns
 * `[{ node, path: { actions, states } }]`, `[]` when nothing is reachable.
 */
export function findReachableSet(startState, applyActions, { maxDepth = 50, stateKey = defaultStateKey } = {}) {
  let frontier = seedFrontier(startState, applyActions);

  const seen = new Set([stateKey(startState)]);
  const results = [];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const entry of frontier) {
      const key = stateKey(entry.state);
      if (seen.has(key)) continue; // already recorded via an earlier (shorter-or-equal) path
      seen.add(key);
      results.push({ node: entry.state, path: { actions: entry.actions, states: entry.states } });
      if (depth === maxDepth) continue; // recorded, but budget exhausted — do not expand further
      for (const { action, nextState } of applyActions(entry.state) || []) {
        const nk = stateKey(nextState);
        if (seen.has(nk)) continue;
        next.push({ state: nextState, actions: [...entry.actions, action], states: [...entry.states, nextState] });
      }
    }
    frontier = next;
  }
  return results;
}

/**
 * Bounded, cycle-safe breadth-first walk that yields one array of newly-visited
 * successor items per depth level (depths 1..maxDepth), starting from `start`
 * which is pre-marked visited and never yielded. `successorsOf(id)` returns the
 * successor items of a node id; `keyOf(item)` is the identity used to dedup and
 * to seed the next frontier (default: the item itself is its own key).
 *
 * Each yielded level is in discovery order; a caller that needs a stable order
 * sorts it. Empty levels are yielded too (the walk stops once a frontier is
 * empty), so a caller collecting per-depth batches should skip empty ones.
 *
 * @template T
 * @param {*} start
 * @param {(id: *) => Iterable<T>} successorsOf
 * @param {{ maxDepth?: number, keyOf?: (item: T) => * }} [opts]
 * @returns {Generator<T[]>}
 */
export function* bfsLevels(start, successorsOf, { maxDepth = 8, keyOf = (x) => x } = {}) {
  const visited = new Set([start]);
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const level = [];
    const nextFrontier = [];
    for (const id of frontier) {
      for (const item of successorsOf(id) || []) {
        const key = keyOf(item);
        if (visited.has(key)) continue;
        visited.add(key);
        level.push(item);
        nextFrontier.push(key);
      }
    }
    frontier = nextFrontier;
    yield level;
  }
}
