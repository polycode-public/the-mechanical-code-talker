// mud-turn.mjs — one acting character's whole turn in a mud world: investigate
// the room it stands in, walk toward food it actually knows about, and (only
// when that walk has nowhere to go) roll for digging out of the room's
// frontier. The split mirrors spider-fly.mjs / spider-fly-turn.mjs: adventure
// .mjs owns the read/fold/write primitives, this file owns the per-tick
// decisions that drive them. Nothing here writes a fact of its own — every
// change goes out through runWorldCommand, recordTold or recordExamined.
//
// Every roll is seeded from (character, turn, room, decision name) through
// fnv1a32/mulberry32, so a run reproduces exactly from its inputs. The world
// layer writes no bare Math.random anywhere, and this file keeps that.
//
// Three things the design leaves open, settled here:
//
// A character moves once per turn. The directed walk and the edge rolls draw
// on the same budget, so the edge rolls only run when the walk found nowhere
// to go. A walk that stepped reached the next room on a known path; it did not
// reach an edge.
//
// There are two separate reasons to dig — plain exploration, and following
// the level's own frontier toward food — and both cash out as a dig. They are
// kept apart by candidate set. The first ranges over every direction the
// room's kind allows and no exit already covers, vertical ones included. The
// second ranges over the lateral part of that same set: the frontier of the
// level the character already stands on. So a lateral direction draws two
// independent rolls and gets dug more often than a vertical one.
//
// The exit roll is motivated by food, so it needs food to be motivated by. It
// runs only when the character knows about some food but has no path to it —
// the one case where an exit is worth a gamble and the walk still had nothing
// to follow. A character that knows about no food at all rolls nothing: that
// silence is the honest miss, and it holds all the way down.

import { mulberry32 } from "../domain/seeded-random.mjs";
import { fnv1a32 } from "../domain/hash.mjs";
import { bfsLevels } from "../domain/planning.mjs";
import { loadMemory, readFactRows } from "../adapters/memory/core.mjs";
import {
  foldWorldState, worldActionRows, runWorldCommand, recordTold, recordExamined,
  personKnowledgeLines, objectClassChain, diggableDirections, isOutOfPlay,
} from "./adventure.mjs";

const FOOD_CLASS = "food";
const LATERAL_DIRECTIONS = ["north", "south", "east", "west"];
// Deep enough to cross a whole burrow without letting one character's
// pathfinder walk a whole grown world every tick.
const WALK_SEARCH_DEPTH = 8;

const EXIT_TOWARD_FOOD_CHANCE = 0.5;
const EDGE_FOLLOW_DIG_CHANCE = 0.25;
const EXPLORATORY_DIG_CHANCE = 0.1;

const MANIPULATIONS = ["take", "put", "eat"];

// ---- seeded decisions --------------------------------------------------------

/** One roll in [0,1) for one decision, reproducible from the four things that
 *  identify it. Two characters deciding the same thing in the same room on the
 *  same turn get different numbers; the same character re-run gets the same
 *  one. */
const rollFor = (character, k, room, decision) =>
  mulberry32(fnv1a32(`${character}:${k}:${room}:${decision}`))();

/** The item a seeded roll selects out of `items`, or null when there is
 *  nothing to select. Callers sort their candidates first, so the choice does
 *  not ride on fact-row order. */
function pickSeeded(items, character, k, room, decision) {
  if (!items.length) return null;
  return items[Math.floor(rollFor(character, k, room, decision) * items.length)];
}

// ---- world reads -------------------------------------------------------------

async function readWorld(memoryDir) {
  const rows = readFactRows(await loadMemory(memoryDir));
  return { rows, state: foldWorldState(worldActionRows(rows)) };
}

const isTyped = (rows, subject, type) =>
  (rows || []).some((r) => r.subject === subject && r.predicate === "rdf:type" && r.object === type);

const isContainer = (rows, subject) =>
  (rows || []).some((r) => r.subject === subject && r.predicate === "mgx:is-container" && r.object === "true");

/** The room a thing is on show in, mirroring the presence check every
 *  adventure verb already applies. adventure.mjs keeps its own copy private,
 *  and this file may not reach into it, so the rule is restated rather than
 *  approximated: a decision made on a looser notion of "present" would pick
 *  actions the verbs then refuse. */
function visibleRoomOf(rows, state, thing) {
  const place = state.placements.get(thing);
  if (!place || place.predicate === "mgx:hidden-in") return null;
  if (place.predicate === "mgx:currently-in" || isTyped(rows, place.object, "room")) return place.object;
  const holder = place.object;
  if (!isContainer(rows, holder)) return null; // a character is carrying it
  if (!state.openness.get(holder)?.open) return null;
  const holderPlace = state.placements.get(holder);
  return holderPlace && holderPlace.predicate !== "mgx:hidden-in" ? holderPlace.object : null;
}

