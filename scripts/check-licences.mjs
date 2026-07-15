#!/usr/bin/env node
// scripts/check-licences.mjs — assert the PRODUCTION dependency tree stays
// inside the licence allowlist. Walks `npm ls --omit=dev --all --json --long`
// and reads each installed package's own package.json `license` field (the
// npm-ls node's `path` tells us where it lives). Exits 1 with a listing of
// every package outside the allowlist. Peer/optional dependencies that are
// not installed have no node path and cannot ship, so they are skipped.
//
//   node scripts/check-licences.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "MPL-2.0",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
]);

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

function licenseOf(pkgPath) {
  const pkg = JSON.parse(readFileSync(join(pkgPath, "package.json"), "utf8"));
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type; // legacy object form
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(" OR "); // legacy array form
  return "(none declared)";
}

// A flat SPDX expression like "(MIT OR CC0-1.0)" is fine when the choice it
// offers includes an allowlisted licence (OR lets the consumer pick); an AND
// expression needs every part allowlisted. Nested expressions and WITH
// exceptions are rare enough to just fail and review by hand.
function isAllowed(license) {
  if (ALLOWED.has(license)) return true;
  const inner = license.replace(/^\(/, "").replace(/\)$/, "");
  if (/[()]|\bWITH\b/.test(inner)) return false;
  if (inner.includes(" OR ") && !inner.includes(" AND ")) {
    return inner.split(" OR ").some((part) => ALLOWED.has(part.trim()));
  }
  if (inner.includes(" AND ") && !inner.includes(" OR ")) {
    return inner.split(" AND ").every((part) => ALLOWED.has(part.trim()));
  }
  return false;
}

const tree = JSON.parse(npmLsJson());
const seen = new Map(); // "name@version" -> { name, version, path }
(function walk(deps) {
  for (const [name, node] of Object.entries(deps ?? {})) {
    if (node && node.path && node.version) {
      seen.set(`${name}@${node.version}`, { name, version: node.version, path: node.path });
    }
    if (node) walk(node.dependencies);
  }
})(tree.dependencies);

const violations = [];
const counts = new Map();
for (const { name, version, path } of [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const license = licenseOf(path);
  counts.set(license, (counts.get(license) ?? 0) + 1);
  if (!isAllowed(license)) violations.push({ name, version, license });
}

console.log(`checked ${seen.size} installed production packages`);
for (const [license, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${license}`);
}

if (violations.length) {
  console.error(`\n${violations.length} package(s) outside the allowlist (${[...ALLOWED].join(", ")}):`);
  for (const v of violations) console.error(`  ${v.name}@${v.version}: ${v.license}`);
  process.exit(1);
}
console.log("licence check: OK — every production dependency is inside the allowlist");
