// completions/search.mjs — Stage 1 ("broad search"): a thin composition of retrieveBlocks
// and the graph search()/ask() services, asking both sources more widely than a single-answer
// query. Returns whole-block/whole-result hits only — no sub-block span segmentation.

import { requireInjected } from "./injected.mjs";

const DEFAULT_BLOCK_K = 8;   // "broad" > chat's narrow single-answer k (typically 3)
const DEFAULT_GRAPH_LIMIT = 8;

/**
 * Stage 1 — broad search. Runs retrieveBlocks (memory/blocks.mjs) for text-block hits and,
 * when a Repository-Interface graph service is supplied, its search() and ask() services for
 * graph hits — merged into one flat, source-tagged hit list.
 *
 * @param {string} dir   repo root (retrieveBlocks reads <dir>/.tmct/memory/blocks/)
 * @param {string} query the broad prompt driving retrieval
 * @param {object} [opts]
 * @param {number} [opts.blockK=8]  retrieveBlocks' k (how many blocks to pull)
 * @param {object|null} [opts.graphService=null]  an optional Repository-Interface service
 *   (e.g. createGraphService(graph)). When supplied, its search() and ask() are queried too;
 *   omitted -> block-only search.
 * @param {number} [opts.graphLimit=8]  graph search()'s result limit
 * @param {object} opts.store  REQUIRED — the block store's `{ retrieveBlocks }` reader
 * @returns {Promise<Array<{source:"block"|"graph-search"|"graph-ask", id:string, text:string, score:number}>>}
 *   best-first within each source; blocks first, then graph-search, then graph-ask (never
 *   shuffled/merged by score across sources — block scores and graph relevance aren't
 *   comparable).
 */
export async function broadSearch(dir, query, {
  blockK = DEFAULT_BLOCK_K, graphService = null, graphLimit = DEFAULT_GRAPH_LIMIT, store,
} = {}) {
  const { retrieveBlocks } = requireInjected(store, ["retrieveBlocks"], { caller: "broadSearch", option: "store" });
  const q = String(query || "").trim();
  if (!q) return [];

  const hits = [];

  const blockHits = await retrieveBlocks(dir, q, blockK);
  for (const b of blockHits) {
    hits.push({ source: "block", id: b.id, text: b.text || "", score: typeof b.score === "number" ? b.score : 0 });
  }

  if (graphService) {
    if (typeof graphService.search === "function") {
      const res = graphService.search(q, { limit: graphLimit });
      if (res?.ok) {
        for (const r of res.value.results || []) {
          if (!r) continue;
          hits.push({ source: "graph-search", id: r.id, text: r.label || r.id, score: 0 });
        }
      }
    }
    if (typeof graphService.ask === "function") {
      const res = graphService.ask(q);
      if (res?.ok && res.value && res.value.content) {
        // one honest hit per prompt — the ask() answer itself, id-tagged with the query so
        // it never collides with a block/search id and stays traceable to what produced it.
        hits.push({ source: "graph-ask", id: `ask:${q}`, text: String(res.value.content), score: 0 });
      }
    }
  }

  return hits;
}
