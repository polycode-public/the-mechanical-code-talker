// Multi-repository indexing (repo_paths / multi_root → ONE merged graph) and the
// single-path golden-compat guard. The golden (fixtures/multi/golden-repo-a.json)
// is the id set + edge set the PRE-multi-repo indexer produced for repo-a — the
// single-path mode must keep producing exactly that (no prefixes, no drift). To
// regenerate after an intentional graph-shape change: index a copy of
// fixtures/multi/repo-a single-path and re-derive {ids, edges} as below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  indexRepository, indexRepositories, assignRepoPrefixes, applyRepoPrefix,
  defaultOutRoot, discoverRepos,
} from "../src/extract.mjs";

const BIN = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/multi", import.meta.url));
const runCli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });

const idsAndEdges = (e) => ({
  ids: e.individuals.map((i) => i.id).sort(),
  edges: e.objectProperties
    .flatMap((g) => g.examples.map((x) => `${g.prop} ${x.subject} ${x.object}`))
    .sort(),
});

const have = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
const toolchain = (have("python3") || have("python")) && have("git");
const gate = { skip: !toolchain ? "needs python3 + git" : false };

// ── pure helpers ─────────────────────────────────────────────────────────────

test("assignRepoPrefixes: basename; collisions get -2/-3 in path sort order", () => {
  const m = assignRepoPrefixes(["/y/app", "/x/app", "/z/lib"]);
  assert.equal(m.get("/x/app"), "app");   // first in path sort order keeps the bare name
  assert.equal(m.get("/y/app"), "app-2");
  assert.equal(m.get("/z/lib"), "lib");
  const three = assignRepoPrefixes(["/c/app", "/a/app", "/b/app"]);
  assert.deepEqual([three.get("/a/app"), three.get("/b/app"), three.get("/c/app")], ["app", "app-2", "app-3"]);
});

test("defaultOutRoot: deepest common ancestor (segment-wise); filesystem root falls back to cwd", () => {
  assert.equal(defaultOutRoot(["/x/foo", "/x/foobar"]), "/x"); // segments, not a string prefix
  assert.equal(defaultOutRoot(["/x/a/repo1", "/x/a/repo2", "/x/a/b/repo3"]), "/x/a");
  assert.equal(defaultOutRoot(["/x/a/repo1"]), "/x/a/repo1"); // one path: the repo itself
  assert.equal(defaultOutRoot(["/aaa/r1", "/bbb/r2"], "/fallback"), "/fallback");
});

test("applyRepoPrefix: path/dotted/imports, commit files and hunk-range keys all gain the repo name", () => {
  const r = {
    modules: [{ path: "pkg/a.py", dotted: "pkg.a", imports: ["pkg.b", "pkg.b.helper"], defines: [{ name: "f" }] }],
    commits: [{ sha: "a".repeat(40), files: ["pkg/a.py"] }],
    symbolHistory: [{ sha: "a".repeat(40), ranges: { "pkg/a.py": [[1, 2]] } }],
  };
  applyRepoPrefix(r, "repo-a");
  assert.equal(r.modules[0].path, "repo-a/pkg/a.py");
  assert.equal(r.modules[0].dotted, "repo-a.pkg.a");
  // imports get the SAME leading component as dotted, so intra-repo resolution still lines up
  assert.deepEqual(r.modules[0].imports, ["repo-a.pkg.b", "repo-a.pkg.b.helper"]);
  assert.equal(r.modules[0].defines[0].name, "f", "symbol names are untouched");
  assert.deepEqual(r.commits[0].files, ["repo-a/pkg/a.py"]);
  assert.deepEqual(Object.keys(r.symbolHistory[0].ranges), ["repo-a/pkg/a.py"]);
});

