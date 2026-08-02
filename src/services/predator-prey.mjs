// predator-prey.mjs — the headless town-square turn engine: an (epoch, turn)
// state fold, vision-gated belief over agents AND inert food, the two decision
// chains, and one fixed-order ecology pass, all reading and writing plain fact
// rows through the shared memory store. No chat, no rendering.
//
// Role-parameterized from the first line. Nothing below names a fox or a
// goblin: the cast arrives as MUDIII_ROLES, the numbers arrive role-keyed from
// DEFAULT_GAME_CONFIG.mudiii, and the board arrives as a layout. A later cast
// is a new roles object plus new model keys, with no edit here.
//
// Grid geometry, the prop tables and what "solid" means all come from
// domain/town-square-world.mjs. Belief comes from domain/agent-belief.mjs,
// which is board-size agnostic and models vision as plain Chebyshev distance
// with no line of sight — a building blocks movement, never sight.
//
// Two things this file deliberately does NOT borrow from spider-fly.mjs, its
// nearest sibling:
//
//   - Its snapshot regex. `/^(.+)@turn(\d+)$/` is greedy, so it reads
//     `goblin-1@epoch2@turn3`'s base as `goblin-1@epoch2` — an id no roster
//     matches, which drops every post-recast fact out of the fold silently.
//     parseSnapshotSubject/snapshotSubject from adventure.mjs are lazy and
//     read both forms, and are imported here rather than re-derived.
//   - Its `mgx:mass` predicate. Mass is rewritten every turn for every agent,
//     and mgx:mass is unlisted in the memory resolution table, so it falls to
//     the contradiction policy. mgx:hasMass is the listed one.
//
// gridApplyActions is written out below rather than imported from
// spider-fly.mjs on purpose: spider-fly is the pattern this engine mirrors,
// not a library underneath it, and the design has spider-fly migrating onto
// this engine later — an import in this direction would become a cycle then.

import {
  DEFAULT_FACING, TOWN_SQUARE_LAYOUTS,
  cellId, parseCellId, chebyshevDistance, isFoodId, isPropId,
  DIRECTION_DELTA, oneStepDirectionBetween, openCells, perimeterCells,
} from "../domain/town-square-world.mjs";
import {
  DEFAULT_VISION_RADIUS, believedCellOf, nearestBelievedTarget, beliefSnapshotFor,
} from "../domain/agent-belief.mjs";
import { findActionPath, findReachableSet } from "../domain/planning.mjs";
import { appendFacts, loadMemory, readFactRows } from "../adapters/memory/core.mjs";
import { worldProvenanceTag } from "../domain/worlds-pack.mjs";
import { mulberry32 } from "../domain/seeded-random.mjs";
import { fnv1a32 } from "../domain/hash.mjs";
import { DEFAULT_GAME_CONFIG } from "../domain/game-config.mjs";
import { objectClassChain, parseSnapshotSubject, snapshotSubject, WORLD_EPOCH_PREDICATE } from "./adventure.mjs";

export { DEFAULT_VISION_RADIUS, believedCellOf, nearestBelievedTarget, beliefSnapshotFor };

/** The v1 cast. Keyed by role, never by species — every knob this engine reads
 *  is role-keyed too, so swapping the pair is data. */
export const MUDIII_ROLES = Object.freeze({
  predator: { role: "predator", kind: "fox", idPrefix: "fox" },
  prey: { role: "prey", kind: "goblin", idPrefix: "goblin" },
  food: { spawnedKind: "crumb", placedKind: "morsel" },
});

const PLACEMENT_PREDICATE = "mgx:currently-in";
const MASS_PREDICATE = "mgx:hasMass";
const MOOD_PREDICATE = "mgx:feels";
const FACING_PREDICATE = "mgx:facing";
const EATEN_BY_PREDICATE = "mgx:eaten-by";
const STARVED_PREDICATE = "mgx:starved";
const PLACED_BY_PREDICATE = "mgx:placed-by";
const MODEL_PREDICATE = "mgx:model";
const ROTATION_PREDICATE = "mgx:rotation";
const EXIT_PREDICATE_RE = /^mgx:has-exit-([a-z]+)$/;

// One row per tick, whatever else the turn did, on a subject the board itself
// owns. It is what the next tick's turn number counts, and it exists as its own
// predicate rather than being read off the mood rows because a board with
// nothing alive on it writes no moods — and a turn counter that stops advancing
// leaves every later tick replaying the same turn number forever.
const TURN_PLAYED_PREDICATE = "mgx:turn-played";
const BOARD_SUBJECT = "square";

const MUDIII_STATE_PREDICATE_SET = new Set([
  PLACEMENT_PREDICATE, MASS_PREDICATE, MOOD_PREDICATE, FACING_PREDICATE,
  EATEN_BY_PREDICATE, STARVED_PREDICATE, PLACED_BY_PREDICATE,
  MODEL_PREDICATE, ROTATION_PREDICATE, TURN_PLAYED_PREDICATE,
  "rdf:type", WORLD_EPOCH_PREDICATE,
]);

/** Every predicate that carries live town-square state — where a thing stands,
 *  what it weighs, how it feels, which way it faces, what took it off the
 *  board, who put it there, and the class and model a mid-play mint needs. */
export const MUDIII_STATE_PREDICATES = Object.freeze([...MUDIII_STATE_PREDICATE_SET].sort());

/** Whether `predicate` carries live town-square state. The P2P sync filter
 *  reads this to tell a fact a turn produced from the page chrome around it.
 *  Pure. */
