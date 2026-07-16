import test from "node:test";
import assert from "node:assert/strict";

import { ALLOWED, isAllowed, licenseFromPackageJson, installedPackages } from "../../src/domain/licences.mjs";

test("an allowlisted licence passes", () => {
  assert.equal(isAllowed("MIT"), true);
  assert.equal(isAllowed("Apache-2.0"), true);
  assert.equal(isAllowed("0BSD"), true);
});

test("a copyleft licence outside the allowlist fails", () => {
  assert.equal(isAllowed("GPL-3.0"), false);
  assert.equal(isAllowed("AGPL-3.0"), false);
});

test("a package that declares no licence fails", () => {
  assert.equal(isAllowed("(none declared)"), false);
});

test("OR passes when any part is allowlisted — the consumer picks that one", () => {
  assert.equal(isAllowed("MIT OR Apache-2.0"), true);
  assert.equal(isAllowed("MIT OR GPL-3.0"), true);
});

test("OR fails when no part is allowlisted", () => {
  assert.equal(isAllowed("GPL-3.0 OR AGPL-3.0"), false);
});

test("a single outer pair of parens is stripped, so a wrapped OR still passes", () => {
  assert.equal(isAllowed("(MIT OR CC0-1.0)"), true);
});

test("AND needs every part allowlisted", () => {
  assert.equal(isAllowed("MIT AND ISC"), true);
  assert.equal(isAllowed("MIT AND GPL-3.0"), false);
});

// Everything below documents where the rule stops evaluating and hands the
// expression to a human. Each one fails CLOSED: the check exits 1 and asks,
// rather than waving through an expression it only half parsed.

test("a nested expression fails closed rather than being parsed", () => {
  assert.equal(isAllowed("(MIT OR Apache-2.0) AND ISC"), false);
  assert.equal(isAllowed("MIT OR (ISC AND GPL-3.0)"), false);
});

test("a WITH exception fails closed", () => {
  assert.equal(isAllowed("Apache-2.0 WITH LLVM-exception"), false);
});

test("an OR and an AND in one flat expression fails closed — precedence is not modelled", () => {
  assert.equal(isAllowed("MIT OR ISC AND GPL-3.0"), false);
});

test("a redundantly parenthesised single licence fails closed — the stripped inner is never re-checked", () => {
  assert.equal(isAllowed("(MIT)"), false);
});

test("a wrapped flat AND passes, because stripping the outer parens leaves a flat expression", () => {
  assert.equal(isAllowed("(MIT AND ISC)"), true);
});

test("the allowlist is matched exactly — no case folding, no trimming, no family match", () => {
  assert.equal(isAllowed("mit"), false);
  assert.equal(isAllowed("MIT "), false);
  assert.equal(isAllowed("BSD"), false);
});

test("licenseFromPackageJson reads the current string form", () => {
  assert.equal(licenseFromPackageJson({ license: "MIT" }), "MIT");
});

test("licenseFromPackageJson reads the legacy { type } object form", () => {
  assert.equal(licenseFromPackageJson({ license: { type: "ISC", url: "http://example.com" } }), "ISC");
});

test("licenseFromPackageJson reads the legacy licenses[] array as an OR choice", () => {
  assert.equal(
    licenseFromPackageJson({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }),
    "MIT OR Apache-2.0",
  );
});

test("a legacy licenses[] array of one yields a bare licence the allowlist matches", () => {
  assert.equal(isAllowed(licenseFromPackageJson({ licenses: [{ type: "MIT" }] })), true);
});

test("licenseFromPackageJson reports an undeclared licence rather than throwing", () => {
  assert.equal(licenseFromPackageJson({}), "(none declared)");
  assert.equal(licenseFromPackageJson({ license: null }), "(none declared)");
});

test("the string form wins over a stale legacy array in the same package.json", () => {
  assert.equal(licenseFromPackageJson({ license: "MIT", licenses: [{ type: "GPL-3.0" }] }), "MIT");
});

const tree = {
  a: {
    version: "1.0.0",
    path: "/n/a",
    dependencies: {
      b: { version: "2.0.0", path: "/n/a/node_modules/b" },
      c: { version: "3.0.0" },
    },
  },
  b: { version: "2.0.0", path: "/n/b" },
};

test("installedPackages flattens the whole tree, however deep", () => {
  assert.deepEqual(installedPackages(tree).map((p) => p.name), ["a", "b"]);
});

test("installedPackages dedupes one name@version reached by two paths", () => {
  assert.equal(installedPackages(tree).filter((p) => p.name === "b").length, 1);
});

test("installedPackages keeps two versions of the same name apart", () => {
  const names = installedPackages({
    b: { version: "2.0.0", path: "/n/b" },
    a: { version: "1.0.0", path: "/n/a", dependencies: { b: { version: "9.9.9", path: "/n/a/node_modules/b" } } },
  });
  assert.deepEqual(names.map((p) => `${p.name}@${p.version}`), ["a@1.0.0", "b@2.0.0", "b@9.9.9"]);
});

test("installedPackages skips a node with no path — an uninstalled peer cannot ship", () => {
  assert.deepEqual(installedPackages(tree).map((p) => p.name).includes("c"), false);
});

test("installedPackages sorts by name, so the report is stable", () => {
  const names = installedPackages({
    zebra: { version: "1.0.0", path: "/n/z" },
    apple: { version: "1.0.0", path: "/n/a" },
  }).map((p) => p.name);
  assert.deepEqual(names, ["apple", "zebra"]);
});

test("installedPackages tolerates a tree with no dependencies at all", () => {
  assert.deepEqual(installedPackages(undefined), []);
  assert.deepEqual(installedPackages({}), []);
});

test("every entry in the allowlist passes its own check", () => {
  for (const licence of ALLOWED) assert.equal(isAllowed(licence), true, licence);
});
