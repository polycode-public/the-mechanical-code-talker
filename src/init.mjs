// init.mjs — `tmct init`: the interface's onboarding surface.
//
// One command takes a bare directory (a user's repo, or a host package such as
// seonix) to a WORKING tmct install: it creates the `.tmct/` artifact tree,
// writes an externalised `tmct.toml` (the seonix.toml documented-config pattern),
// seeds the committed tier-1 corpus into memory, and records provenance of what
// it did. See ROADMAP Phase 8 ("Distribution: tmct init") and the Phase-4
// corpus-tiering policy.
//
//   initRepo(dir, { force?, seed?, env? }) → { created, config, seeded, ... }
//
// DESIGN RULES (load-bearing):
//   - OFFLINE, DETERMINISTIC, $0. The seed is the tier-1 committed ConceptNet
//     slice already in the tarball — no network, ever. The $0-offline default is
//     inviolable (ROADMAP Phase 4); tiers 2-3 are additive config, never run here.
//   - IDEMPOTENT and NON-DESTRUCTIVE. Safe to re-run. A benign re-init NEVER
//     throws — it returns an honest result whose `message` says nothing changed.
//     Existing `tmct.toml` and an existing seed are preserved unless `force`.
//   - FAILURE-TOLERANT SEED. A missing/broken corpus degrades to an unseeded (but
//     still initialised) repo — the directory scaffold and config always land.
//
// The seed marker + limit + prefer mirror src/chat.mjs's W3 bootstrap
// (SEED_MARKER_REL / SEED_LIMIT / SEED_PREFER) ON PURPOSE: both write the same
// `.tmct/memory/corpus-seed.json`, so whichever of `tmct init` and first-run
// bootstrap happens first wins and the other short-circuits. They are re-declared
// here (not imported) to keep init off chat.mjs's heavy module graph.

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as stringifyToml } from "smol-toml";

export const CONFIG_FILE = "tmct.toml";
export const PROVENANCE_REL = join(".tmct", "init.json");
export const MEMORY_DIR_REL = join(".tmct", "memory");
export const SESSIONS_DIR_REL = join(".tmct", "sessions");
export const SEED_MARKER_REL = join(".tmct", "memory", "corpus-seed.json");

/** `undefined` = seed the WHOLE ConceptNet band (no cap) — matches chat.mjs
 *  SEED_LIMIT so an init-seeded repo and a bootstrap-seeded repo carry the identical
 *  slice. A number in `tmct.toml`'s `seed.limit` still caps (explicit user override);
 *  absent ⇒ all. */
export const SEED_LIMIT = undefined;

/** Predicate order for the seed (definitional band first) — matches chat.mjs
 *  SEED_PREFER. With the cap lifted this sets ORDER only; every fact seeds. */
export const SEED_PREFER = ["rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf"];

/** The shipped default config — the exact shape written into `tmct.toml` and
 *  echoed back in the result's `config`. Absent file ⇒ these values apply. */
export function defaultConfig() {
  return {
    graphFile: join(".tmct", "graph.json"),
    corpus: { tier: "tier1" },
    seed: { enabled: true },
  };
}

/** Read this package's version (best-effort, for provenance). */
async function tmctVersion() {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    return pkg.version || null;
  } catch {
    return null;
  }
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Render the documented, commented `tmct.toml` for a config object. Hand-written
 *  (not smol-toml stringify) so every key ships with the prose that makes the file
 *  a self-explaining config surface — the seonix.toml pattern. The output parses
 *  back cleanly through toml-config.mjs's loadTomlConfig. */
