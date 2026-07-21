// openMemoryBackend's DEFAULT routing: the empty and "default" tokens resolve
// to the sqlite store (.tmct/memory/graph.sqlite) — the flat-file Backend A is
// retired from routing. This suite proves the routing itself, the one-line
// legacy-graph.json notice (printed only while graph.json exists WITHOUT a
// sqlite store beside it, and never twice), the untouched-legacy-file
// guarantee, the "memory" bypass, and that the fold's canonise-link idle pass
// reaches the routed store rather than writing a flat file nothing reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICALISED_FROM_PROP, FACT_CLASS,
  appendFact, appendUtterances, loadMemory, openMemoryBackend, readFactRows,
} from "../../src/adapters/memory/core.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-mem-default-"));
}

async function memoryEntries(dir) {
  try { return await readdir(join(dir, ".tmct", "memory")); } catch (e) { if (e?.code === "ENOENT") return []; throw e; }
}

/** Run `fn` with process.stderr.write captured; returns the captured text. */
async function captureStderr(fn) {
  const lines = [];
  const real = process.stderr.write;
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { await fn(); } finally { process.stderr.write = real; }
  return lines.join("");
}

test("openMemoryBackend(repo, \"\"): the empty token routes to sqlite — facts round-trip and no graph.json appears", async () => {
  const dir = await tmpRepo();
  try {
    const a = await openMemoryBackend(dir, "");
    assert.equal(a.dir?.backend, "sqlite", "the default token opens a Backend C handle");
    await appendFact(a.dir, { subject: "cat", predicate: "rdfs:subClassOf", object: "animal" });
    await a.close();

    const b = await openMemoryBackend(dir, "");
    const rows = readFactRows(await loadMemory(b.dir));
    assert.ok(rows.some((r) => r.subject === "cat" && r.object === "animal"), "the fact survives close + reopen");
    await b.close();

    const entries = await memoryEntries(dir);
    assert.ok(entries.includes("graph.sqlite"), "the sqlite store exists on disk");
    assert.ok(!entries.includes("graph.json"), "the retired flat-file store is never created by routing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("openMemoryBackend(repo, \"default\") behaves exactly like the empty token — sqlite", async () => {
  const dir = await tmpRepo();
  try {
    const { dir: handle, close } = await openMemoryBackend(dir, "default");
    assert.equal(handle?.backend, "sqlite");
    await close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a pre-existing graph.json prints the retirement notice ONCE, is left untouched, and goes silent once graph.sqlite exists", async () => {
  const dir = await tmpRepo();
  try {
    const legacy = join(dir, ".tmct", "memory", "graph.json");
    await mkdir(join(dir, ".tmct", "memory"), { recursive: true });
    const legacyText = JSON.stringify({ memory: true, individuals: [] });
    await writeFile(legacy, legacyText);

    const first = await captureStderr(async () => {
      const { close } = await openMemoryBackend(dir, "");
      await close();
    });
    const NOTICE = "found .tmct/memory/graph.json — the flat-file memory backend is retired; starting a fresh sqlite store (the old file is left untouched)";
    assert.equal(first.split(NOTICE).length - 1, 1, "exactly one notice line on the first open");

    const second = await captureStderr(async () => {
      const { close } = await openMemoryBackend(dir, "");
      await close();
    });
    assert.equal(second.includes(NOTICE), false, "no notice once the sqlite store exists beside the old file");

    assert.equal(await readFile(legacy, "utf8"), legacyText, "the old file is byte-identical — no migration, no rewrite");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("openMemoryBackend(repo, \"memory\") still bypasses sqlite entirely — an in-process handle, nothing on disk", async () => {
  const dir = await tmpRepo();
  try {
    const { dir: handle, close } = await openMemoryBackend(dir, "memory");
    assert.equal(handle?.backend, "memory");
    await appendFact(handle, { subject: "cat", predicate: "rdfs:subClassOf", object: "animal" });
    assert.equal(readFactRows(await loadMemory(handle)).length, 1);
    await close();
    assert.deepEqual(await memoryEntries(dir), [], "no .tmct/memory files at all");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- The fold's canonise-link idle pass reaches the ROUTED store -----------
// foldSessionLogs only ever has the repo path in hand; it must resolve the
// configured backend (here: the sqlite default) and write its
// mgx:canonicalisedFrom edges there — never into a flat graph.json.

test("foldSessionLogs: canonise-link edges land in the routed sqlite store, and no flat graph.json is written", async () => {
  const S = "01890000-0000-7000-8000-00000000f01d";
  const TA = "2026-07-05T00:00:00.000Z";
  const dir = await tmpRepo();
  try {
    const { dir: handle, close } = await openMemoryBackend(dir, "");
    await appendUtterances(handle, [
      { role: "visitor", text: "every cache is a store", ts: TA, sessionId: S, sessionStarted: TA },
    ]);
    await appendFact(handle, {
      subject: "cache", predicate: "rdfs:subClassOf", object: "store",
      provenance: `ace:chat:${S}@${TA}`,
    });
    await close();

    await mkdir(join(dir, ".tmct", "sessions"), { recursive: true });
    const sidecar = [
      JSON.stringify({ type: "session", id: S, started: TA, repo: "/r" }),
      JSON.stringify({ type: "turn", ts: TA, query: "every cache is a store", via: "assert" }),
    ].join("\n") + "\n";
    await writeFile(join(dir, ".tmct", "sessions", `session-${S}.jsonl`), sidecar);

    const { foldSessionLogs } = await import("../../src/services/fold.mjs");
    await foldSessionLogs(dir, { sessionId: S });

    const { dir: after, close: closeAfter } = await openMemoryBackend(dir, "");
    const memory = await loadMemory(after);
    await closeAfter();
    const fact = memory.individuals.find((i) => i.class === FACT_CLASS);
    const links = (memory.objectProperties || []).find((g) => g.prop === CANONICALISED_FROM_PROP);
    assert.ok(links, "an mgx:canonicalisedFrom relation exists in the routed store");
    assert.ok(
      links.examples.some((e) => e.subject === fact.id && e.object === `utt:${S}#${TA}#visitor`),
      "the canonical Fact edges back to its as-spoken utterance",
    );
    assert.ok(!(await memoryEntries(dir)).includes("graph.json"), "the fold never writes the retired flat file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
