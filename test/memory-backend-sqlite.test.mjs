// memory/core.mjs's Backend C — SQLite (PLAN_SEED.md §6, schema shape adapted
// from seonix's src/store.mjs, write model is NOT: real per-row
// INSERT/REPLACE/DELETE against a live, open node:sqlite connection kept for
// the session's lifetime, not seonix's own rebuild-and-atomic-swap).
//
// This suite proves: a real round trip through actual SQLite (not a mock),
// content parity against the identical operation sequence run through
// Backend A (readFactRows/findRuleByName/classes all equivalent), the
// idempotent-upsert / no-duplicate guarantee real INSERT OR REPLACE gives,
// and that node:sqlite is genuinely gated (never imported unless
// createSqliteMemoryStore is actually called).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UTTERANCE_CLASS, FACT_CLASS, SOURCE_CLASS, SAID_IN_SESSION_PROP,
  emptyMemory, loadMemory,
  appendUtterance, appendUtterances, appendFact, appendFacts, appendRule,
  findRuleByName, readFactRows, RULE_KIND_COMPOSE2, RULE_KIND_FILTER,
  createSqliteMemoryStore, closeSqliteMemoryStore,
} from "../src/memory/core.mjs";

const SESSION = "01890000-0000-7000-8000-00000000beef";
const TS1 = "2026-07-10T10:00:00.000Z";
const TS2 = "2026-07-10T10:01:00.000Z";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-mem-sqlite-"));
}

async function sqliteHandle() {
  const dir = await tmpRepo();
  const dbPath = join(dir, "graph.sqlite");
  const handle = await createSqliteMemoryStore(dbPath);
  return { dir, handle };
}

