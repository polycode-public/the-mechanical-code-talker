// tmct.toml loader (pure library — no cli wiring here).
//
// The runtime config still lives in config.mjs (`loadConfig`, the
// TMCT_GRAPH_FILE knob) and stays byte-identical. This module is the *product*
// config surface: an optional `tmct.toml` at a repo/estate root that a consumer
// checks in to steer indexing and scoring. Absent file = shipped defaults (today's
// behaviour, byte-for-byte).
//
// Three pure entry points, consumed later by the cli:
//   loadTomlConfig(rootDir,{file})   → raw parsed TOML, or null when absent
//   normalizeConfig(raw,{configDir}) → canonical sparse shape (present keys only)
//   mergeEffective({args,toml,defaults}) → {effective, sources} (arg>toml>default)

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "smol-toml";

export const CONFIG_FILE = "tmct.toml";

/** Read `<rootDir>/tmct.toml` (or an explicit `{file}` override — `--config
 *  <path>`, a file, not a dir) and return the raw parsed table.
 *  - Absent file → `null` (the "today" signal: shipped defaults, byte-identical).
 *  - Present but unparseable → throws a clear error naming the file + parse cause
 *    (a `secret_exclude` misparse is security-relevant — never swallow it). */
export async function loadTomlConfig(rootDir, { file: fileOverride } = {}) {
  const file = fileOverride || join(rootDir, CONFIG_FILE);
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return parse(text);
  } catch (err) {
    throw new Error(`Invalid ${CONFIG_FILE} at ${file}: ${err && err.message ? err.message : err}`);
  }
}

/** Resolve the `repositories` value → absolute paths.
 *  - array  → each entry resolved relative to `configDir`
 *  - string → path to a newline-delimited file (relative to `configDir`); each
 *             non-blank, non-`#` line resolved relative to `configDir`. */
async function resolveRepositories(value, configDir) {
  let entries;
  if (Array.isArray(value)) {
    entries = value;
  } else {
    const file = resolve(configDir, String(value));
    const text = await readFile(file, "utf8");
    entries = text.split("\n");
  }
  const out = [];
  for (const raw of entries) {
    const line = String(raw).trim();
    if (!line || line.startsWith("#")) continue;
    out.push(resolve(configDir, line));
  }
  return out;
}

// Recognized keys that parse and normalize but are not yet honoured by any
// consumer. Surfaced in `normalizeConfig().unwired` so the cli can warn once
// rather than silently ignore them.
const UNWIRED_KEYS = [
  ["index", "include_text"],
  ["index", "include_structure"],
  ["index", "respect_gitignore"],
  ["index", "markdown_sections"],
  ["index", "vue"],
];

/** Map a raw parsed TOML table → a canonical, sparse shape. Only keys actually
 *  present in `raw` appear (so a consumer can tell "unset" from "set to a value
 *  that equals the default" — the tri-state that `mergeEffective` relies on).
 *  `configDir` anchors every relative path. Async because `repositories` may name
 *  a newline-delimited file that has to be read. */
