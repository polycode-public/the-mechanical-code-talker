// research-browser-entry.mjs — the esbuild entry for research.html's engine
// (public/research-browser.bundle.js, built by scripts/build-research-bundle.mjs).
//
// research.html is the graph-BUILDING page: one in-memory Backend-B store that
// grows three ways, all through the SAME real turn engine the other pages run,
// with zero filesystem I/O and no LLM —
//
//   1. research a term  — the "research <topic>" lane (src/services/research.mjs)
//      over Simple English Wikipedia, plus its "research next" queue. Stored
//      under research:<topic>@<depth> provenance.
//   2. teach by telling — an ordinary teach turn (runTurn's teach lane).
//      Stored under teach:chat:<chatSessionId>@<ts>.
//   3. ingest documents — the ingest recognizer (groundTextToFacts, reused
//      verbatim from ingest-browser-entry.mjs) run under a DISTINCT session id,
//      so its teach:chat:<ingestSessionId>@<ts> tags are told apart from a
//      typed teach turn by session id alone.
//
// The page then ASKS the graph scoped BY SOURCE: the caller passes the set of
// checked source keys and the ask runs against only the facts those sources
// asserted (or the whole store when every source is checked). The filtering
// lives HERE, in this bundle's own layer — a checked-source ask clones the
// payload and retracts the unchecked facts through the real removeFacts, then
// hands the pruned store to the SAME factAnswer/factReadBack the ledger dock
// runs. chat.mjs is never touched.
//
// Gitignored, Pages-demo-site-only output — scripts/build-demo-site.mjs builds
// it fresh on every deploy, never committed, the same posture the chat/ingest
// bundles document for their own output.
import { vocabExampleHint, factAnswer, factReadBack } from "../../services/chat.mjs";
import { clampResearchConfig } from "../../services/research.mjs";
import { createInMemoryStore, normFactTerm, loadMemory, readFactRows, removeFacts, applySeedPayload } from "../../adapters/memory/core.mjs";
import { provenanceTagToSource } from "../../domain/memory/trust.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import { registerReferencePackProvider } from "../../adapters/corpus/reference-pack.mjs";
import { registerLiveReferenceProvider, registerResearchProvider } from "../../adapters/corpus/wikipedia-live.mjs";
import { groundTextToFacts } from "./ingest-browser-entry.mjs";
import { openPersistedStore } from "./idb-persist.mjs";
import { digestTermFromPayloadBrowser } from "./digest-client.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { enginePlan } from "./engine-surface.mjs";
import { exportFactsJsonl } from "./memory-stats.mjs";

/**
 * The source key ONE provenance tag folds to, for the page's per-source
 * checkboxes/history. `sessionIds` tells a teach tag apart: a teach:chat tag
 * carrying the ingest session id is an ingested fact, anything else typed is
 * a taught one.
 *
 *   taught          — a typed teach turn, or an operator assert
 *   ingest          — the ingest recognizer, or its low-trust fuzzy tier
 *   research         — Simple English Wikipedia (research lane) or a live
 *                      /wiki lookup or a curated reference pack
 *   seed:<band>      — a seeded corpus band (corpus:<band>/corpus-weak:<band>)
 *
 * Returns null for a tag no Source parses (so a keyless/entailed fact is
 * never mis-bucketed), and "other" for a parsed-but-unplaced kind.
 */
export function sourceKeyForTag(tag, { chatSessionId = "", ingestSessionId = "" } = {}) {
  const src = provenanceTagToSource(tag);
  if (!src) return null;
  switch (src.kind) {
    case "teach":
      return ingestSessionId && src.sessionId === ingestSessionId ? "ingest" : "taught";
    case "operator":
      return "taught";
    case "optimisticExtract":
    case "extracted":
      return "ingest";
    case "referenceLive":
    case "reference":
      return "research";
    case "corpus":
    case "corpusWeak":
      return "seed:" + (src.name || "other");
    default:
      return "other";
  }
}

