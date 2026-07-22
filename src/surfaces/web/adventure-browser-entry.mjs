// adventure-browser-entry.mjs — the esbuild entry for the adventure's
// full-screen/home-page pages (public/adventure-browser.bundle.js, built by
// scripts/build-adventure-bundle.mjs), mirroring
// spider-fly-browser-entry.mjs's own session-factory shape.
//
// Unlike spider-fly's board, Ashcombe Hall's own facts+rules cannot be
// regenerated in-browser from a pure JS module — its canonical definition is
// a Node-only JSONL corpus source, read through an fs/gzip provider the
// browser cannot run. So this session takes the world as data
// (`worldPayload`, `{ name, facts, rules, opening }`), embedded into the page
// at build time by scripts/build-demo-site.mjs's own read through the real
// worlds-pack provider (see adventure-viz.mjs's header for the full
// rationale) — the bootstrap below then just appends it, exactly the shape
// openAdventure() itself writes for a real chat session.
//
// This session exposes a raw autoplay tick, a read-only snapshot, AND
// (mirroring createSpiderFlySession's own `turn(line)`) a full chat-dock
// entry point: `turn(line)` runs the exact same runTurn the CLI and every
// other viz page's chat dock run, over this session's own memoryDir/graph/
// lexicon, threading `focus`/`last`/`planState` across calls the same way a
// real chat session does. `planState` and `autoplayTick`'s own `planHolder`
// share ONE mutable holder here, so a manual chat command and an auto-play
// tick can never disagree about whether the adventure is still open, mid a
// number game, etc. — whichever ran last leaves the holder as the other's
// starting point. `planHolder.state` starts as adventureTurn's own opened-
// world shape, so BOTH entry points treat every call as a live, already-open
// world rather than a fresh opening line: ordinary in-game commands (look/
// go/take/open/talk/examine/...) dispatch through adventure.mjs's own
// adventureTurn exactly as autoplayTick's calls already do, and anything not
// game-shaped falls through to the ordinary conversational layer, exactly
// like a real CLI session.
import { runTurn } from "../../services/chat.mjs";
import {
  createInMemoryStore, appendFacts, appendRule, loadMemory, readFactRows, removeFacts,
} from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { foldWorldState, worldDigestRows, roomAffordances, worldActionRows } from "../../services/adventure.mjs";
import { runAdventureAutoplayTick, exposedFacts } from "../../services/adventure-autoplay.mjs";
import { parseWorldEditorText, planWorldEditorSync } from "../../services/adventure-editor.mjs";
import { resolveSpriteForClass, SPRITE_REGISTRY, classAncestorChain } from "../../domain/sprite-map.mjs";
import { resolveSpriteAsset } from "../../domain/sprite-templates.mjs";
import { relatedForTerm } from "../../domain/skos-view.mjs";
import { openPersistedStore } from "./idb-persist.mjs";

/** A live in-memory adventure this page's ticker AND chat dock can both
 *  drive. Returns `{ memoryDir, autoplayTick, turn, snapshot }`.
 *  `worldPayload.facts`/`.rules` seed the store exactly the way
 *  openAdventure() itself does for a real session; `planHolder.state` is set
 *  the same way, so adventureTurn treats every subsequent call — auto-play's
 *  own or a visitor's typed one — as a live, already-open world rather than
 *  a fresh opening line.
 *
 *  `restoredPayload` (optional) is a whole Backend-B payload snapshot saved
 *  by an earlier visit (idb-persist.mjs): assigned directly onto the fresh
 *  store INSTEAD of re-appending the world's seed facts/rules — the snapshot
 *  already carries them, plus every @turnN state row played since, so the
 *  world resumes exactly where the fold left it. `restoredVisitedRoomIds`
 *  carries the matching exposure set forward; without it, only the player's
 *  current room counts as visited. */
