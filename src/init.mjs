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

/** `tmct init --with-persona <name>` presets (Part 7 of the extension-pack
 *  batch; PLAN_SEED.md §2 flips which preset is the SHIPPED implicit
 *  default): a named bundle of `extensions`/`bias` overrides, written into
 *  tmct.toml alongside the plain defaults.
 *
 *  - `human` — the NEW implicit default (src/extensions.mjs's
 *    BUILTIN_EXTENSIONS already ships `human` active and `seon`/`conceptnet`
 *    inactive) made EXPLICIT: an empty `extensions` override (nothing to
 *    add — the builtin defaults already are this persona) plus an explicit
 *    `[bias] human = 1.0`, so a repo that asks for `--with-persona human`
 *    has a self-documenting tmct.toml rather than relying on an unstated
 *    implicit default — the exact same discipline `code` below already used
 *    for the OLD default.
 *  - `code` — TODAY'S OLD IMPLICIT DEFAULT, now something a repo must
 *    request explicitly: re-activates `seon`+`conceptnet` (both now
 *    shipped inactive) and sets their bias, for a caller (e.g. seonix's own
 *    code-domain chat surface) that still wants the software-domain seed.
 *  - `empty` — the advanced escape hatch (PLAN_SEED.md §7): deactivates the
 *    one bundle now active by default (`human`), leaving a repo genuinely
 *    empty of corpus facts for a consumer bringing its own ontology/lexicon/
 *    corpus. Does NOT reduce npm package size (§7's own documented caveat —
 *    `corpus/` ships unconditionally either way).
 *
 *  Kept minimal on purpose — this batch's job is the persona SEAM, not a
 *  curated library of presets. */
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
# graph_file at read time (src/graph-merge.mjs); an id that collides
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
# or a manual edit. Recognized names (human, seon, conceptnet, tier2-aws,
# tier2-python, tier2-java, tier2-general) override the shipped defaults; any
# other name declares a new host-supplied bundle (needs its own "kind").
# [bias] is a flat bundle-name -> weight table consumed by
# src/memory/bias.mjs's ranking.
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
 * @param {object}  [opts.persona] a resolved PERSONA_PRESETS entry
 *   ({extensions?, bias?}) to merge into the FRESH config before it's written
 *   (Part 7, `tmct init --with-persona <name>`). Name -> preset resolution
 *   and unknown-name validation are the CALLER'S job (bin/tmct.mjs) — this
 *   only ever sees an already-resolved preset object (or nothing). Has no
 *   effect when tmct.toml already exists and `force` isn't set (the existing
 *   "preserve a user's tmct.toml" rule wins, same as `seed`/`corpus.tier`).
 * @returns {Promise<{
 *   created: string[], config: object, seeded: boolean,
 *   alreadyInitialized: boolean, seedResult: (object|null), message: string
 * }>} `created` lists the ABSOLUTE paths this call brought into being (empty on a
 *   benign no-op re-init). Never throws on a benign re-init or a corpus failure.
 */
export async function initRepo(dir, { force = false, seed, env = process.env, persona = null } = {}) {
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
  // Persona overrides (Part 7) apply ONLY to a FRESH write — an empty preset
  // field (e.g. `code`'s `extensions: {}`) is a genuine no-op, never an
  // explicit-empty-section write (renderTomlConfig only emits [extensions]/
  // [bias] when the merged config actually carries a non-empty one — the
  // plain zero-flag `tmct init` output stays byte-identical either way).
  if (persona) {
    if (persona.extensions && Object.keys(persona.extensions).length) config.extensions = persona.extensions;
    if (persona.bias && Object.keys(persona.bias).length) config.bias = persona.bias;
  }
  const tomlPresent = await exists(paths.toml);
  if (!tomlPresent || force) {
    await writeFile(paths.toml, renderTomlConfig(config));
    if (!tomlPresent) created.push(paths.toml);
  } else {
    // Honour the user's committed tmct.toml — read its knobs back so the returned
    // config (and the seed decision) reflect what's actually on disk.
    config = await readWrittenConfig(paths.toml, config);
  }

  // ---- 3. Seed the committed corpus (offline, failure-tolerant) ----
  // DELIBERATE BUG FIX (this batch): `tmct init`'s zero-flag seed step used to
  // seed ONLY the ConceptNet band, never the curated SEON ontology — unlike
  // chat.mjs's own first-run bootstrap (seedBootstrapMemory), which has always
  // seeded BOTH. Both now go through the SAME unified loop
  // (src/extensions.mjs's resolveExtensions + seedActiveCorpusEntries), so
  // `tmct init`'s seed matches chat's bootstrap exactly — this changes
  // `initRepo`'s seeded fact COUNT (test/init.test.mjs's seed-count assertions
  // were updated for the larger post-fix totals, deliberately, in the same
  // commit as this fix).
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
      const { resolveExtensions, seedActiveCorpusEntries } = await import("./extensions.mjs");
      const { entries } = await resolveExtensions(root);
      // `tmct.toml`'s `[seed] limit` knob is documented as capping the tier-1
      // ConceptNet band specifically (the curated SEON ontology is small and
      // always seeds whole) — so it overrides ONLY the resolved "conceptnet"
      // entry's limit, exactly like the pre-fix single-corpus seed did.
      if (config.seed?.limit != null && entries.has("conceptnet")) {
        entries.set("conceptnet", { ...entries.get("conceptnet"), limit: Number(config.seed.limit) });
      }
      const { appended, skipped, total, perBundle } = await seedActiveCorpusEntries(root, entries);
      // seedActiveCorpusEntries is failure-tolerant PER BUNDLE (a bad third-party
      // pack never aborts the others) — but initRepo's own "FAILURE-TOLERANT
      // SEED" contract is about the SEED AS A WHOLE degrading honestly. If every
      // active bundle failed (e.g. the memory graph file itself is unwritable —
      // see test/init.test.mjs "seed failure degrades"), re-throw the first
      // bundle's error so the SAME outer catch below reports the familiar "seed
      // skipped (corpus unavailable: …)" note, rather than claiming success with
      // zero facts actually written.
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