/** Every source key a fact's ' | '-joined provenance string maps to (deduped,
 *  in first-seen order); [] for a keyless/entailed fact. */
export function sourceKeysForProvenance(provenance, sessionIds) {
  const keys = [];
  for (const tag of String(provenance || "").split(" | ").filter(Boolean)) {
    const key = sourceKeyForTag(tag, sessionIds);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

const clonePayload = (payload) => {
  try { return structuredClone(payload); } catch { return JSON.parse(JSON.stringify(payload)); }
};

/** Fact rows plus the createdAt readFactRows keeps per assertion rather than per
 *  row — the "recently learned" panels want the timestamp, the ask filter wants
 *  the id, both want the provenance. A triple asserted by several sources was
 *  first learned when the EARLIEST of them said it, which is the moment those
 *  panels are ordering by. */
async function factRowsWithCreatedAt(memoryDir) {
  const memory = await loadMemory(memoryDir);
  return readFactRows(memory).map((row) => {
    const stamps = (row.assertions || []).map((a) => a.createdAt).filter(Boolean).sort();
    return { ...row, createdAt: stamps[0] || "" };
  });
}

const SOURCE_ORDER = ["taught", "ingest", "research"];
// The session-grown sources — a "recently learned" row belongs to what this
// visit added, never the seed it booted with.
const SESSION_SOURCE = new Set(["taught", "ingest", "research"]);

/**
 * A structured snapshot of everything the page's three panels render, computed
 * once per refresh so they can never disagree:
 *
 *   sources   — one entry per source present, its key/band and fact count, the
 *               three growth sources first (fixed order) then seed bands
 *               alphabetically. The checkbox list reads straight off this.
 *   recent    — the session-grown facts, newest first (createdAt desc), capped;
 *               each carries its subject/predicate/object, its source key and
 *               its createdAt, so the highlights panel needs no second lookup.
 *   hubs      — the best-connected terms, degree-ranked (a term's degree is how
 *               many distinct facts name it as subject or object), capped —
 *               the same degree count ledger-viz.mjs's own term map builds.
 *   history   — per-source-key arrays of the facts that source added, newest
 *               first, so each source can show what it contributed and when.
 *   total     — the whole store's fact count.
 */
export async function researchSnapshot(memoryDir, sessionIds = {}, { recentCap = 14, hubCap = 12, historyCap = 40 } = {}) {
  const rows = await factRowsWithCreatedAt(memoryDir);
  const counts = new Map();       // sourceKey -> count
  const history = new Map();      // sourceKey -> rows[]
  const degree = new Map();       // term -> distinct-fact degree
  const recent = [];
  for (const row of rows) {
    const keys = sourceKeysForProvenance(row.provenance, sessionIds);
    const primary = keys.find((k) => SESSION_SOURCE.has(k)) || keys[0] || "other";
    for (const key of keys.length ? keys : ["other"]) {
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!history.has(key)) history.set(key, []);
      history.get(key).push({
        subject: row.subject, predicate: row.predicate, object: row.object,
        provenance: row.provenance, createdAt: row.createdAt, source: key,
      });
    }
    for (const term of [row.subject, row.object]) {
      if (term) degree.set(term, (degree.get(term) || 0) + 1);
    }
    if (SESSION_SOURCE.has(primary)) {
      recent.push({
        subject: row.subject, predicate: row.predicate, object: row.object,
        source: primary, createdAt: row.createdAt,
      });
    }
  }

  // Codepoint order, never localeCompare — two readers holding the same fact
  // store must render its rows in the same order regardless of OS locale.
  const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const byCreatedDesc = (a, b) => byCodepoint(String(b.createdAt || ""), String(a.createdAt || ""));
  recent.sort(byCreatedDesc);

  const seedKeys = [...counts.keys()].filter((k) => k.startsWith("seed:")).sort();
  const otherKeys = counts.has("other") ? ["other"] : [];
  const orderedKeys = [...SOURCE_ORDER.filter((k) => counts.has(k)), ...seedKeys, ...otherKeys];
  const sources = orderedKeys.map((key) => ({
    key,
    band: key.startsWith("seed:") ? key.slice("seed:".length) : "",
    count: counts.get(key) || 0,
  }));

  const historyOut = {};
  for (const [key, list] of history) historyOut[key] = list.slice().sort(byCreatedDesc).slice(0, historyCap);

  const hubs = [...degree.entries()]
    .map(([term, deg]) => ({ term, degree: deg }))
    .sort((a, b) => b.degree - a.degree || byCodepoint(a.term, b.term))
    .slice(0, hubCap);

  return {
    total: rows.length,
    sources,
    recent: recent.slice(0, recentCap),
    hubs,
    history: historyOut,
  };
}

/**
 * The graph-building session over the real turn engine.
 *
 * `turn(line)` runs the chat engine (research + teach + ask), threading
 * focus/last/planState/researchState the CLI session does, under
 * `chatSessionId`. `ingest(text, opts)` runs the ingest recognizer under
 * `ingestSessionId` against the SAME store. `ask(query, { sources })` answers
 * scoped to the checked source keys.
 *
 * Returns the store plus both session ids so the page can classify provenance.
 */
export function createResearchSession({ seedPayload = null, vocabSeeded = false, liveReference = false, onLiveLookup = null, synthesisBudget = 12, digestStructures = null } = {}) {
  const memoryDir = createInMemoryStore();
  applySeedPayload(memoryDir, seedPayload);

  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded, "browser");
  // A DISTINCT id so an ingested fact's teach tag is told apart from a typed
  // teach turn's by session id alone — the whole reason the two growth paths
  // stay separable in the source panel.
  const ingestSessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now() + 1);

  const normLive = (v) => (v === "always" ? "always" : v === "supplement" ? "supplement" : Boolean(v));
  let liveReferenceOn = normLive(liveReference);
  let synthesisBudgetOn = Number.isFinite(synthesisBudget) ? synthesisBudget : 12;
  // The two research node knobs the page exposes ("maximum response nodes",
  // "maximum node depth"), clamped to the engineered ranges. A change applies
  // to the NEXT run started; a run already going keeps the knobs it captured
  // (they ride its persisted state), so its queue stays internally consistent.
  let researchConfig = clampResearchConfig();

  // The chat-engine turn (research/teach/ask), threading focus/last/planState/
  // researchState across calls the way every browser chat dock does. A throw
  // never kills the session — the page has no other chance to show this
  // turn's answer.
  const turnSession = createTurnSession({
    memoryDir, graph, lexicon, vocabHint,
    sessionId: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
    buildExtraOptions: () => ({
      researchConfig, liveReference: liveReferenceOn, onLiveLookup,
      synthesisBudget: synthesisBudgetOn,
    }),
    captureExtraState: (result) => {
      if (typeof result.liveReference === "boolean" || result.liveReference === "supplement" || result.liveReference === "always") {
        liveReferenceOn = result.liveReference;
      }
    },
  });
  const chatSessionId = turnSession.sessionId;
  const sessionIds = { chatSessionId, ingestSessionId };

  return {
    memoryDir,
    graph,
    chatSessionId,
    ingestSessionId,
    sessionIds,
    get liveReference() { return liveReferenceOn; },
    setLiveReference(v) { liveReferenceOn = normLive(v); },
    get synthesisBudget() { return synthesisBudgetOn; },
    setSynthesisBudget(n) { synthesisBudgetOn = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; },
    get researchConfig() { return { ...researchConfig }; },
    /** Update the node knobs for the NEXT run. `partial` is any of
     *  { maxTopics, maxDepth, fanoutLimit, minIntervalMs }; each is clamped and
     *  unset keys keep their current value. */
    setResearchConfig(partial) { researchConfig = clampResearchConfig({ ...researchConfig, ...(partial || {}) }); },

    turn: (line) => turnSession.turn(line),

    /** Ingest a document into the SAME store, under the ingest session id so
     *  its facts carry the "ingest" source rather than "taught". */
    ingest(text, { onFact = null, optimistic = false } = {}) {
      return groundTextToFacts(text, { memoryDir, sessionId: ingestSessionId, lexicon, vocabHint, onFact, optimistic });
    },

    /**
     * Ask the graph, scoped to the checked source keys. `sources` is the array
     * of keys to keep (e.g. ["taught", "seed:conceptnet"]); pass null, or a set
     * that already covers every source present, to ask the whole store.
     *
     * A scoped ask clones the payload and retracts every fact whose sources are
     * all unchecked through the real removeFacts (keyless/entailed facts are
     * kept — they rest on premises, not a single source), then runs the SAME
     * factAnswer ?? factReadBack cascade the ledger dock runs. Returns
     * { text, miss } — miss:true is the honest no-answer, never a guess.
     */
    async ask(query, { sources = null } = {}) {
      let dir = memoryDir;
      if (Array.isArray(sources)) {
        const checked = new Set(sources);
        const rows = await factRowsWithCreatedAt(memoryDir);
        const present = new Set();
        for (const row of rows) for (const k of sourceKeysForProvenance(row.provenance, sessionIds)) present.add(k);
        const everythingChecked = [...present].every((k) => checked.has(k));
        if (!everythingChecked) {
          dir = createInMemoryStore();
          dir.payload = clonePayload(memoryDir.payload);
          const cloneRows = readFactRows(await loadMemory(dir));
          const remove = [];
          for (const row of cloneRows) {
            const keys = sourceKeysForProvenance(row.provenance, sessionIds);
            if (keys.length && !keys.some((k) => checked.has(k))) remove.push(row.id);
          }
          if (remove.length) await removeFacts(dir, remove);
        }
      }
      let ans = null;
      try { ans = await factAnswer(dir, query, null, true); } catch { ans = null; }
      if (!(ans && ans.text)) {
        try { ans = await factReadBack(dir, query, null, true, null); } catch { ans = null; }
      }
      return ans && ans.text ? { text: ans.text, miss: false } : { text: "", miss: true };
    },

    /**
     * A deterministic digest of one term over the live in-browser store, run
     * client-side through the pure digest layer from the structure table
     * embedded in the page (no filesystem, no LLM). Returns the render-ready
     * view { term, paragraphs, sources, facts, factCount } — the narrative
     * leads, the sources ride through, the full fact list stays behind the
     * "show the facts" escape — or null when the term holds no facts, no
     * structures were embedded, or the selector kept nothing renderable.
     */
    async digest(term, { budget = 10 } = {}) {
      const t = normFactTerm(term);
      if (!t) return null;
      let payload;
      try { payload = await loadMemory(memoryDir); } catch { return null; }
      try { return digestTermFromPayloadBrowser(payload, t, digestStructures, { budget }); }
      catch { return null; }
    },
  };
}

// This page's ask is already source-scoped: `tmct.ask(q, { sources })` keeps
// the checked source keys and runs the same factAnswer/factReadBack cascade
// the ledger dock runs, so a visitor can see the answer change as they tick
// sources off. `tmct.page` keeps the provider and wink seams the page
// registers, the run snapshot its timeline reads, its persisted store and its
// JSONL export.
publishTmctSurface({
  open: createResearchSession,
  ask: async (request, options, session) => {
    const { text, miss } = await session.ask(request, options);
    return { answer: text, data: null, miss };
  },
  plan: enginePlan,
  page: {
    researchSnapshot, exportFactsJsonl,
    registerWinkModel, registerReferencePackProvider, registerLiveReferenceProvider, registerResearchProvider,
    normFactTerm, vocabExampleHint, openPersistedStore,
  },
});
