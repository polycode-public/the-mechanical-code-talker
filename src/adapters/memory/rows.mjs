// rows.mjs — the row projection: a memory payload out to wire rows and back.
// One module owns the whole mapping, so every backend that stores rows
// (in-memory, sqlite, a consumer's own key-value store) writes the same shape
// and reads back the same payload.
//
// What stores and what does not:
//
//   - `individuals` project one row each, carrying their `ord` so a store can
//     rebuild the array in the order it was written;
//   - `objectProperties` project one `edge-group` row per prop, examples in
//     stored order (that order is recency — an updated edge moves to the end);
//   - `memory` and `prefixes` are the two true scalars, and travel as meta;
//   - `classes`, `vocabulary`, `proseIndex` and `generated_at` are derived, so
//     assembly recomputes them and no row ever carries them. A large store's
//     prose index serialized whole would dwarf the per-row cap on its own.
//
// Assembly is a pure function of the row set. Order rides row content — the
// `ord` in each row's json, then the row key as the tie-break — so a backend
// handing the same rows back in a different order builds the same payload.

import {
  emptyMemory,
  FACT_CLASS, SOURCE_CLASS, UTTERANCE_CLASS, MEMORY_SESSION_CLASS, RULE_CLASS, RETRACTION_CLASS,
} from "./core.mjs";
import { normFactTerm } from "../../domain/hash.mjs";
import { buildProseIndex } from "../../domain/prose.mjs";
import {
  BackendRejected, BOOKKEEPING_ROW_CLASS, MAX_ROW_BYTES, assertValidRow, rowJsonBytes,
} from "./row-backend.mjs";

const EDGE_GROUP_ROW_CLASS = "edge-group";
const EDGE_GROUP_KEY_PREFIX = "edge-group:";
const BOOKKEEPING_KEY_PREFIX = "bookkeeping:";

const SUPERSEDES_PROP = "mgx:supersedes";
const SUPERSEDED_BY_PROP = "mgx:supersededBy";
const PROVENANCE_PROP = "mgx:factProvenance";
const UTTERANCE_TS_PROP = "mgx:utteranceTs";

/** The two internal row kinds that stay out of meta: each entry is its own row,
 *  so concurrent turns append to the queue instead of racing a read-modify-write
 *  over one shared value. */
export const BOOKKEEPING_RESEARCH_QUEUE = "research-queue";
export const BOOKKEEPING_RESEARCHED_TERM = "researched-term";

const attrValue = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value || "";
const attrByKey = (ind, key) => (ind?.attributes || []).find((a) => a?.key === key)?.value || "";

// Built on first use rather than at module load: core.mjs imports this module,
// so its exported constants are still in their temporal dead zone while this
// file's own body runs.
let rowClassByIndividualClass = null;
function individualRowClasses() {
  if (!rowClassByIndividualClass) {
    rowClassByIndividualClass = new Map([
      [FACT_CLASS, "fact"],
      [SOURCE_CLASS, "source"],
      [UTTERANCE_CLASS, "utterance"],
      [MEMORY_SESSION_CLASS, "session"],
      [RULE_CLASS, "rule"],
      [RETRACTION_CLASS, "retraction"],
    ]);
  }
  return rowClassByIndividualClass;
}

/** The row class one individual projects onto. An individual whose class is
 *  outside the closed set has no honest row to land in, so it is refused here
 *  rather than stored under a class that read paths would misread. */
function rowClassForIndividual(ind) {
  const rowClass = individualRowClasses().get(ind?.class);
  if (rowClass) return rowClass;
  throw new BackendRejected(
    `individual ${JSON.stringify(ind?.id ?? null)} has class ${JSON.stringify(ind?.class ?? null)}, which no row class covers`,
    { rowKey: String(ind?.id || "") },
  );
}

/** A fact record's stored form: everything it holds except the backward
 *  supersession pointer. Only the forward `supersedes` list is stored, so a
 *  second supersession writes its own new row and never rewrites this one —
 *  two writers can only lose a write when they share a row key. Assembly
 *  derives the backward pointer again from the forward ones. */
function storedIndividualForm(ind) {
  if (!(ind?.attributes || []).some((a) => a?.prop === SUPERSEDED_BY_PROP)) return ind;
  return { ...ind, attributes: ind.attributes.filter((a) => a?.prop !== SUPERSEDED_BY_PROP) };
}

/** The ord each row key carries. An existing key keeps the ord it already had
 *  and a new one takes the next free number, matching how a store keeps a row's
 *  sort position across an update. Without prior rows the ords are the payload's
 *  own array order. */
