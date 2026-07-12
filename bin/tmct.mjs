#!/usr/bin/env node
// tmct — The Mechanical Code Talker. The headline entry is CHAT: a bare
// invocation drops you into a tolerant, offline, $0 prompt that guides you
// toward precision queries about a repository (ELIZA/PARRY-style, but obsessed
// with software). No model calls; tmct keeps no codebase index of its own.
//
//   tmct                                   → interactive chat (the headline)
//   tmct chat [--repo <abs>] [--plain]     → same, explicit
//   tmct cli <tool> '{…json}'              → invoke a graph tool directly (de-emphasized carry-over)
//   tmct cli digest '{…json}'              → architecture map + per-module context bundles
//   tmct --help                            → this help
//
// On a real terminal, chat is the full-screen Ink TUI (src/tui/app.mjs);
// `--plain` — or a non-TTY stdin/stdout (pipes, scripts, the test suite) —
// gets the classic readline shell. BOTH run the same session sink
// (src/chat.mjs createSession), so logs, sidecars and graph memory are
// identical either way.
//
// The `cli` arms (digest / tmct_locate / any-tool fallback) are the carried,
// de-emphasized non-chat modes, folded in here from the former bin/cli.mjs.
// The graph artifact lives at <repo_path>/.tmct/graph.json; the tools (run
// with cwd = that repo) load it by default. No flags, no config files.
//
// tmct began as a whole-package lift of an earlier chat surface (see README
// provenance): internal module filenames and symbols were kept to preserve the
// shape and the green test suite. See README.md for what tmct is and
// deliberately is NOT, and ROADMAP.md for where it is going.

const HELP = `tmct — The Mechanical Code Talker

A tolerant, offline, $0 chat that guides you toward precision queries about a
software repository. No model calls; no codebase index of its own.

Usage:
  tmct                         interactive chat (the headline surface)
  tmct chat [--repo <abs>]     chat over a specific repo's graph
       [--graph <path>]        explicit graph file (repeatable — multiple graphs merge;
                               see src/graph-merge.mjs); wins over --repo/TMCT_GRAPH_FILE/tmct.toml
       [--config <path>]       an alternate tmct.toml location (a file or a directory)
       [--ephemeral]           read the graph but write nothing back (demo/read-only)
       [--narrate]             start with narrate mode on — a verbose, developer-facing
                               trace of decision points/matched pattern/results/goal per
                               turn, appended under a "--- narrate ---" marker (also
                               TMCT_NARRATE=1; toggle mid-session with /narrate on|off)
       [--plain]               force the plain readline shell (the default when
                               stdin/stdout is not a terminal)
       [--memory-backend <default|memory|sqlite>]  storage backend for taught facts this
                               session (CLI flag > TMCT_MEMORY_BACKEND env > tmct.toml's
                               [memory] backend > "default", the flat .tmct/ JSON file)
  tmct memory [--repo <abs>]   what tmct remembers: facts, utterances, sessions,
       [--config <path>]       folded blocks (the /memory chat command, from the shell)
       [--verbose]
  tmct init [--repo <abs>]     initialize a repo for tmct (default: cwd): .tmct/,
       [--force]               tmct.toml, tier-1 corpus seed, provenance record
       [--corpus <id|path>]    also seed a corpus — a tier-2 manifest id (aws|python|java|
                               general) or a jsonl file path — opt-in, offline, $0
       [--ontology <name|path>]  activate+seed an ontology bundle (a recognized name or a path)
       [--lexicon <name|path>]   activate a lexicon bundle (recognized name or a path;
                               merged read-time, never seeded — see mergedLexiconExtra)
       [--graph <path>]        set graph_file/graph_files in tmct.toml (repeatable)
       [--config <path>]       write to an alternate tmct.toml location
       [--detect]              suggest a tier-2 corpus from the repo's manifests
                               (pyproject.toml → python, pom.xml → java); never seeds unasked
       [--with-persona <name>] write an explicit [extensions]/[bias] preset into tmct.toml
                               ("code" — today's implicit default, made explicit)
       [--persona-size <medium|large>]  grow the default "human" persona's fact count
                               beyond Small (the default): "medium" activates
                               human-medium.jsonl (~1,608 facts total), "large" also
                               activates human-large.jsonl (~13,600 facts total,
                               with genuine multi-hop hypernym chains) — additive
                               size tiers of the SAME bundle, not separate personas
       [--memory-backend <default|memory|sqlite>]  write tmct.toml's [memory] backend
                               (same flag name as \`tmct chat\`) — a later \`tmct chat\`
                               in this repo picks it up with no flag needed
  tmct import [--repo <abs>]   activate+seed into an ALREADY-initialized repo (any
       [--corpus <id|path>]    combination of these flags in one call). --graph is a
       [--ontology <name|path>]  DIFFERENT operation from the others: it APPENDS to
       [--lexicon <name|path>]   tmct.toml's graph_files array (multi-graph growth),
       [--graph <path>]        never an extensions-bundle activation.
       [--memory-backend <default|memory|sqlite>]  same knob as \`tmct init\`
       [--config <path>]
  tmct extend --validate <dir>  validate a third-party extension pack's declared
       [--config <path>]      resources (corpus/lexicon/templates) before activating
                               it in any repo's tmct.toml; exits non-zero on failure
  tmct syllogise [--repo <abs>] speculative inference (offline maintenance job): forward-
       [--depth <n>] [--budget <n>]  chain the memory's rdfs:subClassOf closure, materialising
       [--config <path>]      bounded, low-trust, retractable entailed facts (never on the chat path)
  tmct viz [--repo <abs>]      write one self-contained, navigable HTML file rendering the
       [--focus <id>]         memory graph: pan/zoom, click a node for its label/class/
       [--depth <n>]          timestamps. Seeds from the most recently created individual
       [--limit <n>]          by default; --output defaults to graph.html in the cwd.
       [--output <path>]      --depth = max arcs (hops) from the focus node (default 3);
       [--config <path>]      --limit = spiral length, total nodes walked (default 12).
  tmct serve [--repo <abs>]    run the Anthropic Messages API-compatible endpoint
       [--host <h>] [--port <n>]  (POST /v1/messages) over the graph — a deterministic,
       [--graph <path>]        no-LLM "model" a tool-loop client can call; $0 usage.
       [--config <path>]       Defaults: host 127.0.0.1, port 8787. Ctrl+C to stop.
  tmct cli <tool> '{…}'        invoke a graph tool directly (carry-over, de-emphasized)
  tmct cli digest '{…}'        architecture map + per-module context bundles
  tmct --help                  show this help

On a terminal, chat opens the full-screen TUI; piped input gets the plain shell.
In chat: /help lists slash-commands; /exit leaves. Session log → <repo>/.tmct/session-<id>.log.

Shared graph-path precedence (chat/serve; see src/cli-args.mjs): --graph flag(s) >
TMCT_GRAPH_FILE env > tmct.toml graph_file/graph_files > --repo-derived
<repo>/.tmct/graph.json > git-root/cwd default.

Memory-backend precedence (chat; see src/chat.mjs createSession): --memory-backend
flag > TMCT_MEMORY_BACKEND env > tmct.toml [memory] backend > "default" (the flat
.tmct/ JSON file). Set it once with \`tmct init --memory-backend <...>\` and every
later \`tmct chat\` in that repo picks it up with no flag needed.
`;

