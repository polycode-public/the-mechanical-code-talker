// Unit tests for src/adapters/source-slice.mjs — the shared, safe span-slicing helpers
// factored out of src/tools/server.mjs (security fix: path-traversal guard on the
// fs-touching half, readSpanSafe).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sliceSpan, readSpanSafe } from "../../src/adapters/source-slice.mjs";
import { ToolError } from "../../src/adapters/config.mjs";

test("sliceSpan: extracts and line-numbers a span", () => {
  const lines = ["a", "b", "c", "d", "e"];
  const r = sliceSpan(lines, 2, 4, undefined);
  assert.equal(r.start, 2);
  assert.equal(r.end, 4);
  assert.equal(r.text, "2\tb\n3\tc\n4\td");
  assert.equal(r.truncated, false);
});

test("sliceSpan: clamps start below 1 and end beyond lines.length", () => {
  const lines = ["a", "b", "c"];
  const r = sliceSpan(lines, -3, 100, undefined);
  assert.equal(r.start, 1);
  assert.equal(r.end, 3);
  assert.equal(r.text, "1\ta\n2\tb\n3\tc");
});

test("sliceSpan: maxLines truncates from start and sets truncated=true", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `L${i + 1}`);
  const r = sliceSpan(lines, 1, 10, 3);
  assert.equal(r.start, 1);
  assert.equal(r.end, 3);
  assert.equal(r.truncated, true);
  assert.equal(r.text, "1\tL1\n2\tL2\n3\tL3");
});

test("sliceSpan: no truncation when span already fits under maxLines", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `L${i + 1}`);
  const r = sliceSpan(lines, 4, 6, 10);
  assert.equal(r.truncated, false);
  assert.equal(r.end, 6);
});

test("readSpanSafe: reads and slices a legitimate in-repo path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-slice-"));
  try {
    await writeFile(join(dir, "a.txt"), "one\ntwo\nthree\nfour\n");
    const r = await readSpanSafe({ readFile, repoRoot: dir, path: "a.txt", start: 2, end: 3 });
    assert.equal(r.text, "2\ttwo\n3\tthree");
    assert.equal(r.truncated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readSpanSafe: omitted start/end returns the whole file as { lines }", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-slice-"));
  try {
    await writeFile(join(dir, "a.txt"), "one\ntwo\nthree\n");
    const r = await readSpanSafe({ readFile, repoRoot: dir, path: "a.txt" });
    assert.deepEqual(r.lines, ["one", "two", "three", ""]); // split("\n") keeps the trailing empty segment
    assert.equal(r.text, undefined); // no slice performed
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readSpanSafe: rejects a path-traversal attempt before ever calling readFile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-slice-"));
  try {
    // A sibling secret OUTSIDE repoRoot the traversal path targets, to prove it's never read.
    await writeFile(join(dir, "..", `secret-${Date.now()}.txt`), "TOP SECRET").catch(() => {});
    let readFileCalled = false;
    const spyReadFile = async (...a) => { readFileCalled = true; return readFile(...a); };
    const evilPath = "../../../../../../../../etc/passwd";
    await assert.rejects(
      readSpanSafe({ readFile: spyReadFile, repoRoot: dir, path: evilPath, start: 1, end: 5 }),
      (e) => {
        assert.ok(e instanceof ToolError, "a ToolError, not a raw fs error");
        assert.match(e.message, /refusing to read outside the repository root/);
        assert.match(e.message, new RegExp(evilPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "names the offending path");
        return true;
      },
    );
    assert.equal(readFileCalled, false, "readFile must never be invoked for a rejected path");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readSpanSafe: rejects a sibling-directory-prefix bypass (repoRoot='/x/foo' vs '/x/foobar')", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-slice-"));
  const repoRoot = join(dir, "foo");
  const sibling = join(dir, "foobar"); // shares the "foo" PREFIX but is not a descendant of repoRoot
  try {
    await mkdir(repoRoot, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await writeFile(join(sibling, "secret.txt"), "nope");
    await assert.rejects(
      readSpanSafe({ readFile, repoRoot, path: "../foobar/secret.txt", start: 1, end: 1 }),
      (e) => {
        assert.ok(e instanceof ToolError);
        assert.match(e.message, /refusing to read outside the repository root/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readSpanSafe: a RELATIVE repoRoot is normalized to absolute, not rejected outright", async () => {
  // Regression: resolve(repoRoot, path) is always absolute, so comparing it against a
  // relative repoRoot (e.g. from a relative TMCT_GRAPH_FILE) used to make the guard reject
  // every legitimate read, not just traversal attempts. readSpanSafe must normalize repoRoot
  // itself (defense in depth — src/adapters/config.mjs also normalizes at the source).
  const dir = await mkdtemp(join(tmpdir(), "tmct-slice-"));
  const prevCwd = process.cwd();
  try {
    await writeFile(join(dir, "file.txt"), "hello\nworld\n");
    process.chdir(dir);
    const relativeRepoRoot = "."; // a relative repoRoot, as a relative TMCT_GRAPH_FILE would produce
    const r = await readSpanSafe({ readFile, repoRoot: relativeRepoRoot, path: "file.txt", start: 1, end: 1 });
    assert.equal(r.text, "1\thello");
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("readSpanSafe: a path resolving to repoRoot itself is allowed (boundary case)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-slice-"));
  try {
    // repoRoot itself is a directory, not a file — readFile on it should fail with EISDIR,
    await assert.rejects(
      readSpanSafe({ readFile, repoRoot: dir, path: ".", start: 1, end: 1 }),
      (e) => {
        assert.ok(!(e instanceof ToolError) || !/refusing to read outside/.test(e.message));
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
