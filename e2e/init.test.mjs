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
  CONFIG_FILE, PROVENANCE_REL, SEED_MARKER_REL, PERSONA_PRESETS,
} from "../src/services/init.mjs";
import { loadTomlConfig, normalizeConfig } from "../src/adapters/toml-config.mjs";
import { loadMemory, openMemoryBackend } from "../src/adapters/memory/core.mjs";
import { resolveExtensions, seedActiveCorpusEntries } from "../src/services/extensions.mjs";

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

test("the `code` persona's seed lands SEON and ConceptNet together, matching chat.mjs's own bootstrap", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { seed: true, persona: PERSONA_PRESETS.code });
    assert.ok(res.seedResult.seon > 0, "the curated SEON ontology landed");
    assert.ok(res.seedResult.conceptnet > 1000, "the ConceptNet band still landed, uncapped");
    assert.equal(res.seedResult.perBundle.seon.appended, res.seedResult.seon);
    assert.equal(res.seedResult.perBundle.conceptnet.appended, res.seedResult.conceptnet);
    // the `code` persona's own extensions override doesn't touch `human` (still
    // shipped active:true), so the total also includes it — internal
    // consistency is against the SUM of every bundle that actually ran, not
    // just the two named fields.
    const total = Object.values(res.seedResult.perBundle).reduce((n, b) => n + (b.appended || 0), 0);
    assert.equal(res.seedResult.appended, total, "counts are internally consistent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct init`'s zero-flag (default) seed: the human persona only; seon/conceptnet stay opt-in", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { seed: true });
    assert.ok(res.seedResult.perBundle.human?.appended > 0, "the default human bundle landed");
    assert.equal(res.seedResult.seon, 0, "seon is opt-in now, not seeded by default");
    assert.equal(res.seedResult.conceptnet, 0, "conceptnet is opt-in now, not seeded by default");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a tmct.toml activating tier2-aws: `tmct init`'s unified seed loop also seeds the tier-2 bundle", async () => {
  const dir = await tmp();
  try {
    // pre-write a tmct.toml with tier2-aws active (Part 1's [extensions] table) —
    // initRepo must PRESERVE it (not force) and honour it during the seed step.
    const toml = renderTomlConfig({ ...defaultConfig(), extensions: { "tier2-aws": { active: true } } });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "tmct.toml"), toml);
    const res = await initRepo(dir, { seed: true });
    assert.equal(res.seeded, true);
    assert.ok(res.seedResult.perBundle["tier2-aws"], "the tier-2 bundle ran in the same loop");
    assert.ok(res.seedResult.perBundle["tier2-aws"].appended > 0, "tier2-aws facts landed");
    const mem = await loadMemory(dir);
    const facts = (mem.individuals || []).filter((i) => i.class === "Fact");
    const awsFact = facts.find((f) => (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2-aws")));
    assert.ok(awsFact, "a fact provenance-tagged corpus:tier2-aws is in memory");
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

// ---- Part 7 (extension-pack batch): `tmct init --with-persona <name>` ------

test("no persona (the plain zero-flag path): renderTomlConfig output is BYTE-IDENTICAL to today — no [extensions]/[bias] sections", () => {
  const plain = renderTomlConfig(defaultConfig());
  assert.doesNotMatch(plain, /\[extensions/);
  assert.doesNotMatch(plain, /\[bias\]/);
  // pinned byte-for-byte, so any future accidental persona-section leak into
  // the default path is caught immediately, not just by a loose regex.
  assert.equal(
    plain,
    `# tmct.toml — the mechanical code talker, project configuration.
# Written by \`tmct init\`. An ABSENT file means shipped defaults (this file
# just makes them explicit and editable). Documented in the repository-interface
# onboarding surface (ROADMAP Phase 8, "Distribution: tmct init").

# Where the code-graph JSON artifact lives, relative to this file. The
# TMCT_GRAPH_FILE environment variable overrides it at runtime.
graph_file = ".tmct/graph.json"

[corpus]
# Corpus-tiering policy (ROADMAP Phase 4). The $0-offline default is inviolable;
# higher tiers are ADDITIVE and never required to answer.
#   "tier1" — committed slice only. Offline, $0. The default.
#   "tier2" — also fetch growable corpora at seed time (network, once, cached).
#   "tier3" — also consult live sources at question time (network, per-query, opt-in).
tier = "tier1"

[seed]
# Seed the committed tier-1 ConceptNet slice into .tmct/memory during init.
# Offline and deterministic. Set false, or export TMCT_NO_SEED=1, to opt out —
# the repo still initialises, just empty of corpus facts.
enabled = true
# By default the WHOLE committed slice seeds (no cap — the operator's "seed all").
# To cap it, uncomment and set a number (definitional band first):
# limit = 500
`,
  );
});

// PLAN_SEED.md's persona flip: `code` is no longer today's IMPLICIT default
// made explicit — it's the OLD default, now something a repo must opt back
// INTO (seon/conceptnet ship inactive; `human` is the new implicit default —
// see the `human`/`empty` presets below).
test("PERSONA_PRESETS.code: re-activates seon+conceptnet (now shipped inactive), explicit neutral bias", () => {
  assert.deepEqual(PERSONA_PRESETS.code, {
    extensions: { seon: { active: true }, conceptnet: { active: true } },
    bias: { seon: 1.0, conceptnet: 1.0 },
  });
});

test("PERSONA_PRESETS.human: the new implicit default made explicit — empty extensions override (human already ships active), explicit bias", () => {
  assert.deepEqual(PERSONA_PRESETS.human, { extensions: {}, bias: { human: 1.0 } });
});

test("PERSONA_PRESETS.empty: deactivates the one bundle now active by default", () => {
  assert.deepEqual(PERSONA_PRESETS.empty, { extensions: { human: { active: false } }, bias: {} });
});

test("initRepo({persona: PERSONA_PRESETS.code}): tmct.toml carries an EXPLICIT [extensions]+[bias] section and round-trips back through the read-back path", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { seed: false, persona: PERSONA_PRESETS.code });
    const text = await readFile(join(dir, CONFIG_FILE), "utf8");
    assert.match(text, /\[bias\]/);
    assert.match(text, /seon = 1/);
    assert.match(text, /conceptnet = 1/);
    assert.match(text, /\[extensions\.seon\]/, "code's extensions override re-activates seon");
    assert.match(text, /\[extensions\.conceptnet\]/, "code's extensions override re-activates conceptnet");
    // round-trips through the config loader
    const raw = await loadTomlConfig(dir);
    assert.deepEqual(raw.bias, { seon: 1, conceptnet: 1 });
    assert.deepEqual(raw.extensions, { seon: { active: true }, conceptnet: { active: true } });
    // re-init (read-back path) reflects it in res.config too
    assert.deepEqual(res.config.bias, { seon: 1.0, conceptnet: 1.0 });
    const res2 = await initRepo(dir, { seed: false }); // no persona passed — file already exists, preserved
    assert.deepEqual(res2.config.bias, { seon: 1.0, conceptnet: 1.0 }, "the written [bias] section is read back on a plain re-init");
    assert.deepEqual(res2.config.extensions, { seon: { active: true }, conceptnet: { active: true } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("initRepo({persona: PERSONA_PRESETS.human}): the new default persona's tmct.toml carries [bias] only (extensions override is empty — nothing to write)", async () => {
  const dir = await tmp();
  try {
    await initRepo(dir, { seed: false, persona: PERSONA_PRESETS.human });
    const text = await readFile(join(dir, CONFIG_FILE), "utf8");
    assert.match(text, /\[bias\]/);
    assert.match(text, /human = 1/);
    assert.doesNotMatch(text, /\[extensions/, "human's extensions override is empty — nothing to write");
    const raw = await loadTomlConfig(dir);
    assert.deepEqual(raw.bias, { human: 1 });
    assert.equal(raw.extensions, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bin/tmct.mjs: `tmct init --with-persona code` writes the persona, `--with-persona <unknown>` exits loudly and touches nothing", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));

  const dir = await tmp();
  try {
    // Pattern 2 (test-perf pass): this assertion is about the CLI boundary +
    // tmct.toml WRITE (does `--with-persona code` land the right
    // [bias]/[extensions] text), never about seed CONTENT — but the `code`
    // persona activates seon+conceptnet, and conceptnet's committed slice is
    // tens of thousands of lines (src/adapters/corpus/conceptnet-map.toml's widened
    // emit). Left to the default seed:true, this single spawnSync blew past
    // two minutes. TMCT_NO_SEED=1 skips that seed entirely (initRepo still
    // scaffolds + writes tmct.toml exactly the same either way — the seed
    // step is orthogonal to what's asserted below), so this stays a REAL
    // CLI-process test, just without paying for a full corpus seed it never
    // checks.
    const r = spawnSync(process.execPath, [BIN, "init", "--with-persona", "code"], {
      encoding: "utf8", cwd: dir, env: { ...process.env, TMCT_NO_SEED: "1" },
    });
    assert.equal(r.status, 0, r.stderr);
    const text = await readFile(join(dir, CONFIG_FILE), "utf8");
    assert.match(text, /\[bias\]/);
    assert.match(text, /seon = 1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const badDir = await tmp();
  try {
    // Unknown --with-persona is validated and rejected BEFORE initRepo/seed
    // ever runs (bin/tmct.mjs), so this spawn was never the slow one — no
    // TMCT_NO_SEED needed here, nothing gets seeded on this path regardless.
    const r = spawnSync(process.execPath, [BIN, "init", "--with-persona", "bogus"], { encoding: "utf8", cwd: badDir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown --with-persona "bogus"/);
    assert.match(r.stderr, /Available personas: human, code, empty/);
    assert.equal(await exists(join(badDir, ".tmct")), false, "an unknown persona name never scaffolds anything");
    assert.equal(await exists(join(badDir, CONFIG_FILE)), false);
  } finally {
    await rm(badDir, { recursive: true, force: true });
  }
});

// ---- memory-backend CLI seam (PLAN_SEED.md §6): `tmct init --memory-backend
// <default|memory|sqlite>` writes tmct.toml's `[memory] backend`, chat.mjs's
// createSession reads it back at CLI-flag > env > tmct.toml > default
// precedence (test/adapters/chat-memory-backend.test.mjs covers that resolution;
// these tests cover the WRITE side: renderTomlConfig + the read-back path). --

test("renderTomlConfig: config.memory.backend set — emits an explicit [memory] section", () => {
  const text = renderTomlConfig({ ...defaultConfig(), memory: { backend: "sqlite" } });
  assert.match(text, /\[memory\]/);
  assert.match(text, /backend = "sqlite"/);
});

test("renderTomlConfig: no config.memory — no [memory] section (plain zero-flag path stays byte-identical, pinned by the test above)", () => {
  const text = renderTomlConfig(defaultConfig());
  assert.doesNotMatch(text, /\[memory\]/);
});

test("initRepo + re-init: a [memory] backend written to tmct.toml is read back into res.config on a plain re-init", async () => {
  const dir = await tmp();
  try {
    await initRepo(dir, { seed: false });
    const withBackend = renderTomlConfig({ ...defaultConfig(), memory: { backend: "sqlite" } });
    await writeFile(join(dir, CONFIG_FILE), withBackend);
    const res = await initRepo(dir, { seed: false }); // no force — preserves the on-disk file, reads it back
    assert.equal(res.config.memory.backend, "sqlite");
    const raw = await loadTomlConfig(dir);
    const norm = await normalizeConfig(raw, { configDir: dir });
    assert.equal(norm.memory.backend, "sqlite");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bin/tmct.mjs: `tmct init --memory-backend sqlite` writes [memory] backend = \"sqlite\" into tmct.toml", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));

  const dir = await tmp();
  try {
    // This test is purely about the tmct.toml [memory] WRITE, not seed
    // content — TMCT_NO_SEED=1 skips the (small but nonzero) default corpus
    // seed, same reasoning as the --with-persona code test above.
    const r = spawnSync(process.execPath, [BIN, "init", "--memory-backend", "sqlite"], {
      encoding: "utf8", cwd: dir, env: { ...process.env, TMCT_NO_SEED: "1" },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /memory backend set in tmct\.toml: sqlite/);
    const text = await readFile(join(dir, CONFIG_FILE), "utf8");
    assert.match(text, /\[memory\]/);
    assert.match(text, /backend = "sqlite"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bin/tmct.mjs: `tmct init --memory-backend <unknown>` exits loudly, naming the valid choices, and touches nothing", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));

  const dir = await tmp();
  try {
    const r = spawnSync(process.execPath, [BIN, "init", "--memory-backend", "bogus"], { encoding: "utf8", cwd: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /invalid --memory-backend "bogus"/);
    assert.match(r.stderr, /Choices: default, memory, sqlite/);
    assert.equal(await exists(join(dir, ".tmct")), false, "an unknown --memory-backend value never scaffolds anything");
    assert.equal(await exists(join(dir, CONFIG_FILE)), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bin/tmct.mjs: `tmct import --memory-backend memory` on an already-initialized repo updates tmct.toml without a re-init", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));

  const dir = await tmp();
  try {
    // Neither assertion below depends on what got seeded (only on tmct.toml's
    // [memory]/[corpus] sections surviving the read-merge-rewrite), so the
    // first call skips the default corpus seed entirely via TMCT_NO_SEED.
    const first = spawnSync(process.execPath, [BIN, "init"], {
      encoding: "utf8", cwd: dir, env: { ...process.env, TMCT_NO_SEED: "1" },
    });
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSync(process.execPath, [BIN, "import", "--memory-backend", "memory"], { encoding: "utf8", cwd: dir });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /memory backend set in tmct\.toml: memory/);
    const text = await readFile(join(dir, CONFIG_FILE), "utf8");
    assert.match(text, /\[memory\]/);
    assert.match(text, /backend = "memory"/);
    // every other already-written key survives the read-merge-rewrite
    assert.match(text, /\[corpus\]/);
    assert.match(text, /tier = "tier1"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- REGRESSION (found in review): `initRepo`'s own corpus-seeding step used
// to ALWAYS write into the flat-file backend (Backend A), even when
// `--memory-backend sqlite` was configured — a split-brain repo where the
// seeded corpus sat in an inert graph.json a sqlite-backend chat session could
// never read. Fixed via src/adapters/memory/core.mjs's openMemoryBackend, the SAME
// resolver chat.mjs's createSession uses. These tests reproduce the exact
// failure the coordinator's review caught: seed, then verify the facts are
// actually reachable from the CONFIGURED backend, not just that the flag got
// written to tmct.toml. --------------------------------------------------

test("initRepo({ memoryBackend: 'sqlite', seed: true }): seeded facts land in graph.sqlite, not graph.json", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { seed: true, memoryBackend: "sqlite" });
    assert.equal(res.seeded, true);
    assert.ok(res.seedResult.appended > 0);
    assert.equal(res.config.memory.backend, "sqlite");

    const { openMemoryBackend } = await import("../src/adapters/memory/core.mjs");
    const { dir: handle, close } = await openMemoryBackend(dir, "sqlite");
    const mem = await loadMemory(handle);
    await close();
    const facts = (mem.individuals || []).filter((i) => i.class === "Fact");
    assert.ok(facts.length > 0, "seeded facts are reachable from the sqlite backend directly");

    // and NOT leaked into the flat-file backend
    if (await exists(join(dir, ".tmct", "memory", "graph.json"))) {
      const jsonMem = await loadMemory(dir);
      const jsonFacts = (jsonMem.individuals || []).filter((i) => i.class === "Fact");
      assert.equal(jsonFacts.length, 0, "no Fact ever leaked into the flat-file backend");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("initRepo({ memoryBackend: 'memory', seed: true }): seed is honestly skipped — an in-process store can't persist past this one-shot call", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { seed: true, memoryBackend: "memory" });
    assert.equal(res.seeded, false);
    assert.match(res.message, /memory backend is in-process only/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bin/tmct.mjs REGRESSION: `tmct init --memory-backend sqlite` then a flagless `tmct chat` answers from the seeded corpus, not an empty session — the exact repro that caught the split-brain bug", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));

  const dir = await tmp();
  try {
    // Kept a real seed on purpose (not TMCT_NO_SEED) — the whole point of
    // this repro is a SECOND real process (the flagless `tmct chat` below)
    // actually finding "dog" in the seeded sqlite backend, so there has to
    // be real seeded material to find. Already cheap: the default bundle is
    // `human` (corpus/tier2/human.jsonl, ~660 facts) since the persona flip,
    // not the old seon+conceptnet default.
    const init = spawnSync(process.execPath, [BIN, "init", "--memory-backend", "sqlite"], { encoding: "utf8", cwd: dir });
    assert.equal(init.status, 0, init.stderr);
    assert.match(init.stdout, /Seeded \d+ corpus facts/);

    const chat = spawnSync(process.execPath, [BIN], { encoding: "utf8", cwd: dir, input: "what is a dog\n/exit\n" });
    assert.equal(chat.status, 0, chat.stderr);
    assert.doesNotMatch(chat.stdout, /I don't know "dog" yet/, "the seeded corpus must be reachable from the configured sqlite backend");
    assert.match(chat.stdout, /dog/i);

    const { openMemoryBackend } = await import("../src/adapters/memory/core.mjs");
    const { dir: handle, close } = await openMemoryBackend(dir, "sqlite");
    const mem = await loadMemory(handle);
    await close();
    assert.ok((mem.individuals || []).filter((i) => i.class === "Fact").length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bin/tmct.mjs REGRESSION: `tmct init --corpus aws --memory-backend sqlite` (combined in one call) seeds BOTH the default corpus AND aws into sqlite — write-ordering fix", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));

  const dir = await tmp();
  try {
    // Kept a real seed on purpose (not TMCT_NO_SEED) — this test's own
    // assertions are ABOUT seed content (fact counts, aws provenance tags
    // landing in sqlite). Not shrunk further: since the persona flip, the
    // default bundle here is `human` (corpus/tier2/human.jsonl, ~660 facts)
    // plus aws (corpus/tier2/aws.jsonl, ~39 facts) — already small, unlike
    // the seon+conceptnet band the --with-persona code test above avoids.
    const r = spawnSync(process.execPath, [BIN, "init", "--corpus", "aws", "--memory-backend", "sqlite"], { encoding: "utf8", cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Seeded \d+ corpus facts/);
    assert.match(r.stdout, /seeded tier-2 corpus "aws"/);

    const { openMemoryBackend } = await import("../src/adapters/memory/core.mjs");
    const { dir: handle, close } = await openMemoryBackend(dir, "sqlite");
    const mem = await loadMemory(handle);
    await close();
    const facts = (mem.individuals || []).filter((i) => i.class === "Fact");
    const awsFacts = facts.filter((f) => (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2-aws")));
    assert.ok(awsFacts.length > 0, "the --corpus flag's seed landed in sqlite too, even combined with --memory-backend in the same call");
    assert.ok(facts.length > awsFacts.length, "the default corpus seed ALSO landed in sqlite, not just aws");
    assert.equal(await exists(join(dir, ".tmct", "memory", "graph.json")), false, "the flat-file backend was never even created");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bin/tmct.mjs REGRESSION: a later `tmct import --corpus <id>` (no --memory-backend flag) still seeds into the backend tmct.toml already names", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));

  const dir = await tmp();
  try {
    // The init call's own seed content is never checked below (only status),
    // so it skips the default corpus seed via TMCT_NO_SEED. The `import
    // --corpus aws` call keeps a real seed — its aws-provenance assertion
    // below is exactly what this regression is about.
    const init = spawnSync(process.execPath, [BIN, "init", "--memory-backend", "sqlite"], {
      encoding: "utf8", cwd: dir, env: { ...process.env, TMCT_NO_SEED: "1" },
    });
    assert.equal(init.status, 0, init.stderr);
    const imp = spawnSync(process.execPath, [BIN, "import", "--corpus", "aws"], { encoding: "utf8", cwd: dir });
    assert.equal(imp.status, 0, imp.stderr);
    assert.match(imp.stdout, /seeded tier-2 corpus "aws"/);

    const { openMemoryBackend } = await import("../src/adapters/memory/core.mjs");
    const { dir: handle, close } = await openMemoryBackend(dir, "sqlite");
    const mem = await loadMemory(handle);
    await close();
    const facts = (mem.individuals || []).filter((i) => i.class === "Fact");
    const awsFacts = facts.filter((f) => (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2-aws")));
    assert.ok(awsFacts.length > 0, "aws facts landed in the ALREADY-configured sqlite backend, not a stale flat-file default");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- `npm run init:xl` / `npm run init:xxl` (package.json's corpus-scale-up
// top tiers) — each is a fixed set of BUILTIN_EXTENSIONS bundles, activated in
// one shot. Driven here via the SAME resolveExtensions/seedActiveCorpusEntries
// loop `tmct init`/`tmct import` use underneath, not by shelling out to
// `npm run init:xl` itself (slow, and couples the test to the npm script
// string rather than the underlying mechanism). The "memory" backend keeps
// everything in-process (no disk churn between bundles); seeded CONTENT is
// backend-independent, so the resulting fact count matches a real disk-backed
// `npm run init:xl`/`init:xxl` run exactly. Real measured totals (2026-07-13,
// via the actual npm scripts, `git log`-adjacent to this batch): init:xl =
// 72,075 facts (~8m25s wall-clock, `human` + persona-size large's human-
// medium/human-large + seon + conceptnet + aws/python/java + wordnet-xl);
// init:xxl = same base with wordnet-full swapping in for wordnet-xl, plus
// namenet. ±10% tolerance below — corpora drift slightly as they evolve; an
// exact pin would bit-rot on the next refresh.
const INIT_XL_BUNDLES = {
  "human-medium": { active: true },
  "human-large": { active: true },
  seon: { active: true },
  conceptnet: { active: true },
  "tier2-aws": { active: true },
  "tier2-python": { active: true },
  "tier2-java": { active: true },
  "wordnet-xl": { active: true },
};

const INIT_XXL_BUNDLES = {
  "human-medium": { active: true },
  "human-large": { active: true },
  seon: { active: true },
  conceptnet: { active: true },
  "tier2-aws": { active: true },
  "tier2-python": { active: true },
  "tier2-java": { active: true },
  "wordnet-full": { active: true },
  namenet: { active: true },
};

/** Seed one bundle-set into a fresh scratch dir via the real
 *  resolveExtensions/seedActiveCorpusEntries loop, in-process (no disk churn
 *  between bundles), and return the resulting Fact count. `human` rides along
 *  implicitly — it ships active:true by default, same as a plain `tmct init`. */
async function seedBundleSet(extensions) {
  const dir = await tmp();
  try {
    const toml = renderTomlConfig({ ...defaultConfig(), extensions });
    await writeFile(join(dir, "tmct.toml"), toml);
    const { entries } = await resolveExtensions(dir);
    const { dir: memHandle } = await openMemoryBackend(dir, "memory");
    await seedActiveCorpusEntries(memHandle, entries);
    const mem = await loadMemory(memHandle);
    return (mem.individuals || []).filter((i) => i.class === "Fact").length;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("npm run init:xl's exact bundle set seeds within ±10% of the real measured total (72,075 facts, measured via the actual npm script)", async () => {
  const count = await seedBundleSet(INIT_XL_BUNDLES);
  const EXPECTED = 72075;
  assert.ok(
    count >= EXPECTED * 0.9 && count <= EXPECTED * 1.1,
    `init:xl's bundle set seeded ${count} facts, expected ~${EXPECTED} (±10%)`,
  );
});

// init:xxl's own real, full-scale total (wordnet-full's 192,498-row conversion
// dominates) is a FOLLOW-UP measurement — a live `npm run init:xxl` run against
// this same worktree showed corpus seeding is roughly quadratic in total
// individuals (`syncFactSources`'s per-fact linear scans in
// src/adapters/memory/core.mjs, out of this batch's scope to fix), so a literal
// full-scale reseed here would cost this suite something on the order of an
// hour, every `npm test` run, forever — not a proportionate regression guard.
// This test instead does two REAL, bounded things: (1) confirms every bundle
// `init:xxl` activates is a recognized, activatable BUILTIN_EXTENSIONS entry
// (the actual wiring check — instant), and (2) seeds a `limit`-capped slice of
// wordnet-full plus the full (small, ~7,260-fact) namenet bundle, so the real
// corpus/map conversion pipeline is exercised end to end for both of
// `init:xxl`'s NEW bundles over `init:xl`, without paying the full-scale cost.
// HANDOVER.md's "Version state" carries the real, honestly-measured
// `init:xxl` total once that follow-up run completes.
test("npm run init:xxl's bundle set: every named bundle is a recognized, activatable BUILTIN_EXTENSIONS entry", async () => {
  const dir = await tmp();
  try {
    const toml = renderTomlConfig({ ...defaultConfig(), extensions: INIT_XXL_BUNDLES });
    await writeFile(join(dir, "tmct.toml"), toml);
    const { entries } = await resolveExtensions(dir);
    for (const name of Object.keys(INIT_XXL_BUNDLES)) {
      assert.ok(entries.has(name), `init:xxl names "${name}" but it's not a recognized extension entry`);
      assert.equal(entries.get(name).active, true, `"${name}" should resolve active given tmct.toml's override`);
    }
    assert.ok(entries.has("human") && entries.get("human").active, "human rides along implicitly (shipped active by default)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("npm run init:xxl's NEW bundles over init:xl (wordnet-full, namenet) really seed real facts via the same seedActiveCorpusEntries mechanism, at a bounded scale", async () => {
  const dir = await tmp();
  try {
    const toml = renderTomlConfig({
      ...defaultConfig(),
      extensions: { "wordnet-full": { active: true }, namenet: { active: true } },
    });
    await writeFile(join(dir, "tmct.toml"), toml);
    const { entries } = await resolveExtensions(dir);
    // A small, deterministic cap on wordnet-full only — namenet (7,260 rows)
    // stays uncapped, cheap at its real size.
    entries.get("wordnet-full").limit = 2000;
    const { dir: memHandle } = await openMemoryBackend(dir, "memory");
    const { perBundle } = await seedActiveCorpusEntries(memHandle, entries);
    assert.ok(perBundle["wordnet-full"]?.appended > 0, "the capped wordnet-full slice seeded real facts");
    assert.ok(perBundle["wordnet-full"].appended <= 2000, "the limit was honoured");
    assert.ok(perBundle.namenet?.appended > 0, "namenet seeded real facts");
    // namenet's real, full-scale total (2026-07-13, via `tmct import --corpus
    // namenet` standalone): 7,260 facts — no dedup overlap expected against an
    // otherwise-empty dir's wordnet-full slice.
    assert.ok(
      perBundle.namenet.appended >= 7260 * 0.9 && perBundle.namenet.appended <= 7260 * 1.1,
      `namenet seeded ${perBundle.namenet.appended} facts, expected ~7,260 (±10%)`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
