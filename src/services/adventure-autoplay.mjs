// adventure-autoplay.mjs — a sibling layer over adventure.mjs (never edited
// for this: this session's own in-flight rule-shape work owns that file)
// that plays a loaded world by itself: infer a goal from one generic marker
// fact, explore toward it, fetch it, and report an honest stall the moment no
// further move is justified. It is a CALLER of the existing command
// interpreter (adventureTurn), never a second one — every move it makes is
// the same plain command string a human types ("go north", "take letter"),
// executed through the identical turn a real chat session runs.
//
// The one hard constraint: auto-play only ever reasons over what it has
// actually seen. `exposedRoomIds` is the set of rooms this auto-play run has
// itself moved into (the opening room included from turn 0) — it is the sole
// caller making every move, so it always knows this, and threads the set
// forward turn to turn exactly like spider-fly.mjs threads its own agents
// shape. `exposedFacts` turns that set into the actual filtered view: a fact
// is exposed when its subject's CURRENT placement resolves into an exposed
// room, when the subject is the player, or when the fact IS the world's
// objective marker (told to the player unconditionally at turn 0, the same
// way the opening line's prose already is). A hidden object's reveal falls
// out of this automatically — no `mgx:hidden-in` special case is needed, the
// placement-resolution walk already returns null for anything still hidden.
//
// The objective marker is one new, generic world-pack fact,
// `{"subject":"letter","predicate":"mgx:is-objective","object":"true"}` —
// deliberately not hard-coded to any one world. A world that ships no such
// fact simply has nothing for this module to infer a goal toward.
import { findActionPath } from "../domain/planning.mjs";
import { loadMemory, readFactRows } from "../adapters/memory/core.mjs";
import { foldWorldState, adventureTurn, worldActionRows } from "./adventure.mjs";

const SNAPSHOT_RE = /^(.+)@turn(\d+)$/;
const baseSubjectOf = (subject) => SNAPSHOT_RE.exec(subject)?.[1] ?? subject;

const isTypedRow = (rows, subject, type) =>
  (rows || []).some((r) => r.subject === subject && r.predicate === "rdf:type" && r.object === type);

/** The room a subject's CURRENT placement resolves into — a room resolves to
 *  itself; an object placed directly in a room resolves to that room; an
 *  object one containment hop inside an OPEN container resolves to the
 *  container's own room; anything hidden, carried, or inside a closed
 *  container resolves to nothing (null). This mirrors adventure.mjs's own
 *  private `visibleRoomOf` exactly (that helper isn't exported, so the walk
 *  is re-derived here against the same `foldWorldState` placements map,
 *  never a second notion of visibility). */
function roomOfSubject(subject, rows, state) {
  if (isTypedRow(rows, subject, "room")) return subject;
  const place = state.placements.get(subject);
  if (!place || place.predicate === "mgx:hidden-in") return null;
  if (place.predicate === "mgx:currently-in" || isTypedRow(rows, place.object, "room")) return place.object;
  const holder = place.object;
  if (holder === "player") return null; // carried, not resolvable to a room
  if (!state.openness.get(holder)?.open) return null;
  const holderPlace = state.placements.get(holder);
  return holderPlace && holderPlace.predicate !== "mgx:hidden-in" ? holderPlace.object : null;
}

/**
 * The subset of `allRows` this auto-play run may reason over, given the
 * rooms it has actually moved into so far (`exposedRoomIds`). Pure — folds
 * `allRows` itself rather than taking a precomputed state, so a caller never
 * has to keep a fold in step with the exposure set by hand.
 */
export function exposedFacts(allRows, exposedRoomIds) {
  const rows = allRows || [];
  const state = foldWorldState(rows);
  const exposed = new Set(exposedRoomIds || []);
  return rows.filter((row) => {
    if (baseSubjectOf(row.subject) === "player") return true;
    if (row.predicate === "mgx:is-objective") return true;
    const room = roomOfSubject(baseSubjectOf(row.subject), rows, state);
    return room != null && exposed.has(room);
  });
}

/** One hop per exposed room's own has-exit-* facts, sorted by direction name
 *  for deterministic tie-breaking — the applyActions closure findActionPath
 *  needs, built from the EXPOSED fold only, so a search over this graph can
 *  never plan through an edge auto-play hasn't itself walked into. */
function exposedExitApplyActions(exposedState) {
  return (room) => {
    const dirs = exposedState.exits.get(room);
    if (!dirs) return [];
    return [...dirs.keys()].sort().map((direction) => ({ action: direction, nextState: dirs.get(direction) }));
  };
}

const unexposedExitsOf = (room, exposedState, exposed) =>
  [...(exposedState.exits.get(room)?.entries() ?? [])].filter(([, target]) => !exposed.has(target));

const carriedByPlayer = (state, thing) => {
  const place = state.placements.get(thing);
  return !!place && place.predicate === "mgx:located-in" && place.object === "player";
};

/** Every mgx:is-container subject whose OWN placement is exposed (the room
 *  holding it has been visited) — a container's presence and lock state are
 *  visible on sight, even though its CONTENTS stay hidden until it's actually
 *  opened. Sorted for deterministic tie-breaking across ticks. */
