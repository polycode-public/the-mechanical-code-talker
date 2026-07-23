// The deterministic, offline code-graph PRODUCER. Walks a repo, runs the
// registered language extractors, reads git history, and assembles the typed
// `entities` payload via graph-build.mjs's buildEntities() — the one write-path
// primitive tmct already had but never called against real source. Writes
// <repo>/.tmct/graph.json, the artifact the provider seam (source.mjs) reads.
//
// ZERO model calls: CPU-bound static parsing + git only. This is the write side
// of the reader/producer boundary source.mjs documents — source.mjs READS a
// graph, this module PRODUCES one; they are deliberately separate modules.

import { spawn } from "node:child_process";
import { writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildEntities } from "../adapters/graph-build.mjs";
import { ingestSchemaDocs } from "../tools/schema-docs.mjs";
import { loadIgnores, relPath } from "./walk.mjs";
import { ingestRepo, LANG_EXTS } from "./registry.mjs";

// Every file extension the index covers — gates the git-log file filters so
// history is collected for exactly the languages the extractors parsed.
const INDEXED_EXTS = new Set(LANG_EXTS);
const isIndexedFile = (f) => {
  const dot = f.lastIndexOf(".");
  return dot >= 0 && INDEXED_EXTS.has(f.slice(dot).toLowerCase());
};

const GIT_LOG_COMMITS = 300;      // module-level history depth (cheap; name-only)
const HISTORY_SYMBOL_DEPTH = 120; // symbol-level line-range pass depth (the costly one)
// Git history is the one place this producer shells an unbounded command over
// arbitrary repo history, so it gets a hard wall-clock timeout: a wedged or
// pathological `git log` can never hang an index.
const GIT_TIMEOUT_MS = 300_000;

function gitDepth(env = process.env) {
  const n = Number(env.TMCT_GIT_DEPTH);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : GIT_LOG_COMMITS;
}
function historySymbolDepth(env = process.env) {
  const raw = env.TMCT_HISTORY_SYMBOL_DEPTH;
  if (raw === undefined || raw === "") return HISTORY_SYMBOL_DEPTH;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : HISTORY_SYMBOL_DEPTH;
}

/** spawn, collect stdout; resolve {code, stdout, stderr, timedOut, truncated}
 *  (never reject). `timeout` (ms, >0) arms a SIGKILL wall-clock; `truncated` is set
 *  when stdout exceeded maxBuffer (dropped bytes → an incomplete result the caller
 *  must NOT treat as authoritative). */
export function exec(cmd, args, { cwd, maxBuffer = 512 * 1024 * 1024, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    let size = 0;
    let truncated = false;
    let timedOut = false;
    const timer = timeout > 0 ? setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeout) : null;
    child.stdout?.on("data", (d) => { size += d.length; if (size <= maxBuffer) stdout += d; else truncated = true; });
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        resolve({ code: -1, stdout, stderr: stderr + `timed out after ${Math.round(timeout / 1000)}s`, timedOut: true, truncated });
      } else {
        resolve({ code: code ?? -1, stdout, stderr, timedOut: false, truncated });
      }
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut, truncated });
    });
  });
}

/** A one-line failure reason for a git-history exec, or null on clean success.
 *  Partial parseable output is ALWAYS kept by the caller — this only records WHY
 *  the result may be incomplete, so an index never silently loses history edges
 *  without saying so. */
function gitPassError({ code, stderr, timedOut, truncated }) {
  if (timedOut) return "timed out after 300s";
  if (code !== 0) {
    const tail = String(stderr || "").trim().split("\n").pop()?.slice(-200) || "";
    return `git exited ${code}${tail ? `: ${tail}` : ""}`;
  }
  if (truncated) return "output truncated — history incomplete";
  return null;
}

/** git log → {commits:[{sha, author, date, subject, files[]}], error}. Header
 *  record fields are \x1e-separated; commits are \x1f-separated. */
async function runGitLog(repoPath, depth = gitDepth()) {
  const res = await exec("git",
    ["log", "-n", String(depth), "--no-renames", "--name-only",
      "--pretty=format:%x1f%H%x1e%an%x1e%aI%x1e%s"],
    { cwd: repoPath, timeout: GIT_TIMEOUT_MS });
  const out = [];
  for (const chunk of res.stdout.split("\x1f")) {
    const nl = chunk.indexOf("\n");
    const header = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    if (!header) continue;
    const [sha, author = "", date = "", subject = ""] = header.split("\x1e");
    if (!sha) continue;
    const files = (nl === -1 ? "" : chunk.slice(nl + 1))
      .split("\n").map((l) => l.trim()).filter(isIndexedFile);
    out.push({ sha: sha.trim(), author, date, subject, files });
  }
  return { commits: out, error: gitPassError(res) };
}