export function renderTomlConfig(config = defaultConfig()) {
  const c = { ...defaultConfig(), ...config };
  const corpus = { ...defaultConfig().corpus, ...(config.corpus || {}) };
  const seed = { ...defaultConfig().seed, ...(config.seed || {}) };
  const base = `# tmct.toml — the mechanical code talker, project configuration.
# Written by \`tmct init\`. An ABSENT file means shipped defaults (this file
# just makes them explicit and editable). Documented in the repository-interface
# onboarding surface (ROADMAP Phase 8, "Distribution: tmct init").

# Where the code-graph JSON artifact lives, relative to this file. The
# TMCT_GRAPH_FILE environment variable overrides it at runtime.
graph_file = ${JSON.stringify(c.graphFile)}

[corpus]
# Corpus-tiering policy (ROADMAP Phase 4). The $0-offline default is inviolable;
# higher tiers are ADDITIVE and never required to answer.
#   "tier1" — committed slice only. Offline, $0. The default.
#   "tier2" — also fetch growable corpora at seed time (network, once, cached).
#   "tier3" — also consult live sources at question time (network, per-query, opt-in).
tier = ${JSON.stringify(corpus.tier)}

[seed]
# Seed the committed tier-1 ConceptNet slice into .tmct/memory during init.
# Offline and deterministic. Set false, or export TMCT_NO_SEED=1, to opt out —
# the repo still initialises, just empty of corpus facts.
enabled = ${seed.enabled ? "true" : "false"}
# By default the WHOLE committed slice seeds (no cap — the operator's "seed all").
# To cap it, uncomment and set a number (definitional band first):
${seed.limit != null ? `limit = ${Number(seed.limit)}` : "# limit = 500"}
`;
  // Extension-pack / bias sections (src/extensions.mjs) — ONLY emitted when a
  // caller actually supplies them (an explicit `--with-persona`, or a manual
  // override); the plain zero-flag `tmct init` output stays BYTE-IDENTICAL to
  // before this feature existed. Rendered via smol-toml's own stringify (not
  // hand-written prose like the base file above) — a plain, uncommented
  // config fragment is honest about being machine-written/round-tripped.
  const extras = {};
  if (config.extensions !== undefined) extras.extensions = config.extensions;
  if (config.bias !== undefined) extras.bias = config.bias;
  if (!Object.keys(extras).length) return base;
  return `${base}
# Extension packs + bias (src/extensions.mjs) — written by \`tmct init --with-persona\`
# or a manual edit. Recognized names (seon, conceptnet, tier2-aws, tier2-python,
# tier2-java) override the shipped defaults; any other name declares a new
# host-supplied bundle (needs its own "kind"). [bias] is a flat bundle-name ->
# weight table consumed by src/memory/bias.mjs's ranking.
${stringifyToml(extras)}`;
}

/** Should the seed run? Explicit `opts.seed` wins; otherwise the config's
 *  `seed.enabled`; and TMCT_NO_SEED=<non-empty> is a hard veto over both (the
 *  documented environment opt-out, honoured even when config says enabled). */
function seedRequested({ optSeed, configEnabled, env }) {
  const noSeed = env && String(env.TMCT_NO_SEED || "").trim();
  if (noSeed) return false;
  if (optSeed !== undefined) return Boolean(optSeed);
  return Boolean(configEnabled);
}

/**
 * Initialise `dir` for tmct. Idempotent, non-destructive, offline.
 *
 * @param {string} dir  target directory (a repo root, or a host package root).
 * @param {object} [opts]
 * @param {boolean} [opts.force]  re-write tmct.toml + re-record provenance even
 *   when the repo is already initialised (never deletes memory/seed data).
 * @param {boolean} [opts.seed]   force seeding on/off, overriding tmct.toml's
 *   `seed.enabled` (TMCT_NO_SEED still vetoes).
 * @param {object}  [opts.env]    environment (for TMCT_NO_SEED); defaults to
 *   process.env.
 * @returns {Promise<{
 *   created: string[], config: object, seeded: boolean,
 *   alreadyInitialized: boolean, seedResult: (object|null), message: string
 * }>} `created` lists the ABSOLUTE paths this call brought into being (empty on a
 *   benign no-op re-init). Never throws on a benign re-init or a corpus failure.
 */
