// memory/core.mjs versioning tests — snapshotMemory (manual-trigger primitive,
// NOT wired to any automatic call site) and the manifest.json / graph.v{N}.json
// discipline: numbered copies, retention pruning, and the resolveMemoryGraphFile
// seam A1 introduced to close the write-path desync between core.mjs's
// mutateMemory and fold.mjs's writeMemoryGraph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEMORY_GRAPH_REL, MEMORY_MANIFEST_REL, DEFAULT_RETENTION,
  appendFact, appendUtterance, loadMemory,
  resolveMemoryGraphFile, snapshotMemory,
} from "../src/adapters/memory/core.mjs";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-mem-vers-"));

test("resolveMemoryGraphFile: version=null is today's live path; a numeric version resolves graph.v{N}.json under the same dir", () => {
  const dir = "/some/repo";
  assert.equal(resolveMemoryGraphFile(dir), join(dir, MEMORY_GRAPH_REL));
  assert.equal(resolveMemoryGraphFile(dir, null), join(dir, MEMORY_GRAPH_REL));
  assert.equal(resolveMemoryGraphFile(dir, 0), join(dir, ".tmct", "memory", "graph.v0.json"));
  assert.equal(resolveMemoryGraphFile(dir, 3), join(dir, ".tmct", "memory", "graph.v3.json"));
});