function ordAssigner(priorRows) {
  const priorOrds = new Map();
  let next = 0;
  for (const row of priorRows || []) {
    let ord;
    try { ord = Number(JSON.parse(row?.json ?? "{}").ord); } catch { ord = NaN; }
    if (!Number.isFinite(ord)) continue;
    priorOrds.set(row.rowKey, ord);
    if (ord >= next) next = ord + 1;
  }
  return (rowKey) => {
    const prior = priorOrds.get(rowKey);
    if (prior !== undefined) return prior;
    const ord = next;
    next += 1;
    return ord;
  };
}

/** Refuse or drop an oversized row. The default posture throws: one fact that
 *  big is an extraction pathology and the turn should fail loudly, naming the
 *  provenance that produced it. A consumer whose turn is itself the last resort
 *  passes `onOversizedRow: "drop"` instead, and the turn completes with
 *  everything else persisted. */
function admitRow(row, provenance, { onOversizedRow, log }) {
  const bytes = rowJsonBytes(row);
  if (bytes <= MAX_ROW_BYTES) return true;
  const where = provenance ? ` (provenance: ${provenance})` : "";
  const detail = `${row.rowClass} row ${row.rowKey} serializes to ${bytes} bytes, over the ${MAX_ROW_BYTES}-byte cap${where}`;
  if (onOversizedRow === "drop") {
    log(`dropped an oversized memory row: ${detail}`);
    return false;
  }
  throw new BackendRejected(detail, { rowKey: row.rowKey, rowClass: row.rowClass, provenance });
}

const warnToConsole = (message) => console.warn(message);

/** Project a memory payload into wire rows.
 *
 *  `priorRows` are the rows this payload was last projected as; pass them and
 *  every unchanged row comes back byte-identical, so `diffRows` writes only
 *  what actually moved. `onOversizedRow` is "throw" (default) or "drop", and
 *  `log` takes the drop notices. */
export function payloadToRows(payload, { priorRows = null, onOversizedRow = "throw", log = warnToConsole } = {}) {
  if (onOversizedRow !== "throw" && onOversizedRow !== "drop") {
    throw new TypeError(`onOversizedRow must be "throw" or "drop", got ${JSON.stringify(onOversizedRow)}`);
  }
  const ordFor = ordAssigner(priorRows);
  const posture = { onOversizedRow, log };
  const rows = [];

  for (const ind of payload?.individuals || []) {
    if (!ind?.id) continue;
    const rowClass = rowClassForIndividual(ind);
    const row = {
      rowKey: String(ind.id),
      rowClass,
      term: rowClass === "fact" ? normFactTerm(attrByKey(ind, "subject")) : "",
      json: JSON.stringify({ ord: ordFor(String(ind.id)), individual: storedIndividualForm(ind) }),
    };
    if (admitRow(row, attrValue(ind, PROVENANCE_PROP), posture)) rows.push(row);
  }

  for (const group of payload?.objectProperties || []) {
    if (!group?.prop) continue;
    const rowKey = `${EDGE_GROUP_KEY_PREFIX}${group.prop}`;
    const row = {
      rowKey,
      rowClass: EDGE_GROUP_ROW_CLASS,
      term: "",
      json: JSON.stringify({ ord: ordFor(rowKey), group }),
    };
    if (admitRow(row, "", posture)) rows.push(row);
  }

  return rows;
}

/** The two scalars that travel as meta rather than as rows. */
export function payloadMeta(payload) {
  const empty = emptyMemory();
  return {
    memory: payload?.memory ?? empty.memory,
    prefixes: payload?.prefixes ?? empty.prefixes,
  };
}

const byOrdThenRowKey = (a, b) => (
  a.ord - b.ord || (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0)
);

/** Sort the Fact individuals by their content-addressed ids, in place and in
 *  their own slots, so two writers holding one fact set fold it in the same
 *  order however their rows arrived. Codepoint order, never localeCompare —
 *  the whole point is that two locales land on the same order. */
function sortFactIndividualsById(individuals) {
  const slots = [];
  const facts = [];
  for (let i = 0; i < individuals.length; i += 1) {
    if (individuals[i]?.class !== FACT_CLASS) continue;
    slots.push(i);
    facts.push(individuals[i]);
  }
  facts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < slots.length; i += 1) individuals[slots[i]] = facts[i];
}

/** Re-derive each record's backward supersession pointer from the union of the
 *  forward ones. Two turns that superseded the same record concurrently both
 *  land, because each wrote its own row and neither touched the record they
 *  replaced. */
function applyDerivedSupersessions(individuals) {
  const successorsById = new Map();
  for (const ind of individuals) {
    if (ind?.class !== FACT_CLASS) continue;
    for (const replaced of attrValue(ind, SUPERSEDES_PROP).split(" ").filter(Boolean)) {
      const successors = successorsById.get(replaced) || new Set();
      successors.add(ind.id);
      successorsById.set(replaced, successors);
    }
  }
  for (const ind of individuals) {
    const successors = successorsById.get(ind?.id);
    if (!successors) continue;
    ind.attributes = [
      ...(ind.attributes || []).filter((a) => a?.prop !== SUPERSEDED_BY_PROP),
      { prop: SUPERSEDED_BY_PROP, key: "supersededBy", value: [...successors].sort().join(" ") },
    ];
  }
}

