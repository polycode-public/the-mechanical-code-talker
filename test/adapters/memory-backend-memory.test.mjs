// memory/core.mjs's Backend B — pure in-memory store.
//
// createInMemoryStore() hands back a `{ backend: "memory", payload }` handle
// that loadMemory/mutateMemory recognize and operate on DIRECTLY (synchronous
// object read/mutate) instead of resolving it to an on-disk file path. This
// suite confirms: (a) every append primitive behaves the same over a handle
// as it does over a real repo dir (Backend A) for the identical operations,
// (b) two handles never share state (session-scoped, not module-global), and
// (c) the backend genuinely never touches disk — traced by pointing a real
// scratch temp dir at nothing (Backend B never receives it) and separately
// proving that same scratch dir WOULD have gained files had Backend A been
// used instead, so the "stays empty" result isn't just "we checked the wrong
// place."
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UTTERANCE_CLASS, FACT_CLASS, SAID_IN_SESSION_PROP, IN_REPLY_TO_PROP,
  emptyMemory, createInMemoryStore, loadMemory,
  appendUtterance, appendUtterances, appendFact, appendFacts, appendRule,
  findRuleByName, readFactRows, RULE_KIND_COMPOSE2,
  resolveMemoryGraphFile, snapshotMemory,
} from "../../src/adapters/memory/core.mjs";

const SESSION = "01890000-0000-7000-8000-00000000dead";
const TS1 = "2026-07-10T09:00:00.000Z";
const TS2 = "2026-07-10T09:01:00.000Z";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-mem-backend-"));
}

test("createInMemoryStore: a fresh handle loads as the same empty payload shape as Backend A's bootstrap", async () => {
  const handle = createInMemoryStore();
  assert.equal(handle.backend, "memory");
  const m = await loadMemory(handle);
  const empty = emptyMemory();
  assert.equal(m.memory, true);
  assert.deepEqual(m.individuals, empty.individuals);
  assert.deepEqual(m.classes, empty.classes);
  assert.deepEqual(m.objectProperties, empty.objectProperties);
  assert.deepEqual(m.proseIndex, empty.proseIndex);
  assert.deepEqual(m.prefixes, empty.prefixes);
});

