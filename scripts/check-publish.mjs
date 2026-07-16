#!/usr/bin/env node
// scripts/check-publish.mjs — decide whether this commit should publish.
// The decision lives in src/domain/publish-gate.mjs, where it is unit tested;
// this is the thin caller CI runs. Prints the reason either way and exits 0 to
// publish, 1 to skip, so a shell `if` can branch on it.
//
//   npm run check:publish -- "$(npm view <pkg> version 2>/dev/null || echo none)"
//
// The registry lookup stays in the pipeline as a shell command: it is one
// `npm view` and shell is what that is for. Dependency-free (node builtins
// only), so it does not need npm ci.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { shouldPublish } from "../src/domain/publish-gate.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function decide(publishedArg) {
  const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  return shouldPublish(version, publishedArg ?? "none");
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { publish, reason } = decide(process.argv[2]);
  console.log(reason);
  process.exit(publish ? 0 : 1);
}
