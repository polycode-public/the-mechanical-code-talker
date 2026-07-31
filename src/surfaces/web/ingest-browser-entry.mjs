// ingest-browser-entry.mjs — the esbuild entry for the ingest page's engine
// (public/ingest-browser.bundle.js, built by scripts/build-ingest-bundle.mjs),
// mirroring ledger-browser-entry.mjs's own createLedgerSession shape.
//
// The ingest page turns plain pasted/dropped text into stored facts by
// running each sentence through the SAME deterministic recognizer the chat
// teach lane already has (runTurn, src/services/chat.mjs) — no new NLU, no
// LLM, no guessing, exactly as the `tmct extract` CLI does it
// (src/services/extract-facts.mjs). A sentence the recognizer turns into a
// stored assertion is kept; every other sentence is honestly skipped.
//
// The recognizer is reached through ONE seam — `groundTextToFacts` — so a
// wider ingest tier (an optimistic fuzzy-match pass, a canonical/graph-linked
// output) slots in behind this single function without the page changing.
// Alongside the strict recognizer, groundTextToFacts runs the same
// citation-stripping, clause-fallback and bounded pronoun-carry passes
// `ingestText` (extract-facts.mjs) applies for the CLI, and — opt-in, off by
// default — the same low-trust optimistic tier, so the browser page and the
// CLI ground the identical class of sentence.
//
// Gitignored, Pages-demo-site-only output (scripts/build-demo-site.mjs builds
// it fresh on every deploy, never committed) — the same posture
// ledger-browser-entry.mjs documents for its own bundle. It carries the full
// runTurn engine, the same weight class as the chat/ledger bundles, and is
// never published.
import { runTurn, vocabExampleHint } from "../../services/chat.mjs";
import { createInMemoryStore, normFactTerm, loadMemory, readFactRows, appendFact, applySeedPayload } from "../../adapters/memory/core.mjs";
import { splitSentencesPreservingPaths, stripCitationResidue } from "../../services/sentences.mjs";
import { clauseCandidates, optimisticTriples } from "../../services/extract-facts.mjs";
import { touchedFactRows } from "../../domain/memory/touched-facts.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { ingestFactGraphPayload, ingestedFactRows } from "../../domain/ingest-facts.mjs";
import { registerWinkModel, winkInstance } from "../../adapters/wink-model.mjs";
import { memoryStats, exportFactsJsonl } from "./memory-stats.mjs";
import { openPersistedStore } from "./idb-persist.mjs";
import { createTurnSession } from "./turn-session.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";
import { graphAsk, enginePlan } from "./engine-surface.mjs";

// The pronoun subjects a bounded carry substitutes with the last unique
// grounded subject in the SAME paragraph. Reset at every blank line, so a
// fresh paragraph never resolves against a stale antecedent.
const PRONOUN_LEAD_RE = /^(?:they|it|these|those|this)\b\s*/i;

// The turn kinds that move the fact store, so the projected graph a later
// question traverses has to be rebuilt before it answers.
const STORE_WRITING_TURNS = new Set(["assert", "retract"]);

/**
 * The single recognizer seam. Splits `text` into paragraphs (blank-line
 * separated, so the pronoun carry never bridges a topic break) and each
 * paragraph into sentences (wink's own boundary detection, never a regex).
 * Each sentence's citation residue ("[3]", "[citation needed]") is stripped
 * before grounding; the strict recognizer then tries the whole sentence
 * first, falling back to its clause fragments only on a miss
 * (`clauseCandidates`), and — still on a miss, only for a pronoun-led
 * sentence with a unique adjacent antecedent in this paragraph — one retry
 * with that antecedent substituted in.
 *
 * A sentence still ungrounded after all of that runs the optimistic fuzzy
 * tier when `optimistic` is set (`optimisticTriples`): a copula or known
 * relation verb flanked by two resolvable entities, stored under the
 * low-trust `optimistic-extract:page` tag rather than a teach/assert
 * provenance, so a fuzzy candidate can never corroborate a curated fact.
 *
 * `onFact(fact)` (optional) is awaited after each grounded row so the page can
 * render the canonical facts LIVE as they land, one at a time.
 *
 * Returns { sentences, recognized, skipped, facts } — `facts` an array of
 * { subject, predicate, object, provenance, quantifier, sentence } in the same
 * canonical shape `tmct extract` and the JSONL exporter emit.
 */
