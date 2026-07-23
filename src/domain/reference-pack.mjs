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

// ---- the live Wikipedia supplement (opt-in): the pure half -----------------

export const LIVE_PACK_NAME = "wikipedia-live";

/** The provenance tag a fact stored from a LIVE Wikipedia article carries —
 *  the same reference:<pack>:<article>@<revid> shape the shipped pack uses,
 *  so memory/trust.mjs parses it with no change: kind "reference", pack
 *  "wikipedia-live". */
export function liveProvenanceTag(article) {
  return `reference:${LIVE_PACK_NAME}:${article.title}@${article.revid}`;
}

/** The cited answer for a clean miss the live lookup could ground: the
 *  article's summary with its title, the LIVE source named, the licence and
 *  the revision-pinned URL always visible. */
export function renderLiveReferenceAnswer(term, article) {
  return `${term} — ${article.summary} (source: live Wikipedia article "${article.title}", `
    + `English Wikipedia, CC BY-SA 4.0 — ${article.url}?oldid=${article.revid})`;
}

/** The pure half of the LIVE clean-miss gate — same fold, shape check and
 *  RELATION_TERM exclusion as cleanMissReferenceTerm, but WITHOUT the
 *  lexicon-membership wall: a word the lexicon has never met is exactly what
 *  a live lookup is for. A known lexicon entry still resolves to its lemma
 *  (so "otters" and "otter" share one key); an unknown word keys on its own
 *  folded form. Capped at three words — longer phrases are never a clean
 *  vocabulary miss. */
export function cleanMissLiveTerm(term, lexicon = loadLexicon()) {
  const t = normFactTerm(term);
  if (!t || !/^[a-z][a-z' -]*$/.test(t)) return null;
  if (RELATION_TERM[t]) return null;
  if (t.split(/\s+/).length > 3) return null;
  const entry = lookupNoun(lexicon, t);
  return entry ? normFactTerm(entry.lemma) : t;
}

// ---- summary/isa extraction, shared by the pack build and the live lookup --

export const SUMMARY_CHAR_CAP = 400;

/** Whole leading sentences of `text` up to `cap` chars; a first sentence
 *  longer than the cap is hard-cut at it. */
export function sentencesUpTo(text, cap) {
  const parts = String(text ?? "").split(/(?<=[.!?])\s+/);
  let out = "";
  for (const part of parts) {
    const candidate = out ? `${out} ${part}` : part;
    if (candidate.length > cap) break;
    out = candidate;
  }
  return out || String(text ?? "").slice(0, cap);
}

const ISA_RE = /^[A-Z][^.!?]{0,80}? (?:is|are) (?:(a|an|the) )?([a-z][a-z -]{1,60})/;

// Words that end the noun phrase: a relative clause or a trailing modifier
// carries detail, not the category ("a place where ships shelter" → place).
const ISA_CLAUSE_CUT = new Set([
  "that", "which", "where", "who", "whose", "whom", "when", "used", "found",
  "made", "with", "in", "on", "for", "from", "by", "to", "and", "or",
]);
// Classifier heads carry no category of their own ("a member of the cat
// family" names family membership, not what the thing is) — no isa beats a
// generic one, because a stored subClassOf must stay meaningful.
const ISA_GENERIC_HEADS = new Set([
  "type", "kind", "sort", "form", "class", "variety", "group", "part",
  "piece", "member", "way", "term", "name", "word", "thing", "example",
  "family", "genus", "species", "unit", "series", "set", "list", "number",
  "amount", "body", "mass",
]);
const ISA_ARTICLES = new Set(["a", "an", "the"]);
// The classifier heads an of-chain reads THROUGH to the real class ("a kind
// of dog" → dog). Any other head before "of" keeps the outer phrase: "a body
// of ice" states composition, and "a game of skill" is a game — neither
// makes the of-object the class.
const ISA_OF_READ_THROUGH = new Set([
  "type", "kind", "sort", "form", "class", "variety", "species", "breed", "genus",
]);

/** The isa lemma of a lead's first sentence, or null. The copula must sit in
 *  the first sentence; an of-chain resolves to its final noun ("a kind of
 *  dog" → dog); a bare-plural predicate counts only when the head is an
 *  inflected plural the lexicon folds ("are animals that…" → animal, but
 *  "is light" stays null); a generic classifier head is no isa at all. */
export function isaOf(plain, lexicon) {
  const m = String(plain ?? "").match(ISA_RE);
  if (!m) return null;
  const bare = !m[1];
  const window = [];
  for (const word of m[2].trim().split(/\s+/)) {
    if (ISA_CLAUSE_CUT.has(word)) break;
    window.push(word);
    if (window.length >= 6) break;
  }
  let headWords = window;
  for (let ofIdx = headWords.indexOf("of"); ofIdx > 0; ofIdx = headWords.indexOf("of")) {
    const outer = headWords[ofIdx - 1]?.split("-").pop();
    if (outer && ISA_OF_READ_THROUGH.has(outer)) { headWords = headWords.slice(ofIdx + 1); continue; }
    headWords = headWords.slice(0, ofIdx);
    break;
  }
  while (headWords.length && ISA_ARTICLES.has(headWords[0])) headWords = headWords.slice(1);
  if (!headWords.length) return null;
  const headToken = headWords[headWords.length - 1].split("-").pop();
  if (!headToken || ISA_GENERIC_HEADS.has(headToken)) return null;
  const entry = lookupNoun(lexicon, headToken);
  if (!entry) return null;
  const lemma = normFactTerm(entry.lemma);
  // A bare predicate ("is light") is only trusted when the head is an
  // inflected plural the lexicon folded back to its lemma.
  if (bare && (!/s$/.test(headToken) || normFactTerm(headToken) === lemma)) return null;
  return lemma;
}
