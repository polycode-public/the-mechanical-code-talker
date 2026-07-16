import test from "node:test";
import assert from "node:assert/strict";

import { compareVersions, shouldPublish } from "../../src/domain/publish-gate.mjs";

test("a bumped version publishes", () => {
  const { publish, reason } = shouldPublish("2.2.0", "2.1.0");
  assert.equal(publish, true);
  assert.match(reason, /publishing 2\.2\.0/);
});

test("the same version does not publish — the push carried no bump", () => {
  const { publish, reason } = shouldPublish("2.2.0", "2.2.0");
  assert.equal(publish, false);
  assert.match(reason, /no version bump/);
});

test("a version behind the registry does not publish — the case string equality missed", () => {
  // `[ "$PUBLISHED" = "$LOCAL" ]` calls this 'different' and publishes, and the
  // registry then rejects it. A revert or a stale branch lands exactly here.
  const { publish, reason } = shouldPublish("2.0.3", "2.2.0");
  assert.equal(publish, false);
  assert.match(reason, /BEHIND/);
});

test("a first publish goes ahead when npm has nothing", () => {
  assert.equal(shouldPublish("0.1.0", "none").publish, true);
  assert.equal(shouldPublish("0.1.0", "").publish, true);
  assert.equal(shouldPublish("0.1.0", null).publish, true);
});

test("ordering is numeric, not lexical — 2.10.0 is ahead of 2.9.0", () => {
  assert.equal(shouldPublish("2.10.0", "2.9.0").publish, true);
  assert.equal(shouldPublish("2.9.0", "2.10.0").publish, false);
});

test("a major bump publishes; a major revert does not", () => {
  assert.equal(shouldPublish("3.0.0", "2.9.9").publish, true);
  assert.equal(shouldPublish("2.9.9", "3.0.0").publish, false);
});

test("compareVersions orders release cores", () => {
  assert.equal(compareVersions("2.2.0", "2.1.0"), 1);
  assert.equal(compareVersions("2.1.0", "2.2.0"), -1);
  assert.equal(compareVersions("2.2.0", "2.2.0"), 0);
});

test("a pre-release is the same release as its core — the gate decides releases", () => {
  assert.equal(compareVersions("2.2.0-rc.1", "2.2.0"), 0);
  assert.equal(shouldPublish("2.2.0-rc.1", "2.2.0").publish, false);
});

test("a version that is not a version is an error, not a guess", () => {
  assert.throws(() => shouldPublish("banana", "2.2.0"), /not a publishable version/);
  assert.throws(() => compareVersions("2.2.0", "banana"), /not a comparable version/);
});

test("the repo's own package.json version passes the gate against an older release", () => {
  assert.equal(shouldPublish("2.2.0", "2.1.0").publish, true);
});
