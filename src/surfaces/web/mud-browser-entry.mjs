// mud-browser-entry.mjs — the esbuild entry for mud.html's multi-character,
// one-shared-world browser session (public/mud-browser.bundle.js), mirroring
// adventure-browser-entry.mjs's own session-factory shape. The difference is
// the whole point of the mud demo: adventure-browser-entry.mjs drives ONE
// player through one world; this file drives SEVERAL independent characters
// through the SAME live world, over the SAME memoryDir. Which of the world's
// animals are played is the caller's choice (pickMudRoster draws them fresh
// each reset), never a fixed pair baked in here.
//
// What's shared across every character, and why: the store itself
// (memoryDir) — mole-1's dig must be visible to vole-1's very next look — and
// ONE planHolder.state, seeded once as "mud-garden is already live" the same
// way adventure-browser-entry.mjs seeds it, since "is the world open" is a
// property of the WORLD, not of any one character. What is deliberately NOT
// shared: each character gets its own `focus`/`last` pronoun-resolution
// state and its own `visitedRoomIds` set — a window's mid-sentence "it"
// belongs to that window's own conversation, and fog of war means each
// character's own discovered-room history is genuinely private, unlike
// adventure-browser-entry.mjs's single merged exposure set for one player.
//
// Two entry points per character, both dispatched over the exact same
// memoryDir/actingSubject: `turn(line)` runs an ordinary typed chat command
// through chat.mjs's own runTurn (identical machinery to every other viz
// page's chat dock); `autoplayTick(k)` runs mud-turn.mjs's runMudTurn — one
// whole scripted turn (investigate, walk toward known food, dig at the
// edge). The caller (mud-viz.mjs's own inlined script) is responsible for
// SERIALIZING ticks across the characters when more than one window is
// auto-playing at once — this file makes no ordering promise between two
// concurrent calls into the same memoryDir, the same way two callers writing
// into any shared store concurrently would need their own queue.
import {
  createInMemoryStore, appendFacts, appendRule, loadMemory, readFactRows, removeFacts,
} from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { memoryFactGraphPayload } from "../../domain/memory-facts.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import {
  foldWorldState, worldActionRows, worldDigestRows, roomAffordances,
  personKnowledgeLines, personKnownFoodLines,
  diggableDirections, castInRoom, displayNameOf, isOutOfPlay, outOfPlayReasonOf, outOfPlayPhrase,
  roomKindOf, isMudStatePredicate, worldEpochFact, snapshotSubject,
} from "../../services/adventure.mjs";
import { waveFact, playedByFact, P2P_PREDICATES } from "../../domain/p2p/facts.mjs";
import { relatedForTerm } from "../../domain/skos-view.mjs";
import { runMudTurn } from "../../services/mud-turn.mjs";
import { parseMudEditorText, planMudEditorSync } from "../../services/mud-editor.mjs";
import { mudSpeciesOf } from "../../domain/game-config.mjs";
import { worldProvenanceTag } from "../../domain/worlds-pack.mjs";
import { resolveSpriteForClass, SPRITE_REGISTRY, classAncestorChain } from "../../domain/sprite-map.mjs";
import { resolveSpriteAsset } from "../../domain/sprite-templates.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { graphAsk, enginePlan } from "./engine-surface.mjs";

/** A live, shared mud world several characters can each act in. `worldPayload`
 *  is `{ name, facts, rules, opening }` — the same shape adventure-browser-
 *  entry.mjs's own worldPayload takes, read once at build time through the
 *  real Node worlds-pack provider (see mud-viz.mjs's header for why: the
 *  world's canonical source is a Node-only gzipped JSONL shard the browser
 *  cannot read). `characters` is the roster this page drives (e.g. the two
 *  ids pickMudRoster drew this reset). The world is opened for exactly that
 *  list (worldFactsForCast, below): more animals than mud-garden hand-authors
 *  are minted, fewer leaves the ones nobody is playing out of the world
 *  altogether.
 *
 *  Returns `{ memoryDir, codeGraph, graph, refreshGraph, windows, snapshot }`.
 *  `codeGraph` is the known-empty index the turn engine and a scripted
 *  autoplayTick read; `graph` is this world's own memory store projected for
 *  `ask()` (refreshGraph rebuilds it on demand). `windows` is a plain object
 *  keyed by character id, each value `{ character, turn, autoplayTick,
 *  visitedRoomIds, turnsTaken, isOutOfPlay, outOfPlayReason }`. `snapshot()` is
 *  the one OMNISCIENT read this module exposes — the central world map's own
 *  data source, never a per-window one. */
