// mudiii-browser-entry.mjs — the esbuild entry for mudiii.html's live,
// one-player, one-shared-world session (public/mudiii-browser.bundle.js),
// mirroring mud-browser-entry.mjs's own session-factory shape. mudiii differs
// from mud in the two ways mudiii-viz.mjs's own header explains: ONE shared
// conversation rather than one pane per character (`turn(line)` never routes
// on `{ as: character }` — the addressee is in the sentence, "@fox-1 look"),
// and the simulation itself advances as ONE whole-world tick
// (`runPredatorPreyTick`) rather than mud's per-character `autoplayTick`.
//
// `src/services/predator-prey.mjs` — the engine this file drives — does not
// exist in every worktree yet; a concurrent track owns it. The import below
// is guarded (dynamic, try/catch) so this module still loads, and every
// test that imports mudiii-viz.mjs (which never imports this file) is
// unaffected either way. `createMudiiiSession` throws a clear "the engine
// isn't built yet" error if actually called before that track lands, rather
// than a bare ERR_MODULE_NOT_FOUND with no context.
import {
  createInMemoryStore, appendFacts, appendRule, loadMemory, readFactRows, removeFacts,
} from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { memoryFactGraphPayload } from "../../domain/memory-facts.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { worldProvenanceTag } from "../../domain/worlds-pack.mjs";
import { parseMudEditorText, planMudEditorSync } from "../../services/mud-editor.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { graphAsk, enginePlan } from "./engine-surface.mjs";

let engine = null;
async function loadEngine() {
  if (engine) return engine;
  try {
    engine = await import("../../services/predator-prey.mjs");
  } catch (err) {
    throw new Error(
      "mudiii's engine (src/services/predator-prey.mjs) is not built in this worktree yet "
      + `(${err && err.message ? err.message : err})`,
    );
  }
  return engine;
}

/** `count` entries drawn at random from `roster`, in random order, without
 *  repeats — mirrors mud-browser-entry.mjs's own `pickMudRoster`. `random` is
 *  injectable so a caller can pin the draw. Pure. */
export function pickMudiiiRoster(roster, { count = 1, random = Math.random } = {}) {
  const pool = [...(roster || [])];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/** A live, shared town-square world one visitor watches and talks over.
 *  `worldPayload` is `{ name, facts, rules, opening }`, read once at build
 *  time the same way every other viz page's world payload is. `agents` is
 *  the roster this page casts — `[{ id, role }]`, `role` "predator" or
 *  "prey" (MUDIII_ROLES). Unlike mud-browser-entry.mjs's `createMudSession`,
 *  this returns ONE `turn`/`tick` pair for the whole world, never a
 *  per-character `windows` map: mudiii's simulation is a single global step
 *  (`runPredatorPreyTick`) and its conversation is a single shared dock.
 *
 *  Returns `{ memoryDir, codeGraph, graph, refreshGraph, turn, tick,
 *  snapshot, applyEdit, placeFood, recast }`. */
export async function createMudiiiSession(worldPayload, { agents = [], epoch = 0 } = {}) {
  const { startTownSquareGame, runPredatorPreyTick, foldPredatorPreyState, recastTownSquare, placeFood: engPlaceFood } = await loadEngine();

  const memoryDir = createInMemoryStore();
  const tag = worldProvenanceTag(worldPayload.name);
  await appendFacts(memoryDir, (worldPayload.facts || []).map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  for (const rule of worldPayload.rules || []) {
    await appendRule(memoryDir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
  }
  await startTownSquareGame(memoryDir, { agents, epoch, provenance: tag });

  const planHolder = { state: { adventure: { world: worldPayload.name } } };
  const codeGraph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();

  let memoryGraph = parseEntities({ individuals: [], objectProperties: [] });
  async function refreshGraph() {
    const rows = readFactRows(await loadMemory(memoryDir));
    memoryGraph = parseEntities(memoryFactGraphPayload(rows));
    return memoryGraph;
  }

  const turnSession = createTurnSession({
    memoryDir, graph: codeGraph, lexicon, sessionId: "town-square",
    vocabHint: 'Try "@fox-1 look", or "what does fox-1 believe".',
    buildExtraOptions: () => ({ planState: planHolder.state }),
    captureExtraState: async (result, state) => {
      if ("planState" in result) planHolder.state = state.planState;
    },
  });

  /** ONE whole-world step (`runPredatorPreyTick`) — every live agent moves,
   *  the ecology pass runs, and the result names what happened this turn.
   *  `k` is the caller's own global turn counter, mirroring mud-viz.mjs's
   *  page-level serialization. */
  async function tick(k) {
    return runPredatorPreyTick(memoryDir, { turn: k });
  }

  /** The one OMNISCIENT read this module exposes — every agent, every item,
   *  no fog of war, mirroring mud-browser-entry.mjs's own `snapshot`. */
  async function snapshot() {
    const rows = readFactRows(await loadMemory(memoryDir));
    return { rows, state: foldPredatorPreyState(rows) };
  }

  /** The world editor's own store sync, reusing mud-editor.mjs UNCHANGED —
   *  it already round-trips `mgx:model`/`mgx:rotation` (a concurrent track
   *  added those), so nothing here is town-square-specific beyond the
   *  provenance scoping mud-browser-entry.mjs's own `applyEdit` performs. */
  async function applyEdit(text) {
    const allRows = readFactRows(await loadMemory(memoryDir));
    const worldRows = allRows.filter((r) => typeof r.provenance === "string" && r.provenance.indexOf(tag) === 0);
    const state = foldPredatorPreyState(worldRows);
    const { triples, unrecognized } = parseMudEditorText(text);
    const { toAppend, toRemoveIds } = planMudEditorSync(worldRows, state, triples);
    if (toAppend.length) {
      await appendFacts(memoryDir, toAppend.map((f) => ({
        subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
      })));
    }
    const removed = unrecognized.length === 0 && toRemoveIds.length
      ? (await removeFacts(memoryDir, toRemoveIds)).removed.length
      : 0;
    return { unrecognized, added: toAppend.length, removed };
  }

  /** Places one player-placed food item, with player provenance rather than
   *  the world tag — the same "who put that there?" grounding
   *  test/fixtures/mudiii-ticks.json's turn-8 `place-food` event names. */
  async function placeFood(opts) {
    return engPlaceFood(memoryDir, opts);
  }

  async function recast(opts) {
    return recastTownSquare(memoryDir, opts);
  }

  return {
    memoryDir,
    codeGraph,
    get graph() { return memoryGraph; },
    refreshGraph,
    turn: turnSession.turn,
    tick,
    snapshot,
    applyEdit,
    placeFood,
    recast,
  };
}

// tmct.turn(line) reaches the one shared conversation directly (no `{ as }`
// routing — the default publishTmctSurface behaviour, `session.turn(line,
// options)`, is exactly right here, so no `turn` override is passed).
publishTmctSurface({
  open: createMudiiiSession,
  ask: async (request, options, session) => {
    await session.refreshGraph();
    return graphAsk(request, options, session);
  },
  plan: enginePlan,
  page: {
    pickMudiiiRoster,
  },
});
