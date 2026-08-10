// corpus/simple-wikipedia-pack.mjs — the offline research source: the SAME
// shipped reference pack the reference lane serves
// (src/domain/reference-pack.mjs's shape, src/adapters/corpus/
// reference-pack.mjs's lazy fs loader), read as a research-source.mjs
// adapter so "research <topic>" can ground a turn with no network at all.
//
// Registered under its own name, "simple-wikipedia-pack" — deliberately
// distinct from the live "simple-wikipedia" source, so a fact stamped
// through researchFacts() (the news lane, the contract tests) still tells
// the pack apart from a live fetch at the provenance-tag layer. The
// interactive "research <topic>" chat lane stamps its own source-agnostic
// research:<topic>@<depth> tag regardless of which source grounded the
// turn (src/services/research.mjs); that tag is unaffected by this module
// and stays exactly as it already is for every other research source.
//
// "Linked" topics: the pack carries no link graph, so linkedTitles reads the
// pack's OWN cross-references instead — other terms the pack's index
// already knows, found as whole words inside this article's text, in the
// order they first occur. It is the offline analogue of a live source's
// lead-section links, built entirely from data already on disk.
//
// No network, ever — every read goes through the pack's own lazy, cached fs
// loader. Node-only, unlike the browser-shipped live adapters: the pack's fs
// layout is not available in the browser bundle, so this module is not
// imported there.

import { normFactTerm } from "../../domain/hash.mjs";
import { loadLexicon, lookupNoun } from "../../domain/grammar/lexicon.mjs";
import { isContentToken } from "../../domain/prose.mjs";
import { isReferenceArticleRow } from "../../domain/reference-pack.mjs";
import { loadReferenceIndex, loadReferenceArticle, referencePackDir } from "./reference-pack.mjs";
import { registerResearchSource, researchSourceTag } from "./research-source.mjs";

export const SIMPLE_WIKIPEDIA_PACK_ORIGIN = "https://simple.wikipedia.org";
export const SIMPLE_WIKIPEDIA_PACK_SOURCE_NAME = "simple-wikipedia-pack";

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
const MAX_LINKED_TITLES = 25;

/** A text word folded to the pack index's own key: the lexicon's lemma when
 *  the word is a known noun ("birds" -> "bird"), else its own normFactTerm
 *  fold — the same fallback reference-pack.mjs's isaOf extraction uses. */
function packIndexKey(word, lexicon) {
  const entry = lookupNoun(lexicon, word);
  return entry ? normFactTerm(entry.lemma) : normFactTerm(word);
}

const capitalize = (key) => key.charAt(0).toUpperCase() + key.slice(1);

/** Other pack terms this article's text mentions, in the order they first
 *  occur, excluding the article's own term. The pack's index keys an alias
 *  ("prey") on whatever article it redirects to ("predator"), and carries no
 *  reverse title index — so the WORD found in the text, not that article's
 *  own (possibly unrelated-looking) title, is what round-trips back through
 *  lookup()/pageByTitle() correctly; capitalized for display only, since
 *  normFactTerm folds case away on the way back in. Every candidate is
 *  confirmed against a real row before it queues, so a stale index entry
 *  never queues a fetch that would fail. */
function packLinkedTitles(dir, text, ownKey, index, lexicon, limit) {
  if (!index || limit <= 0) return [];
  const seen = new Set([ownKey]);
  const out = [];
  for (const match of String(text ?? "").matchAll(WORD_RE)) {
    if (out.length >= limit) break;
    const key = packIndexKey(match[0], lexicon);
    if (!key || !isContentToken(key) || seen.has(key) || !index[key]) continue;
    seen.add(key);
    if (!loadReferenceArticle(dir, key)) continue;
    out.push(capitalize(key));
  }
  return out;
}

/**
 * The offline pack-backed research source: { name, origin, lookup(term),
 * pageByTitle(title), linkedTitles(title, {limit}), provenanceTag(term) } —
 * the research-source.mjs contract, satisfied entirely from the shipped
 * reference pack on disk.
 *
 * `dir` defaults to the pack's own resolution order (TMCT_REFERENCE_PACK_DIR
 * env, else the package's shipped corpus/reference/ — referencePackDir()).
 * `lexicon` defaults to the shared lexicon, lazily loaded and cached the same
 * way every other reference/research reader does.
 */
export function createSimpleWikipediaPackSource({
  dir,
  lexicon = null,
  sourceName = SIMPLE_WIKIPEDIA_PACK_SOURCE_NAME,
} = {}) {
  const packDir = dir || referencePackDir();
  let lex = lexicon;
  function activeLexicon() {
    if (lex) return lex;
    try { lex = loadLexicon(); } catch { lex = null; }
    return lex;
  }

  function rowFor(term) {
    const key = normFactTerm(term ?? "");
    if (!key) return null;
    const article = loadReferenceArticle(packDir, key);
    if (!article) return null;
    const row = { ...article, term: key };
    return isReferenceArticleRow(row) ? row : null;
  }

  return {
    name: sourceName,
    origin: SIMPLE_WIKIPEDIA_PACK_ORIGIN,

    provenanceTag(term) {
      return researchSourceTag(sourceName, term);
    },

    async lookup(term) {
      return rowFor(term);
    },

    /** The pack row for an exact title — the pack's own term index already
     *  resolves a title's canonical key in one lookup, so this is the same
     *  read `lookup` performs, no round trip either way. */
    async pageByTitle(title) {
      return rowFor(title);
    },

    async linkedTitles(title, { limit = MAX_LINKED_TITLES } = {}) {
      const article = rowFor(title);
      if (!article) return null;
      const index = loadReferenceIndex(packDir);
      return packLinkedTitles(packDir, article.text, article.term, index, activeLexicon(), Math.max(0, limit));
    },
  };
}

registerResearchSource({
  name: SIMPLE_WIKIPEDIA_PACK_SOURCE_NAME,
  create: createSimpleWikipediaPackSource,
});