const argv = process.argv.slice(2);

if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  process.stdout.write(HELP);
  process.exit(0);
}

// Headline behaviour: a bare invocation is CHAT. We rewrite argv so the mode
// dispatch below (and anything downstream reading process.argv) sees `chat`.
if (argv.length === 0) {
  process.argv.splice(2, 0, "chat");
}

/** Parse the trailing JSON payload of a `cli` sub-command (best-effort). */
function parsePayload(payload) {
  if (!payload) return {};
  try { return JSON.parse(payload); }
  catch { return null; }
}

const DIGEST_MODULE_CAP = 12;   // bound the digest — a handful of changed modules
const DIGEST_SECONDARY_CAP = 2; // B2: at most this many SECONDARY modules get a (trimmed) bundle
const TIER_RANK = { NONE: 0, TINY: 1, MID: 2, LARGE: 3, FULL: 4 };

/** `cli digest` — print a machine-readable header + a repo architecture map + the
 *  tmct_context edit bundle for each requested module to stdout (reuses the server's exact
 *  renderer via buildContextBundle, so no render logic is duplicated). This stdout is injected
 *   into a caller's prompt.
 *
 *  Two ways to say which modules: an explicit `modules` array (unchanged), or a `query` string —
 *  auto-locate + score-gap-select (R1b, the shipped default as of 2026-07-02) in one call, so a
 *  real caller no longer has to run `tmct_locate` and hand-pick a module themselves. `modules`
 *  wins if both are given. The header reports which modules were actually selected either way.
 *
 *  B2: the FIRST (primary) module gets a full size-adaptive bundle; the remaining modules are
 *  RANKED by import/cochange proximity to the primary and only the top few get a TRIMMED
 *  (signatures + insertion region) bundle — so a 2-module task no longer pays for two full
 *  bundles. The leading header line lets the rig record tier/topup telemetry. */
async function runDigest(args, { dispatchTool, buildContextBundle, source, configFor, codegraph }) {
  const { parseEntities, rankModulesByProximity, searchModulesRanked, selectRankedModules, DEFAULT_SCORE_GAP } = codegraph;
  const repoPath = args.repo_path;
  if (!repoPath) { process.stderr.write("tmct: digest requires repo_path\n"); process.exit(2); }
  let modules = Array.isArray(args.modules) ? args.modules.slice(0, DIGEST_MODULE_CAP) : [];
  let autoSelected = null; // for the header, when `query` drove selection
  if (!modules.length && args.query) {
    const graph = parseEntities(await source.fetchEntities(configFor(repoPath)));
    // SHIPPED DEFAULT (0.5.0): the digest's query-mode auto-locate resolves literal-mention ON
    // (a fresh invocation with no tmct.toml), disable-able via `literal_mention:false`. Kept in
    // lockstep with the `tmct_locate` handler so `cli digest '{query}'` ≡ `cli tmct_locate` for the
    // same query. A strict no-op unless the query carries a ≥3-component dotted path / repo-relative
    // path; searchModulesRanked derives rawQuery from the query when literalMention is on.
    const ranked = searchModulesRanked(graph, args.query, { literalMention: args.literal_mention !== false });
    const scoreGapK = args.score_gap === false ? null : (Number.isFinite(args.score_gap) ? args.score_gap : DEFAULT_SCORE_GAP);
    modules = selectRankedModules(ranked, { top_k: Number.isFinite(args.top_k) ? args.top_k : 2, scoreGapK }).slice(0, DIGEST_MODULE_CAP);
    autoSelected = modules;
    if (!modules.length) process.stderr.write(`tmct: digest query "${args.query}" matched no modules — empty digest\n`);
  }
  // Tuning-flag contract (threaded to buildContextBundle → sizeBundle): `min` → leanest TINY/no
  // top-up; `untuned` → the earlier escalation. Neither → the tuned default. The digest header still
  // reports the EFFECTIVE tier/topup returned per module, so rig telemetry stays correct.
  const min = Boolean(args.min);
  const untuned = Boolean(args.untuned);
  // tmct-max: the injection CEILING — every requested module gets a FULL (untrimmed) bundle,
  // not just the primary + 2 trimmed secondaries. Tests whether maximal injection re-bloats.
  const max = Boolean(args.max);
  const secondaryCap = max ? modules.length : DIGEST_SECONDARY_CAP;
  const config = configFor(repoPath);
  const body = [];
  let effTier = "NONE"; // largest tier emitted across all modules
  let topup = false;    // whether any module's auto-sizing escalated above TINY
  let emitted = 0;      // module bundles actually emitted (primary + trimmed secondaries)

  try {
    body.push("# Repository architecture\n" + (await dispatchTool("tmct_architecture", {}, { config })));
  } catch (e) {
    body.push(`# Repository architecture\n(unavailable: ${e?.message || e})`);
  }

  const emit = async (m, trim) => {
    try {
      const { text, tier, topup: t } = await buildContextBundle({ symbol: m, min, untuned, max }, { config, source, trim });
      body.push(`\n# Context bundle: ${m}${trim ? " (secondary, trimmed)" : ""}\n` + text);
      if ((TIER_RANK[tier] || 0) > (TIER_RANK[effTier] || 0)) effTier = tier;
      if (t) topup = true;
      emitted += 1;
    } catch (e) {
      body.push(`\n# Context bundle: ${m}\n(no bundle: ${e?.message || e})`);
    }
  };

  if (modules.length) {
    const [primary, ...rest] = modules;
    // rank the secondaries by proximity to the primary (best-effort: keep input order on error)
    let ranked = rest;
    if (rest.length) {
      try { ranked = rankModulesByProximity(parseEntities(await source.fetchEntities(config)), primary, rest); }
      catch { ranked = rest; }
    }
    const secondaries = ranked.slice(0, secondaryCap);
    const overflow = ranked.slice(secondaryCap);
    await emit(primary, false);
    for (const m of secondaries) await emit(m, max ? false : true);
    if (overflow.length) body.push(`\n# Related modules (not expanded; query tmct_context if needed): ${overflow.join(", ")}`);
  }

  // HARD CONTRACT: first line is the machine-readable digest header the rig greps. Fields are
  // append-only — `selected=` is new (query mode only) and never changes the existing ones the
  // rig's own parser depends on.
  const header = `# tmct-digest tier=${effTier} topup=${topup} modules=${emitted}`
    + (autoSelected ? ` selected=${autoSelected.join(",") || "(none)"}` : "");
  process.stdout.write([header, ...body].join("\n") + "\n");
}

/** The carried `cli` dispatcher (digest / tmct_locate / any-tool fallback).
 *  Imports are lazy so `tmct --help` and chat startup never pay for the tool
 *  stack. */
