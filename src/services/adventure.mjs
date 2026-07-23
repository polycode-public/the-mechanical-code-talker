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
import { parseImperative } from "../domain/grammar/ace.mjs";
import { createCompletionsGraphAdapter } from "../domain/completions/graph-adapter.mjs";
import { actionFamilies } from "../domain/router/taught.mjs";
import { compileDomain, precondHolds, roleBinding } from "../domain/domain.mjs";
import { getWorldsPackProvider } from "../adapters/corpus/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, normFactTerm, readFactRows, readRuleRows } from "../adapters/memory/core.mjs";
import { COMPLETIONS_STORE, generateCompletion } from "./completions.mjs";

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

const SNAPSHOT_RE = /^(.+)@turn(\d+)$/;
const PLACEMENT_PREDICATES = new Set([
  "mgx:currently-in", "mgx:located-in", "mgx:fixed-in", "mgx:stands-locked-in", "mgx:hidden-in",
]);
// Supplemental positional relations: where a thing sits WITHIN its room,
// never where its room is. Folded like placements (newest per subject) but
// kept apart, since visibility and movement key on the placement, not on
// which surface a thing rests against.
const POSITION_PREDICATES = new Set(["mgx:on-top-of", "mgx:on-plane", "mgx:under"]);
const OPEN_PREDICATE = "mgx:is-open";
const EXIT_PREDICATE_RE = /^mgx:has-exit-([a-z]+)$/;

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

/** Fold fact rows into the CURRENT world state: per subject, the newest
 *  placement (base row = turn 0, @turnN snapshots override), the newest
 *  open/closed state, the exit map, and the turn counter (the largest @turnN
 *  suffix written so far — derived, never stored). Pure. */
export function foldWorldState(factRows) {
  const placements = new Map(); // subject -> { predicate, object, turn }
  const positions = new Map();  // subject -> { predicate, object, turn }
  const openness = new Map();   // subject -> { open, turn }
  const exits = new Map();      // room -> Map(direction -> room)
  let turnCount = 0;
  for (const row of factRows || []) {
    const m = SNAPSHOT_RE.exec(row.subject);
    const base = m ? m[1] : row.subject;
    const turn = m ? Number(m[2]) : 0;
    if (m) turnCount = Math.max(turnCount, turn);
    if (PLACEMENT_PREDICATES.has(row.predicate)) {
      const prior = placements.get(base);
      if (!prior || turn >= prior.turn) placements.set(base, { predicate: row.predicate, object: row.object, turn });
      continue;
    }
    if (POSITION_PREDICATES.has(row.predicate)) {
      const prior = positions.get(base);
      if (!prior || turn >= prior.turn) positions.set(base, { predicate: row.predicate, object: row.object, turn });
      continue;
    }
    if (row.predicate === OPEN_PREDICATE) {
      const prior = openness.get(base);
      if (!prior || turn >= prior.turn) openness.set(base, { open: row.object === "true", turn });
      continue;
    }
    const exit = EXIT_PREDICATE_RE.exec(row.predicate);
    if (exit && !m) {
      if (!exits.has(row.subject)) exits.set(row.subject, new Map());
      exits.get(row.subject).set(exit[1], row.object);
    }
  }
  return { placements, positions, openness, exits, turnCount };
}

/** A subject's CURRENT within-room position, or null. A position goes stale
 *  the moment the subject is placed somewhere new: taking the lamp writes a
 *  later-turn placement, so its turn-0 `on-top-of desk` no longer holds and
 *  no extra write is needed to retract it. */
export function currentPosition(state, subject) {
  const pos = state.positions.get(subject);
  if (!pos) return null;
  const place = state.placements.get(subject);
  if (place && pos.turn < place.turn) return null;
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
  if (holder === "player") return null; // carried, not on show in a room
  if (!state.openness.get(holder)?.open) return null;
  const holderPlace = state.placements.get(holder);
  return holderPlace && holderPlace.predicate !== "mgx:hidden-in" ? holderPlace.object : null;
}

