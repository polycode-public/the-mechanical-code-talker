#!/usr/bin/env node
// seonix — local typed-edge code-graph MCP. Two-mode contract, mirroring
// codebase-memory-mcp so it drops into the same benchmark harness:
//
//   seonix                                              → stdio MCP server
//   seonix cli index_repository '{"repo_path":"<abs>"}' → deterministic index
//     (honours <repo>/.seonixignore — gitignore-subset patterns; pass
//      `"ignores":false` in the JSON arg to index everything regardless)
//   seonix cli index_repository '{"repo_paths":["<abs1>","<abs2>",…],"out_root":"<abs-dir>"}' → index
//     n repos into ONE merged graph at <out_root>/.seonix/ (module ids prefixed with each repo's
//     directory basename; out_root defaults to the paths' deepest common ancestor directory).
//     Mutually exclusive with repo_path.
//   seonix cli index_repository '{"multi_root":"<abs-dir>"}' → estate discovery: every immediate
//     child directory carrying a .git (dir or file) is indexed as a repo, merged into
//     <multi_root>/.seonix/ (discovered/skipped counts logged to stderr)
//   seonix cli digest '{"repo_path":"<abs>","modules":[…]}' → architecture map + per-module
//                                                           context bundles to stdout (no-MCP arm)
//   seonix cli digest '{"repo_path":"<abs>","query":"<free text>"}' → same, but auto-locates +
//     score-gap-selects the modules (R1b, the shipped default) instead of requiring an explicit
//     `modules` list — one call from a question to a digest. `modules` wins if both are given.
//   seonix cli browser_link '{"query":"<nl-ish or grammar>","at":"<sha>","base":"<url>"}' → NL→query→URL:
//     map a natural-language-ish request to the code-browser query grammar (deterministic, no model),
//     SELF-TEST it against the local temporal graph (≥1 match, cursors resolve), print the URL;
//     exit 1 on a link that would render empty. `"grammar":true` takes the query verbatim.
//   seonix cli <toolName> '{…args}'                     → invoke ANY MCP tool via Bash (no MCP)
//     (e.g. seonix cli seonix_ask '{"query":"<free text>"}' — mechanical, no-LLM NL question
//      over the graph, PLAN_MECHANICAL_CHAT.md; no bespoke wiring needed, this fallback covers it)
//   seonix viz [--focus <sym>] [--depth N] [--out f.html] [--data-out f.json] [--repo-url <gitlab url> --ref main] [--site-nav] → render a focused sub-graph to HTML (one shared viewer; data embedded, or split out with --data-out). By default also writes code-browser.html + timeline.html next to --out with a working header nav; --graph-only suppresses the siblings
//   seonix viz --browser-out f.html [--browser-data-out f.json] [--timeline-out f.html] [--scope product|<prefixes>] → override the sibling artifact paths (Chronograph code browser: temporal scrub + two-cursor diff + narration + ghost-branch merges + keyboard nav; archive/PLAN_CODE_BROWSER.md)
//   seonix viz --serve [--port N] [--focus <sym>]        → serve the same viewer against THIS repo's index (the local equivalent of the site's #viz; code browser at /code-browser.html, live-reannotating on HEAD change via /code-browser-version)
//   seonix chat [--repo <abs>] → interactive prompt over the mechanical seonix_ask engine; /exit to leave; session log → <repo>/.seonix/session-<uuidv7>.log
//
// The index step is offline and model-free (Python ast + git). It writes the
// graph artifact to <repo_path>/.seonix/graph.json; the server (started with
// cwd = that repo) loads it by default. No flags, no config files.

import { join } from "node:path";
import { startServer } from "../src/server.mjs";
import { dispatchTool, buildContextBundle } from "../src/server.mjs";
import { indexRepository, indexRepositories, discoverRepos } from "../src/extract.mjs";
import { loadConfig, DEFAULT_GRAPH_REL } from "../src/config.mjs";
import * as source from "../src/source.mjs";
import { parseEntities, rankModulesByProximity, searchModulesRanked, selectRankedModules, DEFAULT_SCORE_GAP } from "../src/codegraph.mjs";

/** Build a config pointed at a specific repo's artifact (for `cli` sub-commands that
 *  take a repo_path), or fall back to the cwd-derived default. */
function configFor(repoPath) {
  return repoPath ? { graphFile: join(repoPath, DEFAULT_GRAPH_REL) } : loadConfig();
}

/** Parse the trailing JSON payload of a `cli` sub-command (best-effort). */
function parsePayload(payload) {
  if (!payload) return {};
  try { return JSON.parse(payload); }
  catch { return null; }
}

