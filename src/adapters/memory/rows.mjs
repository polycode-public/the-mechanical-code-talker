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
 *  own array order.
 *
 *  `baseOrds` is a read-only layer's key -> ord map, consulted after the prior
 *  rows so a key both layers hold keeps the row's own ord. It is read in place:
 *  a caller holding one for the life of its handle hands it over rather than
 *  projecting a row per key and parsing each back. */
function ordAssigner(priorRows, baseOrds) {
  const priorOrds = new Map();
  let next = 0;
  for (const row of priorRows || []) {
    let ord;
    try { ord = Number(JSON.parse(row?.json ?? "{}").ord); } catch { ord = NaN; }
    if (!Number.isFinite(ord)) continue;
    priorOrds.set(row.rowKey, ord);
    if (ord >= next) next = ord + 1;
  }
  for (const ord of baseOrds?.values() || []) if (Number.isFinite(ord) && ord >= next) next = ord + 1;
  return (rowKey) => {
    const prior = priorOrds.get(rowKey) ?? baseOrds?.get(rowKey);
    if (prior !== undefined) return prior;
    const ord = next;
    next += 1;
    return ord;
  };
}

/** Refuse, drop, or keep an oversized row. The default posture throws: one
 *  fact that big is an extraction pathology and the turn should fail loudly,
 *  naming the provenance that produced it. A consumer whose turn is itself
 *  the last resort passes `onOversizedRow: "drop"` instead, and the turn
 *  completes with everything else persisted. `"keep"` is for rows that will
 *  never actually reach the wire — a read-only seed overlay's own projection
 *  (core.mjs's `readRowPayload`), never a caller-facing choice: the cap
 *  protects a real backend's real per-item limit, which does not apply to a
 *  base payload `persistRowPayload` already excludes from every write
 *  (`seedOnlyKeys`). Silent — an oversized seed row is not a pathology, it's
 *  what a real corpus band's own high-fan-out property looks like. */
function admitRow(row, provenance, { onOversizedRow, log }) {
  const bytes = rowJsonBytes(row);
  if (bytes <= MAX_ROW_BYTES || onOversizedRow === "keep") return true;
  const where = provenance ? ` (provenance: ${provenance})` : "";
  const detail = `${row.rowClass} row ${row.rowKey} serializes to ${bytes} bytes, over the ${MAX_ROW_BYTES}-byte cap${where}`;
  if (onOversizedRow === "drop") {
    log(`dropped an oversized memory row: ${detail}`);
    return false;
  }
  throw new BackendRejected(detail, { rowKey: row.rowKey, rowClass: row.rowClass, provenance });
}

const warnToConsole = (message) => console.warn(message);
const OVERSIZED_ROW_POSTURES = new Set(["throw", "drop", "keep"]);

/** Project a memory payload into wire rows.
 *
 *  `priorRows` are the rows this payload was last projected as; pass them and
 *  every unchanged row comes back byte-identical, so `diffRows` writes only
 *  what actually moved. `priorOrds` is the same information for a read-only
 *  layer that already holds it as a key -> ord map (a sqlite seed's own key
 *  columns), read under the prior rows. `onOversizedRow` is "throw" (default),
 *  "drop", or "keep" (rows that never reach the wire — see `admitRow`), and
 *  `log` takes the drop notices. */
