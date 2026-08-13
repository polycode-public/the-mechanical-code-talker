// memory/retraction.mjs — making a retraction survive the next sync.
//
// removeFacts is a real delete, and deleting from a replicated grow-only set is
// not a G-Set operation: a peer that still holds the fact re-sends it and the
// retraction is undone. What closes that hole is the move compaction's chain
// summary already makes. The retraction leaves a RECORD behind, the record
// carries the record ids it suppressed, and two records at one id merge by
// UNION of those ids. Union is a join, so two peers that retracted at different
// moments converge, and merging twice changes nothing.
//
// A retraction suppresses ONE SOURCE'S assertion, not the whole triple group.
// Two peers who independently taught the same fact hold two records; one of
// them retracting leaves the fact standing and cited to the other, and the
// retraction stays on record rather than erasing what was asserted. That falls
// out of absorbing concrete record ids: a record another peer holds and this
// one never did is not in the set.
//
// The instant matters as much as the ids. One source asserting the same triple
// again lands on the SAME content address, so an id on its own cannot tell a
// suppressed assertion from a later, deliberate one. The record therefore
// carries the moment of the retraction, and both enforcement points compare an
// assertion's own time against it: at or before, suppressed; after, it stands.
// Max is a join too, so that field merges in either order and agrees.
//
// Pure: this module plans, merges and encodes retraction RECORDS. core.mjs owns
// the store. Its own class, its own id suffix and its own predicate keep it
// clear of compaction — a compacted record and a
// retracted one mean opposite things, and one namespace would let a summary
// read as a tombstone. The CRDT vocabulary above is pinned in
// docs/references/papers/crdt.md.

export const RETRACTION_CLASS = "Retraction";

/** The predicate a retraction travels under. */
export const RETRACTION_PREDICATE = "mgx:retracted";

export const RETRACTED_RECORD_IDS_PROP = "mgx:retractedRecordIds";
export const RETRACTED_AT_PROP = "mgx:retractedAt";
export const RETRACTED_COUNT_PROP = "mgx:retractedCount";

const RETRACTION_SUFFIX = "#retracted";
const PROVENANCE_PROP = "mgx:factProvenance";
const NO_INSTANT = "-";

/** One retraction record per (triple, source), the same per-source shape
 *  compaction's chain summary keys on. */
export const retractionIdFor = (groupId, sourceId) => `${groupId}@${sourceId}${RETRACTION_SUFFIX}`;
export const isRetractionId = (id) => String(id || "").endsWith(RETRACTION_SUFFIX);

/** The record id a retraction suppresses, read back off its own id. */
export function retractionScopeOf(retractionId) {
  const id = String(retractionId || "");
  return isRetractionId(id) ? id.slice(0, -RETRACTION_SUFFIX.length) : "";
}

const attrValue = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value || "";
const idList = (value) => String(value || "").split(" ").filter(Boolean);
const tagList = (value) => String(value || "").split(" | ").filter(Boolean);

export const retractedRecordIds = (ind) => idList(attrValue(ind, RETRACTED_RECORD_IDS_PROP));
export const retractedAtOf = (ind) => attrValue(ind, RETRACTED_AT_PROP);

/** The later of two instants, tolerating "" and unparseable input on either
 *  side. Max is a join, which is what lets two records merge in either order. */
function laterOf(a, b) {
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (!Number.isFinite(at)) return Number.isFinite(bt) ? String(b) : "";
  if (!Number.isFinite(bt)) return String(a);
  return bt > at ? String(b) : String(a);
}

const templateOf = (record) => ({
  label: record?.label || "",
  subject: attrValue(record, "rdf:subject"),
  predicate: attrValue(record, "rdf:predicate"),
  object: attrValue(record, "rdf:object"),
});

/**
 * Build a retraction record from the only things that define one: which record
 * ids it suppressed, when, and who said so. Planning and merging both come
 * through here, so a record built by retracting and the same record reached by
 * merging two halves come out identical — the property the whole design rests
 * on. The triple it names is carried for a reader; nothing enforces on it.
 */
function buildRetraction({ id, sourceId, template, ids, retractedAt, tags }) {
  const sorted = [...new Set(ids)].filter(Boolean).sort();
  const provenance = [...new Set(tags)].filter(Boolean).sort();
  return {
    id,
    label: template?.label || "",
    class: RETRACTION_CLASS,
    derived_from: [],
    mentions: [],
    attributes: [
      { prop: "rdf:subject", key: "subject", value: template?.subject || "" },
      { prop: "rdf:predicate", key: "predicate", value: template?.predicate || "" },
      { prop: "rdf:object", key: "object", value: template?.object || "" },
      { prop: "mgx:sourceId", key: "sourceId", value: sourceId || "" },
      { prop: RETRACTED_RECORD_IDS_PROP, key: "retractedRecordIds", value: sorted.join(" ") },
      { prop: RETRACTED_COUNT_PROP, key: "retractedCount", value: String(sorted.length) },
      { prop: RETRACTED_AT_PROP, key: "retractedAt", value: retractedAt || "" },
      ...(provenance.length ? [{ prop: PROVENANCE_PROP, key: "provenance", value: provenance.join(" | ") }] : []),
    ],
  };
}