function exposedContainers(exposedRows, exposedState) {
  const ids = new Set(
    exposedRows.filter((r) => r.predicate === "mgx:is-container" && r.object === "true").map((r) => r.subject),
  );
  return [...ids].filter((id) => roomOfSubject(id, exposedRows, exposedState) != null).sort();
}

/** One tick's worth of progress toward standing in `targetRoom` and then
 *  issuing `finalCommand` once there — the same path-then-act shape the
 *  objective fetch above already uses, generalized so opening/unlocking a
 *  container and fetching the instrument that unlocks it can all reuse it
 *  rather than re-deriving the same findActionPath call three times. Returns
 *  null (never a stall) when no seen path exists yet, so the caller can fall
 *  through to try the next candidate instead of reporting a false stall. */
async function stepTowardThenAct({
  here, targetRoom, finalCommand, goalWhenArrived, goalWhenEnRoute, runCommand, exposedState, exposed, turnCount,
}) {
  if (targetRoom === here) {
    await runCommand(finalCommand);
    return { turn: turnCount + 1, goal: goalWhenArrived, plan: null, done: false, stalled: false, exposedRoomIds: exposed };
  }
  const path = findActionPath(here, (room) => room === targetRoom, exposedExitApplyActions(exposedState));
  if (!path || !path.actions.length) return null;
  await runCommand(`go ${path.actions[0]}`);
  exposed.add(path.states[1]);
  return { turn: turnCount + 1, goal: goalWhenEnRoute, plan: path.actions, done: false, stalled: false, exposedRoomIds: exposed };
}

/**
 * One auto-play tick over a live, loaded adventure: fold the world, infer a
 * goal from the one generic objective marker under the exposure constraint,
 * and execute exactly the one move that goal implies through `adventureTurn`
 * — the same public entry point a real chat turn calls. Returns
 * `{ turn, goal, plan, done, stalled, exposedRoomIds }`, mirroring
 * spider-fly.mjs's own tick shape: `plan` is the remaining multi-step route a
 * `findActionPath` search found this tick (or null when the move was a
 * single, immediate step — an adjacent unexposed exit, or a take), `goal` is
 * a short line describing what this tick did, `done` means the objective is
 * now carried, `stalled` means no move could be justified without guessing.
 */
