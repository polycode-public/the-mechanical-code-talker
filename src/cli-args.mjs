// cli-args.mjs — the ONE shared argv/config resolver for bin/tmct.mjs's
// subcommands. Replaces four independently hand-rolled `configFor` copies
// (bin/tmct.mjs's cli-mode and serve-mode ones, chat.mjs's own, and the richer
// 4-tier version inlined in chat.mjs's createSession) with a single, tested
// precedence chain — built on top of toml-config.mjs's already-tested
// mergeEffective/normalizeConfig (arg > toml > default), not a rebuild of it.
//
// Four tiny flag helpers (pure, no I/O) plus the one async resolver:
//   strFlag(rest, names, dflt)   → single value, last flag occurrence wins
//   repeatedFlag(rest, names)    → every value for a repeatable flag (e.g. --graph)
//   boolFlag(rest, names)        → true if any of `names` appears at all
//   enumFlag(rest, names, choices) → strFlag, validated against a closed set
//     (throws a clear error naming the flag + the choices — the shared shape
//     for a closed-choice option like `--memory-backend default|memory|sqlite`,
//     matching `--with-persona`'s own "unknown name" error style)
//   resolveRuntimeConfig({argv, cwd, env, gitRoot}) → the resolved repo/config
//
// Graph-path precedence (documented once, here — every subcommand shares it):
//   1. --graph <path>   (repeatable; --graph wins outright, even over env)
//   2. TMCT_GRAPH_FILE  (env)
//   3. tmct.toml's `graph_file` / `graph_files`
//   4. <repo>/.tmct/graph.json, where repo is --repo, else git root, else cwd
//
// Deliberately does NOT import chat.mjs (that would be circular once chat.mjs
// itself is rewired to call resolveRuntimeConfig) — the git-root lookup below
// is a small, self-contained copy of chat.mjs's own gitToplevel().

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadTomlConfig, normalizeConfig, mergeEffective, CONFIG_FILE } from "./toml-config.mjs";
import { DEFAULT_GRAPH_REL } from "./config.mjs";

/** The git top-level for `cwd`, or null if not in a repo (or git is
 *  unavailable). A deliberate re-declaration of chat.mjs's gitToplevel (not an
 *  import) — see the file docblock for why. */
function defaultGitRoot(cwd) {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
    if (r.status === 0) { const p = String(r.stdout || "").trim(); return p || null; }
  } catch { /* git missing / not a repo — fall back to cwd */ }
  return null;
}

const asList = (names) => (Array.isArray(names) ? names : [names]);

/** Single-value flag, LAST occurrence wins (so `--repo a --repo b` → "b").
 *  `names` may be a single flag string or an array of aliases. */
export function strFlag(rest, names, dflt) {
  const list = asList(names);
  let val = dflt;
  for (let i = 0; i < rest.length; i++) {
    if (list.includes(rest[i]) && rest[i + 1] !== undefined) val = rest[i + 1];
  }
  return val;
}

/** Repeatable flag — every value across every occurrence, in argv order
 *  (`--graph a --graph b` → `["a","b"]`). Empty array when absent. */
export function repeatedFlag(rest, names) {
  const list = asList(names);
  const out = [];
  for (let i = 0; i < rest.length; i++) {
    if (list.includes(rest[i]) && rest[i + 1] !== undefined) out.push(rest[i + 1]);
  }
  return out;
}

/** Presence flag — true if any of `names` appears anywhere in `rest`. */
export function boolFlag(rest, names) {
  const list = asList(names);
  return rest.some((r) => list.includes(r));
}

/** Closed-choice single-value flag: `strFlag` plus validation against
 *  `choices`. Returns `undefined` when absent (never a default — the caller
 *  decides what "absent" means, same as an omitted `strFlag` call). Throws a
 *  clear, user-facing error naming the flag and the valid choices when a
 *  value IS given but isn't one of them — validate-before-any-disk-write,
 *  the same discipline `tmct init --with-persona <unknown>` already uses. */
