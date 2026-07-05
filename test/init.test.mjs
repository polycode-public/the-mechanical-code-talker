// init tests — `tmct init` (ROADMAP Phase 8, "Distribution: tmct init").
//
// initRepo takes a BARE directory to a working tmct install: it scaffolds
// `.tmct/`, writes a documented `tmct.toml`, seeds the tier-1 committed corpus
// into memory, and records provenance. The load-bearing guarantees under test:
//   - idempotent + non-destructive: a re-run never throws and changes nothing;
//   - offline/$0 seed with a TMCT_NO_SEED (and config) opt-out;
//   - honest re-init message; `force` re-writes; corpus failure degrades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  initRepo, defaultConfig, renderTomlConfig,
  CONFIG_FILE, PROVENANCE_REL, SEED_MARKER_REL,
} from "../src/init.mjs";
import { loadTomlConfig, normalizeConfig } from "../src/toml-config.mjs";
import { loadMemory } from "../src/memory/core.mjs";

async function tmp() {
  return mkdtemp(join(tmpdir(), "tmct-init-"));
}
async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

test("fresh init: scaffolds .tmct/, writes tmct.toml, records provenance, returns structured result", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { seed: false }); // seed off → keep this test fast+pure
    assert.equal(res.alreadyInitialized, false);
    // the artifact tree
    assert.ok(await exists(join(dir, ".tmct")));
    assert.ok(await exists(join(dir, ".tmct", "memory")));
    assert.ok(await exists(join(dir, ".tmct", "sessions")));
    // the externalised config
    assert.ok(await exists(join(dir, CONFIG_FILE)));
    // provenance
    assert.ok(await exists(join(dir, PROVENANCE_REL)));
    // structured result: created lists absolute paths, config echoed, seeded flag
    assert.ok(Array.isArray(res.created) && res.created.length > 0);
    assert.ok(res.created.every((p) => p.startsWith(dir)));
    assert.ok(res.created.includes(join(dir, CONFIG_FILE)));
    assert.deepEqual(res.config, defaultConfig());
    assert.equal(res.seeded, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct.toml is documented, parseable, and round-trips through the config loader", async () => {
  const dir = await tmp();
  try {
    await initRepo(dir, { seed: false });
    const text = await readFile(join(dir, CONFIG_FILE), "utf8");
    // documented (comments) + the three documented keys present
    assert.match(text, /^# tmct\.toml/);
    assert.match(text, /graph_file/);
    assert.match(text, /\[corpus\]/);
    assert.match(text, /tier =/);
    assert.match(text, /\[seed\]/);
    // smol-toml parses it, and normalizeConfig recognises the init keys
    const raw = await loadTomlConfig(dir);
    assert.ok(raw);
    assert.equal(raw.graph_file, join(".tmct", "graph.json"));
    assert.equal(raw.corpus.tier, "tier1");
    assert.equal(raw.seed.enabled, true);
    const norm = await normalizeConfig(raw, { configDir: dir });
    assert.equal(norm.corpus.tier, "tier1");
    assert.equal(norm.seed.enabled, true);
    assert.equal(norm.seed.limit, undefined, "no cap by default — the whole slice seeds (0.7.0 seed-all)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seeding: on by default, offline, writes facts into .tmct/memory + a marker", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { seed: true });
    assert.equal(res.seeded, true);
    assert.ok(res.seedResult && res.seedResult.appended > 0);
    // marker present, memory graph carries Fact individuals
    assert.ok(await exists(join(dir, SEED_MARKER_REL)));
    const mem = await loadMemory(dir);
    const facts = (mem.individuals || []).filter((i) => i.class === "Fact");
    assert.ok(facts.length > 0, "seeded corpus facts landed in memory");
    // provenance records the seed
    const prov = JSON.parse(await readFile(join(dir, PROVENANCE_REL), "utf8"));
    assert.equal(prov.seeded, true);
    assert.equal(prov.tool, "tmct init");
    assert.ok(prov.initializedAt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seed opt-out: TMCT_NO_SEED vetoes even when config enables it", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { env: { TMCT_NO_SEED: "1" } });
    assert.equal(res.seeded, false);
    assert.ok(!(await exists(join(dir, SEED_MARKER_REL))));
    assert.match(res.message, /TMCT_NO_SEED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("idempotent + non-destructive: a benign re-init never throws and creates nothing new", async () => {
  const dir = await tmp();
  try {
    await initRepo(dir, { seed: false });
    const res2 = await initRepo(dir, { seed: false });
    assert.equal(res2.alreadyInitialized, true);
    assert.deepEqual(res2.created, []);
    assert.match(res2.message, /[Aa]lready initialized/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("re-init preserves a user-edited tmct.toml unless force", async () => {
  const dir = await tmp();
  try {
    await initRepo(dir, { seed: false });
    // user edits their config (tier bump)
    const edited = renderTomlConfig({ ...defaultConfig(), corpus: { tier: "tier2" } });
    await writeFile(join(dir, CONFIG_FILE), edited);
    // a plain re-init leaves it alone AND reads it back into the result config
    const res = await initRepo(dir, { seed: false });
    const after = await readFile(join(dir, CONFIG_FILE), "utf8");
    assert.equal(after, edited, "user tmct.toml preserved on re-init");
    assert.equal(res.config.corpus.tier, "tier2", "re-init reflects the on-disk config");
    // force re-writes it back to defaults
    const forced = await initRepo(dir, { seed: false, force: true });
    assert.equal(forced.alreadyInitialized, false);
    const reset = parseToml(await readFile(join(dir, CONFIG_FILE), "utf8"));
    assert.equal(reset.corpus.tier, "tier1", "force rewrote tmct.toml to defaults");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seed is idempotent: marker short-circuits a second seed", async () => {
  const dir = await tmp();
  try {
    const first = await initRepo(dir, { seed: true });
    assert.equal(first.seeded, true);
    const marker1 = await readFile(join(dir, SEED_MARKER_REL), "utf8");
    // second init: marker present → seed skipped, marker unchanged, no throw
    const second = await initRepo(dir, { seed: true });
    assert.equal(second.seeded, false);
    assert.match(second.message, /already seeded|Already initialized/i);
    const marker2 = await readFile(join(dir, SEED_MARKER_REL), "utf8");
    assert.equal(marker1, marker2, "marker untouched on the idempotent re-seed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seed failure degrades: a broken corpus still yields an initialised repo", async () => {
  const dir = await tmp();
  try {
    // Pre-plant a directory where the memory graph FILE must go, so the seed's
    // write fails — but the scaffold + config + provenance must still land.
    await mkdir(join(dir, ".tmct", "memory", "graph.json"), { recursive: true });
    const res = await initRepo(dir, { seed: true });
    assert.equal(res.seeded, false);
    assert.ok(await exists(join(dir, CONFIG_FILE)));
    assert.ok(await exists(join(dir, PROVENANCE_REL)));
    assert.match(res.message, /seed skipped/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nested/non-existent target dir is created (mkdir recursive)", async () => {
  const base = await tmp();
  const dir = join(base, "a", "b", "c");
  try {
    const res = await initRepo(dir, { seed: false });
    assert.ok(await exists(join(dir, ".tmct")));
    assert.equal(res.config.graphFile, join(".tmct", "graph.json"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