export async function runAdventureAutoplayTick(memoryDir, opts = {}) {
  const { exposedRoomIds, planHolder, sessionId = "", env = {}, graph = null, cache = null } = opts;
  // Auto-play reasons over the game world only — the same isolation the manual
  // command path uses, so a fact the player taught mid-game never steers the
  // planner toward a room the world never placed anything in.
  const rows = worldActionRows(readFactRows(await loadMemory(memoryDir)));
  const state = foldWorldState(rows);
  const here = state.placements.get("player")?.object ?? null;
  const exposed = new Set(exposedRoomIds || []);

  if (!here) {
    return {
      turn: state.turnCount, goal: "stalled — no player position is written for this world.",
      plan: null, done: false, stalled: true, exposedRoomIds: exposed,
    };
  }
  exposed.add(here);

  const runCommand = (line) => adventureTurn(line, { planHolder, memoryDir, sessionId, env, graph, cache });

  const exposedRows = exposedFacts(rows, exposed);
  const exposedState = foldWorldState(exposedRows);
  const objectiveId = exposedRows.find((r) => r.predicate === "mgx:is-objective" && r.object === "true")?.subject ?? null;

  // Win: the objective is already carried — checked against the FULL fold,
  // since what the player itself carries is always self-evidently known,
  // the same unconditional "OR the subject is player" exposure the marker
  // fact itself gets (worldDigestRows shows carried items regardless of
  // room visibility too — carrying was never gated on being seen).
  const carried = objectiveId && carriedByPlayer(state, objectiveId);
  if (objectiveId && carried) {
    return {
      turn: state.turnCount, goal: `carrying the ${objectiveId} — the adventure is won.`,
      plan: [], done: true, stalled: false, exposedRoomIds: exposed,
    };
  }

  const objectiveRoom = objectiveId ? roomOfSubject(objectiveId, exposedRows, exposedState) : null;

  if (objectiveId && objectiveRoom) {
    if (objectiveRoom === here) {
      await runCommand(`take ${objectiveId}`);
      return {
        turn: state.turnCount + 1, goal: `in the ${here} — taking the ${objectiveId}.`,
        plan: null, done: false, stalled: false, exposedRoomIds: exposed,
      };
    }
    const path = findActionPath(here, (room) => room === objectiveRoom, exposedExitApplyActions(exposedState));
    if (!path || !path.actions.length) {
      return {
        turn: state.turnCount, goal: `stalled — no seen path from the ${here} to the ${objectiveRoom}.`,
        plan: null, done: false, stalled: true, exposedRoomIds: exposed,
      };
    }
    await runCommand(`go ${path.actions[0]}`);
    exposed.add(path.states[1]);
    return {
      turn: state.turnCount + 1, goal: `heading toward the ${objectiveRoom} for the ${objectiveId}.`,
      plan: path.actions, done: false, stalled: false, exposedRoomIds: exposed,
    };
  }

  // Progress a known container: the objective's own room is still unknown,
  // which — since a hidden object's placement fact never resolves to a room
  // while it stays hidden (roomOfSubject) — is exactly the state every world
  // with ANY hidden contents starts in, even once its container has been
  // walked right up to. A container's presence and lock state ARE exposed on
  // sight, though (they're facts about the container itself, not about what's
  // inside it), so this is the one place auto-play can act on something it
  // has genuinely seen rather than just wander further:
  //   - a container standing open already has nothing left to reveal — skip;
  //   - a LOCKED container whose instrument is both named (mgx:unlocks-with)
  //     and already carried: go unlock it;
  //   - a LOCKED container whose instrument's own room is known (exposed) but
  //     not yet carried: go fetch the instrument first;
  //   - an UNLOCKED, still-closed container: opening it can only ever reveal
  //     more (never a wrong guess), so go open it.
  // Every branch reuses the exact path-then-act shape the objective fetch
  // above already uses; falling through (no seen path, or nothing sound for
  // any exposed container) drops to the plain room-exploration below, exactly
  // as before this container-awareness existed.
  if (objectiveId && !objectiveRoom) {
    for (const containerId of exposedContainers(exposedRows, exposedState)) {
      if (exposedState.openness.get(containerId)?.open) continue;
      const containerRoom = roomOfSubject(containerId, exposedRows, exposedState);
      if (!containerRoom) continue;
      const locked = exposedState.placements.get(containerId)?.predicate === "mgx:stands-locked-in";
      if (locked) {
        const instrumentId = exposedRows.find((r) => r.subject === containerId && r.predicate === "mgx:unlocks-with")?.object ?? null;
        if (!instrumentId) continue; // this world names no instrument for it — nothing sound to try
        if (carriedByPlayer(state, instrumentId)) {
          const step = await stepTowardThenAct({
            here, targetRoom: containerRoom, finalCommand: `unlock ${containerId} with ${instrumentId}`,
            goalWhenArrived: `in the ${here} — unlocking the ${containerId} with the ${instrumentId}.`,
            goalWhenEnRoute: `heading toward the ${containerRoom} to unlock the ${containerId}.`,
            runCommand, exposedState, exposed, turnCount: state.turnCount,
          });
          if (step) return step;
          continue;
        }
        const instrumentRoom = roomOfSubject(instrumentId, exposedRows, exposedState);
        if (!instrumentRoom) continue; // the instrument's own location isn't known yet — nothing sound here
        const step = await stepTowardThenAct({
          here, targetRoom: instrumentRoom, finalCommand: `take ${instrumentId}`,
          goalWhenArrived: `in the ${instrumentRoom} — taking the ${instrumentId} to unlock the ${containerId} later.`,
          goalWhenEnRoute: `heading toward the ${instrumentRoom} for the ${instrumentId}.`,
          runCommand, exposedState, exposed, turnCount: state.turnCount,
        });
        if (step) return step;
        continue;
      }
      const step = await stepTowardThenAct({
        here, targetRoom: containerRoom, finalCommand: `open ${containerId}`,
        goalWhenArrived: `in the ${here} — opening the ${containerId} to see what's inside.`,
        goalWhenEnRoute: `heading toward the ${containerRoom} to open the ${containerId}.`,
        runCommand, exposedState, exposed, turnCount: state.turnCount,
      });
      if (step) return step;
    }
  }

  // Explore: the objective either doesn't exist in this world, or its room
  // isn't known yet. Prefer an immediate unexposed exit from here (the
  // lowest-sorted direction); otherwise path toward the nearest exposed room
  // that still has one.
  const unexposedHere = unexposedExitsOf(here, exposedState, exposed).sort(([a], [b]) => a.localeCompare(b));
  if (unexposedHere.length) {
    const [direction, target] = unexposedHere[0];
    await runCommand(`go ${direction}`);
    exposed.add(target);
    return {
      turn: state.turnCount + 1, goal: `exploring — heading ${direction} into unseen ground.`,
      plan: null, done: false, stalled: false, exposedRoomIds: exposed,
    };
  }

  const hasUnexposedExit = (room) => unexposedExitsOf(room, exposedState, exposed).length > 0;
  const path = findActionPath(here, hasUnexposedExit, exposedExitApplyActions(exposedState));
  if (!path || !path.actions.length) {
    return {
      turn: state.turnCount, goal: "stalled — every reachable room is already explored, and no goal was ever found.",
      plan: null, done: false, stalled: true, exposedRoomIds: exposed,
    };
  }
  await runCommand(`go ${path.actions[0]}`);
  exposed.add(path.states[1]);
  return {
    turn: state.turnCount + 1, goal: "exploring — backtracking toward unseen ground.",
    plan: path.actions, done: false, stalled: false, exposedRoomIds: exposed,
  };
}
