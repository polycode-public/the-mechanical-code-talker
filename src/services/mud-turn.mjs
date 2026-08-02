// mud-turn.mjs — one acting character's whole turn in a mud world: investigate
// the room it stands in, walk toward food it actually knows about, roll for
// digging out of the room's frontier, and (when none of that came to anything)
// set off for a room it has never stood in. The split mirrors predator-prey.mjs /
// spider-fly-turn.mjs: adventure.mjs owns the read/fold/write primitives, this
// file owns the per-tick decisions that drive them. Nothing here writes a fact
// of its own — every change goes out through runWorldCommand, recordTold,
// recordExamined or recordMassDrain.
//
// Every roll is seeded from (character, turn, room, decision name) through
// fnv1a32/mulberry32, so a run reproduces exactly from its inputs. The world
// layer writes no bare Math.random anywhere, and this file keeps that.
//
// Four things the design leaves open, settled here:
//
// A character moves once per turn. The directed walk, the edge rolls and the
// explore step draw on the same budget, in that order, so each only runs when
// the one before it came up empty. A walk that stepped reached the next room on
// a known path; it did not reach an edge.
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
//
// A turn that found nothing to do anywhere above ends on the explore step, and
// that step is a different claim from the food walk. It never guesses where
// food is. It reads which rooms this character has itself stood in — its own
// placement history, written turn by turn — and steps toward the nearest one it
// has not. "I have not been down there yet" is something an animal genuinely
// knows about itself, so acting on it invents nothing; without it a character
// that digs itself into a quiet corner stands there for the rest of the run.
//
// The two limits that make that stop being a treadmill live elsewhere:
// adventure.mjs bounds how far from the origin a dig may reach, so the set of
// rooms to explore is finite, and every turn charges mass. An animal really out
// of world eventually starves, which is an ending, not a freeze.

