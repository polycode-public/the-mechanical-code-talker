// adventure.mjs — the chat adventure lane: loading a shipped game world into
// the session's memory store and (once one is live) playing it. The world is
// data all the way down: its rooms, exits, objects and cast arrive as fact
// rows from the worlds pack (src/adapters/corpus/worlds-pack.mjs), its verbs
// as pre-built action-Rule families, and this module never hardcodes a
// particular world. The lane's state on the shared session plan slot is one
// tagged sub-object ({ adventure: { world } }), mirroring the guess-number
// game's { game } payload, so a plan, a number game and an adventure never
// share the slot.

import { worldProvenanceTag } from "../domain/worlds-pack.mjs";
import { classChainOf } from "../domain/agent-traits.mjs";
import { parseSnapshotSubject, snapshotSubject } from "../domain/world-snapshot.mjs";
import { parseImperative, OBJECT_PRONOUNS } from "../domain/grammar/ace.mjs";
import { loadLexicon, withProperNames, classify } from "../domain/grammar/lexicon.mjs";
import { register as registerReferent, bind as bindDiscourseForm } from "../domain/discourse.mjs";
import { createCompletionsGraphAdapter } from "../domain/completions/graph-adapter.mjs";
import { actionFamilies } from "../domain/router/taught.mjs";
import { declaredGoals, recognizeGoal, traceOfWorldRows } from "../domain/router/recognize.mjs";
import { compileDomain, precondHolds, roleBinding } from "../domain/domain.mjs";
import { getWorldsPackProvider } from "../adapters/corpus/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, normFactTerm, readFactRows, readRuleRows } from "../adapters/memory/core.mjs";
import { COMPLETIONS_STORE, generateCompletion } from "./completions.mjs";
import { parseEditorLine, planTaughtTriple } from "./adventure-editor.mjs";
import { parseMudEditorLine, planTaughtMudTriple } from "./mud-editor.mjs";
import { worldTeachTurn } from "./world-teach.mjs";
import { expandWorldGoal } from "./adventure-autoplay.mjs";

// ---- recognizers: the closed opening/stop set --------------------------------

// The generic opener names the adventure without naming a world ("start the
// adventure", "play the adventure game") — it loads the pack's only world,
// or asks which when there are several.
const ADVENTURE_GENERIC_OPEN_RE =
  /^(?:let'?s\s+)?(?:play|start|begin)\s+(?:the\s+|an?\s+)?(?:text\s+)?adventure(?:\s+game)?[.!?\s]*$/i;
// The named opener ("play ashcombe hall"). "play" only — "start <anything>"
// would hijack ordinary requests. The captured name is checked against the
// pack's own index downstream; an unknown name gets an honest decline that
// lists the worlds the pack actually has.
const ADVENTURE_NAMED_OPEN_RE = /^(?:let'?s\s+play|play)\s+(?:the\s+)?([a-z][a-z' -]*[a-z])\s*[.!?]*$/i;
const ADVENTURE_STOP_RE =
  /^(?:stop\s+playing|quit\s+(?:the\s+)?(?:game|adventure)|stop\s+(?:the\s+)?(?:game|adventure)|end\s+the\s+adventure|leave\s+the\s+game)[.!?\s]*$/i;

