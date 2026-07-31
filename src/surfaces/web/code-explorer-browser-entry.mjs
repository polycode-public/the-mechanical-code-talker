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
import { vocabExampleHint } from "../../services/chat.mjs";
import { createInMemoryStore, normFactTerm } from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";
import * as source from "../../adapters/source.mjs";
import { computeCodeExplorerData, computeCodeLedger, edgePhrase } from "../../services/code-explorer-viz.mjs";
import { generateCodeHints } from "../../domain/code-explorer-hints.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { graphAsk, enginePlan } from "./engine-surface.mjs";
import { tmct_ask } from "../../tools/handlers/tmct-ask.mjs";
import { RELATIONS } from "../../domain/ask-vocab.mjs";

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
 * Returns { memoryDir, sessionId, graph, turn }, the createChatSession shape the
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
  const vocabHint = vocabExampleHint(vocabSeeded, "browser");
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  // A stable virtual path: the provider answers every fetch, so no file is
  // ever read, but the code lanes still do path math (join/dirname) on it.
  const config = { graphFile: "graph.json" };

  const turnSession = createTurnSession({
    memoryDir, graph, lexicon, sessionId, vocabHint,
    // The code explorer is the one page whose turns run against a real
    // provider seam (source.mjs, registered above) and a virtual graph file
    // path, so both override createTurnSession's config:null/source:null
    // defaults on every call.
    buildExtraOptions: () => ({ config, source }),
  });

  return {
    memoryDir,
    sessionId,
    graph,
    turn: turnSession.turn,
  };
}

// ---- "what relates to X", asked ------------------------------------------

// A symbol-grain predicate asks as its coarse sibling: ask()'s relation
// vocabulary carries one question per grain pair, not two.
const COARSE_RELATION = { callsSymbol: "calls", touchesSymbol: "touches" };

/** The two questions ask() understands about one relation kind, both spelled
 *  from its own vocabulary: `verbs[0]` reads as the reverse direction ("what
 *  couples to X"), `bare` as the forward one ("what does X import"). A relation
 *  taught to ask-vocab is asked here with no second table to keep in step. */
function relationQuestions(kind, term) {
  const { bare, verbs } = RELATIONS[kind];
  return [
    { shape: "reverse", query: `what ${verbs[0]} ${term}` },
    { shape: "forward", query: `what does ${term} ${bare}` },
  ];
}

/** The kinds worth asking about: the ones this graph actually stores, folded
 *  onto ask()'s vocabulary keys. A graph carrying only imports asks two
 *  questions, not twenty. */
function askableRelationKinds(graph) {
  const kinds = new Set();
  for (const relation of graph.relations) {
    if (!relation.edges.length) continue;
    const kind = COARSE_RELATION[relation.predicate] || relation.predicate;
    if (Object.hasOwn(RELATIONS, kind)) kinds.add(kind);
  }
  return [...kinds];
}

/** Every stored edge as `<subjectId> <objectId>`, keyed by the coarse relation
 *  kind so both grains of a pair land in one set, beside a label-to-ids index.
 *  An answer names the individuals it found; these two decide whether the row
 *  built from that answer is an edge the graph actually holds. */
function indexEdges(graph) {
  const edgesByKind = new Map();
  for (const relation of graph.relations) {
    const kind = COARSE_RELATION[relation.predicate] || relation.predicate;
    let pairs = edgesByKind.get(kind);
    if (!pairs) edgesByKind.set(kind, (pairs = new Set()));
    for (const edge of relation.edges) pairs.add(`${edge.subject} ${edge.object}`);
  }
  const idsByLabel = new Map();
  for (const individual of graph.individuals) {
    if (!individual?.label || !individual.id) continue;
    const ids = idsByLabel.get(individual.label);
    if (ids) ids.push(individual.id);
    else idsByLabel.set(individual.label, [individual.id]);
  }
  return { edgesByKind, idsByLabel };
}

// parseEntities walks the whole payload, and a focus click re-asks the same
// graph, so one parse and one edge index per payload serve every question put
// to it.
const readGraphs = new WeakMap();
function readGraph(payload) {
  let read = readGraphs.get(payload);
  if (!read) {
    const graph = parseEntities(payload);
    read = { graph, ...indexEdges(graph) };
    readGraphs.set(payload, read);
  }
  return read;
}

const rowKey = (row) => JSON.stringify([row.s, row.kind, row.o]);

