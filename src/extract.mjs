// Deterministic, offline graph extraction — the heart of the seon-tool index.
// Runs the stdlib-`ast` parser (extract_ast.py) over the repo and `git log` for
// history, then assembles the typed `entities` payload codegraph.mjs consumes.
// ZERO model calls: CPU-bound static parsing + git only.
//
// Typed edges produced (all provenance-stamped). Prop tokens follow the SEON
// vocabulary (se-on.org, FAMIX-derived) where a term exists, with an `mgx:`
// extension namespace for the Python/framework reality SEON predates:
//   seon:usesComplexType    Module → Module   (internal import targets, via registry)
//   seon:declaresMethod     Module → CodeEntity (top-level functions/classes/methods/attrs)
//   seon:invokesMethod      Module → Module   (coarse + import-backed: a called name defined
//                                              in exactly one imported internal module)
//   mgx:testsCoverage       Module → Module   (a test module → the internal modules it imports)
//   seon:history            Commit → Module   (from git log --name-only)
//   mgx:touchesSymbol       Commit → CodeEntity (commit changed-line-range ∩ symbol span)
//   mgx:callsSymbol         Function/Method → Function/Class (symbol-granular, unambiguous)
//   seon:containsCodeEntity Class  → Method/Attribute (class membership)
//   mgx:subclassOf          Class  → Class    (inheritance; internal base resolved, else ext:)

import { spawn } from "node:child_process";
import { writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as codegraph from "./codegraph.mjs"; // optional renderToolsCatalog (other agent owns this file)
import { ingestRepo, LANG_EXTS } from "./extract_lang.mjs";
import { loadIgnores } from "./walk.mjs";
import { buildEntities } from "./graph-build.mjs";
import { ingestSchemaDocs } from "./schema-docs.mjs";
import { foldInSessions, readSessionRecords } from "./sessions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const AST_SCRIPT = join(here, "extract_ast.py");
const CLI_SCRIPT = join(here, "..", "bin", "cli.mjs");

// Every file extension the index covers: Python (extract_ast.py) + the languages
// the multi-language front-end (extract_lang.mjs) owns. Gates the git-log file
// filters so history is collected for ALL indexed languages, not just `.py`.
const INDEXED_EXTS = new Set([".py", ...LANG_EXTS]);
const isIndexedFile = (f) => {
  const dot = f.lastIndexOf(".");
  return dot >= 0 && INDEXED_EXTS.has(f.slice(dot).toLowerCase());
};
const GIT_LOG_COMMITS = 300;          // module-level history depth (cheap; full depth)
// Symbol-level line-range pass depth. Tuned on the Django corpus (2819 modules, 300-commit
// window): the per-commit `git log -p --unified=0` hunk pass costs ~0.8% of base at depth 80
// and ~2% at the full 300 — base is dominated by the Python AST parse, so this stays well
// under the ≤10% budget. Capped at 120 because line numbers in older commits drift from the
// CURRENT symbol spans we intersect against, so recent history is also the most accurate.
const HISTORY_SYMBOL_DEPTH = 120;

/** Module-level git history depth (cheap name-only pass). Env: SEONIX_GIT_DEPTH. */
function gitDepth(env = process.env) {
  const n = Number(env.SEONIX_GIT_DEPTH);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : GIT_LOG_COMMITS;
}

/** Symbol-level history depth — the per-commit hunk pass is the costly one, so this is
 *  capped well below gitDepth to keep the added index time ≤10%. Env:
 *  SEONIX_HISTORY_SYMBOL_DEPTH (0 disables the symbol-history pass entirely). */
function historySymbolDepth(env = process.env) {
  const raw = env.SEONIX_HISTORY_SYMBOL_DEPTH;
  if (raw === undefined || raw === "") return HISTORY_SYMBOL_DEPTH;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : HISTORY_SYMBOL_DEPTH;
}

/** spawn, collect stdout; resolve {code, stdout, stderr} (never reject). */
function exec(cmd, args, { cwd, maxBuffer = 512 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    let size = 0;
    child.stdout?.on("data", (d) => { size += d.length; if (size <= maxBuffer) stdout += d; });
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: stderr + String(err) }));
  });
}


