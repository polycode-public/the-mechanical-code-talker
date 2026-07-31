// domain/p2p/sync-filter.mjs — which rows of an already-loaded fact store
// are worth syncing to a new joiner. Every peer's page ships the identical
// build-time seed, so those rows already share the same content-addressed
// ids before any network traffic happens; sending them again is pure waste.
// What actually needs syncing is the delta: whatever a person or a peer
// actually added since boot.
import { provenanceTagToSource } from "../memory/trust.mjs";

// "teachNode" is the same human teaching, seen from one hop further out: a
// peer's own relabeled tag, keyed on the node id it carries. It syncs for
// exactly the reason "teach" does, and leaving it out would silently strand
// every fact that had already crossed the wire once.
const CHAT_SYNCABLE_KINDS = new Set(["teach", "operator", "teachNode"]);

/** chat.html: every fact a human (locally or via a peer) actually taught or
 *  asserted — never a row from the shipped corpus. */
export function chatSyncableFacts(rows) {
  return rows.filter((row) => {
    const source = provenanceTagToSource(row.provenance);
    return source ? CHAT_SYNCABLE_KINDS.has(source.kind) : false;
  });
}

/** mud.html: every fact that isn't part of the bare, unsuffixed world seed —
 *  a move, a dig, a piece of testimony, or one of the P2P layer's own new
 *  predicates (world/node names, character claims, waves). `isMudStatePredicate`
 *  is injected rather than imported from adventure.mjs directly, so this
 *  module never needs to know that file's internal predicate names — the
 *  caller (whoever wires the mud room) supplies it, typically
 *  `adventure.mjs`'s own exported predicate check, extended to also accept
 *  this module's own P2P predicates via `extraPredicates`. */
export function mudSyncableFacts(rows, isMudStatePredicate, extraPredicates = []) {
  const extra = new Set(extraPredicates);
  return rows.filter((row) => extra.has(row.predicate) || isMudStatePredicate(row.predicate));
}
