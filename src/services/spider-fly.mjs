// spider-fly.mjs — the headless spider-and-fly turn engine: state fold,
// single-agent pathfinding, belief/visibility, greedy fly evasion, and the
// egg/hatch/spawn/starve ecology pass, all reading and writing plain fact
// rows through the shared memory store. No chat, no rendering — a later
// piece of work wraps runSpiderFlyTick's return shape for a chat turn.
//
// Grid geometry (cellId, parseCellId, visibleCells, isInWebBlock,
// perimeterCells, DIRECTION_DELTA) is never redefined here — it all comes
// from spider-fly-world.mjs, the one source of truth both the shipped world
// pack and this engine read from.

import {
  WORLD_NAME, WEB_HOME, WEB_DURATION_TURNS, SPIDER_INITIAL_MASS, SPIDER_MASS_DECREMENT_PER_TURN,
  cellId, parseCellId, chebyshevDistance, visibleCells, isInWebBlock, perimeterCells,
  DIRECTION_DELTA,
} from "../domain/spider-fly-world.mjs";
import { findActionPath, findReachableSet } from "../domain/planning.mjs";
import { appendFacts, loadMemory, readFactRows } from "../adapters/memory/core.mjs";
import { worldProvenanceTag } from "../domain/worlds-pack.mjs";
import { mulberry32 } from "../domain/seeded-random.mjs";
import { fnv1a32 } from "../domain/hash.mjs";

// ---- tunable constants (starting values, not fixed — the vision radius and
// mass economy all want checking against a real playable board) -------------

export const DEFAULT_VISION_RADIUS = 4;
export const FLY_INITIAL_MASS = 10;
export const FLY_MASS_DECREMENT_PER_TURN = 1;
export const EGG_HATCH_DELAY_TURNS = 3;
export const FLY_SPAWN_INTERVAL_TURNS = 3;
export const EGGS_EATEN_THRESHOLD = 2;
export { SPIDER_INITIAL_MASS, SPIDER_MASS_DECREMENT_PER_TURN, WEB_DURATION_TURNS };

// ---- seeded "randomness" (never Math.random) ---------------------------------
// Every "random" decision (fly wander, fly/spawn placement) is a mulberry32
// draw seeded by an fnv1a32 hash of a context string built from data already
// in the facts (world name, turn number, the subject's own id, a purpose
// tag) — the same hash-seeds-a-PRNG idiom answer-variants.mjs's phrase
// selection already uses. Two runs from the same starting facts produce the
// byte-identical sequence of "random" choices, never wall-clock driven.

/** Deterministically pick one of `options` (must be non-empty), keyed on
 *  `contextString`. */
function seededPick(options, contextString) {
  const rng = mulberry32(fnv1a32(contextString));
  return options[Math.floor(rng() * options.length)];
}

// ---- the state fold ----------------------------------------------------------

const SNAPSHOT_RE = /^(.+)@turn(\d+)$/;

function splitSnapshot(subject) {
  const m = SNAPSHOT_RE.exec(subject);
  return m ? { base: m[1], turn: Number(m[2]) } : { base: subject, turn: 0 };
}

const WEB_ID_RE = /^web-\d+$/;

/** Fold fact rows into the current spider-fly world state: per-subject
 *  newest placement (mgx:currently-in), newest fly mass, spider's newest
 *  flies-eaten count, each egg's laid-at-turn, each dynamic web's cell +
 *  built-at turn, and the terminal eaten-by/starved/hatched-into markers that
 *  make a subject no longer live. The turn counter is derived, never stored —
 *  the largest @turnN suffix seen, exactly foldWorldState's own convention.
 *  Pure. */