async function runCliMode() {
  const [, sub, payload] = process.argv.slice(2);
  const { join } = await import("node:path");
  const { dispatchTool, buildContextBundle } = await import("../src/server.mjs");
  const { loadConfig, DEFAULT_GRAPH_REL } = await import("../src/config.mjs");
  const source = await import("../src/source.mjs");
  const codegraph = await import("../src/codegraph.mjs");
  const { parseEntities, searchModulesRanked } = codegraph;

  /** Build a config pointed at a specific repo's artifact (for `cli` sub-commands that
   *  take a repo_path), or fall back to the cwd-derived default. */
  const configFor = (repoPath) =>
    repoPath ? { graphFile: join(repoPath, DEFAULT_GRAPH_REL) } : loadConfig();

  // digest mode: architecture map + per-module context bundles → stdout
  if (sub === "digest") {
    const args = parsePayload(payload);
    if (args === null) {
      process.stderr.write("tmct: digest expects a JSON arg, e.g. '{\"repo_path\":\"/abs\",\"modules\":[…]}'\n");
      process.exit(2);
    }
    await runDigest(args, { dispatchTool, buildContextBundle, source, configFor, codegraph });
    return;
  }

  // locate mode (TUNING #3): `cli tmct_locate '{"query":"…","repo_path":"<abs>"}'` emits the
  // ranked modules as `<relpath>\t<score>`, one per line (highest first), using renderSearch's
  // exact ranking. The rig keeps rank-1 always and rank-2 only when score2/score1 is close — it
  // needs the raw scores, which the text renderer hides. Independent of the tuning flags.
  if (sub === "tmct_locate") {
    const args = parsePayload(payload);
    if (args === null) {
      process.stderr.write("tmct: tmct_locate expects a JSON arg, e.g. '{\"query\":\"…\",\"repo_path\":\"/abs\"}'\n");
      process.exit(2);
    }
    const config = configFor(args.repo_path);
    try {
      const graph = parseEntities(await source.fetchEntities(config));
      // B016 recall-lever flags (LOCATE-phase, per-arm; output byte-identical when absent).
      const ranked = searchModulesRanked(graph, args.query || "", {
        demoteNonProd: !!args.demote_nonprod, // R1a: demote examples//fixtures//test-* paths
        callAdjacency: !!args.call_adjacency, // E1a: resolved-call adjacency bonus
        implOfInterface: !!args.impl_of_interface, // E1b: C# impl-of-interface boost
        beamSearch: !!args.beam_search, // §5.15: multi-ply discriminative expansion
        ...(Number.isFinite(Number(args.beam_width)) ? { beamWidth: Number(args.beam_width) } : {}),
        // B018 §8.1.3 literal-mention lever: match verbatim dotted-name/path mentions in the RAW
        // query (which the locate tokenizer destroys). searchModulesRanked derives rawQuery from the
        // query arg when literalMention is on; the rig passes the raw problem as the query, so literal
        // matching keys off the untokenized text. raw_query is forwarded too for callers that normalize
        // the query arg separately from the raw problem text.
        // SHIPPED DEFAULT (0.5.0): literal-mention is ON for a fresh invocation (no arg, no
        // tmct.toml) — pass `literal_mention:false` to disable. It is a strict no-op on queries
        // with no ≥3-component dotted path / repo-relative path, so it never perturbs the cells the
        // headline B018 numbers were measured on. The low-level scoreModules default (codegraph.mjs)
        // stays literalMention=false; the product surface opts in explicitly, right here.
        literalMention: args.literal_mention !== false,
        ...(args.raw_query != null ? { rawQuery: String(args.raw_query) } : {}),
      });
      process.stdout.write(ranked.map((r) => `${r.path}\t${r.score}`).join("\n") + "\n");
    } catch (e) {
      process.stderr.write(`tmct: ${e?.message || e}\n`);
      process.exit(1);
    }
    return;
  }

  // tool-query fallback: any other `cli <toolName> '{…}'` routes to dispatchTool,
  // so "cold" tools are invokable from Bash directly.
  if (sub) {
    const args = parsePayload(payload);
    if (args === null) {
      process.stderr.write(`tmct: ${sub} expects a JSON arg, e.g. '{"symbol":"<name>"}'\n`);
      process.exit(2);
    }
    const config = configFor(args.repo_path);
    try {
      const text = await dispatchTool(sub, args, { config });
      process.stdout.write(text + "\n");
    } catch (e) {
      process.stderr.write(`tmct: ${e?.message || e}\n`);
      process.exit(1);
    }
    return;
  }

  process.stderr.write("tmct: `cli` needs a sub-command (digest | <toolName>)\n");
  process.exit(2);
}

// ---- shared `init`/`import` pluggable-input helpers ---------------------------
//
// Both `tmct init --corpus/--ontology/--lexicon` and the new `tmct import` verb
// funnel through the SAME two-step seam: resolvePluggableInput (name/id/path →
// a resolved descriptor) then activatePluggableInput (write tmct.toml + seed via
// src/extensions.mjs's unified loop) — one seam instead of three near-duplicate
// hand-rolled call sites.

/** Read `repoRoot`'s current tmct.toml (if any) into the shape init.mjs's
 *  renderTomlConfig/defaultConfig expect, so a caller can add ONE key and
 *  write it straight back without losing every other already-written key.
 *  Mirrors `tmct init --corpus`'s original inline config-merge exactly. */
async function readConfigForRewrite(repoRoot) {
  const { defaultConfig } = await import("../src/init.mjs");
  const { loadTomlConfig } = await import("../src/toml-config.mjs");
  const raw = await loadTomlConfig(repoRoot);
  const cfg = { ...defaultConfig() };
  if (raw?.graph_file !== undefined) cfg.graphFile = String(raw.graph_file);
  if (Array.isArray(raw?.graph_files)) cfg.graphFiles = raw.graph_files.slice();
  if (raw?.corpus?.tier !== undefined) cfg.corpus = { tier: raw.corpus.tier };
  if (raw?.seed) {
    cfg.seed = { ...cfg.seed };
    if (raw.seed.enabled !== undefined) cfg.seed.enabled = Boolean(raw.seed.enabled);
    if (raw.seed.limit !== undefined) cfg.seed.limit = Number(raw.seed.limit);
  }
  if (raw?.extensions !== undefined) cfg.extensions = raw.extensions;
  if (raw?.bias !== undefined) cfg.bias = raw.bias;
  if (raw?.memory?.backend !== undefined) cfg.memory = { ...cfg.memory, backend: raw.memory.backend };
  return { raw, cfg };
}

async function writeConfig(repoRoot, cfg) {
  const { renderTomlConfig, CONFIG_FILE } = await import("../src/init.mjs");
  const { writeFile } = await import("node:fs/promises");
  const { join: joinPath } = await import("node:path");
  await writeFile(joinPath(repoRoot, CONFIG_FILE), renderTomlConfig(cfg));
}

/** realpathSync `absPath`, tolerating that it (or some trailing segment of
 *  it) may not exist yet: walks up to the longest EXISTING ancestor,
 *  realpath's THAT, then rejoins the non-existent remainder untouched.
 *  Equivalent to `fs.realpathSync(absPath)` when `absPath` already exists.
 *  Needed because `--graph <path>` etc. deliberately name not-yet-written
 *  files (a fresh graph a future indexer will create) — so we can't just
 *  realpathSync() the candidate path outright. */
function realpathTolerant(absPath, { realpathSync, dirname, basename, join: joinPath }) {
  let dir = absPath;
  const remainder = [];
  while (true) {
    try {
      const real = realpathSync(dir);
      return remainder.length ? joinPath(real, ...remainder) : real;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return absPath; // hit the filesystem root; nothing on this path exists — give up as-is
      remainder.unshift(basename(dir));
      dir = parent;
    }
  }
}