export function enumFlag(rest, names, choices) {
  const val = strFlag(rest, names, undefined);
  if (val !== undefined && !choices.includes(val)) {
    const flagName = asList(names)[0];
    throw new Error(`invalid ${flagName} "${val}". Choices: ${choices.join(", ")}.`);
  }
  return val;
}

/**
 * Resolve one subcommand invocation's repo root, tmct.toml, and graph
 * path(s) — the shared precedence chain every subcommand (chat/memory/init/
 * import/syllogise/serve) now funnels through instead of re-deriving it.
 *
 * @param {object} opts
 * @param {string[]} [opts.argv]   the subcommand's own argv tail (already past
 *   `tmct <mode>` — the same slice each subcommand hand-parses today).
 * @param {string}   [opts.cwd]
 * @param {object}   [opts.env]
 * @param {(cwd:string)=>string|null} [opts.gitRoot]  injectable for tests,
 *   mirrors createSession's own `gitRoot` param.
 * @param {object}   [opts.args]  extra already-parsed args to fold into
 *   mergeEffective's "arg" tier (e.g. a subcommand's own flags) — optional,
 *   defaults to {}.
 * @returns {Promise<{
 *   repo: string, configPath: string, toml: object,
 *   config: {graphFile: string, graphFiles: string[]},
 *   effective: object, sources: object,
 * }>}
 */
export async function resolveRuntimeConfig({
  argv = [],
  cwd = process.cwd(),
  env = process.env,
  gitRoot = defaultGitRoot,
  args = {},
} = {}) {
  const configFlag = strFlag(argv, ["--config"]);
  const repoFlag = strFlag(argv, ["--repo"]);
  const graphFlags = repeatedFlag(argv, ["--graph"]);

  const root = typeof gitRoot === "function" ? gitRoot(cwd) : null;
  const repo = repoFlag ? resolve(cwd, repoFlag) : (root || cwd);

  // --config <path>: a file OR a directory. A directory means "look for
  // tmct.toml under here"; a file is the tmct.toml itself, wherever it lives.
  let configDir = repo;
  let configFileOverride;
  if (configFlag) {
    const abs = resolve(cwd, configFlag);
    let isDir = false;
    try { isDir = (await stat(abs)).isDirectory(); } catch { /* missing path — treat as a file target */ }
    if (isDir) configDir = abs;
    else { configFileOverride = abs; configDir = dirname(abs); }
  }

  const raw = await loadTomlConfig(configDir, configFileOverride ? { file: configFileOverride } : {});
  const toml = await normalizeConfig(raw, { configDir });

  const defaultGraphFile = join(repo, DEFAULT_GRAPH_REL);
  const envGraph = env && env.TMCT_GRAPH_FILE && String(env.TMCT_GRAPH_FILE).trim();

  let graphFiles;
  let graphSource; // "arg" | "env" | "tmct.toml" | "default"
  if (graphFlags.length) {
    graphFiles = graphFlags.map((g) => resolve(cwd, g));
    graphSource = "arg";
  } else if (envGraph) {
    graphFiles = [resolve(cwd, envGraph)];
    graphSource = "env";
  } else if (toml.graphFiles && toml.graphFiles.length) {
    graphFiles = toml.graphFiles;
    graphSource = "tmct.toml";
  } else if (toml.graphFile) {
    graphFiles = [toml.graphFile];
    graphSource = "tmct.toml";
  } else {
    graphFiles = [defaultGraphFile];
    graphSource = "default";
  }

  // mergeEffective wires in toml-config.mjs's already-tested arg>toml>default
  // precedence for every OTHER knob (index/tune/corpus/…); graphFile's own
  // precedence is richer (it has an env tier mergeEffective doesn't model), so
  // it's resolved above and folded back in below rather than re-derived here.
  const defaults = { graphFile: defaultGraphFile };
  const { effective, sources } = mergeEffective({ args, toml, defaults });
  effective.graphFile = graphFiles[0];
  sources.graphFile = graphSource;
  if (graphFiles.length > 1) effective.graphFiles = graphFiles;

  const configPath = configFileOverride || join(configDir, CONFIG_FILE);

  return {
    repo,
    configPath,
    toml,
    config: { graphFile: graphFiles[0], graphFiles },
    effective,
    sources,
  };
}
