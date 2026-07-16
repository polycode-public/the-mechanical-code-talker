// The home page's footer names the version the page documents. Nothing here is
// hand-typed: scripts/build-demo-site.mjs rewrites it from package.json, and CI
// runs that build before it publishes public/, so the deployed page always
// agrees with the published package. The committed page carries whatever the
// last local build wrote, and this checks it has not fallen behind — a browser
// test already covers the same ground, but it needs a build and a browser,
// while a bump that skipped the build should fail here in milliseconds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { hasVersionStamp, parseVersionStamp } from "../../src/domain/version-stamp.mjs";

const INDEX = fileURLToPath(new URL("../../public/index.html", import.meta.url));
const PACKAGE = fileURLToPath(new URL("../../package.json", import.meta.url));

test("the home page carries the version stamp the build writes and the deploy smoke reads", () => {
  assert.ok(hasVersionStamp(readFileSync(INDEX, "utf8")), "the footer keeps a #pkg-version element to stamp");
});

test("the version the committed home page documents is the version the package ships", () => {
  const stamped = parseVersionStamp(readFileSync(INDEX, "utf8"));
  const { version } = JSON.parse(readFileSync(PACKAGE, "utf8"));
  assert.equal(stamped, version, `the page documents ${stamped}, the package ships ${version} — run \`npm run demo:build\``);
});