const carriedBy = (state, thing, holder) => {
  const place = state.placements.get(thing);
  return !!place && place.predicate === "mgx:located-in" && place.object === holder;
};

const isFood = (rows, thing) => objectClassChain(rows, thing).includes(FOOD_CLASS);

/** What `character` currently knows about, food only — the durable
 *  knows-about facts recordTold/recordExamined leave behind, read over the
 *  FULL rows because testimony is deliberately filtered out of the state
 *  fold. */
function knownFood(rows, state, character) {
  const { aboutTopics } = personKnowledgeLines(rows, state, character);
  return [...new Set(aboutTopics)].filter((thing) => isFood(rows, thing)).sort();
}

const knownTopics = (rows, state, character) =>
  new Set(personKnowledgeLines(rows, state, character).aboutTopics);

/** The cast standing in `room`: the world places its characters with
 *  currently-in and its props every other way, so that predicate is the whole
 *  test. Discovered from the fold rather than handed in, so a caller can never
 *  hand this turn a room-mate that has already walked off. */
const castIn = (state, room, exclude) => [...state.placements]
  .filter(([subject, place]) => subject !== exclude && place.predicate === "mgx:currently-in" && place.object === room)
  .map(([subject]) => subject)
  .sort();

// ---- the directed walk -------------------------------------------------------

/**
 * The first step of a shortest room-graph path from `here` to the nearest room
 * holding a food-classed thing `character` knows about, as
 * `{ direction, room, hops }`. Null when the character knows of no food, or
 * when none of it sits in a room reachable within the search depth — the
 * honest "I don't know where any food is", never a fallback wander.
 */
function stepTowardKnownFood(rows, state, character, here) {
  const foodRooms = new Set(
    knownFood(rows, state, character)
      .map((thing) => visibleRoomOf(rows, state, thing))
      .filter(Boolean),
  );
  if (!foodRooms.size || foodRooms.has(here)) return null;

  const successorsOf = (room) => [...(state.exits.get(room)?.entries() ?? [])]
    .map(([direction, target]) => ({ room: target, direction, from: room }));

  const cameFrom = new Map(); // room -> { via, from }
  let hops = 0;
  for (const level of bfsLevels(here, successorsOf, { maxDepth: WALK_SEARCH_DEPTH, keyOf: (item) => item.room })) {
    hops += 1;
    for (const item of level) cameFrom.set(item.room, { via: item.direction, from: item.from });
    const goal = level.map((item) => item.room).filter((room) => foodRooms.has(room)).sort()[0];
    if (!goal) continue;
    let room = goal;
    let firstStep = null;
    while (room !== here) {
      const trail = cameFrom.get(room);
      if (!trail) return null;
      firstStep = trail.via;
      room = trail.from;
    }
    return firstStep ? { direction: firstStep, room: goal, hops } : null;
  }
  return null;
}

// ---- the turn ----------------------------------------------------------------

/**
 * Run one acting character's whole turn against a live mud world.
 *
 * `k` is the turn ordinal the caller drives (it tags the testimony this turn
 * writes and seeds this turn's rolls); it defaults to the world's own next
 * turn. Room-mates are discovered from the fold, so the caller passes no cast
 * list.
 *
 * Returns `{ character, k, room, roomAfter, actions, learned, text, note }`.
 * `actions` is the machine-readable spine — one entry per sub-step that fired,
 * each `{ step, kind, ..., text, miss }` — and a sub-step whose precondition
 * did not hold this turn records `kind: "none"` with its reason rather than
 * dropping out silently or being narrated as a success.
 */
