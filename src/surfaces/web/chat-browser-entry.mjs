// chat-browser-entry.mjs — the esbuild entry for chat.html's embedded chat
// (built by scripts/build-chat-bundle.mjs).
//
// Unlike memory-ask-browser-entry.mjs (factAnswer/factReadBack only), this
// exposes the FULL turn engine: createChatSession wraps chat.mjs's runTurn
// with a session-shaped closure — the focus/last/planState threading
// src/services/chat-session.mjs's createSession.turn does, minus every
// filesystem side effect (no transcript log, no sidecar, no graph upsert).
// Memory is an in-memory Backend-B handle, optionally pre-loaded with a
// built seed payload (scripts/build-chat-seed.mjs), so teach turns, recall,
// proof chains and the honest miss all run client-side with zero I/O.
//
// Two browser traps this file owns so no caller can fall into them:
//   - runTurn defaults `env` to process.env, and a browser has no `process`
//     global — every turn here passes `env: {}` explicitly;
//   - the uuid adapter needs node:crypto — the session id comes from the
//     Web Crypto API instead, with a Date.now fallback for contexts
//     without it.
import { runTurn, vocabExampleHint } from "../../services/chat.mjs";
import { createInMemoryStore, normFactTerm, loadMemory, readFactRows } from "../../adapters/memory/core.mjs";
import { serializeFactsJsonl } from "../../adapters/memory/export-jsonl.mjs";
import { provenanceTagToSource } from "../../domain/memory/trust.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
// The reference-pack provider seam: the page registers a fetch-backed
// provider over public/reference-pack/ so the engine's pack lookups work
// where the gzipped fs layout cannot (the module's own fs loader degrades to
// null in the browser — build-chat-bundle stubs node:zlib as a thrower its
// try/catch absorbs).
import { registerReferencePackProvider } from "../../adapters/corpus/reference-pack.mjs";
// The LIVE Wikipedia seam (opt-in, default off): the page's toggle enables it
// per session, and e2e tests stub the provider the same way the pack's own
// provider is stubbed. The adapter is fetch-only, so it bundles as-is.
import { registerLiveReferenceProvider } from "../../adapters/corpus/wikipedia-live.mjs";
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
 * Returns { memoryDir, sessionId, turn }. `turn(line)` resolves to
 * { answer, end, record, plan } and threads focus/last/planState between
 * calls exactly as the CLI session does.
 */
export function createChatSession({ seedPayload = null, vocabSeeded = false, liveReference = false, onLiveLookup = null } = {}) {
  const memoryDir = createInMemoryStore();
  // Spread onto the store's own empty payload so a partial seed (individuals
  // and objectProperties only) still carries the classes/prefixes scaffolding
  // the write path recounts — teach turns must work on any seed.
  if (seedPayload) memoryDir.payload = { ...memoryDir.payload, ...seedPayload };

  // A known-empty code graph: code-structure questions get the same honest
  // no-code-graph answer an un-pointed CLI session gives, never a crash.
  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded);
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  let focus = null;
  let last = null;
  let planState = null;
  // Tri-state, like the TUI: false (off), true (rescue on a miss), or
  // "supplement" (also append a cited read-out under every grounded answer).
  const normLive = (v) => (v === "supplement" ? "supplement" : Boolean(v));
  let liveReferenceOn = normLive(liveReference);

  return {
    memoryDir,
    sessionId,
    get liveReference() { return liveReferenceOn; },
    /** The page's toggle seam: set the live Wikipedia mode for every later turn
     *  (the `/wiki on|off|supplement` command sets the same state). */
    setLiveReference(v) { liveReferenceOn = normLive(v); },

    /** One dispatched turn. A throwing runTurn must never kill the session —
     *  the page has no other chance to show this turn's answer. */
    async turn(line) {
      let result;
      try {
        result = await runTurn(line, {
          config: null, source: null, graph, focus, last, memoryDir, sessionId,
          env: {}, lexicon, vocabHint, planState,
          liveReference: liveReferenceOn, onLiveLookup,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { answer: `Something went wrong answering that (${message}). Try rephrasing, or /help.`, end: false, record: null, plan: null };
      }
      focus = result.focus;
      last = result.last;
      if ("planState" in result) planState = result.planState;
      if (typeof result.liveReference === "boolean" || result.liveReference === "supplement") liveReferenceOn = result.liveReference;
      return { answer: result.answer, end: Boolean(result.end), record: result.record ?? null, plan: result.plan ?? null };
    },
  };
}

/**
 * The memory a running session holds, broken down by where each fact came
 * from: the seed corpus bands it booted with (keyed by the SAME band name
 * build-chat-seed.mjs/extensions.mjs seed under — "human", "seon",
 * "conceptnet" today, whichever bands a future seed adds tomorrow) plus
 * whatever has been taught THIS session over chat. Reuses memory/trust.mjs's
 * own `provenanceTagToSource` against each fact's already-stored provenance
 * tag(s) (readFactRows' `provenance`, the ' | '-joined compat string) rather
 * than inventing a second provenance parse — the same tag chat.mjs's own
 * "(source: ...)" citation already carries, so this panel and a turn's
 * citation always agree on where a fact came from.
 *
 * Returns { total, bandCounts, taught }: `bandCounts` maps a band label to
 * its fact count ("taught this session" for a teach/operator-sourced fact
 * with no corpus band, "other" for anything provenance can't place);
 * `taught` lists every session-taught fact (subject/predicate/object + its
 * own provenance tag), most-recently-taught last — a stats panel's
 * provenance column reads straight off this, no further lookup needed.
 */
export async function memoryStats(memoryDir) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const bandCounts = {};
  const taught = [];
  for (const row of rows) {
    const tags = String(row.provenance || "").split(" | ").filter(Boolean);
    let band = null;
    let isTaught = false;
    let taughtTag = "";
    for (const tag of tags) {
      const src = provenanceTagToSource(tag);
      if (!src) continue;
      // corpusWeak (a /r/RelatedTo-strength triple, e.g. ConceptNet's or
      // SEON's own weaker associations) names the SAME band as corpus (a
      // /r/IsA-strength one) — both carry `src.name`, and a band count that
      // dropped the weak tier would undercount a corpus by exactly its
      // weak-relation facts (SEON: 19 of them, all `corpus-weak:seon`).
      if ((src.kind === "corpus" || src.kind === "corpusWeak") && src.name) band = src.name;
      if (src.kind === "teach" || src.kind === "operator") { isTaught = true; taughtTag = tag; }
    }
    const label = band || (isTaught ? "taught this session" : "other");
    bandCounts[label] = (bandCounts[label] || 0) + 1;
    if (isTaught) taught.push({ subject: row.subject, predicate: row.predicate, object: row.object, tag: taughtTag });
  }
  return { total: rows.length, bandCounts, taught };
}

/**
 * The session's whole triple store as JSONL — one
 * { subject, predicate, object, provenance } object per line, the same shape
 * `tmct extract` and `tmct memory --export` emit. Reads the live memory the
 * same way memoryStats does; the page offers it as a download.
 */
export async function exportFactsJsonl(memoryDir) {
  return serializeFactsJsonl(await loadMemory(memoryDir));
}

globalThis.tmctChat = { createChatSession, registerWinkModel, registerReferencePackProvider, registerLiveReferenceProvider, normFactTerm, vocabExampleHint, memoryStats, openPersistedStore, exportFactsJsonl };