export async function createAdventureSession(worldPayload, { restoredPayload = null, restoredVisitedRoomIds = null } = {}) {
  const memoryDir = createInMemoryStore();
  const tag = `world:${worldPayload.name}`;
  if (restoredPayload) {
    memoryDir.payload = { ...memoryDir.payload, ...restoredPayload };
  } else {
    await appendFacts(memoryDir, worldPayload.facts.map((f) => ({
      subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
    })));
    for (const rule of worldPayload.rules) {
      await appendRule(memoryDir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
    }
  }

  const planHolder = { state: { adventure: { world: worldPayload.name } } };
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  // visitedRoomIds is the ONE exposure set both `turn()` and `autoplayTick()`
  // grow — a deliberate merge, not two separate histories. Both entry points
  // move the SAME player through the SAME shared memoryDir: `here` is always
  // read fresh off the live fact store (state.placements.get("player")), not
  // off whichever path last ran, so by the time either call finishes, the
  // room the player is standing in is genuinely known to a visitor looking
  // at the page regardless of which control moved them there. Keeping two
  // separate sets would make the map/goal panels UNDER-report a room a
  // visitor plainly just walked autoplay through (or vice versa) — a false
  // conservatism, not real honesty, since nothing about the OTHER path's
  // moves is hidden from this same session. runAdventureAutoplayTick's own
  // returned `exposedRoomIds` already folds forward whatever it was handed,
  // so feeding it this merged set on every tick, and folding its result back
  // into the same variable, is enough: manual moves feed autoplay's own
  // reasoning, autoplay's moves feed the panels, with no separate
  // bookkeeping either way.
  let visitedRoomIds = new Set(Array.isArray(restoredVisitedRoomIds) ? restoredVisitedRoomIds : []);
  const openingRows = readFactRows(await loadMemory(memoryDir));
  const openingHere = foldWorldState(worldActionRows(openingRows)).placements.get("player")?.object ?? null;
  if (openingHere) visitedRoomIds.add(openingHere);

  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  let focus = null;
  let last = null;

  return {
    memoryDir,

    /** One auto-play tick: infer the goal, execute exactly one move through
     *  adventureTurn (adventure-autoplay.mjs's own contract), thread the
     *  exposed-room set forward. Returns runAdventureAutoplayTick's own
     *  `{ turn, goal, plan, done, stalled }` unmodified. */
    async autoplayTick() {
      const result = await runAdventureAutoplayTick(memoryDir, {
        exposedRoomIds: visitedRoomIds, planHolder, sessionId, env: {},
      });
      visitedRoomIds = result.exposedRoomIds;
      return result;
    },

    /** One dispatched chat turn — the SAME runTurn the CLI and every other
     *  viz page's own chat dock run, over this session's own memoryDir. A
     *  throwing runTurn must never kill the session — the page has no other
     *  chance to show this turn's answer. Grows `visitedRoomIds` with the
     *  player's post-turn room (a no-op add when the command didn't move
     *  anyone) — the manual-play half of the merged exposure set. */
    async turn(line) {
      let result;
      try {
        result = await runTurn(line, {
          config: null, source: null, graph, focus, last, memoryDir, sessionId,
          env: {}, lexicon, uiContext: "browser",
          vocabHint: 'Try a world question ("where is the key"), or teach me: "remember: the moat is a ditch".',
          planState: planHolder.state,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { answer: `Something went wrong answering that (${message}). Try rephrasing, or /help.`, end: false, record: null, plan: null };
      }
      focus = result.focus;
      last = result.last;
      if ("planState" in result) planHolder.state = result.planState;
      const here = foldWorldState(worldActionRows(readFactRows(await loadMemory(memoryDir)))).placements.get("player")?.object ?? null;
      if (here) visitedRoomIds.add(here);
      return { answer: result.answer, end: Boolean(result.end), record: result.record ?? null, plan: result.plan ?? null };
    },

    /** A read-only fold of the current room — no engine advance — for the
     *  page's own redraw after boot, after every tick, and after every
     *  manual chat turn. `visitedRoomIds` travels as a plain array (the same
     *  merged exposure set `turn()`/`autoplayTick()` both grow) so the
     *  carrying/map/goal panels can read it without holding a live
     *  reference into this closure's own Set. */
    async snapshot() {
      const rows = readFactRows(await loadMemory(memoryDir));
      // State the page plays and maps from is the game world only; the raw
      // rows still travel for the digest's background colour.
      const state = foldWorldState(worldActionRows(rows));
      const here = state.placements.get("player")?.object ?? null;
      return { rows, state, here, turn: state.turnCount, visitedRoomIds: [...visitedRoomIds] };
    },

    /** The world editor's own store sync: parse `text` (adventure-editor.mjs's
     *  own parseWorldEditorText), plan the implied writes (planWorldEditorSync),
     *  and apply them — scoped to THIS world's own provenance tag only, never
     *  the default persona's background corpus that shares the same live
     *  memory store (an unscoped diff would read every unrelated background
     *  fact as "not in this text" and try to retract it). Retractions
     *  (removeFacts) only ever run when the WHOLE document parsed cleanly —
     *  see adventure-editor.mjs's own header for why a typo must never be
     *  read as "this fact is gone". Returns `{ unrecognized, added, removed }`. */
    async applyEdit(text) {
      const allRows = readFactRows(await loadMemory(memoryDir));
      const worldRows = allRows.filter((r) => typeof r.provenance === "string" && r.provenance.indexOf(tag) === 0);
      const state = foldWorldState(worldRows);
      const { triples, unrecognized } = parseWorldEditorText(text, worldRows);
      const { toAppend, toRemoveIds } = planWorldEditorSync(worldRows, state, triples);
      if (toAppend.length) {
        await appendFacts(memoryDir, toAppend.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag })));
      }
      const removedCount = unrecognized.length === 0 && toRemoveIds.length ? (await removeFacts(memoryDir, toRemoveIds)).removed.length : 0;
      const here = foldWorldState(readFactRows(await loadMemory(memoryDir))).placements.get("player")?.object ?? null;
      if (here) visitedRoomIds.add(here);
      return { unrecognized, added: toAppend.length, removed: removedCount };
    },
  };
}

// Re-exported so the page's own rendering script (adventure-viz.mjs) never
// has to duplicate sprite resolution, the digest reader, the room
// affordances the chat dock's own pills read from, or (foldWorldState,
// exposedFacts) the exposure-filtered fold the goal-status panel mirrors —
// the same posture spider-fly-browser-entry.mjs's own
// globalThis.tmctSpiderFly re-export takes. `relatedForTerm`/
// `classAncestorChain` back the edit mode's own cursor-suggestion pills
// (adventure-viz.mjs's suggestionsForTerm mirrors this same pairing against
// the global, the same reach-through-the-global pattern captionFor/pillsFor
// already use for their own adventure.mjs calls).
globalThis.tmctAdventure = {
  createAdventureSession, resolveSpriteForClass, SPRITE_REGISTRY, resolveSpriteAsset,
  worldDigestRows, roomAffordances, foldWorldState, exposedFacts,
  relatedForTerm, classAncestorChain, openPersistedStore,
};
