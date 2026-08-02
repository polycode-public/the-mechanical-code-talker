import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planRetraction, mergeRetractions, retractionIdFor, isRetractionId, retractionScopeOf,
  retractedRecordIds, retractedAtOf, retractionWireFact, retractionFromWire,
  encodeRetractionValue, decodeRetractionValue, isRetractedRecord,
  RETRACTION_CLASS, RETRACTION_PREDICATE,
} from "../../src/domain/memory/retraction.mjs";
import {
  createInMemoryStore, appendFacts, removeFacts, loadMemory, readFactRows,
  readRetractions, appendRetractions,
  createSqliteMemoryStore, closeSqliteMemoryStore,
} from "../../src/adapters/memory/core.mjs";

const GROUP = "fact:00112233aabbccdd";
const SOURCE_A = "src:teach-chat:sess-a";
const SOURCE_B = "src:teach-chat:sess-b";
const T1 = "2026-05-01T10:00:00.000Z";
const T2 = "2026-05-02T10:00:00.000Z";
const T3 = "2026-05-03T10:00:00.000Z";

const teachFact = (subject, predicate, object, sessionId, at) => ({
  subject, predicate, object, provenance: `teach:chat:${sessionId}@${at}`,
});

const rowsOf = async (dir) => readFactRows(await loadMemory(dir));
const findRow = (rows, subject, predicate) => rows.find((r) => r.subject === subject && r.predicate === predicate);

// ---- the record shape -------------------------------------------------------

test("a retraction record is keyed on one (triple, source) and carries the record ids it suppressed", () => {
  const record = planRetraction({
    groupId: GROUP,
    sourceId: SOURCE_A,
    recordIds: [`${GROUP}@${SOURCE_A}`, `${GROUP}@${SOURCE_A}#v1`],
    retractedAt: T2,
  });
  assert.equal(record.id, retractionIdFor(GROUP, SOURCE_A));
  assert.equal(record.class, RETRACTION_CLASS);
  assert.ok(isRetractionId(record.id));
  assert.equal(retractionScopeOf(record.id), `${GROUP}@${SOURCE_A}`);
  assert.deepEqual(retractedRecordIds(record), [`${GROUP}@${SOURCE_A}`, `${GROUP}@${SOURCE_A}#v1`]);
  assert.equal(retractedAtOf(record), T2);
});

test("a retraction id can never be read as a compaction summary, and neither can the reverse", () => {
  assert.equal(isRetractionId(`${GROUP}@${SOURCE_A}#rollup`), false);
  assert.equal(isRetractionId(`${GROUP}@rollup:teach`), false);
  assert.equal(retractionScopeOf(`${GROUP}@${SOURCE_A}#rollup`), "");
});

test("nothing is retracted when no record actually went, so a no-op removal leaves no tombstone", () => {
  assert.equal(planRetraction({ groupId: GROUP, sourceId: SOURCE_A, recordIds: [], retractedAt: T1 }), null);
  assert.equal(planRetraction({ groupId: "", sourceId: SOURCE_A, recordIds: ["x"], retractedAt: T1 }), null);
});

// ---- the join ---------------------------------------------------------------

test("two peers' retraction records at one id merge by union of the ids, in either order", () => {
  const peerA = planRetraction({ groupId: GROUP, sourceId: SOURCE_A, recordIds: [`${GROUP}@${SOURCE_A}`], retractedAt: T1 });
  const peerB = planRetraction({ groupId: GROUP, sourceId: SOURCE_A, recordIds: [`${GROUP}@${SOURCE_A}#v1`], retractedAt: T2 });

  const aThenB = mergeRetractions(peerA, peerB);
  const bThenA = mergeRetractions(peerB, peerA);
  assert.deepEqual(aThenB, bThenA, "the merge is commutative");
  assert.deepEqual(retractedRecordIds(aThenB), [`${GROUP}@${SOURCE_A}`, `${GROUP}@${SOURCE_A}#v1`]);
  assert.equal(retractedAtOf(aThenB), T2, "the later instant wins, because max is a join");
});

test("merging a retraction record that adds nothing changes nothing", () => {
  const peerA = planRetraction({ groupId: GROUP, sourceId: SOURCE_A, recordIds: [`${GROUP}@${SOURCE_A}`], retractedAt: T1 });
  const merged = mergeRetractions(peerA, peerA);
  assert.deepEqual(merged, peerA);
  assert.deepEqual(mergeRetractions(merged, peerA), merged, "idempotent under re-delivery");
});

