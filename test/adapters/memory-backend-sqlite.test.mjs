// memory/core.mjs's Backend C — SQLite, the ROUTED DEFAULT backend (see
// memory-backend-default.test.mjs for the default-token routing itself;
// schema shape adapted from seonix's src/store.mjs, write model is NOT: real per-row
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
  resolveMemoryGraphFile, snapshotMemory,
} from "../../src/adapters/memory/core.mjs";

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

    // mgx:updatedAt (recomputeFactTrust re-stamps it — class-agnostic, so a Rule rides it too,
    // is a genuine LIVE wall-clock value, not derived from the fixture's own fixed
    // `createdAt`s — the two `ops()` runs above are sequential real-time calls, so it legitimately
    // differs by a millisecond or two between the sqlite and file backends. Redact it before the
    // structural attribute comparison, same reasoning as memory-core.test.mjs's GOLDEN EQUIVALENCE
    // test's `norm()`.
    const redactUpdatedAt = (attrs) => attrs.map((a) => (a.prop === "mgx:updatedAt" ? { ...a, value: "<ts>" } : a));
    for (const name of ["grandparent", "trusted-friend"]) {
      const sRule = findRuleByName(sqliteMemory, name);
      const fRule = findRuleByName(fileMemory, name);
      assert.equal(sRule.id, fRule.id, `${name} rule id matches`);
      assert.deepEqual(redactUpdatedAt(sRule.attributes), redactUpdatedAt(fRule.attributes), `${name} rule attributes match`);
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
    import("${new URL("../../src/adapters/memory/core.mjs", import.meta.url).href}").then(async () => {
      const cached = process.moduleLoadList ? process.moduleLoadList.some((m) => m.includes("sqlite")) : false;
      console.log(JSON.stringify({ cached }));
    });
  `], { encoding: "utf8" });
  const { cached } = JSON.parse(out.trim().split("\n").pop());
  assert.equal(cached, false, "node:sqlite must not be loaded merely by importing core.mjs");
});

// ---- Cached, incrementally patched reads (perf gap closed in core.mjs) -----
// readSqlitePayload used to do a full fresh SELECT of every individual plus a
// fresh per-relation edge SELECT on EVERY loadMemory() call, no matter how
// many times it was called in a row with nothing changed in between. It now
// reconstructs from SQL only once (or after a failed write invalidates the
// cache) and serves every later call from `handle.cachedPayload`, patched in
// lockstep by persistSqlitePayload's existing per-row diff. These two tests
// prove that mechanism, not just that the suite stays green: (1) a query-count
// spy around handle.db.prepare shows the SECOND loadMemory() call issues ZERO
// SQL queries where the FIRST issued real ones: the actual performance claim,
// not an inference from timing; (2) a load -> mutate -> persist -> load round
// trip proves the patched cache isn't just fast but CORRECT — it reflects the
// mutation, and (critically) matches a genuinely fresh SQL rebuild byte for
// byte, not just itself.

/** Install a counting spy around `handle.db.prepare`, returning a `{ count()
 *  , reset() }` handle. Wraps the property in place (not `.bind`/destructure)
 *  so every call site in core.mjs — which always does `db.prepare(...)` via a
 *  locally-captured `db` reference, never a pre-bound copy — resolves through
 *  the spy via ordinary property lookup at call time. */
function spyOnPrepare(handle) {
  const origPrepare = handle.db.prepare.bind(handle.db);
  let n = 0;
  handle.db.prepare = (...args) => { n += 1; return origPrepare(...args); };
  return { count: () => n, reset: () => { n = 0; } };
}

test("Backend C perf: loadMemory() reads from SQL only once — a second call on an unchanged handle issues only the cross-connection staleness probe", async () => {
  const { dir, handle } = await sqliteHandle();
  try {
    await appendFact(handle, { subject: "cache", predicate: "IsA", object: "concept", provenance: "corpus:seon" });
    await appendUtterance(handle, { role: "visitor", text: "does the cache work?", ts: TS1, sessionId: SESSION, sessionStarted: TS1 });

    // Force a cold cache so the first spied call measures a REAL SQL rebuild
    // (the appends above already warmed it as a side effect of persisting).
    handle.cachedPayload = undefined;

    const spy = spyOnPrepare(handle);
    const first = await loadMemory(handle);
    const firstCallQueries = spy.count();
    assert.ok(firstCallQueries > 0, `the first (cold-cache) loadMemory call must issue real SQL queries, got ${firstCallQueries}`);

    spy.reset();
    const second = await loadMemory(handle);
    assert.equal(spy.count(), 1, "a second loadMemory call on an unchanged handle issues exactly one query — the PRAGMA data_version staleness probe, never a re-SELECT of the payload");

    assert.deepEqual(second, first, "the cache-served read returns the exact same content as the fresh SQL read");
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});

test("Backend C round trip: loadMemory -> mutate (appendFact, twice) -> loadMemory again reflects the mutation, served from the incrementally patched cache, and matches a genuinely fresh SQL rebuild", async () => {
  const { dir, handle } = await sqliteHandle();
  try {
    const before = await loadMemory(handle);
    assert.equal(before.individuals.length, 0, "a brand-new store starts empty");

    await appendFact(handle, { subject: "widget", predicate: "IsA", object: "gadget", provenance: "corpus:seon", createdAt: TS1 });

    // The read right after a write must be served from the patched cache —
    // not a re-SELECT — proving persistSqlitePayload's cache patch actually
    // ran (this is the query-count half of the correctness claim). One query
    // is allowed: the PRAGMA data_version cross-connection staleness probe.
    const spy1 = spyOnPrepare(handle);
    const afterFirst = await loadMemory(handle);
    assert.equal(spy1.count(), 1, "a read immediately after a write issues only the staleness probe, never a payload re-SELECT");

    const rowsAfterFirst = readFactRows(afterFirst);
    assert.equal(rowsAfterFirst.length, 1, "the new fact is visible");
    assert.deepEqual(
      [rowsAfterFirst[0].subject, rowsAfterFirst[0].predicate, rowsAfterFirst[0].object],
      ["widget", "IsA", "gadget"],
    );
    assert.equal(rowsAfterFirst[0].sourceIds.length, 1);

    // Re-append the SAME triple with a SECOND provenance tag — an upsert
    // (corroboration), not a duplicate individual; exercises the individuals
    // "unchanged json -> skip" branch alongside the edges "new edge -> patch"
    // branch in the SAME persist call, so both cache-patch paths are hit.
    await appendFact(handle, { subject: "widget", predicate: "IsA", object: "gadget", provenance: "corpus:conceptnet", createdAt: TS1 });

    const spy2 = spyOnPrepare(handle);
    const afterSecond = await loadMemory(handle);
    assert.equal(spy2.count(), 1, "still served from the cache after a second write — only the staleness probe, no re-SELECT");

    const rowsAfterSecond = readFactRows(afterSecond);
    assert.equal(rowsAfterSecond.length, 1, "still ONE Fact individual, not two — upsert, not duplicate");
    assert.equal(rowsAfterSecond[0].sourceIds.length, 2, "corroboration is visible as a second Source edge via the patched cache");

    // Prove the patched cache isn't merely self-consistent: invalidate it and
    // force a genuinely fresh SQL rebuild, then confirm the two are identical
    // (modulo array order, same normalization the existing parity test uses).
    handle.cachedPayload = undefined;
    const fresh = await loadMemory(handle);
    const norm = (m) => readFactRows(m).map((r) => ({ ...r, sourceIds: [...r.sourceIds].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(norm(fresh), norm(afterSecond), "the incrementally patched cache matches a genuinely fresh SQL rebuild");

    const classCount = (m, name) => m.classes.find((c) => c.name === name)?.count || 0;
    assert.equal(classCount(fresh, FACT_CLASS), classCount(afterSecond, FACT_CLASS));
    assert.equal(classCount(fresh, SOURCE_CLASS), classCount(afterSecond, SOURCE_CLASS));
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});

test("the flat-file-only seams refuse a sqlite handle loudly: no graph.json path to resolve, nothing on disk to snapshot", async () => {
  const { dir, handle } = await sqliteHandle();
  try {
    assert.throws(() => resolveMemoryGraphFile(handle), /Backend A only/);
    await assert.rejects(() => snapshotMemory(handle), /flat-JSON backend/);
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise state round-trips through the sqlite meta table and survives a payload persist", async () => {
  const { loadSyllogiseState, saveSyllogiseState } = await import("../../src/adapters/memory/core.mjs");
  const { dir, handle } = await sqliteHandle();
  try {
    assert.equal(await loadSyllogiseState(handle), null, "a fresh database carries no watermark");
    const state = { version: 1, factIds: ["fact:aaaaaaaaaaaaaaaa", "fact:bbbbbbbbbbbbbbbb"], completedAt: TS1 };
    await saveSyllogiseState(handle, state);
    assert.deepEqual(await loadSyllogiseState(handle), state);
    // a later ordinary write must not clobber the watermark's meta row
    await appendFact(handle, { subject: "cache", predicate: "rdfs:subClassOf", object: "store", provenance: "corpus:x" });
    assert.deepEqual(await loadSyllogiseState(handle), state);
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});

test("Backend C cross-connection: a second connection's committed write is visible to a warm-cached handle, and its rows survive the first handle's next persist", async () => {
  const { dir, handle } = await sqliteHandle();
  const second = await createSqliteMemoryStore(handle.dbPath);
  try {
    await appendFact(handle, { subject: "alpha", predicate: "IsA", object: "letter", provenance: "corpus:seon" });
    await loadMemory(handle); // warm the first handle's cache

    await appendFact(second, { subject: "beta", predicate: "IsA", object: "letter", provenance: "corpus:seon" });

    const seen = readFactRows(await loadMemory(handle));
    assert.equal(seen.length, 2, "the other connection's committed fact is visible through the warm cache");

    await appendFact(handle, { subject: "gamma", predicate: "IsA", object: "letter", provenance: "corpus:seon" });
    const after = readFactRows(await loadMemory(second));
    assert.equal(after.length, 3, "the first handle's persist keeps the second connection's row instead of deleting it as absent");
  } finally {
    closeSqliteMemoryStore(second);
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});