export function payloadToRows(payload, { priorRows = null, priorOrds = null, onOversizedRow = "throw", log = warnToConsole } = {}) {
  if (!OVERSIZED_ROW_POSTURES.has(onOversizedRow)) {
    throw new TypeError(`onOversizedRow must be "throw", "drop", or "keep", got ${JSON.stringify(onOversizedRow)}`);
  }
  const ordFor = ordAssigner(priorRows, priorOrds);
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

/** The prose tokens, forward supersession list and backward-pointer presence one
 *  individual carries, read in a single pass over its attributes. First match
 *  per field, which is what the `find`-based readers elsewhere in this file
 *  take. */
function derivationInputsOf(ind) {
  let proseTokens = "";
  let supersedes = "";
  let carriesSupersededBy = false;
  let seenProseTokens = false;
  let seenSupersedes = false;
  for (const a of ind?.attributes || []) {
    if (!seenProseTokens && a?.key === "prose_tokens") { proseTokens = a.value || ""; seenProseTokens = true; }
    if (!seenSupersedes && a?.prop === SUPERSEDES_PROP) { supersedes = a.value || ""; seenSupersedes = true; }
    if (a?.prop === SUPERSEDED_BY_PROP) carriesSupersededBy = true;
  }
  return { proseTokens, supersedes, carriesSupersededBy };
}

// What a payload carries forward so the next write reconciles its derived
// structures instead of building them again: what each individual last put into
// the prose index, what each record last named as superseded, and the reverse of
// that. Non-enumerable and symbol-keyed, so no copy of the payload inherits
// state that describes a different array of individuals, and a payload without
// it (a fresh assembly, a clone, a hand-built fixture) derives from scratch.
const CARRIED_DERIVATIONS = Symbol("tmct.carriedDerivations");

function carryForward(payload, carried) {
  carried.index = payload.proseIndex;
  Object.defineProperty(payload, CARRIED_DERIVATIONS, {
    value: carried, writable: true, configurable: true, enumerable: false,
  });
}

// The ids of the assembled individuals in ROW order, kept beside the assembled
// array. `sortFactIndividualsById` lifts the Facts out of the slots row order
// put them in, so the array itself no longer says which slot each Fact came
// from — and a removal needs exactly that, because dropping a Fact drops one of
// those slots, not the position the sort moved it to. Non-enumerable and
// symbol-keyed for the same reason as the derivations above; the `individuals`
// reference is the guard, so a copy or a rebuilt array is never reconciled
// against an order that describes a different one.
const ASSEMBLED_ROW_ORDER = Symbol("tmct.assembledRowOrder");

function carryRowOrder(payload, ids) {
  Object.defineProperty(payload, ASSEMBLED_ROW_ORDER, {
    value: { individuals: payload.individuals, ids },
    writable: true, configurable: true, enumerable: false,
  });
}

/** The row order this payload was assembled in, or null when it carries none
 *  or the one it carries describes a different individuals array. */
function carriedRowOrder(payload) {
  const carried = payload?.[ASSEMBLED_ROW_ORDER];
  if (!carried || carried.individuals !== payload.individuals) return null;
  return carried;
}

/** True when `removedIds` can be dropped from this payload's individuals
 *  incrementally — every id is one the assembly actually holds, and the payload
 *  still carries the row order that says which slot each one occupies. Asked
 *  before anything is mutated, so a caller that gets `false` can rebuild from a
 *  payload nothing has touched. */
export function canDropAssembledIndividuals(payload, removedIds) {
  const carried = carriedRowOrder(payload);
  if (!carried) return false;
  const held = new Set(carried.ids);
  for (const id of removedIds) if (!held.has(String(id))) return false;
  return true;
}

/** Drop `removedIds` from an assembled payload's individuals, in place, leaving
 *  the array a rebuild from the remaining rows would have produced. Reads the
 *  row order back, filters the dropped ids out of it, and refills the array in
 *  that order — so the fact slots that survive are the ones the surviving ROWS
 *  own, which is what `sortFactIndividualsById` then sorts into. Returns false
 *  when the payload has no usable row order, having changed nothing. */
export function dropAssembledIndividuals(payload, removedIds) {
  const carried = carriedRowOrder(payload);
  if (!carried) return false;
  const dropped = new Set([...removedIds].map((id) => String(id)));
  const byId = new Map();
  for (const ind of payload.individuals || []) if (ind?.id) byId.set(String(ind.id), ind);
  const keptIds = [];
  const kept = [];
  for (const id of carried.ids) {
    if (dropped.has(id)) continue;
    const ind = byId.get(id);
    if (!ind) return false;
    keptIds.push(id);
    kept.push(ind);
  }
  payload.individuals = kept;
  carried.individuals = kept;
  carried.ids = keptIds;
  return true;
}

/** Forget the row order this payload carries, for a caller that rewrote the ids
 *  the order names (the load-time legacy-fact-id heal). The next removal
 *  rebuilds from rows instead of patching. */
export function dropAssembledRowOrder(payload) {
  if (payload && payload[ASSEMBLED_ROW_ORDER]) payload[ASSEMBLED_ROW_ORDER] = null;
}

/** Record one newly-assembled individual's id at the tail of the row order —
 *  where a row keyed for the first time lands, since `payloadToRows` gives it an
 *  ord past every ord already assembled. A payload carrying no row order stays
 *  that way, and the next removal rebuilds instead of patching. */
export function appendAssembledRowOrder(payload, id) {
  const carried = carriedRowOrder(payload);
  if (carried) carried.ids.push(String(id));
}

/** What this payload can reconcile against, or null when it must derive
 *  instead. `index` identity is the guard: state that describes some other
 *  prose index cannot be applied to this one. `needSupersessions` narrows to
 *  the callers that maintain the backward pointers too. */
function carriedDerivationsOf(payload, { needSupersessions } = {}) {
  const carried = payload[CARRIED_DERIVATIONS];
  if (!carried || carried.index !== payload.proseIndex || !payload.proseIndex) return null;
  if (needSupersessions && !carried.successorsById) return null;
  return carried;
}

/** Where `id` sits in a sorted posting list, and whether it is there at all. */
function postingSlot(list, id) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid] < id) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Move one individual's contribution to the prose index from `before` to
 *  `after`, in place.
 *
 *  `buildProseIndex` produces, per word, the multiset of ids that named it —
 *  one entry per (individual, occurrence of the word in its token string) —
 *  sorted, with a word nobody names absent altogether. Dropping one entry per
 *  old occurrence and inserting one per new occurrence lands on exactly that
 *  multiset, and inserting in sorted position keeps exactly that order, so a
 *  reconciled index and a rebuilt one are the same object graph. */
