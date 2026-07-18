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
  WORLD_NAME, WEB_HOME,
  cellId, parseCellId, chebyshevDistance, visibleCells, isInWebBlock, perimeterCells,
  DIRECTION_DELTA,
} from "../domain/spider-fly-world.mjs";
import { findActionPath, findReachableSet } from "../domain/planning.mjs";
import { appendFacts, loadMemory, readFactRows } from "../adapters/memory/core.mjs";
import { worldProvenanceTag } from "../domain/worlds-pack.mjs";

// ---- tunable constants (starting values, not fixed — the vision radius and
// mass economy all want checking against a real playable board) -------------

export const DEFAULT_VISION_RADIUS = 4;
export const FLY_INITIAL_MASS = 10;
export const FLY_MASS_DECREMENT_PER_TURN = 1;
export const EGG_HATCH_DELAY_TURNS = 3;
export const FLY_SPAWN_INTERVAL_TURNS = 3;
export const EGGS_EATEN_THRESHOLD = 2;

// ---- the state fold ----------------------------------------------------------

const SNAPSHOT_RE = /^(.+)@turn(\d+)$/;

function splitSnapshot(subject) {
  const m = SNAPSHOT_RE.exec(subject);
  return m ? { base: m[1], turn: Number(m[2]) } : { base: subject, turn: 0 };
}

/** Fold fact rows into the current spider-fly world state: per-subject
 *  newest placement (mgx:currently-in), newest fly mass, spider's newest
 *  flies-eaten count, each egg's laid-at-turn, and the terminal eaten-by/
 *  starved/hatched-into markers that make a subject no longer live. The turn
 *  counter is derived, never stored — the largest @turnN suffix seen,
 *  exactly foldWorldState's own convention. Pure. */