import { mulberry32 } from "../domain/seeded-random.mjs";
import { fnv1a32 } from "../domain/hash.mjs";
import { bfsLevels } from "../domain/planning.mjs";
import { loadMemory, readFactRows } from "../adapters/memory/core.mjs";
import { DEFAULT_GAME_CONFIG, mudMassDrainPerTurn } from "../domain/game-config.mjs";
import { predatorSubjects } from "../domain/mud-facts.mjs";
import {
  foldWorldState, worldActionRows, runWorldCommand, recordTold, recordExamined,
  recordMassDrain, personKnowledgeLines, objectClassChain, diggableDirections,
  isOutOfPlay, outOfPlayReasonOf, outOfPlayPhrase, massDrainPerTurnOf,
  parseSnapshotSubject, characterTestimonyTag,
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

/** The food a character knows about that is still somewhere it could be
 *  reached — on a floor, or in an open container. An eater's own claim about a
 *  carrot ages out the moment it eats it, but a claim only ever HEARD stands
 *  until somebody says otherwise, and that animal has no way to know the meal
 *  is over. Anything deciding where to GO reads this list rather than the raw
 *  one, or an animal spends the rest of the run crossing the burrow after
 *  somebody else's meal. */
const standingKnownFood = (rows, state, character) =>
  knownFood(rows, state, character).filter((thing) => visibleRoomOf(rows, state, thing) !== null);

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
 * `wanted` accepts, as `{ direction, room, hops }`. Null when nothing within
 * the search depth qualifies. Ties break on the room name, so a fork never
 * turns on fact-row order. Rooms in `avoid` are neither entered nor routed
 * through.
 */
function firstStepToward(state, here, wanted, avoid = new Set()) {
  const successorsOf = (room) => [...(state.exits.get(room)?.entries() ?? [])]
    .filter(([, target]) => !avoid.has(target))
    .map(([direction, target]) => ({ room: target, direction, from: room }));

  const cameFrom = new Map(); // room -> { via, from }
  let hops = 0;
  for (const level of bfsLevels(here, successorsOf, { maxDepth: WALK_SEARCH_DEPTH, keyOf: (item) => item.room })) {
    hops += 1;
    for (const item of level) cameFrom.set(item.room, { via: item.direction, from: item.from });
    const goal = level.map((item) => item.room).filter(wanted).sort()[0];
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

/**
 * The first step toward the nearest room holding a food-classed thing
 * `character` knows about. Null when the character knows of no food, or when
 * none of it sits in a room reachable within the search depth — the honest
 * "I don't know where any food is", never a fallback wander.
 */
function stepTowardKnownFood(rows, state, character, here) {
  const foodRooms = new Set(
    standingKnownFood(rows, state, character).map((thing) => visibleRoomOf(rows, state, thing)),
  );
  if (!foodRooms.size || foodRooms.has(here)) return null;
  return firstStepToward(state, here, (room) => foodRooms.has(room));
}

/** Every room `character` has itself stood in: its base placement and every
 *  @turnN snapshot of one, read over the world's OWN rows so a taught locative
 *  can never write a visit that never happened. */
function roomsStoodIn(rows, character) {
  const visited = new Set();
  for (const row of worldActionRows(rows)) {
    if (row.predicate !== "mgx:currently-in") continue;
    const snapshot = parseSnapshotSubject(row.subject);
    if ((snapshot ? snapshot.base : row.subject) !== character) continue;
    visited.add(row.object);
  }
  return visited;
}

/** Every room a predator is standing in. An animal with nothing better to do
 *  does not go and look into one: leaving them in would make the explore step a
 *  funnel straight to the den, since the unvisited room nearest the burrow is
 *  exactly where the fox lives. The den stays reachable by the food gamble
 *  below, which is a gamble and is meant to be. */
const predatorRooms = (rows, state) => new Set(predatorSubjects(rows)
  .map((subject) => state.placements.get(subject)?.object)
  .filter(Boolean));

/**
 * The first step toward the nearest room `character` has never stood in. This
 * is the one move that runs on the character's OWN history rather than on
 * anything it knows about the world's contents — it says "I have not been that
 * way yet", which is true whatever turns out to be there.
 */
function stepTowardUnvisitedRoom(rows, state, character, here) {
  const visited = roomsStoodIn(rows, character);
  return firstStepToward(state, here, (room) => !visited.has(room), predatorRooms(rows, state));
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
 * Returns `{ character, k, room, roomAfter, actions, learned, mass, text,
 * note }`. `actions` is the machine-readable spine — one entry per sub-step
 * that fired, each `{ step, kind, ..., text, miss }` — and a sub-step whose
 * precondition did not hold this turn records `kind: "none"` with its reason
 * rather than dropping out silently or being narrated as a success. `mass` is
 * what the character weighs once this turn's drain is charged, or null when the
 * world writes it no mass.
 *
 * A turn that ends the character's run also carries `outOfPlay: true` and
 * `outOfPlayReason` ("eaten" or "starved"), and so does every turn after it.
 *
 * `mudConfig` is the resolved `mud` section of the game config — the fallback
 * for the per-species mass drain a turn charges, used only when the world
 * itself writes the character no `mgx:mass-drain-per-turn` fact.
 */
export async function runMudTurn(character, {
  world, memoryDir, env, graph, cache, k = null, mudConfig = DEFAULT_GAME_CONFIG.mud,
} = {}) {
  const opened = await readWorld(memoryDir);
  const room = opened.state.placements.get(character)?.object ?? null;
  const turn = k ?? opened.state.turnCount + 1;
  // The run this turn belongs to, stamped onto the testimony it writes so a
  // recast's first turns outrank whatever the replaced run had to say.
  const epoch = opened.state.epoch;
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
    const reason = outOfPlayReasonOf(opened.state, character);
    return {
      character, k: turn, room: null, roomAfter: null, actions, learned: [],
      outOfPlay: true, outOfPlayReason: reason,
      text: `${outOfPlayPhrase(character, reason)}. It takes no more turns.`,
      note: `MUD — ${character} is placed out of play (${reason}); the turn is declined, and every later one will be too`,
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

  await investigateRoom({ character, turn, epoch, room, memoryDir, cache, actions, notes, runCommand, recordSkip });

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
    recordSkip("walk", walkSkipReason(walked.rows, walked.state, character), `the ${character} has nowhere it knows to walk to.`);
  }

  if (!moved) {
    const edge = await rollAtEdge({ character, turn, memoryDir, runCommand, recordSkip });
    if (!edge.acted) await exploreUnvisited({ character, memoryDir, runCommand, recordSkip });
  }

  // The world's own word first: a `mgx:mass-drain-per-turn` fact on the
  // character or its species is something a player can read and change, and the
  // shipped config table is only what a world that writes none falls back to.
  const writtenDrain = massDrainPerTurnOf(opened.rows, character);
  const drained = await recordMassDrain(memoryDir, {
    world,
    subject: character,
    drainPerTurn: writtenDrain === null ? mudMassDrainPerTurn(mudConfig, character) : writtenDrain,
    cache,
  });
  if (drained.mass === null) {
    notes.push(`MUD — mass: the world writes ${character} no mass, so a turn costs it nothing`);
  } else {
    notes.push(`MUD — mass: ${character} is down to ${drained.mass}${drained.starved ? " and starves" : ""}`);
  }

  const closed = await readWorld(memoryDir);
  const learned = [...knownTopics(closed.rows, closed.state, character)].filter((t) => !learnedBefore.has(t)).sort();
  const texts = actions.map((a) => a.text).filter(Boolean);
  if (drained.starved) texts.push(`the ${character} runs out of mass and starves. It takes no more turns.`);
  // Read off the closed world rather than off the drain alone: a character can
  // also end this turn eaten, by walking into the predator's room on it, and a
  // caller watching for a fate should not have to know which of the two ways it
  // was to find out that one happened.
  const fate = outOfPlayReasonOf(closed.state, character);
  return {
    character,
    k: turn,
    room,
    roomAfter: closed.state.placements.get(character)?.object ?? room,
    actions,
    learned,
    mass: drained.mass,
    ...(fate ? { outOfPlay: true, outOfPlayReason: fate } : {}),
    text: texts.join(" "),
    note: notes.join("; "),
  };
}

/** Why a turn's food walk took no step — three different situations, each
 *  named on its own terms rather than collapsed into one shrug. */
function walkSkipReason(rows, state, character) {
  if (!knownFood(rows, state, character).length) return "it knows of no food to walk toward";
  if (!standingKnownFood(rows, state, character).length) return "every food it knows about has already been eaten";
  return "no room it knows holds food is reachable from here";
}

/** The last move of a turn that found nothing else to do: one step toward the
 *  nearest room this character has never stood in. Reached only when the walk
 *  took no step and the edge rolls fired nothing, so it never competes for the
 *  move budget — and when every room within reach has already been walked, it
 *  says so and the character stands still. */
async function exploreUnvisited({ character, memoryDir, runCommand, recordSkip }) {
  const { rows, state } = await readWorld(memoryDir);
  const here = state.placements.get(character)?.object ?? null;
  if (!here) return recordSkip("explore", "it has no position to set out from", "");
  const step = stepTowardUnvisitedRoom(rows, state, character, here);
  if (!step) {
    return recordSkip(
      "explore",
      "it has already stood in every room it can reach",
      `the ${character} has been everywhere this burrow goes.`,
    );
  }
  return runCommand("explore", { pattern: "imperative", verb: "go", direction: step.direction }, {
    direction: step.direction, toward: step.room, hops: step.hops, reason: "unvisited",
  });
}

/** Step one: talk to a room-mate, examine something unexamined, then make one
 *  seeded attempt at take/put/eat. Talking comes first, and an animal speaks
 *  to a room-mate it has not met yet or that has food news for it. Once a
 *  partner has neither, this one has nothing left to say and spends the step
 *  on the room instead — two animals that stay put would otherwise trade the
 *  same empty greeting every turn for the rest of the run. The talk and the
 *  examine write testimony, which never folds into the playable state; only
 *  the manipulation touches the world. */
async function investigateRoom({ character, turn, epoch = 0, room, memoryDir, cache, recordSkip, runCommand, actions, notes }) {
  const { rows, state } = await readWorld(memoryDir);
  const roomMates = castIn(state, room, character);
  const alreadyKnown = knownTopics(rows, state, character);
  const foodNewsFrom = (mate) => knownFood(rows, state, mate).filter((thing) => !alreadyKnown.has(thing));
  const worthSpeakingTo = roomMates.filter((mate) => !alreadyKnown.has(mate) || foodNewsFrom(mate).length);

  const teller = pickSeeded(worthSpeakingTo, character, turn, room, "ask-who");
  if (!teller) {
    recordSkip(
      "investigate",
      roomMates.length
        ? `the ${character} has already heard everything the animals standing here can tell it about food`
        : "no other character stands here to ask",
      "",
    );
  } else {
    const told = pickSeeded(foodNewsFrom(teller), character, turn, room, `ask-${teller}`);
    // Speaking to an animal is how this one comes to know it, and that note is
    // the whole escape from the loop: a pair with no news left for each other
    // drops out of worthSpeakingTo, and drops back in the moment either side
    // learns a food the other has not heard of.
    if (!alreadyKnown.has(teller)) {
      await recordExamined(memoryDir, { observer: character, thing: teller, k: turn, epoch, cache });
      alreadyKnown.add(teller);
    }
    if (!told) {
      // Still a real exchange, and still narrated as one: an animal that meets
      // another animal always says something. Only the testimony is missing,
      // because the teller had nothing this one didn't already know.
      actions.push({
        step: "investigate", kind: "ask", teller, thing: null, miss: false,
        text: `the ${character} greets the ${teller}, but hears nothing new about food.`,
      });
      notes.push(`MUD — talk: ${character} greeted ${teller}; ${teller} knows of no food to share`);
    } else {
      await recordTold(memoryDir, { asker: character, teller, thing: told, k: turn, epoch, cache });
      alreadyKnown.add(told);
      actions.push({
        step: "investigate", kind: "ask", teller, thing: told, miss: false,
        text: `the ${character} asks the ${teller} about food, and hears about the ${told}.`,
      });
      notes.push(`MUD — ask: ${teller} told ${character} about ${told}; written as ${characterTestimonyTag(teller, turn, { epoch })}`);
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
    await recordExamined(memoryDir, { observer: character, thing: examined, k: turn, epoch, cache });
    alreadyKnown.add(examined);
    actions.push({
      step: "investigate", kind: "examine", thing: examined, miss: false,
      text: `the ${character} examines the ${examined}.`,
    });
    notes.push(`MUD — examine: ${character} looked at ${examined}; written as ${characterTestimonyTag(character, turn, { epoch })}`);
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

  // Everything the take verb would really accept here: loose on the floor, or
  // sitting in an open container standing in this room. Reading only the floor
  // made putting something into the basket a one-way trip, and in a room whose
  // only food went into the basket that left nothing to take and nothing to
  // eat for the rest of the run.
  const withinReach = [...state.placements]
    .filter(([, place]) => place.predicate === "mgx:located-in")
    .map(([thing]) => thing)
    .filter((thing) => visibleRoomOf(rows, state, thing) === room)
    .sort();
  const carried = [...state.placements]
    .filter(([, place]) => place.predicate === "mgx:located-in" && place.object === character)
    .map(([thing]) => thing)
    .sort();

  if (chosen === "take") {
    const target = pickSeeded(withinReach, character, turn, room, "take-what");
    if (!target) return recordSkip("investigate", "nothing here it could pick up", "");
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

  const edible = [...new Set([...withinReach, ...carried])].filter((thing) => isFood(rows, thing)).sort();
  const target = pickSeeded(edible, character, turn, room, "eat-what");
  if (!target) return recordSkip("investigate", "no food is within reach here", "");
  return runCommand("investigate", { pattern: "imperative", verb: "eat", object: target }, { object: target });
}

/** Step three: the room's unexplored sides, one independent roll per reason
 *  per direction. Only reached on a turn whose walk took no step, so the move
 *  budget is still unspent. Reports `{ acted }` — whether a roll actually came
 *  up — so the caller knows whether the turn still has a move to spend. */
async function rollAtEdge({ character, turn, memoryDir, runCommand, recordSkip }) {
  const { rows, state } = await readWorld(memoryDir);
  const room = state.placements.get(character)?.object ?? null;
  if (!room) {
    recordSkip("edge", "it has no position to roll from", "");
    return { acted: false };
  }

  // The exit gamble runs before the dig rolls and whether or not this room can
  // still be dug at all. A room mapped on every side its kind allows is
  // exactly where a character with food somewhere else has nothing left but
  // its existing exits to gamble on, so gating it behind a diggable direction
  // stranded animals in a finished room for the rest of the run.
  const foodItKnows = standingKnownFood(rows, state, character);
  const foodStandsHere = foodItKnows.some((thing) => visibleRoomOf(rows, state, thing) === room);
  if (foodItKnows.length && !foodStandsHere) {
    for (const direction of [...(state.exits.get(room)?.keys() ?? [])].sort()) {
      if (rollFor(character, turn, room, `exit-${direction}`) >= EXIT_TOWARD_FOOD_CHANCE) continue;
      await runCommand("edge", { pattern: "imperative", verb: "go", direction }, { direction, reason: "exit-toward-food" });
      return { acted: true };
    }
  }

  // The room's OWN kind decides which way a dig can go — there is nothing to
  // tunnel sideways through above ground, the burrow runs one level deep, and
  // past the world's dig boundary nothing is offered at all — so the candidate
  // set is the dig verb's own, never a flat compass. A roll on a direction the
  // verb would refuse spends the turn on a decline.
  const edges = diggableDirections(rows, state, room);
  if (!edges.length) {
    recordSkip("edge", `there is nowhere left to dig from the ${room}`, "");
    return { acted: false };
  }

  for (const direction of edges.filter((d) => LATERAL_DIRECTIONS.includes(d))) {
    if (rollFor(character, turn, room, `edge-follow-${direction}`) >= EDGE_FOLLOW_DIG_CHANCE) continue;
    await runCommand("edge", { pattern: "imperative", verb: "dig", direction }, { direction, reason: "edge-follow" });
    return { acted: true };
  }

  for (const direction of edges) {
    if (rollFor(character, turn, room, `dig-${direction}`) >= EXPLORATORY_DIG_CHANCE) continue;
    await runCommand("edge", { pattern: "imperative", verb: "dig", direction }, { direction, reason: "explore" });
    return { acted: true };
  }

  recordSkip("edge", `no roll came up at the ${room}'s edge`, "");
  return { acted: false };
}
