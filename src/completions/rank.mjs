// completions/rank.mjs — Stage 4 ("mechanical summarization"): extractive SENTENCE ranking
// within a group.mjs group. Reuses memory/blocks.mjs's rankBlocks() (PageRank) and degreeOf()
// (hub dampening) verbatim at sentence granularity, combined with group-scoped IDF the same
// way retrieveBlocks() fuses relevance/centrality/hub-dampening into one score.
// splitSentences() is a simple regex splitter.

import { degreeOf, rankBlocks, tokenizeBlock, OVERLAP_MIN } from "../memory/blocks.mjs";
import { STOPWORDS } from "../prose.mjs";

// Same content-token filter group.mjs applies (not exported, so replicated here).
const isContentToken = (t) => /^[a-z0-9]+$/.test(t) && !STOPWORDS.has(t);

/** tokenizeBlock(text), narrowed to real content tokens — see isContentToken above. */
function contentTokens(text) {
  return tokenizeBlock(text).filter(isContentToken);
}

// Sentence boundary: a run of [.!?] followed by whitespace and an uppercase letter or digit
// (no abbreviation dictionary).
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9])/;

/**
 * Split raw block text into trimmed, non-empty sentences (order-preserving, no dedup).
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
 * Stage 4 — extractive sentence ranking within one group.mjs group: splits every member's
 * text into sentences, ranks them by PageRank + hub-dampening + IDF (self-weighted, or
 * query-focused when `opts.query` is given — a sentence with zero query overlap scores 0
 * rather than falling back to self-weighting).
 *
 * @param {{members: Array<{id:string, text:string}>}} group  a group.mjs groupHits() entry
 * @param {object} [opts]
 * @param {number} [opts.overlapMin=OVERLAP_MIN]  shared content-token threshold for a
 *   sentence-similarity edge
 * @param {string|null} [opts.query=null]  optional query text to focus ranking on
 * @returns {Array<{sentence:string, score:number, sourceBlockId:string}>} best-first;
 *   deterministic tiebreak (sourceBlockId, then sentence text) on equal score.
 */
export function rankSentences(group, { overlapMin = OVERLAP_MIN, query = null } = {}) {
  const members = Array.isArray(group?.members) ? group.members : [];
  if (!members.length) return [];

  // One entry per sentence, with a stable id for PageRank/degree/IDF keying.
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

  const ranks = rankBlocks(tokensById, { overlapMin });
  const degrees = degreeOf(tokensById, { overlapMin });

  // IDF scoped to THIS group's sentence set (df/N), not the whole corpus.
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
    const score = (idfSum * (1 + rank)) / Math.sqrt(1 + degree);
    return { sentence: s.sentence, score, sourceBlockId: s.sourceBlockId };
  });

  scored.sort((a, b) => b.score - a.score
    || a.sourceBlockId.localeCompare(b.sourceBlockId)
    || a.sentence.localeCompare(b.sentence));
  return scored;
}
