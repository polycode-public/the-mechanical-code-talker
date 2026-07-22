// code-explorer-browser-entry.mjs — the esbuild entry for the code explorer's
// LIVE chat dock (public/code-explorer.bundle.js / electron/renderer/
// code-explorer.bundle.js). It mirrors ledger-browser-entry.mjs, but seeds the
// full runTurn engine from a CODE graph instead of a memory payload: the dock
// answers "what does X import" / "which functions call Y" over the loaded
// graph, the same compositional shapes the hint rail suggests.
//
// The graph enters through source.mjs's provider seam — the same seam the CLI
// and HTTP surfaces read — so runTurn's symbol-grain lanes see the whole
// payload, while parseEntities builds the coarse graph the flat lanes read.
// Gitignored, built fresh by scripts/build-code-explorer-bundle.mjs; the page
// degrades to a static view when it is absent (renderCodeExplorerHtml's own
// contract), so nothing here is ever published.
import { runTurn } from "../../services/chat.mjs";
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
 * dispatches every turn through the same runTurn the CLI runs. Teaches land in
 * an in-memory store so a taught fact never touches disk. Returns
 * { sessionId, turn }, the createChatSession shape the page's dock expects.
 */
export function createCodeExplorerSession({ graphPayload } = {}) {
  const payload = graphPayload || { individuals: [], objectProperties: [] };
  source.registerProvider(() => payload);

  const graph = parseEntities(payload);
  const memoryDir = createInMemoryStore();
  const lexicon = loadLexicon();
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  // A stable virtual path: the provider answers every fetch, so no file is
  // ever read, but the code lanes still do path math (join/dirname) on it.
  const config = { graphFile: "graph.json" };

  let focus = null;
  let last = null;
  let planState = null;

  return {
    sessionId,
    async turn(line) {
      let result;
      try {
        result = await runTurn(line, {
          config, source, graph, focus, last, memoryDir, sessionId,
          env: {}, lexicon, vocabHint: "", planState,
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
// the wink loader hook registerWinkModel and normFactTerm the dock shares with
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
