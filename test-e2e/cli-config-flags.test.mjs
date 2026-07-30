// Every bin/tmct.mjs verb honours the shared repo/graph/config flags:
// `init --repo/--graph/--ontology/--lexicon` and the path-accepting `--corpus`,
// the `tmct import` verb, and `--config` on `extend --validate`, `serve`,
// `memory` and `syllogise`. Runs the REAL binary (spawnSync) — these are argv/
// filesystem integration points, not pure-function units.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMemory, openMemoryBackend, FACT_CLASS } from "../src/adapters/memory/core.mjs";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

const runCli = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...opts });
const tmp = () => mkdtemp(join(tmpdir(), "tmct-cliunif-"));

const READY_RE = /Anthropic Messages API at (http:\/\/\S+)\/v1\/messages.*— graph (\S+)/;

/** Boot `tmct serve` as a child process, resolving once its startup banner
 *  reports the bound URL AND the graph path it resolved — mirrors
 *  e2e/server-http-smoke.test.mjs's own bootServe helper, trimmed to just
 *  what this file needs (the banner text, not a full HTTP round trip — that's
 *  already covered elsewhere). */
function bootServe(args) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(process.execPath, [BIN, "serve", "--host", "127.0.0.1", "--port", "0", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error(`tmct serve did not report ready in time\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 15000);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (settled) return;
      const m = stdout.match(READY_RE);
      if (m) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ proc, bannerLine: stdout, graphPath: m[2] });
      }
    });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    proc.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`tmct serve exited early (code=${code} signal=${signal})\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
  });
}

function stopServe(proc) {
  return new Promise((resolvePromise) => {
    if (proc.exitCode !== null || proc.signalCode !== null) { resolvePromise(); return; }
    const killer = setTimeout(() => proc.kill("SIGKILL"), 5000);
    proc.once("exit", () => { clearTimeout(killer); resolvePromise(); });
    proc.kill("SIGTERM");
  });
}

// ---- init: --repo (init used to always hardcode process.cwd()) --------------

