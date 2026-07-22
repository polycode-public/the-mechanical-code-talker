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
// Today the seam is the strict recognizer alone.
//
// Gitignored, Pages-demo-site-only output (scripts/build-demo-site.mjs builds
// it fresh on every deploy, never committed) — the same posture
// ledger-browser-entry.mjs documents for its own bundle. It carries the full
// runTurn engine, the same weight class as the chat/ledger bundles, and is
// never published.
import { runTurn, vocabExampleHint } from "../../services/chat.mjs";
import { createInMemoryStore, normFactTerm, loadMemory, readFactRows } from "../../adapters/memory/core.mjs";
import { serializeFactsJsonl } from "../../adapters/memory/export-jsonl.mjs";
import { splitSentencesPreservingPaths } from "../../services/sentences.mjs";
import { touchedFactRows } from "../../domain/memory/touched-facts.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";

/**
 * The single recognizer seam. Splits `text` into sentences (wink's own
 * boundary detection, never a regex), runs each through runTurn against
 * `memoryDir`, and keeps a sentence only when runTurn's own record calls it a
 * stored assertion (`record.via === "assert"`, `record.miss` false) that
 * actually touched a Fact row — the identical keep/skip rule
 * src/services/extract-facts.mjs's own runSentence holds.
 *
 * `onFact(fact)` (optional) is awaited after each grounded row so the page can
 * render the canonical facts LIVE as they land, one at a time.
 *
 * Returns { sentences, recognized, skipped, facts } — `facts` an array of
 * { subject, predicate, object, provenance, quantifier, sentence } in the same
 * canonical shape `tmct extract` and the JSONL exporter emit.
 *
 * A wider ingest tier plugs in HERE, behind this one function: the page calls
 * it and nothing else.
 */
export async function groundTextToFacts(text, { memoryDir, sessionId, graph, lexicon, vocabHint, onFact = null } = {}) {
  const sentences = splitSentencesPreservingPaths(text);
  const facts = [];
  let focus = null;
  let last = null;
  let planState = null;
  let recognized = 0;

  for (const sentence of sentences) {
    const before = readFactRows(await loadMemory(memoryDir));
    let record;
    try {
      const result = await runTurn(sentence, {
        config: null, source: null, graph, focus, last, memoryDir, sessionId,
        env: {}, lexicon, vocabHint, planState,
      });
      focus = result.focus;
      last = result.last;
      if ("planState" in result) planState = result.planState;
      record = result.record;
    } catch {
      continue; // a throwing sentence is a skip, never a page-killer
    }
    if (record?.via !== "assert" || record?.miss) continue;
    const rows = touchedFactRows(before, readFactRows(await loadMemory(memoryDir)));
    if (!rows.length) continue; // a Rule teach touches no Fact row — honest skip
    recognized += 1;
    for (const row of rows) {
      const fact = {
        subject: row.subject, predicate: row.predicate, object: row.object,
        provenance: row.provenance || "", quantifier: row.quantifier || "", sentence,
      };
      facts.push(fact);
      if (onFact) await onFact(fact);
    }
  }

  return { sentences: sentences.length, recognized, skipped: sentences.length - recognized, facts };
}

/**
 * A browser ingest session over the real turn engine — a fresh in-memory
 * Backend-B store, so facts grounded through the page extend one real graph
 * the page can then export. `seedPayload` (optional) pre-loads a graph the
 * recognizer can recall and link against.
 *
 * Returns { memoryDir, sessionId, ingest }. `ingest(text, { onFact })` is the
 * one call the page makes; it drives groundTextToFacts against this session's
 * store and returns its { sentences, recognized, skipped, facts } summary.
 */
export function createIngestSession({ seedPayload = null, vocabSeeded = false } = {}) {
  const memoryDir = createInMemoryStore();
  if (seedPayload) memoryDir.payload = { ...memoryDir.payload, ...seedPayload };

  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded);
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  return {
    memoryDir,
    sessionId,
    ingest(text, { onFact = null } = {}) {
      return groundTextToFacts(text, { memoryDir, sessionId, graph, lexicon, vocabHint, onFact });
    },
  };
}

/**
 * The session's whole triple store as JSONL — the same
 * { subject, predicate, object, provenance } shape `tmct extract` and
 * `tmct memory --export` emit, offered to the page as the canonical download.
 */
export async function exportFactsJsonl(memoryDir) {
  return serializeFactsJsonl(await loadMemory(memoryDir));
}

globalThis.tmctIngest = { createIngestSession, groundTextToFacts, exportFactsJsonl, registerWinkModel, normFactTerm };
