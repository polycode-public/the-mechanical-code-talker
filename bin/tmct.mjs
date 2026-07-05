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
       [--plain]               force the plain readline shell (the default when
                               stdin/stdout is not a terminal)
  tmct memory [--repo <abs>]   what tmct remembers: facts, utterances, sessions,
       [--verbose]             folded blocks (the /memory chat command, from the shell)
  tmct init [--force]          initialize the current directory for tmct: .tmct/,
                               tmct.toml, tier-1 corpus seed, provenance record
       [--corpus <id>]         also seed a tier-2 corpus (aws|python|java) — opt-in,
                               offline, $0; init is tier-1-only unless asked
       [--detect]              suggest a tier-2 corpus from the repo's manifests
                               (pyproject.toml → python, pom.xml → java); never seeds unasked
  tmct syllogise [--repo <abs>] speculative inference (offline maintenance job): forward-
       [--depth <n>] [--budget <n>]  chain the memory's rdfs:subClassOf closure, materialising
                               bounded, low-trust, retractable entailed facts (never on the chat path)
  tmct cli <tool> '{…}'        invoke a graph tool directly (carry-over, de-emphasized)
  tmct cli digest '{…}'        architecture map + per-module context bundles
  tmct --help                  show this help

On a terminal, chat opens the full-screen TUI; piped input gets the plain shell.
In chat: /help lists slash-commands; /exit leaves. Session log → <repo>/.tmct/session-<id>.log.
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

