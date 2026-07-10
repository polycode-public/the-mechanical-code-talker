// memory/blocks.mjs — text blocks + the relevance index (ROADMAP item 9).
//
// The memory graph (core.mjs) holds STRUCTURE; this module holds TEXT: cleaned
// session transcripts (fold.mjs writes one block per session) and, later,
// corpus documents. Storage under <repo>/.tmct/memory/blocks/:
//   <block-id>.txt   — the plain block text
//   index.json       — per-block prose tokens (prose.mjs tokenizer) + a static rank
//
// Ranking is two signals, combined at query time:
//   1. STATIC rank — a genuine iterative PageRank over the block-similarity
//      graph (an undirected edge wherever two blocks share ≥ OVERLAP_MIN
//      tokens; damping 0.85, 20 iterations — cheap at this scale). A block that
//      shares vocabulary with many other blocks is "well-connected": it covers
//      ground the corpus keeps returning to, so it wins ties.
//   2. QUERY-time IDF match — each query token is weighted by rarity across
//      blocks (idf = log(1 + N/(1+df)), the codegraph.mjs locate discipline),
//      so a whole-question query is not dominated by its ubiquitous words.
// retrieveBlocks() scores idf-sum × (1 + rank) ÷ sqrt(1 + degree): the IDF
// match decides topic, the static rank breaks ties toward well-connected
// blocks, and the degree divisor (hub dampening, ported from codegraph.mjs's
// spiralExpand degree-quantile gate; on by default here) stops a block that
// merely shares vocabulary with disproportionately many others — a generic
// "boilerplate" hub — from winning on inflated rank alone.
//
// All writes are temp+rename atomic; saveBlock is an upsert (same id replaces —
// what makes fold.mjs's re-fold idempotent).

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { splitIdentifierWords, tokenizeProse } from "../prose.mjs";
import { SOURCE_PRIOR } from "./trust.mjs";

// A block inherits the trust of the Source it was folded from: a session block
// is operator-chat (1.0), a corpus block its corpus Source (0.7). Retrieval
// weights relevance × trust via a BOUNDED factor (≈ 0.5 + trust → ~[0.5, 1.5]),
// a capped nudge so a weakly-trusted but perfectly-relevant block still surfaces.
const DEFAULT_BLOCK_SOURCE_TYPE = "operator";
const blockTrust = (sourceType) => SOURCE_PRIOR[sourceType] ?? SOURCE_PRIOR.operator;
const trustFactorOf = (trust) => 0.5 + (typeof trust === "number" ? trust : SOURCE_PRIOR.operator);

export const BLOCKS_DIR_REL = join(".tmct", "memory", "blocks");
const INDEX_NAME = "index.json";

export const PAGERANK_DAMPING = 0.85;
export const PAGERANK_ITERATIONS = 20;
const OVERLAP_MIN = 2;          // shared tokens for a similarity edge
const MAX_TOKENS_PER_BLOCK = 800; // beyond tokenizeProse's per-doc cap: union over lines

const blocksDir = (dir) => join(dir, BLOCKS_DIR_REL);

/** Only safe, filesystem-friendly block file names (ids are session uuids or
 *  corpus slugs; anything else is normalized, never trusted into a path). */
const safeName = (id) => String(id).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "_";

/** Tokenize a whole block: prose tokens + identifier decomposition, unioned per
 *  line so tokenizeProse's 120-token-per-doc cap can't starve a long transcript;
 *  bounded overall. Sorted + deduped — the index stays deterministic. */
export function tokenizeBlock(text) {
  const set = new Set();
  for (const line of String(text || "").split("\n")) {
    for (const t of tokenizeProse(line)) set.add(t);
    for (const t of splitIdentifierWords(line)) set.add(t);
    if (set.size >= MAX_TOKENS_PER_BLOCK) break;
  }
  return [...set].sort().slice(0, MAX_TOKENS_PER_BLOCK);
}

async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

/** Load the block index ({ blocks: { id: { file, tokens[], rank } } }); a
 *  missing index is the empty bootstrap. */
