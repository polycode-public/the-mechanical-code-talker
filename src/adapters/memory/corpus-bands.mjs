// corpus-bands.mjs — shared read-only reference partitions that live beside
// session rows in the same table: band naming, the manifest shape, and the
// wire row a band fact projects onto.
//
// A band lives at partition key `corpus:<band>`, sort key
// `<rowClass>#<term>#<rowKey>` for a fact row, `manifest` for the band's own
// bookkeeping row. `corpus:<band>` is not a UUIDv4, so it can never collide
// with a session key and no session route can address it — the only reads
// a band partition gets are the deliberate, term-scoped corpus read a turn
// issues (corpus-loader.mjs's `queryBandTerm`), never a session's own row
// traffic.
//
// Bands are written once, by the credentialed loader (corpus-loader.mjs),
// and never mutated afterward except by a full reload or clear: nothing on
// the public API path ever calls putRows against a `corpus:` partition.
//
// The term Query itself lives in corpus-loader.mjs, not here: this module is
// an adapters-layer module (pure naming/shape, no store calls), and the one
// Query implementation this whole surface shares
// (subgraph-retrieval.mjs's termQueryOverDocumentClient) is a services-layer
// module — an adapter may not import upward into services (see
// test/estate/import-layers.test.mjs).

import { normFactTerm, factIdForTriple } from "../../domain/hash.mjs";
import { assertValidRow } from "./row-backend.mjs";

export const BAND_PARTITION_PREFIX = "corpus:";
export const MANIFEST_SORT_KEY = "manifest";

/** The three bands this plan ships a build pipeline and a loader for. */
export const FIRST_CLASS_BANDS = Object.freeze([
  "wikidata-slice",
  "wordnet-complete",
  "conceptnet-full",
]);

// Reserved so the partition name is spoken for; no pipeline for it ships
// here. Its own design doc covers the band when it lands.
export const RESERVED_BAND_NAMES = Object.freeze(["simplewiki-derived"]);

/** `corpus:<band>` — the partition key every band's rows and manifest share. */
export function bandPartitionKey(band) {
  if (!band || typeof band !== "string") throw new TypeError("bandPartitionKey needs a non-empty band name");
  return `${BAND_PARTITION_PREFIX}${band}`;
}

/** True when `pk` names a band partition rather than a session. A session key
 *  is always a UUIDv4, which never starts with this prefix, so this check is
 *  exactly the one the public route enforcement (§3.13) rests on. */
export function isBandPartitionKey(pk) {
  return typeof pk === "string" && pk.startsWith(BAND_PARTITION_PREFIX);
}

/** The band name inside a partition key, or null when `pk` is not one. */
export function bandNameFromPartitionKey(pk) {
  return isBandPartitionKey(pk) ? pk.slice(BAND_PARTITION_PREFIX.length) : null;
}

/** `<rowClass>#<term>#<rowKey>` — the same sort-key layout session fact rows
 *  use (§3.3), so a term read is one `begins_with` Query regardless of which
 *  partition it targets. */
export function bandSortKeyForRow(rowClass, term, rowKey) {
  return `${rowClass}#${term}#${rowKey}`;
}

/** The manifest a band load writes last: what the loader reads back to
 *  decide "unchanged", and what a citation names as the band's version. */
export function buildBandManifest({ band, version = 1, rowCount, loadedAt, sourceDigest, license = null, notice = null }) {
  if (!band) throw new TypeError("buildBandManifest needs a band name");
  if (!Number.isInteger(rowCount) || rowCount < 0) throw new TypeError("buildBandManifest needs a non-negative integer rowCount");
  if (!loadedAt) throw new TypeError("buildBandManifest needs loadedAt");
  if (!sourceDigest) throw new TypeError("buildBandManifest needs sourceDigest");
  return { band, version, rowCount, loadedAt, sourceDigest, license, notice };
}

// A fixed instant, not wall-clock time: a pipeline run over the same source
// data must produce byte-identical rows, and a fact's own attributes carry no
// authored date a corpus dump names. The manifest's `loadedAt` (stamped by
// the loader, not the pipeline) is what actually says how fresh a band is.
export const BAND_ROW_INSTANT = "2026-01-01T00:00:00.000Z";

// The trust prior corpus-sourced facts get everywhere else in the store
// (src/domain/memory/trust.mjs's SOURCE_PRIOR.corpus) — stamped directly
// here rather than recomputed, since a band row is never read back through
// appendFacts' own trust pipeline.
const CORPUS_TRUST_SCORE = "0.7";

/** One band fact as the wire row a build pipeline emits and the loader
 *  writes: `{rowKey, rowClass, term, json}`, no `pk`/`sk` — those are the
 *  loader's job to add at write time, from `band` and this row's own
 *  `rowClass#term#rowKey`. `provenance` is the full `corpus:<name> ...`
 *  provenance string (§3.13: no new provenance grammar), and `ord` numbers
 *  the row within one pipeline run so a later assembly can reconstruct a
 *  stable order.
 *
 *  Throws (via `assertValidRow`) when the projected row would be malformed
 *  or over the per-row cap — a build pipeline should let that stop the run
 *  rather than emit a row the loader would only reject later. */
export function bandFactRow({ subject, predicate, object, provenance = "", band, ord = 0 }) {
  const term = normFactTerm(subject);
  const sourceId = `src:corpus:${band}`;
  const rowKey = `${factIdForTriple(subject, predicate, object)}@${sourceId}`;
  const individual = {
    id: rowKey,
    label: `${subject} ${predicate} ${object}`,
    class: "Fact",
    derived_from: [],
    mentions: [],
    attributes: [
      { prop: "rdf:type", key: "type", value: "rdf:Statement" },
      { prop: "rdf:subject", key: "subject", value: subject },
      { prop: "rdf:predicate", key: "predicate", value: predicate },
      { prop: "rdf:object", key: "object", value: object },
      { prop: "mgx:createdAt", key: "createdAt", value: BAND_ROW_INSTANT },
      { prop: "mgx:sourceId", key: "sourceId", value: sourceId },
      { prop: "mgx:factProvenance", key: "provenance", value: provenance },
      {
        prop: "mgx:hasProseTokens",
        key: "prose_tokens",
        value: [...new Set(`${subject} ${object} ${predicate}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))].sort().join(" "),
      },
      { prop: "mgx:trustScore", key: "trustScore", value: CORPUS_TRUST_SCORE },
      {
        prop: "mgx:trustInputs",
        key: "trustInputs",
        value: JSON.stringify({ sourceType: "corpus", sourceId, createdAt: BAND_ROW_INSTANT }),
      },
      { prop: "mgx:updatedAt", key: "updatedAt", value: BAND_ROW_INSTANT },
    ],
  };
  const row = {
    rowKey,
    rowClass: "fact",
    term,
    json: JSON.stringify({ ord, individual }),
  };
  return assertValidRow(row, { provenance });
}
