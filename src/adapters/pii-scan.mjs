// Drive the PII detectors (src/domain/pii-rules.mjs) over every tracked text
// file in the repo. Node builtins + git only — no bare specifier — because
// scripts/pii-lint.mjs runs in CI without npm ci.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { looksBinary, scanText } from "../domain/pii-rules.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ALLOWLIST_FILE = join(REPO_ROOT, "scripts", "pii-allowlist.json");

// This linter, its rules, its allowlist and its test spell the patterns out and
// would always self-match.
const SELF_PATHS = new Set([
  "scripts/pii-lint.mjs",
  "scripts/pii-allowlist.json",
  "src/domain/pii-rules.mjs",
  "test/estate/pii.test.mjs",
]);

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8"));
  return raw.entries.map((e) => e.match);
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
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
