// digest-client.mjs — the browser-native side of the digest layer's stage-5
// wiring. The node surfaces (chat, `tmct digest`, the page generators) reach
// the pure pipeline through adapters/corpus/digest-bank.mjs, which reads the
// sentence-structure bank off disk with a TOML parser. A browser can't do that,
// so the bundle scripts stub digest-bank out — and the pages that grow or hold
// a store IN the browser (research, the ledger dock, the CLI `tmct viz` page)
// digest from a structure table embedded in the page as JSON at build time.
//
// This module is that browser path: it feeds the embedded structures straight
// into the SAME pure layer (src/domain/digest — buildStructureTable, digestTerm,
// the store-stats scan) the node seam uses, so the two produce the same article
// from the same rows. It ships no TOML parser; the page hands it pre-parsed
// [[structure]] rows.

import { buildStructureTable, digestTerm } from "../../domain/digest/index.mjs";
import { digestStoreStats, chainsForObjects, isaObjectsOf } from "../../domain/digest/store-stats.mjs";
import { readFactRows, normFactTerm } from "../../adapters/memory/core.mjs";
import { factTermVariants } from "../../services/chat.mjs";

/**
 * Digest one term end to end from fact rows and a pre-parsed structure table.
 * The browser twin of digestTermFromRows: identical pipeline, but the structure
 * rows arrive as data (embedded JSON) rather than from a filesystem TOML read.
 *
 * `structures` is the array of [[structure]] rows the bank parses to. Returns
 * the term-article shape, or null when no structures were supplied (the page
 * then falls back to its flat fact list, the same degradation the node stub
 * gives).
 */
export function digestTermFromRowsBrowser(term, termRows, allRows, structures, opts = {}) {
  const table = buildStructureTable(structures || []);
  if (!table || table.size === 0) return null;
  const rows = termRows || [];
  const store = digestStoreStats(allRows || rows);
  const chains = chainsForObjects(store.subClassEdges, isaObjectsOf(rows));
  return digestTerm(term, rows, store, table, { ...opts, chains });
}

/**
 * Digest one term straight from a loadMemory()-shaped payload — the shape every
 * in-browser surface already holds (the ledger's embedded PAYLOAD, the ledger
 * dock's live memoryDir.payload, the research session's store). Scans the
 * payload once for the term's own rows and the whole-store statistics, so a
 * caller never has to run readFactRows itself. Matches `term` against a fact's
 * subject through the same spelling-variant fold `factTermVariants` gives the
 * "what is X" fact reader (plural/irregular-plural folding), so a term seeded
 * as "dog" is still found when queried as "dogs".
 *
 * Returns the render-ready view (see digestViewFromArticle) or null when the
 * term has no rows, no structures were supplied, or the selector kept nothing.
 */
export function digestTermFromPayloadBrowser(payload, term, structures, opts = {}) {
  const rows = readFactRows(payload || { individuals: [], objectProperties: [] });
  const variants = factTermVariants(normFactTerm, term);
  const termRows = rows.filter((r) => variants.has(r.subject));
  if (!termRows.length) return null;
  const article = digestTermFromRowsBrowser(term, termRows, rows, structures, opts);
  return digestViewFromArticle(article);
}

/**
 * The flat, render-ready view a page's DOM code wants from a term article:
 * the narrative paragraphs, the distinct source strings (the "(sources: …)"
 * line the chat and CLI surfaces render), and the full fact list behind the
 * "show the facts" escape. Null when the article carried no narrative, so the
 * caller falls back to its flat rendering rather than showing an empty card.
 */
export function digestViewFromArticle(article) {
  if (!article || !Array.isArray(article.paragraphs) || !article.paragraphs.length) return null;
  const facts = (article.detail && Array.isArray(article.detail.facts)) ? article.detail.facts : [];
  return {
    term: article.term || "",
    paragraphs: article.paragraphs.slice(),
    sources: [...new Set((article.sources || []).map((s) => s.provenance).filter(Boolean))],
    facts,
    factCount: (article.detail && Number.isInteger(article.detail.factCount)) ? article.detail.factCount : facts.length,
  };
}