/**
 * Plan the record one source's retraction leaves behind. `recordIds` are the
 * ids actually removed for that source — its head, its demoted leaves, and any
 * summary standing for them. `existing` is the record this source already has
 * here, if the triple has been retracted before; its ids come along, so
 * retracting twice keeps one record rather than growing a chain of them.
 *
 * Null when there is nothing to suppress, which keeps a no-op removal from
 * writing a tombstone for a fact nobody ever asserted.
 */
export function planRetraction({ groupId, sourceId, recordIds = [], retractedAt = "", existing = null, template = null, provenance = "" }) {
  if (!groupId || !sourceId) return null;
  const ids = [...retractedRecordIds(existing), ...recordIds].filter(Boolean);
  if (!ids.length) return null;
  return buildRetraction({
    id: retractionIdFor(groupId, sourceId),
    sourceId,
    template: template || templateOf(existing),
    ids,
    retractedAt: laterOf(retractedAtOf(existing), retractedAt),
    tags: [...tagList(attrValue(existing, PROVENANCE_PROP)), ...tagList(provenance)],
  });
}

/**
 * Join two retraction records that share an id: union the suppressed ids and
 * the tags, take the later instant, then re-derive everything else from that.
 * Commutative, associative and idempotent, because union and max both are and
 * because the count is a function of the union rather than a separate running
 * total.
 */
export function mergeRetractions(existing, incoming) {
  const template = templateOf(attrValue(existing, "rdf:subject") ? existing : incoming);
  return buildRetraction({
    id: existing?.id || incoming?.id,
    sourceId: attrValue(existing, "mgx:sourceId") || attrValue(incoming, "mgx:sourceId"),
    template,
    ids: [...retractedRecordIds(existing), ...retractedRecordIds(incoming)],
    retractedAt: laterOf(retractedAtOf(existing), retractedAtOf(incoming)),
    tags: [...tagList(attrValue(existing, PROVENANCE_PROP)), ...tagList(attrValue(incoming, PROVENANCE_PROP))],
  });
}

/** Whether an assertion made at `assertedAt` is old enough for the retraction
 *  to bite. An assertion with no readable time cannot show it is newer, so it
 *  is suppressed; the same goes for a record whose own instant will not parse.
 *  Erring this way keeps a resurrected copy out, and a source that means to say
 *  the thing again says it with a fresh tag. */
function notLaterThan(assertedAt, retractedAt) {
  const asserted = Date.parse(assertedAt);
  const retracted = Date.parse(retractedAt);
  if (!Number.isFinite(retracted) || !Number.isFinite(asserted)) return true;
  return asserted <= retracted;
}

/** Does this record suppress `recordId` as asserted at `assertedAt`? */
export function suppressesRecord(retraction, recordId, assertedAt = "") {
  if (!retraction || !recordId) return false;
  if (!retractedRecordIds(retraction).includes(recordId)) return false;
  return notLaterThan(assertedAt, retractedAtOf(retraction));
}

/** The same check across a group's records. Both enforcement halves — the strip
 *  on read and the refusal on ingest — ask exactly this question. */
export function isRetractedRecord(retractions, recordId, assertedAt = "") {
  for (const retraction of retractions || []) {
    if (suppressesRecord(retraction, recordId, assertedAt)) return true;
  }
  return false;
}

/** The instant and the ids packed into one triple slot. The instant leads, ids
 *  follow, space separated — neither an ISO instant nor a record id carries a
 *  space, so the split is unambiguous. */
export function encodeRetractionValue(retractedAt, ids) {
  const sorted = [...new Set(ids || [])].filter(Boolean).sort();
  return [retractedAt || NO_INSTANT, ...sorted].join(" ");
}

export function decodeRetractionValue(value) {
  const parts = String(value || "").split(" ").filter(Boolean);
  const head = parts[0] || "";
  const retractedAt = head === NO_INSTANT || !Number.isFinite(Date.parse(head)) ? "" : head;
  const ids = retractedAt || head === NO_INSTANT ? parts.slice(1) : parts;
  return { retractedAt, ids };
}

/** A stored record as the one wire fact that carries it: the record id it
 *  suppresses as the subject, the retraction predicate, and the instant plus
 *  the suppressed ids as the object. Everything else on the record is derived
 *  from those, so the round trip loses nothing a peer enforces on. */
export function retractionWireFact(record) {
  const scope = retractionScopeOf(record?.id);
  if (!scope) return null;
  return {
    id: record.id,
    subject: scope,
    predicate: RETRACTION_PREDICATE,
    object: encodeRetractionValue(retractedAtOf(record), retractedRecordIds(record)),
    provenance: attrValue(record, PROVENANCE_PROP),
  };
}

/** The other direction: a received wire fact as the record it stands for.
 *  Null for anything that is not a well-formed retraction, so a malformed
 *  message is dropped rather than merged. */
export function retractionFromWire(fact) {
  if (!fact || fact.predicate !== RETRACTION_PREDICATE) return null;
  const scope = String(fact.subject || "");
  const at = scope.indexOf("@");
  if (at <= 0 || at === scope.length - 1) return null;
  const { retractedAt, ids } = decodeRetractionValue(fact.object);
  if (!ids.length) return null;
  return buildRetraction({
    id: `${scope}${RETRACTION_SUFFIX}`,
    sourceId: scope.slice(at + 1),
    template: null,
    ids,
    retractedAt,
    tags: tagList(fact.provenance),
  });
}