export async function groundTextToFacts(text, { memoryDir, sessionId, lexicon, vocabHint, optimistic = false, onFact = null } = {}) {
  const paragraphs = String(text ?? "").split(/\n[ \t]*\n/);
  const facts = [];
  let focus = null;
  let last = null;
  let planState = null;
  let sentenceCount = 0;
  let recognized = 0;
  // Reused, not reloaded: readFactRows(loadMemory(...)) is O(rows), so a
  // fresh read on every sentence over a large seeded store is exactly the
  // O(sentences × rows) cost this page must avoid. The snapshot only moves
  // forward past a sentence that actually asserted something.
  let beforeRows = readFactRows(await loadMemory(memoryDir));
  const nlp = optimistic ? winkInstance() : null;

  // One grounding attempt against `memoryDir`: runs `form` through runTurn,
  // threading focus/last/planState the same way whether or not it grounds.
  // No `graph` is passed — this page never offers a code graph to link
  // against, and a non-null one (even an empty one) makes runTurn read an
  // ordinary "the number of X" phrase as a graph count query instead of
  // running the teach cascade, exactly the phrasing the Sales-paragraph
  // sentence this pipeline is built to ground uses.
  // Returns the Fact rows this attempt actually touched, or null — a miss, a
  // non-assert turn, or an assert that touched no Fact row (a Rule teach).
  async function attempt(form) {
    let record;
    try {
      const result = await runTurn(form, {
        config: null, source: null, focus, last, memoryDir, sessionId,
        env: {}, lexicon, vocabHint, planState, uiContext: "browser",
      });
      focus = result.focus;
      last = result.last;
      if ("planState" in result) planState = result.planState;
      record = result.record;
    } catch {
      return null; // a throwing sentence is a skip, never a page-killer
    }
    if (record?.via !== "assert" || record?.miss) return null;
    // The one loadMemory/readFactRows call this attempt pays for, only
    // because it actually asserted something. Equal lengths mean nothing was
    // ADDED — a re-assertion's provenance-only change is the one case this
    // fast path can't see, an accepted trade against paying the full
    // before/after diff on every recognized sentence in a large store.
    const afterRows = readFactRows(await loadMemory(memoryDir));
    const rows = afterRows.length === beforeRows.length ? [] : touchedFactRows(beforeRows, afterRows);
    beforeRows = afterRows;
    return rows.length ? rows : null;
  }

  for (const paragraph of paragraphs) {
    // The last unique grounded subject in THIS paragraph, carried onto a
    // later pronoun-led sentence the strict recognizer couldn't ground on its
    // own. Cleared at the paragraph boundary.
    let carrySubject = null;
    for (const rawSentence of splitSentencesPreservingPaths(paragraph)) {
      sentenceCount += 1;
      const cleaned = stripCitationResidue(rawSentence);

      let rows = null;
      for (const candidate of clauseCandidates(cleaned, { nlp })) {
        rows = await attempt(candidate);
        if (rows) break;
      }
      if (!rows && carrySubject && PRONOUN_LEAD_RE.test(cleaned)) {
        rows = await attempt(cleaned.replace(PRONOUN_LEAD_RE, `${carrySubject} `));
      }

      if (rows) {
        recognized += 1;
        const subjects = new Set(rows.map((r) => r.subject));
        if (subjects.size === 1) carrySubject = [...subjects][0];
        for (const row of rows) {
          const fact = {
            subject: row.subject, predicate: row.predicate, object: row.object,
            provenance: row.provenance || "", quantifier: row.quantifier || "", sentence: rawSentence,
          };
          facts.push(fact);
          if (onFact) await onFact(fact);
        }
        continue;
      }

      if (!optimistic) continue;
      const candidates = optimisticTriples(cleaned, { lexicon, nlp });
      if (!candidates.length) continue;
      recognized += 1;
      for (const t of candidates) {
        await appendFact(memoryDir, { subject: t.subject, predicate: t.predicate, object: t.object, provenance: "optimistic-extract:page" });
        const fact = {
          subject: t.subject, predicate: t.predicate, object: t.object,
          provenance: "optimistic-extract:page", quantifier: "", sentence: rawSentence,
        };
        facts.push(fact);
        if (onFact) await onFact(fact);
      }
    }
  }

  return { sentences: sentenceCount, recognized, skipped: sentenceCount - recognized, facts };
}