export async function runMudTurn(character, { world, memoryDir, env, graph, cache, k = null } = {}) {
  const opened = await readWorld(memoryDir);
  const room = opened.state.placements.get(character)?.object ?? null;
  const turn = k ?? opened.state.turnCount + 1;
  const actions = [];
  const notes = [];
  const learnedBefore = knownTopics(opened.rows, opened.state, character);

  if (!room) {
    return {
      character, k: turn, room: null, roomAfter: null, actions, learned: [],
      text: `the ${character} has no written position in this world.`,
      note: `MUD — ${character} has no placement fact; the turn is declined rather than guessed`,
    };
  }
  if (isOutOfPlay(opened.state, character)) {
    return {
      character, k: turn, room: null, roomAfter: null, actions, learned: [], outOfPlay: true,
      text: `the ${character} has been eaten. It takes no more turns.`,
      note: `MUD — ${character} is placed out of play; the turn is declined, and every later one will be too`,
    };
  }

  const commandContext = { world, memoryDir, env, graph, cache, actingSubject: character };
  const runCommand = async (step, cmd, detail) => {
    const res = await runWorldCommand(cmd, commandContext);
    actions.push({ step, kind: cmd.verb, ...detail, text: res.text, miss: !!res.miss });
    notes.push(res.note);
    return res;
  };
  const recordSkip = (step, reason, text) => {
    actions.push({ step, kind: "none", reason, text, miss: false });
    notes.push(`MUD — ${step}: ${reason}`);
  };

  await investigateRoom({ character, turn, room, memoryDir, cache, actions, notes, runCommand, recordSkip });

  const walked = await readWorld(memoryDir);
  const walkedRoom = walked.state.placements.get(character)?.object ?? room;
  const step = stepTowardKnownFood(walked.rows, walked.state, character, walkedRoom);
  let moved = false;
  if (step) {
    const res = await runCommand("walk", { pattern: "imperative", verb: "go", direction: step.direction }, {
      direction: step.direction, toward: step.room, hops: step.hops,
    });
    moved = !res.miss;
  } else {
    recordSkip(
      "walk",
      knownFood(walked.rows, walked.state, character).length
        ? "no room it knows holds food is reachable from here"
        : "it knows of no food to walk toward",
      `the ${character} has nowhere it knows to walk to.`,
    );
  }

  if (!moved) {
    await rollAtEdge({ character, turn, memoryDir, runCommand, recordSkip });
  }

  const closed = await readWorld(memoryDir);
  const learned = [...knownTopics(closed.rows, closed.state, character)].filter((t) => !learnedBefore.has(t)).sort();
  return {
    character,
    k: turn,
    room,
    roomAfter: closed.state.placements.get(character)?.object ?? room,
    actions,
    learned,
    text: actions.map((a) => a.text).filter(Boolean).join(" "),
    note: notes.join("; "),
  };
}

/** Step one: talk to a room-mate, examine something unexamined, then make one
 *  seeded attempt at take/put/eat. Talking comes first and always happens when
 *  anyone else is standing here — two animals in one room greet each other,
 *  and only what they had to SAY varies. The talk and the examine write
 *  testimony, which never folds into the playable state; only the
 *  manipulation touches the world. */
async function investigateRoom({ character, turn, room, memoryDir, cache, recordSkip, runCommand, actions, notes }) {
  const { rows, state } = await readWorld(memoryDir);
  const roomMates = castIn(state, room, character);
  const alreadyKnown = knownTopics(rows, state, character);

  const teller = pickSeeded(roomMates, character, turn, room, "ask-who");
  if (!teller) {
    recordSkip("investigate", "no other character stands here to ask", "");
  } else {
    const tellerFood = knownFood(rows, state, teller);
    const offers = tellerFood.filter((thing) => !alreadyKnown.has(thing));
    const told = pickSeeded(offers, character, turn, room, `ask-${teller}`);
    if (!told) {
      // Still a real exchange, and still narrated as one: an animal that meets
      // another animal always says something. Only the testimony is missing,
      // because the teller had nothing this one didn't already know.
      actions.push({
        step: "investigate", kind: "ask", teller, thing: null, miss: false,
        text: `the ${character} greets the ${teller}, but hears nothing new about food.`,
      });
      notes.push(`MUD — talk: ${character} greeted ${teller}; ${tellerFood.length
        ? `${character} already knows every food ${teller} could name`
        : `${teller} knows of no food to share`}`);
    } else {
      await recordTold(memoryDir, { asker: character, teller, thing: told, k: turn, cache });
      alreadyKnown.add(told);
      actions.push({
        step: "investigate", kind: "ask", teller, thing: told, miss: false,
        text: `the ${character} asks the ${teller} about food, and hears about the ${told}.`,
      });
      notes.push(`MUD — ask: ${teller} told ${character} about ${told}; written as mud:${teller}:turn${turn}`);
    }
  }

  const unexamined = [...state.placements.keys()]
    .filter((thing) => thing !== character && !alreadyKnown.has(thing))
    .filter((thing) => state.placements.get(thing).predicate !== "mgx:currently-in")
    .filter((thing) => visibleRoomOf(rows, state, thing) === room)
    .sort();
  const examined = pickSeeded(unexamined, character, turn, room, "examine");
  if (!examined) {
    recordSkip("investigate", "nothing unexamined stands here", "");
  } else {
    await recordExamined(memoryDir, { observer: character, thing: examined, k: turn, cache });
    alreadyKnown.add(examined);
    actions.push({
      step: "investigate", kind: "examine", thing: examined, miss: false,
      text: `the ${character} examines the ${examined}.`,
    });
    notes.push(`MUD — examine: ${character} looked at ${examined}; written as mud:${character}:turn${turn}`);
  }

  await manipulateSomething({ character, turn, room, memoryDir, runCommand, recordSkip });
}

