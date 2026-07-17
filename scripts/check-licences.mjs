#!/usr/bin/env node
// scripts/check-licences.mjs — assert the PRODUCTION dependency tree stays
// inside the licence allowlist. Walks `npm ls --omit=dev --all --json --long`
// and reads each installed package's own package.json `license` field (the
// npm-ls node's `path` tells us where it lives). Exits 1 with a listing of
// every package outside the allowlist. Peer/optional dependencies that are
// not installed have no node path and cannot ship, so they are skipped.
//
//   node scripts/check-licences.mjs

// The allowlist, the SPDX rule and the tree walk live in src/domain/licences.mjs,
// where they are unit-tested. This script is the disk half: run `npm ls`, read
// each package.json, report.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED, isAllowed, licenseFromPackageJson, installedPackages } from "../src/domain/licences.mjs";

function npmLsJson() {
  // npm ls exits non-zero on peer-dep noise while still printing the tree, so
  // capture stdout regardless of exit code.
  try {
    return execFileSync("npm", ["ls", "--omit=dev", "--all", "--json", "--long"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (err.stdout && String(err.stdout).trim().startsWith("{")) return String(err.stdout);
    throw err;
  }
}

const licenseOf = (pkgPath) =>
  licenseFromPackageJson(JSON.parse(readFileSync(join(pkgPath, "package.json"), "utf8")));

function main() {
  const tree = JSON.parse(npmLsJson());
  const packages = installedPackages(tree.dependencies);

  const violations = [];
  const counts = new Map();
  for (const { name, version, path } of packages) {
    const license = licenseOf(path);
    counts.set(license, (counts.get(license) ?? 0) + 1);
    if (!isAllowed(license)) violations.push({ name, version, license });
  }

  console.log(`checked ${packages.length} installed production packages`);
  for (const [license, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${license}`);
  }

  if (violations.length) {
    console.error(`\n${violations.length} package(s) outside the allowlist (${[...ALLOWED].join(", ")}):`);
    for (const v of violations) console.error(`  ${v.name}@${v.version}: ${v.license}`);
    process.exit(1);
  }
  console.log("licence check: OK — every production dependency is inside the allowlist");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