/** Render `p` (resolved against `repoRoot` if not already absolute) as a
 *  path relative to `repoRoot` for tmct.toml — whose own header documents
 *  paths as "relative to this file" — falling back to the absolute form
 *  when `p` lands outside `repoRoot`. Both sides are realpath'd (tolerantly
 *  — `p` need not exist yet) before computing relative(), so the
 *  inside/outside-repoRoot decision doesn't depend on whether the OS
 *  happens to route a path through a symlink: macOS's os.tmpdir() resolves
 *  under /var/folders/..., and /var is itself a symlink to /private/var, so
 *  a spawned child's process.cwd() (kernel-realpath'd) and a test's raw
 *  mkdtemp() string (unresolved) can name the same real directory while
 *  disagreeing textually — Linux's /tmp has no such symlink, which is why
 *  this only showed up on CI. Comparing realpath'd forms on both sides
 *  makes the decision symlink-invariant on every platform. */
async function repoRelative(repoRoot, p) {
  const { resolve: resolvePath, relative, dirname, basename, join: joinPath, isAbsolute } = await import("node:path");
  const { realpathSync } = await import("node:fs");
  const abs = isAbsolute(p) ? p : resolvePath(repoRoot, p);
  const helpers = { realpathSync, dirname, basename, join: joinPath };
  const repoReal = realpathTolerant(repoRoot, helpers);
  const absReal = realpathTolerant(abs, helpers);
  const rel = relative(repoReal, absReal);
  return rel && !rel.startsWith("..") ? rel : abs;
}

/** Resolve a `--corpus`/`--ontology`/`--lexicon` value to something
 *  activatePluggableInput can act on: either a RECOGNIZED name (a
 *  BUILTIN_EXTENSIONS entry of the matching kind; for `--corpus` specifically,
 *  also a tier-2 manifest id like "aws" — today's `--corpus <id>` contract,
 *  preserved byte-for-byte) or a filesystem PATH, to be declared as a brand
 *  new `[extensions.<slug>]` entry. Throws the same clear "unknown --corpus"
 *  error the original tier-2-only implementation gave (naming the available
 *  ids), generalized to name a checked file path too. Validates before any
 *  disk write — callers resolve every pluggable input BEFORE calling
 *  initRepo, so a bad name/path touches nothing. */
async function resolvePluggableInput(kind, nameOrPath, { repoRoot }) {
  const { BUILTIN_EXTENSIONS } = await import("../src/extensions.mjs");
  if (Object.prototype.hasOwnProperty.call(BUILTIN_EXTENSIONS, nameOrPath) && BUILTIN_EXTENSIONS[nameOrPath].kind === kind) {
    return { known: true, name: nameOrPath };
  }
  let manifestIds = null;
  if (kind === "corpus") {
    const { readFile } = await import("node:fs/promises");
    const { TIER2_MANIFEST_FILE } = await import("../src/corpus/conceptnet.mjs");
    try {
      const manifest = JSON.parse(await readFile(TIER2_MANIFEST_FILE, "utf8"));
      const corpuses = manifest.corpuses || [];
      manifestIds = corpuses.map((c) => c.id);
      const manifestEntry = corpuses.find((c) => c.id === nameOrPath);
      if (manifestEntry) return { known: true, name: `tier2-${manifestEntry.id}`, manifestEntry };
    } catch { /* manifest unreadable — fall through to path resolution */ }
  }
  const { access } = await import("node:fs/promises");
  const { resolve: resolvePath, basename, isAbsolute } = await import("node:path");
  const abs = isAbsolute(nameOrPath) ? nameOrPath : resolvePath(repoRoot, nameOrPath);
  try {
    await access(abs);
  } catch {
    if (manifestIds) {
      throw new Error(`unknown --corpus "${nameOrPath}". Available tier-2 corpuses: ${manifestIds.join(", ")}.`);
    }
    throw new Error(`unknown --${kind} "${nameOrPath}" — not a recognized name, and no file found at ${abs}`);
  }
  const slug = basename(abs).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase() || kind;
  return { known: false, name: slug, kind, path: abs };
}

/** Activate one resolvePluggableInput() result in `repoRoot`'s tmct.toml and —
 *  for corpus/ontology-kind entries (or a pack-kind entry with a corpusPath) —
 *  seed it via the SAME unified loop every other bundle uses
 *  (src/extensions.mjs's seedActiveCorpusEntries). A lexicon/templates-kind
 *  entry only activates (merged read-time via mergedLexiconExtra, never
 *  seeded — matching today's behavior for those kinds). Returns a
 *  human-readable status line for stdout. */
async function activatePluggableInput(repoRoot, resolved) {
  const { raw, cfg } = await readConfigForRewrite(repoRoot);
  const name = resolved.name;
  const existingEntry = raw?.extensions?.[name] || {};
  const newEntry = { ...existingEntry, active: true };
  if (!resolved.known) {
    newEntry.kind = resolved.kind;
    const pathKey = resolved.kind === "ontology" ? "ontology_path"
      : resolved.kind === "lexicon" ? "lexicon_path"
        : resolved.kind === "templates" ? "templates_path"
          : "corpus_path";
    newEntry[pathKey] = await repoRelative(repoRoot, resolved.path);
  }
  cfg.extensions = { ...(cfg.extensions || {}), [name]: newEntry };
  await writeConfig(repoRoot, cfg);

  const { resolveExtensions, seedActiveCorpusEntries } = await import("../src/extensions.mjs");
  const { entries } = await resolveExtensions(repoRoot);
  const entry = entries.get(name);
  const seedable = entry.kind === "corpus" || entry.kind === "ontology" || (entry.kind === "pack" && entry.corpusPath);
  if (!seedable) {
    return `activated "${name}" (${entry.kind}) in tmct.toml — no corpus facts to seed for this kind.\n`;
  }
  const { perBundle } = await seedActiveCorpusEntries(repoRoot, new Map([[name, entry]]));
  const seeded = perBundle[name];
  if (seeded.error) {
    throw new Error(`could not seed "${name}" — ${seeded.error}`);
  }
  if (resolved.manifestEntry) {
    // Preserve the ORIGINAL `--corpus <tier2-id>` wording byte-for-byte
    // (test/init-cli.test.mjs asserts on this exact shape).
    return `seeded tier-2 corpus "${resolved.manifestEntry.id}" (${resolved.manifestEntry.kind}) — ${seeded.appended} fact(s) added`
      + `${seeded.skipped ? `, ${seeded.skipped} already present` : ""}. Source: corpus/tier2/${resolved.manifestEntry.file} (${resolved.manifestEntry.license}). `
      + `Activated in tmct.toml — future \`tmct init\`/chat sessions seed it automatically.\n`;
  }
  return `seeded "${name}" (${entry.kind}) — ${seeded.appended} fact(s) added`
    + `${seeded.skipped ? `, ${seeded.skipped} already present` : ""}. `
    + `Activated in tmct.toml — future \`tmct init\`/chat sessions seed it automatically.\n`;
}

