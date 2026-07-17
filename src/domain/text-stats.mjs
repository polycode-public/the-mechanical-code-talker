// text-stats.mjs — pure token-frequency statistics shared by the ranking tiers.
// Deterministic, no model calls. The IDF weight log(1 + N/(1+df)) is near-zero
// for tokens present in almost every document and grows for rare ones.

/**
 * Inverse-document-frequency weight for a token seen in `df` of `N` documents.
 * @param {number} N   document count
 * @param {number} df  document frequency of the token
 * @returns {number}
 */
export function idfWeight(N, df) {
  return Math.log(1 + N / (1 + df));
}

/**
 * IDF over a document set given as an `id -> tokens` map. Document frequency
 * counts each document once per distinct token; N is the document count.
 *
 * @param {Record<string, string[]>} idsToTokens
 * @returns {{ N: number, df: Map<string, number>, idf: (t: string) => number }}
 */
export function idfOver(idsToTokens) {
  const ids = Object.keys(idsToTokens || {});
  const N = ids.length;
  const df = new Map();
  for (const id of ids) {
    for (const t of new Set(idsToTokens[id])) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = (t) => idfWeight(N, df.get(t) || 0);
  return { N, df, idf };
}
