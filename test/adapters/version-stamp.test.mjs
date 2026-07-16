import test from "node:test";
import assert from "node:assert/strict";

import { hasVersionStamp, parseVersionStamp, stampVersion } from "../../src/domain/version-stamp.mjs";

const page = (inner) => `<footer><span id="pkg-version">${inner}</span></footer>`;

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
