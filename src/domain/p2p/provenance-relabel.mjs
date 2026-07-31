// domain/p2p/provenance-relabel.mjs — rewrites a fact's outgoing provenance
// tag before it's broadcast to peers, so "who taught this" reads as a node
// name rather than a local session id. Only teach/operator-kind tags are
// touched; a mud world/testimony tag is already attributed to the world or
// the character that made it, not the person at the keyboard, and rewriting
// it would lose information rather than add it.
import { provenanceTagToSource } from "../memory/trust.mjs";

const RELABELED_KINDS = new Set(["teach", "operator"]);

/** The outgoing tag for one fact this node is asserting. The `#node:<id>`
 *  segment is what makes the origin identifiable across reconnects and
 *  renames: a display name is user-chosen and collidable, and a peer id is
 *  minted fresh per connection, so neither keys a node over its own lifetime.
 *  A node with no id yet emits the older segment-free shape, which every
 *  reader still parses. */
export function peerProvenanceTag(displayName, timestamp, nodeId = "") {
  const node = nodeId ? `#node:${nodeId}` : "";
  return `teach:peer:${displayName}${node}@${timestamp}`;
}

/** `provenance` may already be a " | "-joined union of several tags (the
 *  same fact taught more than once, from different sources) — relabel each
 *  segment independently and rejoin, so a segment this peer didn't author
 *  passes through untouched. */
export function relabelForBroadcast(provenance, myDisplayName, timestamp, myNodeId = "") {
  const tag = String(provenance || "");
  if (!tag) return tag;
  return tag
    .split(" | ")
    .map((segment) => {
      const source = provenanceTagToSource(segment);
      if (!source || !RELABELED_KINDS.has(source.kind)) return segment;
      return peerProvenanceTag(myDisplayName, timestamp, myNodeId);
    })
    .join(" | ");
}
