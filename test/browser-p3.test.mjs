// browser P3 tests — I/O-backed: gitCommitParents against a REAL git repo with an
// actual merge commit, buildBrowserData's live/gitHead pass-through, and
// viz --serve's /code-browser-version poll route. Pure logic (neighborsOf, the
// merge/ghost SHAPE on buildTemporalGraph) lives in temporal-p3.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitCommitParents, buildBrowserData, buildTemporalGraph } from "../src/browser.mjs";
import { startVizServer } from "../src/viz.mjs";

const execFileP = promisify(execFile);
const fixturePath = new URL("./fixtures/entities.fixture.json", import.meta.url).pathname;

/** A throwaway repo with a real merge commit: root -> (main: a) & (feature: b) -> merge. */
async function repoWithMerge() {
  const dir = await mkdtemp(join(tmpdir(), "seonix-p3-git-"));
  const git = (...args) => execFileP("git", args, { cwd: dir });
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "test");
  await writeFile(join(dir, "root.txt"), "root");
  await git("add", "-A");
  await git("commit", "-q", "-m", "root");
  await git("checkout", "-q", "-b", "feature");
  await writeFile(join(dir, "b.txt"), "b");
  await git("add", "-A");
  await git("commit", "-q", "-m", "feature work");
  await git("checkout", "-q", "main");
  await writeFile(join(dir, "a.txt"), "a");
  await git("add", "-A");
  await git("commit", "-q", "-m", "main work");
  await git("merge", "-q", "--no-ff", "-m", "Merge branch feature", "feature");
  const { stdout: root } = await git("log", "--format=%H", "--reverse");
  const shas = root.trim().split("\n");
  return { dir, root: shas[0], featureCommit: shas[1], mainCommit: shas[2], merge: shas[3] };
}

test("gitCommitParents: a real --no-ff merge reports BOTH parent shas", async () => {
  const { dir, root, featureCommit, mainCommit, merge } = await repoWithMerge();
  try {
    const parents = await gitCommitParents(dir);
    assert.deepEqual(parents.get(root), []);
    assert.deepEqual(parents.get(featureCommit), [root]);
    assert.deepEqual(parents.get(mainCommit), [root]);
    assert.deepEqual([...parents.get(merge)].sort(), [featureCommit, mainCommit].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gitCommitParents: not a git repo → empty Map, never throws", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seonix-p3-nogit-"));
  try {
    const parents = await gitCommitParents(dir);
    assert.equal(parents.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gitCommitParents feeds buildTemporalGraph end-to-end: the merge is jump-able", async () => {
  const { dir, root, featureCommit, mainCommit, merge } = await repoWithMerge();
  try {
    const raw = {
      individuals: [{ id: "mod:root.txt", label: "root.txt", class: "Module", attributes: [] }],
      objectProperties: [],
    };
    const order = [root, featureCommit, mainCommit, merge];
    const parentsBySha = await gitCommitParents(dir);
    const tg = buildTemporalGraph(raw, order, { parentsBySha });
    const mergeCommit = tg.commits[3];
    assert.equal(mergeCommit.sha, merge);
    assert.equal(mergeCommit.merge, true);
    assert.equal(mergeCommit.parentIdx.length, 2);
    assert.equal(mergeCommit.ghostParents, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildBrowserData: live + gitHead pass through only when the caller sets them", () => {
  const tg = { commits: [], nodes: [], edges: [] };
  const staticData = buildBrowserData(tg, { repoUrl: "https://gitlab.example/a/b" });
  assert.equal(staticData.live, false);
  assert.equal(staticData.gitHead, "");
  const liveData = buildBrowserData(tg, { repoUrl: "https://gitlab.example/a/b", live: true, gitHead: "deadbeef" });
  assert.equal(liveData.live, true);
  assert.equal(liveData.gitHead, "deadbeef");
});

test("viz --serve: /code-browser-version is a cheap poll target, and the payload is marked live", async () => {
  const values = { focus: undefined, depth: "2", hub: "40", max: "200", graph: fixturePath, port: "0" };
  const { server, url } = await startVizServer({ values, cytoscape: "/*CY*/" });
  try {
    const verRes = await fetch(new URL("/code-browser-version", url));
    assert.equal(verRes.status, 200);
    const { head } = await verRes.json();
    assert.equal(typeof head, "string"); // this repo IS a real git checkout — some sha or ""
    const dataRes = await fetch(new URL("/code-browser-data.json", url));
    const tg = await dataRes.json();
    assert.equal(tg.live, true);
    assert.equal(tg.gitHead, head); // both derived from the same rev-parse HEAD
  } finally {
    server.close();
  }
});
