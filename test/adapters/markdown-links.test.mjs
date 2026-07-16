import test from "node:test";
import assert from "node:assert/strict";

import { blankCodeSpans, relativeTargets } from "../../src/domain/markdown-links.mjs";

test("relativeTargets: an ordinary inline link is a target", () => {
  assert.deepEqual(relativeTargets("see [the plan](PLAN_PURGE.md) first"), [
    { target: "PLAN_PURGE.md", line: 1 },
  ]);
});

test("relativeTargets: a reference definition is a target", () => {
  assert.deepEqual(relativeTargets("[plan]: PLAN_PURGE.md"), [{ target: "PLAN_PURGE.md", line: 1 }]);
});

test("relativeTargets: external URLs, anchors and absolute paths are out of scope", () => {
  const md = "[a](https://example.com) [b](mailto:x@y.z) [c](#section) [d](/abs/path)";
  assert.deepEqual(relativeTargets(md), []);
});

test("relativeTargets: a link shape inside a code span is an example, not a link", () => {
  const md = "the checker reads `[text](target)` inline links";
  assert.deepEqual(relativeTargets(md), []);
});

test("relativeTargets: a link inside a fenced block is an example, not a link", () => {
  const md = ["before", "```md", "[text](does-not-exist.md)", "```", "after"].join("\n");
  assert.deepEqual(relativeTargets(md), []);
});

test("relativeTargets: a tilde-fenced block is skipped the same way", () => {
  const md = ["~~~", "[text](does-not-exist.md)", "~~~"].join("\n");
  assert.deepEqual(relativeTargets(md), []);
});

test("relativeTargets: blanking a code span leaves later links on their true line", () => {
  const md = ["`[a](nope.md)`", "", "and [really](README.md) here"].join("\n");
  assert.deepEqual(relativeTargets(md), [{ target: "README.md", line: 3 }]);
});

test("relativeTargets: a real link on the same line as a code span still counts", () => {
  const md = "`[text](target)` is the shape [this](README.md) is a link";
  assert.deepEqual(relativeTargets(md), [{ target: "README.md", line: 1 }]);
});

test("blankCodeSpans: keeps length and newlines so offsets survive", () => {
  const md = "a `code` b\nc";
  const blanked = blankCodeSpans(md);
  assert.equal(blanked.length, md.length);
  assert.equal(blanked.split("\n").length, md.split("\n").length);
  assert.equal(blanked, "a        b\nc");
});

test("blankCodeSpans: a double-backtick span containing a backtick is one span", () => {
  //            x ``a ` b`` y  — the 9-char span blanks whole, the x and y survive
  assert.equal(blankCodeSpans("x ``a ` b`` y"), "x           y");
});
