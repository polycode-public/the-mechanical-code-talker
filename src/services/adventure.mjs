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
import { getWorldsPackProvider } from "../adapters/corpus/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, readFactRows, readRuleRows } from "../adapters/memory/core.mjs";
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
    // chess") — fall through to the ordinary lanes rather than claim it.
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

/** A resumed game's current room: non-null only when earlier @turnN
 *  snapshots exist (the world was already played in this store), folded the
 *  same way every other reader folds them. A fresh world returns null and
 *  the meta opening speaks. */
async function resumedPosition(memoryDir) {
  try {
    const state = foldWorldState(readFactRows(await loadMemory(memoryDir)));
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
const OPEN_PREDICATE = "mgx:is-open";
const EXIT_PREDICATE_RE = /^mgx:has-exit-([a-z]+)$/;

/** Fold fact rows into the CURRENT world state: per subject, the newest
 *  placement (base row = turn 0, @turnN snapshots override), the newest
 *  open/closed state, the exit map, and the turn counter (the largest @turnN
 *  suffix written so far — derived, never stored). Pure. */
export function foldWorldState(factRows) {
  const placements = new Map(); // subject -> { predicate, object, turn }
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
  return { placements, openness, exits, turnCount };
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
  /^(?:inventory|inv|what\s+am\s+i\s+carrying|what\s+do\s+i\s+have|what(?:'s|\s+is)\s+in\s+my\s+(?:bag|pockets?|hands?))[?.!\s]*$/i;

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

/** The effect predicate a family writes (its action-effect row's slot, with
 *  the mgx: prefix rule readers re-attach). Null when the family carries no
 *  effect row — the open/unlock/close families, whose datatype state writes
 *  have no shipped effect shape yet and ride the container logic below. */
function familyEffectPredicate(family) {
  const effect = (family || []).find((r) => r.kind === "action-effect");
  if (!effect?.slots?.predicate) return null;
  const p = effect.slots.predicate;
  return p.includes(":") ? p : `mgx:${p}`;
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
]);

const sentenceCase = (term) => String(term).charAt(0).toUpperCase() + String(term).slice(1);
const typePhrase = (object) => (/^[aeiou]/.test(object) ? "is an" : "is a");

/** The digest's fact view: current placements (folded), exits, typing and
 *  every other surviving fact, with phrase predicates and sentence-cased
 *  subjects so the pipeline's sentence splitter sees real sentences. Pure. */
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
  for (const row of rows || []) {
    if (SNAPSHOT_RE.test(row.subject)) continue;                 // folded above
    if (PLACEMENT_PREDICATES.has(row.predicate)) continue;       // folded above
    if (VIEW_EXCLUDED_PREDICATES.has(row.predicate)) continue;
    const exit = EXIT_PREDICATE_RE.exec(row.predicate);
    if (exit) { push(row.subject, `has an exit ${exit[1]} to the`, row.object); continue; }
    if (row.predicate === "rdf:type") { push(row.subject, typePhrase(row.object), row.object); continue; }
    if (row.predicate === "mgx:works-in") { push(row.subject, "works in the", row.object); continue; }
    push(row.subject, row.predicate, row.object);
  }
  return out;
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

async function runWorldCommand(cmd, { world, memoryDir, env, graph, cache }) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const state = foldWorldState(rows);
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

  if (cmd.verb === "look") {
    const digest = await worldDigest(here, { memoryDir, memory, rows, state, graph });
    return answer(
      digest ?? `you are in the ${here}. Nothing more about it is written down yet.`,
      noteFor(`look — an extractive completions digest over the current world facts mentioning "${here}"`),
      { goal: `look around the ${here}` },
    );
  }

  const families = actionFamilies(readRuleRows(memory));
  const family = families.get(cmd.verb);
  if (!family) {
    return answer(
      `this world doesn't teach the verb "${cmd.verb}" — its action family isn't loaded.`,
      noteFor(`no "${cmd.verb}" action family in the store; honest decline`),
      { miss: true },
    );
  }
  const k = state.turnCount + 1;
  const commit = async (facts, text, detail, goal) => {
    await writeWorldTurn(memoryDir, world, k, facts, cache);
    return answer(text, noteFor(`${detail}; turn ${k} snapshots written through appendFacts`), { goal });
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

  // open / unlock / close — the container verbs. Their families are
  // signature-only (no shipped rule shape for a datatype effect yet), so the
  // state writes are the closed container vocabulary below.
  const presentHere = place && place.predicate !== "mgx:hidden-in" && place.predicate !== "mgx:currently-in" && place.object === here;
  if (!presentHere) {
    return answer(`I don't see a ${object} here.`, noteFor(`${cmd.verb} — ${object} isn't in the ${here}; declined`), { miss: true });
  }
  if (!isContainer(rows, object)) {
    return answer(`the ${object} doesn't open.`, noteFor(`${cmd.verb} — no mgx:is-container fact on ${object}; declined by name`), { miss: true });
  }
  const open = !!state.openness.get(object)?.open;

  if (cmd.verb === "open") {
    if (place.predicate === "mgx:stands-locked-in") {
      return answer(`the ${object} is locked.`, noteFor(`open — ${object} stands locked; precondition declined by name`), { miss: true });
    }
    if (open) {
      return answer(`the ${object} is already open.`, noteFor("open — already open; declined"), { miss: true });
    }
    const revealed = [...state.placements]
      .filter(([, p]) => p.predicate === "mgx:hidden-in" && p.object === object)
      .map(([thing]) => thing)
      .sort();
    return commit(
      [
        { subject: `${object}@turn${k}`, predicate: "mgx:is-open", object: "true" },
        ...revealed.map((thing) => ({ subject: `${thing}@turn${k}`, predicate: "mgx:located-in", object })),
      ],
      revealed.length
        ? `you open the ${object} — inside: the ${revealed.join(", the ")}.`
        : `you open the ${object}. It's empty.`,
      `open — ${object} opens${revealed.length ? `, revealing ${revealed.join(", ")}` : ""}`,
      `open the ${object}`,
    );
  }

  if (cmd.verb === "close") {
    if (!open) {
      return answer(`the ${object} isn't open.`, noteFor("close — not open; declined"), { miss: true });
    }
    return commit(
      [{ subject: `${object}@turn${k}`, predicate: "mgx:is-open", object: "false" }],
      `you close the ${object}.`,
      `close — ${object} closes`,
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

async function inventoryAnswer({ memoryDir, graph }) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const state = foldWorldState(rows);
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
  if (cmd) return runWorldCommand(cmd, { world: adventure.world, memoryDir, env, graph, cache });
  return null; // a mid-game aside — the ordinary lanes answer, world untouched
}
