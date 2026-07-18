// reference-pack.mjs — the pure half of the shipped reference pack: the shard
// naming contract, the index/row shape validators every writer and reader
// share, the cited answer line, the provenance tag, and the pure part of the
// clean-miss gate. The pack itself is 64 gzipped JSONL shards plus a gzipped
// term index; loading them is I/O and lives in
// src/adapters/corpus/reference-pack.mjs.

import { fnv1aHex, normFactTerm } from "./hash.mjs";
import { loadLexicon, lookupNoun } from "./grammar/lexicon.mjs";
import { RELATION_TERM } from "./concept.mjs";

export const REFERENCE_PACK_NAME = "simplewiki";
export const REFERENCE_SHARD_COUNT = 64;

/** The shard a term's article row lives in: FNV-1a first byte mod 64, as the
 *  file basename "ref-00" … "ref-3f". Part of the pack's on-disk contract —
 *  the build script shards with THIS function, so the reader never scans. */
export function shardNameFor(term) {
  const byte = parseInt(fnv1aHex(String(term ?? "")).slice(0, 2), 16);
  return `ref-${(byte % REFERENCE_SHARD_COUNT).toString(16).padStart(2, "0")}`;
}

const SHARD_NAME_RE = /^ref-[0-3][0-9a-f]$/;

/** An index entry {s, t, r}: the shard holding the row, the row's canonical
 *  term key (an alias entry points at its target's), and the revision id. */
export function isReferenceIndexEntry(e) {
  return !!e && typeof e === "object"
    && typeof e.s === "string" && SHARD_NAME_RE.test(e.s)
    && typeof e.t === "string" && e.t.length > 0
    && Number.isInteger(e.r) && e.r > 0;
}

/** A shard row: {term, title, text, summary, url, revid, isa?}. */
export function isReferenceArticleRow(row) {
  if (!row || typeof row !== "object") return false;
  for (const field of ["term", "title", "text", "summary", "url"]) {
    if (typeof row[field] !== "string" || !row[field]) return false;
  }
  if (!Number.isInteger(row.revid) || row.revid <= 0) return false;
  if (row.isa !== undefined && (typeof row.isa !== "string" || !row.isa)) return false;
  return true;
}

/** The cited answer for a clean miss the pack could ground: the article's
 *  summary with its title, licence and revision-pinned URL always visible. */
export function renderReferenceAnswer(term, article) {
  return `${term} — ${article.summary} (source: reference article "${article.title}", `
    + `Simple English Wikipedia, CC BY-SA 4.0 — ${article.url}?oldid=${article.revid})`;
}

/** The provenance tag a fact stored from a pack article carries —
 *  memory/trust.mjs parses it back to { kind:"reference", pack, article }. */
export function referenceProvenanceTag(article) {
  return `reference:${REFERENCE_PACK_NAME}:${article.title}@${article.revid}`;
}

/** The pure half of the clean-miss gate: is this term even a pack-lookup
 *  candidate, and under which key? Returns the pack key (the lexicon entry's
 *  lemma, normFactTerm-folded) or null when the term is empty, not plain
 *  words, a vague relation touch (RELATION_TERM owns those), or not in the
 *  lexicon at all — an unknown word is never a clean miss. The async half of
 *  the gate (parse succeeded, graph/memory genuinely empty on the term) stays
 *  with the caller. */
export function cleanMissReferenceTerm(term, lexicon = loadLexicon()) {
  const t = normFactTerm(term);
  if (!t || !/^[a-z][a-z' -]*$/.test(t)) return null;
  if (RELATION_TERM[t]) return null;
  const entry = lookupNoun(lexicon, t);
  if (!entry) return null;
  return normFactTerm(entry.lemma);
}
