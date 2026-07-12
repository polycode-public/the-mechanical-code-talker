// createSession/runChat's `memoryBackend` option (PLAN_SEED.md §6) — the
// storage-backend seam wired into the CHAT surface, not just memory/core.mjs
// directly. A real teach turn ("every module is a component", the same
// declarative test/chat-ephemeral.test.mjs already exercises for the default
// backend) is run through createSession under each of the three backends, and
// the fact is confirmed via loadMemory(s.memoryDir) — proving the session
// actually threads its OWN memoryDir handle through the live teach lane, not
// just that the handle shape is correct in isolation.
//
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-chat-backend-"));
}

async function memoryEntries(dir) {
  try { return await readdir(join(dir, ".tmct", "memory")); } catch (e) { if (e?.code === "ENOENT") return []; throw e; }
}

test("createSession default (no memoryBackend): Backend A, unchanged — writes .tmct/memory/graph.json", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    assert.equal(typeof s.memoryDir, "string", "memoryDir is the plain repo path, exactly as before");
    await s.turn("every module is a component");
    const m = await loadMemory(s.memoryDir);
    const rows = readFactRows(m);
    assert.ok(rows.some((r) => r.subject === "module" && r.object === "component"), "taught fact recorded");
    await s.close();
    assert.deepEqual(await memoryEntries(dir), ["graph.json"], "Backend A wrote the flat JSON file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession({ memoryBackend: 'memory' }): Backend B — the taught FACT lives only in the live handle, never in any on-disk file", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" }, memoryBackend: "memory" });
    assert.equal(s.memoryDir?.backend, "memory", "memoryDir is a Backend B handle");
    await s.turn("every module is a component");
    const m = await loadMemory(s.memoryDir);
    const rows = readFactRows(m);
    assert.ok(rows.some((r) => r.subject === "module" && r.object === "component"), "taught fact recorded in the live in-memory store");
    await s.close();
    // The independent sessions.mjs utterance mirror (out of this change's
    // scope — see createSession's own doc comment) may still leave an
    // ordinary graph.json behind, but it must never carry the taught FACT —
    // only Utterance/Session bookkeeping from that separate path.
    const entries = await memoryEntries(dir);
    if (entries.includes("graph.json")) {
      const strayMemory = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, ".tmct", "memory", "graph.json"), "utf8"));
      assert.equal(readFactRows(strayMemory).length, 0, "no Fact ever leaks into the session mirror's own file");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession({ memoryBackend: 'sqlite' }): Backend C — the taught FACT round-trips through real SQLite, never lands in any flat-JSON Fact row", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" }, memoryBackend: "sqlite" });
    assert.equal(s.memoryDir?.backend, "sqlite", "memoryDir is a Backend C handle");
    await s.turn("every module is a component");
    const m = await loadMemory(s.memoryDir);
    const rows = readFactRows(m);
    assert.ok(rows.some((r) => r.subject === "module" && r.object === "component"), "taught fact recorded through the live SQLite connection");
    await s.close();
    const entries = await memoryEntries(dir);
    assert.ok(entries.includes("graph.sqlite"), "Backend C wrote graph.sqlite");
    if (entries.includes("graph.json")) {
      const strayMemory = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, ".tmct", "memory", "graph.json"), "utf8"));
      assert.equal(readFactRows(strayMemory).length, 0, "no Fact ever leaks into the session mirror's own flat-JSON file");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession({ memoryBackend: 'sqlite' }): env var TMCT_MEMORY_BACKEND=sqlite selects the same backend without the explicit option", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1", TMCT_MEMORY_BACKEND: "sqlite" } });
    assert.equal(s.memoryDir?.backend, "sqlite");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
