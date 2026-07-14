// completions/group.mjs — Stage 2 ("grouping"): clusters search.mjs's broadSearch() hits
// into topical groups via connected components over a shared-token-overlap graph (reusing
// memory/blocks.mjs's buildNeighbours()/OVERLAP_MIN). Block granularity, no sub-block spans.
// Each group's label is its top shared-IDF tokens (df/N over the hit set, not the corpus).

import { buildNeighbours, OVERLAP_MIN, tokenizeBlock } from "../memory/blocks.mjs";
import { STOPWORDS } from "../prose.mjs";

const LABEL_TOKEN_COUNT = 5;

// tokenizeBlock's raw output re-admits stopwords, which would collapse almost any two
// sentences into one giant component under unweighted overlap clustering; filter them here.
const isContentToken = (t) => /^[a-z0-9]+$/.test(t) && !STOPWORDS.has(t);

/** tokenizeBlock(text), narrowed to real content tokens (see isContentToken above) — the
 *  token set this module actually clusters and labels on. */
function contentTokens(text) {
  return tokenizeBlock(text).filter(isContentToken);
}

/** Plain union-find (path halving, union-by-index) — small N here (a single broad search's
 *  hit count), so this is deliberately the simplest correct structure, not a fancy one. */
function unionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  return { find, union };
}

/**
 * Stage 2 — grouping. Clusters a flat hit list (search.mjs's broadSearch() output, or any
 * `{ id, text }` array) into topical groups via connected components over the shared-token-
 * overlap similarity graph (the same adjacency memory/blocks.mjs's PageRank runs over).
 *
 * @param {Array<{id:string, text:string}>} hits
 * @param {object} [opts]
 * @param {number} [opts.overlapMin=OVERLAP_MIN]  shared-token threshold for a similarity edge
 * @returns {Array<{ id: string, members: Array<{id:string, text:string}>, memberIds: string[],
 *   tokens: string[], label: string }>}
 *   One entry per connected component (a singleton hit is still a one-member group).
 *   Deterministic order: groups by lowest member id; members within a group by id.
 */
export function groupHits(hits, { overlapMin = OVERLAP_MIN } = {}) {
  const list = Array.isArray(hits) ? hits.filter((h) => h && h.id != null) : [];
  if (!list.length) return [];

  // dedupe by id — first occurrence wins.
  const seen = new Set();
  const deduped = [];
  for (const h of list) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    deduped.push(h);
  }

  const tokensById = {};
  for (const h of deduped) tokensById[h.id] = contentTokens(h.text || "");

  const { ids, neighbours } = buildNeighbours(tokensById, overlapMin);
  const { find, union } = unionFind(ids.length);
  for (let i = 0; i < ids.length; i += 1) {
    for (const j of neighbours[i]) union(i, j);
  }

  const byId = new Map(deduped.map((h) => [h.id, h]));
  const componentIdx = new Map(); // root index -> [member indices]
  for (let i = 0; i < ids.length; i += 1) {
    const root = find(i);
    if (!componentIdx.has(root)) componentIdx.set(root, []);
    componentIdx.get(root).push(i);
  }

  // IDF over THIS hit set (df/N), not the whole corpus.
  const N = ids.length;
  const df = new Map();
  for (const id of ids) {
    for (const t of new Set(tokensById[id])) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)));

  const groups = [];
  for (const memberIdx of componentIdx.values()) {
    const members = memberIdx
      .map((i) => byId.get(ids[i]))
      .sort((a, b) => a.id.localeCompare(b.id));
    const memberIds = members.map((m) => m.id);

    // label tokens: rank by member coverage, then IDF, then token text (deterministic).
    const coverage = new Map();
    for (const i of memberIdx) {
      for (const t of new Set(tokensById[ids[i]])) coverage.set(t, (coverage.get(t) || 0) + 1);
    }
    const tokens = [...coverage.keys()]
      .sort((a, b) => (coverage.get(b) - coverage.get(a)) || (idf(b) - idf(a)) || a.localeCompare(b))
      .slice(0, LABEL_TOKEN_COUNT);

    groups.push({
      id: `g:${memberIds[0]}`,
      members,
      memberIds,
      tokens,
      label: tokens.join(" ") || "(untitled group)",
    });
  }

  groups.sort((a, b) => a.memberIds[0].localeCompare(b.memberIds[0]));
  return groups;
}
