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
import { createTurnSession } from "./turn-session.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import {
  createInMemoryStore, normFactTerm, appendFacts, loadMemory, readFactRows,
} from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import {
  worldFactRows, WORLD_NAME, WORLD_OPENING, cellId, parseCellId, DIRECTION_DELTA, visibleCells,
  isLiveRenderableAgent,
} from "../../domain/spider-fly-world.mjs";
import { foldSpiderFlyState, runSpiderFlyTick, startSpiderFlyGame, liveWebs, DEFAULT_VISION_RADIUS } from "../../services/spider-fly.mjs";
import { pillsForSpiderFly, oneStepDirectionBetween } from "../../services/spider-fly-turn.mjs";
import { resolveSpriteForClass, SPRITE_REGISTRY } from "../../domain/sprite-map.mjs";
import { resolveSpriteAsset } from "../../domain/sprite-templates.mjs";
import { DEFAULT_GAME_CONFIG } from "../../domain/game-config.mjs";

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

  // The live, in-page-slider-adjustable knobs (mass-loss-rate/spawn-rate/
  // vision-radius per class, and every other spiderFly tunable) — starts at
  // the shipped defaults, mutated only through setConfig() below, and
  // forwarded into every future tick()/turn() call. Never rewinds a value
  // that was already written to a past turn's facts (e.g. a spider already
  // above the OLD lay threshold isn't retroactively un-laid) — a config
  // change only changes what happens FROM HERE ON, same as tmct.toml would.
  let config = { ...DEFAULT_GAME_CONFIG.spiderFly };

  // The chat dock's turn dispatch — createTurnSession owns the focus/last/
  // planState fold and the throw-safe catch fallback every browser entry
  // needs; tick() below reaches into the SAME planState (via setPlanState)
  // so a raw tick and a chat-driven tick can never disagree about the turn
  // count either lane sees next.
  const turnSession = createTurnSession({
    memoryDir, graph, lexicon, sessionId, vocabHint: "",
    buildExtraOptions: () => ({ gameConfig: { ...DEFAULT_GAME_CONFIG, spiderFly: config } }),
  });
  turnSession.setPlanState({ spiderFly: { turn: 0 } });

  return {
    memoryDir,
    sessionId,
    opening: WORLD_OPENING,
    initial: { turn: 0, agents: initialAgents, activeWebs: [] },
    taxonomyRows,

    /** Run one real engine turn directly. Returns spider-fly.mjs's own
     *  { turn, agents, ecology } shape unmodified. */
    async tick() {
      const result = await runSpiderFlyTick(memoryDir, { config });
      turnSession.setPlanState({ spiderFly: { turn: result.turn } });
      return result;
    },

    /** One dispatched chat turn — the SAME runTurn the CLI and the home
     *  page's own chat run, over this session's own memoryDir, via the
     *  shared turn-dispatch wrapper (createTurnSession above) every browser
     *  entry now uses. */
    async turn(line) {
      return turnSession.turn(line);
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
        if (!isLiveRenderableAgent(id, state)) continue;
        agents[id] = { cell: place.cell, mass: state.mass.get(id)?.value ?? null };
      }
      return { turn: state.turnCount, agents, activeWebs: liveWebs(state.webs, state.turnCount) };
    },

    /** The live spiderFly config this session's future tick()/turn() calls
     *  will read — a plain copy, safe for a caller to inspect without
     *  risking a shared-reference mutation. */
    getConfig() {
      return { ...config };
    },

    /** Merge `partial` (any subset of DEFAULT_GAME_CONFIG.spiderFly's own
     *  keys, e.g. `{ spiderMassDecrementPerTurn: 0.2 }`) over the live
     *  config — the in-page sliders' own write path. Every unset sibling
     *  keeps its current value, mirroring resolveGameConfig's own
     *  toml-merge shape so a slider and tmct.toml can never disagree about
     *  what "partial" means. */
    setConfig(partial) {
      config = { ...config, ...partial };
    },
  };
}

// cellId/parseCellId/DIRECTION_DELTA/visibleCells/DEFAULT_VISION_RADIUS are
// re-exported so the page's own rendering script (spider-fly-viz.mjs) never
// has to duplicate grid geometry or the vision-radius default: reconstructing
// a spider's remaining silk-thread path from its returned direction list, and
// computing the POV overlay's visible-cell mask, both need them.
// pillsForSpiderFly/oneStepDirectionBetween are re-exported so the same page
// can build its own dynamic deception-pill container without duplicating
// spider-fly-turn.mjs's own pill logic.
globalThis.tmctSpiderFly = {
  createSpiderFlySession, normFactTerm, resolveSpriteForClass, SPRITE_REGISTRY, resolveSpriteAsset,
  cellId, parseCellId, DIRECTION_DELTA, visibleCells, DEFAULT_VISION_RADIUS,
  pillsForSpiderFly, oneStepDirectionBetween, DEFAULT_GAME_CONFIG, registerWinkModel,
};
