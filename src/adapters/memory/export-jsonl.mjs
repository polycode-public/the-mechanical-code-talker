// export-jsonl.mjs — serialize a memory store's Facts to JSONL in the same
// shape `tmct extract` emits: one JSON object per line, each carrying
// { subject, predicate, object, provenance } (and `quantifier` when a plural
// class-membership teach set one). Provenance is the store's own legacy compat
// string, verbatim — so an exported line names where the fact came from, and a
// re-import through the recognizer or a fact loader lands it back.
//
// Pure: no I/O. The CLI (`tmct memory --export`), the tool layer
// (`tmct_export`) and the browser pages all read a loaded memory (or its fact
// rows) and call one of these — one serializer, one shape, everywhere.

import { readFactRows } from "./core.mjs";

/** One export record from a readFactRows row — the fields a re-import needs,
 *  and nothing the store computed internally (id, trust, justification). */
export function factRowToExportRecord(row) {
  const record = {
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    provenance: row.provenance || "",
  };
  if (row.quantifier) record.quantifier = row.quantifier;
  return record;
}

/** JSONL for an array of readFactRows rows — one object per line, a trailing
 *  newline when there is at least one row, the empty string for none. */
export function factRowsToJsonl(rows) {
  const records = (rows || []).map(factRowToExportRecord);
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
}

/** JSONL for a loaded memory (loadMemory's result, or a Backend-B payload) —
 *  every stored Fact, in the extract shape. */
export function serializeFactsJsonl(memory) {
  return factRowsToJsonl(readFactRows(memory));
}
