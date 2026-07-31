#!/usr/bin/env node
// scripts/release-scope.mjs — prints "full" when package.json's version is a
// fresh minor or major (x.y.0) and "patch" otherwise, so the heaviest CI tiers
// can run every time on a release that changes the shape of the package and
// skip themselves on the ordinary patch rolls in between.
//
// The check reads package.json rather than the commit message, so a roll that
// worded its subject differently still gets the right scope.
//
// It has to run INSIDE the job rather than drive a `rules:` key, because
// GitLab evaluates rules when it CREATES the pipeline — before any job has
// run — so no value a job computes (dotenv artifact or otherwise) can reach
// another job's rules. The job therefore starts, prints why it is standing
// down, and exits 0 in a couple of seconds instead of several minutes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** "full" for a fresh minor/major (x.y.0), "patch" for anything else. */
export function releaseScope(version) {
  const patch = Number(String(version ?? "").split(".")[2]);
  return patch === 0 ? "full" : "patch";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  process.stdout.write(releaseScope(version));
}