test("`tmct init --repo <dir>` initializes THAT dir, not cwd", async () => {
  const dir = await tmp();
  const target = join(dir, "target");
  await mkdir(target, { recursive: true });
  try {
    const r = runCli(["init", "--repo", target], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const toml = await readFile(join(target, "tmct.toml"), "utf8");
    assert.match(toml, /graph_file/);
    await assert.rejects(readFile(join(dir, "tmct.toml"), "utf8"), "cwd itself was never touched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- init: --graph (repeatable) sets graph_file/graph_files, no existence check ----

test("`tmct init --graph <path>` (single) sets tmct.toml's graph_file, no existence check needed", async () => {
  const dir = await tmp();
  try {
    const graphPath = join(dir, "custom", "graph.json"); // deliberately does not exist
    const r = runCli(["init", "--graph", graphPath], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    // repoRoot is `dir` itself here (cwd: dir, no --repo), so the recorded
    // path is relative to tmct.toml per its own "relative to this file"
    // contract — not the absolute graphPath.
    assert.match(toml, /graph_file = "custom\/graph\.json"/);
    assert.doesNotMatch(toml, /graph_files/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct init --graph <a> --graph <b>` (repeated) sets tmct.toml's graph_files array", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["init", "--graph", "a/graph.json", "--graph", "b/graph.json"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.match(toml, /graph_files = \[/);
    assert.match(toml, /a\/graph\.json/);
    assert.match(toml, /b\/graph\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- init: --corpus generalized to a file path ------------------------------

test("`tmct init --corpus <path>` (a jsonl file, not a manifest id) activates+seeds as a new host entry", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "mycorpus.jsonl"), '{"start":"/c/en/widget","rel":"/r/IsA","end":"/c/en/gadget"}\n');
    const r = runCli(["init", "--corpus", "mycorpus.jsonl"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /seeded "mycorpus" \(corpus\) — 1 fact\(s\) added/);
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.match(toml, /\[extensions\.mycorpus\]/);
    assert.match(toml, /kind = "corpus"/);
    assert.match(toml, /corpus_path/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- init: --ontology --------------------------------------------------------

test("`tmct init --ontology <path>` activates+seeds an ontology-kind entry", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "onto.jsonl"), '{"start":"/c/en/widget","rel":"/r/IsA","end":"/c/en/gadget"}\n');
    const r = runCli(["init", "--ontology", "onto.jsonl"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /seeded "onto" \(ontology\) — 1 fact\(s\) added/);
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.match(toml, /\[extensions\.onto\]/);
    assert.match(toml, /kind = "ontology"/);
    assert.match(toml, /ontology_path/);
    // read back through the routed default backend — the store the seed wrote
    const { dir: handle, close } = await openMemoryBackend(dir, "");
    const mem = await loadMemory(handle);
    await close();
    const facts = mem.individuals.filter((i) => i.class === FACT_CLASS);
    const fromOnto = facts.filter((f) => (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:onto")));
    assert.ok(fromOnto.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- init: --lexicon (activates, never seeds) --------------------------------

test("`tmct init --lexicon <path>` activates a lexicon-kind entry but seeds no corpus facts", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "lex.json"), '{"nouns":{"widget":{}},"verbs":{},"adjectives":{},"properNames":[]}\n');
    const r = runCli(["init", "--lexicon", "lex.json"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /activated "lex" \(lexicon\) in tmct\.toml — no corpus facts to seed/);
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.match(toml, /\[extensions\.lex\]/);
    assert.match(toml, /kind = "lexicon"/);
    assert.match(toml, /lexicon_path/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- init: --ontology/--lexicon unknown name/path still throws loudly -------

test("`tmct init --ontology <unknown>` (no matching name, no file) fails loudly, touches nothing on disk", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["init", "--ontology", "bogus-name-not-a-file"], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown --ontology "bogus-name-not-a-file"/);
    await assert.rejects(readFile(join(dir, "tmct.toml"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the new `tmct import` verb ----------------------------------------------

test("`tmct import` with no flags at all: a clear usage error, exit non-zero", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["import"], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /needs at least one of --corpus\/--ontology\/--lexicon\/--graph/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct import --corpus aws` into an already-initialized repo: activates+seeds tier2-aws", async () => {
  const dir = await tmp();
  try {
    const init = runCli(["init"], { cwd: dir });
    assert.equal(init.status, 0, init.stderr);
    const r = runCli(["import", "--corpus", "aws"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /seeded tier-2 corpus "aws" \(domain\)/);
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.match(toml, /\[extensions\.tier2-aws\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct import --graph <path>` APPENDS to tmct.toml's graph_files array (a different op from activation)", async () => {
  const dir = await tmp();
  try {
    const init = runCli(["init"], { cwd: dir });
    assert.equal(init.status, 0, init.stderr);
    const graphFile = join(dir, "other-graph.json");
    await writeFile(graphFile, JSON.stringify({ individuals: [] }));
    const r = runCli(["import", "--graph", graphFile], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /added 1 graph file\(s\) to tmct\.toml's graph_files/);
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.match(toml, /graph_files = \[/);
    assert.doesNotMatch(toml, /\[extensions\./, "a plain --graph import never touches [extensions]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct import --graph <path>` with a non-existent/malformed file fails loudly, never corrupts tmct.toml", async () => {
  const dir = await tmp();
  try {
    const init = runCli(["init"], { cwd: dir });
    assert.equal(init.status, 0, init.stderr);
    const tomlBefore = await readFile(join(dir, "tmct.toml"), "utf8");
    const r = runCli(["import", "--graph", join(dir, "does-not-exist.json")], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /cannot read/);
    const tomlAfter = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.equal(tomlAfter, tomlBefore, "tmct.toml is untouched on a failed --graph import");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct import --repo <dir>` targets that dir, not cwd", async () => {
  const dir = await tmp();
  const target = join(dir, "target");
  await mkdir(target, { recursive: true });
  try {
    const init = runCli(["init", "--repo", target]);
    assert.equal(init.status, 0, init.stderr);
    const r = runCli(["import", "--repo", target, "--corpus", "aws"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const toml = await readFile(join(target, "tmct.toml"), "utf8");
    assert.match(toml, /\[extensions\.tier2-aws\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- extend --validate --config --------------------------------------------

test("`tmct extend --validate <dir> --config <path>` validates against an alternate tmct.toml", async () => {
  const dir = await tmp();
  const altConfigDir = await tmp();
  try {
    await writeFile(join(dir, "corpus.jsonl"), "");
    await writeFile(join(altConfigDir, "tmct.toml"),
      `[extensions.seonix]\nkind = "pack"\nactive = true\ncorpus_path = "${join(dir, "corpus.jsonl").replace(/\\/g, "\\\\")}"\nprovenance_prefix = "corpus:seonix"\n`);
    const r = runCli(["extend", "--validate", dir, "--config", altConfigDir]);
    assert.match(r.stdout, /seonix \(pack\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(altConfigDir, { recursive: true, force: true });
  }
});

// ---- serve: --graph / --config ------------------------------------------------

test("`tmct serve --graph <path>` resolves the explicit graph, reported in the startup banner", async () => {
  const dir = await tmp();
  try {
    const graphFile = join(dir, "g.json");
    await writeFile(graphFile, JSON.stringify({ individuals: [{ id: "mod:a.py", label: "a.py", class: "Module", derived_from: [], mentions: [] }] }));
    const { proc, graphPath } = await bootServe(["--graph", graphFile]);
    try {
      assert.equal(graphPath, graphFile);
    } finally {
      await stopServe(proc);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct serve --config <path>` resolves graph_file from an alternate tmct.toml location", async () => {
  const dir = await tmp();
  try {
    const graphFile = join(dir, "from-config.json");
    await writeFile(graphFile, JSON.stringify({ individuals: [] }));
    await writeFile(join(dir, "tmct.toml"), `graph_file = "${graphFile.replace(/\\/g, "\\\\")}"\n`);
    const { proc, graphPath } = await bootServe(["--config", dir]);
    try {
      assert.equal(graphPath, graphFile);
    } finally {
      await stopServe(proc);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- memory / syllogise: --config accepted (no code graph read either way) ----

test("`tmct memory --config <path>` doesn't error — accepted for symmetry, memory reads no code graph", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["memory", "--repo", dir, "--config", dir]);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct syllogise --config <path>` doesn't error — accepted for symmetry, syllogise reads no code graph", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["syllogise", "--repo", dir, "--config", dir]);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
