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
import { createInMemoryStore, appendFacts, normFactTerm } from "../../adapters/memory/core.mjs";
import { extractSceneItems } from "../../domain/scene-compose.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { SPRITE_FACTS_PROVENANCE } from "../../domain/sprite-facts.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { graphAsk, enginePlan } from "./engine-surface.mjs";

/** A live in-memory chat session seeded with the embedded sprite-facts rows.
 *  Returns { memoryDir, sessionId, graph, factCount, turn }. */
export async function createSpriteCatalogSession({ factRows = [] } = {}) {
  const memoryDir = createInMemoryStore();
  await appendFacts(memoryDir, factRows.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: SPRITE_FACTS_PROVENANCE,
  })));

  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  const session = createTurnSession({ memoryDir, graph, lexicon, sessionId, vocabHint: "" });

  return {
    memoryDir,
    sessionId,
    graph,
    factCount: factRows.length,
    turn: session.turn,
  };
}

// `tmct.page` keeps the wink seam (the page hands in the self-hosted pair from
// ./vendor/wink.js, exactly the way chat.html/ledger.html/plan.html register
// theirs — the bundle itself never imports wink-nlp), the term normalizer, and
// the scene composer's parser, which reads a typed line into drawable items
// rather than answering anything.
publishTmctSurface({
  open: createSpriteCatalogSession,
  ask: graphAsk,
  plan: enginePlan,
  page: { registerWinkModel, normFactTerm, extractSceneItems },
});