test("a retraction record picks up the triple it names from whichever side carries it", () => {
  const described = planRetraction({
    groupId: GROUP, sourceId: SOURCE_A, recordIds: [`${GROUP}@${SOURCE_A}`], retractedAt: T1,
    template: { label: "rover isA dog", subject: "rover", predicate: "mgx:isA", object: "dog" },
  });
  const bare = planRetraction({ groupId: GROUP, sourceId: SOURCE_A, recordIds: [`${GROUP}@${SOURCE_A}`], retractedAt: T1 });
  assert.deepEqual(mergeRetractions(bare, described), mergeRetractions(described, bare));
  assert.equal(mergeRetractions(bare, described).label, "rover isA dog");
});

// ---- the wire encoding ------------------------------------------------------

test("the instant and the ids survive a round trip through one triple slot", () => {
  const value = encodeRetractionValue(T2, ["b-record", "a-record", "b-record"]);
  assert.deepEqual(decodeRetractionValue(value), { retractedAt: T2, ids: ["a-record", "b-record"] });
  assert.deepEqual(decodeRetractionValue(encodeRetractionValue("", ["only"])), { retractedAt: "", ids: ["only"] });
});

test("a record becomes one wire fact and the wire fact rebuilds the record", () => {
  const record = planRetraction({
    groupId: GROUP, sourceId: SOURCE_A, recordIds: [`${GROUP}@${SOURCE_A}`], retractedAt: T2,
    provenance: `teach:chat:sess-a@${T2}`,
  });
  const wire = retractionWireFact(record);
  assert.equal(wire.predicate, RETRACTION_PREDICATE);
  assert.equal(wire.subject, `${GROUP}@${SOURCE_A}`);

  const rebuilt = retractionFromWire(wire);
  assert.equal(rebuilt.id, record.id);
  assert.deepEqual(retractedRecordIds(rebuilt), retractedRecordIds(record));
  assert.equal(retractedAtOf(rebuilt), T2);
});

test("a wire fact that is not a well-formed retraction rebuilds nothing", () => {
  assert.equal(retractionFromWire({ subject: "x", predicate: "mgx:isA", object: "y" }), null);
  assert.equal(retractionFromWire({ subject: "no-source-key", predicate: RETRACTION_PREDICATE, object: `${T2} an-id` }), null);
  assert.equal(retractionFromWire({ subject: `${GROUP}@${SOURCE_A}`, predicate: RETRACTION_PREDICATE, object: T2 }), null);
});

// ---- when the tombstone bites ----------------------------------------------

test("a retraction bites an assertion made at or before it, and lets a later one stand", () => {
  const record = planRetraction({ groupId: GROUP, sourceId: SOURCE_A, recordIds: [`${GROUP}@${SOURCE_A}`], retractedAt: T2 });
  assert.equal(isRetractedRecord([record], `${GROUP}@${SOURCE_A}`, T1), true);
  assert.equal(isRetractedRecord([record], `${GROUP}@${SOURCE_A}`, T2), true);
  assert.equal(isRetractedRecord([record], `${GROUP}@${SOURCE_A}`, T3), false, "the same source saying it again, later, stands");
  assert.equal(isRetractedRecord([record], `${GROUP}@${SOURCE_B}`, T1), false, "another source's record is untouched");
  assert.equal(isRetractedRecord([record], `${GROUP}@${SOURCE_A}`, ""), true, "an assertion with no readable time cannot show it is newer");
});

// ---- the store ---------------------------------------------------------------

test("removeFacts leaves a retraction record naming every record id it took, and reports them", async () => {
  const dir = createInMemoryStore();
  const { ids } = await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T1)]);
  const groupId = ids[0];

  const { removed, records } = await removeFacts(dir, [groupId], { retractedAt: T2 });
  assert.deepEqual(removed, [groupId]);
  assert.deepEqual(records, [`${groupId}@${SOURCE_A}`]);
  assert.equal((await rowsOf(dir)).length, 0);

  const [wire] = readRetractions(await loadMemory(dir));
  assert.equal(wire.predicate, RETRACTION_PREDICATE);
  assert.deepEqual(decodeRetractionValue(wire.object), { retractedAt: T2, ids: [`${groupId}@${SOURCE_A}`] });
});

test("a peer re-delivering a retracted assertion does not put it back", async () => {
  const dir = createInMemoryStore();
  const fact = teachFact("rover", "mgx:isA", "dog", "sess-a", T1);
  const { ids } = await appendFacts(dir, [fact]);
  await removeFacts(dir, [ids[0]], { retractedAt: T2 });

  await appendFacts(dir, [fact]);
  assert.equal(findRow(await rowsOf(dir), "rover", "mgx:isA"), undefined);
});