/** `--graph <path>` (repeatable) APPENDS to `repoRoot`'s tmct.toml
 *  `graph_files` array — a DIFFERENT, purely additive operation from
 *  activatePluggableInput (no extensions-bundle activation). Each path is
 *  sanity-checked (readable, valid JSON, has an "individuals" array) before
 *  being recorded — `tmct import` targets an ALREADY-initialized repo, so the
 *  named graph is expected to genuinely exist. */
async function appendGraphFiles(repoRoot, graphPaths) {
  const { readFile } = await import("node:fs/promises");
  const { resolve: resolvePath } = await import("node:path");
  for (const p of graphPaths) {
    const abs = resolvePath(repoRoot, p);
    let text;
    try { text = await readFile(abs, "utf8"); }
    catch (e) { throw new Error(`--graph ${p}: cannot read ${abs} (${e?.message || e})`); }
    let payload;
    try { payload = JSON.parse(text); }
    catch (e) { throw new Error(`--graph ${p}: ${abs} is not valid JSON (${e?.message || e})`); }
    if (typeof payload !== "object" || payload === null || !Array.isArray(payload.individuals)) {
      throw new Error(`--graph ${p}: ${abs} doesn't look like a graph entities payload (missing an "individuals" array)`);
    }
  }
  const { cfg } = await readConfigForRewrite(repoRoot);
  const additions = [];
  for (const p of graphPaths) additions.push(await repoRelative(repoRoot, p));
  cfg.graphFiles = [...(cfg.graphFiles || []), ...additions];
  await writeConfig(repoRoot, cfg);
}