export function foldSpiderFlyState(factRows) {
  const placements = new Map();  // subject -> { cell, turn }
  const mass = new Map();        // fly/spider subject -> { value, turn }
  const fliesEaten = new Map();  // spider subject -> { value, turn }
  const laidAtTurn = new Map();  // egg subject -> { value, turn }
  const webCell = new Map();     // web subject -> { cell, turn }
  const webBuiltAt = new Map();  // web subject -> { value, turn }
  const eatenBy = new Map();     // fly subject -> { spider, turn }
  const starved = new Set();     // fly/spider subject
  const hatchedInto = new Map(); // egg subject -> { spider, turn }
  let turnCount = 0;

  for (const row of factRows || []) {
    const { base, turn } = splitSnapshot(row.subject);
    if (turn) turnCount = Math.max(turnCount, turn);

    if (row.predicate === "mgx:currently-in") {
      const prior = placements.get(base);
      if (!prior || turn >= prior.turn) placements.set(base, { cell: row.object, turn });
      if (WEB_ID_RE.test(base)) {
        const priorWeb = webCell.get(base);
        if (!priorWeb || turn >= priorWeb.turn) webCell.set(base, { cell: row.object, turn });
      }
      continue;
    }
    if (row.predicate === "mgx:mass") {
      const prior = mass.get(base);
      if (!prior || turn >= prior.turn) mass.set(base, { value: Number(row.object), turn });
      continue;
    }
    if (row.predicate === "mgx:flies-eaten") {
      const prior = fliesEaten.get(base);
      if (!prior || turn >= prior.turn) fliesEaten.set(base, { value: Number(row.object), turn });
      continue;
    }
    if (row.predicate === "mgx:laid-at-turn") {
      const prior = laidAtTurn.get(base);
      if (!prior || turn >= prior.turn) laidAtTurn.set(base, { value: Number(row.object), turn });
      continue;
    }
    if (row.predicate === "mgx:web-built-at-turn") {
      const prior = webBuiltAt.get(base);
      if (!prior || turn >= prior.turn) webBuiltAt.set(base, { value: Number(row.object), turn });
      continue;
    }
    if (row.predicate === "mgx:eaten-by") {
      const prior = eatenBy.get(base);
      if (!prior || turn >= prior.turn) eatenBy.set(base, { spider: row.object, turn });
      continue;
    }
    if (row.predicate === "mgx:starved") { starved.add(base); continue; }
    if (row.predicate === "mgx:hatched-into") {
      const prior = hatchedInto.get(base);
      if (!prior || turn >= prior.turn) hatchedInto.set(base, { spider: row.object, turn });
      continue;
    }
  }

  const webs = new Map(); // web subject -> { cell, builtAtTurn }
  for (const [id, { cell }] of webCell) {
    const builtAtTurn = webBuiltAt.get(id)?.value;
    if (builtAtTurn !== undefined) webs.set(id, { cell, builtAtTurn });
  }

  const removed = new Set([...eatenBy.keys(), ...starved, ...hatchedInto.keys()]);
  return { placements, mass, fliesEaten, laidAtTurn, webs, eatenBy, starved, hatchedInto, removed, turnCount };
}

const sortedLiveSubjects = (state, re) =>
  [...state.placements.keys()].filter((id) => re.test(id) && !state.removed.has(id)).sort();