test("the same source saying it again, later, is a fresh assertion and stands", async () => {
  const dir = createInMemoryStore();
  const { ids } = await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T1)]);
  await removeFacts(dir, [ids[0]], { retractedAt: T2 });

  await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T3)]);
  assert.ok(findRow(await rowsOf(dir), "rover", "mgx:isA"), "a retraction suppresses what was said, not the subject");
});

test("a retraction arriving after the copy it suppresses still takes it out of the read", async () => {
  const dir = createInMemoryStore();
  const fact = teachFact("rover", "mgx:isA", "dog", "sess-a", T1);
  const { ids } = await appendFacts(dir, [fact]);
  const groupId = ids[0];

  const applied = await appendRetractions(dir, [{
    subject: `${groupId}@${SOURCE_A}`,
    predicate: RETRACTION_PREDICATE,
    object: encodeRetractionValue(T2, [`${groupId}@${SOURCE_A}`]),
    provenance: "",
  }]);
  assert.equal(applied.merged, 1);
  assert.deepEqual(applied.removed, [`${groupId}@${SOURCE_A}`]);
  assert.equal(findRow(await rowsOf(dir), "rover", "mgx:isA"), undefined);
});

test("a retraction for a triple this store never held is kept, so the fact arriving later lands on it", async () => {
  const dir = createInMemoryStore();
  const probe = createInMemoryStore();
  const fact = teachFact("rover", "mgx:isA", "dog", "sess-a", T1);
  const { ids } = await appendFacts(probe, [fact]);
  const groupId = ids[0];

  await appendRetractions(dir, [{
    subject: `${groupId}@${SOURCE_A}`,
    predicate: RETRACTION_PREDICATE,
    object: encodeRetractionValue(T2, [`${groupId}@${SOURCE_A}`]),
    provenance: "",
  }]);
  await appendFacts(dir, [fact]);
  assert.equal(findRow(await rowsOf(dir), "rover", "mgx:isA"), undefined);
});

test("one source's retraction leaves another source's assertion of the same triple standing", async () => {
  const dir = createInMemoryStore();
  const { ids } = await appendFacts(dir, [
    teachFact("rover", "mgx:isA", "dog", "sess-a", T1),
    teachFact("rover", "mgx:isA", "dog", "sess-b", T1),
  ]);
  const groupId = ids[0];
  assert.equal(findRow(await rowsOf(dir), "rover", "mgx:isA").assertions.length, 2);

  await removeFacts(dir, [`${groupId}@${SOURCE_A}`], { retractedAt: T2 });
  const row = findRow(await rowsOf(dir), "rover", "mgx:isA");
  assert.ok(row, "the fact stands, because one source retracting is not the group agreeing");
  assert.deepEqual(row.sourceIds, [SOURCE_B]);
});

test("a retraction survives closing and reopening a sqlite store, and still refuses the copy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-retraction-"));
  const dbPath = join(dir, "graph.sqlite");
  const fact = teachFact("rover", "mgx:isA", "dog", "sess-a", T1);
  let handle = await createSqliteMemoryStore(dbPath);
  try {
    const { ids } = await appendFacts(handle, [fact]);
    await removeFacts(handle, [ids[0]], { retractedAt: T2 });
    closeSqliteMemoryStore(handle);

    handle = await createSqliteMemoryStore(dbPath);
    assert.equal(readRetractions(await loadMemory(handle)).length, 1);
    await appendFacts(handle, [fact]);
    assert.equal(findRow(await rowsOf(handle), "rover", "mgx:isA"), undefined);
    assert.deepEqual(handle.db.prepare("SELECT count(*) AS n FROM facts").get().n, 0,
      "and the tombstone is not a fact, so the projection stays clean");
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});

test("retracting one source twice keeps one record, advancing rather than chaining", async () => {
  const dir = createInMemoryStore();
  const { ids } = await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T1)]);
  const groupId = ids[0];

  await removeFacts(dir, [`${groupId}@${SOURCE_A}`], { retractedAt: T2 });
  await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T3)]);
  assert.ok(findRow(await rowsOf(dir), "rover", "mgx:isA"), "the later assertion stands");

  await removeFacts(dir, [`${groupId}@${SOURCE_A}`], { retractedAt: "2026-05-04T10:00:00.000Z" });
  const wire = readRetractions(await loadMemory(dir));
  assert.equal(wire.length, 1, "one record per (triple, source), never one per retraction");
  assert.deepEqual(decodeRetractionValue(wire[0].object), {
    retractedAt: "2026-05-04T10:00:00.000Z",
    ids: [`${groupId}@${SOURCE_A}`],
  });
  assert.equal(findRow(await rowsOf(dir), "rover", "mgx:isA"), undefined);
});
