// news-store.mjs: persists the news capability's runtime state under
// .tmct/news-state.json, mirroring research-queue-store.mjs's own fail-closed
// contract — an absent, corrupt or ill-shaped file reads as null, never a
// throw, and a backend with nowhere to persist (in-memory, browser) is a
// silent no-op.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadNewsState, saveNewsState, clearNewsState } from "../../src/adapters/news-store.mjs";

function emptyState(overrides = {}) {
  return {
    items: [],
    ledger: { terms: [] },
    health: [],
    requestLog: [],
    metrics: [],
    lastPollAt: "",
    lastEnrichAt: "",
    ...overrides,
  };
}

test("a repo-path backend round-trips a saved state byte-for-byte in shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-news-store-"));
  try {
    assert.equal(await loadNewsState(dir), null, "nothing saved yet reads as null");
    const state = emptyState({
      items: [{ id: "news-item:abc", sourceId: "hacker-news", title: "Show HN", url: "https://example.com", summary: "", publishedAt: "", fetchedAt: "2026-08-08T00:00:00.000Z", bytes: 100, processedRounds: 0, factIds: [], extras: null }],
      health: [{ sourceId: "hacker-news", lastPolledAt: "2026-08-08T00:00:00.000Z", lastStatus: "ok", consecutiveFailures: 0, backoffUntil: "", autoDisabled: false, browserBlocked: false, etag: "", lastModified: "" }],
      lastPollAt: "2026-08-08T00:00:00.000Z",
    });
    await saveNewsState(dir, state);
    const loaded = await loadNewsState(dir);
    assert.deepEqual(loaded, state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a sqlite-shaped handle (dbPath) persists to that path's .tmct/ sibling", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-news-store-sqlite-"));
  try {
    const handle = { dbPath: join(dir, ".tmct", "sqlite", "memory.db") };
    await saveNewsState(handle, emptyState());
    const onDisk = JSON.parse(await readFile(join(dir, ".tmct", "news-state.json"), "utf8"));
    assert.deepEqual(onDisk, emptyState());
    assert.deepEqual(await loadNewsState(handle), emptyState());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an in-memory handle and a null/undefined memoryDir (the browser session) are silent no-ops", async () => {
  for (const memoryDir of [null, undefined, {}, { notADbPath: true }]) {
    assert.equal(await loadNewsState(memoryDir), null);
    await saveNewsState(memoryDir, emptyState());
    await clearNewsState(memoryDir);
  }
});

test("a missing, corrupt-JSON, or ill-shaped file all read as null rather than throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-news-store-corrupt-"));
  try {
    assert.equal(await loadNewsState(dir), null, "no file yet");

    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "news-state.json"), "{not valid json", "utf8");
    assert.equal(await loadNewsState(dir), null, "corrupt JSON");

    await writeFile(join(dir, ".tmct", "news-state.json"), JSON.stringify({ items: "not an array" }), "utf8");
    assert.equal(await loadNewsState(dir), null, "the wrong shape entirely");

    await writeFile(join(dir, ".tmct", "news-state.json"), JSON.stringify(emptyState({ ledger: { notTerms: [] } })), "utf8");
    assert.equal(await loadNewsState(dir), null, "a ledger missing its terms array");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveNewsState(dir, null) clears the file, same as clearNewsState", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-news-store-clear-"));
  try {
    await saveNewsState(dir, emptyState());
    assert.ok(await loadNewsState(dir));
    await saveNewsState(dir, null);
    assert.equal(await loadNewsState(dir), null);

    await saveNewsState(dir, emptyState());
    await clearNewsState(dir);
    assert.equal(await loadNewsState(dir), null);
    await clearNewsState(dir); // idempotent — already gone
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the request log caps at 200 entries on save, keeping the first (newest) 200", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-news-store-log-"));
  try {
    const requestLog = Array.from({ length: 250 }, (_, i) => ({ url: `https://example.com/${i}`, at: "2026-08-08T00:00:00.000Z", bytes: 1, status: "ok" }));
    await saveNewsState(dir, emptyState({ requestLog }));
    const loaded = await loadNewsState(dir);
    assert.equal(loaded.requestLog.length, 200);
    assert.deepEqual(loaded.requestLog, requestLog.slice(0, 200), "the newest-first ordering is preserved, just truncated");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
