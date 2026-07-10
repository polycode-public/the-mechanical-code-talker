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

test("DELIBERATE BUG FIX (this batch): `tmct init`'s zero-flag seed now seeds SEON too, matching chat.mjs's own bootstrap (it used to seed ConceptNet ONLY) — exercised via the `code` persona, since PLAN_SEED.md's later flip made seon/conceptnet opt-in", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { seed: true, persona: PERSONA_PRESETS.code });
    assert.ok(res.seedResult.seon > 0, "the curated SEON ontology landed (was 0 before this fix)");
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

test("`tmct init`'s zero-flag (default) seed: the human persona, not seon/conceptnet, per PLAN_SEED.md's persona flip", async () => {
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
    const r = spawnSync(process.execPath, [BIN, "init", "--with-persona", "code"], { encoding: "utf8", cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const text = await readFile(join(dir, CONFIG_FILE), "utf8");
    assert.match(text, /\[bias\]/);
    assert.match(text, /seon = 1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const badDir = await tmp();
  try {
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
