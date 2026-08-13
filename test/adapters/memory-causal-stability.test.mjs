import test from "node:test";
import assert from "node:assert/strict";
import {
  admittedNodes, peersToConvince, stableRecordIds, invitedByFact,
} from "../../src/domain/memory/causal-stability.mjs";
import {
  createInMemoryStore, appendFacts, removeFacts, loadMemory, readFactRows,
  readRetractions, retirableRetractions, retireRetractions,
} from "../../src/adapters/memory/core.mjs";

const ALICE = "7f3a9c2e5b1d4a60";
const BOB = "6589e595d1fa9a90";
const CAROL = "b21c4d0e77a35f18";
const T1 = "2026-05-01T10:00:00.000Z";
const T2 = "2026-05-02T10:00:00.000Z";

const teachFact = (subject, predicate, object, sessionId, at) => ({
  subject, predicate, object, provenance: `teach:chat:${sessionId}@${at}`,
});

const rowsOf = async (dir) => readFactRows(await loadMemory(dir));

// ---- the roster -------------------------------------------------------------

test("both ends of an admission edge count as admitted nodes", async () => {
  const dir = createInMemoryStore();
  await appendFacts(dir, [invitedByFact(BOB, ALICE, T1)]);
  assert.deepEqual(admittedNodes(await rowsOf(dir)), [BOB, ALICE].sort());
});

test("a chain of admissions rosters every node in it", async () => {
  const dir = createInMemoryStore();
  await appendFacts(dir, [invitedByFact(BOB, ALICE, T1), invitedByFact(CAROL, BOB, T2)]);
  assert.deepEqual(admittedNodes(await rowsOf(dir)), [ALICE, BOB, CAROL].sort());
});

test("the roster is the same whichever order the admission edges arrived in", async () => {
  const forward = createInMemoryStore();
  await appendFacts(forward, [invitedByFact(BOB, ALICE, T1)]);
  await appendFacts(forward, [invitedByFact(CAROL, BOB, T2)]);
  const backward = createInMemoryStore();
  await appendFacts(backward, [invitedByFact(CAROL, BOB, T2)]);
  await appendFacts(backward, [invitedByFact(BOB, ALICE, T1)]);
  assert.deepEqual(admittedNodes(await rowsOf(forward)), admittedNodes(await rowsOf(backward)));
});

test("a store that has admitted nobody has an empty roster", async () => {
  const dir = createInMemoryStore();
  await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T1)]);
  assert.deepEqual(admittedNodes(await rowsOf(dir)), []);
});

test("a node holding its own record proves nothing, so it is not on its own roster", () => {
  assert.deepEqual(peersToConvince([ALICE, BOB, CAROL], BOB), [ALICE, CAROL]);
});

// ---- the rule ---------------------------------------------------------------

const HELD = new Map([
  [ALICE, ["tomb-1", "tomb-2"]],
  [BOB, ["tomb-1", "tomb-2"]],
  [CAROL, ["tomb-1"]],
]);
const acksFrom = (map) => (nodeId) => map.get(nodeId) || [];

test("a record every peer on the roster holds is stable", () => {
  assert.deepEqual(stableRecordIds({
    recordIds: ["tomb-1", "tomb-2"],
    roster: [ALICE, BOB, CAROL],
    self: CAROL,
    acknowledgedBy: acksFrom(HELD),
  }), ["tomb-1", "tomb-2"]);
});

test("one peer short of the roster is not stable, however many peers do hold it", () => {
  assert.deepEqual(stableRecordIds({
    recordIds: ["tomb-1", "tomb-2"],
    roster: [ALICE, BOB, CAROL],
    self: ALICE,
    acknowledgedBy: acksFrom(HELD),
  }), ["tomb-1"], "carol never took tomb-2");
});

test("a roster member that has acknowledged nothing at all blocks every record", () => {
  const sparse = new Map([[ALICE, ["tomb-1"]], [BOB, ["tomb-1"]]]);
  assert.deepEqual(stableRecordIds({
    recordIds: ["tomb-1"],
    roster: [ALICE, BOB, CAROL],
    self: ALICE,
    acknowledgedBy: acksFrom(sparse),
  }), [], "carol is admitted and silent, which is exactly the case that resurrects a fact");
});

