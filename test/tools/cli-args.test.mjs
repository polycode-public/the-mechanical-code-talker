// cli-args.test.mjs — src/services/cli-args.mjs's shared flag helpers and
// resolveRuntimeConfig precedence chain (arg > env > tmct.toml > default for
// graph paths; arg > toml > default for every other knob, via toml-config.mjs's
// existing, separately-tested mergeEffective).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { strFlag, repeatedFlag, boolFlag, enumFlag, resolveRuntimeConfig } from "../../src/services/cli-args.mjs";
import { DEFAULT_GRAPH_REL } from "../../src/adapters/config.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "tmct-cliargs-"));
const noGitRoot = () => null; // tests run outside a git-root assumption, injected explicitly

// ---- flag helpers ------------------------------------------------------------

test("strFlag: returns the default when absent", () => {
  assert.equal(strFlag(["--foo", "x"], ["--repo"], "dflt"), "dflt");
});

test("strFlag: single occurrence", () => {
  assert.equal(strFlag(["--repo", "/abs"], ["--repo"]), "/abs");
});

test("strFlag: last occurrence wins", () => {
  assert.equal(strFlag(["--repo", "/a", "--repo", "/b"], ["--repo"]), "/b");
});

test("strFlag: accepts an alias array", () => {
  assert.equal(strFlag(["-v", "yes"], ["--verbose", "-v"]), "yes");
});

test("repeatedFlag: collects every occurrence in argv order", () => {
  assert.deepEqual(repeatedFlag(["--graph", "a", "--graph", "b"], ["--graph"]), ["a", "b"]);
});

test("repeatedFlag: empty array when absent", () => {
  assert.deepEqual(repeatedFlag(["--repo", "x"], ["--graph"]), []);
});

test("boolFlag: true when present, false when absent", () => {
  assert.equal(boolFlag(["--force"], ["--force"]), true);
  assert.equal(boolFlag([], ["--force"]), false);
});

test("enumFlag: undefined when absent (never a default)", () => {
  assert.equal(enumFlag([], ["--memory-backend"], ["default", "memory", "sqlite"]), undefined);
});

test("enumFlag: returns the value when it's one of the choices", () => {
  assert.equal(enumFlag(["--memory-backend", "sqlite"], ["--memory-backend"], ["default", "memory", "sqlite"]), "sqlite");
});

test("enumFlag: throws a clear error naming the flag + choices when the value isn't one of them", () => {
  assert.throws(
    () => enumFlag(["--memory-backend", "bogus"], ["--memory-backend"], ["default", "memory", "sqlite"]),
    /invalid --memory-backend "bogus"\. Choices: default, memory, sqlite\./,
  );
});

// ---- resolveRuntimeConfig -----------------------------------------------------