/** Step one's last move: one of take, put or eat, chosen by a seeded roll. A
 *  roll that lands on something the room cannot offer this turn is a plain
 *  no-op — the alternative would be narrating an action that never happened.
 *  The hunger gate itself stays with the eat verb, which owns it. */
async function manipulateSomething({ character, turn, room, memoryDir, runCommand, recordSkip }) {
  const { rows, state } = await readWorld(memoryDir);
  const chosen = MANIPULATIONS[Math.floor(rollFor(character, turn, room, "manipulate") * MANIPULATIONS.length)];

  const looseHere = [...state.placements]
    .filter(([, place]) => place.predicate === "mgx:located-in" && place.object === room)
    .map(([thing]) => thing)
    .sort();
  const carried = [...state.placements]
    .filter(([, place]) => place.predicate === "mgx:located-in" && place.object === character)
    .map(([thing]) => thing)
    .sort();

  if (chosen === "take") {
    const target = pickSeeded(looseHere, character, turn, room, "take-what");
    if (!target) return recordSkip("investigate", "nothing loose here to take", "");
    return runCommand("investigate", { pattern: "imperative", verb: "take", object: target }, { object: target });
  }

  if (chosen === "put") {
    const containers = [...state.placements.keys()]
      .filter((thing) => isContainer(rows, thing))
      .filter((thing) => state.openness.get(thing)?.open)
      .filter((thing) => visibleRoomOf(rows, state, thing) === room)
      .sort();
    const target = pickSeeded(carried, character, turn, room, "put-what");
    const container = pickSeeded(containers, character, turn, room, "put-where");
    if (!target || !container) {
      return recordSkip("investigate", carried.length ? "no open container stands here" : "it carries nothing to put down", "");
    }
    return runCommand(
      "investigate",
      { pattern: "imperative", verb: "put", object: target, indirectObject: container },
      { object: target, indirectObject: container },
    );
  }

  const edible = [...new Set([...looseHere, ...carried])].filter((thing) => isFood(rows, thing)).sort();
  const target = pickSeeded(edible, character, turn, room, "eat-what");
  if (!target) return recordSkip("investigate", "no food is within reach here", "");
  return runCommand("investigate", { pattern: "imperative", verb: "eat", object: target }, { object: target });
}

/** Step three: the room's unexplored sides, one independent roll per reason
 *  per direction. Only reached on a turn whose walk took no step, so the move
 *  budget is still unspent. */
async function rollAtEdge({ character, turn, memoryDir, runCommand, recordSkip }) {
  const { rows, state } = await readWorld(memoryDir);
  const room = state.placements.get(character)?.object ?? null;
  if (!room) return recordSkip("edge", "it has no position to roll from", "");
  // The room's OWN kind decides which way a dig can go — there is nothing to
  // tunnel sideways through above ground, and the burrow runs one level deep
  // — so the candidate set is the dig verb's own, never a flat compass. A
  // roll on a direction the verb would refuse spends the turn on a decline.
  const edges = diggableDirections(rows, state, room);
  if (!edges.length) return recordSkip("edge", `there is nowhere left to dig from the ${room}`, "");

  const foodItKnows = knownFood(rows, state, character);
  const foodStandsHere = foodItKnows.some((thing) => visibleRoomOf(rows, state, thing) === room);
  if (foodItKnows.length && !foodStandsHere) {
    for (const direction of [...(state.exits.get(room)?.keys() ?? [])].sort()) {
      if (rollFor(character, turn, room, `exit-${direction}`) >= EXIT_TOWARD_FOOD_CHANCE) continue;
      return runCommand("edge", { pattern: "imperative", verb: "go", direction }, { direction, reason: "exit-toward-food" });
    }
  }

  for (const direction of edges.filter((d) => LATERAL_DIRECTIONS.includes(d))) {
    if (rollFor(character, turn, room, `edge-follow-${direction}`) >= EDGE_FOLLOW_DIG_CHANCE) continue;
    return runCommand("edge", { pattern: "imperative", verb: "dig", direction }, { direction, reason: "edge-follow" });
  }

  for (const direction of edges) {
    if (rollFor(character, turn, room, `dig-${direction}`) >= EXPLORATORY_DIG_CHANCE) continue;
    return runCommand("edge", { pattern: "imperative", verb: "dig", direction }, { direction, reason: "explore" });
  }

  return recordSkip("edge", `no roll came up at the ${room}'s edge`, "");
}
