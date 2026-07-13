// completions/search.mjs — Stage 1 ("broad search") of PLAN_COMPLETIONS.md's six-stage
// mechanical-text-generation pipeline. This is Stage-0 scope ONLY per the plan's own §4
// staging table (Stage 1 + Stage 2, no inference/summarization/pruning/voice-pass yet — see
// group.mjs for Stage 2).
//
// Near-total reuse, as the plan's own prior research established: this is a thin composition
// of retrieveBlocks (src/memory/blocks.mjs's best-first block ranker) and the graph
// search()/ask() services (src/providers/graph-service.mjs, contracted by
// src/repository-interface.mjs's SERVICE_GROUPS.search) — a WIDER query shape ("broad
// search": more hits per source, both sources asked) rather than any new retrieval
// machinery. Nothing here re-implements ranking, tokenizing, or graph traversal.
//
// Granularity note (explicit, per the strategy-advisor's Stage-0 correction): retrieveBlocks
// only ever returns whole BLOCK text — one node per ~800-token document/transcript chunk, the
// unit memory/blocks.mjs's index actually stores. PLAN_COMPLETIONS.md's own prose loosely
// says "spans"; this module does NOT invent sub-block span segmentation. Every hit this
// module returns is whole-block (or a whole graph-search/ask result) granularity. Finer-grain
//
// Determinism: retrieveBlocks is already deterministic (stable sort with an id tiebreak);
// the graph service's search()/ask() are pure functions over a fixed graph. Given the same
// dir/query/graphService, broadSearch() always returns the same array in the same order.

import { retrieveBlocks } from "../memory/blocks.mjs";

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
 *   (e.g. createGraphService(graph) from src/providers/graph-service.mjs, or any provider
 *   satisfying SERVICE_GROUPS.search's `search`/`ask`). When supplied, its search() and
 *   ask() services are queried too. Omitted -> block-only search (still a valid, honest
 *   broad search; graph access is opt-in, not required — this module never constructs a
 *   graph service itself, it only calls one it's handed).
 * @param {number} [opts.graphLimit=8]  graph search()'s result limit
 * @returns {Promise<Array<{source:"block"|"graph-search"|"graph-ask", id:string, text:string, score:number}>>}
 *   best-first within each source; blocks first, then graph-search, then graph-ask (stable,
 *   deterministic order — never shuffled/merged by score across sources, since block scores
 *   and graph relevance are not on a comparable scale; Stage 2's grouping doesn't need them
 *   to be).
 */
export async function broadSearch(dir, query, {
  blockK = DEFAULT_BLOCK_K, graphService = null, graphLimit = DEFAULT_GRAPH_LIMIT,
} = {}) {
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
