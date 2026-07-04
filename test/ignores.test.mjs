// `.seonixignore` — matcher semantics (pure) + indexRepository end-to-end on a
// temp git repo (gated on python3 + git, mirroring extract.test.mjs). The e2e
// asserts BOTH directions: default honours the ignore file; `ignores:false`
// (the benchmark rig's flag) indexes everything regardless.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseIgnorePatterns, ignoreMatcher, loadIgnores, walk } from "../src/walk.mjs";
import { indexRepository } from "../src/extract.mjs";

const matcher = (text) => ignoreMatcher(parseIgnorePatterns(text));

test("parseIgnorePatterns: comments, blanks and empty input", () => {
  assert.equal(parseIgnorePatterns("").length, 0);
  assert.equal(parseIgnorePatterns("# only a comment\n\n   \n").length, 0);
  assert.equal(ignoreMatcher([]), null);
});

test("ignoreMatcher: bare name matches at any depth, dir subtree included", () => {
  const m = matcher("corpus\n");
  assert.ok(m("corpus"));
  assert.ok(m("corpus/django/utils/text.py"));
  assert.ok(m("deep/corpus/x.py"));
  assert.ok(!m("xcorpus/a.py"));
  assert.ok(!m("corpustail/a.py"));
});

test("ignoreMatcher: trailing slash is cosmetic (dir pattern)", () => {
  const m = matcher("corpus/\n");
  assert.ok(m("corpus/django/x.py"));
  assert.ok(!m("site/app.mjs"));
});

test("ignoreMatcher: slashed pattern anchors to the repo root", () => {
  const m = matcher("target/behaviour-report\n");
  assert.ok(m("target/behaviour-report/trace/a.js"));
  assert.ok(!m("target/other/a.js"));
  assert.ok(!m("nested/target/behaviour-report/a.js"));
});

test("ignoreMatcher: * within a segment, ** across segments", () => {
  const m = matcher("*.gen.py\ndocs/**/fixtures\n");
  assert.ok(m("a/b/c.gen.py"));
  assert.ok(!m("a/b/c.py"));
  assert.ok(m("docs/x/y/fixtures/f.py"));
  assert.ok(!m("docs/fixturesX/f.py"));
});

test("ignoreMatcher: regex metacharacters in patterns stay literal", () => {
  const m = matcher("a+b/\nwhat?.py\n");
  assert.ok(m("a+b/x.py"));
  assert.ok(!m("aab/x.py"));
  assert.ok(m("what?.py"));
  assert.ok(!m("what.py"));
});

const have = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
const toolchain = (have("python3") || have("python")) && have("git");

test("indexRepository honours .seonixignore; ignores:false bypasses it", { skip: !toolchain ? "needs python3 + git" : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "seon-ignores-"));
  try {
    await mkdir(join(dir, "pkg"), { recursive: true });
    await mkdir(join(dir, "corpus", "sub"), { recursive: true });
    await writeFile(join(dir, "pkg", "keep.py"), "def kept():\n    return 1\n");
    await writeFile(join(dir, "corpus", "sub", "skip.py"), "def skipped():\n    return 2\n");
    await writeFile(join(dir, ".seonixignore"), "# vendored subject repos\ncorpus/\n");
    const git = (...a) => spawnSync("git", a, { cwd: dir });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("add", "-A");
    git("commit", "-q", "-m", "base");

    // walk-level pruning (in-process extractors) sees the same cut
    const ig = await loadIgnores(dir);
    const files = await walk(dir, [".py"], ig);
    assert.deepEqual(files.map((f) => f.slice(dir.length + 1)), ["pkg/keep.py"]);

    const { counts } = await indexRepository(dir);
    assert.equal(counts.modules, 1, "ignored corpus/ module must not be indexed");

    const { counts: all } = await indexRepository(dir, { ignores: false });
    assert.equal(all.modules, 2, "ignores:false must index everything");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
