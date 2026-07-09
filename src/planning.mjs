// planning.mjs — a domain-agnostic bounded state-space search primitive
// (PLAN_HANOI.md's Phase 2 kernel, landed ahead of the phased plan as a
// standalone proof that the mechanism works, per the operator's own framing:
// "generalizing findIsaChain from 'walk pre-loaded class edges' to 'walk
// on-demand successor states' is a moderate, in-house-idiom-consistent
// extension, not a foreign paradigm").
//
// `src/syllogise.mjs`'s `findIsaChain` is, in shape, already a bounded rooted
// BFS path search: it walks a FIXED, pre-loaded edge list (`typeEdges`/
// `subClassEdges`) from a start node to a target set, frontier-expansion
// style, checking the frontier for a hit BEFORE extending it one hop further,
// stopping the instant a target is reached or the hop budget is exhausted.
//
// Real planning (Hanoi, or anything with actions) needs the same shape over a
// state space where successors are NOT pre-loaded — they are generated ON
// DEMAND by applying an action to the CURRENT state. `findActionPath` below
// is that generalization: same frontier/seen-set/check-then-extend/shortest-
// path discipline as `findIsaChain`, but the "edges" come from calling the
// caller-supplied `applyActions(state)` fresh at every expansion, instead of
// looking them up in a fixed array.
//
// Deliberately NOT sharing code with `findIsaChain` itself: that function's
// edge lists are pre-built ONCE into a `Map` before the search loop even
// starts (`subSucc`, `syllogise.mjs:291-296`) — a real, load-bearing
// optimization for its domain (static edges, looked up many times) that does
// not apply here (successors are computed fresh, never looked up twice for
// the same state). Extracting a "shared" BFS core would either lose that
// optimization or force `findActionPath` to fake a static edge list, so this
// lands as an independent sibling, following the same DISCIPLINE, not the
// same code path. `findIsaChain` itself is untouched by this file.
//
// Pure, no I/O, deterministic given a deterministic `applyActions`.

/** Default state-identity key: plain values compare by `String()`, plain
 *  objects by a stable-ish `JSON.stringify` (good enough for a toy/plain-
 *  object state; a caller with a richer state shape should pass its own
 *  `stateKey` that canonicalizes the fields that actually matter). */
function defaultStateKey(state) {
  if (state && typeof state === "object") return JSON.stringify(state);
  return String(state);
}

/**
 * Bounded, cycle-safe, shortest-path-first breadth-first search over a state
 * space whose successors are generated ON DEMAND, not pre-loaded.
 *
 *   - `startState` — any value; identity for cycle-detection is derived via
 *     `stateKey` (default: `String()`/`JSON.stringify()`).
 *   - `isGoal(state) -> boolean` — goal predicate, checked BEFORE a state is
 *     expanded (never after — see the hop-counting discipline below).
 *   - `applyActions(state) -> Array<{ action, nextState }>` — the caller's
 *     domain logic: given the CURRENT state, the legal (action, resulting-
 *     state) pairs reachable in exactly one step. Called fresh every time a
 *     state is expanded; nothing is precomputed or cached across calls.
 *   - `opts.maxDepth` (default 50) — hop budget, mirrors `findIsaChain`'s
 *     `maxHops`: the frontier is checked for the goal AT every depth up to
 *     and including `maxDepth`, but never extended past it (check-then-
 *     extend — `findIsaChain`'s own comment on this exact off-by-one:
 *     "the frontier is checked AT every length up to and including maxHops,
 *     never one hop beyond it").
 *   - `opts.stateKey(state) -> string` — override the default identity key
 *     when `startState`/successor states are richer than a plain
 *     string/number/JSON-able object.
 *
 * Returns `{ actions: [...], states: [startState, ...,goalState] }` on
 * success (the full action sequence AND the resulting state at each step, so
 * a caller can actually execute the plan, not just know one exists), or
 * `null` when no path reaches a goal state within `maxDepth` — an honest
 * miss, never a guessed/truncated path.
 *
 * Cycle-safe via a `seen` state-key set (this function's direct precedent:
 * `findIsaChain`'s own `seen` set, `syllogise.mjs:311`) — a state is only
 * ever expanded once, the first (shortest) path to reach it, so a domain
 * with cycles (two states that can reach each other) still terminates and
 * still returns the correct shortest path, never loops.
 */
export function findActionPath(startState, isGoal, applyActions, { maxDepth = 50, stateKey = defaultStateKey } = {}) {
  if (isGoal(startState)) return { actions: [], states: [startState] };

  let frontier = [];
  for (const { action, nextState } of applyActions(startState) || []) {
    frontier.push({ state: nextState, actions: [action], states: [startState, nextState] });
  }

  // depth counts the LENGTH of the paths currently in `frontier` (1 at the
  // first check) — exactly `findIsaChain`'s own "hop counts the LENGTH of the
  // paths currently in frontier" discipline. Check-then-extend, and never
  // extend past maxDepth: the frontier is checked at every depth up to and
  // including maxDepth, never one hop beyond it (the off-by-one findIsaChain
  // itself once had and fixed — not reintroduced here).
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
