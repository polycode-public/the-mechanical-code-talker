// domain/p2p/facts.mjs — the small set of new predicates the P2P layer
// introduces on top of the existing memory store's triple shape, plus pure
// constructors for each. Every one is a plain add-only fact, replicated the
// same way any other fact is (appendFacts' own union-by-id behavior) — no
// new CRDT primitive. Provenance uses the existing `ace:` tag shape
// (`ace:p2p:<id>@<ts>`) so trust.mjs's own parser reads it with no changes
// there: stripped of its `ace:` prefix it reads as `p2p:<id>@<ts>`, which
// parses to { kind: "operator", sessionId: "p2p:<id>", createdAt: <ts> }.
import { provenanceTagToSource } from "../memory/trust.mjs";

export const WORLD_NAME_PREDICATE = "mgx:worldName";
export const NODE_NAME_PREDICATE = "mgx:nodeName";
export const PLAYED_BY_PREDICATE = "mgx:playedBy";
export const WAVED_PREDICATE = "mgx:waved";

export const P2P_PREDICATES = Object.freeze([
  WORLD_NAME_PREDICATE,
  NODE_NAME_PREDICATE,
  PLAYED_BY_PREDICATE,
  WAVED_PREDICATE,
]);

const provenanceFor = (id, timestamp) => `ace:p2p:${id}@${timestamp}`;

export function worldNameFact(worldId, name, timestamp) {
  return { subject: worldId, predicate: WORLD_NAME_PREDICATE, object: name, provenance: provenanceFor(worldId, timestamp) };
}

export function nodeNameFact(peerId, name, timestamp) {
  return { subject: `peer:${peerId}`, predicate: NODE_NAME_PREDICATE, object: name, provenance: provenanceFor(peerId, timestamp) };
}

export function playedByFact(characterId, peerId, timestamp) {
  return { subject: characterId, predicate: PLAYED_BY_PREDICATE, object: `peer:${peerId}`, provenance: provenanceFor(characterId, timestamp) };
}

export function waveFact(characterId, roomId, timestamp) {
  return { subject: characterId, predicate: WAVED_PREDICATE, object: roomId, provenance: provenanceFor(`${characterId}-${roomId}`, timestamp) };
}

/** The newest asserted-at timestamp across every " | "-joined segment of a
 *  fact's provenance — the correct read for "when was this most recently
 *  true," since a repeat wave unions a fresh tag onto the SAME fact id
 *  (same subject/predicate/object) rather than minting a new row. Returns
 *  null if no segment parses to a timestamp at all. */
export function latestProvenanceTimestamp(provenance) {
  const tag = String(provenance || "");
  if (!tag) return null;
  let latest = null;
  for (const segment of tag.split(" | ")) {
    const source = provenanceTagToSource(segment);
    const at = source?.createdAt ? Date.parse(source.createdAt) : NaN;
    if (!Number.isNaN(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/** "Currently waving" is a read-time recency question, never a retraction —
 *  a wave fact older than the window just stops being read as current, with
 *  nothing ever deleted from the graph. */
export function isRecentWave(waveFactRow, nowMs, windowMs = 8000) {
  const at = latestProvenanceTimestamp(waveFactRow?.provenance);
  if (at === null) return false;
  const age = nowMs - at;
  return age >= 0 && age <= windowMs;
}

/** The latest-by-timestamp fact for a subject+predicate pair — the "current
 *  value" read for an add-only, no-retraction fact like a node's own name
 *  or which peer plays a character (first-claim-wins uses the OLDEST of
 *  these instead; see playedByFact's own caller for that distinction). */
export function latestFact(rows, subject, predicate) {
  let best = null;
  let bestAt = -Infinity;
  for (const row of rows) {
    if (row.subject !== subject || row.predicate !== predicate) continue;
    const at = latestProvenanceTimestamp(row.provenance) ?? -Infinity;
    if (at > bestAt) { best = row; bestAt = at; }
  }
  return best;
}
