// A poll cycle that runs out of time leaves its work where the next cycle can
// find it. What this suite holds:
//
//   - a cycle grounds several fetched items, not one and not none;
//   - a cycle that stops early reports what it grounded and what it left;
//   - the next cycle takes the leftovers, and takes each of them once;
//   - a source answering "nothing changed" still finishes its backlog;
//   - the graph keeps growing across the two cycles.
//
// The budget runs off a counted clock, so what a cycle gets through is a number
// of steps rather than a number of milliseconds — the same on a busy machine as
// on an idle one.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNewsWorker } from "../../server/news-worker/handler.mjs";
import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import {
  createSqliteMemoryStore, closeSqliteMemoryStore, openSqliteSeedStore,
  appendFacts, loadMemory, readFactRows,
} from "../../src/adapters/memory/core.mjs";

const SESSION = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";
const SOURCE = "wikimedia-featured";
const AT = "2026-07-11T10:00:00.000Z";
const SEED_AT = "2026-07-10T10:00:00.000Z";

const NEWS_STATE_KEY = "newsState";

/** A seed with enough shape for the recognizer to ground an article against,
 *  and small enough to build in a fraction of a second. */
async function buildSeed() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-worker-resume-"));
  const dbPath = join(dir, "xl-seed.sqlite");
  const writable = await createSqliteMemoryStore(dbPath);
  await appendFacts(writable, [
    { subject: "mammal", predicate: "IsA", object: "animal", provenance: "corpus:conceptnet", createdAt: SEED_AT },
    { subject: "robot", predicate: "IsA", object: "machine", provenance: "corpus:conceptnet", createdAt: SEED_AT },
    { subject: "planet", predicate: "IsA", object: "body", provenance: "corpus:conceptnet", createdAt: SEED_AT },
  ]);
  closeSqliteMemoryStore(writable);
  const store = await openSqliteSeedStore(dbPath);
  return { store, dbPath, async cleanup() { closeSqliteMemoryStore(store); await rm(dir, { recursive: true, force: true }); } };
}

const ARTICLES = [
  ["A dog is a mammal", "A dog is a mammal."],
  ["A rover is a robot", "A rover is a robot."],
  ["Mars is a planet", "Mars is a planet."],
  ["A gannet is a seabird", "A gannet is a seabird."],
  ["A kestrel is a bird", "A kestrel is a bird."],
];

function feedItems(count) {
  return ARTICLES.slice(0, count).map(([title, summary], i) => ({
    id: `news-item:resume${i}`,
    sourceId: SOURCE,
    title,
    summary,
    url: `https://example.invalid/${i}`,
    fetchedAt: `2026-07-11T09:0${i}:00.000Z`,
  }));
}

/** A clock that moves one step every time it is read. The abort budget is the
 *  only caller, so `budgetMs` is a count of checks: a cycle stops on the check
 *  that crosses it, however long the real work took. */
function countedClock(stepMs = 1000) {
  let reads = 0;
  return () => {
    reads += 1;
    return reads * stepMs;
  };
}

function pollWorker({ seedStore, backend, budgetMs, notModified = false, items = 5 }) {
  return createNewsWorker({
    createSessionBackend: () => backend,
    createFetchers: () => new Map([[SOURCE, {
      id: SOURCE,
      async fetchItems() {
        return notModified ? { items: [], bytes: 0, notModified: true } : { items: feedItems(items), bytes: 2048 };
      },
    }]]),
    seedStore,
    now: () => AT,
    nowMs: countedClock(),
    budgetMs,
    heartbeatMs: 0,
  });
}

const runPoll = (worker, cycleId) => worker.runCycle({ sessionKey: SESSION, cycleId, mode: "poll", body: { sources: [SOURCE] } });

async function newsStateOf(backend) {
  return JSON.parse(await backend.readMeta(NEWS_STATE_KEY));
}

