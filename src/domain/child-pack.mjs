// child-pack.mjs — the pure half of the shipped CHILD triples pack
// (corpus/child/): the shard naming contract, the index/row shape validators
// every writer and reader share, and the provenance tag a fact learned from the
// pack carries. The pack itself is gzipped JSONL shards plus a gzipped term
// index; loading them is I/O and lives in src/adapters/corpus/child-pack.mjs.
//
// The pack is a lazy learn-on-miss reference the clean-miss cascade consults:
// on a miss for term T the loader returns T's ConceptNet triples, and the chat
// hook appends them to memory (see childProvenanceTag). It mirrors the reference
// pack's on-disk shape (index -> one shard per hit) but carries TRIPLES, not
// article prose — so its row is a list of {subject, predicate, object} facts,
// already mapped through conceptnet-map.toml into tmct's predicate vocabulary.

import { fnv1aHex, normFactTerm } from "./hash.mjs";

export const CHILD_PACK_NAME = "conceptnet";
export const CHILD_SHARD_COUNT = 32;

/** The shard a term's triples row lives in: FNV-1a first byte mod 32, as the
 *  file basename "child-00" … "child-1f". Part of the pack's on-disk contract —
 *  the build script shards with THIS function, so the reader never scans. The
 *  term is normFactTerm-folded first, so the key the index stores and the key a
 *  clean-miss lookup computes are the same spelling. */
export function shardNameFor(term) {
  const byte = parseInt(fnv1aHex(normFactTerm(term)).slice(0, 2), 16);
  return `child-${(byte % CHILD_SHARD_COUNT).toString(16).padStart(2, "0")}`;
}

const SHARD_NAME_RE = /^child-[0-1][0-9a-f]$/;

/** An index entry {s, t, n}: the shard holding the row, the row's canonical
 *  term key (a normFactTerm fixed point), and the fact count (a positive
 *  integer, so a zero-fact row can never be indexed). */
export function isChildIndexEntry(e) {
  return !!e && typeof e === "object"
    && typeof e.s === "string" && SHARD_NAME_RE.test(e.s)
    && typeof e.t === "string" && e.t.length > 0
    && Number.isInteger(e.n) && e.n > 0;
}

/** One triple in a row: {subject, predicate, object, weight?}. subject/object
 *  are human terms ("penguin", "bird"); predicate is a tmct vocabulary URI
 *  ("rdfs:subClassOf", "mgx:capableOf", "mgxneg:capableOf"). weight, when
 *  present, is the ConceptNet edge weight (a positive number). */
export function isChildFact(f) {
  if (!f || typeof f !== "object") return false;
  for (const field of ["subject", "predicate", "object"]) {
    if (typeof f[field] !== "string" || !f[field]) return false;
  }
  if (f.weight !== undefined && !(typeof f.weight === "number" && Number.isFinite(f.weight) && f.weight > 0)) return false;
  return true;
}

/** A shard row: {term, facts: [ChildFact, …]} — the term's edges, at least one,
 *  every one a valid ChildFact that actually touches the term (as subject or
 *  object, once normalised). */
export function isChildFactsRow(row) {
  if (!row || typeof row !== "object") return false;
  if (typeof row.term !== "string" || !row.term) return false;
  if (!Array.isArray(row.facts) || row.facts.length === 0) return false;
  for (const f of row.facts) {
    if (!isChildFact(f)) return false;
    if (normFactTerm(f.subject) !== row.term && normFactTerm(f.object) !== row.term) return false;
  }
  return true;
}

/** The provenance tag a fact stored from a child-pack lookup carries. The chat
 *  hook stamps every fact it appends from term T's row with THIS tag;
 *  memory/trust.mjs parses it back to a corpus-tier Source ({kind:"corpus",
 *  name:"conceptnet"}) — the child slice is curated ConceptNet, scored at the
 *  0.7 corpus prior. The term segment records which miss pulled the fact in, so
 *  a fact's origin shard stays auditable on its factProvenance string even
 *  though the Source it corroborates is the shared ConceptNet corpus. */
export function childProvenanceTag(term) {
  return `${CHILD_PROVENANCE_PREFIX}${CHILD_PACK_NAME}:${normFactTerm(term)}`;
}

export const CHILD_PROVENANCE_PREFIX = "child:";
