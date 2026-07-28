// domain/p2p/provenance-relabel.mjs — rewrites a fact's outgoing provenance
// tag before it's broadcast to peers, so "who taught this" reads as a node
// name rather than a local session id. Only teach/operator-kind tags are
// touched; a mud world/testimony tag is already attributed to the world or
// the character that made it, not the person at the keyboard, and rewriting
// it would lose information rather than add it.
import { provenanceTagToSource } from "../memory/trust.mjs";

const RELABELED_KINDS = new Set(["teach", "operator"]);

/** `provenance` may already be a " | "-joined union of several tags (the
 *  same fact taught more than once, from different sources) — relabel each
 *  segment independently and rejoin, so a segment this peer didn't author
 *  passes through untouched. */
export function relabelForBroadcast(provenance, myDisplayName, timestamp) {
  const tag = String(provenance || "");
  if (!tag) return tag;
  return tag
    .split(" | ")
    .map((segment) => {
      const source = provenanceTagToSource(segment);
      if (!source || !RELABELED_KINDS.has(source.kind)) return segment;
      return `teach:peer:${myDisplayName}@${timestamp}`;
    })
    .join(" | ");
}
