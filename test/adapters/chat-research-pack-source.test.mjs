// The "research <topic>" chat lane run against the offline pack-backed
// source (simple-wikipedia-pack): no network reachable at all, yet the turn
// grounds facts from the shipped reference pack and reports the same
// "stored N facts"/queued-topics reply shape every other research source
// produces — the pack source needs zero changes to research.mjs or chat.mjs's
// turn-reporting to work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

async function freshRepo() {
  return mkdtemp(join(tmpdir(), "tmct-research-pack-source-"));
}

function turn(line, { memoryDir }) {
  return runTurn(line, { config: null, memoryDir, researchSource: "simple-wikipedia-pack" });
}

test("a research turn against the pack source grounds facts and reports the standard reply, with fetch never called", async () => {
  const dir = await freshRepo();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("the pack-backed research source must never reach the network"); };
  try {
    const r = await turn("research owl, limit 3", { memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.equal(r.record.via, "research");
    assert.match(r.answer, /^owl — Owls are birds in the order Strigiformes\./);
    assert.match(r.answer, /source: research article "Owl", Simple English Wikipedia, CC BY-SA 4\.0/);
    assert.match(r.answer, /stored \d+ facts? from "Owl"\./);
    assert.match(r.answer, /queued 3 linked topics: /);

    const rows = readFactRows(await loadMemory(dir));
    const isa = rows.find((f) => f.subject === "owl" && f.predicate === "rdfs:subClassOf" && f.object === "bird");
    assert.ok(isa, "the depth-0 article's isa lands as a fact");
    assert.equal(isa.provenance, "research:owl@0", "the interactive lane's own source-agnostic tag, unaffected by which source grounded the turn");

    assert.ok(r.researchState, "queue state rides the turn result");
    assert.ok(r.researchState.pending.length > 0, "the pack's own cross-references queued further topics");
    assert.equal(r.record.research.complete, false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("research next steps the pack-source queue with no network, stamping the run's topic at depth 1", async () => {
  const dir = await freshRepo();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("the pack-backed research source must never reach the network"); };
  try {
    const start = await turn("research owl, limit 3", { memoryDir: dir });
    const step = await turn("research next", { memoryDir: dir, researchState: start.researchState });
    assert.equal(step.record.miss, false);
    assert.match(step.answer, /stored \d+ facts? from/);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((f) => /^research:owl@1/.test(f.provenance)), "depth-1 facts stamp the run's topic at depth 1");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a topic the shipped pack does not carry is a plain miss, no network attempted, nothing stored", async () => {
  const dir = await freshRepo();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("the pack-backed research source must never reach the network"); };
  try {
    const r = await turn("research zorblattian nonsense term", { memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /couldn't ground .* Nothing was stored\./);
    assert.deepEqual(readFactRows(await loadMemory(dir)), []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
