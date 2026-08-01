import test from "node:test";
import assert from "node:assert/strict";

import { parseVersionFile, shortCommit, versionFileText } from "../../src/domain/version-stamp.mjs";

const SHA = "0f4a91c2be77d3610ab5cc9e2244fd0187a63b5c";
const STAMP = "2026-08-01T12:00:00.000Z";

test("versionFileText writes what parseVersionFile reads back — the round trip the deploy relies on", () => {
  const text = versionFileText({ version: "2.2.0", commit: SHA, timestamp: STAMP });
  assert.deepEqual(parseVersionFile(text), { version: "2.2.0", commit: "0f4a91c2be77", timestamp: STAMP });
});

test("versionFileText leaves the commit line empty when no commit is given — the local-build case", () => {
  const text = versionFileText({ version: "2.2.0", timestamp: STAMP });
  assert.equal(text, "2.2.0\n\n2026-08-01T12:00:00.000Z\n");
  assert.deepEqual(parseVersionFile(text), { version: "2.2.0", commit: null, timestamp: STAMP });
});

test("versionFileText throws rather than writing a non-semver version", () => {
  assert.throws(() => versionFileText({ version: "2.2.0-beta", timestamp: STAMP }), /not a stampable version/);
  assert.throws(() => versionFileText({ version: "banana", timestamp: STAMP }), /not a stampable version/);
});

test("versionFileText throws rather than writing a commit that isn't a real object name", () => {
  assert.throws(() => versionFileText({ version: "2.2.0", commit: "nope", timestamp: STAMP }), /not a stampable commit/);
});

test("parseVersionFile returns null fields for text with no lines at all", () => {
  assert.deepEqual(parseVersionFile(""), { version: null, commit: null, timestamp: null });
});

test("parseVersionFile returns null version for a line that isn't a semver core", () => {
  assert.equal(parseVersionFile("banana\n\n" + STAMP).version, null);
  assert.equal(parseVersionFile("2.2.0-beta\n\n" + STAMP).version, null);
});

test("parseVersionFile returns null commit for an empty or malformed commit line", () => {
  assert.equal(parseVersionFile("2.2.0\n\n" + STAMP).commit, null);
  assert.equal(parseVersionFile("2.2.0\nnothex\n" + STAMP).commit, null);
  assert.equal(parseVersionFile(`2.2.0\n${SHA}\n${STAMP}`).commit, null, "a full sha, not the short form, is not a match");
});

test("parseVersionFile lowercases a commit line", () => {
  assert.equal(parseVersionFile("2.2.0\n0F4A91C2BE77\n" + STAMP).commit, "0f4a91c2be77");
});

test("parseVersionFile tolerates whitespace around each line", () => {
  assert.deepEqual(parseVersionFile("  2.2.0  \n  0f4a91c2be77  \n  " + STAMP + "  "), {
    version: "2.2.0",
    commit: "0f4a91c2be77",
    timestamp: STAMP,
  });
});

test("shortCommit takes twelve characters of a full object name, lowercased", () => {
  assert.equal(shortCommit(SHA), "0f4a91c2be77");
  assert.equal(shortCommit(SHA.toUpperCase()), "0f4a91c2be77");
  assert.equal(shortCommit("  0f4a91c2be77  "), "0f4a91c2be77");
});