async function main() {
  const mode = process.argv[2];

  if (mode === "chat") {
    const rest = process.argv.slice(3);
    const i = rest.indexOf("--repo");
    const repoPath = i !== -1 ? rest[i + 1] : undefined;
    // The shell gate: a real terminal gets the full-screen Ink TUI; `--plain` or a
    // non-TTY stream (pipes, scripts, the test suite) gets the readline shell. Both
    // drive the same createSession sink — only the drawing differs.
    const plain = rest.includes("--plain") || !process.stdin.isTTY || !process.stdout.isTTY;
    if (plain) {
      const { runChat } = await import("../src/chat.mjs");
      await runChat({ repoPath });
    } else {
      const { runTui } = await import("../src/tui/app.mjs");
      await runTui({ repoPath });
    }
    return;
  }

  if (mode === "memory") {
    // `tmct memory` — the /memory chat command from the shell: same renderer
    // (src/memory/inspect.mjs), same repo resolution as chat (git root default).
    const rest = process.argv.slice(3);
    const i = rest.indexOf("--repo");
    const repoPath = i !== -1 ? rest[i + 1] : undefined;
    const verbose = rest.includes("--verbose") || rest.includes("-v");
    const { gitToplevel } = await import("../src/chat.mjs");
    const { inspectMemory } = await import("../src/memory/inspect.mjs");
    const repo = repoPath || gitToplevel(process.cwd()) || process.cwd();
    process.stdout.write(await inspectMemory(repo, { verbose }) + "\n");
    return;
  }

  if (mode === "init") {
    // `tmct init` — the Repository-Interface onboarding surface: scaffold .tmct/,
    // write tmct.toml, seed the tier-1 corpus (offline, opt-out via TMCT_NO_SEED),
    // and record provenance. Idempotent; --force rewrites config + re-records.
    //
    // TIERING POLICY: init is OFFLINE, $0 and TIER-1-ONLY by default. A tier-2
    // domain/language corpus (corpus/tier2/: aws, python, java) is added ONLY when
    // explicitly asked via `--corpus <id>`. The `--detect` auto-detect is a
    // documented STUB: it inspects the repo's manifests (pyproject.toml → python,
    // pom.xml → java) and SUGGESTS the matching corpus, but never seeds it unasked.
    const rest = process.argv.slice(3);
    const { initRepo } = await import("../src/init.mjs");
    const res = await initRepo(process.cwd(), { force: rest.includes("--force") });
    process.stdout.write(res.message + "\n");

    const ci = rest.indexOf("--corpus");
    const corpusId = ci !== -1 ? rest[ci + 1] : undefined;
    if (corpusId) {
      // Seed a tier-2 corpus by id from corpus/tier2/ (same slice shape as tier-1;
      // provenance-tagged corpus:tier2:<id>). Idempotent (content-hashed fact ids).
      const { readFile } = await import("node:fs/promises");
      const { join, dirname } = await import("node:path");
      const { seedMemory, TIER2_MANIFEST_FILE } = await import("../src/corpus/conceptnet.mjs");
      let manifest;
      try { manifest = JSON.parse(await readFile(TIER2_MANIFEST_FILE, "utf8")); }
      catch (e) { process.stderr.write(`tmct init: cannot read the tier-2 manifest — ${e?.message || e}\n`); process.exit(1); }
      const entry = (manifest.corpuses || []).find((c) => c.id === corpusId);
      if (!entry) {
        const ids = (manifest.corpuses || []).map((c) => c.id).join(", ");
        process.stderr.write(`tmct init: unknown --corpus "${corpusId}". Available tier-2 corpuses: ${ids}.\n`);
        process.exit(2);
      }
      const slicePath = join(dirname(TIER2_MANIFEST_FILE), entry.file);
      const seeded = await seedMemory(process.cwd(), { slicePath, provenancePrefix: `corpus:tier2:${entry.id}` });
      process.stdout.write(
        `seeded tier-2 corpus "${entry.id}" (${entry.kind}) — ${seeded.appended} fact(s) added`
        + `${seeded.skipped ? `, ${seeded.skipped} already present` : ""}. Source: corpus/tier2/${entry.file} (${entry.license}).\n`,
      );
      return;
    }

    if (rest.includes("--detect")) {
      // AUTO-DETECT STUB (documented, non-seeding): map a build manifest to the
      // tier-2 corpus that fits, and tell the operator how to add it. Kept a stub on
      // purpose — the $0/offline default never expands the corpus without an ask.
      const { access } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const has = (f) => access(join(process.cwd(), f)).then(() => true, () => false);
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

  if (mode === "syllogise") {
    // `tmct syllogise` — the explicit speculative-inference batch (never on the chat
    // hot path): forward-chain the memory's rdfs:subClassOf closure into bounded,
    // low-trust, retractable entailed facts. Same repo resolution as `memory`.
    const rest = process.argv.slice(3);
    const i = rest.indexOf("--repo");
    const repoPath = i !== -1 ? rest[i + 1] : undefined;
    const numFlag = (name, dflt) => {
      const j = rest.indexOf(name);
      const v = j !== -1 ? Number(rest[j + 1]) : NaN;
      return Number.isFinite(v) ? v : dflt;
    };
    const { gitToplevel } = await import("../src/chat.mjs");
    const { syllogise } = await import("../src/syllogise.mjs");
    const repo = repoPath || gitToplevel(process.cwd()) || process.cwd();
    const res = await syllogise(repo, { depth: numFlag("--depth", 32), budget: numFlag("--budget", 50) });
    process.stdout.write(
      `tmct syllogise — derived ${res.count} entailed fact(s) (subClassOf closure, depth ${res.depth}, budget ${res.budget})`
      + (res.truncated ? " — budget reached, more available" : "") + "\n",
    );
    return;
  }

  if (mode === "cli") {
    await runCliMode();
    return;
  }

  // An unknown mode gets the instructive usage line and exit 2. (A bare invocation
  // never lands here — the argv splice above rewrote it to `chat`.)
  process.stderr.write(`tmct: unknown invocation "${process.argv.slice(2).join(" ")}". ` +
    "Use `cli digest …`, `cli <tool> …`, `memory`, or `chat`.\n");
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`tmct: ${e?.message || e}\n`);
  process.exit(1);
});
