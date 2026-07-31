import test from "node:test";
import assert from "node:assert/strict";

import {
  hasCommitStamp,
  hasVersionStamp,
  parseCommitStamp,
  parseVersionStamp,
  shortCommit,
  stampCommit,
  stampVersion,
} from "../../src/domain/version-stamp.mjs";

const page = (inner) => `<footer><span id="pkg-version">${inner}</span></footer>`;
const commitPage = (inner) => `<footer><span id="pkg-commit" hidden>${inner}</span></footer>`;
const SHA = "0f4a91c2be77d3610ab5cc9e2244fd0187a63b5c";

test("stampVersion writes a version the reader gets back — the round trip the deploy relies on", () => {
  assert.equal(parseVersionStamp(stampVersion(page("0.0.0"), "2.2.0")), "2.2.0");
});

test("stampVersion replaces whatever the element held", () => {
  assert.match(stampVersion(page("1.7.3"), "2.2.0"), />2\.2\.0</);
});

test("parseVersionStamp reads a v-prefixed stamp", () => {
  assert.equal(parseVersionStamp(page("v2.2.0")), "2.2.0");
});

test("parseVersionStamp tolerates whitespace around the value", () => {
  assert.equal(parseVersionStamp(page("\n  2.2.0\n")), "2.2.0");
});

test("parseVersionStamp reads through other attributes on the element", () => {
  assert.equal(parseVersionStamp('<span class="foot" id="pkg-version" data-x="1">2.2.0</span>'), "2.2.0");
});

test("parseVersionStamp returns null when the element is missing", () => {
  assert.equal(parseVersionStamp("<footer>no stamp here</footer>"), null);
});

test("parseVersionStamp returns null for a placeholder that is not a version", () => {
  assert.equal(parseVersionStamp(page("{{VERSION}}")), null);
});

test("parseVersionStamp returns null for an empty, unstamped element", () => {
  assert.equal(parseVersionStamp(page("")), null);
});

test("the writer cannot emit a stamp the reader rejects — the drift that made this module", () => {
  // build-demo-site matched [^<]*, post-deploy-smoke demanded \d+\.\d+\.\d+.
  // A non-semver could be written and would then fail the deploy check.
  assert.throws(() => stampVersion(page("0.0.0"), "2.2.0-beta"), /not a stampable version/);
  assert.throws(() => stampVersion(page("0.0.0"), "banana"), /not a stampable version/);
});

test("stampVersion throws rather than publishing a page with no stamp", () => {
  assert.throws(() => stampVersion("<footer>gone</footer>", "2.2.0"), /no #pkg-version element/);
});

test("hasVersionStamp finds the element regardless of its contents", () => {
  assert.equal(hasVersionStamp(page("")), true);
  assert.equal(hasVersionStamp("<footer></footer>"), false);
});

test("the real committed home page carries a stamp this module can read", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  assert.equal(parseVersionStamp(html), JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version);
});

test("shortCommit takes twelve characters of a full object name, lowercased", () => {
  assert.equal(shortCommit(SHA), "0f4a91c2be77");
  assert.equal(shortCommit(SHA.toUpperCase()), "0f4a91c2be77");
  assert.equal(shortCommit("  0f4a91c2be77  "), "0f4a91c2be77");
});

test("stampCommit writes a commit the reader gets back — the round trip the readiness poll relies on", () => {
  assert.equal(parseCommitStamp(stampCommit(commitPage("local"), SHA)), "0f4a91c2be77");
});

test("stampCommit replaces whatever the element held", () => {
  assert.match(stampCommit(commitPage("aaaaaaaaaaaa"), SHA), />0f4a91c2be77</);
});

test("parseCommitStamp returns null for the committed placeholder, so a local build is not mistaken for a deployed one", () => {
  assert.equal(parseCommitStamp(commitPage("local")), null);
  assert.equal(parseCommitStamp(commitPage("")), null);
});

test("parseCommitStamp returns null when the element is missing", () => {
  assert.equal(parseCommitStamp("<footer>no stamp here</footer>"), null);
});

test("parseCommitStamp rejects a value that is not a twelve-character object name", () => {
  assert.equal(parseCommitStamp(commitPage("0f4a91c2be7")), null);
  assert.equal(parseCommitStamp(commitPage(SHA)), null);
  assert.equal(parseCommitStamp(commitPage("zzzzzzzzzzzz")), null);
});

test("stampCommit throws rather than deploying a page whose build cannot be identified", () => {
  assert.throws(() => stampCommit("<footer>gone</footer>", SHA), /no #pkg-commit element/);
  assert.throws(() => stampCommit(commitPage("local"), "nope"), /not a stampable commit/);
  assert.throws(() => stampCommit(commitPage("local"), ""), /not a stampable commit/);
});

test("hasCommitStamp finds the element regardless of its contents", () => {
  assert.equal(hasCommitStamp(commitPage("")), true);
  assert.equal(hasCommitStamp("<footer></footer>"), false);
});

test("the real committed home page carries a commit element the deploy can stamp", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  assert.ok(hasCommitStamp(html), "the footer keeps a #pkg-commit element for the deploy to write");
  assert.equal(parseCommitStamp(html), null, "the committed page cannot name the commit that adds it");
});