export async function initRepo(dir, { force = false, seed, env = process.env } = {}) {
  const root = resolve(dir);
  const created = [];
  const paths = {
    tmct: join(root, ".tmct"),
    memory: join(root, MEMORY_DIR_REL),
    sessions: join(root, SESSIONS_DIR_REL),
    toml: join(root, CONFIG_FILE),
    provenance: join(root, PROVENANCE_REL),
    marker: join(root, SEED_MARKER_REL),
  };

  const wasInitialized = await exists(paths.provenance);

  // ---- 1. The artifact directory scaffold (always idempotent) ----
  for (const d of [paths.tmct, paths.memory, paths.sessions]) {
    if (!(await exists(d))) {
      await mkdir(d, { recursive: true });
      created.push(d);
    }
  }

  // ---- 2. The externalised config (preserve an existing file unless force) ----
  let config = defaultConfig();
  const tomlPresent = await exists(paths.toml);
  if (!tomlPresent || force) {
    await writeFile(paths.toml, renderTomlConfig(config));
    if (!tomlPresent) created.push(paths.toml);
  } else {
    // Honour the user's committed tmct.toml — read its knobs back so the returned
    // config (and the seed decision) reflect what's actually on disk.
    config = await readWrittenConfig(paths.toml, config);
  }

  // ---- 3. Seed the tier-1 committed corpus (offline, failure-tolerant) ----
  let seeded = false;
  let seedResult = null;
  let seedNote = "";
  const wantSeed = seedRequested({ optSeed: seed, configEnabled: config.seed?.enabled, env });
  if (!wantSeed) {
    seedNote = env && String(env.TMCT_NO_SEED || "").trim()
      ? "seed skipped (TMCT_NO_SEED set)"
      : "seed skipped (disabled)";
  } else if ((await exists(paths.marker)) && !force) {
    seedNote = "seed skipped (already seeded — marker present)";
  } else {
    try {
      const { seedMemory } = await import("./corpus/conceptnet.mjs");
      const limit = config.seed?.limit != null ? Number(config.seed.limit) : SEED_LIMIT;
      seedResult = await seedMemory(root, { limit, prefer: SEED_PREFER });
      const markerNew = !(await exists(paths.marker));
      await mkdir(dirname(paths.marker), { recursive: true });
      await writeFile(
        paths.marker,
        JSON.stringify({
          seededAt: new Date().toISOString(),
          limit,
          appended: seedResult.appended,
          skipped: seedResult.skipped,
        }) + "\n",
      );
      if (markerNew) created.push(paths.marker);
      seeded = true;
    } catch (err) {
      // Corpus unavailable/broken → an initialised-but-unseeded repo, not a crash.
      seedNote = `seed skipped (corpus unavailable: ${err && err.message ? err.message : err})`;
    }
  }

  // ---- 4. Record provenance (what was created, when, by which version) ----
  const provenanceNew = !(await exists(paths.provenance));
  const provenance = {
    tool: "tmct init",
    tmctVersion: await tmctVersion(),
    initializedAt: new Date().toISOString(),
    dir: root,
    config,
    seeded,
    seedResult,
    created,
  };
  await writeFile(paths.provenance, JSON.stringify(provenance, null, 2) + "\n");
  if (provenanceNew) created.push(paths.provenance);

  const alreadyInitialized = wasInitialized && !force;
  const message = buildMessage({ alreadyInitialized, force, created, seeded, seedNote, seedResult });

  return { created, config, seeded, alreadyInitialized, seedResult, message };
}

/** Read a present tmct.toml back into the canonical config shape (so a re-init
 *  respects the on-disk file). Falls back to `base` on any read/parse trouble —
 *  init must never crash on a malformed user file; the runtime loader
 *  (toml-config.mjs) is where a bad file surfaces its error. */
async function readWrittenConfig(tomlPath, base) {
  try {
    const { loadTomlConfig } = await import("./toml-config.mjs");
    const raw = await loadTomlConfig(dirname(tomlPath));
    if (!raw) return base;
    const cfg = { ...base };
    if (raw.graph_file !== undefined) cfg.graphFile = String(raw.graph_file);
    if (raw.corpus && raw.corpus.tier !== undefined) cfg.corpus = { ...cfg.corpus, tier: raw.corpus.tier };
    if (raw.seed) {
      cfg.seed = { ...cfg.seed };
      if (raw.seed.enabled !== undefined) cfg.seed.enabled = Boolean(raw.seed.enabled);
      if (raw.seed.limit !== undefined) cfg.seed.limit = Number(raw.seed.limit);
    }
    // Sparse pass-through (src/extensions.mjs validates; this layer just carries
    // the raw tables through unmodified, same discipline as toml-config.mjs's
    // normalizeConfig).
    if (raw.extensions !== undefined) cfg.extensions = raw.extensions;
    if (raw.bias !== undefined) cfg.bias = raw.bias;
    return cfg;
  } catch {
    return base;
  }
}

function buildMessage({ alreadyInitialized, force, created, seeded, seedNote, seedResult }) {
  if (alreadyInitialized && created.length === 0) {
    return `Already initialized — nothing to do (re-run with force to rewrite tmct.toml). ${seedNote || ""}`.trim();
  }
  const parts = [];
  parts.push(force && alreadyInitialized ? "Re-initialized" : "Initialized");
  parts.push(`tmct here (${created.length} path${created.length === 1 ? "" : "s"} created).`);
  if (seeded && seedResult) {
    parts.push(`Seeded ${seedResult.appended} corpus fact${seedResult.appended === 1 ? "" : "s"} into memory.`);
  } else if (seedNote) {
    parts.push(seedNote + ".");
  }
  return parts.join(" ");
}