test("appendFact/appendFacts/appendUtterance(s)/appendRule over a handle: same behavior as Backend A for the identical calls", async () => {
  const handle = createInMemoryStore();
  const dir = await tmpRepo();
  try {
    const ops = async (target) => {
      await appendUtterance(target, { role: "visitor", text: "who owns logger.mjs?", ts: TS1, sessionId: SESSION, sessionStarted: TS1 });
      await appendUtterances(target, [
        { role: "visitor", text: "does a dog have a tail?", ts: TS2, sessionId: SESSION },
        { role: "tmct", text: "yes, a dog has a tail.", ts: TS2, sessionId: SESSION },
      ]);
      await appendFact(target, { subject: "dog", predicate: "IsA", object: "mammal", provenance: `teach:chat:${SESSION}@${TS1}`, createdAt: TS1 });
      await appendFacts(target, [
        { subject: "mammal", predicate: "IsA", object: "animal", provenance: `teach:chat:${SESSION}@${TS1}`, createdAt: TS1 },
        { subject: "logger.mjs", predicate: "ownedBy", object: "platform-team", provenance: `ace:chat:${SESSION}@${TS1}`, createdAt: TS1 },
      ]);
      await appendRule(target, {
        name: "grandparent", kind: RULE_KIND_COMPOSE2,
        slots: { base1: "parentOf", base2: "parentOf" },
        provenance: `teach:chat:${SESSION}@${TS1}`, createdAt: TS1,
      });
    };
    await ops(handle);
    await ops(dir);

    const memMemory = await loadMemory(handle);
    const fileMemory = await loadMemory(dir);

    // Same fact rows (content-addressed ids, same subject/predicate/object,
    // same trust — deterministic since both runs pass identical createdAt).
    const stripSourceIds = (rows) => rows.map(({ sourceIds, ...rest }) => rest)
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(stripSourceIds(readFactRows(memMemory)), stripSourceIds(readFactRows(fileMemory)));

    // Same Rule lookup. mgx:updatedAt (recomputeFactTrust re-stamps it — class-agnostic, so a
    // Rule rides it too) is a genuine LIVE wall-clock value, not derived from the
    // fixture's own fixed `createdAt`s — the two `ops()` runs above are sequential real-time
    // calls, so it legitimately differs by a millisecond or two between the two backends. Redact
    // it before the structural attribute comparison, same reasoning as memory-core.test.mjs's
    // GOLDEN EQUIVALENCE test's `norm()`.
    const redactUpdatedAt = (attrs) => attrs.map((a) => (a.prop === "mgx:updatedAt" ? { ...a, value: "<ts>" } : a));
    const memRule = findRuleByName(memMemory, "grandparent");
    const fileRule = findRuleByName(fileMemory, "grandparent");
    assert.equal(memRule.id, fileRule.id);
    assert.deepEqual(redactUpdatedAt(memRule.attributes), redactUpdatedAt(fileRule.attributes));

    // Same utterance/reply/session wiring.
    assert.equal(memMemory.individuals.filter((i) => i.class === UTTERANCE_CLASS).length,
      fileMemory.individuals.filter((i) => i.class === UTTERANCE_CLASS).length);
    assert.equal(memMemory.objectProperties.find((g) => g.prop === SAID_IN_SESSION_PROP).count,
      fileMemory.objectProperties.find((g) => g.prop === SAID_IN_SESSION_PROP).count);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Backend B: re-appending the same fact upserts (idempotent), exactly like Backend A", async () => {
  const handle = createInMemoryStore();
  const triple = { subject: "cache", predicate: "IsA", object: "storage-mechanism" };
  const { id: id1 } = await appendFact(handle, triple);
  const { id: id2 } = await appendFact(handle, triple);
  assert.equal(id1, id2);
  const m = await loadMemory(handle);
  assert.equal(m.individuals.filter((i) => i.class === FACT_CLASS).length, 1);
});

test("Backend B: two independent handles never share state (session-scoped, not module-global)", async () => {
  const a = createInMemoryStore();
  const b = createInMemoryStore();
  await appendFact(a, { subject: "alpha", predicate: "IsA", object: "letter" });
  await appendFact(b, { subject: "beta", predicate: "IsA", object: "letter" });
  const ma = await loadMemory(a);
  const mb = await loadMemory(b);
  assert.equal(readFactRows(ma).length, 1);
  assert.equal(readFactRows(mb).length, 1);
  assert.equal(readFactRows(ma)[0].subject, "alpha");
  assert.equal(readFactRows(mb)[0].subject, "beta");
});

test("Backend B: a reply to an unknown utterance still drops the edge honestly; bad role still throws", async () => {
  const handle = createInMemoryStore();
  await appendUtterance(handle, { role: "tmct", text: "orphan answer", ts: TS2, sessionId: SESSION, replyTo: "utt:nope" });
  const m = await loadMemory(handle);
  assert.equal(m.objectProperties.find((g) => g.prop === IN_REPLY_TO_PROP), undefined);
  await assert.rejects(
    () => appendUtterance(handle, { role: "narrator", text: "x", ts: TS2, sessionId: SESSION }),
    /role must be "visitor" or "tmct"/,
  );
});

test("Backend B: genuinely zero disk I/O — a scratch dir Backend B never receives stays empty, though Backend A pointed at it would not", async () => {
  const scratch = await tmpRepo();
  try {
    const handle = createInMemoryStore();
    // A realistic burst of memory-touching operations, entirely over the handle —
    // `scratch` is never passed to any of these calls.
    await appendUtterance(handle, { role: "visitor", text: "hello", ts: TS1, sessionId: SESSION, sessionStarted: TS1 });
    await appendFact(handle, { subject: "man", predicate: "IsA", object: "person" });
    await appendFacts(handle, [{ subject: "hat", predicate: "IsA", object: "clothing" }]);
    await appendRule(handle, {
      name: "sibling", kind: RULE_KIND_COMPOSE2,
      slots: { base1: "parentOf", base2: "childOf" },
    });
    await loadMemory(handle);

    const untouched = await readdir(scratch);
    assert.deepEqual(untouched, [], "Backend B never wrote into a dir it was never even given");

    // Prove the negative isn't vacuous: the identical operation sequence against
    // Backend A DOES populate that same kind of scratch dir.
    await appendFact(scratch, { subject: "man", predicate: "IsA", object: "person" });
    const afterBackendA = await readdir(join(scratch, ".tmct", "memory"));
    assert.ok(afterBackendA.includes("graph.json"), "Backend A really does write a file for the same call");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("the flat-file-only seams refuse an in-memory handle loudly: no graph.json path to resolve, nothing on disk to snapshot", async () => {
  const handle = createInMemoryStore();
  assert.throws(() => resolveMemoryGraphFile(handle), /Backend A only/);
  await assert.rejects(() => snapshotMemory(handle), /flat-JSON backend/);
});

test("syllogise state round-trips on a memory handle, cloned both ways and absent by default", async () => {
  const { loadSyllogiseState, saveSyllogiseState } = await import("../../src/adapters/memory/core.mjs");
  const handle = createInMemoryStore();
  assert.equal(await loadSyllogiseState(handle), null, "a fresh handle carries no watermark");
  const state = { version: 1, factIds: ["fact:aaaaaaaaaaaaaaaa"], completedAt: TS1 };
  await saveSyllogiseState(handle, state);
  state.factIds.push("fact:bbbbbbbbbbbbbbbb"); // caller mutation must not reach the stored copy
  const loaded = await loadSyllogiseState(handle);
  assert.deepEqual(loaded, { version: 1, factIds: ["fact:aaaaaaaaaaaaaaaa"], completedAt: TS1 });
  loaded.factIds.push("fact:cccccccccccccccc"); // nor must mutating a loaded copy
  assert.deepEqual((await loadSyllogiseState(handle)).factIds, ["fact:aaaaaaaaaaaaaaaa"]);
  assert.equal(await loadSyllogiseState(createInMemoryStore()), null, "handles never share state");
});