export function isMudiiiStatePredicate(predicate) {
  const p = String(predicate || "");
  return MUDIII_STATE_PREDICATE_SET.has(p) || EXIT_PREDICATE_RE.test(p);
}

// ---- seeded "randomness" (never Math.random) ---------------------------------
// Every seed string carries the epoch. Without it a Reset restarts the turn
// counter and replays the previous run's spawn and wander cells exactly, which
// makes Reset look broken while being perfectly deterministic.

const seedKey = (layoutName, epoch, turn, id, purpose) => `${layoutName}:${epoch}:${turn}:${id}:${purpose}`;

/** Deterministically pick one of `options` (must be non-empty), keyed on
 *  `contextString`. */
function seededPick(options, contextString) {
  const rng = mulberry32(fnv1a32(contextString));
  return options[Math.floor(rng() * options.length)];
}

// ---- the (epoch, turn) fold ---------------------------------------------------

/** Fold fact rows into the current town-square state.
 *
 *  Rows rank by the (epoch, turn) pair, exactly as adventure.mjs's
 *  foldWorldState does, so a recast can never be outranked by the run it
 *  replaced: a peer's turn-9 snapshot from before the recast loses to a turn-1
 *  snapshot written after it. An unstamped row carries no stamp of its own and
 *  ranks as turn 0 of the CURRENT epoch — the world pack's own rows are
 *  exactly the state a fresh run starts from.
 *
 *  Two counters come out, and they are not the same number. `turnCount` is the
 *  largest turn stamped on ANY row in the current epoch. `tickCount` is the
 *  largest turn a TICK actually ran, read off the one marker row a tick always
 *  writes. The next tick is tickCount + 1, and so is the stamp on a food the
 *  player places before it — which is how a placement and the tick that
 *  resolves it share one turn number instead of the placement quietly
 *  consuming one.
 *
 *  Pure. */
export function foldTownSquareState(factRows) {
  const rows = factRows || [];
  let epoch = 0;
  for (const row of rows) {
    if (row.predicate === WORLD_EPOCH_PREDICATE) {
      const marked = Number(row.object);
      if (Number.isInteger(marked) && marked > epoch) epoch = marked;
      continue;
    }
    const snap = parseSnapshotSubject(row.subject);
    if (snap && snap.epoch > epoch) epoch = snap.epoch;
  }

  const placements = new Map(); // subject -> { cell, turn, epoch }
  const mass = new Map();       // subject -> { value, turn, epoch }
  const mood = new Map();       // subject -> { value, turn, epoch }
  const facing = new Map();     // subject -> { value, turn, epoch }
  const eatenBy = new Map();    // subject -> { by, turn, epoch }
  const placedBy = new Map();   // subject -> { by, turn, epoch }
  const types = new Map();      // subject -> class named by its bare rdf:type row
  const models = new Map();     // prop subject -> asset key
  const starved = new Set();
  let turnCount = 0;
  let tickCount = 0;

  const outranks = (rowEpoch, turn, prior) =>
    !prior || rowEpoch > prior.epoch || (rowEpoch === prior.epoch && turn >= prior.turn);

  for (const row of rows) {
    if (row.predicate === WORLD_EPOCH_PREDICATE) continue;
    const snap = parseSnapshotSubject(row.subject);
    const base = snap ? snap.base : row.subject;
    const rowEpoch = snap ? snap.epoch : epoch;
    const turn = snap ? snap.turn : 0;
    if (snap && rowEpoch === epoch) turnCount = Math.max(turnCount, turn);

    switch (row.predicate) {
      case PLACEMENT_PREDICATE:
        if (outranks(rowEpoch, turn, placements.get(base))) placements.set(base, { cell: row.object, turn, epoch: rowEpoch });
        break;
      case MASS_PREDICATE: {
        const value = Number(row.object);
        if (!Number.isFinite(value)) break;
        if (outranks(rowEpoch, turn, mass.get(base))) mass.set(base, { value, turn, epoch: rowEpoch });
        break;
      }
      case MOOD_PREDICATE:
        if (outranks(rowEpoch, turn, mood.get(base))) mood.set(base, { value: row.object, turn, epoch: rowEpoch });
        break;
      case TURN_PLAYED_PREDICATE:
        if (snap && rowEpoch === epoch) tickCount = Math.max(tickCount, turn);
        break;
      case FACING_PREDICATE:
        if (outranks(rowEpoch, turn, facing.get(base))) facing.set(base, { value: row.object, turn, epoch: rowEpoch });
        break;
      case EATEN_BY_PREDICATE:
        if (outranks(rowEpoch, turn, eatenBy.get(base))) eatenBy.set(base, { by: row.object, turn, epoch: rowEpoch });
        break;
      case PLACED_BY_PREDICATE:
        if (outranks(rowEpoch, turn, placedBy.get(base))) placedBy.set(base, { by: row.object, turn, epoch: rowEpoch });
        break;
      case STARVED_PREDICATE:
        if (rowEpoch === epoch) starved.add(base);
        break;
      case MODEL_PREDICATE:
        models.set(base, row.object);
        break;
      case "rdf:type":
        if (!snap && !types.has(base)) types.set(base, row.object);
        break;
      default:
        break;
    }
  }

  // A terminal marker only counts inside the current epoch. A recast reopens
  // the same deterministic ids, so an agent eaten on the previous run must not
  // arrive at the new one already dead.
  const removed = new Set([...starved]);
  for (const [subject, { epoch: rowEpoch }] of eatenBy) {
    if (rowEpoch === epoch) removed.add(subject);
  }

  return { placements, mass, mood, facing, eatenBy, placedBy, types, models, starved, removed, turnCount, tickCount, epoch };
}

