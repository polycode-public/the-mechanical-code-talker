// digest/index.mjs — the digest layer's public seam: run the pure pipeline
// (select -> structures -> compose -> article) end to end. Stage 5 (the chat
// term answer, the research panel, `tmct digest`) becomes thin wiring over
// this: build the fact rows and the store statistics from the graph it already
// holds, hand them in, and render the returned article shape.
//
// Everything here is pure and deterministic. The structure table arrives
// pre-parsed (the same injection posture the construction banks use), so this
// module — and the whole layer — imports nothing outside src/domain.

import { selectFacts, FAMILY_OF, FAMILY_PRIORITY } from "./select.mjs";
import { buildStructureTable, renderStructure } from "./structures.mjs";
import { composeTermDigest } from "./compose.mjs";
import { termArticle, researchRunArticle, sessionDigestArticle } from "./article.mjs";

export { selectFacts, FAMILY_OF, FAMILY_PRIORITY };
export { buildStructureTable, renderStructure };
export { composeTermDigest };
export { termArticle, researchRunArticle, sessionDigestArticle };

/**
 * Digest one term end to end.
 *
 * @param term    the normalized term the digest is about.
 * @param rows    its candidate fact rows (readFactRows() rows with subject===term).
 * @param store   the store-relative statistics selectFacts() needs
 *                ({ classSubjectCounts, totalSubjects, subClassEdges, disjointEdges }).
 * @param table   a structure table (buildStructureTable() over the parsed bank).
 * @param opts    { budget, config, chains, maxSentencesPerParagraph } — threaded
 *                to the stages that use them.
 * @returns the term-article shape, carrying the narrative, its sources, and the
 *          full fact list behind the "show the facts" escape.
 */
export function digestTerm(term, rows, store = {}, table = new Map(), opts = {}) {
  const selection = selectFacts(term, rows, store, opts);
  const composed = composeTermDigest(selection, table, opts);
  return termArticle(selection, composed, opts);
}