test("snapshotMemory: no graph.json yet → a clean no-op, never an error", async () => {
  const dir = await tmpRepo();
  try {
    const res = await snapshotMemory(dir);
    assert.deepEqual(res, { skipped: true, version: null, prunedVersion: null });
    // no manifest, no versioned files were conjured out of nothing
    const memDir = join(dir, ".tmct", "memory");
    await assert.rejects(() => readdir(memDir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshotMemory: copies the PRE-snapshot graph.json to graph.v0.json, bumps manifest.version to 1, graph.json stays live+current", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer" });
    const liveBefore = await readFile(resolveMemoryGraphFile(dir), "utf8");

    const res = await snapshotMemory(dir);
    assert.deepEqual(res, { skipped: false, version: 0, prunedVersion: null });

    const snap0 = await readFile(resolveMemoryGraphFile(dir, 0), "utf8");
    assert.equal(snap0, liveBefore, "the numbered snapshot is a byte-identical copy of the pre-snapshot live graph");

    const manifest = JSON.parse(await readFile(join(dir, MEMORY_MANIFEST_REL), "utf8"));
    assert.deepEqual(manifest, { version: 1, retentionVersions: DEFAULT_RETENTION });

    // graph.json is UNTOUCHED — still the live file, still readable/loadable
    const liveAfter = await readFile(resolveMemoryGraphFile(dir), "utf8");
    assert.equal(liveAfter, liveBefore, "graph.json itself is never renamed/touched by a snapshot");
    const m = await loadMemory(dir);
    assert.equal(m.individuals.filter((i) => i.class === "Fact").length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshotMemory: loadMemory/mutateMemory (via appendFact/appendUtterance) keep working unchanged regardless of manifest state", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: "isa", object: "b" });
    await snapshotMemory(dir);
    await snapshotMemory(dir);
    // further live mutation after two snapshots — the live file is still the
    // one and only thing appendFact/appendUtterance ever read or write
    await appendFact(dir, { subject: "c", predicate: "isa", object: "d" });
    await appendUtterance(dir, { role: "visitor", text: "hi", ts: "2026-07-05T00:00:00.000Z", sessionId: "0189dddd-0000-7000-8000-000000000000" });
    const m = await loadMemory(dir);
    assert.equal(m.individuals.filter((i) => i.class === "Fact").length, 2);
    assert.equal(m.individuals.filter((i) => i.class === "Utterance").length, 1);
    // and the manifest kept advancing independently of the live file's content
    const manifest = JSON.parse(await readFile(join(dir, MEMORY_MANIFEST_REL), "utf8"));
    assert.equal(manifest.version, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshotMemory: repeated snapshots produce a correct v0, v1, v2… sequence, one manifest bump per call", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "seed", predicate: "isa", object: "thing" });
    for (let i = 0; i < 4; i += 1) {
      // snapshot BEFORE this iteration's mutation lands, so v{i} captures
      // exactly "seed + s0..s{i-1}" — never s{i} itself, which only lands
      // in the live graph (and the NEXT snapshot) after this call returns.
      const res = await snapshotMemory(dir);
      assert.equal(res.version, i);
      await appendFact(dir, { subject: `s${i}`, predicate: "isa", object: "thing" });
    }
    const manifest = JSON.parse(await readFile(join(dir, MEMORY_MANIFEST_REL), "utf8"));
    assert.equal(manifest.version, 4);
    for (let i = 0; i < 4; i += 1) {
      const snap = JSON.parse(await readFile(resolveMemoryGraphFile(dir, i), "utf8"));
      const facts = snap.individuals.filter((x) => x.class === "Fact").map((x) => x.attributes.find((a) => a.key === "subject")?.value);
      assert.ok(!facts.includes(`s${i}`), `v${i} predates s${i}`);
      assert.equal(facts.length, i + 1, `v${i} carries seed + s0..s${i - 1}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshotMemory: retention prunes the oldest snapshot beyond the window, keeping exactly retentionVersions files", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "seed", predicate: "isa", object: "thing" });
    const retentionVersions = 3;
    const prunedAt = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await snapshotMemory(dir, { retentionVersions });
      if (res.prunedVersion !== null) prunedAt.push(res.prunedVersion);
    }
    // v0..v5 written across 6 calls; retention=3 → v0,v1,v2 pruned as the window slides
    assert.deepEqual(prunedAt, [0, 1, 2]);
    const names = (await readdir(join(dir, ".tmct", "memory"))).filter((n) => /^graph\.v\d+\.json$/.test(n));
    assert.deepEqual(names.sort(), ["graph.v3.json", "graph.v4.json", "graph.v5.json"], "exactly retentionVersions snapshots remain, the sliding window");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshotMemory: an already-present manifest.retentionVersions wins over a later opts.retentionVersions (persisted setting is authoritative)", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "seed", predicate: "isa", object: "thing" });
    await snapshotMemory(dir, { retentionVersions: 2 }); // bootstraps manifest.retentionVersions = 2
    let manifest = JSON.parse(await readFile(join(dir, MEMORY_MANIFEST_REL), "utf8"));
    assert.equal(manifest.retentionVersions, 2);
    await snapshotMemory(dir, { retentionVersions: 99 }); // ignored — manifest already set
    manifest = JSON.parse(await readFile(join(dir, MEMORY_MANIFEST_REL), "utf8"));
    assert.equal(manifest.retentionVersions, 2, "the persisted manifest value is authoritative once it exists");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshotMemory: manifest bootstrap defaults retentionVersions to DEFAULT_RETENTION when no opts given", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "seed", predicate: "isa", object: "thing" });
    await snapshotMemory(dir);
    const manifest = JSON.parse(await readFile(join(dir, MEMORY_MANIFEST_REL), "utf8"));
    assert.equal(manifest.retentionVersions, DEFAULT_RETENTION);
    assert.equal(DEFAULT_RETENTION, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- A1 desync proof: core.mjs's write path and fold.mjs's writeMemoryGraph
// resolve to the EXACT SAME file — no divergent file is ever created by the two
// independent writers.
test("A1 desync proof: mutateMemory (core.mjs) and writeMemoryGraph (fold.mjs) write to the exact same resolved file", async () => {
  const dir = await tmpRepo();
  try {
    // core.mjs's write path: any public mutator funnels through mutateMemory.
    await appendFact(dir, { subject: "a", predicate: "isa", object: "b" });

    // fold.mjs's write path: canoniseLinkSession's writeMemoryGraph, exercised
    // indirectly via foldSessionLogs so we drive the REAL fold.mjs code path
    // (not a re-implementation) against the same tmp dir.
    const { foldSessionLogs } = await import("../src/domain/memory/fold.mjs");
    await foldSessionLogs(dir); // no sessions recorded — a clean no-op write-free pass, proves no divergent file appears either

    const memDir = join(dir, ".tmct", "memory");
    const names = await readdir(memDir);
    const graphFiles = names.filter((n) => n === "graph.json" || (n.startsWith("graph") && n.endsWith(".json") && !n.includes(".tmp-")));
    // exactly one live graph file exists — both writers agree on ONE path
    assert.deepEqual(graphFiles, ["graph.json"], `no divergent graph file: ${names}`);

    // now prove it more directly: hand-roll a session so canoniseLinkSession's
    // writeMemoryGraph actually fires, and confirm the SAME file core.mjs reads
    // reflects its edges — i.e. resolveMemoryGraphFile(dir) really is the one
    // file both writers touch.
    const S = "0189eeee-0000-7000-8000-000000000000";
    const TA = "2026-07-05T00:00:00.000Z";
    await import("../src/adapters/memory/core.mjs").then(({ appendUtterances }) =>
      appendUtterances(dir, [{ role: "visitor", text: "every cache is a store", ts: TA, sessionId: S }]));
    await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "store", provenance: `ace:chat:${S}@${TA}` });
    await mkdirSidecar(dir, S, TA);
    await foldSessionLogs(dir, { sessionId: S });

    // writeMemoryGraph's edge is visible via loadMemory (core.mjs's OWN read
    // path) — proving both writers resolved to the SAME file, never two.
    const after = await loadMemory(dir);
    const links = (after.objectProperties || []).find((g) => g.prop === "mgx:canonicalisedFrom");
    assert.ok(links && links.examples.length > 0, "fold.mjs's write landed on the exact file core.mjs reads back");

    const namesAfter = (await readdir(memDir)).filter((n) => n === "graph.json" || (/^graph\.v\d+\.json$/.test(n)));
    assert.deepEqual(namesAfter, ["graph.json"], "still exactly one live graph file after both writers ran");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Minimal sidecar so foldSessionLogs({sessionId}) processes session S — the
 *  test only needs canoniseLinkSession's writeMemoryGraph to fire, not a real
 *  transcript/fold. */
async function mkdirSidecar(dir, id, ts) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, ".tmct", "sessions"), { recursive: true });
  const sidecar = [
    JSON.stringify({ type: "session", id, started: ts, repo: "/r" }),
    JSON.stringify({ type: "turn", ts, query: "every cache is a store", via: "assert" }),
  ].join("\n") + "\n";
  await writeFile(join(dir, ".tmct", "sessions", `session-${id}.jsonl`), sidecar);
}
