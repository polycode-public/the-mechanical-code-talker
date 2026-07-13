// viz-cli.test.mjs — bin/tmct.mjs's `viz` mode: real CLI flag parsing for
// PLAN_VIZ_MEMORY.md's additions (--hub-degree, --term, --edge-kind), plus
// the pre-existing --focus/--depth/--limit/--output, spawned as a real child
// process (mirrors test/cli-smoke.test.mjs's own spawnSync pattern) against a
// real memory-seeded repo dir — not the unit-level computeVizGraph/
// renderVizHtml coverage in test/viz.test.mjs, which this file doesn't repeat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFact } from "../src/memory/core.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const runCli = (dir, ...args) => spawnSync(process.execPath, [BIN, "viz", "--repo", dir, ...args], { encoding: "utf8" });

async function seededRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-viz-cli-"));
  const TS = "2026-07-11T10:00:00.000Z";
  await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human", createdAt: TS });
  await appendFact(dir, { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:conceptnet /r/HasA", createdAt: TS });
  return dir;
}

function embeddedJson(html, name) {
  const m = new RegExp(`const ${name} = (.*);`).exec(html);
  assert.ok(m, `const ${name} = ...; not found in the rendered page`);
  return JSON.parse(m[1]);
}

test("tmct viz --hub-degree parses and threads through to WALK_OPTS", async () => {
  const dir = await seededRepo();
  try {
    const out = join(dir, "graph.html");
    const res = runCli(dir, "--output", out, "--hub-degree", "5", "--limit", "50", "--depth", "4");
    assert.equal(res.status, 0, res.stderr);
    const html = await readFile(out, "utf8");
    const walkOpts = embeddedJson(html, "WALK_OPTS");
    assert.equal(walkOpts.hubDegree, 5);
    assert.equal(walkOpts.nodeLimit, 50);
    assert.equal(walkOpts.depth, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct viz --term <word> resolves the seed via normFactTerm and reaches that term's concept neighbourhood, without hunting for a raw fact:<hash> id", async () => {
  const dir = await seededRepo();
  try {
    const out = join(dir, "graph.html");
    const res = runCli(dir, "--output", out, "--term", "Dog"); // capitalized: normFactTerm lowercases it
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /wrote \d+ node/);
    const html = await readFile(out, "utf8");
    const graph = embeddedJson(html, "GRAPH");
    assert.equal(graph.focus, "term:dog");
    const labels = graph.nodes.map((n) => n.label);
    assert.ok(labels.includes("animal") && labels.includes("tail"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct viz --focus takes precedence over --term when both are given", async () => {
  const dir = await seededRepo();
  try {
    const out = join(dir, "graph.html");
    const res = runCli(dir, "--output", out, "--focus", "term:dog", "--term", "nonexistent-word-xyz");
    assert.equal(res.status, 0, res.stderr);
    const html = await readFile(out, "utf8");
    const graph = embeddedJson(html, "GRAPH");
    assert.equal(graph.focus, "term:dog");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct viz --edge-kind meta|relation|both parses and selects the walk-kind set; an unrecognized value falls back to the default (both)", async () => {
  const dir = await seededRepo();
  try {
    const outMeta = join(dir, "meta.html");
    const resMeta = runCli(dir, "--output", outMeta, "--edge-kind", "meta", "--term", "dog", "--depth", "4", "--limit", "50");
    assert.equal(resMeta.status, 0, resMeta.stderr);
    const metaHtml = await readFile(outMeta, "utf8");
    assert.equal(embeddedJson(metaHtml, "WALK_OPTS").edgeKindMode, "meta");
    const metaLabels = embeddedJson(metaHtml, "GRAPH").nodes.map((n) => n.label);
    assert.ok(!metaLabels.includes("tail"), "meta-only never reaches the concept term");

    const outBoth = join(dir, "both.html");
    const resBoth = runCli(dir, "--output", outBoth, "--edge-kind", "not-a-real-mode", "--term", "dog", "--depth", "4", "--limit", "50");
    assert.equal(resBoth.status, 0, resBoth.stderr);
    const bothHtml = await readFile(outBoth, "utf8");
    assert.equal(embeddedJson(bothHtml, "WALK_OPTS").edgeKindMode, "both", "an unrecognized --edge-kind value falls back to the default, never a crash");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct viz reports BOTH ask-engine bundles in its own summary line when both are present", async () => {
  const dir = await seededRepo();
  try {
    const out = join(dir, "graph.html");
    const res = runCli(dir, "--output", out);
    assert.equal(res.status, 0, res.stderr);
    // The checked-in bundles ship in this repo (npm run build:ask-bundle's
    // committed output) — both should be picked up and reported.
    assert.match(res.stdout, /embedded ask-the-graph chat panels?/);
    const html = await readFile(out, "utf8");
    assert.match(html, /globalThis\.tmctViz\s*=/);
    assert.match(html, /globalThis\.tmctMemoryAsk\s*=/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