export function foldSpiderFlyState(factRows) {
  const placements = new Map();  // subject -> { cell, turn }
  const mass = new Map();        // fly subject -> { value, turn }
  const fliesEaten = new Map();  // spider subject -> { value, turn }
  const laidAtTurn = new Map();  // egg subject -> { value, turn }
  const eatenBy = new Map();     // fly subject -> { spider, turn }
  const starved = new Set();     // fly subject
  const hatchedInto = new Map(); // egg subject -> { spider, turn }
  let turnCount = 0;

  for (const row of factRows || []) {
    const { base, turn } = splitSnapshot(row.subject);
    if (turn) turnCount = Math.max(turnCount, turn);

    if (row.predicate === "mgx:currently-in") {
      const prior = placements.get(base);
      if (!prior || turn >= prior.turn) placements.set(base, { cell: row.object, turn });
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

  const removed = new Set([...eatenBy.keys(), ...starved, ...hatchedInto.keys()]);
  return { placements, mass, fliesEaten, laidAtTurn, eatenBy, starved, hatchedInto, removed, turnCount };
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

/** The spider's multi-step path: findActionPath wired with isGoal =
 *  "co-located with the believed fly cell, and that cell is inside the web
 *  block." When the fly's believed cell sits outside the web, isGoal can
 *  never fire (it doesn't depend on the search state, only on the fixed
 *  target), so this returns null — an honest "no path to an eat" rather
 *  than a path toward a cell that would never satisfy the eat condition.
 *  Null also covers "no believed target at all." */
export function planSpiderPath(spiderCell, believedFlyCell, applyActions) {
  if (!believedFlyCell) return null;
  const isGoal = (state) =>
    state.x === believedFlyCell.x && state.y === believedFlyCell.y && isInWebBlock(state.x, state.y);
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

/** The fly's one move this turn: score every one-ply reachable cell (plus
 *  staying put) by Chebyshev distance from the fly's believed spider
 *  position, move to the highest-scoring cell. A fly with no believed
 *  spider position holds still. */
export function greedyFlyMove(flyCell, believedSpiderCell, applyActions) {
  if (!believedSpiderCell) return flyCell;
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
 * this turn's movement writes; `postMoveMassByFly` is a Map(flySubject ->
 * number), the fly's mass after this turn's decrement, pre-removal. `state`
 * is the PRE-move fold (for history: prior flies-eaten counts, prior eggs,
 * prior eaten turns). Returns `{ writes, events }` — writes to append
 * alongside the turn's movement facts, events for the tick's own return
 * payload. Pure.
 */
export function runEcologyPass({ state, postMovePlacements, postMoveMassByFly, turn }) {
  const k = turn;
  const writes = [];
  const events = { eaten: [], starved: [], laid: null, hatched: [], spawned: null };

  const spiders = [...postMovePlacements.keys()].filter((id) => /^spider-\d+$/.test(id)).sort();
  const flies = [...postMovePlacements.keys()].filter((id) => /^fly-\d+$/.test(id)).sort();

  // 1. Eat — a spider and a fly sharing an in-web cell.
  const claimedFlies = new Set();
  const eatenDeltaBySpider = new Map();
  for (const spiderId of spiders) {
    const sCell = postMovePlacements.get(spiderId);
    if (!isInWebBlock(sCell.x, sCell.y)) continue;
    for (const flyId of flies) {
      if (claimedFlies.has(flyId)) continue;
      const fCell = postMovePlacements.get(flyId);
      if (sCell.x !== fCell.x || sCell.y !== fCell.y) continue;
      claimedFlies.add(flyId);
      eatenDeltaBySpider.set(spiderId, (eatenDeltaBySpider.get(spiderId) ?? 0) + 1);
      writes.push({ subject: `${flyId}@turn${k}`, predicate: "mgx:eaten-by", object: spiderId });
      events.eaten.push({ fly: flyId, spider: spiderId, cell: cellId(sCell.x, sCell.y) });
    }
  }
  for (const [spiderId, delta] of eatenDeltaBySpider) {
    const newCount = (state.fliesEaten.get(spiderId)?.value ?? 0) + delta;
    writes.push({ subject: `${spiderId}@turn${k}`, predicate: "mgx:flies-eaten", object: String(newCount) });
  }

  // 2. Starve — mass reached zero, and not already claimed by this turn's eat.
  for (const flyId of flies) {
    if (claimedFlies.has(flyId)) continue;
    if ((postMoveMassByFly.get(flyId) ?? 0) <= 0) {
      writes.push({ subject: `${flyId}@turn${k}`, predicate: "mgx:starved", object: "true" });
      events.starved.push(flyId);
    }
  }
  const deadFliesThisTick = new Set([...claimedFlies, ...events.starved]);

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
    writes.push({ subject: `${eggId}@turn${k}`, predicate: "mgx:hatched-into", object: newSpiderId });
    events.hatched.push({ egg: eggId, spider: newSpiderId, cell: eggCell });
  }

  // 5. Spawn — every third turn, a new fly at an uncontested perimeter cell.
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
    const cell = perimeterCells().find((c) => !occupied.has(c));
    if (cell) {
      const newFlyId = `fly-${1 + maxIdSuffix(state.placements.keys(), /^fly-(\d+)$/)}`;
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
  const facts = [{ subject: "spider-1", predicate: "mgx:currently-in", object: cellId(WEB_HOME.x, WEB_HOME.y) }];
  for (let i = 0; i < flyCount; i += 1) {
    const cell = perimeter[Math.floor((perimeter.length * (i + 1)) / (flyCount + 1)) % perimeter.length];
    facts.push({ subject: `fly-${i + 1}`, predicate: "mgx:currently-in", object: cell });
    facts.push({ subject: `fly-${i + 1}`, predicate: "mgx:mass", object: String(FLY_INITIAL_MASS) });
  }
  await appendFacts(memoryDir, facts.map((f) => ({ ...f, provenance: worldProvenanceTag(WORLD_NAME) })));
  return { started: true, facts };
}

function goalLineFor(subject, believed, moved, kind) {
  if (!believed) return kind === "spider" ? "no fly in sight — holding position in the web." : "no spider in sight — holding position.";
  const seenAt = cellId(believed.cell.x, believed.cell.y);
  if (kind === "spider") {
    return moved
      ? `chasing ${believed.subject}, last seen at ${seenAt}.`
      : `co-located with ${believed.subject} in the web.`;
  }
  return `evading — last saw ${believed.subject} at ${seenAt}.`;
}

/**
 * One full tick: fold state, compute each live spider's and fly's belief,
 * replan/re-score, execute one movement step per agent, run the ecology
 * pass, and append everything as this turn's @turnN facts in one write.
 * `opts.toldFacts` is the belief layer's chat-integration extension point
 * (§4) — an array of `{ subject, toAgent, cell, turn }` rows, empty until a
 * later piece of work wires chat-told positions through it.
 *
 * Returns `{ turn, writes, agents, ecology }`: `agents` is keyed by every
 * live spider/fly subject after this tick, each `{ cell, goal, plan }` (the
 * spider's `plan` is its found path's remaining directions, or null when it
 * has none this tick); `ecology` is the tick's eaten/starved/laid/hatched/
 * spawned event summary.
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
  const agents = {};

  for (const spiderId of spiders) {
    const spiderCell = parseCellId(state.placements.get(spiderId).cell);
    const target = nearestBelievedTarget(spiderId, spiderCell, flies, state, { visionRadius, toldFacts });
    let nextCell = spiderCell;
    let plan = null;
    if (target) {
      const path = planSpiderPath(spiderCell, target.cell, applyActions);
      if (path) {
        if (path.actions.length) { nextCell = path.states[1]; plan = path.actions; }
      } else {
        nextCell = greedySpiderApproach(spiderCell, target.cell, applyActions);
      }
    }
    postMovePlacements.set(spiderId, nextCell);
    movementWrites.push({ subject: `${spiderId}@turn${k}`, predicate: "mgx:currently-in", object: cellId(nextCell.x, nextCell.y) });
    const moved = nextCell.x !== spiderCell.x || nextCell.y !== spiderCell.y;
    agents[spiderId] = { cell: cellId(nextCell.x, nextCell.y), goal: goalLineFor(spiderId, target, moved, "spider"), plan };
  }

  for (const flyId of flies) {
    const flyCell = parseCellId(state.placements.get(flyId).cell);
    const believedSpider = nearestBelievedTarget(flyId, flyCell, spiders, state, { visionRadius, toldFacts });
    const nextCell = greedyFlyMove(flyCell, believedSpider?.cell ?? null, applyActions);
    postMovePlacements.set(flyId, nextCell);
    movementWrites.push({ subject: `${flyId}@turn${k}`, predicate: "mgx:currently-in", object: cellId(nextCell.x, nextCell.y) });
    const priorMass = state.mass.get(flyId)?.value ?? FLY_INITIAL_MASS;
    const newMass = Math.max(0, priorMass - FLY_MASS_DECREMENT_PER_TURN);
    postMoveMassByFly.set(flyId, newMass);
    movementWrites.push({ subject: `${flyId}@turn${k}`, predicate: "mgx:mass", object: String(newMass) });
    agents[flyId] = { cell: cellId(nextCell.x, nextCell.y), goal: goalLineFor(flyId, believedSpider, true, "fly") };
  }

  const ecology = runEcologyPass({ state, postMovePlacements, postMoveMassByFly, turn: k });
  const writes = [...movementWrites, ...ecology.writes];
  const provenance = `${worldProvenanceTag(WORLD_NAME)}:turn${k}`;
  await appendFacts(memoryDir, writes.map((f) => ({ ...f, provenance })));

  return { turn: k, writes, agents, ecology: ecology.events };
}
