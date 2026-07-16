// hash.mjs — the single home for tmct's content-address contract: the FNV-1a
// hash, the fact-term/predicate normalization, and the fact-id derivation.
//
// FNV-1a 32-bit is deliberately home-grown: it must be synchronous, browser-safe,
// dependency-free, and — critically — CROSS-VERSION STABLE, because fact ids are
// content-addressed by it and a fact's id is its identity across the whole memory
// graph. Every library candidate fails at least one of those; this eight-line
// function fails none. Normalization lives beside it because it is PART of that
// identity: the same (s, p, o) must normalize and hash to the same id from every
// writer, so the whole contract has exactly one definition.

/** FNV-1a 32-bit. Returns the unsigned 32-bit integer (0 … 2^32−1). */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a 32-bit as a zero-padded 8-char hex string — the stable content-address
 *  used for fact ids (`fact:<hex>`). Same (s,p,o) → same id → upsert, never a dup. */
export function fnv1aHex(str) {
  return fnv1a32(str).toString(16).padStart(8, "0");
}

const TEXT_CAP = 2000;   // an utterance's stored text (a whole answer fits; a pasted book doesn't)

/** Whitespace-collapse + cap a stored text/predicate string. Every writer that
 *  feeds the fact-id hash uses THIS normalization, so id identity never depends
 *  on which module did the writing. */
export const normText = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_CAP);

/** Normalize a fact TERM (subject/object) so every writer converges on one
 *  spelling: ConceptNet's /c/en/foo_bar, tmct:Foo_bar, and bare "Foo bar" all
 *  become "foo bar". Also strips a leading "the"/"a"/"an" (idempotent — safe
 *  for storage too). The predicate is never normalized this way — its casing
 *  is meaningful controlled vocabulary. */
export function normFactTerm(t) {
  let s = normText(t);
  s = s.replace(/^\/c\/[a-z]{2,3}\//i, "");
  s = s.replace(/^[a-z][\w.-]*:/i, "");
  s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:the|an?)\s+/i, "");
  return s.toLowerCase();
}

/** A Fact is content-addressed by its NUL-delimited (s, p, o) — NUL never
 *  occurs in a normalized term/predicate, so it's collision-proof unlike a
 *  space. Takes ALREADY-normalized parts; factIdForTriple normalizes first. */
export const factIdFor = (s, p, o) => `fact:${fnv1aHex(`${s}\0${p}\0${o}`)}`;

/** Content-address a fact's id from (subject, predicate, object) without
 *  writing it — same contract as factIdFor. Lets a caller (e.g.
 *  syllogise.mjs's retraction machinery) name a not-yet-written fact's id
 *  deterministically, without an extra read. Pure, no I/O. */
export function factIdForTriple(subject, predicate, object) {
  return factIdFor(normFactTerm(subject), normText(predicate), normFactTerm(object));
}