const DIGEST_MODULE_CAP = 12;   // bound the no-MCP digest — a handful of changed modules
const DIGEST_SECONDARY_CAP = 2; // B2: at most this many SECONDARY modules get a (trimmed) bundle
const TIER_RANK = { NONE: 0, TINY: 1, MID: 2, LARGE: 3, FULL: 4 };

/** `cli digest` — print a machine-readable header + a repo architecture map + the
 *  seonix_context edit bundle for each requested module to stdout (reuses the server's exact
 *  renderer via buildContextBundle, so no render logic is duplicated). This stdout is injected
 *  into the no-MCP arm's prompt.
 *
 *  Two ways to say which modules: an explicit `modules` array (unchanged), or a `query` string —
 *  auto-locate + score-gap-select (R1b, the shipped default as of 2026-07-02) in one call, so a
 *  real caller no longer has to run `seonix_locate` and hand-pick a module themselves. `modules`
 *  wins if both are given. The header reports which modules were actually selected either way.
 *
 *  B2: the FIRST (primary) module gets a full size-adaptive bundle; the remaining modules are
 *  RANKED by import/cochange proximity to the primary and only the top few get a TRIMMED
 *  (signatures + insertion region) bundle — so a 2-module task no longer pays for two full
 *  bundles. The leading header line lets the rig record tier/topup telemetry. */
async function runDigest(args) {
  const repoPath = args.repo_path;
  if (!repoPath) { process.stderr.write("seonix: digest requires repo_path\n"); process.exit(2); }
  let modules = Array.isArray(args.modules) ? args.modules.slice(0, DIGEST_MODULE_CAP) : [];
  let autoSelected = null; // for the header, when `query` drove selection
  if (!modules.length && args.query) {
    const graph = parseEntities(await source.fetchEntities(configFor(repoPath)));
    // SHIPPED DEFAULT (0.5.0): the no-MCP digest's query-mode auto-locate resolves literal-mention ON
    // (a fresh invocation with no seonix.toml), disable-able via `literal_mention:false`. Kept in
    // lockstep with the `seonix_locate` handler so `cli digest '{query}'` ≡ `cli seonix_locate` for the
    // same query. A strict no-op unless the query carries a ≥3-component dotted path / repo-relative
    // path; searchModulesRanked derives rawQuery from the query when literalMention is on.
    const ranked = searchModulesRanked(graph, args.query, { literalMention: args.literal_mention !== false });
    const scoreGapK = args.score_gap === false ? null : (Number.isFinite(args.score_gap) ? args.score_gap : DEFAULT_SCORE_GAP);
    modules = selectRankedModules(ranked, { top_k: Number.isFinite(args.top_k) ? args.top_k : 2, scoreGapK }).slice(0, DIGEST_MODULE_CAP);
    autoSelected = modules;
    if (!modules.length) process.stderr.write(`seonix: digest query "${args.query}" matched no modules — empty digest\n`);
  }
  // Tuning-flag contract (threaded to buildContextBundle → sizeBundle): `min` → leanest TINY/no
  // top-up; `untuned` → the earlier escalation. Neither → the tuned default. The digest header still
  // reports the EFFECTIVE tier/topup returned per module, so rig telemetry stays correct.
  const min = Boolean(args.min);
  const untuned = Boolean(args.untuned);
  // seonix-max: the injection CEILING — every requested module gets a FULL (untrimmed) bundle,
  // not just the primary + 2 trimmed secondaries. Tests whether maximal injection re-bloats.
  const max = Boolean(args.max);
  const secondaryCap = max ? modules.length : DIGEST_SECONDARY_CAP;
  const config = configFor(repoPath);
  const body = [];
  let effTier = "NONE"; // largest tier emitted across all modules
  let topup = false;    // whether any module's auto-sizing escalated above TINY
  let emitted = 0;      // module bundles actually emitted (primary + trimmed secondaries)

  try {
    body.push("# Repository architecture\n" + (await dispatchTool("seonix_architecture", {}, { config })));
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
    if (overflow.length) body.push(`\n# Related modules (not expanded; query seonix_context if needed): ${overflow.join(", ")}`);
  }

  // HARD CONTRACT: first line is the machine-readable digest header the rig greps. Fields are
  // append-only — `selected=` is new (query mode only) and never changes the existing ones the
  // rig's own parser depends on.
  const header = `# seonix-digest tier=${effTier} topup=${topup} modules=${emitted}`
    + (autoSelected ? ` selected=${autoSelected.join(",") || "(none)"}` : "");
  process.stdout.write([header, ...body].join("\n") + "\n");
}

