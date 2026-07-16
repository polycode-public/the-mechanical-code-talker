// init.mjs — `tmct init`: the interface's onboarding surface.
//
// One command takes a bare directory to a WORKING tmct install: creates the `.tmct/`
// artifact tree, writes an externalised `tmct.toml`, seeds the committed tier-1 corpus
// into memory, and records provenance. Offline/deterministic/$0 (tiers 2-3 are additive
// config, never run here); idempotent and non-destructive (a benign re-init never
// throws); failure-tolerant seed (a missing/broken corpus degrades to unseeded, not a
// crash).
//
//   initRepo(dir, { force?, seed?, env? }) → { created, config, seeded, ... }
//
// The seed marker/limit/prefer mirror chat.mjs's W3 bootstrap constants on purpose: both
// write the same `.tmct/memory/corpus-seed.json`, so whichever runs first wins. Re-declared
// here rather than imported, to keep init off chat.mjs's heavy module graph.

import { copyFile, mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
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

/** `tmct init --with-persona <name>` presets: a named bundle of `extensions`/`bias`
 *  overrides written into tmct.toml. `human` makes the implicit default explicit; `code`
 *  re-activates the software-domain `seon`+`conceptnet` bundles; `empty` deactivates
 *  `human`, leaving a repo genuinely empty of corpus facts. */
export const PERSONA_PRESETS = Object.freeze({
  human: { extensions: {}, bias: { human: 1.0 } },
  code: { extensions: { seon: { active: true }, conceptnet: { active: true } }, bias: { seon: 1.0, conceptnet: 1.0 } },
  empty: { extensions: { human: { active: false } }, bias: {} },
});

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
${Array.isArray(c.graphFiles) && c.graphFiles.length ? `
# graph_files — additional graph artifacts (multi-graph). Merged with
# graph_file at read time (src/adapters/graph-merge.mjs); an id that collides
# across graphs is auto-prefixed with its graph's name, everything else
# passes through unchanged. Written by \`tmct init --graph\`/\`tmct import
# --graph\`.
graph_files = ${JSON.stringify(c.graphFiles)}
` : ""}
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
  // [memory] backend — only emitted when a caller actually supplies it.
  let out = base;
  if (config.memory && config.memory.backend !== undefined) {
    out += `
[memory]
# Storage backend for taught facts + the memory graph.
# Precedence: --memory-backend flag > TMCT_MEMORY_BACKEND env > this file >
# "default" (the built-in fallback).
#   "default" — the flat OWL-labelled JSON file under .tmct/memory/. The default.
#   "memory"  — in-process only; nothing written to disk (a library caller's option).
#   "sqlite"  — a local SQLite file at .tmct/memory/graph.sqlite.
backend = ${JSON.stringify(config.memory.backend)}
`;
  }

  // Extension-pack / bias sections — only emitted when a caller supplies them.
  const extras = {};
  if (config.extensions !== undefined) extras.extensions = config.extensions;
  if (config.bias !== undefined) extras.bias = config.bias;
  if (!Object.keys(extras).length) return out;
  return `${out}
# Extension packs + bias (src/extensions.mjs) — written by \`tmct init --with-persona\`
# or a manual edit. Recognized names (human, seon, conceptnet, tier2-aws,
# tier2-python, tier2-java, tier2-general) override the shipped defaults; any
# other name declares a new host-supplied bundle (needs its own "kind").
# [bias] is a flat bundle-name -> weight table consumed by
# src/domain/memory/bias.mjs's ranking.
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
 * @param {boolean} [opts.force]  re-write tmct.toml + re-record provenance even when
 *   already initialised (never deletes memory/seed data).
 * @param {boolean} [opts.seed]   force seeding on/off (TMCT_NO_SEED still vetoes).
 * @param {object}  [opts.env]    environment (for TMCT_NO_SEED); defaults to process.env.
 * @param {object}  [opts.persona] a resolved PERSONA_PRESETS entry ({extensions?, bias?})
 *   merged into a FRESH config only; name resolution is the caller's job (bin/tmct.mjs).
 * @param {string}  [opts.memoryBackend]  "default" | "memory" | "sqlite" — merged into a
 *   FRESH config's `[memory] backend`, and selects which backend the corpus seed writes
 *   into (via src/adapters/memory/core.mjs's openMemoryBackend).
 * @returns {Promise<{
 *   created: string[], config: object, seeded: boolean,
 *   alreadyInitialized: boolean, seedResult: (object|null), message: string
 * }>} `created` lists the absolute paths this call brought into being. Never throws on
 *   a benign re-init or a corpus failure.
 */
export async function initRepo(dir, { force = false, seed, env = process.env, persona = null, memoryBackend = null } = {}) {
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

  // ---- 1b. Importable starters (.tmct/imports) — game definition files a
  // fresh repo can discover by listing a directory, plus a README naming the
  // corpus bundle ids `tmct import` accepts. Game files are copied (import
  // --file consumes them directly); corpus bundles are listed by id, not
  // copied — the wordnet-scale ones are far too large to scaffold into every
  // repo, and `tmct import --corpus <id>` resolves ids without a local copy.
  {
    const importsDir = join(paths.tmct, "imports");
    const gamesDir = join(importsDir, "games");
    const shippedGames = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "games");
    if (!(await exists(gamesDir))) {
      await mkdir(gamesDir, { recursive: true });
      created.push(gamesDir);
    }
    try {
      for (const f of await readdir(shippedGames)) {
        if (!f.endsWith(".txt")) continue;
        const dest = join(gamesDir, f);
        if (!(await exists(dest))) {
          await copyFile(join(shippedGames, f), dest);
          created.push(dest);
        }
      }
    } catch { /* no shipped games directory — scaffold stays empty */ }
    const readmePath = join(importsDir, "README.txt");
    if (!(await exists(readmePath))) {
      await writeFile(readmePath, [
        "Importable starters for this repo.",
        "",
        "Game definitions (plain controlled-English sentences; # lines are comments):",
        "  tmct import --file .tmct/imports/games/hanoi-3.txt",
        "",
        "Corpus bundles (activate by id — no local copy needed):",
        "  tmct import --corpus human | human-medium | human-large",
        "  tmct import --corpus seon | conceptnet | aws | python | java | general",
        "  tmct import --corpus wordnet-xl | wordnet-full | namenet   (large: tens of thousands of facts)",
        "",
        "Ontology / lexicon resources are file paths declared as extension entries:",
        "  tmct import --ontology <path> | --lexicon <path>",
        "",
      ].join("\n"));
      created.push(readmePath);
    }
  }

  // ---- 2. The externalised config (preserve an existing file unless force) ----
  let config = defaultConfig();
  // Persona overrides apply only to a fresh write.
  if (persona) {
    if (persona.extensions && Object.keys(persona.extensions).length) config.extensions = persona.extensions;
    if (persona.bias && Object.keys(persona.bias).length) config.bias = persona.bias;
  }
  if (memoryBackend) config.memory = { ...(config.memory || {}), backend: memoryBackend };
  const tomlPresent = await exists(paths.toml);
  if (!tomlPresent || force) {
    await writeFile(paths.toml, renderTomlConfig(config));
    if (!tomlPresent) created.push(paths.toml);
  } else {
    // Honour the user's committed tmct.toml — read its knobs back into the returned config.
    config = await readWrittenConfig(paths.toml, config);
  }

  // ---- 3. Seed the committed corpus (offline, failure-tolerant) ----
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
    // Seeds into whichever backend config.memory.backend names. "memory" is skipped
    // outright: it's an in-process-only store that vanishes when this process exits.
    const backendChoice = String(config.memory?.backend || "").trim().toLowerCase();
    if (backendChoice === "memory") {
      seedNote = "seed skipped (memory backend is in-process only — nothing would persist past this command)";
    } else {
      const { openMemoryBackend } = await import("./adapters/memory/core.mjs");
      const { dir: memoryDir, close: closeMemoryStore } = await openMemoryBackend(root, backendChoice);
      try {
        const { resolveExtensions, seedActiveCorpusEntries } = await import("./extensions.mjs");
        const { entries } = await resolveExtensions(root);
        // `[seed] limit` caps the tier-1 ConceptNet band specifically (SEON is small
        // and always seeds whole).
        if (config.seed?.limit != null && entries.has("conceptnet")) {
          entries.set("conceptnet", { ...entries.get("conceptnet"), limit: Number(config.seed.limit) });
        }
        const { appended, skipped, total, perBundle } = await seedActiveCorpusEntries(memoryDir, entries);
        // If every active bundle failed, re-throw the first error so the outer catch
        // reports it, rather than claiming success with zero facts written.
        const bundleNames = Object.keys(perBundle);
        const allFailed = bundleNames.length > 0 && bundleNames.every((n) => perBundle[n].error);
        if (allFailed) throw new Error(perBundle[bundleNames[0]].error);
        seedResult = {
          appended, skipped, total, perBundle,
          seon: perBundle.seon?.appended || 0,
          conceptnet: perBundle.conceptnet?.appended || 0,
        };
        const markerNew = !(await exists(paths.marker));
        await mkdir(dirname(paths.marker), { recursive: true });
        await writeFile(
          paths.marker,
          JSON.stringify({
            seededAt: new Date().toISOString(),
            limit: config.seed?.limit != null ? Number(config.seed.limit) : SEED_LIMIT,
            appended: seedResult.appended,
            skipped: seedResult.skipped,
            perBundle,
          }) + "\n",
        );
        if (markerNew) created.push(paths.marker);
        seeded = true;
      } catch (err) {
        // Corpus unavailable/broken → an initialised-but-unseeded repo, not a crash.
        seedNote = `seed skipped (corpus unavailable: ${err && err.message ? err.message : err})`;
      } finally {
        await closeMemoryStore();
      }
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
    const { loadTomlConfig } = await import("./adapters/toml-config.mjs");
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
    // Sparse pass-through — src/extensions.mjs validates; this layer just carries the
    // raw tables through unmodified.
    if (raw.extensions !== undefined) cfg.extensions = raw.extensions;
    if (raw.bias !== undefined) cfg.bias = raw.bias;
    if (raw.memory && raw.memory.backend !== undefined) {
      cfg.memory = { ...cfg.memory, backend: raw.memory.backend };
    }
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