/** Run the Python ast extractor → [{path, dotted, imports, defines, calls}]. */
async function runAst(repoPath, python) {
  const { code, stdout, stderr } = await exec(python, [AST_SCRIPT, repoPath]);
  if (code !== 0) throw new Error(`extract_ast.py failed (${python}, exit ${code}): ${stderr.trim().slice(-400)}`);
  let parsed;
  try { parsed = JSON.parse(stdout); }
  catch { throw new Error(`extract_ast.py produced non-JSON (is "${python}" a Python 3.9+ interpreter?)`); }
  return Array.isArray(parsed?.modules) ? parsed.modules : [];
}

// Paths git-log itself must never diff, mirroring .seonixignore's top-level excludes.
// loadIgnores()/the `ignore` predicate (indexRepository, below) only filters the
// FINAL module list — by then git log -p has already run and Node has already
// buffered its full output. For a directory carrying many large files (results/:
// 9,315 files / 529MB as of 2026-07-02), that historical patch content alone is
// gigabytes, which OOM'd a memory-constrained CI runner even though .seonixignore
// correctly kept those paths out of the resulting graph. Pathspec excludes stop git
// from generating that content at all. Keep in sync with .seonixignore (candidate
// for the seonix.toml config consolidation to share one list instead of two).
export const GIT_LOG_EXCLUDE = ["corpus", "target", "vendor", "infra/cdk.out", "results"];
const gitPathspecExcludes = () => GIT_LOG_EXCLUDE.map((p) => `:(exclude)${p}`);

/** git log → [{sha, author, date, subject, files[]}] over the last N commits
 *  (best-effort; [] if no repo). Header record fields are \x1e-separated; commits
 *  are \x1f-separated; the subject (%s) is single-line so it never collides with
 *  the per-file lines that follow. */
async function runGitLog(repoPath, depth = gitDepth()) {
  const { code, stdout } = await exec("git",
    ["log", `-n`, String(depth), "--no-renames", "--name-only",
      "--pretty=format:%x1f%H%x1e%an%x1e%aI%x1e%s", "--", ".", ...gitPathspecExcludes()],
    { cwd: repoPath });
  if (code !== 0) return [];
  const out = [];
  for (const chunk of stdout.split("\x1f")) {
    const nl = chunk.indexOf("\n");
    const header = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    if (!header) continue;
    const [sha, author = "", date = "", subject = ""] = header.split("\x1e");
    if (!sha) continue;
    const files = (nl === -1 ? "" : chunk.slice(nl + 1))
      .split("\n").map((l) => l.trim()).filter(isIndexedFile);
    out.push({ sha: sha.trim(), author, date, subject, files });
  }
  return out;
}

/** git log -p --unified=0 → [{sha, ranges: {path: [[start,end], …]}}] for the
 *  symbol-granular history pass. Parses the NEW-side hunk header (`+c,d`) into the
 *  changed line range; extract.mjs intersects those with the (current) symbol spans.
 *  This is the costly history pass, so it runs at the budgeted (capped) depth.
 *  Best-effort: [] on any git failure or depth 0. */
async function runGitLogHunks(repoPath, depth = historySymbolDepth()) {
  if (!depth) return [];
  const { code, stdout } = await exec("git",
    ["log", `-n`, String(depth), "--no-renames", "--no-color", "--unified=0",
      "--pretty=format:%x1f%H", "--", ".", ...gitPathspecExcludes()],
    { cwd: repoPath });
  if (code !== 0) return [];
  const out = [];
  let cur = null;
  let file = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("\x1f")) {
      cur = { sha: line.slice(1).trim(), ranges: {} };
      if (cur.sha) out.push(cur); else cur = null;
      file = null;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("+++ ")) {
      // "+++ b/path" (or "+++ /dev/null" for a deletion → skip)
      const m = line.match(/^\+\+\+ b\/(.+?)\s*$/);
      file = m && isIndexedFile(m[1]) ? m[1] : null;
      if (file && !cur.ranges[file]) cur.ranges[file] = [];
      continue;
    }
    if (file && line.startsWith("@@")) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      cur.ranges[file].push(count > 0 ? [start, start + count - 1] : [start, start]);
    }
  }
  return out;
}