function maxIdSuffix(ids, re) {
  let max = 0;
  for (const id of ids) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// ---- single-agent pathfinding (§5): hand-written applyActions over the
// world pack's own has-exit-<direction> facts, NOT the taught action-rule
// DSL, whose no-incoming/comparator precondition shapes cannot express grid
// adjacency (the same limitation Ashcombe's own runWorldCommand worked
// around). State is the plain {x, y} coordinate the search kernel treats as
// opaque. ---------------------------------------------------------------------

const EXIT_PREDICATE_RE = /^mgx:has-exit-([a-z]+)$/;

/** The spider/fly movement applyActions closure findActionPath/
 *  findReachableSet need: one hop per has-exit-<direction> fact reachable
 *  from a cell, in the fixed direction order both agents' search shares for
 *  deterministic tie-breaking. Built once per tick from the world's own
 *  static exit facts (grid topology is common knowledge to both agents). */
export function gridApplyActions(factRows) {
  const exits = new Map();
  for (const row of factRows || []) {
    const m = EXIT_PREDICATE_RE.exec(row.predicate);
    if (!m) continue;
    if (!exits.has(row.subject)) exits.set(row.subject, new Map());
    exits.get(row.subject).set(m[1], row.object);
  }
  return (state) => {
    const out = [];
    const dirs = exits.get(cellId(state.x, state.y));
    if (!dirs) return out;
    for (const direction of Object.keys(DIRECTION_DELTA)) {
      const target = dirs.get(direction);
      if (!target) continue;
      const parsed = parseCellId(target);
      if (!parsed) continue;
      out.push({ action: direction, nextState: { x: parsed.x, y: parsed.y } });
    }
    return out;
  };
}

/** Canonicalizes a grid-position search state onto its cell alone — the
 *  only field that matters for movement dedup (mass/eaten-count ride
 *  elsewhere on the folded state, never on the path-search state itself). */
export const spiderPathStateKey = (state) => cellId(state.x, state.y);

/** Whether (x, y) is currently webbed — the static home zone (always active)
 *  OR a live spider-built web (mgx:web-built-at-turn + WEB_DURATION_TURNS >
 *  turn). The one predicate every eat precondition and the fly's movement
 *  gate consult, so the static zone and dynamic webs are ONE concept. `state`
 *  may be omitted (or carry no `webs` map) — the static-zone check alone
 *  still answers correctly, just blind to dynamic webs; every real caller
 *  threads the folded state through. */
export function hasActiveWebAt(x, y, state, turn) {
  if (isInWebBlock(x, y)) return true;
  if (!state?.webs?.size) return false;
  const target = cellId(x, y);
  for (const { cell, builtAtTurn } of state.webs.values()) {
    if (cell === target && builtAtTurn + WEB_DURATION_TURNS > turn) return true;
  }
  return false;
}

/** The spider's multi-step path: findActionPath wired with isGoal =
 *  "co-located with the believed fly cell, and that cell has an active web
 *  (static or dynamic)." When the fly's believed cell sits outside every
 *  active web, isGoal can never fire (it doesn't depend on the search state,
 *  only on the fixed target), so this returns null — an honest "no path to
 *  an eat" rather than a path toward a cell that would never satisfy the eat
 *  condition. Null also covers "no believed target at all." `state`/`turn`
 *  are optional, defaulting to "static web zone only" (see hasActiveWebAt). */
export function planSpiderPath(spiderCell, believedFlyCell, applyActions, state, turn) {
  if (!believedFlyCell) return null;
  const isGoal = (s) =>
    s.x === believedFlyCell.x && s.y === believedFlyCell.y && hasActiveWebAt(s.x, s.y, state, turn);
  return findActionPath(spiderCell, isGoal, applyActions, { stateKey: spiderPathStateKey });
}

// ---- one-ply greedy scoring, shared by the fly's evasion and the spider's
// fallback chase (§5 confirmed decision: greedy distance-scoring over
// findReachableSet's one-ply output, plus staying put — no lookahead, no
// simulation of the other agent's plan). -------------------------------------

function bestOneStepBy(fromCell, applyActions, scoreOf, isBetter) {
  const options = [fromCell, ...findReachableSet(fromCell, applyActions, { maxDepth: 1 }).map((r) => r.node)];
  let best = options[0];
  let bestScore = scoreOf(best);
  for (let i = 1; i < options.length; i += 1) {
    const score = scoreOf(options[i]);
    if (isBetter(score, bestScore)) { bestScore = score; best = options[i]; }
  }
  return best;
}

/** A fly with no believed spider position wanders instead of holding still:
 *  a seeded, uniform pick among staying put or any one-ply reachable cell,
 *  keyed on this turn + the fly's own id (purpose "wander") — deterministic
 *  and replayable, never Math.random. Looks random to a human watching. The
 *  caller is responsible for skipping this entirely when the fly sits in an
 *  active web this tick (a webbed fly can't move at all, wander or not). */
export function randomFlyWander(flyCell, applyActions, turn, flyId) {
  const options = [flyCell, ...findReachableSet(flyCell, applyActions, { maxDepth: 1 }).map((r) => r.node)];
  return seededPick(options, `${WORLD_NAME}:${turn}:${flyId}:wander`);
}

/** The fly's one move this turn: score every one-ply reachable cell (plus
 *  staying put) by Chebyshev distance from the fly's believed spider
 *  position, move to the highest-scoring cell. A fly with no believed
 *  spider position wanders instead (randomFlyWander) — `turn`/`flyId` key
 *  that seeded draw. */
export function greedyFlyMove(flyCell, believedSpiderCell, applyActions, turn, flyId) {
  if (!believedSpiderCell) return randomFlyWander(flyCell, applyActions, turn, flyId);
  return bestOneStepBy(
    flyCell, applyActions,
    (cell) => chebyshevDistance(cell.x, cell.y, believedSpiderCell.x, believedSpiderCell.y),
    (score, bestScore) => score > bestScore,
  );
}

/** The spider's fallback move when no in-web path exists yet (the fly's
 *  believed cell is outside the web, or currently unreachable): the same
 *  one-ply kernel as the fly's evasion, scored the opposite way — close
 *  distance instead of open it. */
export function greedySpiderApproach(spiderCell, believedFlyCell, applyActions) {
  if (!believedFlyCell) return spiderCell;
  return bestOneStepBy(
    spiderCell, applyActions,
    (cell) => chebyshevDistance(cell.x, cell.y, believedFlyCell.x, believedFlyCell.y),
    (score, bestScore) => score < bestScore,
  );
}

/** A spider's move when another live spider is believed visible: the mirror
 *  image of greedyFlyMove's evasion — score every one-ply reachable cell
 *  (plus staying put) by Chebyshev distance from the other spider's believed
 *  position, move to the highest-scoring (furthest) cell. Priority branch 1
 *  of §5's avoid-spiders > chase-flies > hold-and-web ordering. */
export function greedySpiderAvoid(spiderCell, believedOtherSpiderCell, applyActions) {
  if (!believedOtherSpiderCell) return spiderCell;
  return bestOneStepBy(
    spiderCell, applyActions,
    (cell) => chebyshevDistance(cell.x, cell.y, believedOtherSpiderCell.x, believedOtherSpiderCell.y),
    (score, bestScore) => score > bestScore,
  );
}

// ---- visibility and belief (§4): static grid topology is common knowledge
// to both agents; only dynamic entity positions are gated by vision. A told
// fact (a later chat-integration piece of work, not built here) is the one
// extension point this function leaves open via its optional toldFacts
// parameter — shaped { subject, toAgent, cell, turn }, defaulting to empty
// so today's belief is exactly "what's currently visible." -------------------

/** Whether `observerSubject` currently believes `targetSubject` to be at a
 *  particular cell: ground truth when the target's real cell is within the
 *  observer's own visibleCells radius, else the newest told fact addressed
 *  to this observer about this target, else null (unknown). A removed
 *  target (eaten/starved/hatched) is never believed present. */
export function believedCellOf(targetSubject, observerSubject, observerCell, state, opts = {}) {
  const { visionRadius = DEFAULT_VISION_RADIUS, toldFacts = [] } = opts;
  const place = state.placements.get(targetSubject);
  if (place && !state.removed.has(targetSubject)) {
    const seen = visibleCells(observerCell.x, observerCell.y, visionRadius);
    if (seen.includes(place.cell)) return parseCellId(place.cell);
  }
  const told = toldFacts
    .filter((f) => f.toAgent === observerSubject && f.subject === targetSubject)
    .sort((a, b) => (b.turn ?? 0) - (a.turn ?? 0))[0];
  return told ? parseCellId(told.cell) : null;
}

/** The nearest candidate (by believed Chebyshev distance) an observer has
 *  any belief about at all — null when the observer believes nothing about
 *  any candidate. `candidates` must already be in a deterministic order
 *  (ties favor the earlier candidate). */
export function nearestBelievedTarget(observerSubject, observerCell, candidates, state, opts = {}) {
  let best = null;
  let bestDist = Infinity;
  for (const subject of candidates) {
    const cell = believedCellOf(subject, observerSubject, observerCell, state, opts);
    if (!cell) continue;
    const dist = chebyshevDistance(observerCell.x, observerCell.y, cell.x, cell.y);
    if (dist < bestDist) { bestDist = dist; best = { subject, cell }; }
  }
  return best;
}

// ---- the ecology pass (§10): eat, lay, hatch, spawn, starve, all as
// ordinary turn-gated checks in one fixed-order pass. Order matters and is
// fixed deliberately: eat first (predation resolves on the turn's fresh
// positions), then starve (a fly already claimed by an eat this turn cannot
// also starve), then lay (reads the egg slot as it stood BEFORE this tick's
// own hatch, so a hatch and a fresh lay never land the same turn), then
// hatch, then spawn (reads the board as every earlier step in this same
// pass left it, so a fly never spawns on a cell an eat/hatch just vacated
// or occupied). ---------------------------------------------------------------

function mostRecentEggLaidTurn(state) {
  let max = -1;
  for (const { value } of state.laidAtTurn.values()) max = Math.max(max, value);
  return max;
}

function mostRecentEaterSpider(state, eatenDeltaBySpider) {
  if (eatenDeltaBySpider.size) return [...eatenDeltaBySpider.keys()].sort()[0];
  let best = null;
  let bestTurn = -1;
  for (const { spider, turn } of state.eatenBy.values()) {
    if (turn > bestTurn) { bestTurn = turn; best = spider; }
  }
  return best;
}

/**
 * One ecology pass over the tick's post-movement state: `postMovePlacements`
 * is a Map(subject -> {x,y}) for every currently-live spider and fly after
 * this turn's movement writes; `postMoveMassByFly`/`postMoveMassBySpider` are
 * Map(subject -> number), the mass after this turn's decrement, pre-removal
 * (`postMoveMassBySpider` is optional — a spider absent from it is simply
 * never starve-checked, so callers that don't track spider mass, e.g. older
 * tests, see no behavior change). `state` is the PRE-move fold (for history:
 * prior flies-eaten counts, prior eggs, prior eaten turns, live webs).
 * Returns `{ writes, events }` — writes to append alongside the turn's
 * movement facts, events for the tick's own return payload. Pure.
 */
export function runEcologyPass({ state, postMovePlacements, postMoveMassByFly, postMoveMassBySpider = new Map(), turn }) {
  const k = turn;
  const writes = [];
  const events = { eaten: [], starved: [], laid: null, hatched: [], spawned: null };

  const spiders = [...postMovePlacements.keys()].filter((id) => /^spider-\d+$/.test(id)).sort();
  const flies = [...postMovePlacements.keys()].filter((id) => /^fly-\d+$/.test(id)).sort();

  // 1. Eat — a spider and a fly sharing an actively-webbed cell (static home
  // zone or a live dynamic web). The eating spider gains exactly the fly's
  // post-decrement remaining mass, not a flat bonus.
  const claimedFlies = new Set();
  const eatenDeltaBySpider = new Map();
  const eatenMassBySpider = new Map();
  for (const spiderId of spiders) {
    const sCell = postMovePlacements.get(spiderId);
    if (!hasActiveWebAt(sCell.x, sCell.y, state, k)) continue;
    for (const flyId of flies) {
      if (claimedFlies.has(flyId)) continue;
      const fCell = postMovePlacements.get(flyId);
      if (sCell.x !== fCell.x || sCell.y !== fCell.y) continue;
      claimedFlies.add(flyId);
      eatenDeltaBySpider.set(spiderId, (eatenDeltaBySpider.get(spiderId) ?? 0) + 1);
      eatenMassBySpider.set(spiderId, (eatenMassBySpider.get(spiderId) ?? 0) + (postMoveMassByFly.get(flyId) ?? 0));
      writes.push({ subject: `${flyId}@turn${k}`, predicate: "mgx:eaten-by", object: spiderId });
      events.eaten.push({ fly: flyId, spider: spiderId, cell: cellId(sCell.x, sCell.y) });
    }
  }
  for (const [spiderId, delta] of eatenDeltaBySpider) {
    const newCount = (state.fliesEaten.get(spiderId)?.value ?? 0) + delta;
    writes.push({ subject: `${spiderId}@turn${k}`, predicate: "mgx:flies-eaten", object: String(newCount) });
    const priorSpiderMass = postMoveMassBySpider.get(spiderId) ?? (state.mass.get(spiderId)?.value ?? SPIDER_INITIAL_MASS);
    const newSpiderMass = priorSpiderMass + (eatenMassBySpider.get(spiderId) ?? 0);
    writes.push({ subject: `${spiderId}@turn${k}`, predicate: "mgx:mass", object: String(newSpiderMass) });
  }

  // 2. Starve — mass reached zero, and not already claimed by this turn's
  // eat. Spiders waste away the same as flies; a spider that just ate
  // survives regardless (eat resolves first).
  for (const flyId of flies) {
    if (claimedFlies.has(flyId)) continue;
    if ((postMoveMassByFly.get(flyId) ?? 0) <= 0) {
      writes.push({ subject: `${flyId}@turn${k}`, predicate: "mgx:starved", object: "true" });
      events.starved.push(flyId);
    }
  }
  const deadFliesThisTick = new Set([...claimedFlies, ...events.starved]);
  for (const spiderId of spiders) {
    if (eatenDeltaBySpider.has(spiderId)) continue;
    if (!postMoveMassBySpider.has(spiderId)) continue;
    if (postMoveMassBySpider.get(spiderId) <= 0) {
      writes.push({ subject: `${spiderId}@turn${k}`, predicate: "mgx:starved", object: "true" });
      events.starved.push(spiderId);
    }
  }

  // 3. Lay — the eat condition has fired enough times since the last egg (or
  // once, at game start), with no live egg outstanding right now.
  const liveEggId = [...state.laidAtTurn.keys()].find((id) => !state.removed.has(id));
  if (!liveEggId) {
    const sinceTurn = mostRecentEggLaidTurn(state);
    const threshold = sinceTurn === -1 ? 1 : EGGS_EATEN_THRESHOLD;
    let eatsSince = events.eaten.length;
    for (const { turn: eatenTurn } of state.eatenBy.values()) if (eatenTurn > sinceTurn) eatsSince += 1;
    if (eatsSince >= threshold) {
      const eggSpider = mostRecentEaterSpider(state, eatenDeltaBySpider);
      const eggCell = eggSpider ? (postMovePlacements.get(eggSpider) ?? parseCellId(state.placements.get(eggSpider)?.cell)) : null;
      if (eggCell) {
        const eggId = `egg-${1 + maxIdSuffix(state.placements.keys(), /^egg-(\d+)$/)}`;
        writes.push({ subject: `${eggId}@turn${k}`, predicate: "mgx:currently-in", object: cellId(eggCell.x, eggCell.y) });
        writes.push({ subject: `${eggId}@turn${k}`, predicate: "mgx:laid-at-turn", object: String(k) });
        events.laid = eggId;
      }
    }
  }

  // 4. Hatch — any live egg laid exactly EGG_HATCH_DELAY_TURNS turns ago.
  const liveEggIds = [...state.laidAtTurn.keys()].filter((id) => !state.removed.has(id)).sort();
  let nextSpiderNum = 1 + maxIdSuffix(state.placements.keys(), /^spider-(\d+)$/);
  for (const eggId of liveEggIds) {
    const laidTurn = state.laidAtTurn.get(eggId).value;
    if (laidTurn + EGG_HATCH_DELAY_TURNS !== k) continue;
    const eggCell = state.placements.get(eggId)?.cell;
    if (!eggCell) continue;
    const newSpiderId = `spider-${nextSpiderNum}`;
    nextSpiderNum += 1;
    writes.push({ subject: `${newSpiderId}@turn${k}`, predicate: "mgx:currently-in", object: eggCell });
    writes.push({ subject: `${newSpiderId}@turn${k}`, predicate: "mgx:mass", object: String(SPIDER_INITIAL_MASS) });
    writes.push({ subject: `${eggId}@turn${k}`, predicate: "mgx:hatched-into", object: newSpiderId });
    events.hatched.push({ egg: eggId, spider: newSpiderId, cell: eggCell });
  }

  // 5. Spawn — every third turn, a new fly at a seeded pick among the
  // currently-uncontested perimeter cells (never Math.random — see
  // seededPick's own header comment).
  if (k % FLY_SPAWN_INTERVAL_TURNS === 0) {
    const occupied = new Set();
    for (const spiderId of spiders) { const c = postMovePlacements.get(spiderId); occupied.add(cellId(c.x, c.y)); }
    for (const flyId of flies) {
      if (deadFliesThisTick.has(flyId)) continue;
      const c = postMovePlacements.get(flyId);
      occupied.add(cellId(c.x, c.y));
    }
    for (const eggId of liveEggIds) {
      if (events.hatched.some((h) => h.egg === eggId)) continue;
      occupied.add(state.placements.get(eggId)?.cell);
    }
    for (const h of events.hatched) occupied.add(h.cell);
    const uncontested = perimeterCells().filter((c) => !occupied.has(c));
    if (uncontested.length) {
      const newFlyId = `fly-${1 + maxIdSuffix(state.placements.keys(), /^fly-(\d+)$/)}`;
      const cell = seededPick(uncontested, `${WORLD_NAME}:${k}:${newFlyId}:spawn`);
      writes.push({ subject: `${newFlyId}@turn${k}`, predicate: "mgx:currently-in", object: cell });
      writes.push({ subject: `${newFlyId}@turn${k}`, predicate: "mgx:mass", object: String(FLY_INITIAL_MASS) });
      events.spawned = newFlyId;
    }
  }

  return { writes, events };
}

// ---- bootstrap and the per-tick orchestration --------------------------------

/** Mints spider-1 at the web's home cell and a spread of flies onto the
 *  board perimeter — a fresh session's own starting state, never part of
 *  the shipped (reusable, static) world pack itself. A no-op when spider-1
 *  already exists (idempotent — safe to call from a caller unsure whether
 *  the game has already started). */
export async function startSpiderFlyGame(memoryDir, { flyCount = 1 } = {}) {
  const state = foldSpiderFlyState(readFactRows(await loadMemory(memoryDir)));
  if (state.placements.has("spider-1")) return { started: false, facts: [] };

  const perimeter = perimeterCells();
  const facts = [
    { subject: "spider-1", predicate: "mgx:currently-in", object: cellId(WEB_HOME.x, WEB_HOME.y) },
    { subject: "spider-1", predicate: "mgx:mass", object: String(SPIDER_INITIAL_MASS) },
  ];
  const occupied = new Set([cellId(WEB_HOME.x, WEB_HOME.y)]);
  for (let i = 0; i < flyCount; i += 1) {
    const flyId = `fly-${i + 1}`;
    const uncontested = perimeter.filter((c) => !occupied.has(c));
    const cell = seededPick(uncontested.length ? uncontested : perimeter, `${WORLD_NAME}:0:${flyId}:spawn`);
    occupied.add(cell);
    facts.push({ subject: flyId, predicate: "mgx:currently-in", object: cell });
    facts.push({ subject: flyId, predicate: "mgx:mass", object: String(FLY_INITIAL_MASS) });
  }
  await appendFacts(memoryDir, facts.map((f) => ({ ...f, provenance: worldProvenanceTag(WORLD_NAME) })));
  return { started: true, facts };
}

function goalLineFor(subject, believed, arrived, kind) {
  if (kind === "spider-avoid") return `avoiding ${believed.subject}, last seen at ${cellId(believed.cell.x, believed.cell.y)}.`;
  if (!believed) return kind === "spider" ? "no fly in sight — holding position in the web." : "no spider in sight — wandering.";
  const seenAt = cellId(believed.cell.x, believed.cell.y);
  if (kind === "spider") {
    return arrived
      ? `co-located with ${believed.subject} in the web.`
      : `chasing ${believed.subject}, last seen at ${seenAt}.`;
  }
  return `evading — last saw ${believed.subject} at ${seenAt}.`;
}

/** Live (unexpired, by `turn`) dynamic webs from a `Map(webId -> {cell,
 *  builtAtTurn})` (either a folded state's own `.webs`, or that widened with
 *  web(s) minted THIS tick before they've been written/read back), as a
 *  plain array of { id, cell, builtAtTurn, expiresAtTurn }. Excludes the
 *  always-on static home zone (that's WEB_HOME/WEB_RADIUS, drawn separately —
 *  this is only the spider-built kind), for a renderer to draw distinctly. */
export function liveWebs(websMap, turn) {
  const out = [];
  for (const [id, { cell, builtAtTurn }] of websMap) {
    if (builtAtTurn + WEB_DURATION_TURNS > turn) out.push({ id, cell, builtAtTurn, expiresAtTurn: builtAtTurn + WEB_DURATION_TURNS });
  }
  return out;
}

/**
 * One full tick: fold state, compute each live spider's and fly's belief,
 * replan/re-score, execute one movement step per agent (spiders: avoid other
 * spiders > chase flies > hold-and-web; flies: evade > wander, unless
 * trapped in an active web), run the ecology pass, and append everything as
 * this turn's @turnN facts in one write. `opts.toldFacts` is the belief
 * layer's chat-integration extension point (§4) — an array of `{ subject,
 * toAgent, cell, turn }` rows, empty until a later piece of work wires
 * chat-told positions through it.
 *
 * Returns `{ turn, writes, agents, ecology, activeWebs }`: `agents` is keyed
 * by every live spider/fly subject after this tick, each `{ cell, goal,
 * plan, mass }` (the spider's `plan` is its found path's remaining
 * directions, or null when it has none this tick); `ecology` is the tick's
 * eaten/starved/laid/hatched/spawned event summary; `activeWebs` is every
 * currently-live dynamic web (static home zone excluded — that's fixed grid
 * geometry, not runtime state), for a renderer to draw distinctly.
 */
export async function runSpiderFlyTick(memoryDir, opts = {}) {
  const { visionRadius = DEFAULT_VISION_RADIUS, toldFacts = [] } = opts;
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldSpiderFlyState(rows);
  const k = state.turnCount + 1;
  const applyActions = gridApplyActions(rows);

  const spiders = sortedLiveSubjects(state, /^spider-\d+$/);
  const flies = sortedLiveSubjects(state, /^fly-\d+$/);

  const movementWrites = [];
  const postMovePlacements = new Map();
  const postMoveMassByFly = new Map();
  const postMoveMassBySpider = new Map();
  const agents = {};
  const tickWebs = new Map(state.webs); // widened in place as spiders build/refresh this tick
  let nextWebNum = 1 + maxIdSuffix(state.webs.keys(), /^web-(\d+)$/);

  for (const spiderId of spiders) {
    const spiderCell = parseCellId(state.placements.get(spiderId).cell);
    const priorMass = state.mass.get(spiderId)?.value ?? SPIDER_INITIAL_MASS;
    const newMass = Math.max(0, priorMass - SPIDER_MASS_DECREMENT_PER_TURN);
    postMoveMassBySpider.set(spiderId, newMass);

    // Priority 1: avoid any OTHER live spider believed visible.
    const otherSpiders = spiders.filter((id) => id !== spiderId);
    const avoidTarget = nearestBelievedTarget(spiderId, spiderCell, otherSpiders, state, { visionRadius, toldFacts });
    let nextCell;
    let plan = null;
    let goal;
    if (avoidTarget) {
      nextCell = greedySpiderAvoid(spiderCell, avoidTarget.cell, applyActions);
      goal = goalLineFor(spiderId, avoidTarget, false, "spider-avoid");
    } else {
      // Priority 2: chase a believed-visible fly, exactly as before.
      const target = nearestBelievedTarget(spiderId, spiderCell, flies, state, { visionRadius, toldFacts });
      if (target) {
        nextCell = spiderCell;
        const path = planSpiderPath(spiderCell, target.cell, applyActions, state, k);
        if (path) {
          if (path.actions.length) { nextCell = path.states[1]; plan = path.actions; }
        } else {
          nextCell = greedySpiderApproach(spiderCell, target.cell, applyActions);
        }
        // "Arrived" is the real eat precondition (co-located with the
        // believed target, inside an active web) — NOT merely "didn't move
        // this turn", which a greedy-approach spider also does whenever it's
        // already at its closest reachable cell but still a step away
        // (Chebyshev-adjacent isn't co-located; has-exit-* edges have no
        // diagonal hop).
        const arrived = nextCell.x === target.cell.x && nextCell.y === target.cell.y && hasActiveWebAt(nextCell.x, nextCell.y, state, k);
        goal = goalLineFor(spiderId, target, arrived, "spider");
      } else {
        // Priority 3: hold position, and build/refresh a web there unless an
        // unexpired web already covers this exact cell.
        nextCell = spiderCell;
        const heldCellId = cellId(spiderCell.x, spiderCell.y);
        if (!hasActiveWebAt(spiderCell.x, spiderCell.y, state, k)) {
          const webId = `web-${nextWebNum}`;
          nextWebNum += 1;
          tickWebs.set(webId, { cell: heldCellId, builtAtTurn: k });
          movementWrites.push({ subject: `${webId}@turn${k}`, predicate: "mgx:currently-in", object: heldCellId });
          movementWrites.push({ subject: `${webId}@turn${k}`, predicate: "mgx:web-built-at-turn", object: String(k) });
          goal = "no fly in sight — building a web here.";
        } else {
          goal = goalLineFor(spiderId, null, false, "spider");
        }
      }
    }

    postMovePlacements.set(spiderId, nextCell);
    movementWrites.push({ subject: `${spiderId}@turn${k}`, predicate: "mgx:currently-in", object: cellId(nextCell.x, nextCell.y) });
    movementWrites.push({ subject: `${spiderId}@turn${k}`, predicate: "mgx:mass", object: String(newMass) });
    agents[spiderId] = { cell: cellId(nextCell.x, nextCell.y), goal, plan, mass: newMass };
  }

  for (const flyId of flies) {
    const flyCell = parseCellId(state.placements.get(flyId).cell);
    const believedSpider = nearestBelievedTarget(flyId, flyCell, spiders, state, { visionRadius, toldFacts });
    const webbed = hasActiveWebAt(flyCell.x, flyCell.y, state, k);
    const nextCell = webbed ? flyCell : greedyFlyMove(flyCell, believedSpider?.cell ?? null, applyActions, k, flyId);
    postMovePlacements.set(flyId, nextCell);
    movementWrites.push({ subject: `${flyId}@turn${k}`, predicate: "mgx:currently-in", object: cellId(nextCell.x, nextCell.y) });
    const priorMass = state.mass.get(flyId)?.value ?? FLY_INITIAL_MASS;
    const newMass = Math.max(0, priorMass - FLY_MASS_DECREMENT_PER_TURN);
    postMoveMassByFly.set(flyId, newMass);
    movementWrites.push({ subject: `${flyId}@turn${k}`, predicate: "mgx:mass", object: String(newMass) });
    const goal = webbed ? "trapped in an active web — can't move." : goalLineFor(flyId, believedSpider, true, "fly");
    agents[flyId] = { cell: cellId(nextCell.x, nextCell.y), goal, mass: newMass };
  }

  const ecology = runEcologyPass({ state, postMovePlacements, postMoveMassByFly, postMoveMassBySpider, turn: k });
  // A fly eaten or starved THIS tick was already assigned a pre-ecology
  // goal/position above (movement runs before the ecology pass resolves
  // eating) — left as-is, the same response would both announce "fly-5 was
  // eaten" and still list fly-5's stale "trapped, can't move" goal one clause
  // later, as if it were still on the board. Drop it from `agents` (its own
  // goal is moot) and let the eating spider's line say what actually
  // happened instead of the now-false "co-located with fly-5 in the web".
  for (const { fly, spider } of ecology.events.eaten) {
    delete agents[fly];
    if (agents[spider]) agents[spider].goal = `just ate ${fly} in the web.`;
  }
  for (const flyId of ecology.events.starved) delete agents[flyId];
  const writes = [...movementWrites, ...ecology.writes];
  const provenance = `${worldProvenanceTag(WORLD_NAME)}:turn${k}`;
  await appendFacts(memoryDir, writes.map((f) => ({ ...f, provenance })));

  return { turn: k, writes, agents, ecology: ecology.events, activeWebs: liveWebs(tickWebs, k) };
}