function moveProseTokens(index, id, before, after) {
  if (before === after) return;
  for (const word of before ? before.split(" ") : []) {
    const list = index[word];
    if (!list) continue;
    const at = postingSlot(list, id);
    if (list[at] !== id) continue;
    list.splice(at, 1);
    if (!list.length) delete index[word];
  }
  for (const word of after ? after.split(" ") : []) {
    const list = index[word] || (index[word] = []);
    list.splice(postingSlot(list, id), 0, id);
  }
}

/** Re-derive each record's backward supersession pointer from the union of the
 *  forward ones. Two turns that superseded the same record concurrently both
 *  land, because each wrote its own row and neither touched the record they
 *  replaced.
 *
 *  Idempotent: a record that no longer has any successor loses the pointer it
 *  used to carry. Rows never carry one (`storedIndividualForm` strips it), so
 *  that arm is dead when this runs over a fresh projection and live when it
 *  runs again over individuals it already derived. */
function writeSupersededBy(ind, successors) {
  const carried = (ind?.attributes || []).some((a) => a?.prop === SUPERSEDED_BY_PROP);
  if (!successors && !carried) return;
  const rest = (ind.attributes || []).filter((a) => a?.prop !== SUPERSEDED_BY_PROP);
  ind.attributes = successors
    ? [...rest, { prop: SUPERSEDED_BY_PROP, key: "supersededBy", value: [...successors].sort().join(" ") }]
    : rest;
}

/** The forward supersession list one individual states, as the derivation reads
 *  it: a Fact's own `mgx:supersedes` value, and nothing at all from anything
 *  else, which is the same narrowing the from-scratch pass applies. */
const supersedesStatedBy = (ind, supersedes) => (ind?.class === FACT_CLASS ? supersedes : "");

/** Both derived structures over one payload, built from nothing and recorded so
 *  the next write can reconcile rather than repeat this. */