/** Catalog of COLD tools (those reachable only via `cli <tool>`, not the always-on
 *  hook) with a one-line "when to use" + example args — written to .seonix/TOOLS.md so
 *  a Bash-only agent can discover the invocations. Fallback used until codegraph.mjs
 *  exports renderToolsCatalog(cliPath). */
const COLD_TOOLS = [
  ["seonix_describe", '{"symbol":"<path-or-name>"}', "Typed edges (defines/imports/calls/tests/touches) + provenance for one symbol — replaces grep to locate code."],
  ["seonix_members", '{"class":"<ClassName>"}', "A class's methods + attributes (file:line, decorators) in one slice."],
  ["seonix_subclasses", '{"class":"<ClassName>"}', "Base classes + the transitive set that extends a class."],
  ["seonix_impact", '{"module":"<path>"}', "Reverse closure over imports/calls — what breaks if a module changes."],
  ["seonix_architecture", '{"package":"<optional/prefix>"}', "Packages + hub modules; the repo shape without reading the tree."],
  ["seonix_exports", '{"module":"<path>"}', "A module's __all__ public API resolved to defining modules."],
  ["seonix_signature", '{"symbol":"<name>"}', "Params/returns/raises/flags/decorators/doc for one symbol — without its body."],
  ["seonix_tests_for", '{"symbol":"<name>"}', "Test modules covering a symbol/module."],
  ["seonix_untested", "{}", "Source modules with no covering test module."],
  ["seonix_history", '{"symbol":"<name>"}', "Recent commits that touched a symbol's module."],
  ["seonix_callers", '{"symbol":"<name>"}', "Modules that call into a symbol's module (one hop)."],
  ["seonix_callees", '{"symbol":"<name>"}', "Modules a symbol's module calls into (one hop)."],
  ["seonix_cochanges", '{"symbol":"<name>"}', "Modules that historically change in the same commit (edit-these-too)."],
  ["seonix_snippet", '{"symbol":"<name>"}', "Exact source of one function/class/Class.method by name."],
  ["seonix_context", '{"symbol":"<path-or-name>"}', "START HERE to edit a module: the full edit bundle in one call."],
  ["seonix_search", '{"query":"<keywords>"}', "Free-text lookup to discover the right module/symbol when you don't know the path."],
];

function localToolsCatalog(cliPath) {
  const lines = [
    "# seonix cold tools — Bash invocations (no MCP required)",
    "",
    "Each tool answers ONE question in one compact, bounded call — prefer it over Read/Grep.",
    "Run any tool via:",
    "",
    "```bash",
    `node ${cliPath} cli <tool> '<json-args>'`,
    "```",
    "",
    "Pass `\"repo_path\":\"<abs>\"` in the args to point at a specific indexed repo.",
    "",
  ];
  for (const [tool, ex, when] of COLD_TOOLS) {
    lines.push(`## ${tool}`, when, "```bash", `node ${cliPath} cli ${tool} '${ex}'`, "```", "");
  }
  return lines.join("\n");
}

const DEFAULT_PYTHON = () => process.env.SEONIX_PYTHON || process.env.SEON_PYTHON || "python3";

/** One repo's raw extraction — parsers + git, NO graph assembly. Both index modes
 *  build on this; multi-repo runs it repo-by-repo so only one repo's raw source
 *  (parser/git-log output) is in memory at a time. */
