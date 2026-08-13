// A deterministic sqlite store and a canonical dump of it — the fixture behind
// the stored-bytes pin in memory-sqlite-conformance.test.mjs.
//
// Determinism comes from two places: every append carries an explicit embedded
// timestamp, and the wall clock is frozen for the whole build, so the audit
// stamps (`mgx:createdAt`, `mgx:updatedAt`, the head's `updated_at`, the
// supersession chain's `recorded_at`) land on one fixed instant.
//
// The dump carries the schema and every table's rows. `edges` is dumped with
// its rowid because the rowid IS the stored order there: reads come back
// `ORDER BY rowid`, and a changed edge moving to the end of its group is a
// deliberate recency semantic, not an accident of insertion.

import {
  appendFact, appendFacts, appendRule, appendUtterances, removeFacts,
  loadMemory, readFactRows, saveSyllogiseState,
  RULE_KIND_COMPOSE2, RULE_KIND_FILTER,
} from "../../src/adapters/memory/core.mjs";

const FROZEN_INSTANT = Date.parse("2026-03-04T05:06:07.008Z");
const SESSION = "01890000-0000-7000-8000-0000000000aa";

/** Run `body` with `new Date()` and `Date.now()` pinned to one instant, so
 *  every stamp a write leaves behind is reproducible. Explicit arguments still
 *  build the date they name, and parsing is untouched. */
export async function withFrozenClock(body) {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(FROZEN_INSTANT);
      else super(...args);
    }

    static now() { return FROZEN_INSTANT; }
  }
  globalThis.Date = FrozenDate;
  try {
    return await body();
  } finally {
    globalThis.Date = RealDate;
  }
}

const at = (day) => `2026-07-0${day}T00:00:00.000Z`;

/** Write one of every shape the seven tables hold: utterances and their edges,
 *  facts from two sources on one triple, a same-source supersession, a moving
 *  latest-observation-wins winner, rules, and a retraction. */
export async function populateSqliteStore(handle) {
  await appendUtterances(handle, [
    { role: "visitor", text: "a dog can bark", ts: at(1), sessionId: SESSION, sessionStarted: at(1) },
    { role: "tmct", text: "noted: a dog can bark", ts: at(1), sessionId: SESSION, replyTo: null },
  ]);

  await appendFacts(handle, [
    { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:human /r/CapableOf" },
    { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: `teach:chat:s1@${at(1)}` },
    { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA" },
  ]);

  // The same source saying it again, later: a supersession inside one lineage.
  await appendFact(handle, { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: `teach:chat:s1@${at(9)}` });

  // A latest-observation-wins winner that moves twice: the supersession chain.
  for (const [object, day] of [["hall", 1], ["attic", 2], ["cellar", 3]]) {
    await appendFact(handle, { subject: "lamp", predicate: "mgx:located-in", object, provenance: `teach:chat:s1@${at(day)}` });
  }

  await appendRule(handle, {
    name: "grandparent", kind: RULE_KIND_COMPOSE2,
    slots: { base1: "parent", base2: "parent" }, provenance: `teach:chat:s1@${at(1)}`,
  });
  await appendRule(handle, {
    name: "big-dog", kind: RULE_KIND_FILTER,
    slots: { base: "dog", property: "large" }, provenance: `teach:chat:s1@${at(1)}`,
  });

  // The delete path: a retraction removes a group's records and re-materialises
  // what it touched.
  const tail = readFactRows(await loadMemory(handle)).find((row) => row.object === "tail");
  await removeFacts(handle, [tail.id], { provenance: `teach:chat:s1@${at(9)}`, retractedAt: at(9) });

  // The sidecar lands in `meta` beside the payload's own scalars.
  await saveSyllogiseState(handle, { version: 1, factIds: ["fact:0000000000000001"], completedAt: at(9) });
}

// The rows of each table, in an order the storage itself defines.
const TABLE_READS = [
  ["meta", "SELECT k, v FROM meta ORDER BY k"],
  ["individuals", "SELECT id, ord, class, label, json FROM individuals ORDER BY ord, id"],
  ["relations", "SELECT prop, ord, predicate, count FROM relations ORDER BY ord, prop"],
  ["edges", "SELECT rowid AS rowid, prop, subject, object, subject_label, object_label, extra FROM edges ORDER BY rowid"],
  ["facts", "SELECT * FROM facts ORDER BY id"],
  ["fact_heads", "SELECT triple_hash, trust_base, inputs_json, updated_at FROM fact_heads ORDER BY triple_hash"],
  [
    "fact_object_supersessions",
    "SELECT subject, predicate, ord, from_id, to_id, recorded_at FROM fact_object_supersessions ORDER BY subject, predicate, ord",
  ],
];

/** The whole store as one canonical string: the schema every object was
 *  created with, then every row of every table. */
export function dumpSqliteStore(handle) {
  const db = handle.db;
  const lines = ["# schema"];
  for (const row of db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all()) {
    lines.push(JSON.stringify({ type: row.type, name: row.name, table: row.tbl_name, sql: row.sql }));
  }
  for (const [table, sql] of TABLE_READS) {
    lines.push(`# ${table}`);
    for (const row of db.prepare(sql).all()) lines.push(JSON.stringify(row));
  }
  return `${lines.join("\n")}\n`;
}
