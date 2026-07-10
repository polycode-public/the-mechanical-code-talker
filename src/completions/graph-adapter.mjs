// completions/graph-adapter.mjs — HANDOVER.md item 1: the graphService-shaped adapter
// src/completions/search.mjs's broadSearch() was always built to accept — its own
// docblock names createGraphService(graph) (src/providers/graph-service.mjs) as the
// reference shape — but until now nothing in live chat ever constructed and passed one
// through (src/chat.mjs's completionsRescueAnswer called generateCompletion() with no
// `graphService` at all). Without it, broadSearch could only ever see memory BLOCKS
// saved via an explicit saveBlock() call — never the already-loaded code graph, and
// never a taught Fact — so "give me a detailed summary of how X works" declined for any
// subject on its first real mention in a session, no matter how much the graph or
// taught Facts actually knew about it.
//
// createCompletionsGraphAdapter(graph, memory) wraps TWO already-loaded stores (never
// re-loads either from disk — both are handed in by the caller, exactly as loaded for
// this turn):
//
//   - .search(q, {limit}) delegates straight to createGraphService(graph).search() —
//     the same ranked lexical module/symbol search every other Repository-Interface
//     consumer uses (src/codegraph.mjs's searchModulesRanked/scoreSymbolsRanked under
//     the hood). No new search machinery.
//
//   - .ask(q) does NOT delegate to createGraphService(graph).ask() (src/ask.mjs) —
//     that engine is a mechanical NATURAL-LANGUAGE QUESTION grammar ("which functions
//     call X", "what does X import"), and broadSearch always calls .ask() with the
//     bare SUBJECT TERM itself ("TaskController"), not a question. Tried live: that
//     produces an honest but useless "couldn't parse this as a graph question"
//     rephrase-hint every time — real text, but not about the subject, and it would
//     pollute the completion with noise. Instead .ask() here builds real sentences
//     from two sources that a bare term CAN resolve against directly:
//       1. resolveSymbol + renderDescribe (src/codegraph.mjs) — the SAME graph-only
//          renderer src/server.mjs's own tmct_describe tool uses: real facts (defining
//          module, contains, inherits, calls, tests, attributes, …), never invented.
//       2. readFactRows(memory) (src/memory/core.mjs) — any TAUGHT Fact whose subject
//          or object mentions the term. This is the one source the pipeline had NO
//          path to before at all: Stage 3 (inferRelations) only ever augments groups
//          that already exist from Stage 1's hits, so a subject with real taught Facts
//          but zero blocks/code-graph hits still surfaced nothing.
//     svc.ask() is still tried last, but its content is kept ONLY when it genuinely
//     parsed (tmct_ask.miss === false) — e.g. the rare case where the bare term happens
//     to also be a real registered question shape — never its own rephrase-hint noise.
//
// Every sentence this adapter returns traces to a real graph edge/attribute or a real
// taught Fact — never invented, matching src/completions/'s extractive-only discipline
// (see complete.mjs's own file header).

import { createGraphService } from "../providers/graph-service.mjs";
import { resolveSymbol, renderDescribe } from "../codegraph.mjs";
import { readFactRows } from "../memory/core.mjs";

/** renderDescribe() renders one LINE per fact (label header, each attribute, each edge
 *  group) with no terminal punctuation of its own — fine for its own "compact plain-text
 *  description for an agent consumer" purpose, but src/completions/rank.mjs's
 *  splitSentences() treats each line as its own candidate sentence, and complete.mjs
 *  joins kept sentences with a single space — so two adjacent kept lines without a
 *  period between them would otherwise read as one run-on clause. Ensuring every line
 *  ends in terminal punctuation here (never rewording/reordering the line itself) is
 *  the cheapest fix that stays entirely inside this adapter, touching neither
 *  renderDescribe() (server.mjs's tmct_describe tool relies on its current line shape)
 *  nor rank.mjs/complete.mjs's own join logic. */
function withTerminalPunctuation(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
    .join("\n");
}

/**
 * @param {object|null} graph   a parseEntities() result (src/codegraph.mjs), or null
 *   when no code graph is loaded — search()/the describe-half of ask() then honestly
 *   contribute nothing, rather than throwing.
 * @param {object|null} [memory=null]  a loadMemory() payload (src/memory/core.mjs), or
 *   null when there's no Fact store to search — the Fact-half of ask() then honestly
 *   contributes nothing.
 * @returns {{search: Function, ask: Function}} a Repository-Interface-shaped
 *   graphService satisfying src/completions/search.mjs's broadSearch() contract.
 */
export function createCompletionsGraphAdapter(graph, memory = null) {
  const svc = graph ? createGraphService(graph) : null;

  return {
    search(q, { limit } = {}) {
      if (!svc) return { ok: true, value: { results: [] } };
      return svc.search(q, { limit });
    },

    ask(q) {
      const term = String(q || "").trim();
      if (!term) return { ok: true, value: { content: "" } };
      const sentences = [];

      if (svc) {
        const { match, candidates } = resolveSymbol(graph, term);
        if (match) sentences.push(withTerminalPunctuation(renderDescribe(graph, match, { candidates })));
      }

      if (memory) {
        const needle = term.toLowerCase();
        for (const row of readFactRows(memory)) {
          if (!row.subject || !row.predicate || !row.object) continue;
          const haystack = `${row.subject} ${row.object}`.toLowerCase();
          if (!haystack.includes(needle)) continue;
          sentences.push(`${row.subject} ${row.predicate} ${row.object}.`.trim());
        }
      }

      if (svc) {
        const res = svc.ask(term);
        if (res?.ok && res.value?.tmct_ask?.miss === false && res.value.content) {
          sentences.push(res.value.content);
        }
      }

      if (!sentences.length) return { ok: true, value: { content: "" } };
      return { ok: true, value: { content: sentences.join(" ") } };
    },
  };
}