/** Recount `classes[]` from the assembled individuals, the same count-and-
 *  sample shape the store keeps. */
function recountedClasses(individuals) {
  const classes = [];
  for (const name of [MEMORY_SESSION_CLASS, UTTERANCE_CLASS, FACT_CLASS, SOURCE_CLASS, RULE_CLASS]) {
    const of = individuals.filter((i) => i?.class === name);
    if (of.length) classes.push({ name, count: of.length, sample: of.slice(0, 3).map((i) => i.label) });
  }
  return classes;
}

/** The store's `generated_at`: the latest utterance timestamp it holds, which
 *  is the same value the write path raises it to. */
function latestUtteranceTimestamp(individuals) {
  let latest = "";
  for (const ind of individuals) {
    if (ind?.class !== UTTERANCE_CLASS) continue;
    const ts = attrValue(ind, UTTERANCE_TS_PROP);
    if (ts > latest) latest = ts;
  }
  return latest;
}

/** Assemble a memory payload from a row set. `meta` carries the two stored
 *  scalars; without it the payload takes the empty store's own values.
 *  Bookkeeping rows are excluded by field: they round-trip through the store
 *  but never reach an answer. */
export function rowsToPayload(rows, { meta = null } = {}) {
  const payload = emptyMemory();
  if (meta?.memory !== undefined) payload.memory = meta.memory;
  if (meta?.prefixes !== undefined) payload.prefixes = meta.prefixes;

  const individualEntries = [];
  const groupEntries = [];
  for (const row of rows || []) {
    if (!row || row.rowClass === BOOKKEEPING_ROW_CLASS) continue;
    const record = JSON.parse(row.json);
    const ord = Number.isFinite(Number(record?.ord)) ? Number(record.ord) : 0;
    const entry = { ord, rowKey: String(row.rowKey || "") };
    if (row.rowClass === EDGE_GROUP_ROW_CLASS) groupEntries.push({ ...entry, group: record?.group });
    else individualEntries.push({ ...entry, individual: record?.individual });
  }
  individualEntries.sort(byOrdThenRowKey);
  groupEntries.sort(byOrdThenRowKey);

  const individuals = individualEntries.map((e) => e.individual).filter(Boolean);
  sortFactIndividualsById(individuals);
  applyDerivedSupersessions(individuals);

  payload.individuals = individuals;
  payload.objectProperties = groupEntries.map((e) => e.group).filter(Boolean);
  payload.classes = recountedClasses(individuals);
  payload.proseIndex = buildProseIndex(individuals);
  payload.generated_at = latestUtteranceTimestamp(individuals);
  return payload;
}

/** The rows to write and the row keys to delete to turn `before` into `after`.
 *  A row whose stored bytes did not change is not in either list, so a store
 *  pays only for what actually moved. */
export function diffRows(before, after) {
  const beforeByKey = new Map((before || []).filter((r) => r?.rowKey).map((r) => [r.rowKey, r]));
  const puts = [];
  const kept = new Set();
  for (const row of after || []) {
    if (!row?.rowKey) continue;
    kept.add(row.rowKey);
    const prior = beforeByKey.get(row.rowKey);
    const unchanged = prior
      && prior.json === row.json
      && prior.term === row.term
      && prior.rowClass === row.rowClass;
    if (!unchanged) puts.push(row);
  }
  const deletes = [...beforeByKey.keys()].filter((key) => !kept.has(key));
  return { puts, deletes };
}

/** One internal entry as its own row: a research-queue item, a researched-term
 *  marker, anything that must never compose into a visitor-facing answer. */
export function bookkeepingRow(kind, key, value) {
  const rowKey = `${BOOKKEEPING_KEY_PREFIX}${kind}:${key}`;
  return assertValidRow({
    rowKey,
    rowClass: BOOKKEEPING_ROW_CLASS,
    term: "",
    json: JSON.stringify({ kind, key, value }),
  });
}

/** The bookkeeping entries a row set holds, in row-key order. `kind` narrows to
 *  one family; omit it for all of them. */
export function bookkeepingEntries(rows, kind = "") {
  const entries = [];
  for (const row of rows || []) {
    if (row?.rowClass !== BOOKKEEPING_ROW_CLASS) continue;
    let record;
    try { record = JSON.parse(row.json); } catch { continue; }
    if (kind && record?.kind !== kind) continue;
    entries.push({ rowKey: row.rowKey, kind: record?.kind || "", key: record?.key || "", value: record?.value });
  }
  entries.sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0));
  return entries;
}
