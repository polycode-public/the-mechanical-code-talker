// row-backend.mjs — the published contract for a custom memory backend: a
// session-scoped async row store the consumer constructs and injects, which
// tmct binds into the same `memoryDir` token every memory call already threads.
//
// A backend is a duck-typed object, and `isRowBackend` is the test:
//
//   {
//     kind: "tmct-memory-row-backend",
//     contractVersion: 1,
//
//     readRows(),            // → AsyncIterable<row> | Promise<row[]>: every live row
//     putRows(rows),         // upsert; per-row atomic; resolves when all rows are durable
//     deleteRows(rowKeys),   // the rows are absent from every later read; missing keys are a no-op
//     readRowsByTerm(term),  // OPTIONAL: rows whose index term matches
//     readMeta(key),         // → string | null
//     putMeta(key, value),   // upsert one sidecar value
//     deleteAll(),           // every row and meta entry this session key reaches goes absent
//     close(),               // release connections; further calls may reject
//   }
//
// Read order never carries meaning: what a row means rides its own content, so
// two backends handing the same rows back in different orders assemble the same
// payload.
//
// Deleting is observable, not physical. The contract promises one thing — a
// deleted row never appears in a later read. Removing the item and tombstoning
// it behind a filtered read both satisfy that, so an adapter picks whichever
// its store makes cheap.

// The wire row a backend stores is `{ rowKey, rowClass, term, json }` plus an
// optional `expiresAt` in epoch seconds. `json` is the serialized record and the
// only field carrying tmct-shaped content; the other three are what an adapter
// indexes on, and `expiresAt` is the adapter's own TTL stamp, absent when the
// consumer set no policy. `rowProblems` below is the shape's one authority.

export const ROW_BACKEND_KIND = "tmct-memory-row-backend";
export const ROW_BACKEND_CONTRACT_VERSION = 1;

/** The closed row-class set. `bookkeeping` is the structural gate: a row in
 *  that class is internal (a research-queue entry, a researched-term marker)
 *  and never composes into a visitor-facing answer, so read paths exclude it by
 *  field rather than by matching on its content. */
export const ROW_CLASSES = Object.freeze([
  "fact", "source", "utterance", "session", "rule", "retraction", "edge-group", "bookkeeping",
]);

export const BOOKKEEPING_ROW_CLASS = "bookkeeping";

/** The per-row size cap. The projection enforces it before any write leaves the
 *  process, so an oversized fact fails in the turn that minted it rather than
 *  as a store's 400 several hops later. */
export const MAX_ROW_BYTES = 4096;

export const BACKEND_REJECTED_CODE = "TMCT_BACKEND_REJECTED";
export const BACKEND_UNAVAILABLE_CODE = "TMCT_BACKEND_UNAVAILABLE";

/** Both failure classes carry a stable `code`, so a consumer whose turn is
 *  itself the last resort catches by class or by code and carries on without
 *  persistence. Nothing has to match on an error message. */
function describeFailure(error, details) {
  if (details?.rowKey) error.rowKey = details.rowKey;
  if (details?.rowClass) error.rowClass = details.rowClass;
  if (details?.provenance) error.provenance = details.provenance;
  if (details?.status) error.status = details.status;
  return error;
}

/** The input was refused: an oversized row, a malformed key, a failed
 *  validation. Retrying the same input gets the same answer. */
export class BackendRejected extends Error {
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "BackendRejected";
    this.code = BACKEND_REJECTED_CODE;
    describeFailure(this, details);
  }
}

/** The store could not be reached or refused service: a network failure, a
 *  429/507/5xx. The same input may well succeed later. */
export class BackendUnavailable extends Error {
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "BackendUnavailable";
    this.code = BACKEND_UNAVAILABLE_CODE;
    describeFailure(this, details);
  }
}

const REQUIRED_METHODS = Object.freeze([
  "readRows", "putRows", "deleteRows", "readMeta", "putMeta", "deleteAll", "close",
]);

/** The one method a backend may leave out. Core's read path does not call it
 *  yet; it is in the contract so the index shape is settled and an adapter that
 *  implements it needs no table change when core starts issuing term reads. */
export const OPTIONAL_METHODS = Object.freeze(["readRowsByTerm"]);

/** What stops `value` from being a row backend, as a list of plain sentences.
 *  Empty means it is one. */
export function rowBackendProblems(value) {
  const problems = [];
  if (!value || typeof value !== "object") return ["not an object"];
  if (value.kind !== ROW_BACKEND_KIND) problems.push(`kind is ${JSON.stringify(value.kind)}, expected ${JSON.stringify(ROW_BACKEND_KIND)}`);
  if (value.contractVersion !== ROW_BACKEND_CONTRACT_VERSION) {
    problems.push(`contractVersion is ${JSON.stringify(value.contractVersion)}, expected ${ROW_BACKEND_CONTRACT_VERSION}`);
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof value[method] !== "function") problems.push(`${method}() is missing`);
  }
  for (const method of OPTIONAL_METHODS) {
    if (method in value && value[method] != null && typeof value[method] !== "function") {
      problems.push(`${method} is present but not a function`);
    }
  }
  return problems;
}

/** True when `value` is a row backend tmct can bind as a `memoryDir` token. */
export function isRowBackend(value) {
  return rowBackendProblems(value).length === 0;
}

/** The stored size of a row: its serialized record in UTF-8 bytes. TextEncoder
 *  rather than Buffer, because this module runs in the browser too. */
export function rowJsonBytes(row) {
  return new TextEncoder().encode(String(row?.json ?? "")).length;
}

/** What stops `row` from being a valid wire row, as a list of plain sentences.
 *  Empty means it is one. */
export function rowProblems(row) {
  const problems = [];
  if (!row || typeof row !== "object") return ["not an object"];
  if (typeof row.rowKey !== "string" || !row.rowKey) problems.push("rowKey must be a non-empty string");
  if (!ROW_CLASSES.includes(row.rowClass)) problems.push(`rowClass ${JSON.stringify(row.rowClass)} is outside the closed set (${ROW_CLASSES.join(", ")})`);
  if (typeof row.term !== "string") problems.push("term must be a string, empty when the row has no term read path");
  if (typeof row.json !== "string" || !row.json) problems.push("json must be a non-empty string");
  else {
    const bytes = rowJsonBytes(row);
    if (bytes > MAX_ROW_BYTES) problems.push(`json is ${bytes} bytes, over the ${MAX_ROW_BYTES}-byte cap`);
  }
  if (row.expiresAt !== undefined && !Number.isInteger(row.expiresAt)) {
    problems.push("expiresAt must be epoch seconds as an integer when present");
  }
  return problems;
}

export function isValidRow(row) {
  return rowProblems(row).length === 0;
}

/** Throw a `BackendRejected` naming every problem, or return the row. Adapters
 *  call this on the way in so a malformed row never reaches a store. */
export function assertValidRow(row, details = {}) {
  const problems = rowProblems(row);
  if (!problems.length) return row;
  throw new BackendRejected(
    `invalid memory row ${JSON.stringify(row?.rowKey ?? null)}: ${problems.join("; ")}`,
    { rowKey: typeof row?.rowKey === "string" ? row.rowKey : "", rowClass: row?.rowClass, ...details },
  );
}
