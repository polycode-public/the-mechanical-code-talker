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
import { foldWorldState, adventureTurn } from "./adventure.mjs";

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
  const rows = readFactRows(await loadMemory(memoryDir));
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
  const carried = objectiveId
    && state.placements.get(objectiveId)?.predicate === "mgx:located-in"
    && state.placements.get(objectiveId)?.object === "player";
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