test("discoverRepos: child dirs with a .git dir OR file are repos; plain child dirs are skipped", async () => {
  const root = await mkdtemp(join(tmpdir(), "seon-discover-"));
  try {
    await mkdir(join(root, "with-git-dir", ".git"), { recursive: true });
    await mkdir(join(root, "with-git-file"));
    await writeFile(join(root, "with-git-file", ".git"), "gitdir: /elsewhere\n"); // worktree/submodule shape
    await mkdir(join(root, "plain-dir"));
    await mkdir(join(root, ".hidden", ".git"), { recursive: true }); // dot-dirs ignored outright
    await writeFile(join(root, "a-file.txt"), "not a dir\n");
    const { repos, skipped } = await discoverRepos(root);
    assert.deepEqual(repos, [join(root, "with-git-dir"), join(root, "with-git-file")]);
    assert.deepEqual(skipped, ["plain-dir"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── golden compat: single-path output is unchanged by the multi-repo work ────

test("golden-compat: single-path indexing of repo-a still yields the pre-change id/edge sets", gate, async () => {
  const dir = await mkdtemp(join(tmpdir(), "seon-golden-"));
  try {
    await cp(join(FIXTURES, "repo-a"), dir, { recursive: true });
    const { graphFile } = await indexRepository(dir);
    const got = idsAndEdges(JSON.parse(await readFile(graphFile, "utf8")));
    const golden = JSON.parse(await readFile(join(FIXTURES, "golden-repo-a.json"), "utf8"));
    assert.deepEqual(got.ids, golden.ids);
    assert.deepEqual(got.edges, golden.edges);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── merged indexing e2e ──────────────────────────────────────────────────────

/** Copy both fixture repos under one tmp root; git-init repo-a (the with-history
 *  path) and leave repo-b git-less (the empty-commits degradation path). */
async function twoRepoRoot() {
  const root = await mkdtemp(join(tmpdir(), "seon-multi-"));
  await cp(join(FIXTURES, "repo-a"), join(root, "repo-a"), { recursive: true });
  await cp(join(FIXTURES, "repo-b"), join(root, "repo-b"), { recursive: true });
  const git = (...a) => spawnSync("git", a, { cwd: join(root, "repo-a") });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return root;
}

test("repo_paths: two repos merge into one graph — prefixed ids, per-repo edges, per-repo git + ignores", gate, async () => {
  const root = await twoRepoRoot();
  try {
    const { graphFile, outRoot, repos, counts } = await indexRepositories([join(root, "repo-a"), join(root, "repo-b")]);
    assert.equal(outRoot, root, "out_root defaults to the deepest common ancestor");
    assert.equal(graphFile, join(root, ".seonix", "graph.json"));
    assert.deepEqual(repos.map((r) => r.prefix), ["repo-a", "repo-b"]);
    assert.equal(counts.modules, 6, "3 modules per repo (repo-b's scratch/ is .seonixignore'd)");

    const e = JSON.parse(await readFile(graphFile, "utf8"));
    const { ids } = idsAndEdges(e);
    assert.equal(new Set(ids).size, ids.length, "no id collisions in the merged graph");
    assert.ok(ids.includes("mod:repo-a/pkg/alpha.py"));
    assert.ok(ids.includes("fn:repo-a/pkg/beta.py#Widget"));
    assert.ok(ids.includes("mod:repo-b/lib/gamma.py"));
    assert.ok(!ids.some((i) => i.includes("scratch/ignored")), "repo-b's .seonixignore is honoured in multi mode");

    // dotted attribute carries the prefix as a leading component
    const alpha = e.individuals.find((i) => i.id === "mod:repo-a/pkg/alpha.py");
    assert.equal(alpha.attributes.find((a) => a.key === "dotted")?.value, "repo-a.pkg.alpha");

    // intra-repo imports resolve inside EACH repo, ids prefixed
    const rel = (prop) => e.objectProperties.find((g) => g.prop === prop).examples.map((x) => [x.subject, x.object]);
    const imports = rel("mgx:importsNamespace");
    assert.ok(imports.some(([s, o]) => s === "mod:repo-a/pkg/beta.py" && o === "mod:repo-a/pkg/alpha.py"));
    assert.ok(imports.some(([s, o]) => s === "mod:repo-b/lib/delta.py" && o === "mod:repo-b/lib/gamma.py"));
    const defines = rel("seon:declaresMethod");
    assert.ok(defines.some(([s, o]) => s === "mod:repo-a/pkg/alpha.py" && o === "fn:repo-a/pkg/alpha.py#alpha_helper"));
    assert.ok(defines.some(([s, o]) => s === "mod:repo-b/lib/gamma.py" && o === "fn:repo-b/lib/gamma.py#gamma_util"));
    assert.ok(rel("mgx:callsSymbol").some(([s, o]) => s === "fn:repo-b/lib/delta.py#run_delta" && o === "fn:repo-b/lib/gamma.py#gamma_util"));

    // per-repo git history: repo-a's commit touches PREFIXED module ids; git-less
    // repo-b degrades to no commits/provenance (no failure)
    const touches = rel("mgx:touchedByCommit");
    assert.ok(touches.length >= 1 && touches.every(([, o]) => o.startsWith("mod:repo-a/")),
      `only repo-a has history: ${JSON.stringify(touches)}`);
    assert.ok(e.individuals.some((i) => i.class === "Commit"));
    const gamma = e.individuals.find((i) => i.id === "mod:repo-b/lib/gamma.py");
    assert.deepEqual(gamma.derived_from, [], "git-less repo carries no commit provenance");

    // seonix_search over the merged graph finds modules from BOTH repos, labels prefixed
    const search = runCli("cli", "seonix_search", JSON.stringify({ repo_path: root, query: "alpha helper gamma util" }));
    assert.equal(search.status, 0, search.stderr);
    assert.match(search.stdout, /repo-a\/pkg\/alpha\.py/);
    assert.match(search.stdout, /repo-b\/lib\/gamma\.py/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo_paths: shared basenames disambiguate deterministically (-2 in path sort order)", gate, async () => {
  const root = await mkdtemp(join(tmpdir(), "seon-collide-"));
  try {
    await cp(join(FIXTURES, "repo-a"), join(root, "x", "app"), { recursive: true });
    await cp(join(FIXTURES, "repo-b"), join(root, "y", "app"), { recursive: true });
    const { graphFile } = await indexRepositories([join(root, "y", "app"), join(root, "x", "app")]);
    assert.equal(graphFile, join(root, ".seonix", "graph.json"));
    const { ids } = idsAndEdges(JSON.parse(await readFile(graphFile, "utf8")));
    assert.ok(ids.includes("mod:app/pkg/alpha.py"), "x/app sorts first → bare name");
    assert.ok(ids.includes("mod:app-2/lib/gamma.py"), "y/app → app-2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multi_root (cli): discovers .git-marked children, skips plain dirs, indexes into <multi_root>/.seonix", gate, async () => {
  const root = await mkdtemp(join(tmpdir(), "seon-mroot-"));
  try {
    await cp(join(FIXTURES, "repo-a"), join(root, "repo-a"), { recursive: true });
    await mkdir(join(root, "repo-a", ".git")); // .git dir marker is enough for discovery
    await cp(join(FIXTURES, "repo-b"), join(root, "repo-b"), { recursive: true });
    await writeFile(join(root, "repo-b", ".git"), "gitdir: /elsewhere\n"); // .git FILE (worktree shape)
    await mkdir(join(root, "not-a-repo"));
    await writeFile(join(root, "not-a-repo", "loose.py"), "def loose():\n    return 1\n");

    const res = runCli("cli", "index_repository", JSON.stringify({ multi_root: root }));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /2 repo\(s\) discovered/);
    assert.match(res.stderr, /skipped 1 non-repo child dir\(s\): not-a-repo/);
    const { ids } = idsAndEdges(JSON.parse(await readFile(join(root, ".seonix", "graph.json"), "utf8")));
    assert.ok(ids.includes("mod:repo-a/pkg/alpha.py"));
    assert.ok(ids.includes("mod:repo-b/lib/delta.py"));
    assert.ok(!ids.some((i) => i.includes("loose")), "non-repo children are not indexed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── error cases (no toolchain needed — rejected before any extraction) ───────

test("index_repository: repo_path and repo_paths together are rejected loudly", () => {
  const res = runCli("cli", "index_repository", JSON.stringify({ repo_path: "/a", repo_paths: ["/b"] }));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /mutually exclusive/);
});

test("index_repository: empty repo_paths is rejected", () => {
  const res = runCli("cli", "index_repository", JSON.stringify({ repo_paths: [] }));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /non-empty/);
});

test("index_repository: multi_root with no repos is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "seon-empty-"));
  try {
    await mkdir(join(root, "just-a-dir"));
    const res = runCli("cli", "index_repository", JSON.stringify({ multi_root: root }));
    assert.equal(res.status, 2);
    assert.match(res.stderr, /no repositories/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("index_repository: no path form at all is rejected", () => {
  const res = runCli("cli", "index_repository", JSON.stringify({}));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /requires repo_path, repo_paths or multi_root/);
});
