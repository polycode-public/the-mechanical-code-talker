// completions/group.mjs — Stage 2 ("grouping") of PLAN_COMPLETIONS.md's six-stage
// mechanical-text-generation pipeline. Stage-0 scope ONLY per the plan's own §4 staging
// table: cluster search.mjs's broadSearch() hits into topical groups; no cross-group
// inference (Stage 3), summarization (Stage 4), pruning (Stage 5), or voice pass (Stage 6)
// happens here.
//
// Genuinely greenfield, as the plan's own prior research established: PLAN_COMPLETIONS.md's
// citation of "insights-panel tag clustering" as prior art turned out to be a different,
// sibling project's capability, not tmct's — there was no clustering/tag-grouping code
// anywhere in this repo before this file.
//
// Granularity: this module clusters at BLOCK granularity — the exact unit search.mjs's
// broadSearch() hands it (one node per whole retrieveBlocks hit, or one node per whole
// graph-search/ask result). PLAN_COMPLETIONS.md's own prose loosely says "spans"; that is
// resolved explicitly here rather than silently assumed: no sub-block span segmentation is
// attempted in this build. A finer-grained span-level increment
//
// Algorithm: CONNECTED COMPONENTS over the block-similarity graph (shared-token-overlap
// edges), reusing memory/blocks.mjs's buildNeighbours()/OVERLAP_MIN — the exact adjacency
// rankBlocks()/degreeOf() already build for PageRank, exported from blocks.mjs for this
// purpose rather than re-derived. This is the strategy-advisor's explicit Stage-0
// recommendation: "the cheapest deterministic starting point" for grouping — genuinely
// CoRank-adjacent (CoRank = "clustering cum graph ranking", PLAN_COMPLETIONS.md §1.2) since
// it clusters over the same graph-ranking substrate blocks.mjs's PageRank runs on, and fully
// deterministic/auditable, unlike any softer/fuzzier clustering. Richer ranking WITHIN a
// cluster (e.g. running rankBlocks per component, or a true joint clustering+ranking pass)
// is a future increment if the pipeline needs it later — not attempted here.
//
// Labeling: each group carries its member ids AND a human-inspectable label — its top
// shared-IDF tokens. The only term-frequency machinery this repo ships is the
// idf = log(1 + N/(1+df)) formula memory/blocks.mjs's retrieveBlocks() already computes
// inline (there is no standalone exported idf() to import — it lives inline in
// retrieveBlocks, scoped to a single query's tokens); that exact formula is replicated here,
// scoped instead to df/N over the hit set passed into groupHits(), rather than inventing a
// new weighting scheme.
//
// Determinism: no randomness anywhere. Same hits in (same ids, same text, same order) ->
// same groups out (same partition, same member order, same label) — this is exactly what
// test/completions-stage0.test.mjs's double-run diff asserts as Stage 0's exit criterion.

import { buildNeighbours, OVERLAP_MIN, tokenizeBlock } from "../memory/blocks.mjs";
import { STOPWORDS } from "../prose.mjs";

const LABEL_TOKEN_COUNT = 5;

// tokenizeBlock unions tokenizeProse(line) (stopword-filtered, punctuation-stripped) with
// splitIdentifierWords(line) (NOT stopword-filtered — it's built for code identifiers, where
// a stopword-shaped fragment is rare, and it doesn't strip trailing sentence punctuation
// either). For prose-similarity clustering that union re-admits filler ("the", "and", "is",
// "q:", "a:", "do?", …) as if it were real overlap signal — harmless for retrieveBlocks'
// IDF-weighted single-query scoring (rare query tokens still dominate), but fatal for
// unweighted shared-token-overlap clustering: almost any two English sentences share ≥2
// stopwords, which would collapse everything into one giant component. isContentToken()
// closes that gap for THIS module's own adjacency/labeling use, without changing
// tokenizeBlock's shipped behavior (still exactly what retrieveBlocks/rankBlocks use).
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
 * @param {number} [opts.overlapMin=OVERLAP_MIN]  shared-token threshold for a similarity
 *   edge — defaults to the exact value memory/blocks.mjs's own PageRank graph uses, so
 *   grouping and ranking agree on what "related" means unless the caller deliberately
 *   overrides it.
 * @returns {Array<{ id: string, members: Array<{id:string, text:string}>, memberIds: string[],
 *   tokens: string[], label: string }>}
 *   One entry per connected component (a singleton hit that shares no edge with anything
 *   else is still a valid, if lonely, one-member group — never dropped). Deterministic
 *   order: groups sorted by their lowest member id; members within a group sorted by id.
 *   `id` is the group's own stable id (`"g:" + memberIds[0]`, deterministic from content).
 */
export function groupHits(hits, { overlapMin = OVERLAP_MIN } = {}) {
  const list = Array.isArray(hits) ? hits.filter((h) => h && h.id != null) : [];
  if (!list.length) return [];

  // dedupe by id — a hit can legitimately appear from more than one source (e.g. a block
  // and a graph-ask answer both id-tagged distinctly, but a caller re-running broadSearch
  // for an overlapping prompt set could still hand duplicate ids); first occurrence wins.
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

  // IDF over THIS hit set (df/N here, not the whole corpus) — grouping is scoped to what
  // Stage 1 actually retrieved for this prompt, same discipline retrieveBlocks applies to a
  // single query's tokens.
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

    // label tokens: rank by (a) how many members share the token — full coverage first, so
    // a group's label prefers what its members have IN COMMON over what one member merely
    // contains a lot of — then (b) IDF (rarer across the hit set wins ties), then (c) token
    // text for a fully deterministic order.
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