export async function createMudSession(worldPayload, { characters = [], epoch = 0 } = {}) {
  const memoryDir = createInMemoryStore();
  const tag = worldProvenanceTag(worldPayload.name);
  const seedFacts = worldFactsForCast(worldPayload.facts, characters);
  await appendFacts(memoryDir, seedFacts.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  // A recast opens the same deterministic ids over a fresh store while peers
  // may still hold the old run's snapshots. The epoch marker is what makes
  // every fold — local and merged — treat this seed as the newer state. An
  // unrecast boot writes nothing, so a solo session's store is unchanged.
  if (epoch > 0) await appendFacts(memoryDir, [{ ...worldEpochFact(epoch), provenance: tag }]);
  for (const rule of worldPayload.rules) {
    await appendRule(memoryDir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
  }

  // ONE holder, shared by every character's runTurn call — "mud-garden is
  // already live" is true for the whole world at once, the same reason
  // adventure-browser-entry.mjs seeds its own single-player planHolder this
  // way rather than through the "play <world>" opener (which needs a
  // shipped "player" individual mud-garden deliberately has none of).
  const planHolder = { state: { adventure: { world: worldPayload.name } } };
  // A known-empty code graph: code-structure questions get the same honest
  // no-code-graph answer an un-pointed CLI session gives, never a crash — the
  // turn engine (and a scripted autoplayTick) keep reading THIS one for their
  // own in-turn code lane.
  const codeGraph = parseEntities({ individuals: [], objectProperties: [] });
  // The world's own minted ids ("groundhog-1", "carrot-2") are declared as
  // vocabulary inside the adventure lane itself, for the length of one world
  // command — see adventure.mjs's own worldLexicon. This page hands over the
  // plain core lexicon and lets the lane do it.
  const lexicon = loadLexicon();

  async function readWorld() {
    const rows = readFactRows(await loadMemory(memoryDir));
    return { rows, state: foldWorldState(worldActionRows(rows)) };
  }

  // What `tmct.ask()` traverses is a different graph: this shared world's own
  // memory store, projected through memoryFactGraphPayload. Rebuilt on demand
  // rather than once at open, because every character's turn grows the store.
  // Built off readWorld()'s own rows rather than a second readFactRows call.
  let memoryGraph = parseEntities({ individuals: [], objectProperties: [] });
  async function refreshGraph() {
    const { rows } = await readWorld();
    memoryGraph = parseEntities(memoryFactGraphPayload(rows));
    return memoryGraph;
  }

  async function roomOf(character) {
    const { state } = await readWorld();
    return state.placements.get(character)?.object ?? null;
  }

  const windows = {};
  for (const character of characters) {
    // Deliberately per-closure, never on a shared object: a window's own
    // "it"/"there" belongs to that window's own conversation, and its own
    // discovered-room history is the real fog of war this page promises —
    // sharing either across characters would leak one window's state into
    // another's. createTurnSession owns focus/last for us; planState is the
    // one piece that is NOT per-character (see planHolder above), so it is
    // threaded through buildExtraOptions/captureExtraState instead of living
    // in the session's own internal slot.
    const visitedRoomIds = new Set();
    // This character's OWN turns, not the page's shared tick counter: two
    // windows playing at different speeds, or one paused while the other
    // runs, have genuinely different counts, and showing the shared one under
    // both animals says something untrue about each.
    let turnsTaken = 0;
    const startRoom = await roomOf(character);
    if (startRoom) visitedRoomIds.add(startRoom);

    const turnSession = createTurnSession({
      memoryDir, graph: codeGraph, lexicon, sessionId: character,
      vocabHint: 'Try a world command ("dig north", "eat the carrot-1"), or ask "what food do you know about".',
      buildExtraOptions: () => ({
        actingSubject: character, planState: planHolder.state,
      }),
      captureExtraState: async (result, state) => {
        if ("planState" in result) planHolder.state = state.planState;
        turnsTaken += 1;
        const here = await roomOf(character);
        if (here) visitedRoomIds.add(here);
      },
    });

    windows[character] = {
      character,

      /** One typed chat command, dispatched exactly like every other viz
       *  page's chat dock — the same runTurn the CLI runs, scoped to this
       *  character via actingSubject. A throwing runTurn must never end the
       *  session; this window has no other chance to show this turn's
       *  answer. */
      turn: turnSession.turn,

      /** One whole scripted turn (mud-turn.mjs's runMudTurn): investigate,
       *  walk toward known food, or roll at the edge (dig). `k` is the turn
       *  ordinal the caller drives — mud-viz.mjs's own global turn counter,
       *  so every character's turn lands on a distinct, strictly increasing
       *  number regardless of which window fired it. Returns runMudTurn's
       *  own `{ character, k, room, roomAfter, actions, learned, text,
       *  note }` unmodified, so the caller can render the speech-bubble/
       *  dig-flourish triggers straight off `actions`. */
      async autoplayTick(k) {
        const result = await runMudTurn(character, { world: worldPayload.name, memoryDir, env: {}, graph: codeGraph, k });
        // A turn that ended in starvation still happened, and still counts —
        // only a DECLINED turn (no room to act in) leaves the tally alone.
        if (result.room) turnsTaken += 1;
        if (result.roomAfter) visitedRoomIds.add(result.roomAfter);
        return result;
      },

      /** This character's own discovered-room history — real fog of war,
       *  never merged with a sibling window's. */
      visitedRoomIds: () => [...visitedRoomIds],

      /** How many turns THIS character has taken — its own scripted ticks and
       *  its own typed commands, and nobody else's. */
      turnsTaken: () => turnsTaken,

      /** True once this character's run has ended — a predator ate it, or its
       *  mass ran out. It takes no further turns and every command it gives
       *  declines, so a caller can stop ticking it and say so on screen. */
      async isOutOfPlay() {
        const { state } = await readWorld();
        return isOutOfPlay(state, character);
      },

      /** WHICH ending it was — "eaten" or "starved" — or null while it is still
       *  playing. The two read nothing alike on screen, so a pane showing a
       *  fate needs the reason, not just the fact. */
      async outOfPlayReason() {
        const { state } = await readWorld();
        return outOfPlayReasonOf(state, character);
      },
    };
  }

  /** The one OMNISCIENT read this module exposes: every room, every
   *  character, every level, no fog of war — the central world map's own
   *  data source. Never call this for a per-window room view; use
   *  worldDigestRows/roomAffordances against ONE room instead. */
  async function snapshot() {
    const rows = readFactRows(await loadMemory(memoryDir));
    const state = foldWorldState(worldActionRows(rows));
    return { rows, state };
  }

  /** The world editor's own store sync: parse `text` (mud-editor.mjs's own
   *  parseMudEditorText), plan the writes it implies, and apply them — scoped to
   *  THIS world's provenance tag only. Returns `{ unrecognized, added, removed }`.
   *
   *  Two things this does that a fresh, unplayed world would not need.
   *  Retractions run only when the WHOLE document parsed cleanly, so a half-typed
   *  line is never read as "this fact is gone". And a fold-versioned write
   *  (a placement, an openness, a mass) is stamped `subject@turnN` at one past
   *  the world's own turn count, exactly the way every in-game action's commit
   *  writes: the fold takes the newest turn, so an untagged row would sit at turn
   *  zero and lose to the snapshot the last played turn already left behind —
   *  the edit would look accepted and change nothing. */
  async function applyEdit(text) {
    const allRows = readFactRows(await loadMemory(memoryDir));
    const worldRows = allRows.filter((r) => typeof r.provenance === "string" && r.provenance.indexOf(tag) === 0);
    const state = foldWorldState(worldRows);
    const { triples, unrecognized } = parseMudEditorText(text);
    const { toAppend, toRemoveIds } = planMudEditorSync(worldRows, state, triples);
    const editTurn = state.turnCount + 1;
    if (toAppend.length) {
      await appendFacts(memoryDir, toAppend.map((f) => ({
        subject: f.kind === "other" ? f.subject : snapshotSubject(f.subject, editTurn, state.epoch),
        predicate: f.predicate,
        object: f.object,
        provenance: f.kind === "other" ? tag : `${tag}:turn${editTurn}`,
      })));
    }
    const removed = unrecognized.length === 0 && toRemoveIds.length
      ? (await removeFacts(memoryDir, toRemoveIds)).removed.length
      : 0;
    return { unrecognized, added: toAppend.length, removed };
  }

  // Wall-clock resolution is 1ms, and both writers below are content-addressed
  // by (subject, predicate, object) — a second wave from the same character in
  // the same room is the SAME fact id, so it only registers as a change if its
  // provenance tag differs. Two writes inside one tick would share a timestamp,
  // share a tag, and the second would silently vanish. p2p-room.mjs nudges its
  // own clock for exactly this reason; this is the same nudge for the writes
  // that happen before a room exists.
  let lastWriteMs = -Infinity;
  function stampNow() {
    const nudged = Math.max(Date.now(), lastWriteMs + 1);
    lastWriteMs = nudged;
    return new Date(nudged).toISOString();
  }

  /** `character` waves in whichever room it currently stands in — an ordinary
   *  add-only fact, so a page with no network renders it exactly like a page
   *  sharing the world with three others. Returns the room waved in, or null
   *  when the character stands nowhere (out of play). Nothing is ever
   *  retracted: "currently waving" is a recency read over this fact's own
   *  provenance timestamp. */
  async function wave(character) {
    const here = await roomOf(character);
    if (!here) return null;
    await appendFacts(memoryDir, [waveFact(character, here, stampNow())]);
    return here;
  }

  /** Claim `characters` for `peerId` — one add-only `mgx:playedBy` fact each.
   *  Claims never overwrite: two peers claiming the same animal both write,
   *  and every reader settles it the same way by taking the oldest claim. */
  async function claimCharacters(characters, peerId) {
    const at = stampNow();
    const claims = (characters || []).map((character) => playedByFact(character, peerId, at));
    if (claims.length) await appendFacts(memoryDir, claims);
    return claims.length;
  }

  return {
    memoryDir,
    codeGraph,
    get graph() { return memoryGraph; },
    refreshGraph,
    windows, snapshot, applyEdit, wave, claimCharacters,
  };
}

/** `count` entries drawn at random from `roster`, in random order, without
 *  repeats — which animals this visit is played with. Called fresh on every
 *  reset, so the same page gives a different pairing each time and the world
 *  never reads as one fixed cast. `random` is injectable so a caller can pin
 *  the draw; the world engine itself still writes no randomness anywhere, and
 *  this picks the players, never anything the world folds. */
export function pickMudRoster(roster, { count = 2, random = Math.random } = {}) {
  const pool = [...(roster || [])];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/** `roster` grown to `size` ids by numbering more instances of the species it
 *  already names — "mole-2", "vole-3" — so a page can cast more animals than
 *  the world hand-authors individuals for. The authored ids come first and
 *  keep their own numbers; a minted id never collides with one. The species
 *  round-robins, so the extras stay spread across the roster's animals rather
 *  than piling ten moles into the garden. Pure. */
export function expandMudRoster(roster, size) {
  const ids = [...(roster || [])];
  if (!ids.length) return ids;
  const used = new Set(ids);
  const species = [...new Set(ids.map(mudSpeciesOf))];
  for (let instance = 1; ids.length < size; instance += 1) {
    for (const kind of species) {
      if (ids.length >= size) break;
      const id = `${kind}-${instance}`;
      if (used.has(id)) continue;
      used.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** The facts that place `characters` the world's own `facts` never placed —
 *  each one copied wholesale from an authored individual of the same species,
 *  with the subject swapped. Copying rather than composing is what keeps a
 *  minted animal an ORDINARY one: it arrives with the same type, the same
 *  starting room and the same mass mud-garden gives its own mole, and it
 *  picks up anything a later edit adds to that mole for free. A species the
 *  world authors nobody of is skipped rather than guessed at. Pure. */
export function mintedCharacterFacts(facts, characters) {
  const rows = facts || [];
  const placedIn = (subject) => rows.some((f) => f.subject === subject && f.predicate === "mgx:currently-in");
  const minted = [];
  for (const character of characters || []) {
    if (placedIn(character) || minted.some((f) => f.subject === character)) continue;
    const species = mudSpeciesOf(character);
    const template = rows.find((f) => f.predicate === "mgx:currently-in" && mudSpeciesOf(f.subject) === species);
    if (!template) continue;
    for (const fact of rows) {
      if (fact.subject !== template.subject) continue;
      minted.push({ subject: character, predicate: fact.predicate, object: fact.object });
    }
  }
  return minted;
}

/** `facts` opened for exactly `characters`: the playable animals nobody is
 *  playing are left out of the world, and the characters the world authors
 *  nobody for are minted in. The first half is what keeps the cast honest —
 *  an authored animal nobody drives stands in its starting room for the whole
 *  run, shows up in every room description and answers when talked to, all
 *  without ever taking a turn. The fox, a den's resident mouse and every prop
 *  are untouched: they are the world, not the cast. Pure. */
export function worldFactsForCast(facts, characters) {
  const rows = facts || [];
  const cast = new Set(characters || []);
  const uncast = new Set(rows
    .filter((f) => f.predicate === "rdf:type" && f.object === "adventurer" && !cast.has(f.subject))
    .map((f) => f.subject));
  return rows.filter((f) => !uncast.has(f.subject)).concat(mintedCharacterFacts(rows, characters));
}

// Several characters, one world, so a line has to say who is speaking:
// `tmct.turn(line, { as: "mole-1" })` routes to that character's own window,
// which owns its private focus/last and its own fog of war. Everything else a
// window does — a scripted autoplayTick, its visited rooms, whether it is
// still in play — stays on `tmct.session.windows[id]`, because those are
// per-character state rather than questions anyone could ask in words.
//
// `tmct.page` keeps the sprite resolution and the digest/affordance/knowledge
// readers the room view and chat pills render from, the roster helpers that
// decide which animals this visit is played with, the two predicate lists the
// P2P layer checks against, and the SKOS neighbourhood behind the edit mode's
// cursor pills — none of which is `.toString()`-splice-safe.
publishTmctSurface({
  open: createMudSession,
  turn: (line, options, session) => {
    const character = options?.as;
    const characterWindow = character ? session.windows[character] : null;
    if (!characterWindow) {
      return {
        answer: `say which character is speaking — tmct.turn(line, { as: "${Object.keys(session.windows)[0] || "mole-1"}" })`,
        end: false, record: null, plan: null, research: null,
      };
    }
    return characterWindow.turn(line);
  },
  // The memory projection is rebuilt first, so a direct tmct.ask() sees every
  // fact any character's turn has written into this shared world since the
  // last one.
  ask: async (request, options, session) => {
    await session.refreshGraph();
    return graphAsk(request, options, session);
  },
  plan: enginePlan,
  page: {
    pickMudRoster, expandMudRoster, mintedCharacterFacts, worldFactsForCast,
    resolveSpriteForClass, SPRITE_REGISTRY, classAncestorChain, resolveSpriteAsset,
    foldWorldState, worldActionRows, worldDigestRows, roomAffordances,
    personKnowledgeLines, personKnownFoodLines,
    diggableDirections, castInRoom, displayNameOf, isOutOfPlay, outOfPlayReasonOf, outOfPlayPhrase,
    roomKindOf,
    isMudStatePredicate, P2P_PREDICATES,
    relatedForTerm,
  },
});