test("resolveRuntimeConfig: no flags, no toml, no git root — defaults to cwd's .tmct/graph.json", async () => {
  const dir = await tmp();
  try {
    const res = await resolveRuntimeConfig({ argv: [], cwd: dir, env: {}, gitRoot: noGitRoot });
    assert.equal(res.repo, dir);
    assert.equal(res.config.graphFile, join(dir, DEFAULT_GRAPH_REL));
    assert.deepEqual(res.config.graphFiles, [join(dir, DEFAULT_GRAPH_REL)]);
    assert.equal(res.sources.graphFile, "default");
    assert.ok(isAbsolute(res.configPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: --repo pins the repo root (no git-root fallback needed)", async () => {
  const dir = await tmp();
  try {
    const res = await resolveRuntimeConfig({ argv: ["--repo", dir], cwd: "/somewhere/else", env: {}, gitRoot: noGitRoot });
    assert.equal(res.repo, dir);
    assert.equal(res.config.graphFile, join(dir, DEFAULT_GRAPH_REL));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: falls back to gitRoot(cwd) when --repo is absent", async () => {
  const dir = await tmp();
  try {
    const res = await resolveRuntimeConfig({ argv: [], cwd: "/nested/subdir", env: {}, gitRoot: () => dir });
    assert.equal(res.repo, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: TMCT_GRAPH_FILE env overrides the repo-derived default", async () => {
  const dir = await tmp();
  try {
    const res = await resolveRuntimeConfig({
      argv: [], cwd: dir, env: { TMCT_GRAPH_FILE: "/abs/other/graph.json" }, gitRoot: noGitRoot,
    });
    assert.equal(res.config.graphFile, "/abs/other/graph.json");
    assert.equal(res.sources.graphFile, "env");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: tmct.toml's graph_file wins over the repo default, loses to env", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), 'graph_file = "custom/graph.json"\n');
    const res = await resolveRuntimeConfig({ argv: [], cwd: dir, env: {}, gitRoot: noGitRoot });
    assert.equal(res.config.graphFile, join(dir, "custom/graph.json"));
    assert.equal(res.sources.graphFile, "tmct.toml");

    const withEnv = await resolveRuntimeConfig({
      argv: [], cwd: dir, env: { TMCT_GRAPH_FILE: "/abs/env-wins.json" }, gitRoot: noGitRoot,
    });
    assert.equal(withEnv.config.graphFile, "/abs/env-wins.json");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: tmct.toml's graph_files (array) surfaces as config.graphFiles", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), 'graph_files = ["a/graph.json", "b/graph.json"]\n');
    const res = await resolveRuntimeConfig({ argv: [], cwd: dir, env: {}, gitRoot: noGitRoot });
    assert.deepEqual(res.config.graphFiles, [join(dir, "a/graph.json"), join(dir, "b/graph.json")]);
    assert.equal(res.config.graphFile, join(dir, "a/graph.json"), "graphFile is the first of graphFiles");
    assert.deepEqual(res.effective.graphFiles, res.config.graphFiles);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: --graph (repeatable) wins over everything, including env and toml", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), 'graph_file = "toml/graph.json"\n');
    const res = await resolveRuntimeConfig({
      argv: ["--graph", "/abs/one.json", "--graph", "/abs/two.json"],
      cwd: dir,
      env: { TMCT_GRAPH_FILE: "/abs/env.json" },
      gitRoot: noGitRoot,
    });
    assert.deepEqual(res.config.graphFiles, ["/abs/one.json", "/abs/two.json"]);
    assert.equal(res.config.graphFile, "/abs/one.json");
    assert.equal(res.sources.graphFile, "arg");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: --config <dir> points at an alternate tmct.toml location", async () => {
  const repoDir = await tmp();
  const configDir = await tmp();
  try {
    await writeFile(join(configDir, "tmct.toml"), 'graph_file = "elsewhere/graph.json"\n');
    const res = await resolveRuntimeConfig({
      argv: ["--repo", repoDir, "--config", configDir], cwd: repoDir, env: {}, gitRoot: noGitRoot,
    });
    assert.equal(res.config.graphFile, join(configDir, "elsewhere/graph.json"));
    assert.equal(res.configPath, join(configDir, "tmct.toml"));
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: --config <file> points at an explicit tmct.toml FILE, not just a dir", async () => {
  const repoDir = await tmp();
  const otherDir = await tmp();
  try {
    const explicitFile = join(otherDir, "alt-name.toml");
    await writeFile(explicitFile, 'graph_file = "from-explicit-file/graph.json"\n');
    const res = await resolveRuntimeConfig({
      argv: ["--repo", repoDir, "--config", explicitFile], cwd: repoDir, env: {}, gitRoot: noGitRoot,
    });
    assert.equal(res.config.graphFile, join(otherDir, "from-explicit-file/graph.json"));
    assert.equal(res.configPath, explicitFile);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(otherDir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: effective/sources carry non-graph toml knobs via mergeEffective", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), "[tune]\nliteral_mention = false\n");
    const res = await resolveRuntimeConfig({ argv: [], cwd: dir, env: {}, gitRoot: noGitRoot });
    assert.equal(res.effective["tune.literalMention"], false);
    assert.equal(res.sources["tune.literalMention"], "tmct.toml");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRuntimeConfig: tmct.toml's [memory] backend surfaces on res.toml.memory.backend and via effective/sources (chat.mjs's createSession reads the former)", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), '[memory]\nbackend = "sqlite"\n');
    const res = await resolveRuntimeConfig({ argv: [], cwd: dir, env: {}, gitRoot: noGitRoot });
    assert.equal(res.toml.memory.backend, "sqlite");
    assert.equal(res.effective["memory.backend"], "sqlite");
    assert.equal(res.sources["memory.backend"], "tmct.toml");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
