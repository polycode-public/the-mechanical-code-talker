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
import { createInMemoryStore, normFactTerm, applySeedPayload, loadMemory, readFactRows, wrapRowBackend } from "../../adapters/memory/core.mjs";
import { createHttpRowBackend, withOneRetryOnUnavailable } from "./http-row-backend.mjs";
import { splitSentencesPreservingPaths } from "../../services/sentences.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { memoryFactGraphPayload } from "../../domain/memory-facts.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import { registerResearchProvider } from "../../adapters/corpus/wikipedia-live.mjs";
import { computeLedgerDataFromPayload } from "../../services/ledger-viz.mjs";
import { digestTermFromPayloadBrowser } from "./digest-client.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { exportFactsJsonl } from "./memory-stats.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { graphAsk, enginePlan } from "./engine-surface.mjs";

/**
 * A browser ledger-dock session over the real turn engine — createChatSession's
 * exact shape, seeded from the ledger page's own embedded PAYLOAD (the same
 * loadMemory()-shaped object renderLedgerHtml embeds as `const PAYLOAD`), so
 * a fact taught through the dock extends the SAME graph the page renders
 * from, never a disconnected one.
 *
 * Returns { memoryDir, sessionId, graph, codeGraph, refreshGraph, turn },
 * identical to createChatSession — including the two-graph split: `codeGraph`
 * is the known-empty index the turn engine reads, and `graph` is the ledger's
 * own store projected for `ask()`, so a question about the facts on the page
 * traverses those facts while a code-structure question still refuses honestly.
 *
 * ledger-viz.mjs's own inline script calls computeLedgerDataFromPayload
 * (re-exported below) on the session's current payload after a turn whose
 * record shows a successful write (`via: "assert"` or `via: "retract"`,
 * `miss: false`) to re-derive the page's rows/terms/edges/stats and re-mount
 * the same view a fresh page load would have rendered — a plain query never
 * re-derives.
 *
 * `awsSessionKey` (optional): the page's AWS-mode backend choice, the same
 * seam chat-browser-entry.mjs's own createChatSession takes — given, the
 * session's memory binds to `createHttpRowBackend({apiBase: "/", sessionKey:
 * awsSessionKey, fetchImpl})` wrapped with `seedPayload` as its read-only
 * seed overlay; omitted, memory stays the plain in-memory store. `fetchImpl`
 * (optional) overrides the ambient `fetch` the row backend calls through —
 * a test points it at a running row-service double.
 */
export function createLedgerSession({
  seedPayload = null, vocabSeeded = false, awsSessionKey = null,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  // onOversizedRow: "drop" — see chat-browser-entry.mjs's own createChatSession
  // for why: a real corpus seed's high-fan-out mgx:statedBy group is already
  // over the row cap before this session teaches anything, and a session's
  // own new fact adding one more edge to it can't fit one wire row either.
  // The read side (core.mjs) always keeps every seed row regardless, so
  // nothing about the seed itself is lossy — only that one property's
  // cross-fact edge index stays as unwritable as the seed's own copy of it.
  const memoryDir = awsSessionKey
    ? wrapRowBackend(withOneRetryOnUnavailable(createHttpRowBackend({ apiBase: "/", sessionKey: awsSessionKey, fetchImpl })), { basePayload: seedPayload, onOversizedRow: "drop" })
    : createInMemoryStore();
  if (!awsSessionKey) applySeedPayload(memoryDir, seedPayload);

  const codeGraph = parseEntities({ individuals: [], objectProperties: [] });

  let memoryGraph = parseEntities({ individuals: [], objectProperties: [] });
  async function refreshGraph() {
    memoryGraph = parseEntities(memoryFactGraphPayload(readFactRows(await loadMemory(memoryDir))));
    return memoryGraph;
  }

  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded, "browser");
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  const session = createTurnSession({ memoryDir, graph: codeGraph, lexicon, sessionId, vocabHint });
  return {
    memoryDir,
    sessionId,
    get graph() { return memoryGraph; },
    codeGraph,
    refreshGraph,
    turn: session.turn,
  };
}

// `tmct.page` keeps what the page's own script renders with and the engine has
// no plain-English form for: the payload-to-rows/terms/edges/stats derivation
// the ledger view re-mounts from after a successful teach, the digest reader,
// the wink and research seams, and the two serializers behind the dock's
// paste-ingest and JSONL export.
publishTmctSurface({
  open: createLedgerSession,
  // The memory projection is rebuilt first, so a direct tmct.ask() sees every
  // fact the dock or the ingest panel has taught since the last one.
  ask: async (request, options, session) => {
    await session.refreshGraph();
    return graphAsk(request, options, session);
  },
  plan: enginePlan,
  page: {
    computeLedgerDataFromPayload, normFactTerm, registerWinkModel, registerResearchProvider,
    splitSentences: splitSentencesPreservingPaths, exportFactsJsonl, digestTermFromPayloadBrowser,
  },
});
