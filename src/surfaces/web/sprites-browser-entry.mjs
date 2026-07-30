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
// The page's own inline script answers the closed set of catalog-specific
// question shapes (sprite-catalog-viz.mjs's answerSpriteQuestion) BEFORE
// handing a line to this session, so this bundle carries no sprite-specific
// grammar of its own.
import { createInMemoryStore, appendFacts, normFactTerm } from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { SPRITE_FACTS_PROVENANCE } from "../../domain/sprite-facts.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import { createTurnSession } from "./turn-session.mjs";

/** A live in-memory chat session seeded with the embedded sprite-facts rows.
 *  Returns { memoryDir, sessionId, factCount, turn }. */
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
    factCount: factRows.length,
    turn: session.turn,
  };
}

// registerWinkModel is re-exported so the page's own inline script can hand in
// the self-hosted wink pair (./vendor/wink.js) exactly the way chat.html/
// ledger.html/plan.html register theirs — the bundle itself never imports
// wink-nlp (wink-model.mjs's own header explains why).
globalThis.tmctSprites = { createSpriteCatalogSession, registerWinkModel, normFactTerm };