/**
 * "What relates to <term>", asked instead of computed. Every relation kind the
 * loaded graph carries becomes two real tmct_ask round trips over that graph —
 * the same ask() every chat turn on this page already reaches — and the
 * answers' typed `matches` become the explorer sidebar's rows. The page stops
 * deciding what relates to what, so the panel and the conversation cannot
 * scope or phrase one question two ways.
 *
 * Two things have to hold before an answer becomes a row. ask() must have
 * parsed the question as the question asked: an identifier that is itself a
 * relation verb makes it read "what tests run" as a question about testing, and
 * rows off that answer would describe the wrong term. And the row must be an
 * edge this graph holds between the term and what the answer named — ask()
 * resolves a term against the asked relation's own range, so "what contains
 * Task" legitimately answers about `Task.title`'s container, which is a true
 * sentence about a different pair than the one the sidebar is drawing. A row
 * the graph cannot confirm is dropped rather than shown; the engine's own prose
 * is where an inexact resolution belongs, because there it can say so.
 *
 * `grounded` is false when no question was understood as asked, which is the
 * caller's signal to fall back rather than show an empty neighbourhood for a
 * term the graph plainly has edges for.
 *
 * Returns { term, rows, asked, grounded }: `rows` in computeCodeLedger's own
 * row shape so one renderer draws both, `asked` every question put to the
 * engine beside what came back.
 */
export function askRelatedFacts(graphPayload, term) {
  const rows = [];
  const asked = [];
  let grounded = false;
  if (!graphPayload || !term) return { term: term || null, rows, asked, grounded };

  const { graph, edgesByKind, idsByLabel } = readGraph(graphPayload);
  // An edge group's objectLabel is denormalized and can be shorter than the
  // individual's own ("assignTo" for `Task.assignTo`), so the row list offers
  // clickable terms this graph holds no individual for. There is nothing to ask
  // about one, and saying so leaves the caller its row-list fallback instead of
  // an answered-and-empty neighbourhood.
  const termIds = idsByLabel.get(term) || [];
  if (!termIds.length) return { term, rows, asked, grounded };

  const seen = new Set();
  for (const kind of askableRelationKinds(graph)) {
    const storedEdges = edgesByKind.get(kind) || new Set();
    const holdsEdge = (subjectId, objectId) => storedEdges.has(`${subjectId} ${objectId}`);
    for (const { shape, query } of relationQuestions(kind, term)) {
      const envelope = tmct_ask({ query }, { graph }).data;
      const parsed = envelope?.parsed;
      const answeredAsAsked = parsed?.shape === shape
        && parsed?.kind === kind
        && parsed?.object === term
        && !envelope.ambiguous;
      if (!answeredAsAsked) {
        asked.push({ query, kind, shape, used: false, parsedAs: parsed?.canonical?.machine ?? null });
        continue;
      }
      grounded = true;
      const matches = Array.isArray(envelope.matches) ? envelope.matches : [];
      let confirmed = 0;
      for (const match of matches) {
        if (!match?.label || !match.id) continue;
        const aboutTerm = termIds.some((termId) => (shape === "reverse"
          ? holdsEdge(match.id, termId)
          : holdsEdge(termId, match.id)));
        if (!aboutTerm) continue;
        confirmed += 1;
        const row = shape === "reverse"
          ? { s: match.label, kind, phrase: edgePhrase(kind), o: term, sClass: match.type || "", oClass: "" }
          : { s: term, kind, phrase: edgePhrase(kind), o: match.label, sClass: "", oClass: match.type || "" };
        const key = rowKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
      asked.push({ query, kind, shape, used: true, miss: Boolean(envelope.miss), matched: matches.length, confirmed, traversal: envelope.traversal ?? null });
    }
  }
  return { term, rows, asked, grounded };
}

// This page holds a REAL code graph, so `tmct.ask` is the engine answering
// over it — the same round trip askRelatedFacts already makes twice per
// relation kind to build the sidebar's rows.
//
// `tmct.page` keeps the re-derivation helpers a graph swapped through the
// desktop picker re-renders with, plus the wink and term-normalizing seams the
// chat shares with the ledger page. `createCodeExplorerSession` sits there
// too: the page keeps its own session slot, created lazily on the first turn
// once the general-knowledge seed has landed, rather than the one `tmct.open`
// would install eagerly — so it calls the factory straight from the bag.
publishTmctSurface({
  open: createCodeExplorerSession,
  ask: graphAsk,
  plan: enginePlan,
  page: {
    createCodeExplorerSession,
    askRelatedFacts,
    computeCodeExplorerData,
    computeCodeLedger,
    generateCodeHints,
    parseEntities,
    normFactTerm,
    registerWinkModel,
  },
});