export async function loadBlockIndex(dir) {
  try {
    return JSON.parse(await readFile(join(blocksDir(dir), INDEX_NAME), "utf8"));
  } catch (e) {
    if (e?.code === "ENOENT") return { blocks: {} };
    throw e;
  }
}

/**
 * Build the block-similarity adjacency shared by rankBlocks and degreeOf:
 * `tokensById` is a plain { id: tokens[] } map; an undirected edge joins two
 * blocks sharing at least `overlapMin` tokens. Returns { ids, neighbours }
 * (neighbours[i] is an array of adjacent indices into ids).
 */
function buildNeighbours(tokensById, overlapMin) {
  const ids = Object.keys(tokensById || {});
  const N = ids.length;
  const sets = ids.map((id) => new Set(tokensById[id] || []));
  const neighbours = ids.map(() => []);
  for (let i = 0; i < N; i += 1) {
    for (let j = i + 1; j < N; j += 1) {
      const [small, big] = sets[i].size <= sets[j].size ? [sets[i], sets[j]] : [sets[j], sets[i]];
      let shared = 0;
      for (const t of small) {
        if (big.has(t) && (shared += 1) >= overlapMin) break;
      }
      if (shared >= overlapMin) {
        neighbours[i].push(j);
        neighbours[j].push(i);
      }
    }
  }
  return { ids, neighbours };
}

/**
 * Each block's degree (neighbour count) in the same block-similarity graph
 * rankBlocks runs PageRank over. Pure — returns { id: degree }. Used to
 * dampen retrieveBlocks' hub bias (a block linked to many others shouldn't
 * win purely by being well-connected — codegraph.mjs's spiralExpand applies
 * the same degree-quantile idea to module search).
 */
export function degreeOf(tokensById, { overlapMin = OVERLAP_MIN } = {}) {
  const { ids, neighbours } = buildNeighbours(tokensById, overlapMin);
  const out = {};
  for (let i = 0; i < ids.length; i += 1) out[ids[i]] = neighbours[i].length;
  return out;
}

/**
 * Iterative PageRank over the block-similarity graph. `tokensById` is a plain
 * { id: tokens[] } map; an undirected edge joins two blocks sharing at least
 * `overlapMin` tokens. Standard damped iteration (d=0.85, 20 rounds), dangling
 * mass redistributed evenly, ranks summing to ~1. Pure — returns { id: rank }.
 */
export function rankBlocks(tokensById, {
  damping = PAGERANK_DAMPING, iterations = PAGERANK_ITERATIONS, overlapMin = OVERLAP_MIN,
} = {}) {
  const { ids, neighbours } = buildNeighbours(tokensById, overlapMin);
  const N = ids.length;
  if (!N) return {};

  let rank = new Array(N).fill(1 / N);
  for (let round = 0; round < iterations; round += 1) {
    const next = new Array(N).fill((1 - damping) / N);
    let dangling = 0;
    for (let i = 0; i < N; i += 1) {
      const out = neighbours[i].length;
      if (!out) { dangling += rank[i]; continue; }
      const share = (damping * rank[i]) / out;
      for (const j of neighbours[i]) next[j] += share;
    }
    const danglingShare = (damping * dangling) / N; // dangling mass spread evenly
    for (let i = 0; i < N; i += 1) next[i] += danglingShare;
    rank = next;
  }
  const out = {};
  for (let i = 0; i < N; i += 1) out[ids[i]] = rank[i];
  return out;
}

/** Re-tokenize nothing, re-rank everything: recompute every block's static rank
 *  from the tokens already in the index (called by saveBlock/removeBlock). */
function rerank(index) {
  const tokensById = {};
  for (const [id, b] of Object.entries(index.blocks)) tokensById[id] = b.tokens || [];
  const ranks = rankBlocks(tokensById);
  const degrees = degreeOf(tokensById);
  for (const [id, b] of Object.entries(index.blocks)) {
    b.rank = ranks[id] ?? 0;
    b.degree = degrees[id] ?? 0;
  }
  return index;
}

/**
 * Upsert one text block: write <id>.txt (atomic), tokenize it, update
 * index.json and recompute the static ranks. Same id → replaced, never
 * duplicated (fold.mjs's re-fold idempotency rests on this).
 * Returns the block's index entry { file, tokens, rank }.
 */