function deriveProseAndSupersessions(payload, individuals) {
  const successorsById = new Map();
  const tokensById = new Map();
  const supersedesById = new Map();
  for (const ind of individuals) {
    const { proseTokens, supersedes } = derivationInputsOf(ind);
    if (proseTokens) tokensById.set(ind.id, proseTokens);
    const stated = supersedesStatedBy(ind, supersedes);
    if (!stated) continue;
    supersedesById.set(ind.id, stated);
    for (const replaced of stated.split(" ").filter(Boolean)) {
      const successors = successorsById.get(replaced) || new Set();
      successors.add(ind.id);
      successorsById.set(replaced, successors);
    }
  }
  for (const ind of individuals) writeSupersededBy(ind, successorsById.get(ind?.id));
  // Released before the replacement is built, not after: over a seed-sized
  // store the prose index is the largest derived structure here, and holding
  // the outgoing one while the incoming one grows doubles it for no reason.
  payload.proseIndex = null;
  payload.proseIndex = buildProseIndex(individuals);
  carryForward(payload, { tokensById, supersedesById, successorsById });
}

/** Both derived structures brought up to date from the ones this payload
 *  already carries. One pass over the individuals reads what each contributes
 *  now; only what disagrees with what it contributed last time is applied.
 *
 *  A write touches a handful of records out of a seed's worth, so this pays for
 *  the walk and the handful, where the from-scratch build pays for every token
 *  in the store and sorts every posting list it produced. */
function reconcileProseAndSupersessions(payload, individuals, carried) {
  const { tokensById, supersedesById, successorsById } = carried;
  const index = payload.proseIndex;
  const resettled = new Set();
  const carriesPointer = new Set();
  let tokenBearers = 0;
  let supersedingRecords = 0;

  const forgetSupersedes = (id, replaced) => {
    const successors = successorsById.get(replaced);
    if (!successors?.delete(id)) return;
    if (!successors.size) successorsById.delete(replaced);
    resettled.add(replaced);
  };
  const recordSupersedes = (id, replaced) => {
    const successors = successorsById.get(replaced) || new Set();
    if (successors.has(id)) return;
    successors.add(id);
    successorsById.set(replaced, successors);
    resettled.add(replaced);
  };

  for (const ind of individuals) {
    const id = ind?.id;
    const { proseTokens, supersedes, carriesSupersededBy } = derivationInputsOf(ind);
    if (carriesSupersededBy) carriesPointer.add(id);

    if (proseTokens) tokenBearers += 1;
    const wasTokens = tokensById.get(id) || "";
    if (proseTokens !== wasTokens) {
      moveProseTokens(index, id, wasTokens, proseTokens);
      if (proseTokens) tokensById.set(id, proseTokens);
      else tokensById.delete(id);
    }

    const stated = supersedesStatedBy(ind, supersedes);
    if (stated) supersedingRecords += 1;
    const wasStated = supersedesById.get(id) || "";
    if (stated !== wasStated) {
      for (const replaced of wasStated.split(" ").filter(Boolean)) forgetSupersedes(id, replaced);
      for (const replaced of stated.split(" ").filter(Boolean)) recordSupersedes(id, replaced);
      if (stated) supersedesById.set(id, stated);
      else supersedesById.delete(id);
    }
  }

  // A caller that only added or rewrote individuals leaves both maps holding
  // exactly what the walk above just saw, and the counts say so. They disagree
  // only when an individual left the payload, which costs one more walk to
  // find and is the rarer write by far.
  if (tokensById.size !== tokenBearers || supersedesById.size !== supersedingRecords) {
    const present = new Set(individuals.map((ind) => ind?.id));
    for (const [id, tokens] of tokensById) {
      if (present.has(id)) continue;
      moveProseTokens(index, id, tokens, "");
      tokensById.delete(id);
    }
    for (const [id, stated] of supersedesById) {
      if (present.has(id)) continue;
      for (const replaced of stated.split(" ").filter(Boolean)) forgetSupersedes(id, replaced);
      supersedesById.delete(id);
    }
  }

  // Exactly the records the from-scratch pass rewrites: the ones with
  // successors and the ones already carrying a pointer. Both sets are bounded
  // by how many supersessions the store holds, which is a handful beside its
  // individuals, so this rewrites the same records for the same cost and leaves
  // the rest of the store alone.
  for (const id of carriesPointer) resettled.add(id);
  for (const id of successorsById.keys()) resettled.add(id);
  if (!resettled.size) return;
  for (const ind of individuals) {
    if (resettled.has(ind?.id)) writeSupersededBy(ind, successorsById.get(ind?.id));
  }
}