async function main() {
  const mode = process.argv[2];

  if (mode === "chat") {
    const rest = process.argv.slice(3);
    const i = rest.indexOf("--repo");
    const repoPath = i !== -1 ? rest[i + 1] : undefined;
    // `--ephemeral` (used by the shipped `npm run example:*` scripts): read the
    // target graph but write nothing back — no session folded into the committed
    // code graph, no .tmct/memory dropped under it. A demo you can run repeatedly
    // on a checked-in example without ever dirtying it.
    const ephemeral = rest.includes("--ephemeral");
    // `--narrate` (or TMCT_NARRATE=1, read directly by createSession from
    // process.env — no extra wiring needed for the env-var form): start the
    // session with the verbose developer/debug narrate mode already on. Default
    // OFF; `/narrate on`/`/narrate off` also toggles it mid-session.
    const narrate = rest.includes("--narrate");
    // `--graph <path>` (repeatable) / `--config <path>` (src/cli-args.mjs): threaded
    // through as the new top tier of createSession's graph-resolution order (above
    // TMCT_GRAPH_FILE — see chat.mjs's own docblock at createSession). Omitted from
    // the call entirely when absent, so a plain `tmct chat [--repo]` invocation is
    // byte-identical to before these flags existed.
    const { repeatedFlag, strFlag, enumFlag } = await import("../src/cli-args.mjs");
    const graphPaths = repeatedFlag(rest, ["--graph"]);
    const configPath = strFlag(rest, ["--config"]);
    // `--memory-backend <default|memory|sqlite>`: the CLI's top tier of
    // createSession's memoryBackend precedence (CLI flag > TMCT_MEMORY_BACKEND
    // env > tmct.toml's [memory] backend > built-in default — src/cli-args.mjs's
    // shared precedence order, resolved inside createSession itself). Omitted
    // when absent so the lower tiers still apply unchanged.
    let memoryBackend;
    try {
      memoryBackend = enumFlag(rest, ["--memory-backend"], ["default", "memory", "sqlite"]);
    } catch (e) {
      process.stderr.write(`tmct: ${e?.message || e}\n`);
      process.exit(2);
    }
    const extra = {};
    if (graphPaths.length) extra.graphPaths = graphPaths;
    if (configPath) extra.configPath = configPath;
    if (memoryBackend) extra.memoryBackend = memoryBackend;
    // The shell gate: a real terminal gets the full-screen Ink TUI; `--plain` or a
    // non-TTY stream (pipes, scripts, the test suite) gets the readline shell. Both
    // drive the same createSession sink — only the drawing differs.
    const plain = rest.includes("--plain") || !process.stdin.isTTY || !process.stdout.isTTY;
    if (plain) {
      const { runChat } = await import("../src/chat.mjs");
      await runChat({ repoPath, ephemeral, narrate, ...extra });
    } else {
      const { runTui } = await import("../src/tui/app.mjs");
      await runTui({ repoPath, ephemeral, narrate, ...extra });
    }
    return;
  }

  if (mode === "memory") {
    // `tmct memory` — the /memory chat command from the shell: same renderer
    // (src/memory/inspect.mjs). Repo resolution now goes through the shared
    // resolveRuntimeConfig (src/cli-args.mjs) — --repo > git root > cwd, same
    // as before, plus a (currently inert but accepted) `--config` for symmetry
    // with every other subcommand. No `--graph`: memory reads no code graph.
    const rest = process.argv.slice(3);
    const verbose = rest.includes("--verbose") || rest.includes("-v");
    const { resolveRuntimeConfig } = await import("../src/cli-args.mjs");
    const { inspectMemory } = await import("../src/memory/inspect.mjs");
    const { repo } = await resolveRuntimeConfig({ argv: rest });
    process.stdout.write(await inspectMemory(repo, { verbose }) + "\n");
    return;
  }

  if (mode === "init") {
    // `tmct init` — the Repository-Interface onboarding surface: scaffold .tmct/,
    // write tmct.toml, seed the corpus (offline, opt-out via TMCT_NO_SEED), and
    // record provenance. Idempotent; --force rewrites config + re-records.
    //
    // TIERING POLICY: init is OFFLINE, $0 and TIER-1-ONLY by default (seon +
    // conceptnet — src/extensions.mjs's BUILTIN_EXTENSIONS). A tier-2 domain/
    // language corpus (corpus/tier2/: aws, python, java) is added ONLY when
    // explicitly asked via `--corpus <id>`. The `--detect` auto-detect is a
    // documented STUB: it inspects the repo's manifests (pyproject.toml → python,
    // pom.xml → java) and SUGGESTS the matching corpus, but never seeds it unasked.
    //
    // `--repo <abs>` (NEW): init used to always hardcode process.cwd() — the only
    // subcommand without a --repo flag. It now takes one like every other
    // subcommand, defaulting to cwd exactly as before when absent.
    const rest = process.argv.slice(3);
    const { strFlag, repeatedFlag, enumFlag } = await import("../src/cli-args.mjs");
    const { resolve: resolvePath } = await import("node:path");
    const { initRepo, PERSONA_PRESETS } = await import("../src/init.mjs");

    const repoFlag = strFlag(rest, ["--repo"]);
    const repoRoot = repoFlag ? resolvePath(process.cwd(), repoFlag) : process.cwd();

    const corpusVal = strFlag(rest, ["--corpus"]);
    const ontologyVal = strFlag(rest, ["--ontology"]);
    const lexiconVal = strFlag(rest, ["--lexicon"]);
    const graphFlags = repeatedFlag(rest, ["--graph"]);

    // `--memory-backend <default|memory|sqlite>` (PLAN_SEED.md §6's storage-backend
    // seam, now reachable from `tmct init`): validated BEFORE touching disk, same
    // discipline as every other pluggable input below. Written into tmct.toml's
    // `[memory] backend` (src/init.mjs's renderTomlConfig); chat.mjs's
    // createSession reads it back at CLI-flag > TMCT_MEMORY_BACKEND env >
    // tmct.toml > default precedence (src/cli-args.mjs's shared precedence order).
    let memoryBackendVal;
    try {
      memoryBackendVal = enumFlag(rest, ["--memory-backend"], ["default", "memory", "sqlite"]);
    } catch (e) {
      process.stderr.write(`tmct init: ${e?.message || e}\n`);
      process.exit(2);
    }

    // Resolve + validate EVERY pluggable input BEFORE touching disk — mirrors
    // `--with-persona`'s own "validate before scaffolding" discipline, and the
    // original `--corpus`'s "unknown id touches nothing" contract.
    let corpusResolved = null, ontologyResolved = null, lexiconResolved = null;
    try {
      if (corpusVal) corpusResolved = await resolvePluggableInput("corpus", corpusVal, { repoRoot });
      if (ontologyVal) ontologyResolved = await resolvePluggableInput("ontology", ontologyVal, { repoRoot });
      if (lexiconVal) lexiconResolved = await resolvePluggableInput("lexicon", lexiconVal, { repoRoot });
    } catch (e) {
      process.stderr.write(`tmct init: ${e?.message || e}\n`);
      process.exit(2);
    }

    // `--with-persona <name>` (Part 7): resolve + validate BEFORE touching
    // disk, mirroring `--corpus`'s own unknown-id error handling — a bad
    // persona name never scaffolds anything.
    const personaName = strFlag(rest, ["--with-persona"]);
    let personaPreset = null;
    if (personaName) {
      if (!Object.prototype.hasOwnProperty.call(PERSONA_PRESETS, personaName)) {
        const names = Object.keys(PERSONA_PRESETS).join(", ");
        process.stderr.write(`tmct init: unknown --with-persona "${personaName}". Available personas: ${names}.\n`);
        process.exit(2);
      }
      personaPreset = PERSONA_PRESETS[personaName];
    }

    // `--persona-size <medium|large>` (PLAN_SEED.md §3): Small/Medium/Large are
    // SIZES of the one `human` bundle, not separate corpus ids — human.jsonl
    // (Small, the default) stays exactly as-is; human-medium.jsonl/
    // human-large.jsonl hold ONLY the facts each size adds beyond the previous
    // one (built by scripts/build-persona-tiers.mjs). "medium" activates just
    // human-medium; "large" activates BOTH human-medium AND human-large (Large
    // is Medium's facts plus its own — both incremental bundles must be active
    // to reach the full ~13,600-fact total). Reuses the EXACT SAME
    // resolvePluggableInput/activatePluggableInput seam `--corpus <id>` already
    // uses (human-medium/human-large are ordinary `kind: "corpus"`
    // BUILTIN_EXTENSIONS entries, recognized directly, no manifest needed) —
    // this is sugar over "activate these specific corpus ids", not a new
    // activation mechanism. Works whether the repo is fresh (this same
    // `tmct init` call) or already initialized (a later re-run), exactly like
    // `--corpus` does.
    const PERSONA_SIZE_BUNDLES = { medium: ["human-medium"], large: ["human-medium", "human-large"] };
    const personaSizeVal = strFlag(rest, ["--persona-size"]);
    let personaSizeResolved = [];
    if (personaSizeVal) {
      if (!Object.prototype.hasOwnProperty.call(PERSONA_SIZE_BUNDLES, personaSizeVal)) {
        const sizes = Object.keys(PERSONA_SIZE_BUNDLES).join(", ");
        process.stderr.write(`tmct init: unknown --persona-size "${personaSizeVal}". Available sizes: ${sizes}.\n`);
        process.exit(2);
      }
      try {
        for (const id of PERSONA_SIZE_BUNDLES[personaSizeVal]) {
          personaSizeResolved.push(await resolvePluggableInput("corpus", id, { repoRoot }));
        }
      } catch (e) {
        process.stderr.write(`tmct init: ${e?.message || e}\n`);
        process.exit(2);
      }
    }

    const res = await initRepo(repoRoot, { force: rest.includes("--force"), persona: personaPreset });
    process.stdout.write(res.message + "\n");

    // `--corpus`/`--ontology`/`--lexicon` now mean "activate this bundle and
    // PERSIST that into tmct.toml" — so a second `tmct init` (or the next chat
    // bootstrap) remembers the choice, unlike the old ad hoc path, which had
    // to be repeated every time. (For a tier-2 --corpus id this changes the
    // provenance tag from the old colon-separated "corpus:tier2:<id>" to the
    // hyphenated "corpus:tier2-<id>" — a deliberate, low-risk rename predating
    // this batch; nothing in chat.mjs's runtime logic keys on the old string.)
    let anyActivation = false;
    for (const resolved of [corpusResolved, ontologyResolved, lexiconResolved, ...personaSizeResolved]) {
      if (!resolved) continue;
      anyActivation = true;
      try {
        process.stdout.write(await activatePluggableInput(repoRoot, resolved));
      } catch (e) {
        process.stderr.write(`tmct init: ${e?.message || e}\n`);
        process.exit(1);
      }
    }

    // `--graph <path>` (repeatable): SETS (not appends — that's `tmct import`'s
    // job) the fresh scaffold's graph pointer(s). No existence check: like
    // init's own default graph_file, this just names where a future indexer
    // will write, and a brand new repo's graph typically doesn't exist yet.
    if (graphFlags.length) {
      const { cfg } = await readConfigForRewrite(repoRoot);
      if (graphFlags.length === 1) {
        cfg.graphFile = await repoRelative(repoRoot, graphFlags[0]);
        delete cfg.graphFiles;
      } else {
        cfg.graphFiles = await Promise.all(graphFlags.map((p) => repoRelative(repoRoot, p)));
      }
      await writeConfig(repoRoot, cfg);
      process.stdout.write(`graph path${graphFlags.length > 1 ? "s" : ""} set in tmct.toml: ${graphFlags.join(", ")}\n`);
      anyActivation = true;
    }

    // `--memory-backend <default|memory|sqlite>`: SETS tmct.toml's `[memory]
    // backend`, same read-merge-rewrite as `--graph` above (preserves every
    // other already-written key). No seeding/scaffolding side effect — this is
    // a pure config write, exactly like `--with-persona`'s [bias]/[extensions].
    if (memoryBackendVal) {
      const { cfg } = await readConfigForRewrite(repoRoot);
      cfg.memory = { ...(cfg.memory || {}), backend: memoryBackendVal };
      await writeConfig(repoRoot, cfg);
      process.stdout.write(`memory backend set in tmct.toml: ${memoryBackendVal}\n`);
      anyActivation = true;
    }

    if (anyActivation) return;

    if (rest.includes("--detect")) {
      // AUTO-DETECT STUB (documented, non-seeding): map a build manifest to the
      // tier-2 corpus that fits, and tell the operator how to add it. Kept a stub on
      // purpose — the $0/offline default never expands the corpus without an ask.
      const { access } = await import("node:fs/promises");
      const has = (f) => access(resolvePath(repoRoot, f)).then(() => true, () => false);
      const DETECT = [["pyproject.toml", "python"], ["pom.xml", "java"]];
      const found = [];
      for (const [file, id] of DETECT) if (await has(file)) found.push([file, id]);
      if (!found.length) {
        process.stdout.write("no tier-2 corpus auto-detected (looked for pyproject.toml → python, pom.xml → java).\n");
      } else {
        for (const [file, id] of found) {
          process.stdout.write(`detected ${file} — run \`tmct init --corpus ${id}\` to add the ${id} tier-2 corpus (offline, $0).\n`);
        }
      }
      return;
    }
    return;
  }

  if (mode === "import") {
    // `tmct import` — activate+seed into an ALREADY-initialized repo, reusing
    // the SAME resolvePluggableInput/activatePluggableInput seam `init`'s own
    // --corpus/--ontology/--lexicon flags use. `--graph` is a DIFFERENT, purely
    // additive operation (appendGraphFiles) — it grows tmct.toml's graph_files
    // array, never activates an extensions bundle.
    const rest = process.argv.slice(3);
    const { strFlag, repeatedFlag, enumFlag } = await import("../src/cli-args.mjs");
    const { resolve: resolvePath } = await import("node:path");

    const repoFlag = strFlag(rest, ["--repo"]);
    const repoRoot = repoFlag ? resolvePath(process.cwd(), repoFlag) : process.cwd();

    const corpusVal = strFlag(rest, ["--corpus"]);
    const ontologyVal = strFlag(rest, ["--ontology"]);
    const lexiconVal = strFlag(rest, ["--lexicon"]);
    const graphFlags = repeatedFlag(rest, ["--graph"]);
    // `--memory-backend <default|memory|sqlite>`: same knob as `tmct init`'s
    // (consistent name, same [memory] backend tmct.toml field) — lets an
    // already-initialized repo change its storage backend without a re-init.
    let memoryBackendVal;
    try {
      memoryBackendVal = enumFlag(rest, ["--memory-backend"], ["default", "memory", "sqlite"]);
    } catch (e) {
      process.stderr.write(`tmct import: ${e?.message || e}\n`);
      process.exit(2);
    }

    if (!corpusVal && !ontologyVal && !lexiconVal && !graphFlags.length && !memoryBackendVal) {
      process.stderr.write("tmct import: needs at least one of --corpus/--ontology/--lexicon/--graph/--memory-backend\n");
      process.exit(2);
    }

    let corpusResolved = null, ontologyResolved = null, lexiconResolved = null;
    try {
      if (corpusVal) corpusResolved = await resolvePluggableInput("corpus", corpusVal, { repoRoot });
      if (ontologyVal) ontologyResolved = await resolvePluggableInput("ontology", ontologyVal, { repoRoot });
      if (lexiconVal) lexiconResolved = await resolvePluggableInput("lexicon", lexiconVal, { repoRoot });
    } catch (e) {
      process.stderr.write(`tmct import: ${e?.message || e}\n`);
      process.exit(2);
    }

    for (const resolved of [corpusResolved, ontologyResolved, lexiconResolved]) {
      if (!resolved) continue;
      try {
        process.stdout.write(await activatePluggableInput(repoRoot, resolved));
      } catch (e) {
        process.stderr.write(`tmct import: ${e?.message || e}\n`);
        process.exit(1);
      }
    }

    if (graphFlags.length) {
      try {
        await appendGraphFiles(repoRoot, graphFlags);
        process.stdout.write(`added ${graphFlags.length} graph file(s) to tmct.toml's graph_files: ${graphFlags.join(", ")}\n`);
      } catch (e) {
        process.stderr.write(`tmct import: ${e?.message || e}\n`);
        process.exit(1);
      }
    }

    if (memoryBackendVal) {
      const { cfg } = await readConfigForRewrite(repoRoot);
      cfg.memory = { ...(cfg.memory || {}), backend: memoryBackendVal };
      await writeConfig(repoRoot, cfg);
      process.stdout.write(`memory backend set in tmct.toml: ${memoryBackendVal}\n`);
    }
    return;
  }

  if (mode === "extend") {
    // `tmct extend --validate <dir>` — validate a THIRD-PARTY extension pack
    // (the shape a package like seonix/marginalia ships) BEFORE it's activated
    // in any repo's tmct.toml. Reuses existing throw-loudly primitives
    // (loadSlice/loadMap/toFacts, loadLexicon, loadTemplates) via
    // src/extensions.mjs's validateExtensionPack — never invents new
    // shape-checking logic. `<dir>` must carry its own tmct.toml declaring one
    // or more `[extensions.<name>]` host entries (the SAME [extensions] table
    // shape a repo's own tmct.toml uses) naming the resource(s) to validate;
    // the shipped builtins (seon/conceptnet/tier2-*) are never re-validated
    // here — this command is about a PACK's OWN declared resources.
    const rest = process.argv.slice(3);
    const vi = rest.indexOf("--validate");
    const dirArg = vi !== -1 ? rest[vi + 1] : undefined;
    if (!dirArg) {
      process.stderr.write("tmct extend: --validate <dir> requires a directory\n");
      process.exit(2);
    }
    const { resolve: resolvePath } = await import("node:path");
    const { strFlag } = await import("../src/cli-args.mjs");
    const target = resolvePath(process.cwd(), dirArg);
    // `--config <path>` (optional): an alternate tmct.toml to validate against,
    // INSTEAD of `<target>/tmct.toml` — `target` still anchors every resource
    // path (a pure validator stays that way; this never mutates anything).
    // Accepts either a FILE (the tmct.toml itself) or a DIRECTORY (look for
    // tmct.toml under it), same as every other subcommand's --config.
    const configFlag = strFlag(rest, ["--config"]);
    let configFile;
    if (configFlag) {
      const { stat } = await import("node:fs/promises");
      const abs = resolvePath(process.cwd(), configFlag);
      let isDir = false;
      try { isDir = (await stat(abs)).isDirectory(); } catch { /* missing path — treat as a file target */ }
      configFile = isDir ? resolvePath(abs, "tmct.toml") : abs;
    }
    const { resolveExtensions, BUILTIN_EXTENSIONS, validateExtensionPack } = await import("../src/extensions.mjs");
    let entries;
    try {
      ({ entries } = await resolveExtensions(target, configFile ? { configFile } : {}));
    } catch (e) {
      process.stderr.write(`tmct extend --validate: ${e?.message || e}\n`);
      process.exit(1);
    }
    const hostEntries = [...entries].filter(([name]) => !(name in BUILTIN_EXTENSIONS));
    if (!hostEntries.length) {
      process.stderr.write(`tmct extend --validate: no host-declared [extensions.*] entries found in ${target}/tmct.toml\n`);
      process.exit(1);
    }
    let allOk = true;
    for (const [name, entry] of hostEntries) {
      process.stdout.write(`${name} (${entry.kind}):\n`);
      const { ok, results } = await validateExtensionPack(target, entry);
      if (!ok) allOk = false;
      for (const r of results) {
        const status = r.ok ? "PASS" : "FAIL";
        const detail = r.ok
          ? (r.counts ? ` (${Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join(", ")})` : "")
          : ` — ${r.error}`;
        process.stdout.write(`  [${status}] ${r.kind}: ${r.path}${detail}\n`);
      }
    }
    process.stdout.write(allOk ? "tmct extend --validate: all resources passed.\n" : "tmct extend --validate: one or more resources FAILED.\n");
    process.exit(allOk ? 0 : 1);
  }

  if (mode === "syllogise") {
    // `tmct syllogise` — the explicit speculative-inference batch (never on the chat
    // hot path): forward-chain the memory's rdfs:subClassOf closure into bounded,
    // low-trust, retractable entailed facts. Same repo resolution as `memory` —
    // resolveRuntimeConfig (src/cli-args.mjs): --repo > git root > cwd. Also
    // accepts `--config` for symmetry (syllogise reads no code graph either).
    const rest = process.argv.slice(3);
    const numFlag = (name, dflt) => {
      const j = rest.indexOf(name);
      const v = j !== -1 ? Number(rest[j + 1]) : NaN;
      return Number.isFinite(v) ? v : dflt;
    };
    const { resolveRuntimeConfig } = await import("../src/cli-args.mjs");
    const { syllogise } = await import("../src/syllogise.mjs");
    const { repo } = await resolveRuntimeConfig({ argv: rest });
    const res = await syllogise(repo, { depth: numFlag("--depth", 32), budget: numFlag("--budget", 50) });
    process.stdout.write(
      `tmct syllogise — derived ${res.count} entailed fact(s) (subClassOf closure, depth ${res.depth}, budget ${res.budget})`
      + (res.truncated ? " — budget reached, more available" : "") + "\n",
    );
    return;
  }

  if (mode === "viz") {
    // `tmct viz` — one self-contained, navigable HTML file rendering the
    // memory graph (PLAN_BREADTH_FIRST_NLU.md §5, PLAN_VIZ.md's design):
    // pan/zoom, click-a-node, a concentric ring layout keyed on hop with a
    // depth/age falloff. Same repo resolution as `memory`/`syllogise` —
    // resolveRuntimeConfig: --repo > git root > cwd.
    const rest = process.argv.slice(3);
    const { strFlag, resolveRuntimeConfig } = await import("../src/cli-args.mjs");
    const { computeVizGraph, renderVizHtml, readAskBundle } = await import("../src/viz.mjs");
    const { writeFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const numFlag = (name) => {
      const j = rest.indexOf(name);
      const v = j !== -1 ? Number(rest[j + 1]) : NaN;
      return Number.isFinite(v) ? v : undefined;
    };
    const focus = strFlag(rest, ["--focus"]);
    const depth = numFlag("--depth"); // max arcs (hops) from the focus node
    const nodeLimit = numFlag("--limit"); // spiral length: total nodes walked
    const outPath = resolve(process.cwd(), strFlag(rest, ["--output", "--out"], "graph.html"));
    const { repo } = await resolveRuntimeConfig({ argv: rest });
    const vizGraph = await computeVizGraph(repo, {
      ...(focus ? { focus } : {}),
      ...(depth != null ? { depth } : {}),
      ...(nodeLimit != null ? { nodeLimit } : {}),
    });
    // The embedded "Ask the graph" chat panel — the real ask.mjs engine,
    // bundled for the browser (scripts/build-ask-bundle.mjs's checked-in
    // output). readAskBundle() never throws; an empty string renders a
    // graph-only page with an honest "chat unavailable" note instead of a
    // broken one (e.g. a fresh checkout before the bundle's first build).
    const askBundle = await readAskBundle();
    const html = renderVizHtml({ ...vizGraph, askBundle });
    await writeFile(outPath, html, "utf8");
    process.stdout.write(
      `tmct viz — wrote ${vizGraph.nodes.length} node(s), ${vizGraph.edges.length} edge(s) to ${outPath}`
      + `${askBundle ? " (with the embedded ask-the-graph chat panel)" : " (no chat panel — run `npm run build:ask-bundle` first)"}\n`,
    );
    return;
  }

  if (mode === "serve") {
    // `tmct serve` — the Phase-A capability-router interface: an Anthropic
    // Messages API-compatible HTTP endpoint (POST /v1/messages) over the graph.
    // A deterministic, no-LLM "model" a tool-loop client (Claude Code) can point
    // at; every response reports $0 usage. Read-only: no session artifacts, no
    // writes back to the graph. See src/server-http.mjs.
    const rest = process.argv.slice(3);
    if (rest.includes("--help") || rest.includes("-h")) {
      process.stdout.write(
        "tmct serve — Anthropic Messages API-compatible endpoint (POST /v1/messages)\n\n" +
        "Usage:\n" +
        "  tmct serve [--repo <abs>] [--graph <path>] [--config <path>] [--host <h>] [--port <n>]\n\n" +
        "  --repo <abs>   target a repo's graph (<abs>/.tmct/graph.json); default: git root/cwd\n" +
        "  --graph <path> explicit graph file (repeatable — multiple graphs merge; wins\n" +
        "                 over --repo/TMCT_GRAPH_FILE/tmct.toml)\n" +
        "  --config <path>  an alternate tmct.toml location (a file or a directory)\n" +
        "  --host <h>     bind address (default 127.0.0.1)\n" +
        "  --port <n>     TCP port (default 8787; 0 picks an ephemeral port)\n\n" +
        "Request:  { model, messages:[...], tools:[...], max_tokens, system? }\n" +
        "Response: { id, type:\"message\", role:\"assistant\", content:[...blocks], stop_reason, usage }\n" +
        "          usage is always { input_tokens: 0, output_tokens: 0 } — tmct is the $0 floor.\n",
      );
      return;
    }
    const { strFlag, resolveRuntimeConfig } = await import("../src/cli-args.mjs");
    const host = strFlag(rest, ["--host"], "127.0.0.1");
    const portRaw = strFlag(rest, ["--port"]);
    const port = portRaw !== undefined && Number.isFinite(Number(portRaw)) ? Number(portRaw) : 8787;
    const { startServer } = await import("../src/server-http.mjs");
    // Graph-path precedence (src/cli-args.mjs, shared with `chat`): --graph
    // flag(s) > TMCT_GRAPH_FILE env > tmct.toml graph_file/graph_files >
    // --repo-derived <repo>/.tmct/graph.json > git-root/cwd default. This
    // REPLACES serve's old cwd-only default (loadConfig had no git-root
    // fallback) with the same git-root-aware default every other subcommand
    // now shares — a deliberate, documented unification, not a regression.
    const { config } = await resolveRuntimeConfig({ argv: rest });
    const srv = await startServer({ config, host, port });
    process.stdout.write(
      `tmct serve — Anthropic Messages API at ${srv.url}/v1/messages (POST) — ` +
      `graph ${srv.config.graphFile} — usage billed $0 — Ctrl+C to stop\n`,
    );
    const shutdown = async () => { await srv.close(); process.exit(0); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return; // the listening server keeps the event loop alive
  }

  if (mode === "cli") {
    await runCliMode();
    return;
  }

  // An unknown mode gets the instructive usage line and exit 2. (A bare invocation
  // never lands here — the argv splice above rewrote it to `chat`.)
  process.stderr.write(`tmct: unknown invocation "${process.argv.slice(2).join(" ")}". ` +
    "Use `chat`, `memory`, `init`, `import`, `extend --validate`, `syllogise`, `serve`, `cli digest …`, or `cli <tool> …`.\n");
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`tmct: ${e?.message || e}\n`);
  process.exit(1);
});
