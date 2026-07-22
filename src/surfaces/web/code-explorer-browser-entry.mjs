// code-explorer-browser-entry.mjs — the esbuild entry for the code explorer's
// LIVE chat (public/code-explorer.bundle.js / electron/renderer/
// code-explorer.bundle.js). It mirrors ledger-browser-entry.mjs, but seeds the
// full runTurn engine from a CODE graph — and, when the page hands one over,
// the same general-knowledge seed payload chat.html boots from — so one
// session answers "which functions call Y" over the loaded graph and "what is
// a queue" over the seeded memory.
//
// The graph enters through source.mjs's provider seam — the same seam the CLI
// and HTTP surfaces read — so runTurn's symbol-grain lanes see the whole
// payload, while parseEntities builds the coarse graph the flat lanes read.
// The seed enters the in-memory store the same way createChatSession's does.
// Gitignored, built fresh by scripts/build-code-explorer-bundle.mjs; the page
// degrades to a static view when it is absent (renderCodeExplorerHtml's own
// contract), so nothing here is ever published.
import { runTurn, vocabExampleHint } from "../../services/chat.mjs";
import { createInMemoryStore, normFactTerm } from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import * as source from "../../adapters/source.mjs";
import { computeCodeExplorerData, computeCodeLedger } from "../../services/code-explorer-viz.mjs";
import { generateCodeHints } from "../../domain/code-explorer-hints.mjs";

/**
 * A browser code-explorer session over the real turn engine. Registers the
 * loaded payload with source.mjs's provider seam, parses the coarse graph, and
 * dispatches every turn through the same runTurn the CLI runs.
 *
 * `seedPayload` (optional) is a serialized memory graph (loadMemory's shape,
 * built by scripts/build-chat-seed.mjs) assigned onto the session's fresh
 * in-memory store, so general-knowledge questions ground alongside the code
 * graph's own lanes. `vocabSeeded` tells the vocabulary hint whether that
 * payload carries the starter vocabulary. Teaches land in the same in-memory
 * store, so a taught fact never touches disk.
 *
 * Returns { memoryDir, sessionId, turn }, the createChatSession shape the
 * page's chat expects.
 */
export function createCodeExplorerSession({ graphPayload, seedPayload = null, vocabSeeded = false } = {}) {
  const payload = graphPayload || { individuals: [], objectProperties: [] };
  source.registerProvider(() => payload);

  const graph = parseEntities(payload);
  const memoryDir = createInMemoryStore();
  // Spread onto the store's own empty payload so a partial seed (individuals
  // and objectProperties only) still carries the classes/prefixes scaffolding
  // the write path recounts — teach turns must work on any seed.
  if (seedPayload) memoryDir.payload = { ...memoryDir.payload, ...seedPayload };
  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded);
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  // A stable virtual path: the provider answers every fetch, so no file is
  // ever read, but the code lanes still do path math (join/dirname) on it.
  const config = { graphFile: "graph.json" };

  let focus = null;
  let last = null;
  let planState = null;

  return {
    memoryDir,
    sessionId,
    async turn(line) {
      let result;
      try {
        result = await runTurn(line, {
          config, source, graph, focus, last, memoryDir, sessionId,
          env: {}, lexicon, vocabHint, planState,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { answer: `Something went wrong answering that (${message}). Try rephrasing, or /help.`, end: false, record: null };
      }
      focus = result.focus;
      last = result.last;
      if ("planState" in result) planState = result.planState;
      return { answer: result.answer, end: Boolean(result.end), record: result.record ?? null };
    },
  };
}

// Exposed for the page's inline client: the re-derivation helpers so a graph
// swapped through the desktop picker re-renders without duplicating logic, plus
// the wink loader hook registerWinkModel and normFactTerm the chat shares with
// the ledger page.
globalThis.tmctCodeExplorer = {
  createCodeExplorerSession,
  computeCodeExplorerData,
  computeCodeLedger,
  generateCodeHints,
  parseEntities,
  normFactTerm,
  registerWinkModel,
};
