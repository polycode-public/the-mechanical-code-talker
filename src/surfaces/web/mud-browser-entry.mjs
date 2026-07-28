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
import { runTurn } from "../../services/chat.mjs";
import { createInMemoryStore, appendFacts, appendRule, loadMemory, readFactRows } from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import {
  foldWorldState, worldActionRows, worldDigestRows, roomAffordances,
  personKnowledgeLines, personKnownFoodLines,
  diggableDirections, castInRoom, displayNameOf, isOutOfPlay, outOfPlayReasonOf, roomKindOf,
} from "../../services/adventure.mjs";
import { runMudTurn } from "../../services/mud-turn.mjs";
import { mudSpeciesOf } from "../../domain/game-config.mjs";
import { worldProvenanceTag } from "../../domain/worlds-pack.mjs";
import { resolveSpriteForClass, SPRITE_REGISTRY, classAncestorChain } from "../../domain/sprite-map.mjs";
import { resolveSpriteAsset } from "../../domain/sprite-templates.mjs";

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
 *  Returns `{ memoryDir, windows, snapshot }`. `windows` is a plain object
 *  keyed by character id, each value `{ character, turn, autoplayTick,
 *  visitedRoomIds, turnsTaken, isOutOfPlay, outOfPlayReason }`. `snapshot()` is
 *  the one OMNISCIENT read this module exposes — the central world map's own
 *  data source, never a per-window one. */
export async function createMudSession(worldPayload, { characters = [] } = {}) {
  const memoryDir = createInMemoryStore();
  const tag = worldProvenanceTag(worldPayload.name);
  const seedFacts = worldFactsForCast(worldPayload.facts, characters);
  await appendFacts(memoryDir, seedFacts.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  for (const rule of worldPayload.rules) {
    await appendRule(memoryDir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
  }

  // ONE holder, shared by every character's runTurn call — "mud-garden is
  // already live" is true for the whole world at once, the same reason
  // adventure-browser-entry.mjs seeds its own single-player planHolder this
  // way rather than through the "play <world>" opener (which needs a
  // shipped "player" individual mud-garden deliberately has none of).
  const planHolder = { state: { adventure: { world: worldPayload.name } } };
  const graph = parseEntities({ individuals: [], objectProperties: [] });
  // The world's own minted ids ("groundhog-1", "carrot-2") are declared as
  // vocabulary inside the adventure lane itself, for the length of one world
  // command — see adventure.mjs's own worldLexicon. This page hands over the
  // plain core lexicon and lets the lane do it.
  const lexicon = loadLexicon();

  async function readWorld() {
    const rows = readFactRows(await loadMemory(memoryDir));
    return { rows, state: foldWorldState(worldActionRows(rows)) };
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
    // another's.
    let focus = null;
    let last = null;
    const visitedRoomIds = new Set();
    // This character's OWN turns, not the page's shared tick counter: two
    // windows playing at different speeds, or one paused while the other
    // runs, have genuinely different counts, and showing the shared one under
    // both animals says something untrue about each.
    let turnsTaken = 0;
    const startRoom = await roomOf(character);
    if (startRoom) visitedRoomIds.add(startRoom);

    windows[character] = {
      character,

      /** One typed chat command, dispatched exactly like every other viz
       *  page's chat dock — the same runTurn the CLI runs, scoped to this
       *  character via actingSubject. A throwing runTurn must never end the
       *  session; this window has no other chance to show this turn's
       *  answer. */
      async turn(line) {
        let result;
        try {
          result = await runTurn(line, {
            config: null, source: null, graph, focus, last, memoryDir,
            sessionId: character, env: {}, lexicon, uiContext: "browser",
            actingSubject: character, planState: planHolder.state,
            vocabHint: 'Try a world command ("dig north", "eat the carrot-1"), or ask "what food do you know about".',
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return { answer: `Something went wrong answering that (${message}). Try rephrasing.`, end: false };
        }
        focus = result.focus;
        last = result.last;
        if ("planState" in result) planHolder.state = result.planState;
        turnsTaken += 1;
        const here = await roomOf(character);
        if (here) visitedRoomIds.add(here);
        return { answer: result.answer, end: Boolean(result.end) };
      },

      /** One whole scripted turn (mud-turn.mjs's runMudTurn): investigate,
       *  walk toward known food, or roll at the edge (dig). `k` is the turn
       *  ordinal the caller drives — mud-viz.mjs's own global turn counter,
       *  so every character's turn lands on a distinct, strictly increasing
       *  number regardless of which window fired it. Returns runMudTurn's
       *  own `{ character, k, room, roomAfter, actions, learned, text,
       *  note }` unmodified, so the caller can render the speech-bubble/
       *  dig-flourish triggers straight off `actions`. */
      async autoplayTick(k) {
        const result = await runMudTurn(character, { world: worldPayload.name, memoryDir, env: {}, graph, k });
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

  return { memoryDir, windows, snapshot };
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

// Re-exported so mud-viz.mjs's own inlined script never duplicates sprite
// resolution or the digest/affordance/knowledge readers its room view and
// chat pills already need — the same reach-through-the-global posture
// adventure-browser-entry.mjs's own globalThis.tmctAdventure takes.
globalThis.tmctMud = {
  createMudSession, pickMudRoster, expandMudRoster, mintedCharacterFacts, worldFactsForCast,
  resolveSpriteForClass, SPRITE_REGISTRY, classAncestorChain, resolveSpriteAsset,
  foldWorldState, worldActionRows, worldDigestRows, roomAffordances,
  personKnowledgeLines, personKnownFoodLines,
  diggableDirections, castInRoom, displayNameOf, isOutOfPlay, outOfPlayReasonOf, roomKindOf,
};
