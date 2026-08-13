// memory/causal-stability.mjs — deciding when a replicated tombstone has been
// held by enough peers to retire.
//
// A retraction record and a compaction summary both work by staying put: they
// carry the ids they suppressed, and any peer that re-delivers one of those ids
// gets refused. That is what makes a delete survive a sync over a grow-only
// set. It also means the records accumulate, because nothing yet says when one
// has done its job.
//
// The literature calls the missing rule CAUSAL STABILITY: a record is safe to
// drop once every replica that could still send a conflicting copy has it. Two
// inputs.
//
//   - The ROSTER. `node:<joiner> mgx:invitedBy node:<inviter>` is an ordinary
//     replicated fact, so the set of node ids ever admitted to a world is a
//     grow-only union every replica computes the same way. `admittedNodes`
//     reads it. Grow-only is exactly right here: a roster that could shrink
//     would let a forgotten node's stale copy back in.
//   - The ACKNOWLEDGEMENT. Nothing yet records that a named node holds a named
//     record. `stableRecordIds` takes it as an argument rather than inventing
//     it, and answers "nothing is stable" when it is absent — which is the
//     current answer, and the safe one.
//
// Every rule here errs the same way. Dropping a tombstone one peer short lets
// that peer's copy resurrect a retracted fact, and that failure is silent,
// late, and reads as the memory inventing something. Retiring nothing is
// merely unbounded. So: an empty roster retires nothing, a member with no
// acknowledgement retires nothing, and an unparseable input retires nothing.
//
// Pure: no clock, no counter, no arrival order. The answer is a function of the
// fact set and the acknowledgement evidence handed in, which is the same
// invariant every read-time resolver over the store has to meet.
// docs/references/papers/crdt.md carries the full design and the options it
// rejected.

export const INVITED_BY_PREDICATE = "mgx:invitedBy";

/** The term a node id takes as a fact subject or object. */
export const nodeTerm = (nodeId) => `node:${nodeId}`;

/** One admission edge: who let a node in. There is no open discovery here, so
 *  this records a social admission graph that an identity cannot mint for
 *  itself. The joiner writes it, because the joiner is the only side that
 *  knows both node ids at the moment it decides to join. */
export function invitedByFact(joinerNodeId, inviterNodeId, timestamp) {
  return {
    subject: nodeTerm(joinerNodeId),
    predicate: INVITED_BY_PREDICATE,
    object: nodeTerm(inviterNodeId),
    provenance: `ace:p2p:${joinerNodeId}@${timestamp}`,
  };
}

/** The node ids a world has ever admitted, from its admission edges. Both ends
 *  of each edge count: the joiner wrote the edge about itself, and it names the
 *  node that let it in. Sorted, so two peers holding the same facts hand the
 *  same roster to the rule below. */
export function admittedNodes(rows) {
  const nodes = new Set();
  for (const row of rows || []) {
    if (row?.predicate !== INVITED_BY_PREDICATE) continue;
    if (row.subject) nodes.add(String(row.subject));
    if (row.object) nodes.add(String(row.object));
  }
  return [...nodes].sort();
}

/** The roster this node has to convince before retiring anything: every
 *  admitted node except itself. A node holding its own record proves nothing
 *  about who else still has a copy. */
export function peersToConvince(roster, self = "") {
  const me = String(self || "");
  return (roster || []).map(String).filter((id) => id && id !== me);
}

/**
 * Which of `recordIds` every peer on the roster is known to hold.
 *
 * `acknowledgedBy(nodeId)` returns the record ids that node is known to hold.
 * Nothing supplies it in the product yet, so it defaults to knowing nothing and
 * the answer defaults to the empty set. That default is the gate: this rule
 * cannot retire anything until something can show a peer holds a record.
 *
 * An empty roster answers with nothing too. A store with no admission edges has
 * not shown it is alone; it has shown it does not know who else is out there,
 * and a copy of it can be sitting in a closed browser tab.
 */
export function stableRecordIds({ recordIds = [], roster = [], self = "", acknowledgedBy = null } = {}) {
  const peers = peersToConvince(roster, self);
  if (!peers.length) return [];
  if (typeof acknowledgedBy !== "function") return [];
  const held = new Map();
  for (const peer of peers) {
    const ids = acknowledgedBy(peer);
    held.set(peer, new Set([...(ids || [])].map(String)));
  }
  const candidates = [...new Set((recordIds || []).map(String).filter(Boolean))].sort();
  return candidates.filter((id) => peers.every((peer) => held.get(peer).has(id)));
}
