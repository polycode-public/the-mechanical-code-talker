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

/** The one-hop expansion of `startState` into an initial frontier of
 *  `{ state, actions, states }` path-entries — IDENTICAL in both
 *  `findActionPath` and `findReachableSet` below (seeding a frontier from a
 *  start state has no goal/accumulation semantics to differ on: it is pure
 *  "call `applyActions` once, wrap each result"), so this one small step is
 *  genuinely, safely shared rather than duplicated verbatim in both
 *  functions. See the file-header note above `findActionPath` for why the
 *  REST of the two functions' bodies are deliberately NOT merged the same
 *  way. */
function seedFrontier(startState, applyActions) {
  const frontier = [];
  for (const { action, nextState } of applyActions(startState) || []) {
    frontier.push({ state: nextState, actions: [action], states: [startState, nextState] });
  }
  return frontier;
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

  let frontier = seedFrontier(startState, applyActions);

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

// ---------------------------------------------------------------------------
// findReachableSet — PLAN_TAUGHT_RELATIONS.md, Item 6 (recursive/reachability
// rules) kernel half. Query-side need: "list every X reachable from Y" (e.g.
// "list the descendants of ahab") is REACHABILITY-SET ENUMERATION, not
// single-goal search — checked against `findActionPath` above's own body:
// it returns the INSTANT the first goal-satisfying state is found (the
// `for (const entry of frontier) if (isGoal(entry.state)) return …` line),
// so there is no way to keep it running to collect every reachable node
// without changing both its halting condition (early-return vs. never-
// return-early) AND its return shape (one path vs. every path) — a
// genuinely new function, not a parameter tweak, per the plan's own
// analysis.
//
// Code-sharing decision (asked for explicitly, decided fresh here rather
// than copying the plan doc's framing verbatim): the file-header reasoning
// for why `findActionPath` is an independent SIBLING of `findIsaChain`
// (lines 1-32) is "pre-built static edge maps vs. on-demand successor
// generation don't share an implementation, only a discipline." That
// reasoning does NOT distinguish `findActionPath` from `findReachableSet`
// — both call the caller's `applyActions(state)` fresh at every expansion;
// neither pre-builds anything. So on the file's own stated logic, these two
// are legitimately closer to each other than either is to `findIsaChain`,
// and it's worth asking whether MORE sharing is warranted here specifically
// — not just repeating the same verdict by default.
//
// Having written both bodies out, the answer is: share the one step that is
// truly identical (`seedFrontier` above — a single `applyActions(startState)`
// call with no goal/accumulation semantics to differ on), but keep the main
// expand-loop bodies independent. The reason isn't "different edge
// generation" this time — it's that the two loops' HALTING and RESULT-
// COLLECTION semantics are irreducibly different: `findActionPath` returns
// the instant ANY frontier entry satisfies `isGoal`, discarding the rest of
// the frontier and every state it hasn't reached yet; `findReachableSet`
// never returns early, has no predicate at all, and must keep every
// newly-seen state (not just one) across the entire bounded search. Forcing
// both through one shared "expand a frontier" core would mean threading an
// optional `isGoal` (or a sentinel "never" predicate) AND an accumulator
// mode through a single function — that parameter surface would itself
// recreate the complexity the merge was meant to remove, for a savings of
// roughly the ~10-line inner loop. Given the file's own established
// precedent of favoring readable independent siblings over cleverly
// parameterized cores, and that the one truly shared step already isn't
// duplicated (`seedFrontier`), landing this as an independent sibling
// remains the right call — just not for the identical reason `findIsaChain`
// vs. `findActionPath` had.
/**
 * Bounded, cycle-safe breadth-first ENUMERATION of every state reachable
 * from `startState` within `maxDepth` hops — the reachability-set sibling of
 * `findActionPath`'s single-goal search.
 *
 *   - `startState`, `applyActions`, `opts.maxDepth`, `opts.stateKey` — same
 *     meaning and defaults as `findActionPath` (see above); successors are
 *     generated ON DEMAND by calling `applyActions(state)` fresh at every
 *     expansion, nothing precomputed or cached.
 *   - Deliberately NO `isGoal` parameter: every state reachable from
 *     `startState` (EXCLUDING `startState` itself — the start is where you
 *     already are, not a reachable result) within the hop budget is a
 *     result, not just one goal-satisfying state.
 *
 * Returns an array of `{ node, path: { actions, states } }` — one entry per
 * distinct reachable state, `path` mirroring `findActionPath`'s own
 * `{ actions, states }` return shape (the action sequence AND intermediate
 * states from `startState` to that node), so a caller gets "how did we get
 * here" for every reachable node, not just one. Returns `[]` (never
 * `null`/`undefined`) when nothing is reachable within budget — reachability
 * enumeration has no "miss" case the way single-goal search does; an empty
 * result set is itself the honest, complete answer.
 *
 * Cycle-safe via the same `seen` state-key convention as `findActionPath`: a
 * state is recorded (and expanded) only the FIRST time it is reached, so the
 * shortest path to it is what gets stored, and a state reachable by two
 * different routes (or sitting inside a genuine cycle) is reported exactly
 * once, never duplicated, and never causes an infinite loop.
 */
export function findReachableSet(startState, applyActions, { maxDepth = 50, stateKey = defaultStateKey } = {}) {
  let frontier = seedFrontier(startState, applyActions);

  const seen = new Set([stateKey(startState)]);
  const results = [];
  // Single combined loop (not findActionPath's check-then-separate-extend):
  // there is no per-iteration early return to protect here, so recording a
  // newly-seen state and deciding whether to expand it past it can live in
  // the same pass without losing any of findActionPath's check-then-extend
  // discipline — a state discovered exactly at maxDepth is still recorded
  // (it IS reachable within budget) but is never expanded past it.
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