const carriedByPlayer = (state, thing) => {
  const place = state.placements.get(thing);
  return !!place && place.predicate === "mgx:located-in" && place.object === "player";
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

/** The room's real affordances — every exit, and every visible object's
 *  applicable verb — read from the EXACT SAME data take/open/talk/examine
 *  already check (visibleRoomOf, isContainer, isTyped, the placement
 *  predicate), so this list can never promise an action one of those verbs
 *  would then refuse. A locked container offers "unlock", never "open" (that
 *  would only decline); an already-open one offers neither, since there is
 *  nothing left for either verb to do. Pure. */
export function roomAffordances(rows, state, here) {
  const actions = [];
  for (const direction of state.exits.get(here)?.keys() ?? []) {
    actions.push(`go ${direction}`);
  }
  for (const subject of [...state.placements.keys()].sort()) {
    if (subject === "player") continue;
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
    if (isTyped(rows, subject, "person")) {
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
    writes.push({ subject: `${npc}@turn${k}`, predicate: effectPredicate, object: target });
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
  "mgx:hidden-in", "mgx:is-open", "mgx:is-npc", "mgx:is-container",
  "mgx:unlocks-with", "mgx:acts-on-turn", "mgx:acts-toward",
  // is-objective is an internal marker for auto-play's goal inference — the
  // same information the opening narration already tells a human player in
  // prose, never meant to surface as a raw, unphrased triple ("Letter
  // mgx:is-objective true.") itself.
  "mgx:is-objective",
  // Staff knowledge is the whole puzzle: a room look must never leak
  // "Gardener knows-where letter" or the game is spoiled. It reaches the
  // player only through the talk lane, which resolves each pointer live.
  "mgx:knows-where", "mgx:knows-objective", "mgx:knows-about",
  // Class-schema facts describe the ontology, not the scene. default-contains
  // is already materialized into real instances at load; default-plane and
  // subClassOf drive positional rendering by their own readers, and read as
  // raw triples if they land in room prose.
  "mgx:default-contains", "mgx:default-plane", "rdfs:subClassOf",
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
export function worldDigestRows(rows, state) {
  const out = [];
  const seen = new Set();
  const push = (subject, phrase, object) => {
    const key = `${subject}\0${phrase}\0${object}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ subject: sentenceCase(subject), predicate: phrase, object });
  };
  for (const [subject, place] of state.placements) {
    if (place.predicate === "mgx:hidden-in") continue;
    if (place.predicate === "mgx:located-in" && place.object === "player") {
      push("player", "carries the", subject);
      continue;
    }
    if (place.predicate === "mgx:located-in" && isTyped(rows, place.object, "person")) {
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
    if (place.predicate === "mgx:hidden-in" || place.object === "player") continue;
    const pos = currentPosition(state, subject);
    if (pos && POSITION_PHRASE[pos.predicate]) { push(subject, POSITION_PHRASE[pos.predicate], pos.object); continue; }
    const plane = classDefaultPlane(rows, subject);
    if (plane && plane !== "floor") push(subject, "is usually on the", plane);
  }
  for (const row of rows || []) {
    if (SNAPSHOT_RE.test(row.subject)) continue;                 // folded above
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
export function objectLookProperties(rows, state, object) {
  const subjectCased = sentenceCase(object);
  return worldDigestRows(rows, state)
    .filter((r) => (r.subject === subjectCased && r.predicate !== "is a" && r.predicate !== "is an")
      || (r.predicate === "carries the" && r.object === object))
    .map((r) => `${r.subject} ${r.predicate} ${r.object}.`);
}

/** An object's class hierarchy as an is-a chain, nearest-first and opening
 *  with the object itself ("housekeeper → person"): a breadth-first walk up
 *  the world's OWN rdf:type and rdfs:subClassOf edges (worldActionRows, so a
 *  merged corpus's taxonomy for the same word never joins the chain), the same
 *  upward-class rendering chat's "what do you know about X" shows. Pure. */
export function objectClassChain(rows, object) {
  const worldRows = worldActionRows(rows);
  const parentsOf = (node) => worldRows
    .filter((r) => r.subject === node && (r.predicate === "rdf:type" || r.predicate === "rdfs:subClassOf"))
    .map((r) => r.object);
  const seen = new Set([object]);
  const chain = [object];
  const queue = [...parentsOf(object)];
  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node)) continue;
    seen.add(node);
    chain.push(node);
    queue.push(...parentsOf(node));
  }
  return chain;
}

async function worldDigest(prompt, { memoryDir, memory, rows, state, graph }) {
  const view = worldDigestRows(rows, state);
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
 *  back for the caller to digest. Pure. */
export function personKnowledgeLines(rows, state, person) {
  const lines = [];
  for (const objective of factObjects(rows, person, "mgx:knows-objective")) {
    lines.push(`the ${objective} is what you're after — find it and carry it out of the house.`);
  }
  for (const thing of factObjects(rows, person, "mgx:knows-where")) {
    const place = state.placements.get(thing);
    if (!place) continue;
    lines.push(isTyped(rows, thing, "person")
      ? `you'll find the ${thing} in the ${place.object}.`
      : `the ${thing} is in the ${place.object}.`);
  }
  return { lines, aboutTopics: factObjects(rows, person, "mgx:knows-about") };
}

/** What a person can report from where they stand this turn — derived each
 *  turn, never stored: who and what shares their room, each container's
 *  open/locked status, and what unlocks a locked one there. Pure. */
export function personRoomReport(rows, state, person) {
  const room = state.placements.get(person)?.object ?? null;
  if (!room) return "";
  const here = [...state.placements.keys()]
    .filter((s) => s !== person && s !== "player" && visibleRoomOf(s, { rows, state }) === room)
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

async function runWorldCommand(cmd, { world, memoryDir, env, graph, cache }) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const state = foldWorldState(worldActionRows(rows));
  const here = state.placements.get("player")?.object ?? null;
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

  if (cmd.verb === "look" && !cmd.object) {
    const digest = await worldDigest(here, { memoryDir, memory, rows, state, graph });
    const actions = roomAffordances(rows, state, here);
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
    const carried = (cmd.verb === "examine" || cmd.verb === "look") && carriedByPlayer(state, object);
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
    const person = isTyped(rows, object, "person");
    // "look <object>" on a real placed prop is the grounded close look: every
    // physical fact the world writes about the thing (its placement, its
    // within-room position, any datatype property — all via the SAME
    // worldDigestRows view that already drops the puzzle wiring and the
    // staff-knowledge pointers), plus its class hierarchy as an is-a chain,
    // plus a container's open/locked state. A background-only mention has no
    // placed facts of its own, so it falls through to the examine digest below
    // (the same general-knowledge answer "what is a flower" gives).
    if (cmd.verb === "look" && !backgroundOnlyMention(rows, state, object)) {
      const propLines = objectLookProperties(rows, state, object);
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
        const digested = await worldDigest(topic, { memoryDir, memory, rows, state, graph });
        if (digested) aboutLines.push(digested);
      }
      const report = personRoomReport(rows, state, object);
      const said = [...lines, ...aboutLines, report].filter(Boolean).join(" ");
      return answer(
        said ? `the ${object} says: ${said}` : `the ${object} has nothing to tell you right now.`,
        noteFor(`talk — the ${object}'s live knowledge (knows-where/objective/about from the current fold) and a derived room report`),
        { goal: `talk to the ${object}` },
      );
    }
    const digest = await worldDigest(object, { memoryDir, memory, rows, state, graph });
    const body = digest ?? `nothing more about the ${object} is written down yet.`;
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
    // Auto-relook: every state-changing command ends in the same shape a
    // manual "look" produces, read from the FRESH post-write state, so the
    // player is never left to retype "look" to see what just changed.
    const freshMemory = await loadMemory(memoryDir);
    const freshRows = readFactRows(freshMemory);
    const freshState = foldWorldState(worldActionRows(freshRows));
    const relookDigest = await worldDigest(playerRoomAfter, { memoryDir, memory: freshMemory, rows: freshRows, state: freshState, graph });
    const actions = roomAffordances(freshRows, freshState, playerRoomAfter);
    const relook = `you are in the ${playerRoomAfter}. ${relookDigest ?? "Nothing more about it is written down yet."}${affordanceSuffix(actions)}`;
    return answer(
      `${text2} ${relook}`,
      noteFor(`${detail}; turn ${k} snapshots written through appendFacts${npcPass.writes.length ? `; NPC pass fired ${npcPass.writes.length} scheduled move(s)` : ""}; auto-relook appended for the ${playerRoomAfter}`),
      { goal },
    );
  };
  const object = cmd.object;
  const place = object ? state.placements.get(object) ?? null : null;

  if (cmd.verb === "go") {
    const target = state.exits.get(here)?.get(cmd.direction);
    if (!target) {
      return answer(
        `there's no exit ${cmd.direction} from the ${here}.`,
        noteFor(`go — no mgx:has-exit-${cmd.direction} fact on ${here}; precondition declined by name`),
        { miss: true },
      );
    }
    return commit(
      [{ subject: `player@turn${k}`, predicate: familyEffectPredicate(family) ?? "mgx:currently-in", object: target }],
      `you go ${cmd.direction}. Now in the ${target}.`,
      `go — the taught "go" family fired; player moves ${here} -> ${target}`,
      `move through the world (now in the ${target})`,
      target,
    );
  }

  if (cmd.verb === "take") {
    if (isTyped(rows, object, "room")) {
      return answer(`you can't take the ${object} — it's a whole room.`, noteFor("take — the object is a room; declined"), { miss: true });
    }
    if (carriedByPlayer(state, object)) {
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
      [{ subject: `${object}@turn${k}`, predicate: familyEffectPredicate(family) ?? "mgx:located-in", object: "player" }],
      `you take the ${object}.`,
      `take — the taught "take" family fired; ${object} is now carried`,
      `carry the ${object}`,
    );
  }

  if (cmd.verb === "drop" || cmd.verb === "give") {
    if (!carriedByPlayer(state, object)) {
      return answer(`you're not carrying the ${object}.`, noteFor(`${cmd.verb} — ${object} isn't carried; precondition declined by name`), { miss: true });
    }
    if (cmd.verb === "drop") {
      return commit(
        [{ subject: `${object}@turn${k}`, predicate: familyEffectPredicate(family) ?? "mgx:located-in", object: here }],
        `you drop the ${object} in the ${here}.`,
        `drop — the taught "drop" family fired; ${object} rests in the ${here}`,
        `set the ${object} down`,
      );
    }
    const receiver = cmd.indirectObject;
    if (!isTyped(rows, receiver, "person") || state.placements.get(receiver)?.object !== here) {
      return answer(`the ${receiver} isn't here.`, noteFor(`give — ${receiver} isn't a person in the ${here}; precondition declined by name`), { miss: true });
    }
    return commit(
      [{ subject: `${object}@turn${k}`, predicate: familyEffectPredicate(family) ?? "mgx:located-in", object: receiver }],
      `you give the ${object} to the ${receiver}.`,
      `give — the taught "give" family fired; the ${receiver} holds the ${object}`,
      `hand the ${object} over`,
    );
  }

  // open / unlock / close — the container verbs. presence and container-ness
  // stay hand-checked here (visibility gating, not a state precondition);
  // unlock's instrument match stays fully hand-written below it too — it
  // needs a third, externally-supplied binding beyond subject/target, which
  // this retrofit does not attempt. open/close's lock-state and open/closed
  // checks, and their mgx:is-open write, are now taught "fact-value"
  // precond/effect rows consulted through domain.mjs below; only the
  // hidden-contents reveal (a variable-arity effect over a discovered set)
  // stays hand-written JS, since no shipped rule shape covers that either.
  // Presence reuses visibleRoomOf (the SAME check examine/talk/take already
  // use), not a hand-rolled duplicate: an earlier version of this check
  // excluded mgx:currently-in outright, so a genuinely-present NPC (placed
  // that way, not fixed-in/stands-locked-in) fell into "I don't see a X
  // here" instead of reaching the isContainer check just below, which would
  // have honestly said "the X doesn't open."
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
    const failed = taughtAction.preconds.find((p) => !precondHolds(p, "player", object, factState, domain));
    if (failed) {
      const text = failed.predicate === "mgx:stands-locked-in"
        ? `the ${object} is locked.`
        : cmd.verb === "open" ? `the ${object} is already open.` : `the ${object} isn't open.`;
      return answer(text, noteFor(`${cmd.verb} — the taught "${cmd.verb}" family's ${failed.predicate} precondition declined by name`), { miss: true });
    }
    const effSubject = roleBinding(effect.subjectRole, "player", object, domain);
    const writeIsOpen = { subject: `${effSubject}@turn${k}`, predicate: effect.predicate, object: effect.value };

    if (cmd.verb === "open") {
      const revealed = [...state.placements]
        .filter(([, p]) => p.predicate === "mgx:hidden-in" && p.object === object)
        .map(([thing]) => thing)
        .sort();
      return commit(
        [
          writeIsOpen,
          ...revealed.map((thing) => ({ subject: `${thing}@turn${k}`, predicate: "mgx:located-in", object })),
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
  if (!carriedByPlayer(state, cmd.instrument)) {
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
    [{ subject: `${object}@turn${k}`, predicate: "mgx:fixed-in", object: here }],
    `you unlock the ${object} with the ${required}.`,
    `unlock — the lock releases; ${object} now stands unlocked (still fixed) in the ${here}`,
    `unlock the ${object}`,
  );
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
async function worldWhereAnswer(line, { memoryDir }) {
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
  if (thing === "player") {
    return answer(
      `you are in the ${place.object}.`,
      "ADVENTURE — where-aside: the player's own room, from the current world fold",
      { goal: "check where you are" },
    );
  }
  if (place.object === "player") {
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

/** The in-game orientation asides, answered from the world fold: the player's
 *  room, the room's real affordances, and the world's objective. Null when the
 *  line is none of them, so an ordinary question keeps its lane. */
async function worldContextAnswer(line, { memoryDir }) {
  const l = String(line).trim();
  const asksWhere = WORLD_WHERE_AM_I_RE.test(l);
  const asksOptions = WORLD_OPTIONS_RE.test(l);
  const asksQuest = WORLD_QUEST_RE.test(l);
  if (!asksWhere && !asksOptions && !asksQuest) return null;
  let rows;
  try { rows = readFactRows(await loadMemory(memoryDir)); } catch { return null; }
  const state = foldWorldState(worldActionRows(rows));
  const here = state.placements.get("player")?.object ?? null;

  if (asksWhere) {
    return here
      ? answer(`you are in the ${here}.`, "ADVENTURE — where-am-I aside: the player's own room from the current world fold", { goal: "check where you are" })
      : answer("the world has no written player position yet.", "ADVENTURE — where-am-I aside: no player placement", { miss: true, goal: "check where you are" });
  }

  if (asksOptions) {
    const actions = here ? roomAffordances(rows, state, here) : [];
    return answer(
      actions.length ? `you can: ${actions.join(", ")}.` : `nothing obvious here — say "look" to look around${here ? ` the ${here}` : ""}.`,
      `ADVENTURE — options aside: the ${here}'s roomAffordances, the same list "look" appends`,
      { goal: "see what you can do here" },
    );
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

async function inventoryAnswer({ memoryDir, graph }) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const state = foldWorldState(worldActionRows(rows));
  const carried = [...state.placements]
    .filter(([, p]) => p.predicate === "mgx:located-in" && p.object === "player")
    .map(([thing]) => thing)
    .sort();
  if (!carried.length) {
    return answer(
      "you aren't carrying anything.",
      "ADVENTURE — inventory: no fact places anything with the player; the honest empty answer",
      { goal: "check what you carry" },
    );
  }
  const digest = await worldDigest("player", { memoryDir, memory, rows, state, graph });
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
export async function adventureTurn(line, { planHolder, memoryDir, sessionId = "", env, lexicon = null, graph = null, cache = null, isPlanFrameLine = () => false }) {
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
  if (INVENTORY_RE.test(line)) return inventoryAnswer({ memoryDir, graph });
  const cmd = parseImperative(line, lexicon ?? undefined);
  if (cmd) {
    const result = await runWorldCommand(cmd, { world: adventure.world, memoryDir, env, graph, cache });
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
  const whereAside = await worldWhereAnswer(line, { memoryDir });
  if (whereAside) return whereAside;
  const opennessAside = await worldOpennessAnswer(line, { memoryDir });
  if (opennessAside) return opennessAside;
  const contextAside = await worldContextAnswer(line, { memoryDir });
  if (contextAside) return contextAside;
  return null; // a mid-game aside — the ordinary lanes answer, world untouched
}
