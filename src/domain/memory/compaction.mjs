// memory/compaction.mjs — bounding fact-record growth along its two separate
// axes, with a separate rollup for each.
//
// A triple's records grow two ways, and the ways mean different things:
//
//   - MANY SOURCES each asserting it once. Every one is a live head and a live
//     vote in the group fold, so a summary that absorbed them has to carry
//     their trust contribution forward or the compacted answer silently
//     under-trusts. That is `mgx:rollupPrior`.
//   - ONE SOURCE re-asserting it many times. Every record it replaced is a
//     demoted leaf that already contributes nothing (the fold reads heads
//     only), so absorbing them moves no number at all — it only shortens how
//     far back a walk can reach. A chain summary therefore carries NO prior,
//     and a compacted chain segment must not start contributing on the way out.
//
// Rolling both into one "keep newest K" pool would rank a chatty source's
// recent demoted leaves above a quiet source's still-live head, and compacting
// that head away is exactly the mistake the split exists to avoid. So: two
// pools per (triple, source type), each with its own trigger and its own id.
//
// Both summaries replicate, and deleting from a replicated grow-only set is not
// a G-Set operation — an uncoordinated delete comes back on the next sync. What
// closes that hole is making the summary carry the ids it absorbed, so
// absorption itself replicates: two summaries at one id merge by UNION of those
// ids, which is a join, so peers that compacted at different moments converge.
// Everything else on a summary (its count, its bounds, its prior) is derived
// from the union, so the whole record is a pure function of it — which is what
// makes the merge idempotent and order-independent rather than merely usually
// right.
//
// Pure: this module plans and merges summary RECORDS. core.mjs owns the payload.
// The CRDT vocabulary above (G-Set, join, replicated delete) is pinned in
// docs/references/papers/crdt.md.

const FACT_CLASS = "Fact";

// Starting guesses, not measurements — revisit against real store data once
// `tmct inspect`'s widest-group metric has something to report.
export const GROUP_ROLLUP_THRESHOLD = 64; // live heads of one type before pool 1 fires
export const ROLLUP_KEEP_PER_TYPE = 8;    // heads of that type kept intact
export const CHAIN_ROLLUP_THRESHOLD = 8;  // demoted leaves of one chain before pool 2 fires
export const CHAIN_KEEP_DEPTH = 2;        // leaves of that chain kept intact

export const ROLLUP_SOURCE_IDS_PROP = "mgx:rollupSourceIds"; // pool 1: the SOURCE ids absorbed
export const ROLLUP_RECORD_IDS_PROP = "mgx:rollupRecordIds"; // pool 2: the RECORD ids absorbed
export const ROLLUP_COUNT_PROP = "mgx:rollupCount";
export const ROLLUP_EARLIEST_PROP = "mgx:rollupEarliest";
export const ROLLUP_LATEST_PROP = "mgx:rollupLatest";
export const ROLLUP_PRIOR_PROP = "mgx:rollupPrior";

const HEAD_ROLLUP_MARKER = "@rollup:";
const CHAIN_ROLLUP_SUFFIX = "#rollup";

export const headRollupIdFor = (groupId, sourceType) => `${groupId}${HEAD_ROLLUP_MARKER}${sourceType}`;
export const chainRollupIdFor = (groupId, sourceId) => `${groupId}@${sourceId}${CHAIN_ROLLUP_SUFFIX}`;

export const isHeadRollupId = (id) => String(id || "").includes(HEAD_ROLLUP_MARKER);
export const isChainRollupId = (id) => String(id || "").endsWith(CHAIN_ROLLUP_SUFFIX);
export const isRollupId = (id) => isHeadRollupId(id) || isChainRollupId(id);

/** The source type a pool-1 summary covers, read back off the id that carries
 *  it. A summary is one type by construction, which is what keeps type priors
 *  and per-type ceilings computable over a compacted group. */
export function headRollupTypeOf(recordId) {
  const id = String(recordId || "");
  const at = id.indexOf(HEAD_ROLLUP_MARKER);
  return at < 0 ? "" : id.slice(at + HEAD_ROLLUP_MARKER.length);
}

const attrValue = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value || "";
const idList = (value) => String(value || "").split(" ").filter(Boolean);

export const absorbedSourceIds = (ind) => idList(attrValue(ind, ROLLUP_SOURCE_IDS_PROP));
export const absorbedRecordIds = (ind) => idList(attrValue(ind, ROLLUP_RECORD_IDS_PROP));

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
const round6 = (n) => Number(n.toFixed(6));

/** The noisy-OR base over a set of effective priors — the same corroboration
 *  math the group fold runs, with recency deliberately absent. Recency is a
 *  function of the reading moment, so a summary bakes in only what it knows at
 *  write time and the fold applies decay off `rollupLatest` on read. */
