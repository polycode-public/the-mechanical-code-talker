// spider-fly-browser-entry.mjs — the esbuild entry for the spider-and-fly
// full-screen/home-page pages (public/spider-fly-browser.bundle.js, built by
// scripts/build-spider-fly-bundle.mjs).
//
// Exposes ONE session factory over the real engine, `createSpiderFlySession`,
// mirroring chat-browser-entry.mjs's `createChatSession` shape exactly (same
// underlying runTurn, same minus-every-filesystem-side-effect posture — no
// transcript log, no sidecar, no graph upsert) with two additions specific to
// this game's rendering needs:
//
//   - `session.tick()` runs ONE real engine turn directly
//     (spider-fly.mjs's runSpiderFlyTick), unmediated by chat text, so the
//     page's own ticker gets back the structured `{ turn, agents, ecology }`
//     shape it needs to redraw the board and the HUD's goal lines. This is
//     the "page's ticker calls a turn" half of the brief.
//   - `session.turn(line)` runs the FULL chat turn engine (chat.mjs's
//     runTurn — the exact dispatch the CLI and the home page's own chat run,
//     with the spider-fly lane already wired in), so the in-page chat dock
//     supports the addressed teach-frame ("@spider the fly is east"), the
//     bare "tick" command, and any ordinary fallthrough question ("where is
//     the spider") exactly as the CLI does. This is the "chat dock runs
//     runTurn" half.
//   - `session.snapshot()` is a READ-ONLY fold (spider-fly.mjs's own
//     foldSpiderFlyState, no engine advance) so the page can resync agent
//     positions after a CHAT-driven tick/address turn (whose reply is text,
//     not the structured tick() shape) without double-advancing the turn.
//     It carries no `.goal` — the chat reply text itself already narrates
//     that turn's outcome; only a raw tick() refreshes the HUD's goal lines.
//
// tick(), turn() and snapshot() all read/write the SAME in-memory store
// (`memoryDir`), so the board and the chat dock never disagree about the
// game's state. A caller that lets a play button and a chat submit fire
// concurrently must serialize its own calls against this session — this
// module runs each call to completion but does not queue overlapping ones
// itself (see spider-fly-viz.mjs's own inlined `withLock` wrapper).
//
// The world bootstrap never touches the worlds-pack fetch/provider machinery
// spider-fly-turn.mjs's openSpiderFlyGame uses (that path needs a Node fs
// read or a registered fetch provider, neither of which this bundle carries):
// spider-fly-world.mjs's worldFactRows()/startSpiderFlyGame are already pure/
// in-memory, so the browser bootstraps the identical board directly from
// them. The world's rule rows (worldRuleRows) are skipped on purpose —
// spider-fly.mjs's own header comment confirms grid movement never reads
// them back (hand-written pathfinding over has-exit-* facts, not the taught
// action-rule DSL), so nothing here depends on them being loaded.
import { runTurn } from "../../services/chat.mjs";
import {
  createInMemoryStore, normFactTerm, appendFacts, loadMemory, readFactRows,
} from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import {
  worldFactRows, WORLD_NAME, WORLD_OPENING, cellId, parseCellId, DIRECTION_DELTA, visibleCells,
} from "../../domain/spider-fly-world.mjs";
import { foldSpiderFlyState, runSpiderFlyTick, startSpiderFlyGame, liveWebs, DEFAULT_VISION_RADIUS } from "../../services/spider-fly.mjs";
import { resolveSpriteForClass, SPRITE_REGISTRY } from "../../domain/sprite-map.mjs";
import { resolveSpriteAsset } from "../../domain/sprite-templates.mjs";

/** A live in-memory game the page's ticker and chat dock can both drive.
 *  Returns { memoryDir, sessionId, opening, initial, taxonomyRows, tick,
 *  turn, snapshot }. `initial` is the freshly-bootstrapped board's starting
 *  agents ({ [id]: { cell } }, turn 0, no goal computed yet — the CLI's own
 *  opener shows the same static starting board before any real tick runs).
 *  `taxonomyRows` is the world's static rdfs:subClassOf rows, for
 *  resolveSpriteForClass — immutable for the life of the session, so it is
 *  computed once here rather than re-read from memory on every render. */
