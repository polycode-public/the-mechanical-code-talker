// completions/rank.mjs — Stage 4 ("mechanical summarization") of PLAN_COMPLETIONS.md's
// six-stage mechanical-text-generation pipeline. Stage-2-of-staging scope per the plan's own
// §4 table: extractive SENTENCE ranking within a group.mjs group — no cross-group inference
// (Stage 3, §1.3 — separately scoped), pruning (Stage 5), or voice pass (Stage 6) happens
// here.
//
// "Extractive sentence selection over the grouped-and-inferred material, not abstractive
// rewriting... query-focused multi-document summarization (feature-fusion sentence
// selection, graph-ranking approaches in the LexRank/TextRank family, clustering-cum-ranking
// as in CoRank)" — PLAN_COMPLETIONS.md §1.4/§4. The graph-ranking machinery this stage needs
// already exists and ships: memory/blocks.mjs's rankBlocks() (PageRank, d=0.85, 20
// iterations, over the shared-token block-similarity graph) and degreeOf() (hub dampening),
// both generic over any `{ id: tokens[] }` map — NOT block-specific despite the module name.
// This file reuses rankBlocks()/degreeOf() VERBATIM at sentence granularity (no PageRank
// reimplementation), combined with the same idf = log(1 + N/(1+df)) formula group.mjs already
// replicates for group-scoped (not whole-corpus-scoped) weighting, and the same
// idfSum * (1+rank) / sqrt(1+degree) combination retrieveBlocks() uses to fuse relevance,
// centrality, and hub-dampening into one score.
//
// New in this file: splitSentences() (no sentence-splitter existed anywhere in this repo —
// grepped for "sentence" across src/ and found none; a simple regex splitter is intentional
// here per the dispatch's own instruction not to pull in an NLP dependency for this) and the
// sentence-level id/token/scoring wiring that adapts rankBlocks/degreeOf from block to
// sentence granularity.
//
// Determinism: no randomness anywhere. Same group in (same members, same text, same order)
// -> same ranked sentence list out (stable score-descending sort with a deterministic
// sourceBlockId/sentence-text tiebreak) — see test/completions-stage2.test.mjs's double-run
// diff, the exact discipline test/completions-stage0.test.mjs established for search+group.

import { degreeOf, rankBlocks, tokenizeBlock, OVERLAP_MIN } from "../memory/blocks.mjs";
import { STOPWORDS } from "../prose.mjs";

// Same content-token filter group.mjs applies to its own adjacency/labeling (not exported
// from group.mjs, so replicated here rather than reached across files — group.mjs's own
// header explains why raw tokenizeBlock output is unsuitable for unweighted overlap: it
// re-admits stopwords/filler that would collapse unrelated sentences into false edges).
const isContentToken = (t) => /^[a-z0-9]+$/.test(t) && !STOPWORDS.has(t);

/** tokenizeBlock(text), narrowed to real content tokens — see isContentToken above. */
function contentTokens(text) {
  return tokenizeBlock(text).filter(isContentToken);
}

// Sentence boundary: a run of [.!?] followed by whitespace and an uppercase letter or digit —
// deliberately simple (no abbreviation dictionary, no NLP dependency, per the dispatch's own
// instruction). Applied per-line (a block's own "Q: ...\nA: ..." shape already gives clean
// boundaries at the newline; this regex further splits any line that itself holds more than
// one sentence).
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9])/;