const worldNameOf = (spoken) => String(spoken || "").trim().toLowerCase().replace(/['.!?]/g, "").replace(/[\s-]+/g, "-");
const spokenNameOf = (worldName) => String(worldName || "").replace(/-/g, " ");

/** An adventure opening move — { world } (null world = the generic opener) —
 *  or null when the line is not one. Shape-only; the pack is consulted by
 *  the lane, not here. */
export function matchAdventureOpening(line) {
  const l = String(line).trim();
  if (ADVENTURE_GENERIC_OPEN_RE.test(l)) return { world: null };
  const named = l.match(ADVENTURE_NAMED_OPEN_RE);
  if (named) return { world: worldNameOf(named[1]) };
  return null;
}

// ---- the opening turn: pull the world through the provider -------------------

const missingPackAnswer = () => ({
  text: 'no worlds pack here — game worlds ship in corpus/worlds/ (or the directory TMCT_WORLDS_PACK_DIR names), and that pack is missing or unreadable, so there is no world to load.',
  lane: "game-inform",
  note: "ADVENTURE — opening declined: the worlds pack is absent/unreadable",
});

async function openAdventure(opening, { planHolder, memoryDir, sessionId, env, cache }) {
  if (!memoryDir) {
    return {
      text: "an adventure needs a session with a memory store to hold the world — start tmct inside a repo first.",
      lane: "game-inform",
      note: "ADVENTURE — opening declined: no memory store to load the world into",
    };
  }
  const provider = getWorldsPackProvider(env);
  let names = null;
  try { names = await provider.list(); } catch { names = null; }
  if (!names || !names.length) return missingPackAnswer();

  let world = opening.world;
  if (!world) {
    if (names.length > 1) {
      return {
        text: `which world? The pack has: ${names.map(spokenNameOf).join(", ")}. Say "play ${spokenNameOf(names[0])}".`,
        lane: "game-inform",
        note: "ADVENTURE — the generic opener with several worlds shipped; asked which, never guessed",
      };
    }
    world = names[0];
  } else if (!names.includes(world)) {
    // An unknown "play X" is not necessarily an adventure ask at all ("play
    // spider" is spider-fly's own opener, not a broken adventure request) —
    // fall through so a sibling game's opener keeps first refusal.
    // unclaimedAdventureOpening below is chat's LAST-RESORT check: once
    // every "play X" lane (this one included) has had its turn and none
    // claimed the line, THAT'S when an unrecognized name gets named and
    // declined honestly, never silently.
    return null;
  }

  let payload = null;
  try { payload = await provider.load(world); } catch { payload = null; }
  if (!payload) {
    return {
      text: `the worlds pack lists "${spokenNameOf(world)}" but its shard is missing or unreadable — rebuild the pack with \`npm run gen:worlds-pack\`.`,
      lane: "game-inform",
      note: "ADVENTURE — opening declined: the world's shard failed to load",
    };
  }
  // A world sharing this pack but shaped for a different game entirely (e.g.
  // spider-fly, which has no player-controlled entity at all — its board is
  // reusable static content, and player/spider/fly individuals are minted
  // fresh by that game's own opener, never shipped in the pack) has no
  // starting player placement. Decline cleanly rather than load a broken
  // adventure session — the same "not necessarily an adventure ask at all"
  // fallthrough an unrecognized name already gets, so whichever lane DOES
  // own this name gets a chance to claim it instead.
  if (!payload.facts.some((f) => f.subject === "player")) return null;

  const tag = worldProvenanceTag(world);
  await appendFacts(memoryDir, payload.facts.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  for (const rule of payload.rules) {
    try {
      await appendRule(memoryDir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
    } catch { /* one malformed rule row loses that rule, not the world */ }
  }
  if (cache) cache.rows = null; // the fact-rows cache predates these writes

  planHolder.state = { adventure: { world } };
  const resumed = await resumedPosition(memoryDir);
  const opener = resumed
    ? `back in the adventure — you are in the ${resumed}. Say "look" to look around.`
    : payload.meta?.opening || "the adventure begins.";
  return {
    text: opener,
    goal: `play the ${spokenNameOf(world)} adventure`,
    lane: "game-inform",
    note: `ADVENTURE — loaded the "${world}" world from the pack into this session's memory (facts + action families, provenance ${tag}) and announced the ${resumed ? "resumed" : "opening"} room`,
  };
}

/** chat's LAST-RESORT check for a named opener no lane claimed — "play
 *  atlantis" when the pack has worlds but none is called that. Called AFTER
 *  every other "play X"-shaped lane (spider-fly's own opener among them) has
 *  already had its chance, so this never steals a name a sibling game
 *  recognizes as its own (openAdventure's own fallthrough above stays
 *  silent for exactly that reason). Only once nothing else wanted the line
 *  does it get named and declined, rather than answered with an unrelated
 *  generic non-answer. Null when the line isn't a named opener at all, or
 *  the pack has no worlds (openAdventure's own first pass already gave that
 *  case its honest missingPackAnswer, before any lane got a turn), or the
 *  name IS one of the pack's — never re-decides a real hit. */
export async function unclaimedAdventureOpening(line, { env }) {
  const opening = matchAdventureOpening(line);
  if (!opening?.world) return null;
  const provider = getWorldsPackProvider(env);
  let names = null;
  try { names = await provider.list(); } catch { names = null; }
  if (!names || !names.length || names.includes(opening.world)) return null;
  return {
    text: `I don't know a world called "${spokenNameOf(opening.world)}" — the pack has: ${names.map(spokenNameOf).join(", ")}.`,
    lane: "game-inform",
    note: `ADVENTURE — last-resort opening decline: "${opening.world}" names no world in the pack (has: ${names.join(", ")}), and no other lane claimed the line either`,
  };
}

/** A resumed game's current room: non-null only when earlier @turnN
 *  snapshots exist (the world was already played in this store), folded the
 *  same way every other reader folds them. A fresh world returns null and
 *  the meta opening speaks. */
async function resumedPosition(memoryDir) {
  try {
    const state = foldWorldState(worldActionRows(readFactRows(await loadMemory(memoryDir))));
    if (!state.turnCount) return null;
    return state.placements.get("player")?.object ?? null;
  } catch {
    return null;
  }
}

// ---- the world-state fold ----------------------------------------------------

/** Which run of the world a store is on. Recasting a world (mud.html's
 *  RESET, a slider, the scenario dropdown) reopens the same deterministic
 *  instance ids over a fresh store, so the old run's snapshots can still be
 *  sitting in a store somewhere — this marker is how every reader agrees the
 *  world has started over. It is an ordinary add-only fact: each recast
 *  appends a larger value, the fold takes the max, and merging two stores
 *  converges because max is order-free. */
export const WORLD_EPOCH_PREDICATE = "mgx:world-epoch";
const WORLD_EPOCH_SUBJECT = "world";

/** The bare triple a recast writes to move the world onto `epoch`. The caller
 *  supplies provenance the same way it does for the seed facts, so the marker
 *  travels (and folds) as a world row. */
export function worldEpochFact(epoch) {
  return { subject: WORLD_EPOCH_SUBJECT, predicate: WORLD_EPOCH_PREDICATE, object: String(epoch) };
}

// The snapshot-subject grammar itself (`{ base, epoch, turn }` for a stamped
// subject, null for a base row) lives in domain/world-snapshot.mjs, the one
// place every reader — this lane, autoplay, the recognizer — parses it from.
// Re-exported here so every existing importer of snapshotSubject and
// parseSnapshotSubject keeps working.
export { snapshotSubject, parseSnapshotSubject };

const PLACEMENT_PREDICATES = new Set([
  "mgx:currently-in", "mgx:located-in", "mgx:fixed-in", "mgx:stands-locked-in", "mgx:hidden-in",
]);
// Supplemental positional relations: where a thing sits WITHIN its room,
// never where its room is. Folded like placements (newest per subject) but
// kept apart, since visibility and movement key on the placement, not on
// which surface a thing rests against.
const POSITION_PREDICATES = new Set(["mgx:on-top-of", "mgx:on-plane", "mgx:under"]);
const OPEN_PREDICATE = "mgx:is-open";
const MASS_PREDICATE = "mgx:hasMass";
const KNOWS_ABOUT_PREDICATE = "mgx:knows-about";
// What a thing is called on screen, when that differs from its id. A dug
// object needs a distinct id per instance and a plain name to read by, and
// this predicate is the only place the two are allowed to differ.
const DISPLAY_NAME_PREDICATE = "mgx:display-name";
const EXIT_PREDICATE_RE = /^mgx:has-exit-([a-z]+)$/;
// The dig mechanic's own wiring: which room a world measures distance from, the
// kinds a dug room turns up, the richer set a den holds, and who lives in one.
// All four are the world's answers to the dig verb's questions, never scenery.
const ORIGIN_PREDICATE = "mgx:is-origin";
const DIG_SPAWN_PREDICATE = "mgx:dig-spawns";
const DEN_SPAWN_PREDICATE = "mgx:den-spawns";
const DEN_RESIDENT_PREDICATE = "mgx:den-resident";
const DIG_REACH_PREDICATE = "mgx:dig-reach";
const DIG_SPAWN_MAX_PREDICATE = "mgx:dig-spawn-max";
const DEN_CHANCE_PREDICATE = "mgx:den-chance-in";
const DEN_RESIDENT_CHANCE_PREDICATE = "mgx:den-resident-chance-in";
const MASS_DRAIN_PREDICATE = "mgx:mass-drain-per-turn";
// Where a thing that has left the world is placed. The world has no other way
// to say "out of play", and no room can be called either of these, so the
// sentinel is the whole convention: the readers below skip it exactly as they
// skip a hiding place. Which sentinel a character sits at IS the reason it is
// out — eaten by a predator, or starved once its mass ran out — so a caller
// can say which without a second fact to read.
const CONSUMED_PLACE = "eaten";
const STARVED_PLACE = "starved";
const OUT_OF_PLAY_PLACES = new Set([CONSUMED_PLACE, STARVED_PLACE]);

/** The rows a live world's STATE fold may see: those the world itself wrote
 *  (provenance empty, or `world:*` — the loaded shard and its @turn
 *  snapshots), never a taught assert (`teach:chat:*`) or a merged corpus. The
 *  game world changes only through actions; a locative fact the player TAUGHT
 *  mid-game is their own note, and must not silently move a prop. Digest and
 *  background-colour paths keep the unfiltered rows — a taught fact still
 *  reads back as prose, it just never folds into the playable state. */
export function worldActionRows(rows) {
  return (rows || []).filter((r) => {
    const prov = String(r.provenance || "").trim();
    return prov === "" || prov.startsWith("world:");
  });
}

/** Every individual the world names — its rooms, its cast, its props, and
 *  anything dug up since — as the plain id strings a parser has to have
 *  DECLARED before it can resolve them. @turnN snapshots are skipped: a
 *  snapshot only ever repeats a subject its base row already named. Pure. */
export function worldIndividualNames(rows) {
  const names = new Set();
  for (const row of rows || []) {
    if (parseSnapshotSubject(row.subject)) continue;
    if (row.predicate === "rdf:type" || PLACEMENT_PREDICATES.has(row.predicate)) names.add(row.subject);
    if (EXIT_PREDICATE_RE.test(row.predicate)) { names.add(row.subject); names.add(row.object); }
  }
  return [...names].sort();
}

/** Fold fact rows into the CURRENT world state: per subject, the newest
 *  placement (base row = turn 0 of the current epoch, snapshots override), the
 *  newest open/closed state, the newest mass, the exit map, the turn counter
 *  (the largest snapshot turn written in the current epoch — derived, never
 *  stored), and the epoch itself.
 *
 *  Rows rank by the (epoch, turn) pair, so a recast can never be outranked by
 *  the run it replaced: a turn-9 snapshot from before the recast loses
 *  to a turn-1 snapshot written after it. Base rows carry no stamp of their
 *  own and rank as turn 0 of the CURRENT epoch — a recast re-seeds the same
 *  deterministic ids, so the shard's own rows are exactly the state the new
 *  run starts from. A store with no epoch marker and no stamped snapshot is
 *  wholly on epoch 0 and folds as it always has. Pure. */
export function foldWorldState(factRows) {
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
  const placements = new Map(); // subject -> { predicate, object, turn, epoch }
  const positions = new Map();  // subject -> { predicate, object, turn, epoch }
  const openness = new Map();   // subject -> { open, turn, epoch }
  const masses = new Map();     // subject -> { value, turn, epoch }
  const exits = new Map();      // room -> Map(direction -> room)
  let turnCount = 0;
  const outranks = (rowEpoch, turn, prior) =>
    !prior || rowEpoch > prior.epoch || (rowEpoch === prior.epoch && turn >= prior.turn);
  for (const row of rows) {
    if (row.predicate === WORLD_EPOCH_PREDICATE) continue;
    const snap = parseSnapshotSubject(row.subject);
    const base = snap ? snap.base : row.subject;
    const rowEpoch = snap ? snap.epoch : epoch;
    const turn = snap ? snap.turn : 0;
    if (snap && rowEpoch === epoch) turnCount = Math.max(turnCount, turn);
    if (PLACEMENT_PREDICATES.has(row.predicate)) {
      if (outranks(rowEpoch, turn, placements.get(base))) placements.set(base, { predicate: row.predicate, object: row.object, turn, epoch: rowEpoch });
      continue;
    }
    if (POSITION_PREDICATES.has(row.predicate)) {
      if (outranks(rowEpoch, turn, positions.get(base))) positions.set(base, { predicate: row.predicate, object: row.object, turn, epoch: rowEpoch });
      continue;
    }
    if (row.predicate === OPEN_PREDICATE) {
      if (outranks(rowEpoch, turn, openness.get(base))) openness.set(base, { open: row.object === "true", turn, epoch: rowEpoch });
      continue;
    }
    if (row.predicate === MASS_PREDICATE) {
      const value = Number(row.object);
      if (!Number.isFinite(value)) continue; // masses hold numbers; an unparsable one is no mass at all
      if (outranks(rowEpoch, turn, masses.get(base))) masses.set(base, { value, turn, epoch: rowEpoch });
      continue;
    }
    const exit = EXIT_PREDICATE_RE.exec(row.predicate);
    if (exit && !snap) {
      if (!exits.has(row.subject)) exits.set(row.subject, new Map());
      exits.get(row.subject).set(exit[1], row.object);
    }
  }
  return { placements, positions, openness, masses, exits, turnCount, epoch };
}

/** A subject's CURRENT within-room position, or null. A position goes stale
 *  the moment the subject is placed somewhere new: taking the lamp writes a
 *  later-turn placement, so its turn-0 `on-top-of desk` no longer holds and
 *  no extra write is needed to retract it. */
export function currentPosition(state, subject) {
  const pos = state.positions.get(subject);
  if (!pos) return null;
  const place = state.placements.get(subject);
  if (place && (pos.epoch < place.epoch || (pos.epoch === place.epoch && pos.turn < place.turn))) return null;
  return pos;
}

/** The default surface a subject's class implies, walking its rdf:type and
 *  rdfs:subClassOf edges for an `mgx:default-plane` fact. A non-floor plane
 *  (wall, ceiling) wins over floor wherever both are reachable — a portrait
 *  typed both `furniture` (floor) and, via `painting`, wall reads as hanging
 *  on the wall. Returns the plane, or null when no class default applies.
 *  Pure. */
function classDefaultPlane(rows, subject) {
  const edgesFrom = (node) => (rows || [])
    .filter((r) => r.subject === node && (r.predicate === "rdf:type" || r.predicate === "rdfs:subClassOf"))
    .map((r) => r.object);
  const planeOf = (node) => (rows || [])
    .find((r) => r.subject === node && r.predicate === "mgx:default-plane")?.object ?? null;
  const seen = new Set([subject]);
  const queue = edgesFrom(subject);
  let fallback = null;
  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node)) continue;
    seen.add(node);
    const plane = planeOf(node);
    if (plane && plane !== "floor") return plane;
    if (plane && !fallback) fallback = plane;
    queue.push(...edgesFrom(node));
  }
  return fallback;
}

// ---- the world interpreter ---------------------------------------------------
//
// Generic over any loaded world: which verb exists is the taught action
// families' business (a verb with no family declines by name), what each
// verb writes is its family's effect rows, and every precondition is a
// closed-vocabulary world FACT (exits, lock state, hidden contents, the
// unlock instrument) checked per predicate — never per object, never per
// world. Effects append as @turnN snapshots through the ordinary appendFacts
// path; nothing is ever mutated in place.

const INVENTORY_RE =
  /^(?:inventory|inv|what\s+am\s+i\s+carrying|what\s+do\s+i\s+have|what\s+do\s+i\s+carry|what(?:'s|\s+is)\s+in\s+my\s+(?:bag|pockets?|hands?))[?.!\s]*$/i;

const factObjects = (rows, subject, predicate) =>
  (rows || []).filter((r) => r.subject === subject && r.predicate === predicate).map((r) => r.object);

const isTyped = (rows, subject, type) =>
  (rows || []).some((r) => r.subject === subject && r.predicate === "rdf:type" && r.object === type);

const isContainer = (rows, x) => factObjects(rows, x, "mgx:is-container").includes("true");

/** The room an object's current placement puts it in for visibility: its own
 *  room, or (one containment hop) the room of the OPEN container holding it. */
function visibleRoomOf(thing, { rows, state }) {
  const place = state.placements.get(thing);
  if (!place || place.predicate === "mgx:hidden-in") return null;
  if (place.predicate === "mgx:currently-in" || isTyped(rows, place.object, "room")) return place.object;
  const holder = place.object;
  // A non-container holder is a character carrying the thing, whoever they
  // are — carried, so not on show in the room they stand in.
  if (!isContainer(rows, holder)) return null;
  if (!state.openness.get(holder)?.open) return null;
  const holderPlace = state.placements.get(holder);
  return holderPlace && holderPlace.predicate !== "mgx:hidden-in" ? holderPlace.object : null;
}

const carriedBy = (state, thing, holder) => {
  const place = state.placements.get(thing);
  return !!place && place.predicate === "mgx:located-in" && place.object === holder;
};

/** True when `object` is never a real placed game entity (no entry in
 *  state.placements at all — checked first, so a hidden or elsewhere-placed
 *  object never counts, only a term with NO placement anywhere) but some
 *  OTHER fact still names it — almost always the background human/ConceptNet
 *  corpus overlapping a room's own vocabulary ("garden mgx:hasA flower"),
 *  which worldDigestRows already renders into the room's own prose ("Garden
 *  has flower"). Without this distinction, examine/take/talk's shared
 *  presence decline ("I don't see a flower here") directly contradicts what
 *  the room's own description just said, in the same conversation. */
function backgroundOnlyMention(rows, state, object) {
  if (state.placements.has(object)) return false;
  return (rows || []).some((r) => r.subject === object || r.object === object);
}

/** True when `subject` is one of the world's cast rather than a prop: a
 *  declared person, or anything the world places with mgx:currently-in — the
 *  predicate every world reserves for a character standing in a room, props
 *  riding located-in/fixed-in/stands-locked-in instead. Both halves matter:
 *  ashcombe-hall types its staff `person`, while mud-garden types its animals
 *  `adventurer` and places them the same way, so a person-only test leaves a
 *  whole cast with nobody able to speak to it. */
function isCastMember(rows, state, subject) {
  return isTyped(rows, subject, "person") || state.placements.get(subject)?.predicate === "mgx:currently-in";
}

/** Who else is standing in `room` right now, sorted — the same currently-in
 *  placement the talk verb and the room affordances read, exposed so a caller
 *  rendering a room can name its cast without re-deriving the test. Pure. */
export function castInRoom(rows, state, room, exclude = null) {
  return [...state.placements.keys()]
    .filter((subject) => subject !== exclude && subject !== room)
    .filter((subject) => state.placements.get(subject).object === room)
    .filter((subject) => isCastMember(rows, state, subject))
    .sort();
}

// A predator eats whatever walks into its room. The marker is a world fact,
// so which individual is dangerous is the world's business, never this
// module's.
const PREDATOR_PREDICATE = "mgx:is-predator";

/** The predator standing in `room`, or null — read from the same placements
 *  fold every other presence check uses. Pure. */
function predatorIn(rows, state, room) {
  return castInRoom(rows, state, room)
    .find((subject) => factObjects(rows, subject, PREDATOR_PREDICATE).includes("true")) ?? null;
}

/** True when `subject` has left the world: placed at an out-of-play sentinel
 *  no room can be called. Its part in the world is finished — every command it
 *  gives declines, and its scripted turns stop. Pure. */
export const isOutOfPlay = (state, subject) => OUT_OF_PLAY_PLACES.has(state.placements.get(subject)?.object);

/** WHY `subject` is out of play — "eaten" or "starved" — or null while it is
 *  still playing. The two fates end a run the same way and read nothing alike,
 *  so anything narrating one needs to tell them apart. Pure. */
export const outOfPlayReasonOf = (state, subject) => {
  const place = state.placements.get(subject)?.object;
  return OUT_OF_PLAY_PLACES.has(place) ? place : null;
};

/** How a fate reads in a sentence: "the mole-1 has been eaten", "the mole-1 has
 *  starved". One phrase per sentinel, so nothing anywhere else has to spell the
 *  difference out. Pure. */
export const outOfPlayPhrase = (subject, reason) =>
  (reason === STARVED_PLACE ? `the ${subject} has starved` : `the ${subject} has been eaten`);

/** The room's real affordances — every exit, and every visible object's
 *  applicable verb — read from the EXACT SAME data take/open/talk/examine
 *  already check (visibleRoomOf, isContainer, isTyped, the placement
 *  predicate), so this list can never promise an action one of those verbs
 *  would then refuse. A locked container offers "unlock", never "open" (that
 *  would only decline); an already-open one offers neither, since there is
 *  nothing left for either verb to do. Pure. */
export function roomAffordances(rows, state, here, actingSubject = "player") {
  const actions = [];
  for (const direction of state.exits.get(here)?.keys() ?? []) {
    actions.push(`go ${direction}`);
  }
  for (const subject of [...state.placements.keys()].sort()) {
    if (subject === actingSubject) continue;
    if (visibleRoomOf(subject, { rows, state }) !== here) continue;
    const place = state.placements.get(subject);
    const container = isContainer(rows, subject);
    if (container && place.predicate === "mgx:stands-locked-in") {
      actions.push(`unlock ${subject}`);
      continue;
    }
    if (container && place.predicate === "mgx:fixed-in") {
      if (!state.openness.get(subject)?.open) actions.push(`open ${subject}`);
      continue;
    }
    if (!container && place.predicate === "mgx:fixed-in") {
      actions.push(`examine ${subject}`);
      continue;
    }
    if (isCastMember(rows, state, subject)) {
      actions.push(`talk to ${subject}`);
      continue;
    }
    if (place.predicate === "mgx:located-in") {
      actions.push(`take ${subject}`);
    }
  }
  return actions;
}

const affordanceSuffix = (actions) => (actions.length ? ` You can: ${actions.join(", ")}.` : "");

/** The auto-relook line every state-changing turn ends on: the room read back
 *  from a FRESH load of the store, in the same shape a manual "look"
 *  produces, so nobody has to retype "look" to see what just changed. Every
 *  writer that changes the world shares this one renderer — a second copy
 *  would drift the moment the digest or the affordance list moved. */
export async function worldRelook(room, { memoryDir, graph = null, actingSubject = "player" }) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const state = foldWorldState(worldActionRows(rows));
  const digest = await worldDigest(room, { memoryDir, memory, rows, state, graph, actingSubject });
  const actions = roomAffordances(rows, state, room, actingSubject);
  return `you are in the ${room}. ${digest ?? "Nothing more about it is written down yet."}${affordanceSuffix(actions)}`;
}

/** The effect predicate a family writes (its action-effect row's slot, with
 *  the mgx: prefix rule readers re-attach). Null when the family carries no
 *  effect row — unlock's family stays signature-only (its instrument match
 *  needs a third, externally-supplied binding no shipped rule shape covers)
 *  and rides the hand-written logic below; go/take/drop/give/open/close all
 *  carry real effect rows and never hit this null. */
function familyEffectPredicate(family) {
  const effect = (family || []).find((r) => r.kind === "action-effect");
  if (!effect?.slots?.predicate) return null;
  const p = effect.slots.predicate;
  return p.includes(":") ? p : `mgx:${p}`;
}

// ---- the NPC scheduler -------------------------------------------------------
//
// One bounded pass per state-changing player command, run synchronously in
// the same turn, immediately after the player's own effect: every individual
// tagged mgx:is-npc is walked in fixed sorted order, and an NPC whose
// mgx:acts-on-turn fact matches the new turn number fires its taught "go"
// family toward its mgx:acts-toward target — capped at one fired action per
// NPC per turn, never a cascade, no randomness anywhere. The precondition is
// the same one the player's own go obeys (an exit fact linking the rooms)
// plus the family's signature covering the NPC, and the effect writes as the
// same @turnN snapshot whether or not the player is there to see it. This is
// scripted-by-data autonomy: the schedule, the target, the cast and the
// family all arrive as world rows, never code.

export function runNpcPass({ rows, state, k, families, playerRoomAfter }) {
  const writes = [];
  const lines = [];
  const goFamily = families.get("go") || [];
  const signatures = goFamily.filter((r) => r.kind === "action-signature");
  const effectPredicate = familyEffectPredicate(goFamily) ?? "mgx:currently-in";
  const npcs = [...new Set((rows || [])
    .filter((r) => r.predicate === "mgx:is-npc" && r.object === "true")
    .map((r) => r.subject))].sort();
  for (const npc of npcs) {
    if (!factObjects(rows, npc, "mgx:acts-on-turn").includes(String(k))) continue;
    const target = factObjects(rows, npc, "mgx:acts-toward")[0];
    if (!target) continue;
    const from = state.placements.get(npc)?.object;
    if (!from || from === target) continue;
    const covered = signatures.some((s) =>
      isTyped(rows, npc, s.slots.subjectClass) && isTyped(rows, target, s.slots.targetClass));
    if (!covered) continue;
    const linked = [...(state.exits.get(from)?.values() ?? [])].includes(target);
    if (!linked) continue;
    writes.push({ subject: snapshotSubject(npc, k, state.epoch), predicate: effectPredicate, object: target });
    if (playerRoomAfter === target) lines.push(`the ${npc} walks in.`);
    else if (playerRoomAfter === from) lines.push(`the ${npc} leaves.`);
  }
  return { writes, lines };
}

async function writeWorldTurn(memoryDir, world, k, facts, cache) {
  await appendFacts(memoryDir, facts.map((f) => ({
    ...f, provenance: `${worldProvenanceTag(world)}:turn${k}`,
  })));
  if (cache) cache.rows = null;
}

// ---- what a character knows, and who it heard it from -----------------------
//
// A character telling another character about something, or looking at
// something itself, leaves a REAL fact behind: an mgx:knows-about edge the
// hearer carries from that turn on, readable by personKnowledgeLines exactly
// like a world-authored one. Nothing here is per-tick or in-memory — one
// animal can walk off, come back ten turns later, and still know what it was
// told.
//
// These deliberately bypass writeWorldTurn. That tags everything
// `world:<name>:turnN`, which credits the WORLD for the claim; a character's
// testimony belongs to the character, so it carries its own
// `mud:<character>:turnN` tag and lands on that character's own Source and
// trust track record. The side effect is that worldActionRows filters these
// out of the playable state fold, which is what you want — being told about a
// stone must never move the stone.
//
// A claim can also go out of date, and none of them is ever retracted. Eating
// the last carrot appends a SECOND claim to the same edge, tagged `:gone`, and
// appendFacts unions the two tags onto the one fact exactly as it unions any
// repeat assertion. "The carrot was here on turn 2" and "the carrot is gone on
// turn 5" are both true; the reader's job is to say which one rules. So
// reading knowledge back means reading the newest claim per edge, never the
// union of every claim ever made.

const VOIDED_TESTIMONY_SUFFIX = ":gone";

/** The provenance tag one character's claim carries: who said it, which run of
 *  the world it was said in, the turn it was said on, and whether it says the
 *  thing has gone. The epoch segment follows snapshotSubject's convention —
 *  written only once a recast has moved the world past epoch 0, so an unrecast
 *  store and every tag written before epochs existed keep the bare form and
 *  read back as epoch 0. */
export function characterTestimonyTag(character, k, { epoch = 0, voided = false } = {}) {
  const when = epoch > 0 ? `epoch${epoch}:turn${k}` : `turn${k}`;
  return `mud:${character}:${when}${voided ? VOIDED_TESTIMONY_SUFFIX : ""}`;
}

async function appendTestimony(memoryDir, { knower, source, thing, k, epoch = 0, voided = false, cache }) {
  await appendFacts(memoryDir, [{
    subject: knower, predicate: KNOWS_ABOUT_PREDICATE, object: thing,
    provenance: characterTestimonyTag(source, k, { epoch, voided }),
  }]);
  if (cache) cache.rows = null;
}

/** Record that `teller` told `asker` about `thing` on turn `k` of `epoch`. The
 *  asker is the subject — it is the one who now knows — and the teller is named
 *  in the provenance, so the claim corroborates the teller's Source, not the
 *  asker's. */
export async function recordTold(memoryDir, { asker, teller, thing, k, epoch = 0, cache = null }) {
  return appendTestimony(memoryDir, { knower: asker, source: teller, thing, k, epoch, cache });
}

/** Record that `observer` examined `thing` on turn `k` of `epoch`. The observer
 *  is both the subject and the provenance's character: it learned this by
 *  looking, so it is its own source for it. */
export async function recordExamined(memoryDir, { observer, thing, k, epoch = 0, cache = null }) {
  return appendTestimony(memoryDir, { knower: observer, source: observer, thing, k, epoch, cache });
}

/** Record that `observer` saw `thing` leave the world on turn `k` of `epoch` —
 *  it ate the last of it. Written as a fresh claim on the SAME edge an older one
 *  already sits on, so the older claim stands untouched and stops being the one
 *  that rules. The observer is its own source, the way examining is. */
export async function recordGone(memoryDir, { observer, thing, k, epoch = 0, cache = null }) {
  return appendTestimony(memoryDir, { knower: observer, source: observer, thing, k, epoch, voided: true, cache });
}

const TESTIMONY_TAG_RE = /^mud:([^:\s]+):(?:epoch(\d+):)?turn(\d+)(:gone)?$/;
const TURN_STAMP_RE = /:turn(\d+)\b/;

/** How one provenance segment on a knows-about edge stands as a claim about
 *  what `knower` knows: which run of the world it was made in, whether the
 *  knower vouches for it itself, the turn it was asserted on, and whether it
 *  says the thing is gone. A tag that is no character's testimony — a world's
 *  own seed fact, a dig spawn — reads as hearsay stamped with whatever turn it
 *  carries.
 *
 *  Epoch reads the same way foldWorldState reads a row's: a stamped tag names
 *  its own run, a tag stamped with a turn but no epoch was written on epoch 0
 *  (or before epochs existed), and a tag with no turn at all is a seed the
 *  world lays down fresh on every recast, so it belongs to the run being read
 *  now. */
function testimonyClaim(segment, knower, currentEpoch = 0) {
  const mine = TESTIMONY_TAG_RE.exec(segment);
  const turnStamp = mine ? mine[3] : TURN_STAMP_RE.exec(segment)?.[1];
  const stamp = Number(turnStamp ?? 0);
  const epochStamp = mine?.[2];
  return {
    epoch: epochStamp ? Number(epochStamp) : (turnStamp === undefined ? currentEpoch : 0),
    firsthand: !!mine && mine[1] === knower,
    turn: Number.isFinite(stamp) ? stamp : 0,
    voided: !!(mine && mine[4]),
  };
}

/** The later epoch beats everything, then firsthand beats hearsay, then the
 *  later turn wins, then "gone" takes the tie — an animal that examined a carrot
 *  and ate it on one turn ate it second.
 *
 *  Epoch on top mirrors the world-state fold: a recast starts the world over, so
 *  nothing said in the run it replaced can rule over what a character has seen
 *  since, however late in that old run it was said or however firsthand. Within
 *  one run, firsthand sits above recency, and that is what stops an animal being
 *  talked back into a meal it ate itself: a room-mate can tell it about that
 *  carrot the turn after, and its own eyes still hold. */
const outranksClaim = (claim, best) => (
  claim.epoch !== best.epoch ? claim.epoch > best.epoch
    : claim.firsthand !== best.firsthand ? claim.firsthand
      : claim.turn !== best.turn ? claim.turn > best.turn
        : claim.voided && !best.voided
);

/** The claim that rules on one knows-about edge, across every segment its
 *  provenance carries. */
function rulingTestimonyClaim(provenance, knower, currentEpoch = 0) {
  let best = null;
  for (const segment of String(provenance || "").split(" | ")) {
    const tag = segment.trim();
    if (!tag) continue;
    const claim = testimonyClaim(tag, knower, currentEpoch);
    if (!best || outranksClaim(claim, best)) best = claim;
  }
  return best;
}

/** What `person` knows about NOW: the object of every knows-about edge whose
 *  ruling claim still stands, oldest learned first. Nothing is deleted — an edge
 *  whose newest claim says the thing is gone just stops reading back.
 *  `currentEpoch` is the run the reader is on, so a claim a recast has left
 *  behind cannot decide what a character knows today.
 *
 *  The order comes off each edge's own ruling claim rather than off the row
 *  array, so it says what it means: a character lists what it learned in the
 *  order it learned it, and two peers holding one fact set read the same list.
 *  Two topics learned on one turn fall back to the topic word. */
function currentKnowsAboutTopics(rows, person, currentEpoch = 0) {
  const known = [];
  for (const row of rows || []) {
    if (row.subject !== person || row.predicate !== KNOWS_ABOUT_PREDICATE) continue;
    const claim = rulingTestimonyClaim(row.provenance, person, currentEpoch);
    if (claim?.voided) continue;
    known.push({ topic: row.object, epoch: claim?.epoch ?? 0, turn: claim?.turn ?? 0 });
  }
  known.sort((a, b) => a.epoch - b.epoch || a.turn - b.turn
    || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
  return known.map((entry) => entry.topic);
}

/**
 * Charge `subject` the mass a turn costs it, and place it out of play at the
 * starved sentinel once nothing is left. Returns `{ mass, starved }` — the mass
 * it is left with, and whether that ended its run. Writes nothing and charges
 * nothing when the drain is zero, when the subject is already out of play, or
 * when the world gives it no mass at all (`mass` is then null: a thing with no
 * mass cannot run out of it).
 *
 * The write lands on the world's OWN next turn, read fresh here rather than
 * taken from the caller. A scripted turn runs several world commands, each
 * stamping a turn of its own, so a caller's tick number can trail the world's
 * count — and a mass snapshot stamped behind the newest placement would fold
 * away as stale the moment it was written.
 */
export async function recordMassDrain(memoryDir, { world, subject, drainPerTurn, cache = null }) {
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldWorldState(worldActionRows(rows));
  const mass = state.masses.get(subject)?.value ?? null;
  if (mass === null || !(drainPerTurn > 0) || isOutOfPlay(state, subject)) return { mass, starved: false };
  const left = Math.max(0, Math.round((mass - drainPerTurn) * 100) / 100);
  const k = state.turnCount + 1;
  await writeWorldTurn(memoryDir, world, k, [
    { subject: snapshotSubject(subject, k, state.epoch), predicate: MASS_PREDICATE, object: String(left) },
    ...(left > 0 ? [] : [{ subject: snapshotSubject(subject, k, state.epoch), predicate: "mgx:currently-in", object: STARVED_PLACE }]),
  ], cache);
  return { mass: left, starved: left <= 0 };
}

// ---- the look/inventory digest ----------------------------------------------
//
// "look" and "what am I carrying" are generateCompletion calls (the shipped
// extractive pipeline), pointed at the current room / the player — never a
// hand-written room template. Two pieces of query shaping make the pipeline
// read CURRENT state honestly: the fact view handed to the pipeline's graph
// adapter is the same @turnN fold every other reader here uses (so a
// superseded placement never contradicts the newest one), and its predicates
// render as their phrase forms (the same rendering discipline as chat's own
// predicatePhrase) so the extracted sentences are plain prose. Hidden
// contents and the puzzle wiring (mgx:hidden-in, mgx:unlocks-with, the NPC
// schedule) stay out of the view: hidden means hidden.

const VIEW_EXCLUDED_PREDICATES = new Set([
  // The recast counter is bookkeeping, not scenery — "World mgx:world-epoch 2"
  // must never read back as room prose.
  WORLD_EPOCH_PREDICATE,
  "mgx:hidden-in", "mgx:is-open", "mgx:is-npc", "mgx:is-container",
  // A bare number reads as an untranslated triple in room prose ("Mole-1
  // mgx:hasMass 8"). Mass reaches a player through the verbs that change it.
  MASS_PREDICATE,
  "mgx:unlocks-with", "mgx:acts-on-turn", "mgx:acts-toward",
  // is-objective is an internal marker for auto-play's goal inference — the
  // same information the opening narration already tells a human player in
  // prose, never meant to surface as a raw, unphrased triple ("Letter
  // mgx:is-objective true.") itself.
  "mgx:is-objective",
  // Staff knowledge is the whole puzzle: a room look must never leak
  // "Gardener knows-where letter" or the game is spoiled. It reaches the
  // player only through the talk lane, which resolves each pointer live.
  "mgx:knows-where", "mgx:knows-objective", KNOWS_ABOUT_PREDICATE,
  // Class-schema facts describe the ontology, not the scene. default-contains
  // is already materialized into real instances at load; default-plane and
  // subClassOf drive positional rendering by their own readers, and read as
  // raw triples if they land in room prose.
  "mgx:default-contains", "mgx:default-plane", "rdfs:subClassOf",
  // A screen name is presentation, not scenery — it reads as a raw triple in
  // room prose ("Carrot-1 mgx:display-name carrot") and says nothing the
  // room's own sentences don't already say.
  DISPLAY_NAME_PREDICATE,
  // Which individual is dangerous is the predator mechanic's own wiring; a
  // room look that announced it would give the trap away as a bare triple.
  "mgx:is-predator",
  // The dig mechanic's wiring is the same kind of thing: it tells the verb what
  // a dug room may hold and how far the world reaches, and says nothing about
  // the room anyone is standing in.
  ORIGIN_PREDICATE, DIG_SPAWN_PREDICATE, DEN_SPAWN_PREDICATE, DEN_RESIDENT_PREDICATE,
  DIG_REACH_PREDICATE, DIG_SPAWN_MAX_PREDICATE, DEN_CHANCE_PREDICATE, DEN_RESIDENT_CHANCE_PREDICATE,
  // How fast a turn wears a species down is the mass economy's own wiring, and
  // reads as a bare number in room prose the same way hasMass does.
  MASS_DRAIN_PREDICATE,
]);

const sentenceCase = (term) => String(term).charAt(0).toUpperCase() + String(term).slice(1);
const typePhrase = (object) => (/^[aeiou]/.test(object) ? "is an" : "is a");

// The default human persona's always-active background corpus
// (corpus/tier2/human.jsonl) deliberately overlaps Ashcombe's own room and
// object names ("garden has a flower"), so the digest's broad search surfaces
// these alongside the world's own facts. They stay in the prose (they're
// real, sourced facts) but must read as prose, not as an untranslated triple
// ("Garden mgx:hasA flower") that looks exactly like a bug report — the same
// curated wording chat.mjs's own FACT_PREDICATE_PHRASES already uses for
// these three ConceptNet-sourced predicates.
const BACKGROUND_FACT_PHRASES = {
  "mgx:hasA": "has",
  "mgx:usedFor": "is used for",
  "mgx:atLocation": "is found in",
};

/** True when a fact row is provably owned by a NON-world source (a merged
 *  corpus, a reference pack, a taught assert) rather than the loaded world. A
 *  row with no provenance is not "non-world" — a hand-built digest view carries
 *  none, and the room-look filter keeps those. World facts and their @turn
 *  snapshots tag as `world:<name>[:turnN]`. */
function isNonWorldSourced(row) {
  const prov = String(row.provenance || "").trim();
  return prov !== "" && !prov.startsWith("world:");
}

/** The digest's fact view: current placements (folded), exits, typing and
 *  every other surviving fact, with phrase predicates and sentence-cased
 *  subjects so the pipeline's sentence splitter sees real sentences. Room text
 *  is world-sourced only — a merged corpus's overlap on a room's own vocabulary
 *  never leaks into the description. Pure. */
export function worldDigestRows(rows, state, actingSubject = "player") {
  const out = [];
  const seen = new Set();
  const push = (subject, phrase, object) => {
    const key = `${subject}\0${phrase}\0${object}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ subject: sentenceCase(subject), predicate: phrase, object });
  };
  // Whoever holds a located-in thing is carrying it rather than housing it,
  // and the cast are exactly the individuals the world places with
  // currently-in — props ride located-in/fixed-in/stands-locked-in, rooms are
  // never placed at all.
  const isCarryingCharacter = (holder) =>
    isTyped(rows, holder, "person") || state.placements.get(holder)?.predicate === "mgx:currently-in";
  for (const [subject, place] of state.placements) {
    if (place.predicate === "mgx:hidden-in" || OUT_OF_PLAY_PLACES.has(place.object)) continue;
    if (place.predicate === "mgx:located-in" && place.object === actingSubject) {
      push(actingSubject, "carries the", subject);
      continue;
    }
    if (place.predicate === "mgx:located-in" && isCarryingCharacter(place.object)) {
      push(place.object, "carries the", subject);
      continue;
    }
    const phrase = {
      "mgx:currently-in": "is in the",
      "mgx:located-in": "is in the",
      "mgx:fixed-in": "is fixed in the",
      "mgx:stands-locked-in": "stands locked in the",
    }[place.predicate];
    if (phrase) push(subject, phrase, place.object);
  }
  // Where a placed thing sits within its room — an instance position (the
  // lamp on the desk) if one is current, else a notable class default (a
  // portrait on the wall). Floor is the unremarkable default the room view
  // already assumes, so it is left unsaid.
  const POSITION_PHRASE = { "mgx:on-top-of": "is on the", "mgx:on-plane": "is on the", "mgx:under": "is under the" };
  for (const [subject, place] of state.placements) {
    if (place.predicate === "mgx:hidden-in" || place.object === actingSubject || OUT_OF_PLAY_PLACES.has(place.object)) continue;
    const pos = currentPosition(state, subject);
    if (pos && POSITION_PHRASE[pos.predicate]) { push(subject, POSITION_PHRASE[pos.predicate], pos.object); continue; }
    const plane = classDefaultPlane(rows, subject);
    if (plane && plane !== "floor") push(subject, "is usually on the", plane);
  }
  const gone = new Set([...state.placements]
    .filter(([, place]) => OUT_OF_PLAY_PLACES.has(place.object))
    .map(([subject]) => subject));
  for (const row of rows || []) {
    if (parseSnapshotSubject(row.subject)) continue;              // folded above
    if (gone.has(row.subject)) continue;                         // out of the world entirely
    // Room text comes from the world source only. A merged corpus overlaps a
    // room's own vocabulary ("library rdfs:subClassOf literary study"), and
    // without this those rows leak into the room description as stray sentences.
    // A row with no provenance (a hand-built test view) is kept — the filter
    // only drops rows a non-world source provably owns.
    if (isNonWorldSourced(row)) continue;
    if (PLACEMENT_PREDICATES.has(row.predicate)) continue;       // folded above
    if (POSITION_PREDICATES.has(row.predicate)) continue;        // folded above
    if (VIEW_EXCLUDED_PREDICATES.has(row.predicate)) continue;
    const exit = EXIT_PREDICATE_RE.exec(row.predicate);
    if (exit) { push(row.subject, `has an exit ${exit[1]} to the`, row.object); continue; }
    if (row.predicate === "rdf:type") { push(row.subject, typePhrase(row.object), row.object); continue; }
    if (row.predicate === "mgx:works-in") { push(row.subject, "works in the", row.object); continue; }
    if (BACKGROUND_FACT_PHRASES[row.predicate]) { push(row.subject, BACKGROUND_FACT_PHRASES[row.predicate], row.object); continue; }
    push(row.subject, row.predicate, row.object);
  }
  return out;
}

/** The physical-property lines a close "look <object>" states: the object's
 *  own world facts, phrased through the SAME worldDigestRows view a room look
 *  reads (so mgx:knows-*, the NPC schedule, is-objective and the rest of the
 *  puzzle wiring are already excluded there), minus its bare rdf:type line —
 *  the class hierarchy renders that as its own is-a chain instead. A carried
 *  object surfaces through the "carries the" line the digest already produces.
 *  Pure. */
export function objectLookProperties(rows, state, object, actingSubject = "player") {
  const subjectCased = sentenceCase(object);
  return worldDigestRows(rows, state, actingSubject)
    .filter((r) => (r.subject === subjectCased && r.predicate !== "is a" && r.predicate !== "is an")
      || (r.predicate === "carries the" && r.object === object))
    .map((r) => `${r.subject} ${r.predicate} ${r.object}.`);
}

/** An object's class hierarchy as an is-a chain, nearest-first and opening
 *  with the object itself ("housekeeper → person"): a breadth-first walk up
 *  the world's OWN rdf:type and rdfs:subClassOf edges (worldActionRows, so a
 *  merged corpus's taxonomy for the same word never joins the chain), the same
 *  upward-class rendering chat's "what do you know about X" shows. The walk
 *  itself is agent-traits.mjs's classChainOf, shared with that module's trait
 *  resolver so the tree holds one chain walk rather than two. Pure. */
export function objectClassChain(rows, object) {
  return classChainOf(worldActionRows(rows), object);
}

async function worldDigest(prompt, { memoryDir, memory, rows, state, graph, actingSubject = "player" }) {
  const view = worldDigestRows(rows, state, actingSubject);
  const store = {
    ...COMPLETIONS_STORE,
    readFactRows: () => view,
    // World state lives in facts. Folded session blocks quote earlier
    // TRANSCRIPTS of this same world, so with block retrieval on, a second
    // session's look would echo stale room descriptions beside the current
    // one. Retrieval is shaped to the graph source alone.
    retrieveBlocks: async () => [],
  };
  const graphService = createCompletionsGraphAdapter(graph ?? null, memory, { store });
  try {
    const res = await generateCompletion(memoryDir, prompt, {
      query: prompt, memory, graph: graph ?? undefined, graphService, store,
      // Ashcombe-scale rooms carry more than the default 3 facts; the wider
      // per-group cutoff keeps a correctness-bearing fact (the locked
      // cabinet) from losing its digest slot to scenery.
      maxSentencesPerGroup: 12,
    });
    if (res?.text && !res.declined) return res.text;
  } catch { /* a digest failure falls to the honest floor below */ }
  return null;
}

// ---- command execution -------------------------------------------------------

const answer = (text, note, { goal, miss = false } = {}) => ({
  text, note, lane: "game-answer", miss, ...(goal ? { goal } : {}),
});

// A dug room needs the way back written too, and the exit vocabulary is only
// ever a direction word in a predicate name, so the pairing lives here.
const OPPOSITE_DIRECTION = new Map([
  ["north", "south"], ["south", "north"],
  ["east", "west"], ["west", "east"],
  ["up", "down"], ["down", "up"],
]);

// What a freshly dug room holds, and how often a dig opens something better
// than a bare tunnel. The world names all of it — a room kind declares the
// kinds a plain dig turns up, how many of them, the richer set a den holds, how
// often a dig finds one, and which animal lives in it. The numbers below are
// only the fallback for a world that declares none.
const DIG_SPAWN_KINDS = ["root", "carrot", "worm"];
const DIG_SPAWN_MIN = 0;
const DEFAULT_DIG_SPAWN_MAX = 2;
const DEFAULT_DEN_CHANCE_IN = 5;
const DEFAULT_DEN_RESIDENT_CHANCE_IN = 3;
const DEN_ROOM_CLASS = "den";

// How far from the world's origin room a dig may carry it, when the origin
// writes no reach of its own. Without a cap a burrow sprawls in every direction
// at once, and an animal twenty hops out has nothing around it, no food it
// knows of, and no reason to be anywhere — the stranding this bound exists to
// stop. Six keeps every room inside one pathfinder search of the origin
// (mud-turn.mjs walks eight hops), so an animal standing at the frontier can
// always still walk home to the rooms with food in them.
const DEFAULT_DIG_REACH = 6;

/** The NEWEST value `subject` declares under `predicate`, as a number, or null
 *  when it declares none. Newest rather than first on purpose: the store is
 *  append-only, so a later write is the current truth — the same rule
 *  foldWorldState already applies to placements, and what lets an edit to one of
 *  these knobs take effect over the world's own seed fact. Pure. */
function declaredNumber(rows, subject, predicate) {
  const written = factObjects(rows, subject, predicate);
  if (!written.length) return null;
  const value = Number(written[written.length - 1]);
  return Number.isFinite(value) ? value : null;
}

/** A positive count `subject` declares under `predicate`, or `fallback` when it
 *  declares none (or writes something that is not a usable count). Pure. */
function declaredCountOr(rows, subject, predicate, fallback) {
  const written = declaredNumber(rows, subject, predicate);
  return written !== null && written > 0 ? written : fallback;
}

/** How many rooms out from its origin this world lets a dig reach — the origin
 *  room's own `mgx:dig-reach` fact, or the shipped default when it writes none.
 *  Pure. */
export function digReachOf(rows) {
  const origin = originRoomOf(rows);
  return origin ? declaredCountOr(rows, origin, DIG_REACH_PREDICATE, DEFAULT_DIG_REACH) : DEFAULT_DIG_REACH;
}

/** What one turn costs `subject` in mass, from a `mgx:mass-drain-per-turn` fact
 *  on its own class chain (so a whole species is tuned in one line, and one
 *  individual can still overrule its species by writing its own). Null when
 *  nothing in the chain declares one — a knob nobody set is not a reason to
 *  invent a number and starve something with it. Pure. */
export function massDrainPerTurnOf(rows, subject) {
  for (const kind of objectClassChain(rows, subject)) {
    const written = declaredNumber(rows, kind, MASS_DRAIN_PREDICATE);
    if (written !== null && written >= 0) return written;
  }
  return null;
}

// Which way a room of each kind can be dug, and what the room it opens is
// typed as. Above ground there is nothing to tunnel sideways through, so the
// only dig is straight down into the soil; below ground the burrow spreads
// across its own level and can surface again. Digging deeper is left out so
// the burrow stays the one level the soil cross-section draws.
const DIGGABLE_BY_ROOM_KIND = new Map([
  ["outdoor", new Map([["down", "underground-space"]])],
  ["underground", new Map([
    ["north", "underground-space"],
    ["south", "underground-space"],
    ["east", "underground-space"],
    ["west", "underground-space"],
    ["up", "outdoor-space"],
  ])],
  ["indoor", new Map()],
]);

const DIG_DECLINE_BY_ROOM_KIND = {
  outdoor: (room, direction) => (direction === "up"
    ? `there's nothing but sky above the ${room}.`
    : `you can't tunnel ${direction} out here — the ${room} is open ground, not soil to dig through. Dig down to get under it.`),
  underground: (room) => `the earth below the ${room} is packed solid — this burrow runs one level deep.`,
  indoor: (room, direction) => `you can't dig ${direction} out of the ${room}.`,
};

/** A room's own kind, from the rdf:type facts the world writes about it:
 *  "outdoor" (the surface), "underground" (the burrow), or "indoor" for a
 *  walled room that says neither. Pure. */
export function roomKindOf(rows, room) {
  const typedAs = (kind) => (rows || []).some((r) => r.subject === room && r.predicate === "rdf:type" && r.object === kind);
  if (typedAs("outdoor-space")) return "outdoor";
  if (typedAs("underground-space")) return "underground";
  return "indoor";
}

/** The room a world calls its origin — the one every dig is measured from — or
 *  null when it names none. A world with no origin fact is simply not bounded.
 *  Pure. */
export function originRoomOf(rows) {
  return (rows || []).find((r) => r.predicate === ORIGIN_PREDICATE && r.object === "true")?.subject ?? null;
}

/** How many exits a walk from the world's origin to `room` crosses, or null
 *  when the world declares no origin or no chain of exits joins the two. Pure. */
export function roomDistanceFromOrigin(rows, state, room) {
  const origin = originRoomOf(rows);
  if (!origin) return null;
  if (origin === room) return 0;
  const seen = new Set([origin]);
  let frontier = [origin];
  for (let distance = 1; frontier.length; distance += 1) {
    const next = [];
    for (const from of frontier) {
      for (const target of state.exits.get(from)?.values() ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        if (target === room) return distance;
        next.push(target);
      }
    }
    frontier = next;
  }
  return null;
}

/** True when `room` is as far from the origin as this world digs, or off the
 *  origin's map altogether. A freshly dug room's only other exit is the one
 *  back, so its distance is always this room's plus one — which makes the whole
 *  boundary test a property of where the digger stands, never of the direction
 *  it faces.
 *
 *  A room the origin cannot reach is the strictest case, not the loosest: it
 *  has no measurable distance, so nothing would ever stop it growing, and a
 *  burrow with no way home is precisely what the bound exists to prevent. A
 *  world that declares no origin at all is a different thing and stays
 *  unbounded. Pure. */
function atDigBoundary(rows, state, room) {
  if (!originRoomOf(rows)) return false;
  const distance = roomDistanceFromOrigin(rows, state, room);
  return distance === null || distance >= digReachOf(rows);
}

/** Every direction a dig could actually open a room in from `room`: allowed
 *  by the room's own kind, with no exit already written that way, and inside
 *  the world's dig boundary. This is the exact set the dig verb accepts, so a
 *  caller offering these as hints can never suggest a dig the verb would then
 *  refuse. Pure. */
export function diggableDirections(rows, state, room) {
  if (atDigBoundary(rows, state, room)) return [];
  const exits = state.exits.get(room);
  return [...(DIGGABLE_BY_ROOM_KIND.get(roomKindOf(rows, room)) ?? new Map()).keys()]
    .filter((direction) => !exits?.has(direction));
}

const FOOD_CLASS = "food";
// A shared reference mass standing in for per-species maxima until the game
// config carries them, and what an eaten thing is worth when the world wrote
// it no mass of its own.
const ASSUMED_FULL_MASS = 20;
const HUNGRY_FRACTION = 0.5;
const DEFAULT_FOOD_MASS = 1;

/** A stable small number for a string, so the same dig always opens the same
 *  room: this world writes no randomness anywhere, and a re-run that differed
 *  would make the fold's own history unreproducible. Pure. */
function stableIndex(seed, span) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.codePointAt(0)) % 100003;
  return h % span;
}

/** An unused id for a newly dug room, reading as the room it was dug from
 *  plus the direction ("garden-down"). A collision takes a numeric suffix, so
 *  digging never renames or overwrites a room that already stands. Pure. */
function freshRoomId(rows, here, direction) {
  const base = `${here}-${direction}`;
  const taken = (id) => (rows || []).some((r) => r.subject === id || r.object === id);
  if (!taken(base)) return base;
  for (let n = 2; n <= (rows || []).length + 2; n += 1) {
    if (!taken(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${(rows || []).length + 3}`;
}

/** An unused id for a freshly dug object, reading as its plain kind and a
 *  small number ("carrot-1"). The short id is what keeps a pouch readable:
 *  naming a spawned object after the room it came out of inherits that room's
 *  whole nested dig path ("carrot-sett-1-north-east-east"), which is an id, not
 *  a name anyone can read. `alsoTaken` holds the ids minted earlier in this
 *  same dig, which are not in `rows` yet. Pure. */
export function freshObjectId(rows, kind, alsoTaken = new Set()) {
  const taken = (id) => alsoTaken.has(id) || (rows || []).some((r) => r.subject === id || r.object === id);
  for (let n = 1; n <= (rows || []).length + 2; n += 1) {
    if (!taken(`${kind}-${n}`)) return `${kind}-${n}`;
  }
  return `${kind}-${(rows || []).length + 3}`;
}

/** The kinds a room kind declares for one of the spawn pools, in the order the
 *  fold hands them over, or `fallback` when it declares none. A pool is a set of
 *  rows, not a list, so the store keeps no rank between them and the order is
 *  the fold's content order rather than the order the world file lists them in.
 *  A caller that shows the whole pool can read it as it stands; one that takes
 *  only part of it wants preferredDigKinds below. Pure. */
function declaredKindsOr(rows, roomClass, predicate, fallback) {
  const declared = factObjects(rows, roomClass, predicate);
  return declared.length ? declared : fallback;
}

/** A dig pool ranked by what a dig should turn up first: the engine's own
 *  DIG_SPAWN_KINDS order, then content order for a kind it does not name.
 *
 *  A den shows everything it holds, so its pool needs no rank. A plain dig takes
 *  the first few, so which few it takes is a real choice — and the fact store
 *  holds the pool as a set, with no rank to read. Leaving it to the fold's own
 *  order would decide it alphabetically, which puts a kind the world already
 *  keeps as one hand-named prop ahead of one minted only by digging, and the
 *  point of a minted id is that it names something a hand-authored prop does
 *  not. Pure. */
function preferredDigKinds(kinds) {
  const rank = (kind) => {
    const at = DIG_SPAWN_KINDS.indexOf(kind);
    return at < 0 ? DIG_SPAWN_KINDS.length : at;
  };
  return kinds.slice().sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The mass row a freshly minted instance needs, copied off its own class, or
 *  nothing when the class declares no mass. eat reads the instance's mass, so a
 *  dug carrot with none would be worth the flat default however the world
 *  values a carrot. Pure. */
export function classMassFacts(rows, instance, kind) {
  const mass = factObjects(rows, kind, MASS_PREDICATE)[0];
  return mass ? [{ subject: instance, predicate: MASS_PREDICATE, object: mass }] : [];
}

/** What a dig reads like: a bare tunnel, a scrap or two in the loose earth, or
 *  a den — and, when somebody lives in it, who looked up. Pure. */
function digNarration(direction, { isDen, spawned, resident }) {
  const opened = isDen
    ? `you dig ${direction} and break into a den somebody hollowed out.`
    : `you dig ${direction} and open up a new room.`;
  const held = spawned.length
    ? ` ${isDen ? "Stored in it" : "In the loose earth"}: the ${spawned.join(", the ")}.`
    : " There's nothing in it but bare earth.";
  return `${opened}${held}${resident ? ` The ${resident} lives here, and looks up as you come through.` : ""}`;
}

/** What a thing should be CALLED on screen: its declared display name, else
 *  its own id. A dug object carries one so a pouch can list "carrot" while the
 *  world keeps the distinct id ("carrot-1") every verb resolves against. Pure. */
export function displayNameOf(rows, subject) {
  return factObjects(rows, subject, DISPLAY_NAME_PREDICATE)[0] ?? subject;
}

/** A container's open/locked status, stated plainly, and (only once already
 *  open) its visible contents — the one thing examine/talk's reused
 *  worldDigest call never states on its own, since mgx:is-open is a
 *  VIEW_EXCLUDED_PREDICATE. Never reads mgx:hidden-in facts: an unopened
 *  container's hidden contents stay exactly as hidden as `open` leaves them. */
function containerStatusPhrase(object, { state }) {
  const place = state.placements.get(object);
  if (place?.predicate === "mgx:stands-locked-in") return `the ${object} is locked.`;
  if (!state.openness.get(object)?.open) return `the ${object} is closed.`;
  const contents = [...state.placements]
    .filter(([, p]) => p.predicate === "mgx:located-in" && p.object === object)
    .map(([thing]) => thing)
    .sort();
  return contents.length
    ? `the ${object} is open — inside: the ${contents.join(", the ")}.`
    : `the ${object} is open. It's empty.`;
}

/** `object`'s own datatype facts (its placement predicate, its open/closed
 *  flag), as the tiny {subject,predicate,object} row set a "fact-value"
 *  precond needs — read from the already-folded CURRENT truth (state.
 *  placements/state.openness), never raw @turnN rows, so a superseded
 *  snapshot can never look current. domain.mjs's own stateFromFacts can't
 *  serve this: it keys "current" off an @stepN suffix (this world writes
 *  @turnN) and restricts rows to individuals typed into some action's
 *  SUBJECT class, which "furniture" (the container's own class) never is —
 *  a container's own facts about itself would silently vanish through it. */
function containerDatatypeState(state, object) {
  const rows = [];
  const place = state.placements.get(object);
  if (place) rows.push({ subject: object, predicate: place.predicate, object: place.object });
  const openness = state.openness.get(object);
  if (openness) rows.push({ subject: object, predicate: OPEN_PREDICATE, object: openness.open ? "true" : "false" });
  return rows;
}

/** The knowledge a person shares when talked to, resolved against the LIVE
 *  world fold this turn — never a frozen string, so it stays true as the
 *  world changes and honest when it doesn't know. `knows-where` reveals a
 *  thing's current location, a hidden one included: talking to the staff is
 *  the sanctioned way to learn a hiding place, while the where-is aside keeps
 *  declining. `knows-objective` states the quest. `knows-about` topics come
 *  back for the caller to digest, each one read from its newest surviving
 *  claim. Pure. */
export function personKnowledgeLines(rows, state, person) {
  const lines = [];
  for (const objective of factObjects(rows, person, "mgx:knows-objective")) {
    lines.push(`the ${objective} is what you're after — find it and carry it, and the adventure is won.`);
  }
  for (const thing of factObjects(rows, person, "mgx:knows-where")) {
    const place = state.placements.get(thing);
    if (!place) continue;
    lines.push(isTyped(rows, thing, "person")
      ? `you'll find the ${thing} in the ${place.object}.`
      : `the ${thing} is in the ${place.object}.`);
  }
  return { lines, aboutTopics: currentKnowsAboutTopics(rows, person, state?.epoch ?? 0) };
}

/** The FOOD_CLASS things `person` durably knows about — from being told, or
 *  from having examined them itself (the mgx:knows-about facts
 *  recordTold/recordExamined write, read back exactly like
 *  personKnowledgeLines's own aboutTopics), filtered to whatever's
 *  objectClassChain reaches "food". Unlike personKnowledgeLines's topics, a
 *  food query has no per-topic sub-digest to hand back, so this returns the
 *  plain list of known food things rather than a {lines, topics} pair. Pure. */
export function personKnownFoodLines(rows, state, person) {
  return currentKnowsAboutTopics(rows, person, state?.epoch ?? 0)
    .filter((thing) => objectClassChain(rows, thing).includes(FOOD_CLASS));
}

/** What a person can report from where they stand this turn — derived each
 *  turn, never stored: who and what shares their room, each container's
 *  open/locked status, and what unlocks a locked one there. Pure. */
export function personRoomReport(rows, state, person, actingSubject = "player") {
  const room = state.placements.get(person)?.object ?? null;
  if (!room) return "";
  const here = [...state.placements.keys()]
    .filter((s) => s !== person && s !== actingSubject && visibleRoomOf(s, { rows, state }) === room)
    .sort();
  const parts = [];
  if (here.length) parts.push(`here in the ${room}: the ${here.join(", the ")}.`);
  for (const thing of here) {
    if (!isContainer(rows, thing)) continue;
    parts.push(containerStatusPhrase(thing, { state }));
    const key = factObjects(rows, thing, "mgx:unlocks-with")[0];
    if (key && state.placements.get(thing)?.predicate === "mgx:stands-locked-in") {
      parts.push(`the ${thing} needs the ${key} to open.`);
    }
  }
  return parts.join(" ");
}

// ---- state-changing verb handlers --------------------------------------------
//
// One function per state-changing verb (or per shared-precondition group of
// verbs), keyed by name in STATE_VERB_HANDLERS below rather than chained as
// if/else-if branches: adding a verb means adding a table entry, never
// widening an existing conditional. Each handler takes the one `ctx` object
// runWorldCommand builds once per call — cmd, the current fold, the taught
// action family, and the shared `commit`/`noteFor` closures — so a handler
// reads exactly like the branch it replaces, just lifted to its own name.

async function handleGoVerb(ctx) {
  const { cmd, rows, state, here, k, family, commit, noteFor, memoryDir, world, cache, actingSubject } = ctx;
  const target = state.exits.get(here)?.get(cmd.direction);
  if (!target) {
    return answer(
      `there's no exit ${cmd.direction} from the ${here}.`,
      noteFor(`go — no mgx:has-exit-${cmd.direction} fact on ${here}; precondition declined by name`),
      { miss: true },
    );
  }
  // A predator eats whatever walks in, and the room it guards is the one
  // room a move never comes back from — so this write bypasses commit()
  // entirely: the auto-relook there would describe a room the mover is no
  // longer standing in, and the world has nobody left to look with.
  const predator = predatorIn(rows, state, target);
  if (predator) {
    await writeWorldTurn(memoryDir, world, k, [
      { subject: snapshotSubject(actingSubject, k, state.epoch), predicate: "mgx:currently-in", object: CONSUMED_PLACE },
    ], cache);
    return answer(
      `you go ${cmd.direction} into the ${target} — and the ${predator} is waiting. It eats the ${actingSubject}. That's the end of its run.`,
      noteFor(`go — the ${target} holds the predator ${predator}; ${actingSubject} is placed out of play at turn ${k} and takes no further turns`),
      { goal: `move through the world (eaten by the ${predator} in the ${target})` },
    );
  }
  return commit(
    [{ subject: snapshotSubject(actingSubject, k, state.epoch), predicate: familyEffectPredicate(family) ?? "mgx:currently-in", object: target }],
    `you go ${cmd.direction}. Now in the ${target}.`,
    `go — the taught "go" family fired; ${actingSubject} moves ${here} -> ${target}`,
    `move through the world (now in the ${target})`,
    target,
  );
}

async function handleTakeVerb(ctx) {
  const { rows, state, here, k, family, object, place, commit, noteFor, actingSubject } = ctx;
  if (isTyped(rows, object, "room")) {
    return answer(`you can't take the ${object} — it's a whole room.`, noteFor("take — the object is a room; declined"), { miss: true });
  }
  if (carriedBy(state, object, actingSubject)) {
    return answer(`you're already carrying the ${object}.`, noteFor("take — already carried; declined"), { miss: true });
  }
  if (place && (place.predicate === "mgx:fixed-in" || place.predicate === "mgx:stands-locked-in") && place.object === here) {
    return answer(
      `the ${object} is fixed in place — it can't be taken.`,
      noteFor(`take — ${object} is placed by ${place.predicate}, not portable; precondition declined by name`),
      { miss: true },
    );
  }
  if (place && place.predicate === "mgx:currently-in" && place.object === here) {
    return answer(`you can't take the ${object}.`, noteFor("take — the object is one of the cast; declined"), { miss: true });
  }
  if (visibleRoomOf(object, { rows, state }) !== here) {
    if (backgroundOnlyMention(rows, state, object)) {
      return answer(
        `the ${object} isn't something you can take — it's only mentioned in passing here, not a real prop in this scene.`,
        noteFor(`take — ${object} is a background-only mention, never a placed object; declined honestly`),
        { miss: true },
      );
    }
    return answer(`I don't see a ${object} here.`, noteFor(`take — ${object} isn't visible in the ${here}; declined, hidden things stay hidden`), { miss: true });
  }
  return commit(
    [{ subject: snapshotSubject(object, k, state.epoch), predicate: familyEffectPredicate(family) ?? "mgx:located-in", object: actingSubject }],
    `you take the ${object}.`,
    `take — the taught "take" family fired; ${object} is now carried`,
    `carry the ${object}`,
  );
}

async function handleDropOrGiveVerb(ctx) {
  const { cmd, rows, state, here, k, family, object, commit, noteFor, actingSubject } = ctx;
  if (!carriedBy(state, object, actingSubject)) {
    return answer(`you're not carrying the ${object}.`, noteFor(`${cmd.verb} — ${object} isn't carried; precondition declined by name`), { miss: true });
  }
  if (cmd.verb === "drop") {
    return commit(
      [{ subject: snapshotSubject(object, k, state.epoch), predicate: familyEffectPredicate(family) ?? "mgx:located-in", object: here }],
      `you drop the ${object} in the ${here}.`,
      `drop — the taught "drop" family fired; ${object} rests in the ${here}`,
      `set the ${object} down`,
    );
  }
  const receiver = cmd.indirectObject;
  if (!isCastMember(rows, state, receiver) || state.placements.get(receiver)?.object !== here) {
    return answer(`the ${receiver} isn't here.`, noteFor(`give — ${receiver} isn't one of the cast standing in the ${here}; precondition declined by name`), { miss: true });
  }
  return commit(
    [{ subject: snapshotSubject(object, k, state.epoch), predicate: familyEffectPredicate(family) ?? "mgx:located-in", object: receiver }],
    `you give the ${object} to the ${receiver}.`,
    `give — the taught "give" family fired; the ${receiver} holds the ${object}`,
    `hand the ${object} over`,
  );
}

async function handleDigVerb(ctx) {
  const { cmd, rows, state, here, k, commit, noteFor } = ctx;
  const direction = cmd.direction;
  if (state.exits.get(here)?.get(direction)) {
    return answer(
      `there's already an exit ${direction} from the ${here}.`,
      noteFor(`dig — an mgx:has-exit-${direction} fact already stands on ${here}; declined, a dig never overwrites an exit`),
      { miss: true },
    );
  }
  const back = OPPOSITE_DIRECTION.get(direction);
  if (!back) {
    return answer(
      `I don't know which way back a ${direction} tunnel would run.`,
      noteFor(`dig — "${direction}" has no opposite to write the return exit with; declined by name`),
      { miss: true },
    );
  }
  const roomKind = roomKindOf(rows, here);
  const dugKind = (DIGGABLE_BY_ROOM_KIND.get(roomKind) ?? new Map()).get(direction) ?? null;
  if (!dugKind) {
    return answer(
      DIG_DECLINE_BY_ROOM_KIND[roomKind](here, direction),
      noteFor(`dig — the ${here} is an ${roomKind} room, which cannot be dug ${direction}; declined by the room's own kind`),
      { miss: true },
    );
  }
  if (atDigBoundary(rows, state, here)) {
    const reach = roomDistanceFromOrigin(rows, state, here);
    return answer(
      `the earth ${direction} of the ${here} is packed hard and endless — you have reached the far edge of the burrow.`,
      noteFor(reach === null
        ? `dig — no chain of exits joins the ${here} to the ${originRoomOf(rows)}, so there is no distance to measure a dig against; declined`
        : `dig — the ${here} stands ${reach} rooms from the ${originRoomOf(rows)}, and this world digs ${digReachOf(rows)}; declined by distance from the origin`),
      { miss: true },
    );
  }
  const dug = freshRoomId(rows, here, direction);
  const denChanceIn = declaredCountOr(rows, dugKind, DEN_CHANCE_PREDICATE, DEFAULT_DEN_CHANCE_IN);
  const isDen = dugKind === "underground-space" && stableIndex(`den:${dug}`, denChanceIn) === 0;
  const spawnMax = declaredCountOr(rows, dugKind, DIG_SPAWN_MAX_PREDICATE, DEFAULT_DIG_SPAWN_MAX);
  const spawnCount = DIG_SPAWN_MIN + stableIndex(dug, spawnMax - DIG_SPAWN_MIN + 1);
  const spawnedKinds = isDen
    ? declaredKindsOr(rows, dugKind, DEN_SPAWN_PREDICATE, DIG_SPAWN_KINDS)
    : preferredDigKinds(declaredKindsOr(rows, dugKind, DIG_SPAWN_PREDICATE, DIG_SPAWN_KINDS)).slice(0, spawnCount);
  const minted = new Set();
  const spawned = spawnedKinds.map((kind) => {
    const id = freshObjectId(rows, kind, minted);
    minted.add(id);
    return id;
  });
  const residentChanceIn = declaredCountOr(rows, dugKind, DEN_RESIDENT_CHANCE_PREDICATE, DEFAULT_DEN_RESIDENT_CHANCE_IN);
  const residentKind = isDen && stableIndex(`resident:${dug}`, residentChanceIn) === 0
    ? factObjects(rows, dugKind, DEN_RESIDENT_PREDICATE)[0] ?? null
    : null;
  const resident = residentKind ? freshObjectId(rows, residentKind, minted) : null;
  return commit(
    [
      { subject: dug, predicate: "rdf:type", object: "room" },
      { subject: dug, predicate: "rdf:type", object: dugKind },
      ...(isDen ? [{ subject: dug, predicate: "rdf:type", object: DEN_ROOM_CLASS }] : []),
      { subject: here, predicate: `mgx:has-exit-${direction}`, object: dug },
      { subject: dug, predicate: `mgx:has-exit-${back}`, object: here },
      // Typed to its OWN kind, not a flat "portable" — a spawned kind the
      // world declares rdfs:subClassOf food needs its real class reachable
      // here for isFood's own objectClassChain walk, or digging up "carrot-1"
      // would still read as inedible scenery. The class's own mass copies
      // onto the instance for the same reason: eat reads the instance.
      ...spawnedKinds.flatMap((kind, i) => ([
        { subject: spawned[i], predicate: "rdf:type", object: kind },
        { subject: spawned[i], predicate: DISPLAY_NAME_PREDICATE, object: kind },
        { subject: spawned[i], predicate: "mgx:located-in", object: dug },
        ...classMassFacts(rows, spawned[i], kind),
      ])),
      // A resident is placed with currently-in, the predicate that makes an
      // individual one of the cast, and knows about what its own den holds —
      // so an animal that digs one out has somebody new to ask about food.
      ...(resident ? [
        { subject: resident, predicate: "rdf:type", object: residentKind },
        { subject: resident, predicate: DISPLAY_NAME_PREDICATE, object: residentKind },
        { subject: resident, predicate: "mgx:currently-in", object: dug },
        ...classMassFacts(rows, resident, residentKind),
        ...spawned.map((thing) => ({ subject: resident, predicate: KNOWS_ABOUT_PREDICATE, object: thing })),
      ] : []),
    ],
    digNarration(direction, { isDen, spawned, resident }),
    `dig — minted the ${isDen ? `${DEN_ROOM_CLASS} ` : ""}${dugKind} ${dug} with exits both ways (${direction} out, ${back} back)${spawned.length ? `, and ${spawned.length} object(s) in it` : ""}${resident ? `, lived in by ${resident}` : ""}; digging spends the turn, so the digger stays in the ${here}`,
    `dig ${direction} out of the ${here}`,
  );
}

async function handleEatVerb(ctx) {
  const { rows, state, here, k, object, commit, noteFor, memoryDir, cache, actingSubject } = ctx;
  const present = visibleRoomOf(object, { rows, state }) === here || carriedBy(state, object, actingSubject);
  if (!present) {
    return answer(
      `I don't see a ${object} here.`,
      noteFor(`eat — ${object} is neither visible in the ${here} nor carried; declined`),
      { miss: true },
    );
  }
  if (!objectClassChain(rows, object).includes(FOOD_CLASS)) {
    return answer(
      `the ${object} isn't food.`,
      noteFor(`eat — ${object}'s rdf:type/rdfs:subClassOf chain never reaches "${FOOD_CLASS}"; declined by name`),
      { miss: true },
    );
  }
  const eaterMass = state.masses.get(actingSubject)?.value ?? null;
  if (eaterMass !== null && eaterMass >= ASSUMED_FULL_MASS * HUNGRY_FRACTION) {
    return answer(
      `you're too full to eat the ${object}.`,
      noteFor(`eat — ${actingSubject} weighs ${eaterMass}, at or over half of ${ASSUMED_FULL_MASS}; declined by name`),
      { miss: true },
    );
  }
  const gained = state.masses.get(object)?.value ?? DEFAULT_FOOD_MASS;
  const grown = Math.round(((eaterMass ?? 0) + gained) * 100) / 100;
  // Eating is the one act that ends a thing, so the eater is the one witness
  // whose knowledge of it goes out of date on the spot. Every route into the
  // eat verb — a typed command, a scripted mud turn — passes here, so the
  // claim gets written once for all of them.
  await recordGone(memoryDir, { observer: actingSubject, thing: object, k, cache });
  return commit(
    [
      { subject: snapshotSubject(actingSubject, k, state.epoch), predicate: MASS_PREDICATE, object: String(grown) },
      { subject: snapshotSubject(object, k, state.epoch), predicate: "mgx:located-in", object: CONSUMED_PLACE },
    ],
    `you eat the ${object}. It adds ${gained} to your mass, so you weigh ${grown} now.`,
    `eat — the ${object}'s ${gained} mass moves onto ${actingSubject} (now ${grown}) and the ${object} leaves the world`,
    `eat the ${object}`,
  );
}

async function handlePutVerb(ctx) {
  const { cmd, rows, state, here, k, family, object, commit, noteFor, actingSubject } = ctx;
  const container = cmd.indirectObject;
  if (!carriedBy(state, object, actingSubject)) {
    return answer(
      `you're not carrying the ${object}.`,
      noteFor(`put — ${object} isn't carried; precondition declined by name`),
      { miss: true },
    );
  }
  if (visibleRoomOf(container, { rows, state }) !== here) {
    return answer(
      `I don't see a ${container} here.`,
      noteFor(`put — ${container} isn't visible in the ${here}; declined`),
      { miss: true },
    );
  }
  if (!isContainer(rows, container)) {
    return answer(
      `the ${container} doesn't hold things.`,
      noteFor(`put — no mgx:is-container fact on ${container}; declined by name`),
      { miss: true },
    );
  }
  if (!state.openness.get(container)?.open) {
    return answer(
      `the ${container} is closed.`,
      noteFor(`put — the ${container} isn't open; precondition declined by name`),
      { miss: true },
    );
  }
  return commit(
    [{ subject: snapshotSubject(object, k, state.epoch), predicate: familyEffectPredicate(family) ?? "mgx:located-in", object: container }],
    `you put the ${object} in the ${container}.`,
    `put — the taught "put" family fired; the ${object} now sits in the ${container}`,
    `put the ${object} in the ${container}`,
  );
}

// open / unlock / close — the container verbs, sharing one handler (all
// three keys in STATE_VERB_HANDLERS below point here) because they share a
// precondition: presence and container-ness stay hand-checked (visibility
// gating, not a state precondition), the same visibleRoomOf check
// examine/talk/take already use, not a hand-rolled duplicate. unlock's
// instrument match stays fully hand-written below it too — it needs a
// third, externally-supplied binding beyond subject/target, which this
// retrofit does not attempt. open/close's lock-state and open/closed
// checks, and their mgx:is-open write, are taught "fact-value" precond/
// effect rows consulted through domain.mjs; only the hidden-contents
// reveal (a variable-arity effect over a discovered set) stays hand-written
// JS, since no shipped rule shape covers that either.
async function handleContainerVerb(ctx) {
  const { cmd, rows, state, here, k, object, place, commit, noteFor, ruleRows } = ctx;
  if (visibleRoomOf(object, { rows, state }) !== here) {
    return answer(`I don't see a ${object} here.`, noteFor(`${cmd.verb} — ${object} isn't in the ${here}; declined`), { miss: true });
  }
  if (!isContainer(rows, object)) {
    return answer(`the ${object} doesn't open.`, noteFor(`${cmd.verb} — no mgx:is-container fact on ${object}; declined by name`), { miss: true });
  }

  if (cmd.verb === "open" || cmd.verb === "close") {
    const domain = compileDomain(rows, ruleRows);
    const taughtAction = domain.actions.find((a) => a.name === cmd.verb);
    const effect = taughtAction?.effects.find((e) => e.predicate === OPEN_PREDICATE);
    if (!effect) {
      return answer(
        `this world doesn't teach how ${cmd.verb === "open" ? "opening" : "closing"} changes the ${object}.`,
        noteFor(`${cmd.verb} — the taught "${cmd.verb}" family carries no ${OPEN_PREDICATE} effect; honest decline`),
        { miss: true },
      );
    }
    const factState = containerDatatypeState(state, object);
    const failed = taughtAction.preconds.find((p) => !precondHolds(p, ctx.actingSubject, object, factState, domain));
    if (failed) {
      const text = failed.predicate === "mgx:stands-locked-in"
        ? `the ${object} is locked.`
        : cmd.verb === "open" ? `the ${object} is already open.` : `the ${object} isn't open.`;
      return answer(text, noteFor(`${cmd.verb} — the taught "${cmd.verb}" family's ${failed.predicate} precondition declined by name`), { miss: true });
    }
    const effSubject = roleBinding(effect.subjectRole, ctx.actingSubject, object, domain);
    const writeIsOpen = { subject: snapshotSubject(effSubject, k, state.epoch), predicate: effect.predicate, object: effect.value };

    if (cmd.verb === "open") {
      const revealed = [...state.placements]
        .filter(([, p]) => p.predicate === "mgx:hidden-in" && p.object === object)
        .map(([thing]) => thing)
        .sort();
      return commit(
        [
          writeIsOpen,
          ...revealed.map((thing) => ({ subject: snapshotSubject(thing, k, state.epoch), predicate: "mgx:located-in", object })),
        ],
        revealed.length
          ? `you open the ${object} — inside: the ${revealed.join(", the ")}.`
          : `you open the ${object}. It's empty.`,
        `open — ${object} opens${revealed.length ? `, revealing ${revealed.join(", ")}` : ""} via the taught "open" family's effect`,
        `open the ${object}`,
      );
    }
    return commit(
      [writeIsOpen],
      `you close the ${object}.`,
      `close — ${object} closes via the taught "close" family's effect`,
      `close the ${object}`,
    );
  }

  // unlock
  if (place.predicate !== "mgx:stands-locked-in") {
    return answer(`the ${object} isn't locked.`, noteFor("unlock — not locked; declined"), { miss: true });
  }
  if (!cmd.instrument) {
    return answer(
      `unlock the ${object} with what? Name the thing to use, e.g. "unlock the ${object} with the key".`,
      noteFor("unlock — no instrument named; asked, never guessed"),
      { miss: true },
    );
  }
  const required = factObjects(rows, object, "mgx:unlocks-with")[0] ?? null;
  if (!required) {
    return answer(
      `nothing in this world says what unlocks the ${object}.`,
      noteFor(`unlock — no mgx:unlocks-with fact on ${object}; honest decline`),
      { miss: true },
    );
  }
  if (!carriedBy(state, cmd.instrument, ctx.actingSubject)) {
    return answer(
      `you're not carrying the ${cmd.instrument}.`,
      noteFor(`unlock — the ${cmd.instrument} isn't carried; precondition declined by name`),
      { miss: true },
    );
  }
  if (cmd.instrument !== required) {
    return answer(
      `the ${cmd.instrument} doesn't fit the ${object}'s lock.`,
      noteFor(`unlock — the taught instrument is ${required}, not ${cmd.instrument}; declined by name`),
      { miss: true },
    );
  }
  return commit(
    [{ subject: snapshotSubject(object, k, state.epoch), predicate: "mgx:fixed-in", object: here }],
    `you unlock the ${object} with the ${required}.`,
    `unlock — the lock releases; ${object} now stands unlocked (still fixed) in the ${here}`,
    `unlock the ${object}`,
  );
}

// The data-driven verb table itself: every state-changing verb this engine
// knows, mapped to the handler that runs it. A world's own taught action
// family (checked before this table is ever consulted) decides whether the
// verb exists in THIS world; this table decides which JS runs once it does.
const STATE_VERB_HANDLERS = {
  go: handleGoVerb,
  take: handleTakeVerb,
  drop: handleDropOrGiveVerb,
  give: handleDropOrGiveVerb,
  dig: handleDigVerb,
  eat: handleEatVerb,
  put: handlePutVerb,
  open: handleContainerVerb,
  close: handleContainerVerb,
  unlock: handleContainerVerb,
};

export async function runWorldCommand(cmd, { world, memoryDir, env, graph, cache, actingSubject = "player" }) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const state = foldWorldState(worldActionRows(rows));
  const here = state.placements.get(actingSubject)?.object ?? null;
  const noteFor = (detail) => `ADVENTURE — ${detail}`;

  if (cmd.residue?.length) {
    return answer(
      `I don't know the word "${cmd.residue[0]}" — it isn't in my vocabulary.`,
      noteFor(`the imperative parsed but "${cmd.residue[0]}" is undeclared; honest decline, never a guess`),
      { miss: true },
    );
  }
  if (!here) {
    return answer(
      "the world has no written player position — reload it with its opening line.",
      noteFor("no player placement fact; declined"),
      { miss: true },
    );
  }
  if (OUT_OF_PLAY_PLACES.has(here)) {
    return answer(
      `${outOfPlayPhrase(actingSubject, here)} — it takes no more turns in this world.`,
      noteFor(`${cmd.verb} — ${actingSubject} is placed out of play (${here}); every command it gives declines from here on`),
      { miss: true },
    );
  }

  if (cmd.verb === "look" && !cmd.object) {
    const digest = await worldDigest(here, { memoryDir, memory, rows, state, graph, actingSubject });
    const actions = roomAffordances(rows, state, here, actingSubject);
    return answer(
      `${digest ?? `you are in the ${here}. Nothing more about it is written down yet.`}${affordanceSuffix(actions)}`,
      noteFor(`look — an extractive completions digest over the current world facts mentioning "${here}"; appended the room's roomAffordances action list`),
      { goal: `look around the ${here}` },
    );
  }

  if (cmd.verb === "examine" || cmd.verb === "talk" || cmd.verb === "look") {
    const object = cmd.object;
    // A carried object has no room to be "visible in" (visibleRoomOf returns
    // null for anything held by the player) — examine and look still apply to
    // it, the same way "what am I carrying" already reads inventory contents.
    // talk has no carried exception: NPCs are never portable.
    const carried = (cmd.verb === "examine" || cmd.verb === "look") && carriedBy(state, object, actingSubject);
    // The room the player is standing in is never the SUBJECT of a placement
    // fact (only ever the OBJECT other things are placed in), so
    // visibleRoomOf(object) can never equal `here` for a room's own name —
    // "examine the study" while standing in the study would otherwise
    // decline "I don't see a study here", which reads as the room not
    // existing rather than the true state (you're in it). Treat naming the
    // current room itself as always present.
    const isCurrentRoom = object === here;
    const notHere = !carried && !isCurrentRoom && visibleRoomOf(object, { rows, state }) !== here;
    // A background-only mention (e.g. "flower", surfaced only through the
    // human corpus overlapping this room's own vocabulary — see
    // backgroundOnlyMention's own docblock) is real, sourced knowledge, just
    // never a placed prop. "talk" still declines (it's not a person), but
    // honestly — never claiming the term doesn't exist when the room's own
    // digest just said otherwise. "examine" instead falls through to the
    // ordinary digest below, the same one "what is a flower" already answers
    // from outside the game.
    if (notHere && cmd.verb === "talk" && backgroundOnlyMention(rows, state, object)) {
      return answer(
        `the ${object} isn't someone you can talk to here — it's only mentioned in passing, not a real person in this scene.`,
        noteFor(`talk — ${object} is a background-only mention, not a placed NPC; declined honestly`),
        { miss: true },
      );
    }
    if (notHere && !((cmd.verb === "examine" || cmd.verb === "look") && backgroundOnlyMention(rows, state, object))) {
      return answer(
        `I don't see a ${object} here.`,
        noteFor(`${cmd.verb} — ${object} isn't visible in the ${here}; declined, hidden things stay hidden`),
        { miss: true },
      );
    }
    const person = isCastMember(rows, state, object);
    // "look <object>" on a real placed prop is the grounded close look: every
    // physical fact the world writes about the thing (its placement, its
    // within-room position, any datatype property — all via the SAME
    // worldDigestRows view that already drops the puzzle wiring and the
    // staff-knowledge pointers), plus its class hierarchy as an is-a chain,
    // plus a container's open/locked state. A background-only mention has no
    // placed facts of its own, so it falls through to the examine digest below
    // (the same general-knowledge answer "what is a flower" gives).
    if (cmd.verb === "look" && !backgroundOnlyMention(rows, state, object)) {
      const propLines = objectLookProperties(rows, state, object, actingSubject);
      const chain = objectClassChain(rows, object);
      const parts = [`you look closely at the ${object}.`];
      if (propLines.length) parts.push(propLines.join(" "));
      if (chain.length > 1) parts.push(`Class: ${chain.join(" → ")}.`);
      if (!person && isContainer(rows, object)) parts.push(containerStatusPhrase(object, { state }));
      return answer(
        parts.join(" "),
        noteFor(`look at ${object} — its world-fact properties (via worldDigestRows, knows-*/puzzle-wiring excluded) and its rdf:type/subClassOf is-a chain`),
        { goal: `take a closer look at the ${object}` },
      );
    }
    // Talking to a person is the game's reveal channel: the staff share what
    // they know (a hiding place, the quest, a topic) and report their own
    // room, all resolved from the live fold this turn.
    if (cmd.verb === "talk" && person) {
      const { lines, aboutTopics } = personKnowledgeLines(rows, state, object);
      const aboutLines = [];
      for (const topic of aboutTopics) {
        const digested = await worldDigest(topic, { memoryDir, memory, rows, state, graph, actingSubject });
        if (digested) aboutLines.push(digested);
      }
      const report = personRoomReport(rows, state, object, actingSubject);
      const said = [...lines, ...aboutLines, report].filter(Boolean).join(" ");
      return answer(
        said ? `the ${object} says: ${said}` : `the ${object} has nothing to tell you right now.`,
        noteFor(`talk — the ${object}'s live knowledge (knows-where/objective/about from the current fold) and a derived room report`),
        { goal: `talk to the ${object}` },
      );
    }
    const digest = await worldDigest(object, { memoryDir, memory, rows, state, graph, actingSubject });
    // A thing that IS here with nothing written about it, and a word that only
    // turns up in the room's own prose, are different answers. Sharing one line
    // let "look at the door" reply "nothing more about the door is written down
    // yet" in a house whose world model has no door at all, which reads as
    // confirmation that a door is standing there.
    const body = digest ?? (notHere
      ? `there's no ${object} here — the word turns up in what's written about this place, but nothing by that name is in the scene.`
      : `nothing more about the ${object} is written down yet.`);
    const containerNote = !person && isContainer(rows, object) ? ` ${containerStatusPhrase(object, { state })}` : "";
    // Framing follows the VERB the player typed, not the object's type: talking
    // to a lamp still reads as an attempted conversation (nothing replies, but
    // you learn what's known), and examining a person still reads as a plain
    // inspection, never the "doesn't have much to say" framing that belongs to
    // a failed talk attempt.
    const text = cmd.verb === "talk" ? `the ${object} doesn't have much to say, but you know: ${body}` : `${body}${containerNote}`;
    return answer(
      text,
      noteFor(`${cmd.verb} — an extractive completions digest over the current world facts mentioning "${object}"`),
      { goal: cmd.verb === "talk" ? `talk to the ${object}` : `take a closer look at the ${object}` },
    );
  }

  const ruleRows = readRuleRows(memory);
  const families = actionFamilies(ruleRows);
  const family = families.get(cmd.verb);
  if (!family) {
    return answer(
      `this world doesn't teach the verb "${cmd.verb}" — its action family isn't loaded.`,
      noteFor(`no "${cmd.verb}" action family in the store; honest decline`),
      { miss: true },
    );
  }
  const k = state.turnCount + 1;
  const commit = async (facts, text, detail, goal, playerRoomAfter = here) => {
    // The NPC pass rides every SUCCESSFUL state-changing command, in the same
    // turn, after the player's own effect. Its schedule preconditions read
    // the pre-command placements (an NPC's turn-gated move never depends on
    // what the player just wrote); the observability lines read the player's
    // post-command room, so walking into a room as an NPC arrives is seen.
    const npcPass = runNpcPass({ rows, state, k, families, playerRoomAfter });
    await writeWorldTurn(memoryDir, world, k, [...facts, ...npcPass.writes], cache);
    const text2 = npcPass.lines.length ? `${text} ${npcPass.lines.join(" ")}` : text;
    const relook = await worldRelook(playerRoomAfter, { memoryDir, graph, actingSubject });
    return answer(
      `${text2} ${relook}`,
      noteFor(`${detail}; turn ${k} snapshots written through appendFacts${npcPass.writes.length ? `; NPC pass fired ${npcPass.writes.length} scheduled move(s)` : ""}; auto-relook appended for the ${playerRoomAfter}`),
      { goal },
    );
  };
  const object = cmd.object;
  const place = object ? state.placements.get(object) ?? null : null;

  const handler = STATE_VERB_HANDLERS[cmd.verb];
  if (!handler) {
    return answer(
      `this world doesn't know how to run the verb "${cmd.verb}" yet.`,
      noteFor(`${cmd.verb} — a taught family exists but no handler is wired for it; honest decline`),
      { miss: true },
    );
  }
  return handler({
    cmd, rows, state, here, k, family, families, ruleRows, object, place,
    commit, noteFor, actingSubject, memoryDir, world, cache, graph, memory,
  });
}

// A mid-game "where is X" aside. Optional trailing "now": the question means
// the same with or without it, and the fold IS the now.
const WORLD_WHERE_RE = /^where(?:'s|\s+is|\s+are)\s+(?:the\s+|a\s+|an\s+)?(.+?)(?:\s+now)?[?.!\s]*$/i;

// A mid-game "is X open/closed" aside. mgx:is-open is a datatype fact
// ("true"/"false"), so the generic ask engine's adjective/property reader —
// which looks for a CLASS/adjective membership fact, not a literal value —
// has nothing to match and answers "I don't have a fact saying X", reading
// as an epistemic gap even though the negation is fully known (the taught
// effect wrote the opposite value). This aside reads state.openness directly,
// the same fold containerStatusPhrase already reads for "look"/"examine".
const WORLD_IS_OPEN_RE = /^is\s+(?:the\s+|a\s+|an\s+)?(.+?)\s+(open|closed|shut)[?.!\s]*$/i;

/** A locative aside about a placed world thing, answered from the SAME @turnN
 *  fold every other world reader uses — never the raw base rows, whose
 *  superseded placements would answer where things stood at load time. Null
 *  when the asked thing has no placement in the world, so an ordinary
 *  locative question (a code symbol, a taught board piece) keeps its lane. A
 *  hidden thing is declined without naming its hiding place. */
async function worldWhereAnswer(line, { memoryDir, actingSubject = "player" }) {
  const m = String(line).match(WORLD_WHERE_RE);
  if (!m) return null;
  const thing = normFactTerm(m[1]);
  let rows;
  try { rows = readFactRows(await loadMemory(memoryDir)); } catch { return null; }
  const state = foldWorldState(worldActionRows(rows));
  const place = state.placements.get(thing);
  if (!place) return null;
  if (place.predicate === "mgx:hidden-in") {
    return answer(
      `nothing you've seen says where the ${thing} is. Someone in the house may know — try talking to the staff.`,
      `ADVENTURE — where-aside: ${thing} is hidden; declined without naming the hiding place, pointed at the talk lane`,
      { miss: true, goal: `locate the ${thing}` },
    );
  }
  if (OUT_OF_PLAY_PLACES.has(place.object)) {
    return answer(
      `${outOfPlayPhrase(thing, place.object)} — it's gone from the world.`,
      `ADVENTURE — where-aside: ${thing} is out of play (${place.object}), so it has no place left to name`,
      { goal: `locate the ${thing}` },
    );
  }
  if (thing === actingSubject) {
    return answer(
      `you are in the ${place.object}.`,
      "ADVENTURE — where-aside: the player's own room, from the current world fold",
      { goal: "check where you are" },
    );
  }
  if (place.object === actingSubject) {
    return answer(
      `you are carrying the ${thing}.`,
      `ADVENTURE — where-aside: ${thing} is carried, from the current world fold`,
      { goal: `locate the ${thing}` },
    );
  }
  return answer(
    `the ${thing} is in the ${place.object}.`,
    `ADVENTURE — where-aside: ${thing}'s current placement from the world fold (as of turn ${place.turn})`,
    { goal: `locate the ${thing}` },
  );
}

/** A mid-game "is X open/closed" aside, read from state.openness — the same
 *  fold "look"/"examine" already phrase via containerStatusPhrase. Null when
 *  the named thing has no openness fact at all (never a container, or one
 *  never opened/closed this session), so an ordinary ask keeps its lane. */
async function worldOpennessAnswer(line, { memoryDir }) {
  const m = String(line).match(WORLD_IS_OPEN_RE);
  if (!m) return null;
  const thing = normFactTerm(m[1]);
  const askedOpen = /^open$/i.test(m[2]);
  let rows;
  try { rows = readFactRows(await loadMemory(memoryDir)); } catch { return null; }
  const state = foldWorldState(worldActionRows(rows));
  const openness = state.openness.get(thing);
  if (!openness) return null;
  const matches = askedOpen ? openness.open : !openness.open;
  return answer(
    `${matches ? "yes" : "no"} — the ${thing} is ${openness.open ? "open" : "closed"}.`,
    `ADVENTURE — is-open-aside: ${thing}'s current openness from the world fold (as of turn ${openness.turn})`,
    { goal: `check whether the ${thing} is ${m[2].toLowerCase()}` },
  );
}

// The in-game orientation asides — "where am I", "what can I do", "what is the
// quest/goal". Without a world-state answer these fall through to the ordinary
// lanes and misroute: "where am I" reads "I" as a module name, "what can I do"
// walls, and "what is the goal" answers from corpus vocabulary about the word
// "goal". A live world answers each from its own fold first.
const WORLD_WHERE_AM_I_RE = /^where\s+am\s+i(?:\s+now)?[?.!\s]*$/i;
const WORLD_OPTIONS_RE = /^(?:what\s+can\s+i\s+do(?:\s+(?:here|now))?|what\s+are\s+my\s+options|what\s+(?:should|do)\s+i\s+do(?:\s+(?:here|now))?|what\s+now)[?.!\s]*$/i;
const WORLD_QUEST_RE = /^(?:what(?:'s|\s+is)\s+(?:the\s+|my\s+)?(?:quest|goal|objective|mission|aim)|what\s+am\s+i\s+(?:trying\s+to\s+do|(?:supposed|meant)\s+to\s+do)|what\s+do\s+i\s+do\s+here)[?.!\s]*$/i;
// "what am I doing" — the RECOGNITION question, and a different one from
// WORLD_QUEST_RE's "what is my goal". That asks what the world declared; this
// asks what THIS run's own moves fit. The two live side by side because the
// answers can honestly disagree: a player heading somewhere the world never
// marked has a real goal and no declared one.
const WORLD_RECOGNIZE_RE = /^(?:what\s+am\s+i\s+doing(?:\s+(?:here|now))?|what\s+have\s+i\s+been\s+doing|what\s+was\s+i\s+doing)[?.!\s]*$/i;
// "what is the housekeeper doing" — the same recognizer, over that character's
// own @turnN rows. An NPC's scheduled move writes the same snapshot a player
// move writes, so nothing here is NPC-specific beyond which actor's steps the
// trace reads.
const WORLD_RECOGNIZE_OTHER_RE = /^what(?:'s|\s+is|\s+are)\s+(?:the\s+)?(.+?)\s+doing(?:\s+(?:here|now))?[?.!\s]*$/i;
// "who is here" — the room's cast, the question a shared world invites the
// moment a second animal walks in. Answered from the same currently-in
// placements the talk verb resolves against, so who is named is exactly who
// can be talked to.
const WORLD_WHO_HERE_RE =
  /^(?:who(?:'s|\s+is|\s+are)\s+(?:else\s+)?(?:here|in\s+(?:the\s+|this\s+)?room|with\s+me)|who\s+else\s+is\s+(?:here|around))[?.!\s]*$/i;
// "what food do you know about" and its natural variants — the asking
// character's OWN durable food knowledge (personKnownFoodLines), never the
// whole world's food. The trailing "about" is optional, "know" swaps for
// "found"/"seen"/"heard about", and the "what do you know about food"
// inversion and a plain yes/no lead-in both count: every one of these is the
// same question, and a phrasing this lane doesn't recognise leaves the world
// entirely and comes back answered as vocabulary.
const WORLD_KNOWN_FOOD_RE = new RegExp(
  "^(?:"
  + "what\\s+foods?\\s+(?:do\\s+you\\s+know(?:\\s+about)?|have\\s+you\\s+(?:found|seen|heard\\s+(?:about|of))|do\\s+you\\s+know\\s+of)"
  + "|what\\s+do\\s+you\\s+know\\s+about\\s+(?:any\\s+)?foods?"
  + "|do\\s+you\\s+know\\s+(?:about|of)\\s+(?:any\\s+)?foods?"
  + "|where\\s+is\\s+(?:the\\s+)?food"
  + ")[?.!\\s]*$",
  "i",
);

// A recognition tie lists its survivors with a short Oxford-comma "or" join —
// the same shape chat.mjs's own joinOr produces for a discourse tie, kept as a
// small local copy rather than an import across the file boundary.
const joinOr = (a) => (a.length > 2 ? `${a.slice(0, -1).join(", ")}, or ${a[a.length - 1]}`
  : a.length === 2 ? `${a[0]} or ${a[1]}` : (a[0] ?? ""));

/** One subject's own @turnN (or @epochE@turnN) rows out of a wider row set —
 *  what traceOfWorldRows folds into a step list. traceOfWorldRows reads
 *  whatever rows it is given; narrowing to one subject here is what keeps a
 *  "what am I doing" trace from reading another actor's moves as its own. */
function subjectSnapshotRows(rows, subject) {
  return (rows || []).filter((row) => parseSnapshotSubject(row.subject)?.base === subject);
}

/** The world's own cast member `spoken` names, matched by plain id (worlds
 *  name their cast in plain lowercase words — "housekeeper", "gardener" —
 *  same as any other individual), or null when nobody in this world goes by
 *  that name. */
function resolveCastMemberByName(rows, state, spoken) {
  const norm = String(spoken).trim().toLowerCase();
  if (!norm) return null;
  return worldIndividualNames(rows).find((id) => id.toLowerCase() === norm && isCastMember(rows, state, id)) ?? null;
}

/** `subject`'s room BEFORE any observed step — the base (unstamped) row a
 *  world writes at turn 0, ignoring every later @turnN move. A recognition
 *  plan has to start where the trace itself starts: expandWorldGoal's search
 *  from the subject's CURRENT room would return only the few steps still
 *  left to take, which a trace of the moves already made can never fit. */
function subjectStartRoom(actionRows, subject) {
  const baseRows = actionRows.filter((row) => !parseSnapshotSubject(row.subject));
  return foldWorldState(baseRows).placements.get(subject)?.object ?? null;
}

/** The recognition surface's four outcomes — recognized, tied, reject, or
 *  nothing observed yet — over `subject`'s own trace. `thirdPerson` renders
 *  the same recognition in the third person for an NPC intent question
 *  instead of the player's own "what am I doing". Only world and taught goals
 *  are in play here (`tools: []` screens out the tool/maintenance goals a
 *  world never declares), so "the goals this world declares" names what it
 *  actually reads as declared, not the whole router's registry. */
function recognitionOutcomeAnswer(subject, { actionRows, ruleRows, state, thirdPerson }) {
  const trace = traceOfWorldRows(subjectSnapshotRows(actionRows, subject), { actor: subject });
  if (!trace.length) {
    return answer(
      "you haven't done anything yet — make a move and ask again.",
      `ADVENTURE — recognition aside: no observed step for ${subject} yet`,
      { goal: "see what I'm recognized as doing" },
    );
  }
  const goals = declaredGoals({ worldRows: actionRows, ruleRows }, { tools: [] });
  const origin = subjectStartRoom(actionRows, subject);
  const expand = (goal) => (origin ? expandWorldGoal(goal, { here: origin, exposedRows: actionRows, exposedState: state }) : []);
  const r = recognizeGoal(trace, goals, { expand });
  const note = `ADVENTURE — recognition aside: ${trace.length} observed step(s) against ${goals.length} declared goal(s); ${r.why}`;

  if (r.goal) {
    const target = r.goal.label.replace(/^carry /, "");
    const text = thirdPerson
      ? `the ${subject} is heading for ${target} — the last ${trace.length} moves it made are a subsequence of the route that gets there.`
      : `you're heading for ${target} — your last ${trace.length} move${trace.length === 1 ? "" : "s"} ${trace.length === 1 ? "is" : "are"} a subsequence of the route that gets you there.`;
    return answer(text, note, { goal: "see what I'm recognized as doing" });
  }
  if (r.reject) {
    const text = thirdPerson
      ? `nothing the ${subject} has done fits any of the ${goals.length} goals this world declares.`
      : `nothing you've done so far fits any of the ${goals.length} goals this world declares. Say "what is my goal" to see what it does declare.`;
    return answer(text, note, { miss: true, goal: "see what I'm recognized as doing" });
  }
  const labels = r.ambiguous.map((g) => g.label);
  const text = thirdPerson
    ? `what the ${subject} has done so far fits ${labels.length} goals equally well: ${joinOr(labels)}. A few more moves would tell them apart.`
    : `what you've done so far fits ${labels.length} goals equally well: ${joinOr(labels)}. A few more moves would tell them apart, so I won't pick one.`;
  return answer(text, note, { goal: "see what I'm recognized as doing" });
}

/** The in-game orientation asides, answered from the world fold: the player's
 *  room, the room's real affordances, the world's objective, and what a
 *  trace — the player's own, or a named character's — is recognized as
 *  doing. Null when the line is none of them, so an ordinary question keeps
 *  its lane. */
async function worldContextAnswer(line, { memoryDir, actingSubject = "player" }) {
  const l = String(line).trim();
  const asksWhere = WORLD_WHERE_AM_I_RE.test(l);
  const asksOptions = WORLD_OPTIONS_RE.test(l);
  const asksQuest = WORLD_QUEST_RE.test(l);
  const asksWhoIsHere = WORLD_WHO_HERE_RE.test(l);
  const asksRecognize = WORLD_RECOGNIZE_RE.test(l);
  const recognizeOther = WORLD_RECOGNIZE_OTHER_RE.exec(l);
  if (!asksWhere && !asksOptions && !asksQuest && !asksWhoIsHere && !asksRecognize && !recognizeOther) return null;
  let memory;
  try { memory = await loadMemory(memoryDir); } catch { return null; }
  const rows = readFactRows(memory);
  const state = foldWorldState(worldActionRows(rows));
  const here = state.placements.get(actingSubject)?.object ?? null;

  if (asksWhoIsHere) {
    const cast = here ? castInRoom(rows, state, here, actingSubject) : [];
    return answer(
      cast.length
        ? `here with you in the ${here}: the ${cast.join(", the ")}. You can talk to ${cast.length > 1 ? "any of them" : `the ${cast[0]}`}.`
        : `nobody else is${here ? ` in the ${here}` : " here"} right now.`,
      `ADVENTURE — who-is-here aside: the ${here}'s cast from the current placements fold, the same set the talk verb resolves against`,
      { goal: "see who else is here" },
    );
  }

  if (asksWhere) {
    return here
      ? answer(`you are in the ${here}.`, "ADVENTURE — where-am-I aside: the player's own room from the current world fold", { goal: "check where you are" })
      : answer("the world has no written player position yet.", "ADVENTURE — where-am-I aside: no player placement", { miss: true, goal: "check where you are" });
  }

  if (asksOptions) {
    const actions = here ? roomAffordances(rows, state, here, actingSubject) : [];
    return answer(
      actions.length ? `you can: ${actions.join(", ")}.` : `nothing obvious here — say "look" to look around${here ? ` the ${here}` : ""}.`,
      `ADVENTURE — options aside: the ${here}'s roomAffordances, the same list "look" appends`,
      { goal: "see what you can do here" },
    );
  }

  if (asksRecognize) {
    const actionRows = worldActionRows(rows);
    const ruleRows = readRuleRows(memory);
    return recognitionOutcomeAnswer(actingSubject, { actionRows, ruleRows, state, thirdPerson: false });
  }

  if (recognizeOther) {
    const spoken = recognizeOther[1].trim();
    const resolved = resolveCastMemberByName(rows, state, spoken);
    if (!resolved) {
      return answer(
        `there's nobody called "${spoken}" in this world.`,
        `ADVENTURE — recognition aside: "${spoken}" resolves to no cast member this world names`,
        { miss: true },
      );
    }
    const actionRows = worldActionRows(rows);
    const ruleRows = readRuleRows(memory);
    return recognitionOutcomeAnswer(resolved, { actionRows, ruleRows, state, thirdPerson: true });
  }

  const objectiveId = rows.find((r) => r.predicate === "mgx:is-objective" && r.object === "true")?.subject ?? null;
  return objectiveId
    ? answer(
        `your goal is to find the ${objectiveId} and pick it up.`,
        `ADVENTURE — quest aside: the world's objective (${objectiveId}), named without spoiling where it is`,
        { goal: `find the ${objectiveId}` },
      )
    : answer(
        `this world sets no explicit goal — explore it, and say "look" to see your options.`,
        "ADVENTURE — quest aside: no objective marker in this world",
        { goal: "explore the world" },
      );
}

/** "what food do you know about" — the ASKING character's own durable food
 *  knowledge, read from the same mgx:knows-about facts recordTold/
 *  recordExamined write (personKnownFoodLines). An honest "you don't know of
 *  any food yet" when none is known — a real, on-topic answer, not a miss,
 *  the same convention inventoryAnswer's own empty-carry case already uses.
 *  Null when the line isn't this aside, so an ordinary question keeps its
 *  lane. */
async function worldKnownFoodAnswer(line, { memoryDir, actingSubject = "player" }) {
  const l = String(line).trim();
  if (!WORLD_KNOWN_FOOD_RE.test(l)) return null;
  let rows;
  try { rows = readFactRows(await loadMemory(memoryDir)); } catch { return null; }
  const state = foldWorldState(worldActionRows(rows));
  const foods = personKnownFoodLines(rows, state, actingSubject);
  if (!foods.length) {
    return answer(
      "you don't know of any food yet.",
      `ADVENTURE — known-food aside: ${actingSubject}'s mgx:knows-about facts reach no food-classed thing; the honest empty answer`,
      { goal: "check what food you know about" },
    );
  }
  return answer(
    `you know about: the ${foods.join(", the ")}.`,
    `ADVENTURE — known-food aside: ${actingSubject}'s durable mgx:knows-about facts, filtered to the food class`,
    { goal: "check what food you know about" },
  );
}

// A question that names one of the world's OWN minted ids — "sett-1",
// "groundhog-1", "carrot-2" — can only be about this world: nothing else in
// the session has ever heard that token. So when no world shape matched it,
// the fall-through is a plain misroute, and in a session with no code graph it
// comes back as the code-graph wall, which says nothing true about a burrow.
// The gate is the hyphen: a world id that is a plain dictionary word ("lamp",
// "garden") stays out of this, so an ordinary mid-game question about an
// ordinary word keeps the lane it has always had.
const WORLD_QUESTION_LEAD_RE =
  /^(?:who|what|where|which|how|why|when|tell\s+me|describe|do\s+you|does|is|are|can\s+you|any)\b/i;
const WORLD_MINTED_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

/** A digest about the world-minted id a question names, or null when the line
 *  is not a question, names none, or the world places nothing by that name. */
async function worldMentionAnswer(line, { memoryDir, graph, actingSubject = "player" }) {
  const l = String(line).trim();
  if (!/\?\s*$/.test(l) && !WORLD_QUESTION_LEAD_RE.test(l)) return null;
  const spoken = new Set(l.toLowerCase().replace(/[?.!,;:"']/g, " ").split(/\s+/).filter(Boolean));
  let memory;
  try { memory = await loadMemory(memoryDir); } catch { return null; }
  const rows = readFactRows(memory);
  const state = foldWorldState(worldActionRows(rows));
  const named = worldIndividualNames(rows)
    .find((subject) => WORLD_MINTED_ID_RE.test(subject) && spoken.has(subject));
  if (!named) return null;
  const digest = await worldDigest(named, { memoryDir, memory, rows, state, graph, actingSubject });
  return answer(
    digest ?? `nothing more about the ${named} is written down yet.`,
    `ADVENTURE — world-mention aside: "${named}" is an id this world minted, so the question is the world's to answer; digested from the current fold`,
    { goal: `find out about the ${named}` },
  );
}

async function inventoryAnswer({ memoryDir, graph, actingSubject = "player" }) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const state = foldWorldState(worldActionRows(rows));
  const carried = [...state.placements]
    .filter(([, p]) => p.predicate === "mgx:located-in" && p.object === actingSubject)
    .map(([thing]) => thing)
    .sort();
  if (!carried.length) {
    return answer(
      "you aren't carrying anything.",
      "ADVENTURE — inventory: no fact places anything with the player; the honest empty answer",
      { goal: "check what you carry" },
    );
  }
  const digest = await worldDigest(actingSubject, { memoryDir, memory, rows, state, graph, actingSubject });
  return answer(
    digest ?? `you are carrying the ${carried.join(", the ")}.`,
    "ADVENTURE — inventory: an extractive completions digest over the facts mentioning the player",
    { goal: "check what you carry" },
  );
}

/** Reconstruct the corrected command's surface form ("go east", "take
 *  lamp") for the "(reading that as ...)" note — from the parsed command's
 *  own resolved fields, not the raw input, so it always names what actually
 *  ran. */
function renderedImperativeCommand(cmd) {
  const parts = [cmd.verb];
  if (cmd.direction) parts.push(cmd.direction);
  else if (cmd.object) {
    parts.push(cmd.object);
    if (cmd.indirectObject) parts.push("to", cmd.indirectObject);
    if (cmd.instrument) parts.push("with", cmd.instrument);
  }
  return parts.join(" ");
}

// ---- pronoun binding: the session discourse record ----------------------------
//
// A world command may name its object with a pronoun ("examine it", "take
// them", "talk to him") instead of a noun. The antecedent is not in the
// sentence — it's the last adventure object the player successfully acted on
// this session — so the parser leaves the pronoun bare (ace.mjs's
// OBJECT_PRONOUNS) and the lane binds it here, through ONE seam that every
// object-taking verb passes on its way to runWorldCommand. The antecedent lives
// as one referent among N in the shared discourse record, so an adventure
// object is bound the same way a code-graph answer's referent is. With nothing
// standing, a pronoun gets an honest reference nudge, never the vocabulary
// decline (a pronoun is a reference, not an unknown word).

const PRONOUN_SLOTS = ["object", "indirectObject", "instrument"];

const commandHasPronoun = (cmd) => PRONOUN_SLOTS.some((s) => cmd[s] && OBJECT_PRONOUNS.has(cmd[s]));

/** A pronoun command with no focus standing: the reference nudge, embedding a
 *  real, actionable object from the current room when one is on show (else a
 *  static example). Never the "I don't know the word" line — the vocabulary
 *  misdiagnosis is unreachable for a pronoun. */
async function noFocusPronounNudge(pronoun, { memoryDir, actingSubject = "player" }) {
  let example = null;
  try {
    const rows = readFactRows(await loadMemory(memoryDir));
    const state = foldWorldState(worldActionRows(rows));
    const here = state.placements.get(actingSubject)?.object ?? null;
    if (here) {
      for (const action of roomAffordances(rows, state, here, actingSubject)) {
        const m = action.match(/^(?:examine|take|open|unlock|talk to) (.+)$/);
        if (m) { example = m[1]; break; }
      }
    }
  } catch { /* no probe available — the static example carries the nudge */ }
  const eg = example ?? "lamp";
  return answer(
    `I'm not sure what "${pronoun}" refers to yet — name the thing, e.g. "examine ${eg}".`,
    `ADVENTURE — pronoun "${pronoun}" arrived with no focus standing; asked which thing it means, never the vocabulary decline`,
    { miss: true },
  );
}

/** Bind any pronoun object/indirect/instrument slot to the last adventure
 *  object in the discourse record. Returns `{ cmd }` with the pronouns
 *  rewritten to that object's term, or `{ nudge }` (the reference nudge) when a
 *  pronoun stands but no adventure object does. A command with no pronoun
 *  passes straight through untouched. All four surface pronouns
 *  (it/them/him/her) normalize to the one `it` probe, then bind to the newest
 *  referent THIS lane registered — the record may also hold code-graph
 *  referents, so the bind is scoped to `lane: "adventure"`. The record is one
 *  per session, so several acting subjects sharing a world share one focus. */
async function bindPronouns(cmd, { discourseHolder, memoryDir, actingSubject = "player" }) {
  if (!commandHasPronoun(cmd)) return { cmd };
  const probe = discourseHolder ? bindDiscourseForm(discourseHolder.record, "it") : null;
  const focusTerm = (probe?.candidates || []).find((r) => r.from?.lane === "adventure")?.label ?? null;
  if (!focusTerm) {
    const pronoun = PRONOUN_SLOTS.map((s) => cmd[s]).find((v) => v && OBJECT_PRONOUNS.has(v));
    return { nudge: await noFocusPronounNudge(pronoun, { memoryDir, actingSubject }) };
  }
  const bound = { ...cmd };
  for (const s of PRONOUN_SLOTS) {
    if (bound[s] && OBJECT_PRONOUNS.has(bound[s])) bound[s] = focusTerm;
  }
  return { cmd: bound };
}

// ---- the world's own vocabulary ----------------------------------------------
//
// A world's minted ids are words only that world knows. "groundhog-1" is in no
// dictionary, so the parser's lexicon gate rejects "talk to groundhog-1" as an
// undeclared word and the whole command dies before the talk verb ever sees
// it. Declaring those ids as PROPER NAMES for the duration of a world command
// fixes that: a proper name outranks every other category, so the id resolves
// as itself. Ids the core lexicon already knows are left out, so no ordinary
// word changes category because a world happens to use it — and the extension
// is scoped to this lane, so the teach and ask lanes keep the plain lexicon.

let worldLexiconCache = { key: null, base: null, lexicon: null };

function worldLexicon(rows, base) {
  const names = worldIndividualNames(rows).filter((name) => !classify(name, base));
  const key = names.join(" ");
  if (worldLexiconCache.base === base && worldLexiconCache.key === key) return worldLexiconCache.lexicon;
  const lexicon = withProperNames(base, names);
  worldLexiconCache = { key, base, lexicon };
  return lexicon;
}

async function worldAwareLexicon(memoryDir, lexicon) {
  const base = lexicon ?? loadLexicon();
  try {
    return worldLexicon(readFactRows(await loadMemory(memoryDir)), base);
  } catch {
    return base;
  }
}

// ---- the vocative: naming who the line is addressed to ------------------------
//
// Give a window a character's name and players start using it: "groundhog-1
// what do you know about food", "mole-1, dig north". The name is who the line
// is addressed to, not part of the question — but it makes the line fit no
// world shape at all, so the whole turn leaves this lane and comes back
// answered as something else entirely (a code question, in a session with no
// code graph). Stripping a vocative that names one of the world's OWN placed
// individuals costs one fold read, and only on a line that has already failed
// on its own terms.

const escapeForRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/** `line` with a leading or trailing vocative naming a placed world
 *  individual removed, or null when it carries none (or when the name is the
 *  whole line, which is a bare mention, not an address). Pure. */
export function withoutWorldVocative(line, names) {
  const l = String(line).trim();
  for (const name of names) {
    const escaped = escapeForRegExp(name);
    const leading = new RegExp(`^${escaped}\\s*[,:;]?\\s+`, "i");
    if (leading.test(l)) {
      const rest = l.replace(leading, "").trim();
      if (rest) return rest;
    }
    const trailing = new RegExp(`[\\s,]+${escaped}\\s*([?.!]*)$`, "i");
    if (trailing.test(l)) {
      const rest = l.replace(trailing, "$1").trim();
      if (rest) return rest;
    }
  }
  return null;
}

async function addressedLine(line, { memoryDir }) {
  let rows;
  try { rows = readFactRows(await loadMemory(memoryDir)); } catch { return null; }
  const state = foldWorldState(worldActionRows(rows));
  return withoutWorldVocative(line, [...state.placements.keys()].sort());
}

// ---- the lane ----------------------------------------------------------------

/**
 * The whole adventure lane for one turn: the opening moves, the stop command,
 * and (with a world live) the one-at-a-time declines across the shared plan
 * slot. Returns { text, lane, note, goal? } or null when the turn is not the
 * adventure's to answer — a mid-game aside falls through to the ordinary
 * lanes, world untouched. `isPlanFrameLine` is chat's own plan-frame
 * recognizer, injected so the two lanes can never disagree about what a plan
 * frame is.
 */
export async function adventureTurn(line, { planHolder, memoryDir, sessionId = "", env, lexicon = null, graph = null, cache = null, isPlanFrameLine = () => false, discourseHolder = null, actingSubject = "player", gameConfig = null }) {
  const slot = planHolder?.state ?? null;
  const adventure = slot?.adventure ?? null;
  const opening = matchAdventureOpening(line);

  if (!adventure) {
    if (!opening) return null;
    if (slot?.game) {
      return {
        text: 'a guess-the-number game is active — say "I give up" to end it, then start the adventure.',
        lane: "game-inform",
        note: "ADVENTURE — an opening arrived mid-number-game; the slot holds one thing at a time",
      };
    }
    if (slot?.spiderFly) {
      return {
        text: 'the spider-and-fly game is running — say "stop watching" to end it, then start the adventure.',
        lane: "game-inform",
        note: "ADVENTURE — an opening arrived mid-spider-fly-game; the slot holds one thing at a time",
      };
    }
    const planActive = slot && !slot.done
      && ((Array.isArray(slot.goals) && slot.goals.length) || (Array.isArray(slot.actions) && slot.actions.length));
    if (planActive) {
      return {
        text: 'a plan is in progress — finish it or say "forget the goal" before we start the adventure.',
        lane: "game-inform",
        note: "ADVENTURE — an opening arrived while a plan frame is active; the slot holds one thing at a time",
      };
    }
    return openAdventure(opening, { planHolder, memoryDir, sessionId, env, cache });
  }

  // A world is live.
  if (opening) {
    return {
      text: `we're already playing ${spokenNameOf(adventure.world)} — say "stop playing" to end it first.`,
      lane: "game-inform",
      note: "ADVENTURE — an opening arrived mid-adventure; declined, the running world stands",
    };
  }
  if (ADVENTURE_STOP_RE.test(line)) {
    planHolder.state = null;
    return {
      text: `OK — the adventure ends here. Everything the world wrote stays remembered; say "play ${spokenNameOf(adventure.world)}" to pick it back up.`,
      lane: "game-inform",
      note: "ADVENTURE — the adventure ended on request; the world's facts stay in the store",
    };
  }
  if (isPlanFrameLine(line)) {
    return {
      text: 'an adventure is running — say "stop playing" to end it, then set your goal.',
      lane: "game-inform",
      note: "ADVENTURE — a plan frame arrived mid-adventure; the slot holds one thing at a time",
    };
  }
  const direct = await liveWorldAnswer(line, { world: adventure.world, memoryDir, env, graph, cache, lexicon, discourseHolder, actingSubject, gameConfig });
  if (direct) return direct;
  const addressed = await addressedLine(line, { memoryDir });
  if (addressed) {
    const readdressed = await liveWorldAnswer(addressed, { world: adventure.world, memoryDir, env, graph, cache, lexicon, discourseHolder, actingSubject, gameConfig });
    if (readdressed) return readdressed;
  }
  return null; // a mid-game aside — the ordinary lanes answer, world untouched
}

/** One line against a LIVE world: inventory, an imperative command, then the
 *  in-game asides. Null when the world has no answer for it, which is what
 *  lets an ordinary mid-game question keep its own lane. Split out from the
 *  lane itself so a line carrying a vocative can be re-offered here once,
 *  stripped, without the two paths ever drifting apart. */
async function liveWorldAnswer(line, { world, memoryDir, env, graph, cache, lexicon, discourseHolder, actingSubject, gameConfig }) {
  if (INVENTORY_RE.test(line)) return inventoryAnswer({ memoryDir, graph, actingSubject });
  // The teach switch runs BEFORE the imperative parse, and that ordering is
  // the point. parseImperative fuzzy-repairs a leading noun into a verb when
  // one is an edit away ("book" -> "look"), so a declarative sentence about
  // such a noun would be executed as a command and decline on its own
  // residue. With teach on, the sentence is read as a fact first; with teach
  // off, nothing here runs and the lane behaves exactly as it always has.
  if (gameConfig?.adventure?.teach && memoryDir) {
    const teachRows = readFactRows(await loadMemory(memoryDir));
    const taught = await worldTeachTurn(line, {
      // A burrow says placement with different words than a manor does, so
      // the sentence table follows the world, never the lane. The world's own
      // origin fact is the test: only a burrow measures digs from one.
      ...(originRoomOf(teachRows)
        ? { parseLine: parseMudEditorLine, planTriple: planTaughtMudTriple }
        : { parseLine: parseEditorLine, planTriple: planTaughtTriple }),
      rows: teachRows,
      state: foldWorldState(worldActionRows(teachRows)),
      memoryDir, world, actingSubject, cache, graph,
    });
    if (taught) return taught;
  }
  const parsed = parseImperative(line, await worldAwareLexicon(memoryDir, lexicon));
  if (parsed) {
    const bound = await bindPronouns(parsed, { discourseHolder, memoryDir, actingSubject });
    if (bound.nudge) return bound.nudge;
    const cmd = bound.cmd;
    const result = await runWorldCommand(cmd, { world, memoryDir, env, graph, cache, actingSubject });
    // The object a command SUCCESSFULLY named registers as a discourse referent
    // a later pronoun binds to — so "look lamp" then "examine it" reads the
    // lamp, and "talk to housekeeper" makes "him"/"her" the housekeeper. A miss
    // leaves the record untouched; a bare room look or a move carries no object
    // and so never disturbs it.
    if (!result.miss && cmd.object && discourseHolder) {
      discourseHolder.record = registerReferent(discourseHolder.record, {
        kind: "entity", class: "AdventureObject", label: cmd.object,
        ids: [`adventure:${cmd.object}`], attrs: {},
        from: { turn: discourseHolder.record.turn, lane: "adventure", query: line },
      });
    }
    if (!cmd.corrected?.length) return result;
    // A fuzzy-repaired verb or direction still executes normally, but the
    // response says what it read the line as, so a genuine miss is never
    // confused with a silent auto-correct (the same discipline VERB_SYNONYMS
    // doesn't need, since a recognised synonym is a wording, not a typo).
    return {
      ...result,
      text: `(reading that as "${renderedImperativeCommand(cmd)}") ${result.text}`,
      note: `${result.note}; corrected ${cmd.corrected.map((c) => `"${c.from}" -> "${c.to}"`).join(", ")} before executing`,
    };
  }
  const whereAside = await worldWhereAnswer(line, { memoryDir, actingSubject });
  if (whereAside) return whereAside;
  const opennessAside = await worldOpennessAnswer(line, { memoryDir });
  if (opennessAside) return opennessAside;
  const contextAside = await worldContextAnswer(line, { memoryDir, actingSubject });
  if (contextAside) return contextAside;
  const knownFoodAside = await worldKnownFoodAnswer(line, { memoryDir, actingSubject });
  if (knownFoodAside) return knownFoodAside;
  const mentionAside = await worldMentionAnswer(line, { memoryDir, graph, actingSubject });
  if (mentionAside) return mentionAside;
  return null; // a mid-game aside — the ordinary lanes answer, world untouched
}
