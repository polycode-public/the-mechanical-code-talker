// completions/graph-adapter.mjs — a graphService-shaped adapter for broadSearch(), wrapping
// two already-loaded stores (graph, memory) without re-loading either from disk.
//
// .ask(q) does not delegate to createGraphService(graph).ask(): that expects a natural-
// language question, but broadSearch calls .ask() with a bare term, which would only produce
// a "couldn't parse" rephrase-hint. Instead it builds sentences from resolveSymbol/
// renderDescribe and readFactRows(memory), falling back to svc.ask() only when it genuinely
// parsed the term.

import { resolveSymbol, renderDescribe } from "../codegraph.mjs";
import { ask } from "../ask.mjs";
import { requireInjected } from "./injected.mjs";

/** renderDescribe() renders one line per fact with no terminal punctuation of its own;
 *  rank.mjs's splitSentences() treats each line as its own candidate sentence, and
 *  complete.mjs joins kept sentences with a single space, so two adjacent lines without
 *  a period between them would otherwise read as one run-on clause. */
function withTerminalPunctuation(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
    .join("\n");
}

/**
 * @param {object|null} graph   a parseEntities() result, or null when no code graph is loaded
 * @param {object|null} [memory=null]  a loadMemory() payload, or null when there's no Fact store
 * @param {object} [opts]
 * @param {object} opts.store  REQUIRED — the `{ createGraphService, readFactRows }` handles
 *   this adapter builds its two sentence sources from
 * @returns {{search: Function, ask: Function}} a Repository-Interface-shaped graphService
 */
export function createCompletionsGraphAdapter(graph, memory = null, { store } = {}) {
  const { createGraphService, readFactRows } = requireInjected(
    store, ["createGraphService", "readFactRows"], { caller: "createCompletionsGraphAdapter", option: "store" },
  );
  const svc = graph ? createGraphService(graph, { ask }) : null;

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
