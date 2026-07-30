// chat-browser-entry.mjs — the esbuild entry for chat.html's embedded chat
// (built by scripts/build-chat-bundle.mjs).
//
// Unlike memory-ask-browser-entry.mjs (factAnswer/factReadBack only), this
// exposes the FULL turn engine: createChatSession wraps the shared
// createTurnSession (turn-session.mjs) around chat.mjs's runTurn — the
// focus/last/planState/researchState threading src/services/chat-session.mjs's
// createSession.turn does, minus every filesystem side effect (no transcript
// log, no sidecar, no graph upsert). Memory is an in-memory Backend-B handle,
// optionally pre-loaded with a built seed payload (scripts/build-chat-seed.mjs),
// so teach turns, recall, proof chains and the honest miss all run
// client-side with zero I/O.
//
// Two browser traps this file still owns, beyond what createTurnSession
// already covers (passing `env: {}` explicitly, since a browser has no
// `process` global; the crash-resistant catch fallback):
//   - the uuid adapter needs node:crypto — the session id comes from the
//     Web Crypto API instead, with a Date.now fallback for contexts
//     without it;
//   - setDigestStructures is imported from adapters/corpus/digest-bank.mjs.
//     Under the bundle build, scripts/build-chat-bundle.mjs swaps that import
//     for a live in-memory twin, and this call actually feeds it the page's
//     embedded structure rows; this file is ALSO imported directly by plain
//     Node (test-e2e/web-chat-memory.test.mjs, exercising the same engine contract
//     without a browser), where the import resolves to the real fs+TOML
//     adapter — its own setDigestStructures is a documented no-op there
//     (see that module's header), so the call is harmless either way, never
//     a load error and never a behavior change on the Node side.
import { vocabExampleHint } from "../../services/chat.mjs";
import { createInMemoryStore, normFactTerm, loadMemory, readFactRows, applySeedPayload } from "../../adapters/memory/core.mjs";
import { splitSentencesPreservingPaths } from "../../services/sentences.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import { setDigestStructures } from "../../adapters/corpus/digest-bank.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { memoryStats, exportFactsJsonl } from "./memory-stats.mjs";
// The reference-pack provider seam: the page registers a fetch-backed
// provider over public/reference-pack/ so the engine's pack lookups work
// where the gzipped fs layout cannot (the module's own fs loader degrades to
// null in the browser — build-chat-bundle stubs node:zlib as a thrower its
// try/catch absorbs).
import { registerReferencePackProvider } from "../../adapters/corpus/reference-pack.mjs";
// The LIVE Wikipedia seam (opt-in, default off): the page's toggle enables it
// per session, and e2e tests stub the provider the same way the pack's own
// provider is stubbed. The adapter is fetch-only, so it bundles as-is.
// registerResearchProvider is the research lane's sibling seam
// (simple.wikipedia.org) — same stubbing contract for its e2e tests.
import { registerLiveReferenceProvider, registerResearchProvider } from "../../adapters/corpus/wikipedia-live.mjs";
// Best-effort IndexedDB persistence for the page's session store — the page
// decides when to save/load/clear; this entry only carries the wrapper
// across the bundle boundary.
import { openPersistedStore } from "./idb-persist.mjs";

/**
 * A browser chat session over the real turn engine.
 *
 * `seedPayload` (optional) is a serialized memory graph (loadMemory's shape,
 * built by scripts/build-chat-seed.mjs) assigned onto a fresh Backend-B
 * handle. `vocabSeeded` tells the session's vocabulary hint whether that
 * payload carries the starter vocabulary, so an unseeded session offers the
 * teach pointer instead of an example it cannot answer.
 *
 * `digestStructures` (optional) is the page's build-time-embedded
 * [[structure]] rows from the digest sentence-structure bank (chat-page-viz.mjs's
 * DIGEST_STRUCTURES) — fed once to the bundle's live digest-bank twin so a
 * long "what is X" answer leads with a composed digest instead of always
 * falling back to the flat fact list (the bundle's stub used to return null
 * unconditionally). Harmless to call more than once per page load: the table
 * is module-scope, last write wins, and every session created after this one
 * shares it.
 *
 * Returns { memoryDir, sessionId, turn }. `turn(line)` resolves to
 * { answer, end, record, plan } and threads focus/last/planState between
 * calls exactly as the CLI session does.
 */