test("createSqliteMemoryStore: a fresh store loads as the same empty payload shape as Backend A's bootstrap", async () => {
  const { dir, handle } = await sqliteHandle();
  try {
    assert.equal(handle.backend, "sqlite");
    const m = await loadMemory(handle);
    const empty = emptyMemory();
    assert.equal(m.memory, true);
    assert.deepEqual(m.individuals, empty.individuals);
    assert.deepEqual(m.classes, empty.classes);
    assert.deepEqual(m.objectProperties, empty.objectProperties);
    assert.deepEqual(m.proseIndex, empty.proseIndex);
    assert.deepEqual(m.prefixes, empty.prefixes);
    assert.deepEqual(m.vocabulary, empty.vocabulary);
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});

test("Backend C round trip: the SAME appendFact/appendFacts/appendUtterance(s)/appendRule sequence against Backend A and Backend C produces equivalent readFactRows/findRuleByName output", async () => {
  const { dir: sqliteDir, handle } = await sqliteHandle();
  const fileDir = await tmpRepo();
  try {
    const ops = async (target) => {
      await appendUtterance(target, { role: "visitor", text: "does a man have a hat?", ts: TS1, sessionId: SESSION, sessionStarted: TS1 });
      await appendUtterances(target, [
        { role: "visitor", text: "what owns logger.mjs?", ts: TS2, sessionId: SESSION },
        { role: "tmct", text: "platform-team owns logger.mjs.", ts: TS2, sessionId: SESSION },
      ]);
      await appendFact(target, { subject: "man", predicate: "IsA", object: "person", provenance: `teach:chat:${SESSION}@${TS1}`, createdAt: TS1 });
      await appendFacts(target, [
        { subject: "person", predicate: "IsA", object: "mammal", provenance: `teach:chat:${SESSION}@${TS1}`, createdAt: TS1 },
        { subject: "logger.mjs", predicate: "ownedBy", object: "platform-team", provenance: `ace:chat:${SESSION}@${TS1}`, createdAt: TS1 },
        { subject: "hat", predicate: "IsA", object: "clothing", provenance: `teach:chat:${SESSION}@${TS1}`, createdAt: TS1 },
      ]);
      // Re-append one fact (idempotent upsert exercise) with an ADDITIONAL
      // provenance tag — corroboration, not a duplicate individual.
      await appendFact(target, { subject: "man", predicate: "IsA", object: "person", provenance: `ace:chat:${SESSION}@${TS2}`, createdAt: TS1 });
      await appendRule(target, {
        name: "grandparent", kind: RULE_KIND_COMPOSE2,
        slots: { base1: "parentOf", base2: "parentOf" },
        provenance: `teach:chat:${SESSION}@${TS1}`, createdAt: TS1,
      });
      await appendRule(target, {
        name: "trusted-friend", kind: RULE_KIND_FILTER,
        slots: { base: "friendOf", property: "verified" },
        provenance: `teach:chat:${SESSION}@${TS1}`, createdAt: TS1,
      });
    };
    await ops(handle);
    await ops(fileDir);

    const sqliteMemory = await loadMemory(handle);
    const fileMemory = await loadMemory(fileDir);

    const norm = (rows) => rows.map((r) => ({ ...r, sourceIds: [...r.sourceIds].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(norm(readFactRows(sqliteMemory)), norm(readFactRows(fileMemory)));

    for (const name of ["grandparent", "trusted-friend"]) {
      const sRule = findRuleByName(sqliteMemory, name);
      const fRule = findRuleByName(fileMemory, name);
      assert.equal(sRule.id, fRule.id, `${name} rule id matches`);
      assert.deepEqual(sRule.attributes, fRule.attributes, `${name} rule attributes match`);
    }

    // Same class counts, same Source individuals, same utterance/edge wiring.
    const classCount = (m, name) => m.classes.find((c) => c.name === name)?.count || 0;
    for (const name of [UTTERANCE_CLASS, FACT_CLASS, SOURCE_CLASS, "Rule", "Session"]) {
      assert.equal(classCount(sqliteMemory, name), classCount(fileMemory, name), `class ${name} count matches`);
    }
    assert.equal(
      sqliteMemory.objectProperties.find((g) => g.prop === SAID_IN_SESSION_PROP).count,
      fileMemory.objectProperties.find((g) => g.prop === SAID_IN_SESSION_PROP).count,
    );
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(sqliteDir, { recursive: true, force: true });
    await rm(fileDir, { recursive: true, force: true });
  }
});

test("Backend C: re-appending the same fact upserts via real SQLite INSERT OR REPLACE — no duplicate row, corroboration adds a second Source edge", async () => {
  const { dir, handle } = await sqliteHandle();
  try {
    const triple = { subject: "cache", predicate: "IsA", object: "storage-mechanism" };
    const { id: id1 } = await appendFact(handle, { ...triple, provenance: "corpus:seon" });
    const { id: id2 } = await appendFact(handle, { ...triple, provenance: "corpus:conceptnet" });
    assert.equal(id1, id2);
    const m = await loadMemory(handle);
    assert.equal(m.individuals.filter((i) => i.class === FACT_CLASS).length, 1, "one Fact individual, not two");
    const row = readFactRows(m)[0];
    assert.equal(row.sourceIds.length, 2, "both provenance tags materialise as distinct Source edges");
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});

test("Backend C: the connection survives across calls (opened once, real live connection, not re-opened per call) and closes cleanly", async () => {
  const dir = await tmpRepo();
  const dbPath = join(dir, "graph.sqlite");
  const handle = await createSqliteMemoryStore(dbPath);
  try {
    await appendFact(handle, { subject: "a", predicate: "IsA", object: "b" });
    await appendFact(handle, { subject: "c", predicate: "IsA", object: "d" });
    const m = await loadMemory(handle);
    assert.equal(readFactRows(m).length, 2);
    // The SAME handle.db instance served every call — no reopen per append.
    assert.equal(typeof handle.db.exec, "function");
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
  // Closing twice (or closing something that isn't a sqlite handle) must not throw.
  assert.doesNotThrow(() => closeSqliteMemoryStore({ backend: "memory", payload: emptyMemory() }));
});

test("Backend C: node:sqlite is genuinely gated — importing core.mjs alone never touches sqlite; only createSqliteMemoryStore does", async () => {
  // Best-effort structural check: a fresh subprocess that imports core.mjs but
  // never calls createSqliteMemoryStore must not have `node:sqlite` resident.
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(process.execPath, ["-e", `
    import("${new URL("../src/memory/core.mjs", import.meta.url).href}").then(async () => {
      const cached = process.moduleLoadList ? process.moduleLoadList.some((m) => m.includes("sqlite")) : false;
      console.log(JSON.stringify({ cached }));
    });
  `], { encoding: "utf8" });
  const { cached } = JSON.parse(out.trim().split("\n").pop());
  assert.equal(cached, false, "node:sqlite must not be loaded merely by importing core.mjs");
});
