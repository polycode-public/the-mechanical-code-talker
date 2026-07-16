// toml-config.test.mjs — direct unit coverage for src/toml-config.mjs's
// normalizeConfig, focused on the `[memory]` table (retention_versions +
// the new `backend` field, PLAN_SEED.md §6's storage-backend seam reaching
// tmct.toml). Both keys are sparse — present only when actually set — same
// discipline as every other table normalizeConfig produces (see its own
// docblock); these tests pin that discipline for `[memory]` specifically,
// which had no dedicated direct-unit coverage before this batch (only
// exercised indirectly via e2e/init.test.mjs and test/cli-args.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTomlConfig, normalizeConfig } from "../src/toml-config.mjs";

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