async function extractRepo(repoPath, { python = DEFAULT_PYTHON(), ignores = true } = {}) {
  const t0 = Date.now();
  // `.seonixignore` (opt-out: `ignores:false`, the benchmark rig's flag). The matcher
  // prunes the in-process walkers (extract_lang) at parse time; the module filter below
  // is the AUTHORITATIVE cut — it also covers extractors that walk on their own
  // (extract_ast.py, the Java fat-jar, Roslyn), and buildEntities drops history edges
  // for any module not in the list, so the whole graph honours the same exclusions.
  const ignore = ignores ? await loadIgnores(repoPath) : null;
  // base extraction: ast (Python) + multi-language front-end (TS/JS, C#) + module-level
  // git history (the cheap, full-depth pass). The Python and language passes are
  // independent parsers; their `{modules:[…]}` outputs share one contract and are merged
  // (dedupe by path — Python from runAst wins) before buildEntities.
  const [pyModules, langResult, commits] = await Promise.all([
    runAst(repoPath, python),
    ingestRepo(repoPath, { ignore }),
    runGitLog(repoPath, gitDepth()),
  ]);
  const seenPaths = new Set(pyModules.map((m) => m.path));
  const merged = [...pyModules, ...langResult.modules.filter((m) => !seenPaths.has(m.path))];
  const modules = ignore ? merged.filter((m) => !ignore(m.path)) : merged;
  const baseMs = Date.now() - t0;
  // added symbol-history pass (the costly per-commit hunk diff) — budgeted via depth
  const tHist = Date.now();
  const symbolHistory = await runGitLogHunks(repoPath, historySymbolDepth());
  const historyMs = Date.now() - tHist;
  return { modules, perLang: langResult.perLang, commits, symbolHistory, baseMs, historyMs };
}

/** Assemble entities from (possibly merged) extractions and write the artifacts
 *  (<rootDir>/.seonix/graph.json + TOOLS.md). Shared by both index modes. */
async function assembleAndWrite(rootDir, { modules, commits, symbolHistory, generatedAt, proseEnabled, sessions = [] }) {
  const entities = buildEntities(modules, commits, { generatedAt, symbolHistory, prose: proseEnabled });
  // Schema self-documentation (schema-docs.mjs): static, repo-independent — merges in
  // SchemaClass/SchemaPredicate individuals + backfills entities.classes[].description
  // and entities.vocabulary[].note, so "what does cochange mean" is answerable by the
  // same graph traversal as any other question. Fixed-size, ~0ms marginal cost.
  ingestSchemaDocs(entities);
  // Chat sessions (sessions.mjs): sessions are runtime observations, not source
  // derivations — they are re-attached AFTER the source-derived build, each recorded
  // entity id re-resolved against the fresh graph (unresolvable → edge dropped and
  // counted on the Session node, never guessed). No sessions → byte-identical output.
  if (sessions.length) foldInSessions(entities, sessions);
  const graphFile = join(rootDir, ".seonix", "graph.json");
  await mkdir(dirname(graphFile), { recursive: true });
  await writeFile(graphFile, JSON.stringify(entities));

  // TOOLS.md catalog (prefer the other agent's renderToolsCatalog when it lands).
  // TODO: switch to codegraph.renderToolsCatalog(CLI_SCRIPT) once that export exists.
  const toolsMd = typeof codegraph.renderToolsCatalog === "function"
    ? codegraph.renderToolsCatalog(CLI_SCRIPT)
    : localToolsCatalog(CLI_SCRIPT);
  await writeFile(join(rootDir, ".seonix", "TOOLS.md"), toolsMd);
  return { entities, graphFile };
}

function buildCounts(entities, { modules, languages, commits, proseEnabled, baseMs, historyMs }) {
  const propCount = (prop) => entities.objectProperties.find((g) => g.prop === prop)?.count ?? 0;
  // history budget: the symbol pass should add ≤10% over base extraction time.
  const historyPct = baseMs > 0 ? Math.round((historyMs / baseMs) * 1000) / 10 : 0;
  return {
    modules,
    languages,
    functions: entities.classes.find((c) => c.name === "Function")?.count ?? 0,
    commits,
    edges: entities.objectProperties.reduce((n, g) => n + g.count, 0),
    callsSymbol: propCount("mgx:callsSymbol"),
    touchesSymbol: propCount("mgx:touchesSymbol"),
    historySymbolDepth: historySymbolDepth(),
    proseEnabled,
    proseWords: Object.keys(entities.proseIndex || {}).length,
    baseMs,
    historyMs,
    historyPct,
  };
}