export async function normalizeConfig(raw, { configDir } = {}) {
  const src = raw || {};
  const dir = configDir || process.cwd();
  const cfg = {};

  if (src.repositories !== undefined) {
    cfg.repositories = await resolveRepositories(src.repositories, dir);
  }
  if (src.out_root !== undefined) {
    cfg.outRoot = resolve(dir, String(src.out_root));
  }

  // `tmct init` onboarding keys. Sparse like the rest: only a
  // key actually present appears, so "unset" stays distinguishable from "set to
  // the default". `graph_file` is resolved against configDir to match outRoot.
  if (src.graph_file !== undefined) {
    cfg.graphFile = resolve(dir, String(src.graph_file));
  }
  // `graph_files` (array, multi-graph): sits ALONGSIDE `graph_file`, never
  // replaces it. A single-element array is
  // legal but `graph_file` stays the byte-identical single-graph path most
  // repos use; `graph_files` only matters once it names more than one file.
  if (src.graph_files !== undefined) {
    const arr = Array.isArray(src.graph_files) ? src.graph_files : [src.graph_files];
    cfg.graphFiles = arr.map((p) => resolve(dir, String(p)));
  }
  const corpus = src.corpus || {};
  if (corpus.tier !== undefined) cfg.corpus = { tier: corpus.tier };
  const seed = src.seed || {};
  const seedCfg = {};
  if (seed.enabled !== undefined) seedCfg.enabled = seed.enabled;
  if (seed.limit !== undefined) seedCfg.limit = seed.limit;
  if (Object.keys(seedCfg).length) cfg.seed = seedCfg;

  // Extension-pack seam (src/extensions.mjs): sparse PASS-THROUGH only — the
  // raw `[extensions]`/`[bias]` tables ride through unmodified so a caller can
  // see they're present; validation happens one layer up, in
  // resolveExtensions() (never here — this module stays a plain raw reader).
  if (src.extensions !== undefined) cfg.extensions = src.extensions;
  if (src.bias !== undefined) cfg.bias = src.bias;

  const idx = src.index || {};
  const index = {};
  if (idx.languages !== undefined) index.languages = idx.languages;
  if (idx.exclude !== undefined) index.exclude = idx.exclude;
  if (idx.secret_exclude !== undefined) index.secretExclude = idx.secret_exclude;
  if (idx.history_depth !== undefined) index.historyDepth = idx.history_depth;
  if (idx.include_text !== undefined) index.includeText = idx.include_text;
  if (idx.include_structure !== undefined) index.includeStructure = idx.include_structure;
  if (idx.respect_gitignore !== undefined) index.respectGitignore = idx.respect_gitignore;
  if (idx.markdown_sections !== undefined) index.markdownSections = idx.markdown_sections;
  if (idx.vue !== undefined) index.vue = idx.vue;
  if (Object.keys(index).length) cfg.index = index;

  const t = src.tune || {};
  const tune = {};
  if (t.score_gap_k !== undefined) tune.scoreGapK = t.score_gap_k;
  if (t.literal_mention !== undefined) tune.literalMention = t.literal_mention;
  if (t.demote_non_prod !== undefined) tune.demoteNonProd = t.demote_non_prod;
  if (t.call_adjacency !== undefined) tune.callAdjacency = t.call_adjacency;
  if (t.impl_of_interface !== undefined) tune.implOfInterface = t.impl_of_interface;
  if (t.beam_search !== undefined) tune.beamSearch = t.beam_search;
  if (t.beam_width !== undefined) tune.beamWidth = t.beam_width;
  if (t.embed_rank !== undefined) tune.embedRank = t.embed_rank;
  if (t.prose_layers !== undefined) tune.proseLayers = t.prose_layers;
  const exp = t.expansion || {};
  const expansion = {};
  if (exp.strategy !== undefined) expansion.strategy = exp.strategy;
  if (exp.nodes !== undefined) expansion.nodes = exp.nodes;
  if (exp.q !== undefined) expansion.q = exp.q;
  if (exp.depth !== undefined) expansion.depth = exp.depth;
  if (Object.keys(expansion).length) tune.expansion = expansion;
  if (Object.keys(tune).length) cfg.tune = tune;

  const tel = src.telemetry || {};
  if (tel.enabled !== undefined) cfg.telemetry = { enabled: tel.enabled };

  // [memory] retention_versions — read by memory/core.mjs's snapshotMemory as
  // the manifest-bootstrap default (only when no manifest.json exists yet; a
  // persisted manifest's own retentionVersions wins after that). Sparse like
  // every other table here: absent when unset, so "unset" stays distinguishable
  // from "set to the default" — the shipped default (5, memory/core.mjs's
  // DEFAULT_RETENTION) is applied where the value is actually CONSUMED
  // (snapshotMemory), not injected here.
  //
  // [memory] backend — the storage-backend seam (createSession's
  // `memoryBackend` option / TMCT_MEMORY_BACKEND env): "default" (the flat
  // OWL-labelled JSON file under .tmct/memory/), "memory" (in-process only,
  // nothing on disk), or "sqlite" (a local SQLite file). Written by `tmct init
  // --memory-backend <...>`; read by chat.mjs's createSession at CLI-flag > env >
  // tmct.toml > default precedence, same order as everything else in this file.
  const mem = src.memory || {};
  const memory = {};
  if (mem.retention_versions !== undefined) memory.retentionVersions = mem.retention_versions;
  if (mem.backend !== undefined) memory.backend = mem.backend;
  if (Object.keys(memory).length) cfg.memory = memory;

  const unwired = [];
  for (const [a, b] of UNWIRED_KEYS) {
    if (src[a] && src[a][b] !== undefined) unwired.push(`${a}.${b}`);
  }
  cfg.unwired = unwired;

  return cfg;
}

/** Flatten a nested object into a dotted-key map. Arrays and scalars are leaves
 *  (never recursed into); `undefined`/`null` values are dropped so that "present
 *  but false" survives while "absent" does not. */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v) || typeof v !== "object") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

/** Merge config sources by per-key precedence: explicit `args` > `toml` >
 *  `defaults`. Returns `{effective, sources}`, both keyed by the same sorted set
 *  of dotted keys (deterministic output). `sources[key]` is one of
 *  "arg" | "tmct.toml" | "default".
 *
 *  Tri-state note: presence is tested with `in`, not truthiness, so a `toml`
 *  value of `false` (e.g. `literal_mention = false` disabling the shipped-ON
 *  default) is honoured, while an explicit arg still wins over it. */
export function mergeEffective({ args = {}, toml = null, defaults = {} } = {}) {
  const dFlat = flatten(defaults);
  // `unwired` is metadata, not a knob — keep it out of the effective config.
  let tomlKnobs = null;
  if (toml) {
    const { unwired, ...rest } = toml;
    tomlKnobs = rest;
  }
  const tFlat = tomlKnobs ? flatten(tomlKnobs) : {};
  const aFlat = flatten(args);

  const keys = [...new Set([...Object.keys(dFlat), ...Object.keys(tFlat), ...Object.keys(aFlat)])].sort();
  const effective = {};
  const sources = {};
  for (const k of keys) {
    if (k in aFlat) {
      effective[k] = aFlat[k];
      sources[k] = "arg";
    } else if (k in tFlat) {
      effective[k] = tFlat[k];
      sources[k] = "tmct.toml";
    } else {
      effective[k] = dFlat[k];
      sources[k] = "default";
    }
  }
  return { effective, sources };
}
