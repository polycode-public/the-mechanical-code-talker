// toml-config.test.mjs — direct unit coverage for src/adapters/toml-config.mjs's
// normalizeConfig, focused on the `[memory]` table (retention_versions +
// the `backend` field, the storage-backend seam reaching tmct.toml). Both keys are sparse — present only when actually set — same
// discipline as every other table normalizeConfig produces (see its own
// docblock); these tests pin that discipline for `[memory]` specifically,
// which had no dedicated direct-unit coverage before this batch (only
// exercised indirectly via e2e/init.test.mjs and test/tools/cli-args.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTomlConfig, normalizeConfig } from "../../src/adapters/toml-config.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "tmct-toml-config-"));

test("normalizeConfig: no [memory] table at all — cfg.memory absent (sparse)", async () => {
  const norm = await normalizeConfig({}, { configDir: "/x" });
  assert.equal(norm.memory, undefined);
});

test("normalizeConfig: [memory] backend alone — cfg.memory = { backend }, no retentionVersions key", async () => {
  const norm = await normalizeConfig({ memory: { backend: "sqlite" } }, { configDir: "/x" });
  assert.deepEqual(norm.memory, { backend: "sqlite" });
});

test("normalizeConfig: [memory] retention_versions alone — cfg.memory = { retentionVersions }, no backend key", async () => {
  const norm = await normalizeConfig({ memory: { retention_versions: 3 } }, { configDir: "/x" });
  assert.deepEqual(norm.memory, { retentionVersions: 3 });
});

test("normalizeConfig: [memory] backend + retention_versions together — both keys land in cfg.memory", async () => {
  const norm = await normalizeConfig({ memory: { backend: "memory", retention_versions: 7 } }, { configDir: "/x" });
  assert.deepEqual(norm.memory, { backend: "memory", retentionVersions: 7 });
});

test("normalizeConfig: [memory] backend round-trips through a real tmct.toml on disk", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), "[memory]\nbackend = \"sqlite\"\n");
    const raw = await loadTomlConfig(dir);
    assert.equal(raw.memory.backend, "sqlite");
    const norm = await normalizeConfig(raw, { configDir: dir });
    assert.equal(norm.memory.backend, "sqlite");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizeConfig: an unrecognized [memory] backend value still passes through (validation is the consumer's job, not the loader's)", async () => {
  const norm = await normalizeConfig({ memory: { backend: "bogus" } }, { configDir: "/x" });
  assert.equal(norm.memory.backend, "bogus");
});

// ---- [seed] capture_unknown_context / unknown_context_limit: sparse, same
// discipline as enabled/limit above — snake_case in the file, camelCase in
// the normalized shape, present only when the key is actually set.

test("normalizeConfig: [seed] capture_unknown_context alone — cfg.seed = { captureUnknownContext }, no other seed key", async () => {
  const norm = await normalizeConfig({ seed: { capture_unknown_context: true } }, { configDir: "/x" });
  assert.deepEqual(norm.seed, { captureUnknownContext: true });
});

test("normalizeConfig: [seed] unknown_context_limit alone — cfg.seed = { unknownContextLimit }", async () => {
  const norm = await normalizeConfig({ seed: { unknown_context_limit: 200 } }, { configDir: "/x" });
  assert.deepEqual(norm.seed, { unknownContextLimit: 200 });
});

test("normalizeConfig: [seed] enabled + capture_unknown_context together — both keys land in cfg.seed", async () => {
  const norm = await normalizeConfig({ seed: { enabled: true, capture_unknown_context: false } }, { configDir: "/x" });
  assert.deepEqual(norm.seed, { enabled: true, captureUnknownContext: false });
});

test("normalizeConfig: [seed] capture_unknown_context round-trips through a real tmct.toml on disk", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), "[seed]\ncapture_unknown_context = true\n");
    const raw = await loadTomlConfig(dir);
    const norm = await normalizeConfig(raw, { configDir: dir });
    assert.equal(norm.seed.captureUnknownContext, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- [games.*] / [planning]: sparse raw pass-through, same discipline as
// [extensions]/[bias] above — src/domain/game-config.mjs's resolveGameConfig
// owns the snake_case -> camelCase mapping and the default fill, never this
// module.

test("normalizeConfig: no [games]/[planning] tables at all — both keys absent (sparse)", async () => {
  const norm = await normalizeConfig({}, { configDir: "/x" });
  assert.equal(norm.games, undefined);
  assert.equal(norm.planning, undefined);
});

test("normalizeConfig: [games.spider-fly] rides through unmodified, snake_case keys untouched", async () => {
  const raw = { games: { "spider-fly": { spider_mass_decrement_per_turn: 0.25, vision_radius: 6 } } };
  const norm = await normalizeConfig(raw, { configDir: "/x" });
  assert.deepEqual(norm.games, { "spider-fly": { spider_mass_decrement_per_turn: 0.25, vision_radius: 6 } });
});

test("normalizeConfig: [games.guess-number] rides through unmodified alongside [games.spider-fly]", async () => {
  const raw = { games: { "spider-fly": { vision_radius: 6 }, "guess-number": { default_lo: 5, default_hi: 50 } } };
  const norm = await normalizeConfig(raw, { configDir: "/x" });
  assert.deepEqual(norm.games, { "spider-fly": { vision_radius: 6 }, "guess-number": { default_lo: 5, default_hi: 50 } });
});

test("normalizeConfig: [planning] max_depth rides through unmodified", async () => {
  const norm = await normalizeConfig({ planning: { max_depth: 12 } }, { configDir: "/x" });
  assert.deepEqual(norm.planning, { max_depth: 12 });
});

test("normalizeConfig: [research] rides through unmodified (sparse: absent when unset), snake_case keys untouched", async () => {
  const none = await normalizeConfig({}, { configDir: "/x" });
  assert.equal(none.research, undefined);
  const norm = await normalizeConfig({ research: { fanout_limit: 3, depth_limit: 0, min_interval_ms: 4000 } }, { configDir: "/x" });
  assert.deepEqual(norm.research, { fanout_limit: 3, depth_limit: 0, min_interval_ms: 4000 });
});

test("normalizeConfig: [games]/[planning] round-trip through a real tmct.toml on disk", async () => {
  const dir = await tmp();
  try {
    await writeFile(
      join(dir, "tmct.toml"),
      "[games.spider-fly]\nspider_mass_decrement_per_turn = 0.25\n\n[planning]\nmax_depth = 12\n",
    );
    const raw = await loadTomlConfig(dir);
    const norm = await normalizeConfig(raw, { configDir: dir });
    assert.deepEqual(norm.games, { "spider-fly": { spider_mass_decrement_per_turn: 0.25 } });
    assert.deepEqual(norm.planning, { max_depth: 12 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
