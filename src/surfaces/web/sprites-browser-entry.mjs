// sprites-browser-entry.mjs — the esbuild entry for sprites.html's chat dock
// (public/sprites-browser.bundle.js, built by scripts/build-sprites-bundle.mjs).
//
// One session factory over the real engine, mirroring
// spider-fly-browser-entry.mjs's createSpiderFlySession minus the game: no
// board, no tick — just the FULL chat turn engine (chat.mjs's runTurn, the
// exact dispatch the CLI runs) over one in-memory store seeded with the
// sprite-facts corpus the page embeds at build time
// (src/domain/sprite-facts.mjs's rows). A question the engine can't ground in
// those rows gets the same refusal the CLI gives — never a guess.
//
// Every line the dock takes goes to that session — the page intercepts
// nothing, so a catalog question is answered by the same membership, count and
// property lanes chat.mjs runs for any other caller, reading the sprite-facts
// predicates straight.
//
// The scene composer's parser rides along here too: extractSceneItems resolves
// a typed class name through ask.mjs's resolveObject, so it needs the real
// resolver in the page rather than a self-contained function the page could
// splice in as text.
//
// `tmct.ask()` needs a real graph to traverse (engine-surface.mjs's graphAsk
// dispatches tmct_ask over `session.graph`), so this session projects its own
// store into one via spriteFactGraphPayload — sprite-facts.mjs's own
// counterpart to spider-fly-browser-entry.mjs's worldRelationGraphPayload
// use. `refreshGraph()` rebuilds it from the store's CURRENT rows (not just
// the embedded factRows), so a fact taught mid-session is visible to a later
// ask() the same way spider-fly's board rebuild is; `turn()` and the
// published `ask` route both call it first, mirroring spider-fly's exact
// wiring points.
import { createInMemoryStore, appendFacts, normFactTerm, loadMemory, readFactRows } from "../../adapters/memory/core.mjs";
import { extractSceneItems, splitSceneBackdrop } from "../../domain/scene-compose.mjs";
import { randomSceneSentence, sceneVocabulary } from "../../domain/scene-random.mjs";
import {
  isMovingSwatchLabel, movingCounterpartLabel, nextFocusMode, initialCardAnimation,
  cardAnimationClick, frameAtTick, focusModeFrames, oscillateWalkStep, walkFrameLabelCandidates,
} from "../../domain/sprite-animation.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { SPRITE_FACTS_PROVENANCE, spriteFactGraphPayload } from "../../domain/sprite-facts.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { graphAsk, enginePlan } from "./engine-surface.mjs";

/** A live in-memory chat session seeded with the embedded sprite-facts rows.
 *  Returns { memoryDir, sessionId, graph, refreshGraph, factCount, turn }. */
export async function createSpriteCatalogSession({ factRows = [] } = {}) {
  const memoryDir = createInMemoryStore();
  await appendFacts(memoryDir, factRows.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: SPRITE_FACTS_PROVENANCE,
  })));

  let graph = parseEntities({ individuals: [], objectProperties: [] });
  async function refreshGraph() {
    const rows = readFactRows(await loadMemory(memoryDir));
    graph = parseEntities(spriteFactGraphPayload(rows));
  }
  await refreshGraph();

  const lexicon = loadLexicon();
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  // `graph` is re-read here, not captured once: createTurnSession binds its
  // own copy at creation, and refreshGraph() reassigns this closure's own
  // variable on every call.
  const turnSession = createTurnSession({
    memoryDir, graph, lexicon, sessionId, vocabHint: "",
    buildExtraOptions: () => ({ graph }),
  });

  return {
    memoryDir,
    sessionId,
    get graph() { return graph; },
    refreshGraph,
    factCount: factRows.length,
    async turn(line) {
      await refreshGraph();
      return turnSession.turn(line);
    },
  };
}

// `tmct.page` keeps the wink seam (the page hands in the self-hosted pair from
// ./vendor/wink.js, exactly the way chat.html/ledger.html/plan.html register
// theirs — the bundle itself never imports wink-nlp), the term normalizer, and
// the scene composer's parser, which reads a typed line into drawable items
// rather than answering anything.
publishTmctSurface({
  open: createSpriteCatalogSession,
  // The graph is rebuilt first, so a direct tmct.ask() call (not just a
  // typed chat turn) sees any fact taught since the last one.
  ask: async (request, options, session) => {
    await session.refreshGraph();
    return graphAsk(request, options, session);
  },
  plan: enginePlan,
  page: {
    registerWinkModel, normFactTerm, extractSceneItems, splitSceneBackdrop,
    randomSceneSentence, sceneVocabulary,
    // The shared animation state machine (sprite-animation.mjs) — the same
    // functions the page splices as text, published here for any caller that
    // reaches the machinery through the bundle instead.
    spriteAnimation: {
      isMovingSwatchLabel, movingCounterpartLabel, nextFocusMode, initialCardAnimation,
      cardAnimationClick, frameAtTick, focusModeFrames, oscillateWalkStep, walkFrameLabelCandidates,
    },
  },
});
