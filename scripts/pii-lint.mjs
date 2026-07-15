#!/usr/bin/env node
// scripts/pii-lint.mjs — scan every tracked text file for personally
// identifying leftovers: home-directory paths (/Users/<name>, /home/<name>,
// tilde-user areas like ~name/), email addresses, and — in the playtests/
// transcripts specifically — the author's personal name outside the intended
// public identity. Dependency-free (node builtins + git only) so CI can run
// it without npm ci. Exits 1 listing every finding not covered by
// scripts/pii-allowlist.json.
//
//   node scripts/pii-lint.mjs
//
// Pattern scope, chosen deliberately:
// - `~/foo` (bare home-relative) names no user, so it is NOT flagged;
//   `~name/` (a tilde USER area) is, except inside a URL path (academic
//   pages like …edu/~weld/ are public technical references, not PII).
// - The email regex is loose on purpose; false positives go in the
//   allowlist with a reason rather than into a looser regex.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// This linter, its allowlist and its test spell the patterns out and would
// always self-match.
const SELF_PATHS = new Set([
  "scripts/pii-lint.mjs",
  "scripts/pii-allowlist.json",
  "test/estate/pii.test.mjs",
]);

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "webp", "svgz",
  "gz", "zip", "tgz", "br",
  "sqlite", "db",
  "woff", "woff2", "ttf", "eot",
  "pdf", "mp3", "mp4", "wasm",
]);

export const CHECKS = [
  {
    kind: "home-directory path",
    regex: /(?:\/Users|\/home)\/[A-Za-z][A-Za-z0-9._-]*/g,
  },
  {
    kind: "tilde user area",
    // ~name/ at a path start; a preceding "/" means a URL path segment.
    regex: /(?<![/\w])~[A-Za-z][A-Za-z0-9._-]*\//g,
  },
  {
    kind: "email",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    kind: "personal name in a playtest transcript",
    regex: /\b(?:Antony|Anthony)\b(?:\s+[A-Z][a-z]+)?/g,
    onlyUnder: "playtests/",
  },
];

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, "scripts", "pii-allowlist.json"), "utf8"));
  return raw.entries.map((e) => e.match);
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

function looksBinary(path, buf) {
  const ext = path.split(".").pop().toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  return buf.subarray(0, 8000).includes(0);
}

export function scanText(text, path, allowlist) {
  const isAllowed = (hit) => allowlist.some((allowed) => hit.includes(allowed) || allowed.includes(hit));
  const findings = [];
  for (const { kind, regex, onlyUnder } of CHECKS) {
    if (onlyUnder && !path.startsWith(onlyUnder)) continue;
    for (const match of text.matchAll(regex)) {
      if (isAllowed(match[0])) continue;
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({ path, line, kind, hit: match[0] });
    }
  }
  return findings;
}

export function scanRepo() {
  const allowlist = loadAllowlist();
  const findings = [];
  for (const path of trackedFiles()) {
    if (SELF_PATHS.has(path)) continue;
    let buf;
    try {
      buf = readFileSync(join(REPO_ROOT, path));
    } catch {
      continue; // deleted in the working tree
    }
    if (looksBinary(path, buf)) continue;
    findings.push(...scanText(buf.toString("utf8"), path, allowlist));
  }
  return findings;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const findings = scanRepo();
  if (findings.length) {
    console.error(`${findings.length} PII finding(s) not covered by scripts/pii-allowlist.json:`);
    for (const f of findings) console.error(`  ${f.path}:${f.line}  [${f.kind}]  ${f.hit}`);
    console.error("\nScrub the file, or add an allowlist entry with a reason if the hit is a legitimate public identity/technical artefact.");
    process.exit(1);
  }
  console.log("pii lint: OK — no unallowlisted home paths, emails or personal names in tracked text files");
}
