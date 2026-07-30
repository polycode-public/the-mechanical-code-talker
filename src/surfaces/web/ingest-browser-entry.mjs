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
import { registerWinkModel, winkInstance } from "../../adapters/wink-model.mjs";
import { memoryStats, exportFactsJsonl } from "./memory-stats.mjs";
import { openPersistedStore } from "./idb-persist.mjs";

// The pronoun subjects a bounded carry substitutes with the last unique
// grounded subject in the SAME paragraph. Reset at every blank line, so a
// fresh paragraph never resolves against a stale antecedent.
const PRONOUN_LEAD_RE = /^(?:they|it|these|those|this)\b\s*/i;

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
 * Returns { memoryDir, sessionId, ingest }. `ingest(text, { onFact,
 * optimistic })` is the one call the page makes; it drives groundTextToFacts
 * against this session's store and returns its { sentences, recognized,
 * skipped, facts } summary.
 */
export function createIngestSession({ seedPayload = null, vocabSeeded = false } = {}) {
  const memoryDir = createInMemoryStore();
  applySeedPayload(memoryDir, seedPayload);

  const lexicon = loadLexicon();
  const vocabHint = vocabExampleHint(vocabSeeded);
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  return {
    memoryDir,
    sessionId,
    ingest(text, { onFact = null, optimistic = false } = {}) {
      return groundTextToFacts(text, { memoryDir, sessionId, lexicon, vocabHint, onFact, optimistic });
    },
  };
}

globalThis.tmctIngest = {
  createIngestSession, groundTextToFacts, exportFactsJsonl, registerWinkModel, normFactTerm,
  memoryStats, openPersistedStore,
};
