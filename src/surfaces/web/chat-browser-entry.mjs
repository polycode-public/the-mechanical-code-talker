// chat-browser-entry.mjs — the esbuild entry for the home page's embedded
// chat (public/chat-ui.mjs, built by scripts/build-chat-bundle.mjs).
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
import { createInMemoryStore, normFactTerm } from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
// The reference-pack provider seam: the page registers a fetch-backed
// provider over public/reference-pack/ so the engine's pack lookups work
// where the gzipped fs layout cannot (the module's own fs loader degrades to
// null in the browser — build-chat-bundle stubs node:zlib as a thrower its
// try/catch absorbs).
import { registerReferencePackProvider } from "../../adapters/corpus/reference-pack.mjs";

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
export function createChatSession({ seedPayload = null, vocabSeeded = false } = {}) {
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

  return {
    memoryDir,
    sessionId,

    /** One dispatched turn. A throwing runTurn must never kill the session —
     *  the page has no other chance to show this turn's answer. */
    async turn(line) {
      let result;
      try {
        result = await runTurn(line, {
          config: null, source: null, graph, focus, last, memoryDir, sessionId,
          env: {}, lexicon, vocabHint, planState,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { answer: `Something went wrong answering that (${message}). Try rephrasing, or /help.`, end: false, record: null, plan: null };
      }
      focus = result.focus;
      last = result.last;
      if ("planState" in result) planState = result.planState;
      return { answer: result.answer, end: Boolean(result.end), record: result.record ?? null, plan: result.plan ?? null };
    },
  };
}

globalThis.tmctChat = { createChatSession, registerWinkModel, registerReferencePackProvider, normFactTerm, vocabExampleHint };
