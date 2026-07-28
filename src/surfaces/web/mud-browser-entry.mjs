// mud-browser-entry.mjs — the esbuild entry for mud.html's four-character,
// one-shared-world browser session (public/mud-browser.bundle.js), mirroring
// adventure-browser-entry.mjs's own session-factory shape. The difference is
// the whole point of the mud demo: adventure-browser-entry.mjs drives ONE
// player through one world; this file drives FOUR independent characters
// through the SAME live world, over the SAME memoryDir.
//
// What's shared across all four characters, and why: the store itself
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
// SERIALIZING ticks across the four characters when more than one window is
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
} from "../../services/adventure.mjs";
import { runMudTurn } from "../../services/mud-turn.mjs";
import { worldProvenanceTag } from "../../domain/worlds-pack.mjs";
import { resolveSpriteForClass, SPRITE_REGISTRY, classAncestorChain } from "../../domain/sprite-map.mjs";
import { resolveSpriteAsset } from "../../domain/sprite-templates.mjs";

/** A live, shared mud world four characters can each act in. `worldPayload`
 *  is `{ name, facts, rules, opening }` — the same shape adventure-browser-
 *  entry.mjs's own worldPayload takes, read once at build time through the
 *  real Node worlds-pack provider (see mud-viz.mjs's header for why: the
 *  world's canonical source is a Node-only gzipped JSONL shard the browser
 *  cannot read). `characters` is the roster this page drives (e.g.
 *  `["mole-1", "vole-1", "badger-1", "groundhog-1"]`) — every character
 *  already placed by the world's own seed facts.
 *
 *  Returns `{ memoryDir, windows, snapshot }`. `windows` is a plain object
 *  keyed by character id, each value `{ character, turn, autoplayTick,
 *  visitedRoomIds }`. `snapshot()` is the one OMNISCIENT read this module
 *  exposes — the central world map's own data source, never a per-window
 *  one. */
export async function createMudSession(worldPayload, { characters = [] } = {}) {
  const memoryDir = createInMemoryStore();
  const tag = worldProvenanceTag(worldPayload.name);
  await appendFacts(memoryDir, worldPayload.facts.map((f) => ({
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
  const lexicon = loadLexicon();

  async function roomOf(character) {
    const rows = readFactRows(await loadMemory(memoryDir));
    const state = foldWorldState(worldActionRows(rows));
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
        if (result.roomAfter) visitedRoomIds.add(result.roomAfter);
        return result;
      },

      /** This character's own discovered-room history — real fog of war,
       *  never merged with a sibling window's. */
      visitedRoomIds: () => [...visitedRoomIds],
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

// Re-exported so mud-viz.mjs's own inlined script never duplicates sprite
// resolution or the digest/affordance/knowledge readers its room view and
// chat pills already need — the same reach-through-the-global posture
// adventure-browser-entry.mjs's own globalThis.tmctAdventure takes.
globalThis.tmctMud = {
  createMudSession, resolveSpriteForClass, SPRITE_REGISTRY, classAncestorChain, resolveSpriteAsset,
  foldWorldState, worldActionRows, worldDigestRows, roomAffordances,
  personKnowledgeLines, personKnownFoodLines,
};