/**
 * Split raw block text into trimmed, non-empty sentences (order-preserving, no dedup —
 * dedup, if ever needed, is the caller's call). Splits on blank lines first (a block's own
 * natural line structure), then on sentence-ending punctuation within each line.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const out = [];
  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const part of line.split(SENTENCE_SPLIT_RE)) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/**
 * Stage 4 — extractive sentence ranking within one group.mjs group. Splits every member's
 * text into sentences, builds a sentence-level shared-token-overlap similarity graph (the
 * exact adjacency buildNeighbours/rankBlocks/degreeOf already establish, just re-keyed to
 * sentence ids instead of block ids), runs the same PageRank (rankBlocks) and hub-dampening
 * (degreeOf) over it, and combines with group-scoped IDF the same way retrieveBlocks() fuses
 * relevance × centrality × hub-dampening — self-weighted (LexRank-style: a sentence's own
 * rare/informative tokens) unless `opts.query` is supplied, in which case only tokens
 * overlapping the query are IDF-summed (query-focused summarization, PLAN_COMPLETIONS.md's
 * own literature framing) — a sentence with zero query overlap honestly scores 0 rather than
 * silently falling back to self-weighting, the same "never a guessed match" discipline
 * retrieveBlocks() applies when idfSum <= 0.
 *
 * @param {{members: Array<{id:string, text:string}>}} group  a group.mjs groupHits() entry
 *   (or any object shaped `{ members: [{id, text}, ...] }`)
 * @param {object} [opts]
 * @param {number} [opts.overlapMin=OVERLAP_MIN]  shared content-token threshold for a
 *   sentence-similarity edge — defaults to the same value group.mjs/blocks.mjs use, so
 *   grouping, block-ranking, and sentence-ranking all agree on what "related" means unless
 *   the caller deliberately overrides it.
 * @param {string|null} [opts.query=null]  optional query text to focus ranking on (see above)
 * @returns {Array<{sentence:string, score:number, sourceBlockId:string}>} best-first;
 *   deterministic tiebreak (sourceBlockId, then sentence text) on equal score.
 */
export function rankSentences(group, { overlapMin = OVERLAP_MIN, query = null } = {}) {
  const members = Array.isArray(group?.members) ? group.members : [];
  if (!members.length) return [];

  // One entry per sentence: a stable id ("<blockId>#<index>") so PageRank/degree/IDF can be
  // keyed exactly like rankBlocks/degreeOf already key blocks — deterministic since it's
  // derived purely from member order (group.mjs's members are already id-sorted) and each
  // block's own sentence order.
  const sentences = [];
  for (const m of members) {
    const parts = splitSentences(m?.text || "");
    parts.forEach((sentence, i) => {
      sentences.push({ id: `${m.id}#${i}`, sentence, sourceBlockId: m.id });
    });
  }
  if (!sentences.length) return [];

  const tokensById = {};
  for (const s of sentences) tokensById[s.id] = contentTokens(s.sentence);

  // Reused verbatim — the exact PageRank/hub-dampening machinery rankBlocks()/degreeOf()
  // already run for block-level ranking, generic over any id->tokens map.
  const ranks = rankBlocks(tokensById, { overlapMin });
  const degrees = degreeOf(tokensById, { overlapMin });

  // IDF scoped to THIS group's sentence set (df/N here, not the whole corpus) — the same
  // scoping discipline group.mjs applies to its own label tokens.
  const ids = Object.keys(tokensById);
  const N = ids.length;
  const df = new Map();
  for (const id of ids) {
    for (const t of new Set(tokensById[id])) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)));

  const queryTokens = query ? new Set(contentTokens(query)) : null;

  const scored = sentences.map((s) => {
    const tokens = tokensById[s.id];
    const idfTokens = queryTokens ? tokens.filter((t) => queryTokens.has(t)) : tokens;
    let idfSum = 0;
    for (const t of idfTokens) idfSum += idf(t);
    const rank = ranks[s.id] ?? 0;
    const degree = degrees[s.id] ?? 0;
    // idfSum * (1 + rank) / sqrt(1 + degree) — retrieveBlocks()'s own combination formula
    // (memory/blocks.mjs), reused at sentence granularity: IDF-weighted informativeness
    // decides content, PageRank centrality breaks ties toward well-connected (consensus)
    // sentences, and the degree divisor dampens a sentence that merely shares vocabulary
    // with disproportionately many others from winning on inflated rank alone.
    const score = (idfSum * (1 + rank)) / Math.sqrt(1 + degree);
    return { sentence: s.sentence, score, sourceBlockId: s.sourceBlockId };
  });

  scored.sort((a, b) => b.score - a.score
    || a.sourceBlockId.localeCompare(b.sourceBlockId)
    || a.sentence.localeCompare(b.sentence));
  return scored;
}