export function createChatSession({ seedPayload = null, vocabSeeded = false, liveReference = false, onLiveLookup = null, synthesisBudget = 12, digestStructures = null } = {}) {
  setDigestStructures(digestStructures || []);
  const memoryDir = createInMemoryStore();
  applySeedPayload(memoryDir, seedPayload);

  // A known-empty code graph: code-structure questions get the same honest
  // no-code-graph answer an un-pointed CLI session gives, never a crash.
  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded);
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  // Four-state, like the CLI: false (off), true (rescue on a miss),
  // "supplement" (also append a cited read-out under every grounded vocabulary
  // answer), or "always" (widen that to every grounded answer). The two string
  // modes stay strings so runTurn reads them as the supplement/always lanes.
  const normLive = (v) => (v === "always" ? "always" : v === "supplement" ? "supplement" : Boolean(v));
  let liveReferenceOn = normLive(liveReference);
  // The auto-synthesis budget for this session's learn-on-miss loads — the
  // page's slider sets it; 0 stores article facts without any entailed rows.
  let synthesisBudgetOn = Number.isFinite(synthesisBudget) ? synthesisBudget : 12;

  const session = createTurnSession({
    memoryDir, graph, lexicon, sessionId, vocabHint,
    buildExtraOptions: () => ({
      liveReference: liveReferenceOn, onLiveLookup,
      uiContext: "browser", synthesisBudget: synthesisBudgetOn,
    }),
    // `result.liveReference` mirrors a `/wiki on|off|supplement|always`
    // command back into this session's own toggle state.
    captureExtraState: (result) => {
      if (typeof result.liveReference === "boolean" || result.liveReference === "supplement" || result.liveReference === "always") liveReferenceOn = result.liveReference;
    },
  });

  return {
    memoryDir,
    sessionId,
    get liveReference() { return liveReferenceOn; },
    /** The page's toggle seam: set the live Wikipedia mode for every later turn
     *  (the `/wiki on|off|supplement|always` command sets the same state). */
    setLiveReference(v) { liveReferenceOn = normLive(v); },
    get synthesisBudget() { return synthesisBudgetOn; },
    /** The page's slider seam: set the auto-synthesis budget for every later
     *  learn-on-miss load. Clamped to a non-negative integer; 0 disables it. */
    setSynthesisBudget(n) { synthesisBudgetOn = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; },
    turn: session.turn,
  };
}

/**
 * Every fact a "research <topic>" run has stored so far, in storage order —
 * the exposure the "researched this session" panel needs and runTurn's
 * result doesn't otherwise carry (a research turn's own record reports a
 * per-topic FACT COUNT, research.mjs's own researchSnapshot, never the
 * triples themselves). Reads the same provenance tags memoryStats already
 * folds (readFactRows' `provenance`, the ' | '-joined compat string),
 * filtered to the `research:<topicKey>@<depth>` prefix research.mjs's own
 * `researchProvenanceTag` stamps every research-sourced fact with, rather
 * than a second ingest-path computation — so this can never list a fact
 * research didn't actually store.
 */
export async function researchedFactRows(memoryDir) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  return rows
    .filter((row) => String(row.provenance || "").split(" | ").some((tag) => tag.startsWith("research:")))
    .map((row) => ({ subject: row.subject, predicate: row.predicate, object: row.object }));
}

globalThis.tmctChat = { createChatSession, registerWinkModel, registerReferencePackProvider, registerLiveReferenceProvider, registerResearchProvider, normFactTerm, vocabExampleHint, memoryStats, openPersistedStore, exportFactsJsonl, researchedFactRows, splitSentences: splitSentencesPreservingPaths };