async function main() {
  const [mode, sub, payload] = process.argv.slice(2);

  if (mode === "cli") {
    // index mode: `cli index_repository '{"repo_path":"<abs>"}'` (single repo, unchanged),
    // '{"repo_paths":[…],"out_root":"<abs>"}' (explicit n-repo merge) or
    // '{"multi_root":"<abs>"}' (discover child repos, merge into <multi_root>/.seonix/).
    if (sub === "index_repository") {
      const args = parsePayload(payload);
      if (args === null) {
        process.stderr.write("seonix: index_repository expects a JSON arg, e.g. '{\"repo_path\":\"/abs\"}'\n");
        process.exit(2);
      }
      const given = ["repo_path", "repo_paths", "multi_root"].filter((k) => args[k] !== undefined);
      if (given.length > 1) {
        process.stderr.write(`seonix: ${given.join(" + ")} are mutually exclusive — pass exactly one\n`);
        process.exit(2);
      }
      if (given.length === 0) {
        process.stderr.write("seonix: index_repository requires repo_path, repo_paths or multi_root\n");
        process.exit(2);
      }
      const t0 = Date.now();
      const emitSummary = (graphFile, counts, head) => {
        process.stderr.write(
          `seonix: indexed ${head}${counts.modules} modules, ${counts.functions} symbols, ` +
            `${counts.edges} edges (${counts.callsSymbol} callsSymbol, ${counts.touchesSymbol} touchesSymbol), ` +
            `${counts.commits} commits in ${Date.now() - t0}ms → ${graphFile}\n`,
        );
        process.stderr.write(
          `seonix: history-symbol pass +${counts.historyMs}ms over ${counts.baseMs}ms base ` +
            `= ${counts.historyPct}% (depth ${counts.historySymbolDepth}; budget ≤10%)\n`,
        );
      };

      if (args.repo_path) {
        const { graphFile, counts } = await indexRepository(args.repo_path, { ignores: args.ignores !== false });
        emitSummary(graphFile, counts, "");
        return;
      }

      let repoPaths = args.repo_paths;
      let outRoot = args.out_root || "";
      if (args.multi_root) {
        const { repos, skipped } = await discoverRepos(args.multi_root);
        process.stderr.write(
          `seonix: multi_root ${args.multi_root}: ${repos.length} repo(s) discovered` +
            (skipped.length ? `; skipped ${skipped.length} non-repo child dir(s): ${skipped.join(", ")}` : "") + "\n",
        );
        if (!repos.length) {
          process.stderr.write("seonix: multi_root contains no repositories (no child directory has a .git)\n");
          process.exit(2);
        }
        repoPaths = repos;
        outRoot = args.multi_root;
      }
      if (!Array.isArray(repoPaths) || repoPaths.length === 0) {
        process.stderr.write("seonix: repo_paths must be a non-empty array of absolute paths\n");
        process.exit(2);
      }
      const { graphFile, counts, repos } = await indexRepositories(repoPaths, {
        ignores: args.ignores !== false,
        outRoot,
        log: (line) => process.stderr.write(`seonix: ${line}\n`),
      });
      emitSummary(graphFile, counts, `${repos.length} repos, `);
      return;
    }

    // digest mode: architecture map + per-module context bundles → stdout (no-MCP arm)
    if (sub === "digest") {
      const args = parsePayload(payload);
      if (args === null) {
        process.stderr.write("seonix: digest expects a JSON arg, e.g. '{\"repo_path\":\"/abs\",\"modules\":[…]}'\n");
        process.exit(2);
      }
      await runDigest(args);
      return;
    }

    // locate mode (TUNING #3): `cli seonix_locate '{"query":"…","repo_path":"<abs>"}'` emits the
    // ranked modules as `<relpath>\t<score>`, one per line (highest first), using renderSearch's
    // exact ranking. The rig keeps rank-1 always and rank-2 only when score2/score1 is close — it
    // needs the raw scores, which the text renderer hides. Independent of the tuning flags.
    if (sub === "seonix_locate") {
      const args = parsePayload(payload);
      if (args === null) {
        process.stderr.write("seonix: seonix_locate expects a JSON arg, e.g. '{\"query\":\"…\",\"repo_path\":\"/abs\"}'\n");
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
          // seonix.toml) — pass `literal_mention:false` to disable. It is a strict no-op on queries
          // with no ≥3-component dotted path / repo-relative path, so it never perturbs the cells the
          // headline B018 numbers were measured on. The low-level scoreModules default (codegraph.mjs)
          // stays literalMention=false; the product surface opts in explicitly, right here.
          literalMention: args.literal_mention !== false,
          ...(args.raw_query != null ? { rawQuery: String(args.raw_query) } : {}),
        });
        process.stdout.write(ranked.map((r) => `${r.path}\t${r.score}`).join("\n") + "\n");
      } catch (e) {
        process.stderr.write(`seonix: ${e?.message || e}\n`);
        process.exit(1);
      }
      return;
    }

    // browser_link (Chronograph P2): NL-ish text → query grammar → SELF-TESTED URL.
    // The mapping is deterministic keyword handling (nlToQuery — never a model call;
    // a model-driven wrapper can sit on top and pass `grammar:true` with grammar it
    // wrote itself). The link is printed ONLY if it will render something: the query
    // must match ≥1 node of the local temporal graph and every cursor must resolve —
    // the agent contract from PLAN_CODE_BROWSER.md ("no dead links").
    if (sub === "browser_link") {
      const args = parsePayload(payload);
      if (args === null || !String(args?.query || "").trim()) {
        process.stderr.write("seonix: browser_link expects a JSON arg, e.g. '{\"query\":\"classes that change with render\"}'\n");
        process.exit(2);
      }
      const config = configFor(args.repo_path);
      const { buildTemporalGraph, gitCommitOrder } = await import("../src/browser.mjs");
      const { nlToQuery, validateLink, encodeViewState, VIEW_DEFAULTS } = await import("../src/temporal.mjs");
      try {
        const raw = await source.fetchEntities(config);
        const commitIds = (raw.individuals || []).filter((i) => i.class === "Commit").map((i) => i.id);
        const order = await gitCommitOrder(args.repo_path || process.cwd(), commitIds);
        const tg = buildTemporalGraph(raw, order, { scope: args.scope });
        const { q, notes } = args.grammar ? { q: String(args.query).trim(), notes: [] } : nlToQuery(args.query);
        for (const n of notes) process.stderr.write(`seonix: note: ${n}\n`);
        if (!q) {
          process.stderr.write("seonix: the request maps to an empty query — nothing to link\n");
          process.exit(1);
        }
        const v = validateLink(tg, { q, at: args.at || "", b: args.b || "" });
        if (!v.ok) {
          for (const r of v.reasons) process.stderr.write(`seonix: link self-test FAILED: ${r}\n`);
          process.exit(1);
        }
        const qs = encodeViewState({ ...VIEW_DEFAULTS, q, at: args.at || "", b: args.b || "" });
        const base = String(args.base || "").replace(/\/+$/, "");
        process.stdout.write(`${base}/code-browser.html?${qs}\n`);
        process.stderr.write(`seonix: link self-test OK — q="${q}" matches ${v.matches} node(s)\n`);
      } catch (e) {
        process.stderr.write(`seonix: ${e?.message || e}\n`);
        process.exit(1);
      }
      return;
    }

    // tool-query fallback: any other `cli <toolName> '{…}'` routes to the MCP dispatcher,
    // so "cold" tools are invokable from Bash without an MCP connection.
    if (sub) {
      const args = parsePayload(payload);
      if (args === null) {
        process.stderr.write(`seonix: ${sub} expects a JSON arg, e.g. '{"symbol":"<name>"}'\n`);
        process.exit(2);
      }
      const config = configFor(args.repo_path);
      try {
        const text = await dispatchTool(sub, args, { config });
        process.stdout.write(text + "\n");
      } catch (e) {
        process.stderr.write(`seonix: ${e?.message || e}\n`);
        process.exit(1);
      }
      return;
    }

    process.stderr.write("seonix: `cli` needs a sub-command (index_repository | digest | <toolName>)\n");
    process.exit(2);
  }

  if (mode === "viz") {
    const { runVizCli } = await import("../src/viz.mjs");
    await runVizCli(process.argv.slice(3));
    return;
  }

  if (mode === "chat") {
    const { runChat } = await import("../src/chat.mjs");
    const i = process.argv.indexOf("--repo");
    await runChat({
      repoPath: i !== -1 ? process.argv[i + 1] : undefined,
    });
    return;
  }

  if (mode === undefined) {
    await startServer(); // bare invocation → MCP stdio server
    return;
  }

  process.stderr.write(`seonix: unknown invocation "${process.argv.slice(2).join(" ")}". ` +
    "Use bare (MCP server), `cli index_repository …`, `cli <tool> …`, `chat`, or `viz`.\n");
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`seonix: ${e?.message || e}\n`);
  process.exit(1);
});
