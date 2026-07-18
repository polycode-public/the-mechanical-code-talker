// worlds-pack.mjs — the pure half of the shipped worlds pack: the row-shape
// validators every writer and reader share, the provenance tag a loaded
// world's facts carry, and the closed rule-kind set a world may instate. The
// pack itself is one gzipped JSONL shard per world plus a gzipped world
// index; loading them is I/O and lives in src/adapters/corpus/worlds-pack.mjs.
//
// A world row is one of three kinds:
//   fact — an ordinary graph triple the loader appends into the session's
//          memory store (rooms, exits, placements, NPC cast);
//   rule — a pre-built action-Rule row (the same four action kinds the live
//          teach frames store) the loader instates via appendRule;
//   meta — the world's one announcement row (the opening line).

const WORLD_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The action-rule kinds a world shard may carry — the same closed set
 *  src/adapters/memory/core.mjs stores for live-taught actions. */
export const WORLD_RULE_KINDS = Object.freeze([
  "action-signature", "action-precond", "action-effect", "action-constraint",
]);

const RULE_KIND_SET = new Set(WORLD_RULE_KINDS);

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/** A pack world name: lowercase, hyphen-joined ("ashcombe-hall"). */
export function isWorldName(name) {
  return typeof name === "string" && WORLD_NAME_RE.test(name);
}

/** An index entry { s }: the shard (basename, no extension) holding the
 *  world's rows. */
export function isWorldsIndexEntry(e) {
  return !!e && typeof e === "object" && isNonEmptyString(e.s);
}

/** A fact row: { world, kind:"fact", subject, predicate, object }. */
export function isWorldFactRow(row) {
  return !!row && typeof row === "object" && row.kind === "fact"
    && isWorldName(row.world)
    && isNonEmptyString(row.subject) && isNonEmptyString(row.predicate) && isNonEmptyString(row.object);
}

/** A rule row: { world, kind:"rule", name, ruleKind, slots } — ruleKind one
 *  of WORLD_RULE_KINDS, slots a flat object of non-empty strings (the exact
 *  per-kind slot contract is appendRule's to enforce at instate time). */
export function isWorldRuleRow(row) {
  if (!row || typeof row !== "object" || row.kind !== "rule") return false;
  if (!isWorldName(row.world) || !isNonEmptyString(row.name)) return false;
  if (!RULE_KIND_SET.has(row.ruleKind)) return false;
  if (!row.slots || typeof row.slots !== "object" || Array.isArray(row.slots)) return false;
  const values = Object.values(row.slots);
  return values.length > 0 && values.every(isNonEmptyString);
}

/** A meta row: { world, kind:"meta", opening } — the world's opening line. */
export function isWorldMetaRow(row) {
  return !!row && typeof row === "object" && row.kind === "meta"
    && isWorldName(row.world) && isNonEmptyString(row.opening);
}

/** Any valid world row. */
export function isWorldRow(row) {
  return isWorldFactRow(row) || isWorldRuleRow(row) || isWorldMetaRow(row);
}

/** The provenance tag every fact/rule loaded from a world carries —
 *  "world:<name>", so a loaded world is auditable apart from taught facts. */
export function worldProvenanceTag(worldName) {
  return `world:${worldName}`;
}
