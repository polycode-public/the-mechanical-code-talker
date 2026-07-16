// Memory inspection: the shared text renderer over
// a seeded fixture memory, the /memory chat command, and the `tmct memory` CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sampleSize, balancedSample, renderMemory, inspectMemory } from "../../src/adapters/memory/inspect.mjs";
import { appendFact, appendUtterances } from "../../src/adapters/memory/core.mjs";
import { saveBlock } from "../../src/adapters/memory/blocks.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const BIN = fileURLToPath(new URL("../../bin/tmct.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const SESSION = "0189aaaa-0000-7000-8000-000000000000";

/** A seeded fixture memory: 12 facts (one dual-provenance), one Q/A utterance
 *  pair in a session, one folded block. */
async function seededMemory() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-inspect-"));
  for (let i = 0; i < 11; i += 1) {
    await appendFact(dir, { subject: `thing ${i}`, predicate: "rdfs:subClassOf", object: "artifact", provenance: "corpus:test /r/IsA" });
  }
  // the dual-provenance fact: corpus AND chat agree → tops the breadth ranking
  await appendFact(dir, { subject: "module", predicate: "rdfs:subClassOf", object: "component", provenance: "corpus:test /r/IsA" });
  await appendFact(dir, { subject: "module", predicate: "rdfs:subClassOf", object: "component", provenance: `ace:chat:${SESSION}@2026-07-04T10:00:00.000Z` });
  await appendUtterances(dir, [
    { role: "visitor", text: "which modules import a.mjs", ts: "2026-07-04T10:00:01.000Z", sessionId: SESSION },
    { role: "tmct", text: "app/lib/b.mjs and app/lib/c.mjs.", ts: "2026-07-04T10:00:01.000Z", sessionId: SESSION, replyTo: `utt:${SESSION}#2026-07-04T10:00:01.000Z#visitor` },
  ]);
  await saveBlock(dir, { id: SESSION, text: "Q: which modules import a.mjs\nA: app/lib/b.mjs and app/lib/c.mjs." });
  return dir;
}

test("sampleSize: log-scaled — 10,000 → 8, 500 → 5, 3 → all 3, 1 → 1; verbose doubles", () => {
  assert.equal(sampleSize(10000), 8);
  assert.equal(sampleSize(500), 5);
  assert.equal(sampleSize(3), 3);
  assert.equal(sampleSize(1), 1);
  assert.equal(sampleSize(10000, { verbose: true }), 16);
  assert.equal(sampleSize(4, { verbose: true }), 4, "verbose never exceeds the class size");
});

test("balancedSample: deterministic, evenly spaced, spans first to last", () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(balancedSample(items, 3), [0, 4.5, 9].map(Math.round));
  assert.deepEqual(balancedSample(items, 20), items, "k ≥ n returns everything");
  assert.deepEqual(balancedSample(items, 1), [0]);
});

test("renderMemory over the seeded fixture: classes+samples, provenance breadth, Q→A, blocks", async () => {
  const dir = await seededMemory();
  try {
    const text = await inspectMemory(dir);
    // Sources are now first-class individuals (2: the corpus + the operator-chat)
    assert.match(text, /^memory — \d+ individuals: 12 Fact, 2 Source, 2 Utterance, 1 Session\./);
    assert.match(text, /Fact — 12 \(showing 3\)/, "12 facts → log-scaled 3 samples (terse)");
    assert.match(text, /Source — 2 \(showing 2\)/, "Source is counted + sampled like any class");
    assert.match(text, /Session — 1 \(showing 1\)/);
    // provenance breadth upgraded to COMPUTED TRUST: the corroborated operator+corpus
    // fact (trust 1.00) tops the lone-corpus facts (0.70)
    assert.match(text, /top facts by trust:\n {2}module rdfs:subClassOf component — trust 1\.00, 2 sources: /,
      "the corpus+chat-corroborated fact ranks first by trust");
    assert.match(text, /recent Q→A pairs \(1 recorded\):\n {2}Q: which modules import a\.mjs\n {2}A: app\/lib\/b\.mjs/);
    assert.match(text, /blocks — 1 folded session block, \d+ indexed tokens\./);
    assert.match(text, /top by rank: 0189aaaa \(1\.000\)/);

    const verbose = await inspectMemory(dir, { verbose: true });
    assert.match(verbose, /Fact — 12 \(showing 6\)/, "verbose doubles the sample");
    assert.match(verbose, /ace:chat:0189aaaa-0000-7000-8000-000000000000@2026-07-04T10:00:00\.000Z/,
      "verbose shows provenance (the compat shim) in full, verbatim");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderMemory: the empty store is the honest empty story, never an error", () => {
  const text = renderMemory({ memory: { individuals: [] }, blocks: { blocks: {} } });
  assert.match(text, /memory is empty — nothing remembered yet/);
  assert.match(text, /blocks — none folded yet/);
});

test("/memory chat command: same renderer, recorded as a command turn; no store → honest miss", async () => {
  const dir = await seededMemory();
  try {
    const r = await runTurn("/memory", { config: { graphFile: FIXTURE }, memoryDir: dir });
    assert.match(r.answer, /memory — \d+ individuals: 12 Fact/);
    assert.equal(r.record.command, "memory");
    assert.equal(r.record.via, "command");

    const verbose = await runTurn("/memory verbose", { config: { graphFile: FIXTURE }, memoryDir: dir });
    assert.match(verbose.answer, /Fact — 12 \(showing 6\)/);

    const bare = await runTurn("/memory", { config: { graphFile: FIXTURE } });
    assert.match(bare.answer, /no memory store here/);
    assert.equal(bare.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct memory CLI: renders the same inspection text, exit 0", async () => {
  const dir = await seededMemory();
  try {
    const r = spawnSync(process.execPath, [BIN, "memory", "--repo", dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /memory — \d+ individuals: 12 Fact, 2 Source, 2 Utterance, 1 Session\./);
    assert.match(r.stdout, /top facts by trust:/);
    const v = spawnSync(process.execPath, [BIN, "memory", "--repo", dir, "--verbose"], { encoding: "utf8" });
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /Fact — 12 \(showing 6\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
