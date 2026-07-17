/**
 * The Fact rows one write touched — created, or re-asserted with a new
 * provenance entry — diffed by (id → provenance) across a before/after pair of
 * readFactRows() snapshots.
 *
 * Provenance is the key because a re-assertion of a fact that is already stored
 * changes nothing else about the row: appendFact unions the new provenance in
 * by id, so a row whose provenance string moved is a row this write reached.
 *
 * Not every write produces a touched row, and that is the honest answer rather
 * than a gap: the rule-teach shapes (compose2/filter/recursive) store a Rule,
 * not a Fact, so they touch no Fact row and are correctly reported as none.
 */
export function touchedFactRows(before, after) {
  const provenanceBefore = new Map(before.map((r) => [r.id, r.provenance]));
  return after.filter((r) => provenanceBefore.get(r.id) !== r.provenance);
}
