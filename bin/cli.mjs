#!/usr/bin/env node
// tmct — local typed-edge code-graph tools over a pre-built graph artifact:
//
//   tmct cli digest '{"repo_path":"<abs>","modules":[…]}' → architecture map + per-module
//                                                             context bundles to stdout
//   tmct cli digest '{"repo_path":"<abs>","query":"<free text>"}' → same, but auto-locates +
//     score-gap-selects the modules (R1b, the shipped default) instead of requiring an explicit
//     `modules` list — one call from a question to a digest. `modules` wins if both are given.
//   tmct cli <toolName> '{…args}'                     → invoke ANY tool via Bash
//     (e.g. tmct cli tmct_ask '{"query":"<free text>"}' — mechanical, no-LLM NL question
//      over the graph; no bespoke wiring needed, this fallback covers it)
//   tmct chat [--repo <abs>] → interactive prompt over the mechanical tmct_ask engine; /exit to leave; session log → <repo>/.tmct/session-<uuidv7>.log
//
// The graph artifact lives at <repo_path>/.tmct/graph.json; the tools (run with
// cwd = that repo) load it by default. No flags, no config files.

import { join } from "node:path";
import { dispatchTool, buildContextBundle } from "../src/server.mjs";
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
async function runDigest(args) {
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

async function main() {
  const [mode, sub, payload] = process.argv.slice(2);

  if (mode === "cli") {
    // digest mode: architecture map + per-module context bundles → stdout
    if (sub === "digest") {
      const args = parsePayload(payload);
      if (args === null) {
        process.stderr.write("tmct: digest expects a JSON arg, e.g. '{\"repo_path\":\"/abs\",\"modules\":[…]}'\n");
        process.exit(2);
      }
      await runDigest(args);
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

  if (mode === "chat") {
    const { runChat } = await import("../src/chat.mjs");
    const i = process.argv.indexOf("--repo");
    await runChat({
      repoPath: i !== -1 ? process.argv[i + 1] : undefined,
    });
    return;
  }

  // Bare invocation: no server to start any more — print the usage line and exit 2.
  // (bin/tmct.mjs splices in `chat` for bare invocations, so nothing user-facing is lost.)
  process.stderr.write(`tmct: ${mode === undefined ? "missing mode" : `unknown invocation "${process.argv.slice(2).join(" ")}"`}. ` +
    "Use `cli digest …`, `cli <tool> …`, or `chat`.\n");
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`tmct: ${e?.message || e}\n`);
  process.exit(1);
});
