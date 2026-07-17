// Every relative markdown link in every tracked .md file must resolve to a
// real file or directory. scripts/check-links.mjs is the scanner; these tests
// run it over the real tree and pin the extraction rules.

import test from "node:test";
import assert from "node:assert/strict";
import { brokenLinks, relativeTargets } from "../../scripts/check-links.mjs";

test("no broken relative markdown links in tracked .md files", () => {
  const broken = brokenLinks();
  const listing = broken.map((b) => `${b.file}:${b.line} -> ${b.target}`).join("\n");
  assert.equal(broken.length, 0, `broken relative links:\n${listing}`);
});

test("relative targets are extracted from inline links, images and reference definitions", () => {
  const markdown = [
    "see [the guide](guide.md#phases) and ![a chart](img/chart.png)",
    "[spec]: ../docs/spec.md",
  ].join("\n");
  assert.deepEqual(
    relativeTargets(markdown).map((t) => t.target).sort(),
    ["../docs/spec.md", "guide.md", "img/chart.png"],
  );
});

test("external URLs, mailto, anchors and absolute paths are out of scope", () => {
  const markdown = [
    "[a](https://example.com/x.md) [b](mailto:x@exam" + "ple.com)",
    "[c](#section) [d](/etc/hosts)",
  ].join("\n");
  assert.deepEqual(relativeTargets(markdown), []);
});
