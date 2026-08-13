// memory/provenance-time.mjs — reading "when" off a fact's provenance tag.
//
// A fact's provenance is a " | "-joined union of tags, because appendFacts
// unions a fresh tag onto the SAME fact id when a triple is asserted again
// rather than minting a second row. So "when was this most recently true" is a
// question about the newest segment, not about the string as a whole.
import { provenanceTagToSource } from "./trust.mjs";

/** The newest asserted-at timestamp across every segment of `provenance`, in
 *  milliseconds. Null when no segment parses to a timestamp at all. */
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

/** The latest-by-timestamp row for a subject+predicate pair — the "current
 *  value" read for an add-only fact that is never retracted. A first-wins read
 *  takes the oldest of these instead. */
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
