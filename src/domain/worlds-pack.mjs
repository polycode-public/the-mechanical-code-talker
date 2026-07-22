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

const DEFAULT_CONTAINS_PREDICATE = "mgx:default-contains";

/** Materialize a world's class-default contents: for every
 *  `<room> mgx:default-contains <class>` fact, mint one placed, portable
 *  instance of that class in that room unless the room already holds one. A
 *  minted book gets `rdf:type <class>` (so it resolves its own sprite),
 *  `rdf:type portable` (so the take family accepts it), and
 *  `mgx:located-in <room>` (so it shows up in the room and can be carried
 *  out). Pure and deterministic: defaults are visited in sorted order, and a
 *  collision mints `<class>-2`, `<class>-3`… so re-running never renames an
 *  earlier instance. Rows keep whatever world/kind wrapper the input rows
 *  carry, so both a loaded shard (world rows) and a bare triple list expand
 *  the same way. */
export function expandWorldDefaultContents(facts) {
  const rows = facts || [];
  const defaults = rows
    .filter((r) => r.predicate === DEFAULT_CONTAINS_PREDICATE)
    .sort((a, b) => `${a.subject}\0${a.object}`.localeCompare(`${b.subject}\0${b.object}`));
  if (!defaults.length) return rows;

  const instanceIds = new Set(rows.filter((r) => r.predicate === "rdf:type").map((r) => r.subject));
  const placedIn = new Map();
  for (const r of rows) {
    if (r.predicate === "mgx:located-in") placedIn.set(r.subject, r.object);
  }
  const roomAlreadyHas = (klass, room) =>
    rows.some((r) => r.predicate === "rdf:type" && r.object === klass && placedIn.get(r.subject) === room);

  const wrapper = rows.find((r) => typeof r.world === "string" && r.kind === "fact");
  const wrap = (subject, predicate, object) => ({
    ...(wrapper ? { world: wrapper.world, kind: "fact" } : {}),
    subject, predicate, object,
  });

  const minted = [];
  for (const d of defaults) {
    const room = d.subject;
    const klass = d.object;
    if (roomAlreadyHas(klass, room)) continue;
    let id = klass;
    let n = 1;
    while (instanceIds.has(id)) { n += 1; id = `${klass}-${n}`; }
    instanceIds.add(id);
    minted.push(wrap(id, "rdf:type", klass));
    minted.push(wrap(id, "rdf:type", "portable"));
    minted.push(wrap(id, "mgx:located-in", room));
  }
  return minted.length ? [...rows, ...minted] : rows;
}
