import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { releaseScope } from "../../scripts/release-scope.mjs";

test("a fresh minor or major is a full release", () => {
  assert.equal(releaseScope("4.2.0"), "full");
  assert.equal(releaseScope("5.0.0"), "full");
  assert.equal(releaseScope("0.1.0"), "full");
});

test("an ordinary patch roll is a patch release", () => {
  assert.equal(releaseScope("4.1.1"), "patch");
  assert.equal(releaseScope("4.1.17"), "patch");
});

test("anything that is not a plain three-part version reads as a patch, so the heavy tiers stand down rather than run on a guess", () => {
  assert.equal(releaseScope("4.1"), "patch");
  assert.equal(releaseScope("4.1.0-beta"), "patch");
  assert.equal(releaseScope("banana"), "patch");
  assert.equal(releaseScope(""), "patch");
  assert.equal(releaseScope(undefined), "patch");
});

test("the version the package actually ships resolves to a scope", () => {
  const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(releaseScope(version), /^(full|patch)$/);
});