/**
 * Index a repository: parse (ast) + git log → entities → write <repo>/.seonix/graph.json
 * (+ a TOOLS.md catalog of the cold tools). Times the base extraction vs the added
 * symbol-history (line-range) pass so the latter can be kept within the ≤10% budget.
 * @returns {Promise<{graphFile, counts}>}
 */
export async function indexRepository(repoPath, { python = DEFAULT_PYTHON(), generatedAt = "", ignores = true } = {}) {
  // Second pass (PLAN_PROSE_INDEX.md): on by default; SEONIX_PROSE_INDEX=0 disables it
  // (mirrors SEONIX_HISTORY_SYMBOL_DEPTH=0's disable convention above).
  const proseEnabled = process.env.SEONIX_PROSE_INDEX !== "0";
  const { modules, perLang, commits, symbolHistory, baseMs, historyMs } = await extractRepo(repoPath, { python, ignores });
  const sessions = await readSessionRecords(repoPath); // recorded chat sessions (.seonix/sessions/*.jsonl), [] when none
  const { entities, graphFile } = await assembleAndWrite(repoPath, { modules, commits, symbolHistory, generatedAt, proseEnabled, sessions });
  return {
    graphFile,
    counts: buildCounts(entities, { modules: modules.length, languages: perLang, commits: commits.length, proseEnabled, baseMs, historyMs }),
  };
}

// ── multi-repository indexing ────────────────────────────────────────────────
// n repos → ONE merged graph at <out_root>/.seonix/. Single-path mode above is
// untouched (no prefix, artifacts in the repo — golden-compat guarded by
// test/multi-repo.test.mjs). In multi mode every module id/label/dotted gets the
// repo's directory basename as a leading component, so ids never collide and a
// reader can tell repos apart. Cross-repo callsSymbol edges arise only where a
// symbol name resolves uniquely across the whole merged registry (the existing
// Set-semantics drop ambiguous names — nothing cross-repo-special is done).

/** Deterministic repo-name prefixes for a set of (resolved, deduped) repo paths:
 *  the directory basename; when two repos share a basename the FIRST in path sort
 *  order keeps the bare name and later ones get `-2`, `-3`, … appended. */
