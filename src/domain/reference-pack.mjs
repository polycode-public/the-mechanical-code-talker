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

/** The grain cue every encyclopedia-grounded answer carries: this is a word's
 *  general meaning, not something read out of the graph the session is about. */
export const GENERAL_VOCABULARY_CUE = "General vocabulary, not from this codebase.";

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

/** A shard row: {term, title, text, summary, url, revid, isa?, source?,
 *  licence?}. `source`/`licence` are optional per-entry overrides of the
 *  citation's source name and licence line (renderReferenceAnswer, below) —
 *  absent on every real Simple English Wikipedia row the build pipeline
 *  emits, present only on a hand-added synthetic entry (e.g. a demo/test
 *  term) whose citation must name its OWN real source, not Wikipedia's. */
export function isReferenceArticleRow(row) {
  if (!row || typeof row !== "object") return false;
  for (const field of ["term", "title", "text", "summary", "url"]) {
    if (typeof row[field] !== "string" || !row[field]) return false;
  }
  if (!Number.isInteger(row.revid) || row.revid <= 0) return false;
  for (const field of ["isa", "source", "licence"]) {
    if (row[field] !== undefined && (typeof row[field] !== "string" || !row[field])) return false;
  }
  return true;
}

/** The default citation source/licence — every article the build pipeline
 *  (scripts/fetch-reference-pack.mjs) emits from the pinned Simple English
 *  Wikipedia dump carries neither field, so this is what renderReferenceAnswer
 *  falls back to for the overwhelming majority of rows. */
export const DEFAULT_REFERENCE_SOURCE = "Simple English Wikipedia";
export const DEFAULT_REFERENCE_LICENCE = "CC BY-SA 4.0";

/** The cited answer for a clean miss the pack could ground: the article's
 *  summary with its title, licence and source always visible, then the grain
 *  cue. Without the cue a reader has to recognize the source name to tell
 *  this apart from a fact read out of their own graph — both answer the same
 *  "what is X" question in the same voice.
 *
 *  The source/licence line reads the article's OWN `source`/`licence` fields
 *  when present, falling back to the Wikipedia defaults otherwise — every
 *  real pack row renders byte-identically to before this existed. Wikipedia's
 *  revision-pinned `?oldid=` query is a convention of that source alone, so it
 *  is only appended when the article is citing the default source; a
 *  non-Wikipedia entry's own `url` is shown bare. */
export function renderReferenceAnswer(term, article) {
  const source = article.source ?? DEFAULT_REFERENCE_SOURCE;
  const licence = article.licence ?? DEFAULT_REFERENCE_LICENCE;
  const url = source === DEFAULT_REFERENCE_SOURCE ? `${article.url}?oldid=${article.revid}` : article.url;
  return `${term} — ${article.summary} (source: reference article "${article.title}", `
    + `${source}, ${licence} — ${url})`
    + ` ${GENERAL_VOCABULARY_CUE}`;
}

/** The provenance tag a fact stored from a pack article carries —
 *  memory/trust.mjs parses it back to { kind:"reference", pack, article }. */
export function referenceProvenanceTag(article) {
  return `reference:${REFERENCE_PACK_NAME}:${article.title}@${article.revid}`;
}

/** Wikimedia titles are underscored and percent-encoded in a wiki URL. The
 *  build script (scripts/fetch-reference-pack.mjs) stamps every shipped row's
 *  `url` with this, and referenceTagToUrl below rebuilds the same link from a
 *  stored fact's provenance tag. */
export const REFERENCE_PACK_ORIGIN = "https://simple.wikipedia.org";