/** git log -p --unified=0 → {hunks:[{sha, ranges:{path:[[start,end],…]}}], error}.
 *  Parses the NEW-side hunk header (`+c,d`) into the changed line range; the
 *  assembly step intersects those with current symbol spans. Depth 0 → no pass. */
async function runGitLogHunks(repoPath, depth = historySymbolDepth()) {
  if (!depth) return { hunks: [], error: null };
  const res = await exec("git",
    ["log", "-n", String(depth), "--no-renames", "--no-color", "--unified=0",
      "--pretty=format:%x1f%H"],
    { cwd: repoPath, timeout: GIT_TIMEOUT_MS });
  const out = [];
  let cur = null;
  let file = null;
  for (const line of res.stdout.split("\n")) {
    if (line.startsWith("\x1f")) {
      cur = { sha: line.slice(1).trim(), ranges: {} };
      if (cur.sha) out.push(cur); else cur = null;
      file = null;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("+++ ")) {
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
  return { hunks: out, error: gitPassError(res) };
}

/** One repo's raw extraction — parsers + git, NO graph assembly. `historyDepth`:
 *  undefined → defaults; 0 → skip both git passes; N>0 → cap both at N. */
export async function extractRepo(repoPath, { ignores = true, historyDepth } = {}) {
  const ignore = ignores ? await loadIgnores(repoPath) : null;
  const skipHistory = historyDepth === 0;
  const nameDepth = historyDepth === undefined ? gitDepth() : historyDepth;
  const symbolDepth = historyDepth === undefined ? historySymbolDepth() : historyDepth;
  // A git-less repo is a first-class case — no `.git`, no history, silently.
  const hasGit = skipHistory ? false : await stat(join(repoPath, ".git")).then(() => true).catch(() => false);

  const gitErrors = [];
  const [langResult, gitLog] = await Promise.all([
    ingestRepo(repoPath, { ignore }),
    hasGit ? runGitLog(repoPath, nameDepth) : Promise.resolve({ commits: [], error: null }),
  ]);
  if (gitLog.error) gitErrors.push({ pass: "name-only", message: gitLog.error });

  const runSymbol = hasGit && symbolDepth > 0;
  const hunks = runSymbol ? await runGitLogHunks(repoPath, symbolDepth) : { hunks: [], error: null };
  if (hunks.error) gitErrors.push({ pass: "symbol-hunk", message: hunks.error });

  return {
    modules: langResult.modules, perLang: langResult.perLang, failures: langResult.failures,
    commits: gitLog.commits, symbolHistory: hunks.hunks, gitErrors,
    historyDepth: { name: hasGit ? nameDepth : 0, symbol: runSymbol ? symbolDepth : 0 },
  };
}

/** Assemble the entities payload from a raw extraction. Runs ingestSchemaDocs so
 *  the written artifact is the writer-ingested form (the same convention the
 *  committed fixtures carry — schema self-docs are baked in at produce time). */
export function assembleEntities({ modules, commits = [], symbolHistory = [], generatedAt = "", prose = true }) {
  const entities = buildEntities(modules, commits, { generatedAt, symbolHistory, prose });
  ingestSchemaDocs(entities);
  return entities;
}

/** Index a repo end to end: extract + assemble + write <repo>/.tmct/graph.json.
 *  Returns {graphFile, bytes, modules, symbols, perLang, gitErrors, historyDepth}. */
export async function indexRepository(repoPath, { ignores = true, historyDepth, prose = true, generatedAt } = {}) {
  const raw = await extractRepo(repoPath, { ignores, historyDepth });
  const entities = assembleEntities({
    modules: raw.modules, commits: raw.commits, symbolHistory: raw.symbolHistory,
    generatedAt: generatedAt ?? new Date().toISOString(), prose,
  });
  const graphFile = join(repoPath, ".tmct", "graph.json");
  await mkdir(dirname(graphFile), { recursive: true });
  const payload = JSON.stringify(entities);
  await writeFile(graphFile, payload);
  const symbols = raw.modules.reduce((n, m) => n + (m.defines?.length || 0), 0);
  return {
    graphFile, bytes: payload.length, modules: raw.modules.length, symbols,
    perLang: raw.perLang, failures: raw.failures, gitErrors: raw.gitErrors, historyDepth: raw.historyDepth,
  };
}

export { relPath };