/**
 * A browser ingest session over the real turn engine — a fresh in-memory
 * Backend-B store, so facts grounded through the page extend one real graph
 * the page can then export. `seedPayload` (optional) pre-loads a graph the
 * recognizer can recall and link against.
 *
 * Returns { memoryDir, sessionId, graph, refreshGraph, askableClasses, ingest,
 * turn }. `ingest(text, { onFact, optimistic })` is the call the ingest panes
 * make; it drives groundTextToFacts against this session's store and returns
 * its { sentences, recognized, skipped, facts } summary. `turn(line)` is the
 * ask dock's own entry point — the FULL chat turn engine (the exact dispatch
 * the CLI runs) over the same store, so a question it can't ground gets the
 * same refusal the CLI gives.
 *
 * `graph` is what a question actually traverses: the ingested rows projected
 * through ingest-facts.mjs, rebuilt by `refreshGraph()` whenever the store has
 * moved since the last one. The rebuild is gated on a dirty flag rather than
 * run per call because a seeded store holds tens of thousands of rows, and
 * re-reading all of them to answer a second question about the same two
 * sentences is the one cost this page has to avoid.
 */
export function createIngestSession({ seedPayload = null, vocabSeeded = false } = {}) {
  const memoryDir = createInMemoryStore();
  applySeedPayload(memoryDir, seedPayload);

  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded);
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  let graph = parseEntities({ individuals: [], objectProperties: [] });
  let storeMovedSinceGraph = true;
  async function refreshGraph() {
    if (!storeMovedSinceGraph) return graph;
    const rows = ingestedFactRows(readFactRows(await loadMemory(memoryDir)));
    graph = parseEntities(ingestFactGraphPayload(rows));
    storeMovedSinceGraph = false;
    return graph;
  }

  // An empty graph is not the same as no graph to runTurn: a non-null one
  // makes it read an ordinary "the number of X" phrase as a graph count query
  // instead of running the teach cascade, so before anything is ingested the
  // dock keeps the plain conversational reading.
  const graphForTurn = () => (graph.individuals.length ? graph : null);

  const turnSession = createTurnSession({
    memoryDir, lexicon, sessionId, vocabHint,
    buildExtraOptions: () => ({ graph: graphForTurn(), uiContext: "browser" }),
    captureExtraState: (result) => {
      if (STORE_WRITING_TURNS.has(result?.record?.via) && !result.record.miss) storeMovedSinceGraph = true;
    },
  });

  return {
    memoryDir,
    sessionId,
    get graph() { return graph; },
    refreshGraph,
    /** The class nouns this graph can actually list, for a page building its
     *  own "try asking" hint out of real data rather than invented examples. */
    askableClasses() {
      return [...new Set(graph.individuals.map((i) => i.class).filter(Boolean))].sort();
    },
    async ingest(text, { onFact = null, optimistic = false } = {}) {
      const summary = await groundTextToFacts(text, { memoryDir, sessionId, lexicon, vocabHint, onFact, optimistic });
      if (summary.recognized) storeMovedSinceGraph = true;
      return summary;
    },
    async turn(line) {
      await refreshGraph();
      return turnSession.turn(line);
    },
  };
}

// The page's own two calls are `tmct.session.ingest(text)` and, from the ask
// dock, `tmct.turn(line)`. `tmct.ask` puts one question straight to the graph
// this session projects from what it has ingested, rebuilding it first so a
// fact grounded a moment ago is already visible. `tmct.page` keeps the
// recognizer entry point the page also drives directly, the wink seam, the
// stats fold behind its counters, its IndexedDB wrapper and its JSONL export.
publishTmctSurface({
  open: createIngestSession,
  ask: async (request, options, session) => {
    await session.refreshGraph();
    return graphAsk(request, options, session);
  },
  plan: enginePlan,
  page: {
    groundTextToFacts, exportFactsJsonl, registerWinkModel, normFactTerm,
    memoryStats, openPersistedStore,
  },
});
