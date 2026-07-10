// source-multigraph.test.mjs — src/source.mjs's fetchEntities multi-graph
// branch (config.graphFiles.length > 1). The single-graph path (config.graphFile,
// or a one-element config.graphFiles) is exercised by every other existing
// test that calls fetchEntities and MUST stay byte-identical — this file only
// covers the NEW branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchEntities, clearCache } from "../src/source.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "tmct-srcmulti-"));

const graphPayload = (individuals) => JSON.stringify({
  generated_at: "2026-01-01T00:00:00Z",
  classes: [{ name: "Module", count: individuals.length }],
  vocabulary: [],
  objectProperties: [],
  individuals,
  proseIndex: {},
});

test("fetchEntities: config.graphFiles with 2 files merges them (no collision — ids untouched)", async () => {
  clearCache();
  const dir = await tmp();
  try {
    const fileA = join(dir, "a.json");
    const fileB = join(dir, "b.json");
    await writeFile(fileA, graphPayload([{ id: "mod:a.py", label: "a.py", class: "Module", derived_from: [], mentions: [] }]));
    await writeFile(fileB, graphPayload([{ id: "mod:b.py", label: "b.py", class: "Module", derived_from: [], mentions: [] }]));
    const payload = await fetchEntities({ graphFile: fileA, graphFiles: [fileA, fileB] });
    assert.deepEqual(payload.individuals.map((i) => i.id), ["mod:a.py", "mod:b.py"]);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fetchEntities: a missing file among graphFiles tolerates ENOENT per-file (bootstrap-empty for that one)", async () => {
  clearCache();
  const dir = await tmp();
  try {
    const fileA = join(dir, "a.json");
    const missing = join(dir, "does-not-exist.json");
    await writeFile(fileA, graphPayload([{ id: "mod:a.py", label: "a.py", class: "Module", derived_from: [], mentions: [] }]));
    const payload = await fetchEntities({ graphFile: fileA, graphFiles: [fileA, missing] });
    assert.deepEqual(payload.individuals.map((i) => i.id), ["mod:a.py"]);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fetchEntities: a single-element graphFiles array runs the UNCHANGED single-graph path", async () => {
  clearCache();
  const dir = await tmp();
  try {
    const fileA = join(dir, "a.json");
    await writeFile(fileA, graphPayload([{ id: "mod:a.py", label: "a.py", class: "Module", derived_from: [], mentions: [] }]));
    const payload = await fetchEntities({ graphFile: fileA, graphFiles: [fileA] });
    assert.deepEqual(payload.individuals.map((i) => i.id), ["mod:a.py"]);
    assert.equal(payload.bootstrap, undefined);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fetchEntities: plain config.graphFile only (no graphFiles at all) is untouched by the multi-graph branch", async () => {
  clearCache();
  const dir = await tmp();
  try {
    const fileA = join(dir, "a.json");
    await writeFile(fileA, graphPayload([{ id: "mod:a.py", label: "a.py", class: "Module", derived_from: [], mentions: [] }]));
    const payload = await fetchEntities({ graphFile: fileA });
    assert.deepEqual(payload.individuals.map((i) => i.id), ["mod:a.py"]);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fetchEntities: a real id collision across graphFiles gets prefixed via graphNames", async () => {
  clearCache();
  const dir = await tmp();
  try {
    const fileA = join(dir, "a.json");
    const fileB = join(dir, "b.json");
    await writeFile(fileA, graphPayload([{ id: "mod:shared.py", label: "shared.py", class: "Module", derived_from: [], mentions: [] }]));
    await writeFile(fileB, graphPayload([{ id: "mod:shared.py", label: "shared.py", class: "Module", derived_from: [], mentions: [] }]));
    const payload = await fetchEntities({
      graphFile: fileA, graphFiles: [fileA, fileB], graphNames: ["backend", "frontend"],
    });
    assert.deepEqual(payload.individuals.map((i) => i.id), ["backend/mod:shared.py", "frontend/mod:shared.py"]);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
