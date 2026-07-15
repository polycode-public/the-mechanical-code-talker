#!/usr/bin/env node
// Compare two lcov files and report the lines the first covers that the
// second does not, per source file. Gates deleting a legacy test file: it may
// only go once the replacement estate covers everything it covered.
//
//   node scripts/coverage-compare.mjs <legacy.info> <new.info> [--scope dir ...]
//
// --scope limits the report to files under the given directories (repeatable).
// Exits 1 when any legacy-only covered line remains in scope, 0 when clean.
import fs from "node:fs";
import path from "node:path";

function usage(message) {
  console.error(message);
  console.error("usage: node scripts/coverage-compare.mjs <legacy.info> <new.info> [--scope dir ...]");
  process.exit(2);
}

const positional = [];
const scopes = [];
{
  const args = process.argv.slice(2);
  let inScope = false;
  for (const arg of args) {
    if (arg === "--scope") inScope = true;
    else if (arg.startsWith("--")) usage(`unknown flag: ${arg}`);
    else if (inScope) scopes.push(arg);
    else positional.push(arg);
  }
}
if (positional.length !== 2) usage("expected exactly two lcov files");
const [legacyFile, newFile] = positional;

/** Parse an lcov file into Map<sourcePath, Set<coveredLineNumber>>. Multiple
 *  records for the same source file merge: a line counts as covered when any
 *  record saw it executed. */
function parseLcov(file) {
  const covered = new Map();
  let current = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("SF:")) {
      const source = normalise(line.slice(3).trim());
      if (!covered.has(source)) covered.set(source, new Set());
      current = covered.get(source);
    } else if (line.startsWith("DA:") && current) {
      const [lineNo, hits] = line.slice(3).split(",");
      if (Number(hits) > 0) current.add(Number(lineNo));
    } else if (line.startsWith("end_of_record")) {
      current = null;
    }
  }
  return covered;
}

function normalise(sourcePath) {
  const abs = path.resolve(sourcePath);
  const rel = path.relative(process.cwd(), abs);
  return rel.startsWith("..") ? abs : rel;
}

function inScope(sourcePath) {
  if (scopes.length === 0) return true;
  return scopes.some((dir) => {
    const prefix = normalise(dir).replace(/\/+$/, "") + path.sep;
    return sourcePath === prefix.slice(0, -1) || sourcePath.startsWith(prefix);
  });
}

/** Collapse sorted line numbers into "12-18, 24, 30-31". */
function ranges(lines) {
  const sorted = [...lines].sort((a, b) => a - b);
  const parts = [];
  let start = null;
  let prev = null;
  for (const n of sorted) {
    if (start === null) { start = prev = n; continue; }
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  if (start !== null) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(", ");
}

const legacy = parseLcov(legacyFile);
const fresh = parseLcov(newFile);

let dirty = false;
for (const [source, legacyLines] of [...legacy.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  if (!inScope(source)) continue;
  const freshLines = fresh.get(source) ?? new Set();
  const legacyOnly = [...legacyLines].filter((n) => !freshLines.has(n));
  if (legacyOnly.length === 0) continue;
  dirty = true;
  console.log(source);
  console.log(`  legacy-only covered lines: ${ranges(legacyOnly)}`);
}

if (!dirty) console.log("no legacy-only covered lines" + (scopes.length ? ` in scope: ${scopes.join(", ")}` : ""));
process.exit(dirty ? 1 : 0);
