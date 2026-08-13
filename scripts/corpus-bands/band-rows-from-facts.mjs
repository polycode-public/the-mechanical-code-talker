// band-rows-from-facts.mjs — the tail every corpus-band pipeline shares:
// order the facts, number them, project each onto its wire row.
//
// The sort is what makes a build reproducible. A source file's own line order
// (or a shard walk's) decides which fact arrives first, but not which `ord` it
// gets: rows are sorted by (predicate, subject, object) before `ord` is
// assigned, so two runs over the same facts in different orders write
// byte-identical output.

import { bandFactRow } from "../../src/adapters/memory/corpus-bands.mjs";

const byPredicateThenTriple = (a, b) => (
  a.predicate !== b.predicate ? (a.predicate < b.predicate ? -1 : 1)
    : a.subject !== b.subject ? (a.subject < b.subject ? -1 : 1)
      : a.object < b.object ? -1 : a.object > b.object ? 1 : 0
);

/** `facts` ({subject, predicate, object, provenance}) as `band`'s wire rows,
 *  sorted and numbered. */
export function bandRowsFromFacts(facts, band) {
  const sorted = facts.slice().sort(byPredicateThenTriple);
  return sorted.map((fact, ord) => bandFactRow({ ...fact, band, ord }));
}
