// The turn service over a seed held as a read-only sqlite store instead of a
// parsed payload: the same answer, the same vocabulary, and the seed still
// read-only when the turn writes what it learned.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTurnServiceHandler, vocabularyFromSeed, vocabularyFromSqliteSeedStore } from "../../server/turn-service/handler.mjs";
import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import {
  createSqliteMemoryStore, closeSqliteMemoryStore, openSqliteSeedStore,
  appendFacts, loadMemory,
} from "../../src/adapters/memory/core.mjs";
import { payloadToRows } from "../../src/adapters/memory/rows.mjs";

const SESSION = "01890000-0000-4000-8000-0000000000f7";

const SEED_FACTS = [
  { subject: "dolphin", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:wordnet", createdAt: "2026-07-10T10:00:00.000Z" },
  { subject: "mammal", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:wordnet", createdAt: "2026-07-10T10:00:00.000Z" },
];

async function buildSeed() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-turn-seed-"));
  const dbPath = join(dir, "mid-seed.sqlite");
  const writable = await createSqliteMemoryStore(dbPath);
  await appendFacts(writable, SEED_FACTS);
  const payload = await loadMemory(writable);
  closeSqliteMemoryStore(writable);
  const store = await openSqliteSeedStore(dbPath);
  return { payload, store, async cleanup() { closeSqliteMemoryStore(store); await rm(dir, { recursive: true, force: true }); } };
}

/** A session backend that remembers every key `putRows` was asked to write. */
function recordingBackend() {
  const inner = createRowMemoryBackend();
  const writtenKeys = [];
  return {
    writtenKeys,
    backend: { ...inner, async putRows(rows) { for (const row of rows) writtenKeys.push(row.rowKey); return inner.putRows(rows); } },
  };
}

function handlerOver({ seedPayload = null, seedStore = null, backend }) {
  return createTurnServiceHandler({
    createSessionBackend: () => backend,
    seedPayload,
    seedStore,
    counters: { async incrementTurnRate() { return true; } },
    // The budgets are real-clock; this proves grounding, not budget behaviour.
    retrievalBudgets: { wallTimeMs: 60_000 },
  });
}

const turnRequest = (text) => ({
  method: "POST",
  path: `/api/sessions/${SESSION}/turn`,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text }),
});

test("a turn grounds on a sqlite seed exactly as it does on the same seed as a payload", async () => {
  const seed = await buildSeed();
  try {
    const fromPayload = await handlerOver({ seedPayload: seed.payload, backend: recordingBackend().backend })
      .handle(turnRequest("what is a dolphin"));
    const fromStore = await handlerOver({ seedStore: seed.store, backend: recordingBackend().backend })
      .handle(turnRequest("what is a dolphin"));

    assert.equal(fromStore.status, 200);
    assert.match(JSON.parse(fromStore.body).reply.toLowerCase(), /mammal/, "the seed fact grounds the answer");
    assert.equal(JSON.parse(fromStore.body).reply, JSON.parse(fromPayload.body).reply, "the seam changed no answer");
  } finally {
    await seed.cleanup();
  }
});

test("a teach turn over a sqlite seed writes its own rows and none of the seed's", async () => {
  const seed = await buildSeed();
  try {
    const seedKeys = new Set(payloadToRows(seed.payload, { onOversizedRow: "keep" }).map((r) => r.rowKey));
    const session = recordingBackend();
    const result = await handlerOver({ seedStore: seed.store, backend: session.backend })
      .handle(turnRequest("remember that zorblatt is a dolphin"));

    assert.equal(result.status, 200);
    assert.ok(JSON.parse(result.body).factsTouched.length, "the turn learned something");
    assert.ok(session.writtenKeys.length, "and wrote it");
    for (const key of session.writtenKeys) {
      assert.equal(seedKeys.has(key), false, `putRows received the seed row ${key}`);
    }
  } finally {
    await seed.cleanup();
  }
});

test("the fuzzy-mode vocabulary reads the same off a sqlite seed as off the parsed payload", async () => {
  const seed = await buildSeed();
  try {
    assert.deepEqual(vocabularyFromSqliteSeedStore(seed.store), vocabularyFromSeed(seed.payload));
  } finally {
    await seed.cleanup();
  }
});