/** Every live subject whose id names `kind`, sorted. */
function liveOfKind(state, kind) {
  const re = new RegExp(`^${kind}-\\d+$`);
  return [...state.placements.keys()].filter((id) => re.test(id) && !state.removed.has(id)).sort();
}

function maxIdSuffix(ids, kind) {
  const re = new RegExp(`^${kind}-(\\d+)$`);
  let max = 0;
  for (const id of ids) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// ---- movement over the world's own exit facts ----------------------------------

/** The movement applyActions closure findActionPath/findReachableSet need: one
 *  hop per mgx:has-exit-<direction> fact reachable from a cell, in the fixed
 *  direction order every search shares for deterministic tie-breaking. Built
 *  once per tick from the world's static exit rows — which is the whole reason
 *  buildings need no planner code: the world pack simply never emits an exit
 *  into a prop's cell, so a wall is a missing edge. */
export function gridApplyActions(factRows) {
  const exits = new Map();
  for (const row of factRows || []) {
    const m = EXIT_PREDICATE_RE.exec(row.predicate);
    if (!m) continue;
    if (!exits.has(row.subject)) exits.set(row.subject, new Map());
    exits.get(row.subject).set(m[1], row.object);
  }
  return (searchState) => {
    const out = [];
    const dirs = exits.get(cellId(searchState.x, searchState.y));
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

/** Canonicalizes a grid-position search state onto its cell alone. */
export const pathStateKey = (searchState) => cellId(searchState.x, searchState.y);

const oneStepOptions = (fromCell, applyActions) =>
  [fromCell, ...findReachableSet(fromCell, applyActions, { maxDepth: 1, stateKey: pathStateKey }).map((r) => r.node)];

function bestOneStepBy(fromCell, applyActions, scoreOf, isBetter) {
  const options = oneStepOptions(fromCell, applyActions);
  let best = options[0];
  let bestScore = scoreOf(best);
  for (let i = 1; i < options.length; i += 1) {
    const score = scoreOf(options[i]);
    if (isBetter(score, bestScore)) { bestScore = score; best = options[i]; }
  }
  return best;
}

/** One-ply greedy: the reachable cell (or staying put) furthest in Chebyshev
 *  terms from `awayFrom`. Both the prey's evade rung and the predator's avoid
 *  rung are this function. */
export function greedyAway(fromCell, awayFrom, applyActions) {
  if (!awayFrom) return fromCell;
  return bestOneStepBy(
    fromCell, applyActions,
    (cell) => chebyshevDistance(cell.x, cell.y, awayFrom.x, awayFrom.y),
    (score, bestScore) => score > bestScore,
  );
}

/** One-ply greedy, scored the opposite way: close the distance instead of
 *  opening it. The fallback when no full path to a believed target exists. */
export function greedyToward(fromCell, towardCell, applyActions) {
  if (!towardCell) return fromCell;
  return bestOneStepBy(
    fromCell, applyActions,
    (cell) => chebyshevDistance(cell.x, cell.y, towardCell.x, towardCell.y),
    (score, bestScore) => score < bestScore,
  );
}

/** A seeded, uniform pick among staying put or any one-ply reachable cell.
 *  Deterministic and replayable, and it looks random to somebody watching.
 *  Both roles' last rung: a motionless predator reads as a broken page. */
export function seededWander(fromCell, applyActions, { layoutName, epoch, turn, id }) {
  return seededPick(oneStepOptions(fromCell, applyActions), seedKey(layoutName, epoch, turn, id, "wander"));
}

/** A one-step "plan" for a greedy or held move — the direction as a length-1
 *  array, or `[]` when the agent held still. A genuine multi-step search result
 *  supplies its own full direction list instead. Either way plan[0] is the
 *  direction actually taken, which is what drives facing. */
function stepPlan(fromCell, toCell) {
  const direction = oneStepDirectionBetween(fromCell, toCell);
  return direction ? [direction] : [];
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---- the goal line and the mood word -------------------------------------------
// Every branch assigns a mood beside the goal sentence it renders, and that
// word is written as a real mgx:feels fact for the turn. The words are the four
// spider-fly already uses: a predator mid-chase is angry, one avoiding a rival
// is scared, anything wandering or foraging is calm, and anything that just ate
// is happy.

function goalLine(kind, { subject, cell, arrived } = {}) {
  switch (kind) {
    case "avoid": return `avoiding ${subject}, last seen at ${cell}.`;
    case "chase": return arrived ? `standing over ${subject} — taking it.` : `chasing ${subject}, last seen at ${cell}.`;
    case "evade": return `evading — last saw ${subject} at ${cell}.`;
    case "forage": return arrived ? `standing on ${subject} — eating it.` : `foraging — heading for ${subject} at ${cell}.`;
    default: return "nothing in sight — wandering the square.";
  }
}

// ---- the ecology pass ----------------------------------------------------------
// One fixed order, and the order is the mechanic:
//
//   1. eat-agent — a predator sharing a cell with prey takes it, and gains the
//      prey's remaining mass. Catch and eat are one step: a predator needs no
//      apparatus, so nothing is ever carried and no state survives the turn.
//   2. eat-item  — prey standing on food eat it. AFTER eat-agent, so a prey
//      taken this turn is never also credited with a crumb. A prey on two
//      crumbs eats both.
//   3. starve    — mass reached zero, and nothing this turn already claimed it.
//      Whatever ate this turn survives it, because eating resolved first.
//   4. spawn-prey — arrivals wander in from the edge, so the pick is the
//      perimeter minus prop cells. That subtraction is not a nicety: the
//      headline layout has buildings sitting on two whole edges.
//   5. spawn-food — dropped bread lands anywhere open, so the pick is every
//      open cell minus whatever stands or lies on one. Last, so it reads the
//      board as every earlier step left it.
//
// Both spawns check their cap first, so a full board simply skips that turn's
// arrival.

function runEcologyPass({
  state, layout, roles, config, turn, epoch,
  postMovePlacements, postMoveMass, liveItemIds, itemCellOf, itemMassOf, foodIds,
}) {
  const k = turn;
  const writes = [];
  const events = [];
  const stamp = (base) => snapshotSubject(base, k, epoch);

  const predators = [...postMovePlacements.keys()].filter((id) => roleOfId(id, roles) === "predator").sort();
  const prey = [...postMovePlacements.keys()].filter((id) => roleOfId(id, roles) === "prey").sort();
  const finalMass = new Map(postMoveMass);
  const takenAgents = new Set();
  const takenItems = new Set();

  // 1. eat-agent
  for (const predatorId of predators) {
    const pc = postMovePlacements.get(predatorId);
    for (const preyId of prey) {
      if (takenAgents.has(preyId)) continue;
      const qc = postMovePlacements.get(preyId);
      if (pc.x !== qc.x || pc.y !== qc.y) continue;
      takenAgents.add(preyId);
      const gained = finalMass.get(preyId) ?? 0;
      finalMass.set(predatorId, (finalMass.get(predatorId) ?? 0) + gained);
      writes.push({ subject: stamp(preyId), predicate: EATEN_BY_PREDICATE, object: predatorId });
      events.push({ type: "eat-agent", predator: predatorId, prey: preyId, cell: cellId(pc.x, pc.y), massGained: round2(gained) });
    }
  }

  // 2. eat-item
  for (const preyId of prey) {
    if (takenAgents.has(preyId)) continue;
    const qc = postMovePlacements.get(preyId);
    const here = cellId(qc.x, qc.y);
    for (const itemId of liveItemIds) {
      if (takenItems.has(itemId)) continue;
      if (!foodIds.has(itemId)) continue;
      if (itemCellOf.get(itemId) !== here) continue;
      takenItems.add(itemId);
      const gained = itemMassOf.get(itemId) ?? 0;
      finalMass.set(preyId, (finalMass.get(preyId) ?? 0) + gained);
      writes.push({ subject: stamp(itemId), predicate: EATEN_BY_PREDICATE, object: preyId });
      events.push({ type: "eat-item", agent: preyId, item: itemId, cell: here, massGained: round2(gained) });
    }
  }

  // 3. starve
  const starvedThisTurn = new Set();
  for (const agentId of [...predators, ...prey].sort()) {
    if (takenAgents.has(agentId)) continue;
    if ((finalMass.get(agentId) ?? 0) > 0) continue;
    starvedThisTurn.add(agentId);
    const c = postMovePlacements.get(agentId);
    writes.push({ subject: stamp(agentId), predicate: STARVED_PREDICATE, object: "true" });
    events.push({ type: "starve", agent: agentId, cell: cellId(c.x, c.y) });
  }

  const goneThisTurn = new Set([...takenAgents, ...starvedThisTurn]);
  const occupied = new Set();
  for (const [id, c] of postMovePlacements) {
    if (goneThisTurn.has(id)) continue;
    occupied.add(cellId(c.x, c.y));
  }
  const itemCells = new Set();
  for (const itemId of liveItemIds) {
    if (takenItems.has(itemId)) continue;
    itemCells.add(itemCellOf.get(itemId));
  }

  const spawned = [];

  // 4. spawn-prey
  const livePreyAfter = prey.filter((id) => !goneThisTurn.has(id)).length;
  if (k % config.preySpawnIntervalTurns === 0 && livePreyAfter < config.maxPreyPopulation) {
    const free = perimeterCells(layout).filter((c) => !occupied.has(c));
    if (free.length) {
      const preyId = `${roles.prey.idPrefix}-${1 + maxIdSuffix(state.placements.keys(), roles.prey.kind)}`;
      const cell = seededPick(free, seedKey(layout.name, epoch, k, preyId, "spawn"));
      occupied.add(cell);
      writes.push({ subject: preyId, predicate: "rdf:type", object: roles.prey.kind });
      writes.push({ subject: stamp(preyId), predicate: PLACEMENT_PREDICATE, object: cell });
      writes.push({ subject: stamp(preyId), predicate: MASS_PREDICATE, object: String(config.preyInitialMass) });
      writes.push({ subject: stamp(preyId), predicate: FACING_PREDICATE, object: DEFAULT_FACING });
      events.push({ type: "spawn-prey", agent: preyId, cell, mass: round2(config.preyInitialMass) });
      spawned.push({ id: preyId, role: "prey", cell, mass: config.preyInitialMass });
    }
  }

  // 5. spawn-food
  const liveFoodAfter = liveItemIds.filter((id) => !takenItems.has(id)).length;
  if (k % config.foodSpawnIntervalTurns === 0 && liveFoodAfter < config.maxFoodItems) {
    const free = openCells(layout).filter((c) => !occupied.has(c) && !itemCells.has(c));
    if (free.length) {
      const itemId = `${roles.food.spawnedKind}-${1 + maxIdSuffix(state.placements.keys(), roles.food.spawnedKind)}`;
      const cell = seededPick(free, seedKey(layout.name, epoch, k, itemId, "spawn"));
      writes.push({ subject: itemId, predicate: "rdf:type", object: roles.food.spawnedKind });
      writes.push({ subject: stamp(itemId), predicate: PLACEMENT_PREDICATE, object: cell });
      writes.push({ subject: stamp(itemId), predicate: MASS_PREDICATE, object: String(config.spawnedFoodMass) });
      events.push({ type: "spawn-food", item: itemId, kind: roles.food.spawnedKind, cell, mass: round2(config.spawnedFoodMass) });
      spawned.push({ id: itemId, kind: roles.food.spawnedKind, cell, mass: config.spawnedFoodMass, isItem: true });
    }
  }

  // Every surviving agent's mass goes on record with whatever it ended the turn
  // holding, so an eat and the mass it bought land in the same write.
  for (const agentId of [...predators, ...prey].sort()) {
    if (goneThisTurn.has(agentId)) continue;
    writes.push({ subject: stamp(agentId), predicate: MASS_PREDICATE, object: String(finalMass.get(agentId)) });
  }

  return { writes, events, finalMass, takenAgents, takenItems, starvedThisTurn, spawned };
}

/** Which role an id names, or null for a prop, a food item, or anything this
 *  cast doesn't hold. Never a guessed role. */
export function roleOfId(id, roles = MUDIII_ROLES) {
  if (new RegExp(`^${roles.predator.idPrefix}-\\d+$`).test(id)) return "predator";
  if (new RegExp(`^${roles.prey.idPrefix}-\\d+$`).test(id)) return "prey";
  return null;
}

// ---- bootstrap -----------------------------------------------------------------

/**
 * Seed a fresh town square: one predator/prey roster placed on the board, each
 * with its role's starting mass, a `calm` mood and a facing. A no-op when the
 * first predator already exists, so it is safe to call from a caller unsure
 * whether the game has started.
 *
 * `opts.agents` places an explicit roster (`{ id: { role, cell, facing, mass } }`)
 * — how a recorded fixture pins a starting board. Without it the roster is
 * sized by `opts.predatorCount`/`opts.preyCount` (defaulting to the layout's
 * own cast counts) and placed at seeded picks: predators on open cells, prey on
 * the perimeter they wander in from.
 */
export async function startTownSquareGame(memoryDir, {
  layout, agents = null, predatorCount = null, preyCount = null,
  config = DEFAULT_GAME_CONFIG.mudiii, roles = MUDIII_ROLES, epoch = 0,
} = {}) {
  const state = foldTownSquareState(readFactRows(await loadMemory(memoryDir)));
  const firstPredator = `${roles.predator.idPrefix}-1`;
  if (state.placements.has(firstPredator)) return { started: false, facts: [] };

  const roster = agents ?? seededRoster(layout, {
    predators: predatorCount ?? layout.cast.predators,
    prey: preyCount ?? layout.cast.prey,
    roles, epoch,
  });

  const facts = [];
  for (const id of Object.keys(roster).sort()) {
    const spec = roster[id];
    const role = spec.role ?? roleOfId(id, roles);
    const kind = role === "predator" ? roles.predator.kind : roles.prey.kind;
    const mass = spec.mass ?? (role === "predator" ? config.predatorInitialMass : config.preyInitialMass);
    facts.push({ subject: id, predicate: "rdf:type", object: kind });
    facts.push({ subject: id, predicate: PLACEMENT_PREDICATE, object: spec.cell });
    facts.push({ subject: id, predicate: MASS_PREDICATE, object: String(mass) });
    facts.push({ subject: id, predicate: MOOD_PREDICATE, object: "calm" });
    facts.push({ subject: id, predicate: FACING_PREDICATE, object: spec.facing ?? DEFAULT_FACING });
  }
  await appendFacts(memoryDir, facts.map((f) => ({ ...f, provenance: worldProvenanceTag(layout.name) })));
  return { started: true, facts };
}

function seededRoster(layout, { predators, prey, roles, epoch }) {
  const roster = {};
  const taken = new Set();
  const open = openCells(layout);
  const edge = perimeterCells(layout);
  for (let i = 1; i <= predators; i += 1) {
    const id = `${roles.predator.idPrefix}-${i}`;
    const free = open.filter((c) => !taken.has(c));
    const cell = seededPick(free.length ? free : open, seedKey(layout.name, epoch, 0, id, "spawn"));
    taken.add(cell);
    roster[id] = { role: "predator", cell, facing: DEFAULT_FACING };
  }
  for (let i = 1; i <= prey; i += 1) {
    const id = `${roles.prey.idPrefix}-${i}`;
    const free = edge.filter((c) => !taken.has(c));
    const cell = seededPick(free.length ? free : edge, seedKey(layout.name, epoch, 0, id, "spawn"));
    taken.add(cell);
    roster[id] = { role: "prey", cell, facing: DEFAULT_FACING };
  }
  return roster;
}

// ---- the player's own verb: placing food -----------------------------------------

/**
 * Put one piece of food on a cell, on the player's say-so. This is the world
 * teach machinery of src/services/world-teach.mjs applied to one sentence: the
 * same `world:<name>:taught:turnK` provenance (so the row passes the playable
 * fold's `world:` filter), the same bare `rdf:type` row beside a snapshot-
 * stamped placement, and the same "a teach spends a turn number" convention.
 * It writes `mgx:placed-by player` besides, which is what makes "who put that
 * there?" ground on an answer that names the player.
 *
 * Refuses, with the reason, when the cell does not parse, sits off the board,
 * or holds a prop or another item. A cell an ANIMAL is standing on is allowed:
 * dropping a morsel at a predator's feet is the trap the whole design hangs on,
 * and refusing it would delete the mechanic.
 */
export async function placeFood(memoryDir, {
  layout, cell, config = DEFAULT_GAME_CONFIG.mudiii, roles = MUDIII_ROLES,
  placedBy = "player", kind = null,
} = {}) {
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldTownSquareState(rows);
  const target = String(cell ?? "");
  const parsed = parseCellId(target);
  if (!parsed) return { placed: false, reason: `"${target || "that"}" doesn't name a cell — cells read like cell-3-4.` };
  if (parsed.x < 1 || parsed.x > layout.gridSize || parsed.y < 1 || parsed.y > layout.gridSize) {
    return { placed: false, reason: `${target} is off the board — this square runs cell-1-1 to cell-${layout.gridSize}-${layout.gridSize}.` };
  }
  if (layout.props.some((p) => p.cell === target)) return { placed: false, reason: `${target} is blocked.` };
  const itemHere = [...state.placements.entries()].find(([id, place]) =>
    isFoodId(id) && !state.removed.has(id) && place.cell === target);
  if (itemHere) return { placed: false, reason: `${target} already holds ${itemHere[0]}.` };

  const foodKind = kind ?? roles.food.placedKind;
  const k = state.tickCount + 1;
  const epoch = state.epoch;
  const itemId = `${foodKind}-${1 + maxIdSuffix(state.placements.keys(), foodKind)}`;
  const facts = [
    { subject: itemId, predicate: "rdf:type", object: foodKind },
    { subject: itemId, predicate: PLACED_BY_PREDICATE, object: placedBy },
    { subject: snapshotSubject(itemId, k, epoch), predicate: PLACEMENT_PREDICATE, object: target },
    { subject: snapshotSubject(itemId, k, epoch), predicate: MASS_PREDICATE, object: String(config.placedFoodMass) },
  ];
  const provenance = `${worldProvenanceTag(layout.name)}:taught:turn${k}`;
  await appendFacts(memoryDir, facts.map((f) => ({ ...f, provenance })));
  return {
    placed: true,
    item: itemId,
    kind: foodKind,
    cell: target,
    mass: round2(config.placedFoodMass),
    placedBy,
    turn: k,
    facts,
  };
}

// ---- what stands on the board right now -------------------------------------------

/** Who and what is live in `state`, plus the derived maps a decision or a
 *  render needs: the two agent rosters, the item roster, which of those items
 *  count as food, and each item's cell and mass. `beliefCandidates` is the one
 *  sorted list every belief snapshot is taken against, so an observer's view of
 *  the board never depends on which caller asked.
 *
 *  Read by both the tick and `townSquareBoard`, so a resting board and a ticking
 *  one can never disagree about who is on it. Pure.
 *
 *  objectClassChain re-filters the whole row array per node it walks, so the
 *  food set is computed once here over the item roster and never inside an agent
 *  loop. Inside the prey loop it would cost roughly one full row scan per prey
 *  per item per tick — fine at three prey, unusable at the ten the slider
 *  offers. */
function readLiveBoard(rows, state, { config, roles }) {
  const predators = liveOfKind(state, roles.predator.kind);
  const prey = liveOfKind(state, roles.prey.kind);
  const liveItemIds = [...liveOfKind(state, roles.food.spawnedKind), ...liveOfKind(state, roles.food.placedKind)].sort();
  return {
    predators,
    prey,
    liveItemIds,
    foodIds: new Set(liveItemIds.filter((id) => objectClassChain(rows, id).includes("food"))),
    itemCellOf: new Map(liveItemIds.map((id) => [id, state.placements.get(id).cell])),
    itemMassOf: new Map(liveItemIds.map((id) => [id, state.mass.get(id)?.value ?? config.spawnedFoodMass])),
    beliefCandidates: [...predators, ...prey, ...liveItemIds].sort(),
  };
}

/** The render payload's `items` half — `{ id: { kind, cell } }` — over
 *  `liveItemIds`, skipping anything in `taken` (a tick's eaten set; a resting
 *  board passes none). Pure. */
function itemsPayload(liveItemIds, { state, itemCellOf, roles, taken = null }) {
  const items = {};
  for (const id of liveItemIds) {
    if (taken && taken.has(id)) continue;
    items[id] = { kind: state.types.get(id) ?? kindOfItem(id, roles), cell: itemCellOf.get(id) };
  }
  return items;
}

// ---- one tick --------------------------------------------------------------------

/**
 * One full tick over `layout`: fold, believe, decide, move, run the ecology
 * pass, and append everything as this turn's stamped facts in a single write.
 *
 * Predators move before prey, and that ordering is load-bearing for replay: a
 * prey's belief is computed against the PRE-move predator positions (it reacts
 * to where the predator was when it looked), while eating resolves on the
 * post-move ones (it is caught where the predator actually ends up).
 *
 * Returns `{ turn, epoch, agents, items, ecology, rungs, writes }`. `agents`
 * and `items` and `ecology` are the frozen render payload — see
 * townSquareTickPayload, which projects exactly those three plus the turn.
 * `rungs` is the decision each live agent reached this turn ("chase", "evade",
 * "forage", "avoid", "wander"); an agent that decided and then died still has a
 * rung and no longer has an `agents` entry, which is the difference between a
 * decision and a survivor.
 */
export async function runTownSquareTick(memoryDir, {
  layout, toldFacts = [], config = DEFAULT_GAME_CONFIG.mudiii, roles = MUDIII_ROLES,
} = {}) {
  const lay = typeof layout === "string" ? TOWN_SQUARE_LAYOUTS[layout] : layout;
  if (!lay) throw new Error(`runTownSquareTick: no such layout "${layout}"`);
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldTownSquareState(rows);
  const k = state.tickCount + 1;
  const epoch = state.epoch;
  const stamp = (base) => snapshotSubject(base, k, epoch);
  const applyActions = gridApplyActions(rows);

  const { predators, prey, liveItemIds, foodIds, itemCellOf, itemMassOf, beliefCandidates } =
    readLiveBoard(rows, state, { config, roles });
  const movementWrites = [];
  const postMovePlacements = new Map();
  const agents = {};
  const rungs = {};

  const decide = (agentId, role) => {
    const fromCell = parseCellId(state.placements.get(agentId).cell);
    const visionRadius = role === "predator" ? config.predatorVisionRadius : config.preyVisionRadius;
    const beliefOpts = { visionRadius, toldFacts };
    const rivals = role === "predator" ? predators.filter((id) => id !== agentId) : predators;
    const threat = nearestBelievedTarget(agentId, fromCell, rivals, state, beliefOpts);

    let rung;
    let nextCell;
    let plan;
    let goal;
    let mood;
    if (threat) {
      rung = role === "predator" ? "avoid" : "evade";
      nextCell = greedyAway(fromCell, threat.cell, applyActions);
      plan = stepPlan(fromCell, nextCell);
      goal = goalLine(rung, { subject: threat.subject, cell: cellId(threat.cell.x, threat.cell.y) });
      mood = "scared";
    } else {
      const quarry = role === "predator"
        ? nearestBelievedTarget(agentId, fromCell, prey, state, beliefOpts)
        : nearestBelievedTarget(agentId, fromCell, [...foodIds].sort(), state, beliefOpts);
      if (quarry) {
        rung = role === "predator" ? "chase" : "forage";
        const path = findActionPath(fromCell, (s) => s.x === quarry.cell.x && s.y === quarry.cell.y, applyActions, { stateKey: pathStateKey });
        if (path && path.actions.length) {
          nextCell = path.states[1];
          plan = path.actions;
        } else if (path) {
          nextCell = fromCell;
          plan = [];
        } else {
          nextCell = greedyToward(fromCell, quarry.cell, applyActions);
          plan = stepPlan(fromCell, nextCell);
        }
        const arrived = nextCell.x === quarry.cell.x && nextCell.y === quarry.cell.y;
        goal = goalLine(rung, { subject: quarry.subject, cell: cellId(quarry.cell.x, quarry.cell.y), arrived });
        mood = role === "predator" ? "angry" : "calm";
      } else {
        rung = "wander";
        nextCell = seededWander(fromCell, applyActions, { layoutName: lay.name, epoch, turn: k, id: agentId });
        plan = stepPlan(fromCell, nextCell);
        goal = goalLine("wander");
        mood = "calm";
      }
    }

    const belief = beliefSnapshotFor(agentId, fromCell, beliefCandidates, state, beliefOpts);
    const facing = plan[0] ?? state.facing.get(agentId)?.value ?? DEFAULT_FACING;
    postMovePlacements.set(agentId, nextCell);
    rungs[agentId] = rung;
    agents[agentId] = { role, cell: cellId(nextCell.x, nextCell.y), facing, goal, mood, plan, mass: 0, belief };
  };

  for (const id of predators) decide(id, "predator");
  for (const id of prey) decide(id, "prey");

  const postMoveMass = new Map();
  for (const id of [...predators, ...prey]) {
    const role = agents[id].role;
    const drain = role === "predator" ? config.predatorMassDecrementPerTurn : config.preyMassDecrementPerTurn;
    const start = role === "predator" ? config.predatorInitialMass : config.preyInitialMass;
    const prior = state.mass.get(id)?.value ?? start;
    postMoveMass.set(id, Math.max(0, prior - drain));
  }

  for (const id of [...predators, ...prey]) {
    const c = postMovePlacements.get(id);
    movementWrites.push({ subject: stamp(id), predicate: PLACEMENT_PREDICATE, object: cellId(c.x, c.y) });
    movementWrites.push({ subject: stamp(id), predicate: FACING_PREDICATE, object: agents[id].facing });
  }

  const pass = runEcologyPass({
    state, layout: lay, roles, config, turn: k, epoch,
    postMovePlacements, postMoveMass, liveItemIds, itemCellOf, itemMassOf, foodIds,
  });

  // A food the player put down before this tick was stamped with this same turn
  // number, so it is already on the board for everyone's decisions above. It is
  // reported first: a player action, not a step of the pass.
  const placedThisTurn = liveItemIds
    .filter((id) => state.placedBy.has(id) && state.placements.get(id).turn === k && state.placements.get(id).epoch === epoch)
    .sort()
    .map((id) => ({
      type: "place-food",
      item: id,
      kind: state.types.get(id) ?? roles.food.placedKind,
      cell: itemCellOf.get(id),
      mass: round2(itemMassOf.get(id)),
      placedBy: state.placedBy.get(id).by,
    }));
  const ecology = [...placedThisTurn, ...pass.events];

  for (const id of Object.keys(agents)) agents[id].mass = round2(pass.finalMass.get(id) ?? 0);

  // Goals were assigned during movement, before the pass resolved anything, so
  // any goal naming something that died this tick is now stale — including a
  // THIRD agent's, whose quarry somebody else took. Scrub those first, so the
  // nicer "just ate" line below always wins for whoever actually ate.
  const goneThisTurn = [...pass.takenAgents, ...pass.starvedThisTurn, ...pass.takenItems];
  for (const id of Object.keys(agents)) {
    for (const deadId of goneThisTurn) {
      if (new RegExp(`${deadId}(?!\\d)`).test(agents[id].goal)) {
        agents[id].goal = `${deadId} is gone — re-evaluating.`;
        agents[id].mood = "calm";
        break;
      }
    }
  }
  const ateBy = new Map();
  for (const event of ecology) {
    if (event.type === "eat-agent") {
      if (!ateBy.has(event.predator)) ateBy.set(event.predator, []);
      ateBy.get(event.predator).push(event.prey);
    } else if (event.type === "eat-item") {
      if (!ateBy.has(event.agent)) ateBy.set(event.agent, []);
      ateBy.get(event.agent).push(event.item);
    }
  }
  for (const id of [...pass.takenAgents, ...pass.starvedThisTurn]) delete agents[id];
  for (const [eater, meals] of ateBy) {
    if (!agents[eater]) continue;
    agents[eater].goal = `just ate ${meals.join(" and ")}.`;
    agents[eater].mood = "happy";
  }
  // A prey the pass minted arrives after the movement loops built `agents`, so
  // without this it would be announced by its own turn's event and still be
  // invisible on the board until the next one.
  for (const arrival of pass.spawned) {
    if (arrival.isItem) continue;
    agents[arrival.id] = {
      role: arrival.role, cell: arrival.cell, facing: DEFAULT_FACING,
      goal: "just arrived — no goal yet.", mood: "calm", plan: [], mass: round2(arrival.mass), belief: {},
    };
  }

  const moodWrites = Object.keys(agents).sort()
    .map((id) => ({ subject: stamp(id), predicate: MOOD_PREDICATE, object: agents[id].mood }));

  const items = itemsPayload(liveItemIds, { state, itemCellOf, roles, taken: pass.takenItems });
  for (const arrival of pass.spawned) {
    if (!arrival.isItem) continue;
    items[arrival.id] = { kind: arrival.kind, cell: arrival.cell };
  }

  const turnMarker = { subject: stamp(BOARD_SUBJECT), predicate: TURN_PLAYED_PREDICATE, object: String(k) };
  const writes = [...movementWrites, ...pass.writes, ...moodWrites, turnMarker];
  await appendFacts(memoryDir, writes.map((f) => ({ ...f, provenance: `${worldProvenanceTag(lay.name)}:turn${k}` })));

  return {
    turn: k,
    epoch,
    agents: sortedByKey(agents),
    items: sortedByKey(items),
    ecology,
    rungs: sortedByKey(rungs),
    writes,
  };
}

const kindOfItem = (id, roles) =>
  (id.startsWith(`${roles.food.placedKind}-`) ? roles.food.placedKind : roles.food.spawnedKind);

const sortedByKey = (obj) => Object.fromEntries(Object.keys(obj).sort().map((key) => [key, obj[key]]));

/**
 * The board as it stands, in a tick's own render payload shape, without
 * running one: `{ turn, epoch, agents, items, ecology }`, folded straight out of
 * the stored facts.
 *
 * This is what a renderer draws between opening a session and the first tick.
 * Every field is read from state rather than decided: `cell`, `facing`, `mood`
 * and `mass` are whatever the last write left, `belief` is the engine's own
 * `beliefSnapshotFor` taken against the same candidate list a tick uses, and
 * `plan` is empty with `goal` blank because nobody has decided anything yet —
 * a resting board reports what is true, never a decision it has not made.
 * `ecology` is empty for the same reason: no pass has run.
 *
 * `turn` is the last tick actually played (0 on a fresh board), so a caller's
 * own turn counter can start from it.
 */
export async function townSquareBoard(memoryDir, {
  layout, toldFacts = [], config = DEFAULT_GAME_CONFIG.mudiii, roles = MUDIII_ROLES,
} = {}) {
  const lay = typeof layout === "string" ? TOWN_SQUARE_LAYOUTS[layout] : layout;
  if (!lay) throw new Error(`townSquareBoard: no such layout "${layout}"`);
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldTownSquareState(rows);
  const board = readLiveBoard(rows, state, { config, roles });

  const agents = {};
  const rostered = [
    ...board.predators.map((id) => [id, "predator"]),
    ...board.prey.map((id) => [id, "prey"]),
  ];
  for (const [id, role] of rostered) {
    const cell = state.placements.get(id).cell;
    const visionRadius = role === "predator" ? config.predatorVisionRadius : config.preyVisionRadius;
    const initialMass = role === "predator" ? config.predatorInitialMass : config.preyInitialMass;
    agents[id] = {
      role,
      cell,
      facing: state.facing.get(id)?.value ?? DEFAULT_FACING,
      goal: "",
      mood: state.mood.get(id)?.value ?? "calm",
      plan: [],
      mass: round2(state.mass.get(id)?.value ?? initialMass),
      belief: beliefSnapshotFor(id, parseCellId(cell), board.beliefCandidates, state, { visionRadius, toldFacts }),
    };
  }

  return {
    turn: state.tickCount,
    epoch: state.epoch,
    agents: sortedByKey(agents),
    items: sortedByKey(itemsPayload(board.liveItemIds, { state, itemCellOf: board.itemCellOf, roles })),
    ecology: [],
  };
}

/** The frozen render payload, projected off a tick result: exactly
 *  `{ turn, agents, items, ecology }` and nothing else. The engine's own extras
 *  (the decision rungs, the raw writes, the epoch) stay out of it, so what a
 *  renderer or a recorded fixture sees is one shape that changes only when the
 *  interface itself does. */
export function townSquareTickPayload(tick) {
  return { turn: tick.turn, agents: tick.agents, items: tick.items, ecology: tick.ecology };
}

export { isFoodId, isPropId };
