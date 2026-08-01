#!/usr/bin/env node
// scripts/detect-playwright-version.mjs — read the resolved playwright
// version straight from package-lock.json (the exact pinned version, not a
// devDependencies range) and write it as a dotenv line CI can load into a
// downstream job's variables. That's what lets the Playwright-maintained CI
// image tag (mcr.microsoft.com/playwright:v<version>-noble) track
// package.json's own playwright version automatically -- bump the dependency,
// the next pipeline picks up the matching image on its own, nothing in
// .gitlab-ci.yml to remember to edit by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockfile = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const version = lockfile.packages?.["node_modules/playwright"]?.version;

if (!version) {
  console.error("detect-playwright-version: no node_modules/playwright entry in package-lock.json");
  process.exit(1);
}

const outFile = process.argv[2] ?? join(ROOT, "playwright-version.env");
writeFileSync(outFile, `PLAYWRIGHT_VERSION=${version}\n`);
console.log(`detect-playwright-version: ${version} -> ${outFile}`);