export function noisyOr(priors) {
  let complement = 1;
  let counted = 0;
  for (const p of priors) { complement *= 1 - clamp01(p); counted += 1; }
  return counted ? round6(Math.min(1, 1 - complement)) : 0;
}

/** Pick the earlier/later of two instants, tolerating "" and unparseable input
 *  on either side. Min-of-earliest and max-of-latest are both joins, which is
 *  why two summaries can merge in either order and agree. */
function pickInstant(a, b, pick) {
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (!Number.isFinite(at)) return Number.isFinite(bt) ? String(b) : "";
  if (!Number.isFinite(bt)) return String(a);
  return pick(at, bt) === at ? String(a) : String(b);
}
const earlierOf = (a, b) => pickInstant(a, b, Math.min);
const laterOf = (a, b) => pickInstant(a, b, Math.max);

/** Newest first, ties broken on the record id in codepoint order — the same
 *  locale-free determinism the rest of the fact layer sorts by, so two peers
 *  holding the same records choose the same keep-window. */
function byNewestFirst(a, b) {
  const at = Date.parse(a.assertedAt);
  const bt = Date.parse(b.assertedAt);
  const av = Number.isFinite(at) ? at : -Infinity;
  const bv = Number.isFinite(bt) ? bt : -Infinity;
  if (av !== bv) return bv - av;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function boundsOver(records, seedEarliest = "", seedLatest = "") {
  let earliest = seedEarliest;
  let latest = seedLatest;
  for (const r of records) {
    earliest = earlierOf(earliest, r.assertedAt);
    latest = laterOf(latest, r.assertedAt);
  }
  return { earliest, latest };
}

/**
 * Build a summary record from the ONLY things that define one: which ids it
 * absorbed, the span they covered, and (pool 1 only) how to price a source.
 * Both the compaction path and the merge path go through here, so a summary
 * built by absorbing and the same summary reached by merging two halves come
 * out byte-identical — which is the property the whole design rests on.
 */
function buildRollup({ id, sourceKey, template, idsProp, ids, earliest, latest, priorFor }) {
  const sorted = [...new Set(ids)].filter(Boolean).sort();
  const prior = priorFor ? noisyOr(sorted.map((sid) => priorFor(sid))) : undefined;
  return {
    id,
    label: template?.label || "",
    class: FACT_CLASS,
    derived_from: [],
    mentions: [],
    attributes: [
      { prop: "rdf:type", key: "type", value: "rdf:Statement" },
      { prop: "rdf:subject", key: "subject", value: template?.subject || "" },
      { prop: "rdf:predicate", key: "predicate", value: template?.predicate || "" },
      { prop: "rdf:object", key: "object", value: template?.object || "" },
      { prop: "mgx:createdAt", key: "createdAt", value: earliest },
      { prop: "mgx:sourceId", key: "sourceId", value: sourceKey },
      { prop: idsProp, key: idsProp === ROLLUP_SOURCE_IDS_PROP ? "rollupSourceIds" : "rollupRecordIds", value: sorted.join(" ") },
      { prop: ROLLUP_COUNT_PROP, key: "rollupCount", value: String(sorted.length) },
      { prop: ROLLUP_EARLIEST_PROP, key: "rollupEarliest", value: earliest },
      { prop: ROLLUP_LATEST_PROP, key: "rollupLatest", value: latest },
      ...(prior === undefined ? [] : [{ prop: ROLLUP_PRIOR_PROP, key: "rollupPrior", value: String(prior) }]),
    ],
  };
}

const templateOf = (record) => ({
  label: record?.label || "",
  subject: attrValue(record, "rdf:subject"),
  predicate: attrValue(record, "rdf:predicate"),
  object: attrValue(record, "rdf:object"),
});

/**
 * Pool 1. Given every LIVE HEAD of one type on one triple, decide whether that
 * type has grown past its threshold and, if so, which heads to absorb.
 *
 * `heads` are `{ id, sourceId, assertedAt, record }`. `existing` is the type's
 * current summary, if it already has one — its absorbed ids come along, so
 * compacting twice keeps one summary rather than growing a chain of them.
 * `priorFor(sourceId)` prices one absorbed source.
 *
 * Null when nothing should happen, which is the answer for very nearly every
 * fact in a store: under the threshold, no type at all, or nothing older than
 * the keep window.
 */
export function planHeadRollup({ groupId, sourceType, heads = [], existing = null, priorFor }) {
  if (!groupId || !sourceType) return null;            // never roll up across types, or an untyped record
  if (heads.length < GROUP_ROLLUP_THRESHOLD) return null;
  if (heads.length <= ROLLUP_KEEP_PER_TYPE) return null; // never the sole records of a type
  const ordered = heads.slice().sort(byNewestFirst);
  const absorb = ordered.slice(ROLLUP_KEEP_PER_TYPE);
  if (!absorb.length) return null;
  const { earliest, latest } = boundsOver(
    absorb,
    attrValue(existing, ROLLUP_EARLIEST_PROP),
    attrValue(existing, ROLLUP_LATEST_PROP),
  );
  const rollup = buildRollup({
    id: headRollupIdFor(groupId, sourceType),
    sourceKey: `rollup:${sourceType}`,
    template: templateOf(absorb[0].record || existing),
    idsProp: ROLLUP_SOURCE_IDS_PROP,
    ids: [...absorbedSourceIds(existing), ...absorb.map((h) => h.sourceId)],
    earliest,
    latest,
    priorFor,
  });
  return { rollup, absorbed: absorb.map((h) => h.id), absorbedSourceIds: absorb.map((h) => h.sourceId) };
}

/**
 * Pool 2. Given every DEMOTED LEAF of one source's own chain on one triple,
 * decide whether that chain has grown past its threshold and which leaves to
 * absorb. Triggers far more eagerly than pool 1 because nothing here is
 * trust-sensitive: no prior, no type-ceiling interaction, no read-time trust to
 * recompute.
 *
 * `leaves` are `{ id, assertedAt, record }`. The summary keeps the absorbed
 * span's BOUNDS rather than any exact instant, so a walk that lands inside it
 * gets "sometime in this window" and never a fabricated moment.
 */
export function planChainRollup({ groupId, sourceId, leaves = [], existing = null }) {
  if (!groupId || !sourceId) return null;
  if (leaves.length < CHAIN_ROLLUP_THRESHOLD) return null;
  if (leaves.length <= CHAIN_KEEP_DEPTH) return null;   // never the sole leaf of a chain
  const ordered = leaves.slice().sort(byNewestFirst);
  const keep = ordered.slice(0, CHAIN_KEEP_DEPTH);
  const absorb = ordered.slice(CHAIN_KEEP_DEPTH);
  if (!absorb.length) return null;
  const { earliest, latest } = boundsOver(
    absorb,
    attrValue(existing, ROLLUP_EARLIEST_PROP),
    attrValue(existing, ROLLUP_LATEST_PROP),
  );
  const rollup = buildRollup({
    id: chainRollupIdFor(groupId, sourceId),
    sourceKey: sourceId,
    template: templateOf(absorb[0].record || existing),
    idsProp: ROLLUP_RECORD_IDS_PROP,
    ids: [...absorbedRecordIds(existing), ...absorb.map((l) => l.id)],
    earliest,
    latest,
  });
  return { rollup, absorbed: absorb.map((l) => l.id), rewire: keep[keep.length - 1]?.id || "" };
}

/**
 * Join two summaries that share an id: union the absorbed ids, then re-derive
 * everything else from that union. Commutative, associative and idempotent
 * because union, min and max all are, and because count and prior are functions
 * of the union rather than independently accumulated state.
 *
 * The same call handles both pools; `priorFor` is supplied for pool 1 and
 * omitted for pool 2, which is what keeps a compacted chain segment from
 * starting to contribute trust on the way out.
 */
export function mergeRollups(existing, incoming, { priorFor } = {}) {
  const id = existing?.id || incoming?.id;
  const headPool = isHeadRollupId(id);
  const idsProp = headPool ? ROLLUP_SOURCE_IDS_PROP : ROLLUP_RECORD_IDS_PROP;
  const read = (ind) => idList(attrValue(ind, idsProp));
  return buildRollup({
    id,
    sourceKey: attrValue(existing, "mgx:sourceId") || attrValue(incoming, "mgx:sourceId"),
    template: templateOf(attrValue(existing, "rdf:subject") ? existing : incoming),
    idsProp,
    ids: [...read(existing), ...read(incoming)],
    earliest: earlierOf(attrValue(existing, ROLLUP_EARLIEST_PROP), attrValue(incoming, ROLLUP_EARLIEST_PROP)),
    latest: laterOf(attrValue(existing, ROLLUP_LATEST_PROP), attrValue(incoming, ROLLUP_LATEST_PROP)),
    priorFor: headPool ? priorFor : undefined,
  });
}

/** Is this source's assertion already absorbed into one of the group's pool-1
 *  summaries? A late or re-synced copy of an absorbed assertion must stay
 *  absorbed rather than reappearing as a live head — without this the next sync
 *  resurrects everything compaction just folded away, which is the failure mode
 *  that makes deleting from a replicated set hard in the first place. */
export function isAbsorbedSource(rollups, sourceId) {
  if (!sourceId) return false;
  for (const rollup of rollups || []) {
    if (absorbedSourceIds(rollup).includes(sourceId)) return true;
  }
  return false;
}

/** The same check for one source's own chain: a leaf id already inside the
 *  chain summary merges as a no-op re-absorption, never a re-insertion. */
export function isAbsorbedRecord(rollups, recordId) {
  if (!recordId) return false;
  for (const rollup of rollups || []) {
    if (absorbedRecordIds(rollup).includes(recordId)) return true;
  }
  return false;
}
