// licences.mjs — the allowlist, the SPDX expression rule, and the two pure
// reads the licence check needs. Pure: objects and strings in, verdicts out, so
// the rule that gates CI can be tested without an installed node_modules tree.
//
// The check itself (scripts/check-licences.mjs) shells out to `npm ls` and
// reads each package's package.json off disk. That is the disk half. This is
// the deciding half, and the deciding half is where the edge cases are.

export const ALLOWED = new Set([
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

/** The licence `pkg` declares, across the three shapes npm has used: the
 *  current string, the legacy `{ type }` object, and the legacy `licenses[]`
 *  array (read as a choice, so it joins with OR). */
export function licenseFromPackageJson(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(" OR ");
  return "(none declared)";
}

/** True iff `license` is inside the allowlist.
 *
 *  A flat OR expression passes when any part is allowlisted, because OR is a
 *  choice and we can take the allowlisted one. A flat AND expression needs
 *  every part. Everything else — nesting, a WITH exception, an OR and an AND in
 *  the same expression, even a redundantly parenthesised single licence like
 *  "(MIT)" — returns false and gets reviewed by hand. Those are rare enough
 *  that a parser would be more code than the reviews it saves, and false is the
 *  safe direction: it stops CI and asks a human, rather than waving through an
 *  expression it only half understood. */
export function isAllowed(license) {
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

/** Every installed package in an `npm ls --json` dependency tree, deduped by
 *  name@version and sorted by name. A node with no `path` is a peer or optional
 *  dependency that was never installed, so it cannot ship and is skipped. */
export function installedPackages(deps) {
  const seen = new Map();
  (function walk(level) {
    for (const [name, node] of Object.entries(level ?? {})) {
      if (node && node.path && node.version) {
        seen.set(`${name}@${node.version}`, { name, version: node.version, path: node.path });
      }
      if (node) walk(node.dependencies);
    }
  })(deps);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
