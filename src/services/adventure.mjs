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
import { getWorldsPackProvider } from "../adapters/corpus/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, readFactRows } from "../adapters/memory/core.mjs";

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
  const startRoom = await playerRoom(memoryDir);
  const opener = payload.meta?.opening || `the adventure begins. You are in the ${startRoom ?? "starting room"}.`;
  return {
    text: opener,
    goal: `play the ${spokenNameOf(world)} adventure`,
    lane: "game-inform",
    note: `ADVENTURE — loaded the "${world}" world from the pack into this session's memory (facts + action families, provenance ${tag}) and announced the opening room`,
  };
}

/** The player's current room, folded from the written facts (base placement
 *  overridden by the newest @turnN snapshot). */
async function playerRoom(memoryDir) {
  try {
    const rows = readFactRows(await loadMemory(memoryDir));
    return foldWorldState(rows).placements.get("player")?.object ?? null;
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
  return null;
}
