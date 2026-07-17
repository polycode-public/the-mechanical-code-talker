// Enumerate the repo's git-tracked files, optionally filtered by a git
// pathspec, via `git ls-files -z`. Node builtins + git only, no bare specifier:
// the pii and links CI jobs import this and run without npm ci.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function trackedFiles(pattern) {
  const args = ["ls-files", "-z"];
  if (pattern) args.push(pattern);
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}