export async function createSpiderFlySession({ flyCount = 1 } = {}) {
  const memoryDir = createInMemoryStore();
  const tag = `world:${WORLD_NAME}`;
  const worldRows = [...worldFactRows()];
  await appendFacts(memoryDir, worldRows.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  const taxonomyRows = worldRows
    .filter((f) => f.predicate === "rdfs:subClassOf")
    .map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object }));

  const { facts: startFacts } = await startSpiderFlyGame(memoryDir, { flyCount });
  const initialAgents = {};
  for (const f of startFacts) {
    if (f.predicate === "mgx:currently-in") initialAgents[f.subject] = { ...initialAgents[f.subject], cell: f.object };
    else if (f.predicate === "mgx:mass") initialAgents[f.subject] = { ...initialAgents[f.subject], mass: Number(f.object) };
  }

  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  let focus = null;
  let last = null;
  let planState = { spiderFly: { turn: 0 } };

  return {
    memoryDir,
    sessionId,
    opening: WORLD_OPENING,
    initial: { turn: 0, agents: initialAgents, activeWebs: [] },
    taxonomyRows,

    /** Run one real engine turn directly. Returns spider-fly.mjs's own
     *  { turn, agents, ecology } shape unmodified. */
    async tick() {
      const result = await runSpiderFlyTick(memoryDir);
      planState = { spiderFly: { turn: result.turn } };
      return result;
    },

    /** One dispatched chat turn — the SAME runTurn the CLI and the home
     *  page's own chat run, over this session's own memoryDir. A throwing
     *  runTurn must never kill the session — the page has no other chance
     *  to show this turn's answer. */
    async turn(line) {
      let result;
      try {
        result = await runTurn(line, {
          config: null, source: null, graph, focus, last, memoryDir, sessionId,
          env: {}, lexicon, vocabHint: "", planState,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { answer: `Something went wrong answering that (${message}). Try rephrasing, or /help.`, end: false, record: null, plan: null };
      }
      focus = result.focus;
      last = result.last;
      if ("planState" in result) planState = result.planState;
      return { answer: result.answer, end: Boolean(result.end), record: result.record ?? null, plan: result.plan ?? null };
    },

    /** A read-only fold of the CURRENT board — no engine advance, no goal
     *  lines (see the header comment: only a raw tick() recomputes those).
     *  Lets the page resync positions/turn count/mass/active webs after a
     *  chat-driven tick. Web individuals are never listed as agents (that's
     *  spider-1/fly-1/... only) — they surface only through activeWebs. */
    async snapshot() {
      const rows = readFactRows(await loadMemory(memoryDir));
      const state = foldSpiderFlyState(rows);
      const agents = {};
      for (const [id, place] of state.placements) {
        if (state.removed.has(id) || /^web-\d+$/.test(id)) continue;
        agents[id] = { cell: place.cell, mass: state.mass.get(id)?.value ?? null };
      }
      return { turn: state.turnCount, agents, activeWebs: liveWebs(state.webs, state.turnCount) };
    },
  };
}

// cellId/parseCellId/DIRECTION_DELTA/visibleCells/DEFAULT_VISION_RADIUS are
// re-exported so the page's own rendering script (spider-fly-viz.mjs) never
// has to duplicate grid geometry or the vision-radius default: reconstructing
// a spider's remaining silk-thread path from its returned direction list, and
// computing the POV overlay's visible-cell mask, both need them.
globalThis.tmctSpiderFly = {
  createSpiderFlySession, normFactTerm, resolveSpriteForClass, SPRITE_REGISTRY, resolveSpriteAsset,
  cellId, parseCellId, DIRECTION_DELTA, visibleCells, DEFAULT_VISION_RADIUS,
};
