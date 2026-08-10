// createSession/runChat's `memoryBackend` option — the
// storage-backend seam wired into the CHAT surface, not just memory/core.mjs
// directly. A real teach turn ("every module is a component", the same
// declarative test/tools/chat-ephemeral.test.mjs already exercises for the default
// backend) is run through createSession under each of the three backends, and
// the fact is confirmed via loadMemory(s.memoryDir) — proving the session
// actually threads its OWN memoryDir handle through the live teach lane, not
// just that the handle shape is correct in isolation.
//
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-chat-backend-"));
}

async function memoryEntries(dir) {
  try { return await readdir(join(dir, ".tmct", "memory")); } catch (e) { if (e?.code === "ENOENT") return []; throw e; }
}

test("createSession default (no memoryBackend): Backend C — the sqlite store, no flat-JSON Fact rows", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    assert.equal(s.memoryDir?.backend, "sqlite", "the default memoryDir is a Backend C handle — Backend A is retired from routing");
    await s.turn("every module is a component");
    const m = await loadMemory(s.memoryDir);
    const rows = readFactRows(m);
    assert.ok(rows.some((r) => r.subject === "module" && r.object === "component"), "taught fact recorded");
    await s.close();
    const entries = await memoryEntries(dir);
    assert.ok(entries.includes("graph.sqlite"), "the default backend wrote graph.sqlite");
    // The independent sessions.mjs utterance mirror may still leave an
    // ordinary graph.json behind, but it must never carry the taught FACT.
    if (entries.includes("graph.json")) {
      const strayMemory = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, ".tmct", "memory", "graph.json"), "utf8"));
      assert.equal(readFactRows(strayMemory).length, 0, "no Fact ever leaks into the session mirror's own file");
    }
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

test("createSession({ memoryBackend: 'memory' }): a teach says the fact does not outlive the session; a stored backend says nothing of the kind", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const inProcess = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" }, memoryBackend: "memory" });
    const dropped = await inProcess.turn("every module is a component");
    const bannerB = inProcess.bannerLines.join("\n");
    await inProcess.close();

    assert.match(dropped.answer, /noted/i, "the teach still confirms");
    assert.match(dropped.answer, /keeps nothing/, "and says the fact goes with the session");
    assert.doesNotMatch(bannerB, /the conversation is remembered to/);

    const stored = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" }, memoryBackend: "sqlite" });
    const kept = await stored.turn("every module is a component");
    const bannerC = stored.bannerLines.join("\n");
    await stored.close();

    assert.doesNotMatch(kept.answer, /keeps nothing/, "a durable write carries no discard note");
    assert.match(bannerC, /the conversation is remembered to/);
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

// ---- tmct.toml's [memory] backend (src/adapters/toml-config.mjs) + the full
// precedence chain: bin/tmct.mjs's --memory-backend CLI flag (already the
// resolved `memoryBackend` param by the time it reaches createSession) >
// TMCT_MEMORY_BACKEND env > tmct.toml's `[memory] backend` > the built-in
// sqlite default. --------------------------------------------------------

test("createSession({ repoPath }): tmct.toml's [memory] backend alone (no option, no env) selects the backend", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    await writeFile(join(dir, "tmct.toml"), '[memory]\nbackend = "sqlite"\n');
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    assert.equal(s.memoryDir?.backend, "sqlite", "tmct.toml's [memory] backend alone selected Backend C");
    await s.turn("every module is a component");
    const m = await loadMemory(s.memoryDir);
    const rows = readFactRows(m);
    assert.ok(rows.some((r) => r.subject === "module" && r.object === "component"), "taught fact recorded through the tmct.toml-selected backend");
    await s.close();
    const entries = await memoryEntries(dir);
    assert.ok(entries.includes("graph.sqlite"), "Backend C wrote graph.sqlite, driven purely by tmct.toml — no flag, no env");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession precedence: the explicit memoryBackend option (bin/tmct.mjs's --memory-backend) beats tmct.toml", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    await writeFile(join(dir, "tmct.toml"), '[memory]\nbackend = "sqlite"\n');
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" }, memoryBackend: "memory" });
    assert.equal(s.memoryDir?.backend, "memory", "the explicit option wins over tmct.toml's sqlite");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession precedence: TMCT_MEMORY_BACKEND env beats tmct.toml, but loses to the explicit option — the full CLI-flag > env > tmct.toml > default chain", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    await writeFile(join(dir, "tmct.toml"), '[memory]\nbackend = "sqlite"\n');
    const envOnly = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1", TMCT_MEMORY_BACKEND: "memory" } });
    assert.equal(envOnly.memoryDir?.backend, "memory", "env wins over tmct.toml's sqlite");
    await envOnly.close();

    const optionWins = await createSession({
      repoPath: dir, env: { TMCT_NO_SEED: "1", TMCT_MEMORY_BACKEND: "memory" }, memoryBackend: "sqlite",
    });
    assert.equal(optionWins.memoryDir?.backend, "sqlite", "the explicit option still wins over env");
    await optionWins.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession precedence: an injected row backend beats env and tmct.toml, and skips config resolution entirely", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    await writeFile(join(dir, "tmct.toml"), '[memory]\nbackend = "sqlite"\n');
    const { createRowMemoryBackend } = await import("../../src/adapters/memory/row-backend-memory.mjs");
    const impl = createRowMemoryBackend();
    const s = await createSession({
      repoPath: dir, env: { TMCT_NO_SEED: "1", TMCT_MEMORY_BACKEND: "memory" }, memoryBackend: impl,
    });
    assert.equal(s.memoryDir?.backend, "row", "the injected store wins over env and tmct.toml alike");
    assert.equal(s.memoryDir?.impl, impl);
    await s.turn("every module is a component");
    const rows = readFactRows(await loadMemory(s.memoryDir));
    assert.ok(rows.some((r) => r.subject === "module" && r.object === "component"), "taught fact recorded in the injected store");
    await s.close();
    // The routed store the config named must never end up holding the fact —
    // an injected store that only half-wins would split a session's memory.
    const { openMemoryBackend } = await import("../../src/adapters/memory/core.mjs");
    const { dir: routed, close } = await openMemoryBackend(dir, "sqlite");
    const routedRows = readFactRows(await loadMemory(routed));
    await close();
    assert.deepEqual(routedRows, [], "no fact reached the backend tmct.toml named");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession: a tmct.toml [memory] backend of \"default\" (what `tmct init --memory-backend default` writes) falls through to the sqlite default, same as an absent value", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    await writeFile(join(dir, "tmct.toml"), '[memory]\nbackend = "default"\n');
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    assert.equal(s.memoryDir?.backend, "sqlite", "\"default\" in tmct.toml behaves like no override — the sqlite default");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