test("an empty roster retires nothing, because not knowing who else holds a copy is not knowing nobody does", () => {
  assert.deepEqual(stableRecordIds({
    recordIds: ["tomb-1"],
    roster: [],
    acknowledgedBy: acksFrom(HELD),
  }), []);
});

test("a roster holding only this node retires nothing", () => {
  assert.deepEqual(stableRecordIds({
    recordIds: ["tomb-1"],
    roster: [ALICE],
    self: ALICE,
    acknowledgedBy: acksFrom(HELD),
  }), []);
});

test("no acknowledgement evidence at all retires nothing, which is the default", () => {
  assert.deepEqual(stableRecordIds({ recordIds: ["tomb-1"], roster: [ALICE, BOB], self: ALICE }), []);
  assert.deepEqual(stableRecordIds({}), []);
});

test("the answer is sorted and deduped, so two peers computing it agree byte for byte", () => {
  const held = new Map([[BOB, ["b", "a", "a"]]]);
  assert.deepEqual(stableRecordIds({
    recordIds: ["b", "a", "b"],
    roster: [ALICE, BOB],
    self: ALICE,
    acknowledgedBy: acksFrom(held),
  }), ["a", "b"]);
});

// ---- the store report -------------------------------------------------------

test("a store reports its tombstones as unretirable while nothing can show a peer holds them", async () => {
  const dir = createInMemoryStore();
  await appendFacts(dir, [invitedByFact(BOB, ALICE, T1)]);
  const { ids } = await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T1)]);
  await removeFacts(dir, [ids[0]], { retractedAt: T2 });

  const report = retirableRetractions(await loadMemory(dir), { self: ALICE });
  assert.deepEqual(report.roster, [BOB, ALICE].sort(), "the roster comes off the admission graph");
  assert.deepEqual(report.retirable, [], "and nothing is retirable without acknowledgement evidence");
  assert.equal((await readRetractions(await loadMemory(dir))).length, 1);
});

test("a store reports a tombstone as retirable once every rostered peer is shown to hold it", async () => {
  const dir = createInMemoryStore();
  await appendFacts(dir, [invitedByFact(BOB, ALICE, T1)]);
  const { ids } = await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T1)]);
  await removeFacts(dir, [ids[0]], { retractedAt: T2 });

  const memory = await loadMemory(dir);
  const tombstones = memory.individuals.filter((i) => i.class === "Retraction").map((i) => i.id);
  assert.equal(tombstones.length, 1);
  const report = retirableRetractions(memory, { self: ALICE, acknowledgedBy: () => tombstones });
  assert.deepEqual(report.retirable, tombstones);
});

test("retiring a tombstone takes it out of the store and off the wire", async () => {
  const dir = createInMemoryStore();
  const { ids } = await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T1)]);
  await removeFacts(dir, [ids[0]], { retractedAt: T2 });
  const tombstones = (await readRetractions(await loadMemory(dir))).map((r) => r.id);
  assert.equal(tombstones.length, 1);

  const { retired } = await retireRetractions(dir, tombstones);
  assert.deepEqual(retired, tombstones);
  assert.deepEqual(await readRetractions(await loadMemory(dir)), []);
});

test("retirement only touches ids that are actually tombstones", async () => {
  const dir = createInMemoryStore();
  const { ids } = await appendFacts(dir, [teachFact("rover", "mgx:isA", "dog", "sess-a", T1)]);
  const { retired } = await retireRetractions(dir, [ids[0], "no-such-record"]);
  assert.deepEqual(retired, []);
  assert.ok((await rowsOf(dir)).find((r) => r.subject === "rover"), "the fact it named is still there");
});

test("a retired tombstone stops refusing the copy it used to suppress", async () => {
  const dir = createInMemoryStore();
  const fact = teachFact("rover", "mgx:isA", "dog", "sess-a", T1);
  const { ids } = await appendFacts(dir, [fact]);
  await removeFacts(dir, [ids[0]], { retractedAt: T2 });
  await appendFacts(dir, [fact]);
  assert.equal((await rowsOf(dir)).find((r) => r.subject === "rover"), undefined, "the tombstone holds the line");

  await retireRetractions(dir, (await readRetractions(await loadMemory(dir))).map((r) => r.id));
  await appendFacts(dir, [fact]);
  assert.ok((await rowsOf(dir)).find((r) => r.subject === "rover"),
    "which is the whole risk: retire it early and the next stale copy walks back in");
});
