// One-shot codemod that relocates src/ modules into their layer directory and
// repairs every reference to them. Pure renames: it moves files with `git mv`
// and rewrites paths, never logic.
//
// Usage:
//   node scripts/codemod-moves.mjs --layer adapters [--dry-run]
//
// Run one layer at a time. The move table (scripts/move-table.json, generated
// from test/estate/layer-map.mjs) is the whole plan; this script executes only
// the rows whose layer matches, so each run leaves the tree consistent.
//
// References it repairs, beyond relative import specifiers:
//   - package.json "main" and "exports" targets;
//   - the esbuild entry/outfile arguments in scripts/build-ask-bundle.mjs and
//     the engine copy list in scripts/build-demo-site.mjs, both of which name
//     modules by their src-relative path;
//   - "./engine/src/..." imports in the demo site's browser modules;
//   - joined path literals — join(ROOT, "src", "adapters", "corpus", "conceptnet-map.toml");
//   - upward data-path walks a module anchors on its own import.meta.url, which
//     gain the directory level the move adds;
//   - test/estate/layer-map.mjs's own keys, so the checker tracks each layer;
//   - "src/..." mentions anywhere else, in code, comments and manifests.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");

// Every tree that may name a src/ module. Fixture and example repositories are
// excluded on purpose: their graph.json files describe the toy codebases tmct
// analyses, so their own "src/..." strings mean a different src entirely.
const SCAN_DIRS = ["src", "test", "e2e", "scripts", "bin", "chatbench", "agentbench", "infbench", "synthbench", "demo", "public", "examples", "corpus", "docs"];
const SCAN_EXTENSIONS = [".mjs", ".js", ".json", ".html", ".md"];
const SKIP_DIRS = new Set(["node_modules", ".git", "fixtures", "engine", ".tmct"]);
const SKIP_FILES = new Set(["move-table.json", "memory-ask-browser.bundle.js"]);

// archive/, playtests/ and the BENCHMARK_* write-ups record what a shipped
// version did, against the paths it had. They are measurements, so they keep
// the paths they were written with.
const HISTORICAL_ROOT_DOCS = /^(BENCHMARK_|EXAMPLE_PLAYTEST_LOG)/;

// Files that name src modules by their src-relative path, with no "src/" prefix
// to anchor on: the layer map's keys, and the two build scripts' entry lists.
const BARE_PATH_FILES = new Set([
  join(ROOT, "test", "estate", "layer-map.mjs"),
  join(ROOT, "scripts", "build-demo-site.mjs"),
  join(ROOT, "scripts", "build-ask-bundle.mjs"),
  join(ROOT, "test", "adapters", "ask-nlp.test.mjs"),
]);

