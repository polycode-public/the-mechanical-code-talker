// chat-browser-entry.mjs — the esbuild entry for chat.html's embedded chat
// (built by scripts/build-chat-bundle.mjs).
//
// Unlike memory-ask-browser-entry.mjs (factAnswer/factReadBack only), this
// exposes the FULL turn engine: createChatSession wraps the shared
// createTurnSession (turn-session.mjs) around chat.mjs's runTurn — the
// focus/last/planState/researchState/newsState threading src/services/chat-session.mjs's
// createSession.turn does, minus every filesystem side effect (no transcript
// log, no sidecar, no graph upsert). Memory is an in-memory Backend-B handle,
// optionally pre-loaded with a built seed payload (scripts/build-chat-seed.mjs),
// so teach turns, recall, proof chains and the honest miss all run
// client-side with zero I/O.
//
// The news lane's own state (newsState) rides turn-session.mjs's shared
// threading with no extra wiring here, the same way researchState already
// does. What IS this file's own job: a persistent newsConfig object (so a
// `/news add`/`/news interval` mutation survives turn to turn, the same
// reason liveReferenceOn/synthesisBudgetOn are held here rather than
// recreated per turn) and registerNewsProvider — the news lane's own
// provider-set stub seam, the same shape registerResearchProvider gives
// tests below. Neither building the default fetchers nor registering a stub
// set fires a fetch; a fetch only happens once the user's own turn actually
// runs `/news poll` or `/news enrich`.
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
import { createInMemoryStore, normFactTerm, loadMemory, readFactRows, applySeedPayload, wrapRowBackend, isRowHandle } from "../../adapters/memory/core.mjs";
import { createHttpRowBackend, withOneRetryOnUnavailable } from "./http-row-backend.mjs";
import { splitSentencesPreservingPaths } from "../../services/sentences.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { memoryFactGraphPayload } from "../../domain/memory-facts.mjs";
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
import { registerLiveReferenceProvider, registerResearchProvider, getResearchProvider } from "../../adapters/corpus/wikipedia-live.mjs";
// The news lane's own config resolver and contemporary-source registry —
// this session's default /news providers are built from the same fetcher
// factory news.html's own session uses (src/surfaces/web/news-browser-entry.mjs),
// just over the browser's own fetch rather than an injected test one.
import { resolveNewsConfig } from "../../services/news.mjs";
import { newsSourceRecords, normalizeNewsSourceIds, createNewsFetcher, preflightNewsUrl } from "../../adapters/corpus/news-sources.mjs";
// Best-effort IndexedDB persistence for the page's session store — the page
// decides when to save/load/clear; this entry only carries the wrapper
// across the bundle boundary.
import { openPersistedStore } from "./idb-persist.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { graphAsk, enginePlan } from "./engine-surface.mjs";

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
 * `awsSessionKey` (optional): the page's AWS-mode backend choice. Given, the
 * session's memory binds to `createHttpRowBackend({apiBase: "/", sessionKey:
 * awsSessionKey, fetchImpl})` wrapped with `seedPayload` as its read-only
 * seed overlay (§3.1's basePayload — the seed is never written back to the
 * service; only what a turn actually teaches lands as rows). Omitted (the
 * default), memory stays the plain in-memory store it always was, seeded the
 * same way. `fetchImpl` (optional) overrides the ambient `fetch` the row
 * backend calls through — a page never passes it; a test points it at a
 * running row-service double instead.
 *
 * Returns { memoryDir, sessionId, graph, codeGraph, refreshGraph, turn }.
 * `turn(line)` resolves to { answer, end, record, plan } and threads
 * focus/last/planState between calls exactly as the CLI session does.
 *
 * The two graphs are separate on purpose. `codeGraph` is the known-empty index
 * the turn engine reads, and `graph` is this session's memory store projected
 * for `ask()` — a question about taught facts has a real graph to traverse
 * while a code-structure question keeps its honest no-code-graph refusal.
 */
let registeredNewsProviders = null;

/** Swap chat.html's own `/news` providers set — `{ newsFetchers, getResearchProvider,
 *  preflightNewsUrl }`, the same stub seam registerResearchProvider gives tests
 *  above — so a test (or a future page control) can answer `/news` against a
 *  fixed set of sources instead of the real network. Pass null to restore the
 *  default: real fetchers, over the browser's own fetch, for every source the
 *  session's own newsConfig currently enables. Registering (or not) never
 *  fires a fetch by itself — only the user's own `/news poll`/`/news enrich`
 *  turn does. */
export function registerNewsProvider(providers) {
  registeredNewsProviders = providers && typeof providers === "object" ? providers : null;
}

/** The default `/news` providers for one session's current `newsConfig`:
 *  real fetchers for every enabled contemporary source (browser fetch, no
 *  request until a fetcher's own fetchItems() runs) and the same research
 *  provider `/wiki` and `research <topic>` already use for KB enrichment.
 *  Rebuilt only when the enabled source list has actually changed since the
 *  last call (`/news add` is the one turn that can change it), so an
 *  ordinary turn that never touches `/news` pays nothing repeated here. */
function newsProvidersFor(config) {
  let cachedProviders = null;
  let cachedKey = null;
  return () => {
    const key = normalizeNewsSourceIds(config.sources).join(",");
    if (cachedProviders && cachedKey === key) return cachedProviders;
    const newsFetchers = new Map();
    for (const id of normalizeNewsSourceIds(config.sources)) {
      const record = newsSourceRecords().find((r) => r.id === id);
      if (record) newsFetchers.set(id, createNewsFetcher(record, { fetchImpl: (...args) => globalThis.fetch(...args) }));
    }
    cachedProviders = {
      newsFetchers,
      getResearchProvider: ({ source } = {}) => getResearchProvider({ source }),
      preflightNewsUrl: (url) => preflightNewsUrl(url, { fetchImpl: (...args) => globalThis.fetch(...args) }),
    };
    cachedKey = key;
    return cachedProviders;
  };
}

export function createChatSession({
  seedPayload = null, vocabSeeded = false, liveReference = false, onLiveLookup = null,
  synthesisBudget = 12, digestStructures = null, awsSessionKey = null,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  setDigestStructures(digestStructures || []);
  // onOversizedRow: "drop" — a WRITE-side posture only (core.mjs's own
  // read-side base projection always keeps every seed row regardless, so the
  // seed itself is never lossy). A real corpus seed's own high-fan-out
  // property (mgx:statedBy: one edge per fact) is already over the row cap
  // before this session ever teaches anything; a session's own new fact adds
  // one more edge to that same, already-uncapped group, which can never fit
  // one wire row either way. Dropping that one write is the visitor's own
  // "turn is itself the last resort" case the option exists for: the fact
  // itself still writes and answers correctly (it is its own separate row),
  // only that property's cross-fact edge index stays exactly as unwritable
  // as the seed's own copy of it already was.
  const memoryDir = awsSessionKey
    ? wrapRowBackend(withOneRetryOnUnavailable(createHttpRowBackend({ apiBase: "/", sessionKey: awsSessionKey, fetchImpl })), { basePayload: seedPayload, onOversizedRow: "drop" })
    : createInMemoryStore();
  if (!awsSessionKey) applySeedPayload(memoryDir, seedPayload);

  // A known-empty code graph: code-structure questions get the same honest
  // no-code-graph answer an un-pointed CLI session gives, never a crash. The
  // turn engine keeps reading THIS one, so the identity-led greeting, the teach
  // pointer and the zero module counts a page earns from an empty index all
  // stay exactly as they were.
  const codeGraph = parseEntities({ individuals: [], objectProperties: [] });

  // What `tmct.ask()` traverses is a different graph: this session's own memory
  // store, projected through memoryFactGraphPayload. Rebuilt on demand rather
  // than once at open, because every teach, ingest and research turn grows the
  // store — the same reason spider-fly rebuilds its board before each turn.
  let memoryGraph = parseEntities({ individuals: [], objectProperties: [] });
  async function refreshGraph() {
    memoryGraph = parseEntities(memoryFactGraphPayload(readFactRows(await loadMemory(memoryDir))));
    return memoryGraph;
  }

  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded, "browser");
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
  // This session's own `/news` config — one persistent, mutable object (not
  // recreated per turn), so a `/news add`/`/news interval` mutation survives
  // turn to turn the same way it does in a CLI session's newsConfig.
  const newsConfig = resolveNewsConfig(null);
  const defaultNewsProviders = newsProvidersFor(newsConfig);

  const session = createTurnSession({
    memoryDir, graph: codeGraph, lexicon, sessionId, vocabHint,
    buildExtraOptions: () => ({
      liveReference: liveReferenceOn, onLiveLookup,
      synthesisBudget: synthesisBudgetOn,
      newsConfig,
      newsProviders: registeredNewsProviders ?? defaultNewsProviders(),
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
    get graph() { return memoryGraph; },
    codeGraph,
    refreshGraph,
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

/** The AWS-mode "forget everything"/"reset to seed" seam: marks every row
 *  and meta entry this session's row backend holds absent server-side. A
 *  no-op for a local (in-memory) session — there is nothing server-side to
 *  discard, so a page can call this unconditionally on its own memoryDir
 *  without first checking which mode it opened in. */
export async function discardAwsSession(memoryDir) {
  if (isRowHandle(memoryDir)) await memoryDir.impl.deleteAll();
}

// The page reaches the engine through the one shared surface: `tmct.open()`
// opens this session, `tmct.turn()` runs the dock, `tmct.ask()` puts a
// question to the session's own graph. What stays on `tmct.page` is what has
// no plain-English form — the vendor/provider seams the page registers before
// the first turn, its IndexedDB wrapper, and the two serializers its export
// and paste-ingest controls run.
publishTmctSurface({
  open: createChatSession,
  // The memory projection is rebuilt first, so a direct tmct.ask() sees every
  // fact taught, pasted or researched since the last one.
  ask: async (request, options, session) => {
    await session.refreshGraph();
    return graphAsk(request, options, session);
  },
  plan: enginePlan,
  page: {
    registerWinkModel, registerReferencePackProvider, registerLiveReferenceProvider,
    registerResearchProvider, registerNewsProvider, normFactTerm, vocabExampleHint, memoryStats,
    openPersistedStore, exportFactsJsonl, researchedFactRows, discardAwsSession,
    splitSentences: splitSentencesPreservingPaths,
  },
});