const groundedIdsOf = (state) => (state.items || []).filter((s) => (s.processedRounds || 0) > 0).map((s) => s.id).sort();

async function factCount(backend, seedStore) {
  const { wrapRowBackendOverSqliteSeed } = await import("../../src/adapters/memory/core.mjs");
  return readFactRows(await loadMemory(wrapRowBackendOverSqliteSeed(backend, seedStore))).length;
}

test("one poll cycle grounds several of the items it fetched", async () => {
  const seed = await buildSeed();
  const backend = createRowMemoryBackend();
  try {
    // Well past the five items on offer, so nothing but the items themselves
    // decides how many land.
    await runPoll(pollWorker({ seedStore: seed.store, backend, budgetMs: 1_000_000 }), "full");
    const state = await newsStateOf(backend);
    assert.equal(groundedIdsOf(state).length, 5, "every fetched item was grounded");
  } finally {
    await seed.cleanup();
  }
});

test("a cycle that stops early leaves the rest pending, and the next cycle takes exactly those", async () => {
  const seed = await buildSeed();
  const backend = createRowMemoryBackend();
  try {
    // The budget is read once to set the deadline, once for the source and
    // once before each item, so four steps leave the cycle two items in.
    await runPoll(pollWorker({ seedStore: seed.store, backend, budgetMs: 4000 }), "partial");
    const afterFirst = await newsStateOf(backend);
    const firstPass = groundedIdsOf(afterFirst);
    assert.ok(firstPass.length >= 2 && firstPass.length < 5, `the cycle stopped part-way, grounded ${firstPass.length}`);
    assert.equal(afterFirst.items.length, 5, "all five are known, grounded or not");
    const factsAfterFirst = await factCount(backend, seed.store);

    await runPoll(pollWorker({ seedStore: seed.store, backend, budgetMs: 1_000_000 }), "resume");
    const afterSecond = await newsStateOf(backend);

    assert.deepEqual(groundedIdsOf(afterSecond), afterSecond.items.map((s) => s.id).sort(), "nothing is left pending");
    for (const snap of afterSecond.items) {
      assert.equal(snap.processedRounds, 1, `${snap.id} was grounded once, never twice`);
    }
    assert.ok(
      await factCount(backend, seed.store) > factsAfterFirst,
      "the second cycle extended the graph rather than repeating the first",
    );
  } finally {
    await seed.cleanup();
  }
});

test("a source answering nothing-new still finishes the backlog an earlier cycle left", async () => {
  const seed = await buildSeed();
  const backend = createRowMemoryBackend();
  try {
    await runPoll(pollWorker({ seedStore: seed.store, backend, budgetMs: 4000 }), "partial");
    const pendingBefore = (await newsStateOf(backend)).items.filter((s) => !(s.processedRounds > 0)).length;
    assert.ok(pendingBefore > 0, "the first cycle really did leave a backlog");

    await runPoll(pollWorker({ seedStore: seed.store, backend, budgetMs: 1_000_000, notModified: true }), "resume-304");

    const state = await newsStateOf(backend);
    assert.equal(state.items.filter((s) => !(s.processedRounds > 0)).length, 0, "the backlog is gone");
  } finally {
    await seed.cleanup();
  }
});

test("the cycle marker says what each source grounded and what it left behind", async () => {
  const seed = await buildSeed();
  const backend = createRowMemoryBackend();
  try {
    await runPoll(pollWorker({ seedStore: seed.store, backend, budgetMs: 4000 }), "partial");
    const marker = JSON.parse(await backend.readMeta("cycle"));
    assert.equal(marker.state, "done-partial");
    const source = marker.sources[SOURCE];
    assert.equal(source.newItems, 5);
    assert.ok(source.grounded >= 2, `grounded reads ${source.grounded}`);
    assert.equal(source.grounded + source.pending, 5, "what it grounded and what it left add up to what it fetched");
  } finally {
    await seed.cleanup();
  }
});
