// ledger-browser-entry.mjs — the esbuild entry for the memory-ledger page's
// LIVE chat dock (public/ledger-browser.bundle.js, built by
// scripts/build-ledger-bundle.mjs), mirroring chat-browser-entry.mjs's own
// createChatSession shape exactly. The ledger dock is general free-text
// teach+ask, the same shape chat.html's own dock is — not board-game
// specific like plan-browser-entry.mjs's createPlanSession, which has to
// teach and solve a puzzle up front.
//
// Gitignored, Pages-demo-site-only output (scripts/build-demo-site.mjs
// builds it fresh on every deploy, never committed) — see
// memory-ask-browser-entry.mjs's own header for the contrast: THAT bundle
// (factAnswer/factReadBack only, ~1.0MB) is the one COMMITTED under src/ and
// packed by `npm publish`, because `tmct viz` is a real CLI command run
// against a user's own local .tmct store and must ship with the package.
// This bundle carries the FULL runTurn engine (~1.5MB, the same weight
// class as chat/spider-fly/adventure/plan's own browser bundles) and is
// never published — only the hosted demo site's public/ledger.html links to
// it, as an optional sibling script the page degrades honestly without.
import { vocabExampleHint } from "../../services/chat.mjs";
import { createInMemoryStore, normFactTerm, applySeedPayload } from "../../adapters/memory/core.mjs";
import { splitSentencesPreservingPaths } from "../../services/sentences.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import { registerResearchProvider } from "../../adapters/corpus/wikipedia-live.mjs";
import { computeLedgerDataFromPayload } from "../../services/ledger-viz.mjs";
import { digestTermFromPayloadBrowser } from "./digest-client.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { exportFactsJsonl } from "./memory-stats.mjs";

/**
 * A browser ledger-dock session over the real turn engine — createChatSession's
 * exact shape, seeded from the ledger page's own embedded PAYLOAD (the same
 * loadMemory()-shaped object renderLedgerHtml embeds as `const PAYLOAD`), so
 * a fact taught through the dock extends the SAME graph the page renders
 * from, never a disconnected one.
 *
 * Returns { memoryDir, sessionId, turn }, identical to createChatSession.
 * ledger-viz.mjs's own inline script calls computeLedgerDataFromPayload
 * (re-exported below) on `memoryDir.payload` after a turn whose record shows
 * a successful write (`via: "assert"` or `via: "retract"`, `miss: false`) to
 * re-derive the page's rows/terms/edges/stats and re-mount the same view a
 * fresh page load would have rendered — a plain query never re-derives.
 */
export function createLedgerSession({ seedPayload = null, vocabSeeded = false } = {}) {
  const memoryDir = createInMemoryStore();
  applySeedPayload(memoryDir, seedPayload);

  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded);
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  const session = createTurnSession({ memoryDir, graph, lexicon, sessionId, vocabHint });
  return { memoryDir, sessionId, turn: session.turn };
}

// Re-exported so ledger-viz.mjs's own inline script never has to duplicate
// the derivation logic that builds rows/terms/edges/contradictions/
// worthALook/stats from a payload — the same posture chat-browser-entry.mjs
// takes re-exporting registerWinkModel for its own page's CDN wink load.
// splitSentences + exportFactsJsonl carry the dock's paste-and-drop ingest and
// its JSONL export across the bundle boundary, the same one-serializer posture
// chat-browser-entry.mjs holds for its own page.
globalThis.tmctLedger = { createLedgerSession, computeLedgerDataFromPayload, normFactTerm, registerWinkModel, registerResearchProvider, splitSentences: splitSentencesPreservingPaths, exportFactsJsonl, digestTermFromPayloadBrowser };
