// module-paths: the one predicate that decides whether a module path is test code.
// Both the graph builders (which edges become coverage edges) and the rankers (which
// modules get demoted below their production siblings) read it, so a path the naming
// conventions clearly mark as a test has to be claimed here or a test file can outrank
// the production sibling it tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestPath } from "../../src/domain/module-paths.mjs";

test("claims bare test/tests directories, python test_ files and .NET .Tests assemblies", () => {
  for (const p of [
    "test/widget.mjs",
    "app/tests/b.mjs",
    "tests/e2e/run.mjs",
    "pkg/test_app.py",
    "test_app.py",
    "acme.tests.dll",
    "acme.tests",
  ]) assert.equal(isTestPath(p), true, p);
});

test("matches case-sensitively, so a mixed-case path must be lowercased by its caller", () => {
  assert.equal(isTestPath("Acme.Tests.dll"), false);
  assert.equal(isTestPath("Acme.Tests.dll".toLowerCase()), true);
});

test("claims a hyphen or underscore prefixed test directory anywhere in the path", () => {
  for (const p of [
    "app/unit-tests/b.mjs",
    "behaviour-tests/login.mjs",
    "src/unit_test/helper.mjs",
    "pkg/integration-test/run.py",
    "behaviour-tests/helpers/gotowithretries.js",
  ]) assert.equal(isTestPath(p), true, p);
});

test("claims a .test or .spec file wherever it sits, not only under a test directory", () => {
  for (const p of [
    "app/unit-tests/b.test.mjs",
    "src/widget.test.js",
    "src/widget.spec.ts",
    "src/widget.test.tsx",
    "src/widget.spec.cjs",
    "timeout/index.test.ts",
  ]) assert.equal(isTestPath(p), true, p);
});

test("leaves production paths alone, including near-misses on the test vocabulary", () => {
  for (const p of [
    "src/widget.mjs",
    "timeout/index.ts",
    "app/lib/e.mjs",
    "src/latest/index.mjs",
    "src/contest/entry.mjs",
    "src/attest/sign.mjs",
    "src/testing.mjs",
    "src/protest.py",
    "docs/test.md",
    "src/widget.testing.mjs",
  ]) assert.equal(isTestPath(p), false, p);
});