export function articleUrlFor(origin, title) {
  return `${origin}/wiki/${encodeURIComponent(String(title).replace(/ /g, "_"))}`;
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

export const LIVE_PACK_ORIGIN = "https://en.wikipedia.org";
const ORIGIN_BY_PACK = new Map([
  [REFERENCE_PACK_NAME, REFERENCE_PACK_ORIGIN],
  [LIVE_PACK_NAME, LIVE_PACK_ORIGIN],
]);

/**
 * The revision-pinned article a `reference:<pack>:<Title>@<revid>` provenance
 * tag names: `{ pack, title, revid, url }`, or null. Null covers every tag
 * this cannot place — a tag from another source kind, a pack with no known
 * origin, a missing or non-numeric revision — because a consumer showing
 * provenance needs a link it can follow or nothing at all, never one assembled
 * out of a guess about where the article might live.
 *
 * The `?oldid=` query pins the revision the fact was read from, exactly as
 * renderReferenceAnswer cites it in chat.
 */
export function referenceTagToUrl(tag) {
  const t = String(tag ?? "").trim();
  if (!t.startsWith("reference:")) return null;
  const rest = t.slice("reference:".length);
  const colon = rest.indexOf(":");
  if (colon < 0) return null;
  const origin = ORIGIN_BY_PACK.get(rest.slice(0, colon));
  if (!origin) return null;
  // The article segment keeps its spaces and may contain "@" itself, so the
  // revision splits off the LAST one and only counts when it is all digits.
  const article = rest.slice(colon + 1);
  const at = article.lastIndexOf("@");
  if (at < 1) return null;
  const revid = article.slice(at + 1);
  if (!/^\d+$/.test(revid)) return null;
  const title = article.slice(0, at);
  return { pack: rest.slice(0, colon), title, revid, url: `${articleUrlFor(origin, title)}?oldid=${revid}` };
}

/** The cited answer for a clean miss the live lookup could ground: the
 *  article's summary with its title, the LIVE source named, the licence and
 *  the revision-pinned URL always visible. */
export function renderLiveReferenceAnswer(term, article) {
  return `${term} — ${article.summary} (source: live Wikipedia article "${article.title}", `
    + `English Wikipedia, CC BY-SA 4.0 — ${article.url}?oldid=${article.revid})`
    + ` ${GENERAL_VOCABULARY_CUE}`;
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

// The preamble before the copula is bounded only by the sentence itself
// (no "is"/"are" can cross a ".", "!" or "?"), not by a fixed character
// count — an appositive list ("also called cougars, mountain lions, …")
// can push the real copula well past what a short cap would reach.
const ISA_RE = /^[A-Z][^.!?]*? (?:is|are) (?:(a|an|the) )?([a-z][a-z -]{1,60})/;

// A "(…)" aside breaks the plain-lowercase word class ISA_RE's capture group
// matches against, and can itself push the real copula past any fixed cap —
// so every parenthetical is dropped before matching, not just accounted for
// in the cap. Applied to the whole string: a later sentence's own aside
// never reaches back to move the first sentence's boundary.
function withoutParentheticals(text) {
  let out = text;
  let prior;
  do {
    prior = out;
    out = out.replace(/\s*\([^()]*\)/g, "");
  } while (out !== prior);
  return out;
}

// Words that end the noun phrase: a relative clause or a trailing modifier
// carries detail, not the category ("a place where ships shelter" → place).
// "about"/"around"/"roughly"/"approximately" open a comparison or a topic
// that reads like more of the head phrase but is not ("a small marsupial
// about the size of a large cat" is a marsupial, not a size; "a book about
// dogs" is a book).
const ISA_CLAUSE_CUT = new Set([
  "that", "which", "where", "who", "whose", "whom", "when", "used", "found",
  "made", "with", "in", "on", "for", "from", "by", "to", "and", "or",
  "about", "around", "roughly", "approximately",
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
// makes the of-object the class. Partitive, collective and measure heads
// ("a group of animals", "a piece of matter", "an accumulation of vegetation")
// read through the same way — the of-object names the class, the head names
// only how much of it or how it is packaged. "member" and "body" are the
// deliberate exceptions: "a member of the cat family" and "a body of water"
// name membership or composition, not what the thing is, so they stay off
// this set and fall through to ISA_GENERIC_HEADS' null instead.
const ISA_OF_READ_THROUGH = new Set([
  "type", "kind", "sort", "form", "class", "variety", "species", "breed", "genus",
  "group", "part", "parts", "piece", "bunch", "bit", "name", "set", "way", "unit", "family",
  "ability", "color", "series", "mammal", "practice", "list", "amount", "mass",
  "reworking", "blockage", "goddess", "aura", "development", "consisting",
  "announcement", "messengers", "subset", "carrying", "photograph", "adding",
  "use", "science", "songbird", "symptom", "accumulation", "number", "suborder",
  "falling", "management", "evaluation", "superorder", "activity", "interlacing",
  "introduction",
]);
// A quantifier naming a share of a set ("either of two species", "one of
// several kinds") is never itself the class — it has no noun reading at all
// — so the of-chain reads through it the same way it reads through a
// classifier head, on to whatever the rest of the chain names.
const ISA_OF_QUANTIFIER = new Set(["either", "one", "each", "both", "any"]);

/** The isa lemma of a lead's first sentence, or null. The copula must sit in
 *  the first sentence; a parenthetical aside is skipped, not read as part of
 *  the class; an of-chain resolves to its final noun ("a kind of dog" →
 *  dog; "either of two species (…) of rodents" → rodent); a bare-plural
 *  predicate counts only when the head is an inflected plural the lexicon
 *  folds ("are animals that…" → animal, but "is light" stays null); a
 *  generic classifier head is no isa at all. */
// A classifier/quantifier/generic-head word can appear inflected ("kinds of
// dog", "sets of threads") — the sets above hold singular forms, so every
// membership check folds the word through the lexicon to its lemma first.
// An unresolvable word (the quantifiers are not nouns at all) falls back to
// itself unchanged, so the raw-string check still applies.
function classifierKeyFor(word, lexicon) {
  const entry = lookupNoun(lexicon, word);
  return entry ? normFactTerm(entry.lemma) : word;
}

export function isaOf(plain, lexicon) {
  const m = withoutParentheticals(String(plain ?? "")).match(ISA_RE);
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
    const outerKey = outer && classifierKeyFor(outer, lexicon);
    if (outerKey && (ISA_OF_READ_THROUGH.has(outerKey) || ISA_OF_QUANTIFIER.has(outerKey))) { headWords = headWords.slice(ofIdx + 1); continue; }
    headWords = headWords.slice(0, ofIdx);
    break;
  }
  while (headWords.length && ISA_ARTICLES.has(headWords[0])) headWords = headWords.slice(1);
  if (!headWords.length) return null;
  const headToken = headWords[headWords.length - 1].split("-").pop();
  if (!headToken) return null;
  const headKey = classifierKeyFor(headToken, lexicon);
  if (ISA_GENERIC_HEADS.has(headToken) || ISA_GENERIC_HEADS.has(headKey)) return null;
  const entry = lookupNoun(lexicon, headToken);
  if (!entry) return null;
  const lemma = normFactTerm(entry.lemma);
  // A bare predicate ("is light") is only trusted when the head is an
  // inflected plural the lexicon folded back to its lemma.
  if (bare && (!/s$/.test(headToken) || normFactTerm(headToken) === lemma)) return null;
  return lemma;
}