const FROM_SPEC_RE = /\bfrom\s*(["'])(\.[^"'\n]*)\1/g;
const DYNAMIC_SPEC_RE = /\bimport\s*\(\s*(["'])(\.[^"'\n]*)\1\s*\)/g;
const BARE_SPEC_RE = /\bimport\s*(["'])(\.[^"'\n]*)\1/g;
const JOINED_SRC_RE = /(["'])src\1((?:\s*,\s*["'][^"'\n]+["'])+)/g;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const layer = args.includes("--layer") ? args[args.indexOf("--layer") + 1] : null;
if (!layer) {
  console.error("usage: node scripts/codemod-moves.mjs --layer <adapters|domain|services|tools|surfaces> [--dry-run]");
  process.exit(2);
}

const table = JSON.parse(readFileSync(join(HERE, "move-table.json"), "utf8"));
const layerMoves = table.filter((row) => row.layer === layer && row.moved);
if (!layerMoves.length) {
  console.error(`move table has no pending move for layer "${layer}"`);
  process.exit(2);
}

/** src-relative old path -> src-relative new path, for this layer only. */
const moveByRel = new Map(layerMoves.map((row) => [row.from, row.to]));
/** absolute old path -> absolute new path. */
const moveByAbs = new Map(layerMoves.map((row) => [join(SRC, row.from), join(SRC, row.to)]));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Directories that relocate intact, so mentions of them as a whole stay true. */
function directoryMoves() {
  const byDir = new Map();
  for (const row of table) {
    const slash = row.from.indexOf("/");
    if (slash < 0) continue;
    const dir = row.from.slice(0, slash);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(row);
  }
  const moves = [];
  for (const [dir, rows] of byDir) {
    // memory/ splits between domain logic and its store backends, so no single
    // destination is true for it as a whole; such mentions are left alone.
    if (new Set(rows.map((r) => r.layer)).size !== 1 || rows[0].layer !== layer) continue;
    if (!rows.every((r) => r.to === `${layer}/${r.from}`)) continue;
    moves.push([`${dir}/`, `${layer}/${dir}/`]);
  }
  return moves;
}
const DIR_MOVES = directoryMoves();

function* walkDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkDir(full);
    else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) yield full;
  }
}

function* scanFiles() {
  yield join(ROOT, "package.json");
  yield join(ROOT, ".gitlab-ci.yml");
  for (const entry of readdirSync(ROOT, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && entry.name.endsWith(".md") && !HISTORICAL_ROOT_DOCS.test(entry.name)) yield join(ROOT, entry.name);
  }
  for (const top of SCAN_DIRS) {
    const dir = join(ROOT, top);
    if (existsSync(dir)) yield* walkDir(dir);
  }
}

function relativeSpecifier(fromDir, toAbs) {
  const spec = relative(fromDir, toAbs).split("\\").join("/");
  return spec.startsWith(".") ? spec : `./${spec}`;
}

/** Re-point one relative specifier, resolved from its importer's old location. */
function rewriteSpecifier(spec, importerOldPath, importerNewPath) {
  const targetOld = resolve(dirname(importerOldPath), spec);
  const targetNew = moveByAbs.get(targetOld) ?? targetOld;
  if (targetNew === targetOld && importerOldPath === importerNewPath) return spec;
  return relativeSpecifier(dirname(importerNewPath), targetNew);
}

function rewriteImports(text, oldPath, newPath) {
  let out = text;
  for (const re of [FROM_SPEC_RE, DYNAMIC_SPEC_RE, BARE_SPEC_RE]) {
    out = out.replace(re, (match, quote, spec) => {
      const next = rewriteSpecifier(spec, oldPath, newPath);
      return next === spec ? match : match.replace(`${quote}${spec}${quote}`, `${quote}${next}${quote}`);
    });
  }
  return out;
}

/** join(ROOT, "src", "adapters", "corpus", "conceptnet-map.toml") -> the module's new home. */
function rewriteJoinedPaths(text) {
  return text.replace(JOINED_SRC_RE, (match, quote, tail) => {
    const segments = [...tail.matchAll(/["']([^"'\n]+)["']/g)].map((m) => m[1]);
    const to = moveByRel.get(segments.join("/"));
    if (!to) return match;
    const rebuilt = to.split("/").map((s) => `${quote}${s}${quote}`).join(", ");
    return `${quote}src${quote}, ${rebuilt}`;
  });
}

/** join(srcDir, "interpret", "nlp-registry.mjs"), where srcDir already holds src/. */
function rewriteSrcDirJoins(text) {
  const anchors = [...text.matchAll(/const\s+(\w+)\s*=\s*join\([^)\n]*["']src["']\)\s*;/g)].map((m) => m[1]);
  let out = text;
  for (const anchor of anchors) {
    const re = new RegExp(`join\\(\\s*${anchor}\\s*,\\s*((?:["'][^"'\\n]+["']\\s*,\\s*)*["'][^"'\\n]+["'])\\s*\\)`, "g");
    out = out.replace(re, (match, tail) => {
      const segments = [...tail.matchAll(/["']([^"'\n]+)["']/g)].map((m) => m[1]);
      const to = moveByRel.get(segments.join("/"));
      if (!to) return match;
      return `join(${anchor}, ${to.split("/").map((s) => `"${s}"`).join(", ")})`;
    });
  }
  return out;
}

/** "src/ask.mjs" and "src/router/" wherever they appear as prose or a path. */
function rewriteTextualPaths(text) {
  let out = text;
  for (const [from, to] of moveByRel) {
    // Guard the tail so src/ask.mjs never matches inside src/ask-nlp.mjs.
    out = out.replace(new RegExp(`src/${escapeRe(from)}(?![A-Za-z0-9._-])`, "g"), `src/${to}`);
  }
  for (const [from, to] of DIR_MOVES) {
    out = out.replace(new RegExp(`src/${escapeRe(from)}`, "g"), `src/${to}`);
  }
  return out;
}

/** The demo site copies engine sources verbatim, so its layout mirrors src/. */
function rewriteEngineImports(text) {
  let out = text;
  for (const [from, to] of moveByRel) {
    out = out.replace(new RegExp(`(\\./engine/src/)${escapeRe(from)}(?![A-Za-z0-9._-])`, "g"), `$1${to}`);
  }
  return out;
}

const SELF_ANCHOR = "dirname(fileURLToPath(import.meta.url))";

/**
 * A module that reads a data file by walking up from its own location — the
 * corpus readers' PKG_ROOT, say — resolves that walk against its own depth
 * under src/. Moving it a directory deeper silently re-points every such path,
 * so each upward walk gains the level the move added.
 */
function rewriteSelfRelativePaths(text, from, to) {
  const depthChange = to.split("/").length - from.split("/").length;
  if (depthChange !== 1) throw new Error(`${from} -> ${to} changes depth by ${depthChange}; this rewrite handles one level`);
  let out = text;

  // join(dirname(fileURLToPath(import.meta.url)), "..", ...) — anchor and walk
  // in one expression, so the walk is patched where it is written.
  out = out.split(`${SELF_ANCHOR}, ".."`).join(`${SELF_ANCHOR}, "..", ".."`);

  // const HERE = dirname(fileURLToPath(import.meta.url)) — the anchor still
  // means "my directory" and stays true; its walking call sites are what move.
  for (const m of text.matchAll(new RegExp(`const\\s+(\\w+)\\s*=\\s*${escapeRe(SELF_ANCHOR)}\\s*;`, "g"))) {
    out = out.replace(new RegExp(`(join|resolve)\\(\\s*${m[1]},\\s*"\\.\\."`, "g"), (hit) => `${hit}, ".."`);
  }

  // new URL("../../package.json", import.meta.url)
  return out.replace(
    /new URL\((["'])(\.\.\/[^"'\n]*)\1,\s*import\.meta\.url\)/g,
    (_match, quote, rel) => `new URL(${quote}../${rel}${quote}, import.meta.url)`,
  );
}

/** Quoted src-relative paths carrying no "src/" prefix: layer-map keys, entry lists. */
function rewriteBarePaths(text) {
  let out = text;
  for (const [from, to] of moveByRel) {
    out = out.replace(new RegExp(`(["'])${escapeRe(from)}\\1`, "g"), `$1${to}$1`);
  }
  for (const [from, to] of DIR_MOVES) {
    out = out.replace(new RegExp(`(["'])${escapeRe(from)}\\1`, "g"), `$1${to}$1`);
  }
  return out;
}

const edits = new Map();
for (const file of scanFiles()) {
  const newPath = moveByAbs.get(file) ?? file;
  const original = readFileSync(file, "utf8");
  let next = original;

  // Bare names go first: once a whole path sits in one string literal, the
  // segment-wise join rewrites below leave it alone, so no path is rewritten
  // twice.
  if (BARE_PATH_FILES.has(file)) next = rewriteBarePaths(next);
  if (file.endsWith(".mjs") || file.endsWith(".js")) {
    next = rewriteImports(next, file, newPath);
    next = rewriteJoinedPaths(next);
    next = rewriteSrcDirJoins(next);
    const move = layerMoves.find((row) => join(SRC, row.from) === file);
    if (move) next = rewriteSelfRelativePaths(next, move.from, move.to);
  }
  next = rewriteTextualPaths(next);
  if (file.startsWith(join(ROOT, "public"))) next = rewriteEngineImports(next);

  if (next !== original || newPath !== file) edits.set(file, { newPath, text: next, changed: next !== original });
}

if (dryRun) {
  console.log(`[dry-run] layer "${layer}"\n\nmoves (${layerMoves.length}):`);
  for (const row of layerMoves) console.log(`  src/${row.from} -> src/${row.to}`);
  const touched = [...edits].filter(([, e]) => e.changed);
  console.log(`\nfiles whose references change (${touched.length}):`);
  for (const [path] of touched) console.log(`  ${relative(ROOT, path)}`);
  if (DIR_MOVES.length) {
    console.log("\ndirectory mentions rewritten:");
    for (const [from, to] of DIR_MOVES) console.log(`  src/${from} -> src/${to}`);
  }
  process.exit(0);
}

for (const row of layerMoves) {
  const to = join(SRC, row.to);
  mkdirSync(dirname(to), { recursive: true });
  execFileSync("git", ["mv", join(SRC, row.from), to], { cwd: ROOT });
}
for (const [, edit] of edits) {
  if (edit.changed) writeFileSync(edit.newPath, edit.text);
}

const rewritten = [...edits.values()].filter((e) => e.changed).length;
console.log(`layer "${layer}": moved ${layerMoves.length} files, rewrote references in ${rewritten} files`);