export function assignRepoPrefixes(repoPaths) {
  const map = new Map();
  const used = new Set();
  for (const rp of [...repoPaths].sort()) {
    const base = basename(rp) || rp;
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base}-${n}`;
    used.add(name);
    map.set(rp, name);
  }
  return map;
}

/** Prefix one repo's raw extraction in place: module path/dotted/imports, commit
 *  file lists and symbol-history range keys all gain the repo name as a leading
 *  component (`mod:<repoName>/<relpath>`, dotted `<repoName>.<dotted>`). Imports
 *  are prefixed IDENTICALLY to dotted names so intra-repo import resolution is
 *  unchanged and two repos' equal dotted names can never cross-resolve. Commit
 *  ids (shas) stay as-is — history edges point at the prefixed module ids. */
export function applyRepoPrefix({ modules, commits, symbolHistory }, prefix) {
  for (const m of modules) {
    m.path = `${prefix}/${m.path}`;
    if (m.dotted) m.dotted = `${prefix}.${m.dotted}`;
    if (m.imports?.length) m.imports = m.imports.map((i) => `${prefix}.${i}`);
  }
  for (const c of commits) c.files = (c.files || []).map((f) => `${prefix}/${f}`);
  for (const c of symbolHistory) {
    c.ranges = Object.fromEntries(Object.entries(c.ranges || {}).map(([p, r]) => [`${prefix}/${p}`, r]));
  }
}

/** Default merged-artifact root: the deepest common ancestor DIRECTORY of the repo
 *  paths (segment-wise, so /x/foo and /x/foobar meet at /x, not /x/foo). Falls back
 *  to `cwd` when the ancestor is the filesystem root. */
export function defaultOutRoot(repoPaths, cwd = process.cwd()) {
  const segs = repoPaths.map((p) => resolve(p).split(sep));
  const first = segs[0];
  let depth = Math.min(...segs.map((s) => s.length));
  let i = 0;
  while (i < depth && segs.every((s) => s[i] === first[i])) i += 1;
  const ancestor = first.slice(0, i).join(sep) || sep;
  return ancestor === parse(ancestor).root ? cwd : ancestor;
}

/** Discovery for the estate case: every immediate child directory of `multiRoot`
 *  that carries a `.git` (dir OR file — worktrees/submodules have .git files) is a
 *  repo. Dot-dirs are ignored outright; plain child dirs without .git are returned
 *  as `skipped` so the caller can log them. */
export async function discoverRepos(multiRoot) {
  const root = resolve(multiRoot);
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const repos = [];
  const skipped = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    try {
      await stat(join(root, e.name, ".git"));
      repos.push(join(root, e.name));
    } catch {
      skipped.push(e.name);
    }
  }
  return { repos, skipped };
}

/**
 * Index n repositories into ONE merged graph at <outRoot>/.seonix/. Repos are
 * extracted sequentially (only one repo's raw parser/git output held at a time;
 * the accumulated PARSED module list is small) and merged through a single
 * buildEntities pass, so the unique-name registry spans all repos.
 * `log` (optional) receives one progress line per repo.
 * @returns {Promise<{graphFile, outRoot, repos, counts}>}
 */
export async function indexRepositories(repoPaths, { python = DEFAULT_PYTHON(), generatedAt = "", ignores = true, outRoot = "", log = () => {} } = {}) {
  const paths = [...new Set((repoPaths || []).map((p) => resolve(p)))];
  if (!paths.length) throw new Error("indexRepositories requires at least one repo path");
  const proseEnabled = process.env.SEONIX_PROSE_INDEX !== "0";
  const prefixes = assignRepoPrefixes(paths);
  const root = outRoot ? resolve(outRoot) : defaultOutRoot(paths);

  const allModules = [];
  const allCommits = [];
  const allSymbolHistory = [];
  const languages = {};
  const repos = [];
  let baseMs = 0;
  let historyMs = 0;
  for (const rp of paths) {
    const prefix = prefixes.get(rp);
    const r = await extractRepo(rp, { python, ignores });
    applyRepoPrefix(r, prefix);
    allModules.push(...r.modules);
    allCommits.push(...r.commits);
    allSymbolHistory.push(...r.symbolHistory);
    baseMs += r.baseMs;
    historyMs += r.historyMs;
    for (const [lang, s] of Object.entries(r.perLang)) {
      const agg = languages[lang] || (languages[lang] = { lib: s.lib, files: 0, modules: 0, symbols: 0, failures: 0, ms: 0 });
      agg.files += s.files; agg.modules += s.modules; agg.symbols += s.symbols; agg.failures += s.failures; agg.ms += s.ms;
    }
    repos.push({ path: rp, prefix, modules: r.modules.length, commits: r.commits.length });
    log(`indexed ${prefix} (${rp}): ${r.modules.length} modules, ${r.commits.length} commits in ${r.baseMs + r.historyMs}ms`);
  }

  // TODO(sessions): multi-repo merges don't fold in the member repos' .seonix/sessions
  // yet — their recorded ids would need the same repo-name prefixing as modules to
  // re-resolve against the merged graph. Deferred; single-path fold-in is the contract.
  const { entities, graphFile } = await assembleAndWrite(root, {
    modules: allModules, commits: allCommits, symbolHistory: allSymbolHistory, generatedAt, proseEnabled,
  });
  return {
    graphFile,
    outRoot: root,
    repos,
    counts: buildCounts(entities, { modules: allModules.length, languages, commits: allCommits.length, proseEnabled, baseMs, historyMs }),
  };
}