export async function saveBlock(dir, { id, text, sourceType = DEFAULT_BLOCK_SOURCE_TYPE, createdAt = "" }) {
  if (!id) throw new Error("a block needs an id");
  const bdir = blocksDir(dir);
  await mkdir(bdir, { recursive: true });
  const file = `${safeName(id)}.txt`;
  await atomicWrite(join(bdir, file), String(text ?? ""));
  const index = await loadBlockIndex(dir);
  const prior = index.blocks[id];
  index.blocks[id] = {
    file, tokens: tokenizeBlock(text),
    // first-write-wins createdAt (step (a)) + the block's inherited source trust (step (d)).
    createdAt: prior?.createdAt || createdAt || new Date().toISOString(),
    sourceType, trust: blockTrust(sourceType),
  };
  rerank(index);
  await atomicWrite(join(bdir, INDEX_NAME), JSON.stringify(index));
  return index.blocks[id];
}

/** Remove a block (id unknown → no-op) and re-rank the survivors. */
export async function removeBlock(dir, id) {
  const index = await loadBlockIndex(dir);
  const entry = index.blocks[id];
  if (!entry) return false;
  delete index.blocks[id];
  rerank(index);
  await atomicWrite(join(blocksDir(dir), INDEX_NAME), JSON.stringify(index));
  await rm(join(blocksDir(dir), entry.file), { force: true });
  return true;
}

/**
 * The top-k blocks a question "touches": IDF-weighted token match (rarity-
 * weighted, so common words can't dominate) combined with the static PageRank
 * (score × (1 + rank), divided by sqrt(1 + degree) to dampen hubs — a block
 * that shares vocabulary with disproportionately many others doesn't win on
 * inflated rank alone). Returns [{ id, score, rank, file, text }], best
 * first; [] when nothing matches (never a guessed block).
 */
export async function retrieveBlocks(dir, query, k = 3) {
  const index = await loadBlockIndex(dir);
  const entries = Object.entries(index.blocks);
  const N = entries.length;
  if (!N) return [];
  const qTokens = [...new Set([...tokenizeProse(query), ...splitIdentifierWords(query)])];
  if (!qTokens.length) return [];

  const sets = entries.map(([, b]) => new Set(b.tokens || []));
  // idf per query token, computed once: log(1 + N/(1+df)) — the codegraph.mjs
  // locate weighting (~0 for ubiquitous tokens, large for rare ones).
  const idf = new Map(qTokens.map((t) => {
    let df = 0;
    for (const s of sets) if (s.has(t)) df += 1;
    return [t, Math.log(1 + N / (1 + df))];
  }));
  const scored = [];
  for (let i = 0; i < N; i += 1) {
    const [id, b] = entries[i];
    let idfSum = 0;
    for (const t of qTokens) if (sets[i].has(t)) idfSum += idf.get(t);
    if (idfSum <= 0) continue;
    const rank = b.rank ?? 0;
    const degree = b.degree ?? 0;
    // relevance × connectivity × TRUST — a bounded trustFactor (~[0.5, 1.5]) so a
    // corroborated/operator block outranks a lone low-trust one on a relevance tie,
    // yet a weakly-trusted but perfectly-relevant block still surfaces. Divided by
    // sqrt(1 + degree) — hub dampening (the codegraph.mjs spiralExpand idea, ported
    // here): a block that shares vocabulary with disproportionately many others
    // shouldn't win purely by being well-connected.
    const trust = typeof b.trust === "number" ? b.trust : blockTrust(b.sourceType);
    const trustFactor = trustFactorOf(trust);
    scored.push({
      id, score: (idfSum * (1 + rank) * trustFactor) / Math.sqrt(1 + degree), rank, trust, file: b.file,
    });
  }
  scored.sort((a, b) => b.score - a.score || b.rank - a.rank || a.id.localeCompare(b.id));
  const top = scored.slice(0, Math.max(1, k));
  for (const hit of top) {
    try { hit.text = await readFile(join(blocksDir(dir), hit.file), "utf8"); }
    catch { hit.text = ""; } // index/file drift — honest empty, never a crash
  }
  return top;
}