/** Recount `classes[]` from the assembled individuals, the same count-and-
 *  sample shape the store keeps. */
function recountedClasses(individuals) {
  const order = [MEMORY_SESSION_CLASS, UTTERANCE_CLASS, FACT_CLASS, SOURCE_CLASS, RULE_CLASS];
  const counted = new Map(order.map((name) => [name, { name, count: 0, sample: [] }]));
  for (const ind of individuals) {
    const row = counted.get(ind?.class);
    if (!row) continue;
    row.count += 1;
    if (row.sample.length < 3) row.sample.push(ind.label);
  }
  return order.map((name) => counted.get(name)).filter((row) => row.count);
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

  const rowOrderIds = [];
  const individuals = [];
  for (const entry of individualEntries) {
    if (!entry.individual) continue;
    individuals.push(entry.individual);
    rowOrderIds.push(String(entry.individual.id ?? ""));
  }
  payload.individuals = individuals;
  payload.objectProperties = groupEntries.map((e) => e.group).filter(Boolean);
  carryRowOrder(payload, rowOrderIds);
  return renormalizeAssembledPayload(payload);
}

/** Everything an assembled payload derives from its own individuals: the fact
 *  ordering, the backward supersession pointers, the class counts, the prose
 *  index and `generated_at`. `rowsToPayload` ends here, and so does a caller
 *  that assembled a payload once and then changed a few of its individuals in
 *  place — running this leaves the same payload either route, which is what
 *  lets a cached assembly be patched instead of rebuilt from its rows.
 *  Mutates and returns `payload`. */
export function renormalizeAssembledPayload(payload) {
  const individuals = payload.individuals || [];
  sortFactIndividualsById(individuals);
  const carried = carriedDerivationsOf(payload, { needSupersessions: true });
  if (carried) reconcileProseAndSupersessions(payload, individuals, carried);
  else deriveProseAndSupersessions(payload, individuals);
  payload.classes = recountedClasses(individuals);
  payload.generated_at = latestUtteranceTimestamp(individuals);
  return payload;
}

/** Only the prose index, reconciled the same way — for a caller that derives
 *  everything else itself and whose payload is not a row assembly
 *  (`mutateMemory` over a non-row backend). A payload with nothing to reconcile
 *  against gets the full build, and carries the state on so the next write
 *  reconciles. Mutates and returns `payload`. */
export function renormalizeProseIndex(payload) {
  const individuals = payload.individuals || [];
  const carried = carriedDerivationsOf(payload);
  if (!carried) {
    const tokensById = new Map();
    for (const ind of individuals) {
      const { proseTokens } = derivationInputsOf(ind);
      if (proseTokens) tokensById.set(ind.id, proseTokens);
    }
    payload.proseIndex = null;
    payload.proseIndex = buildProseIndex(individuals);
    carryForward(payload, { tokensById, supersedesById: null, successorsById: null });
    return payload;
  }
  const { tokensById } = carried;
  // This pass maintains the index and nothing else, so any supersession state
  // beside it stops describing the individuals it claims to and goes now,
  // rather than being reconciled against later.
  carried.supersedesById = null;
  carried.successorsById = null;
  const index = payload.proseIndex;
  let tokenBearers = 0;
  for (const ind of individuals) {
    const { proseTokens } = derivationInputsOf(ind);
    if (proseTokens) tokenBearers += 1;
    const wasTokens = tokensById.get(ind?.id) || "";
    if (proseTokens === wasTokens) continue;
    moveProseTokens(index, ind?.id, wasTokens, proseTokens);
    if (proseTokens) tokensById.set(ind.id, proseTokens);
    else tokensById.delete(ind?.id);
  }
  if (tokensById.size !== tokenBearers) {
    const present = new Set(individuals.map((ind) => ind?.id));
    for (const [id, tokens] of tokensById) {
      if (present.has(id)) continue;
      moveProseTokens(index, id, tokens, "");
      tokensById.delete(id);
    }
  }
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
