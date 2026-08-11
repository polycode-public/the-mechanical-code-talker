// The news worker over a seed held as a read-only sqlite store instead of a
// parsed payload. What this suite holds:
//
//   - a cycle answers the same over either seed, and writes the same rows;
//   - the seed is still read-only: putRows never receives a seed row;
//   - a cycle narrates its phases, and the console seam stamps every line;
//   - a fixture cycle's peak heap stays under a stated budget, so the copies
//     the sqlite path removed cannot creep back in unnoticed.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { createNewsWorker, logToConsole } from "../../server/news-worker/handler.mjs";
import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import {
  createSqliteMemoryStore, closeSqliteMemoryStore, openSqliteSeedStore,
  appendFacts, loadMemory,
} from "../../src/adapters/memory/core.mjs";
import { payloadToRows } from "../../src/adapters/memory/rows.mjs";

const execFile = promisify(execFileCallback);

const SESSION = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const SEED_AT = "2026-07-10T10:00:00.000Z";

// Big enough that a second copy of it would show up in the heap reading below,
// small enough that building it costs a fraction of a second. The production
// seed is ~30x this.
const SEED_FACT_COUNT = 2000;

function seedFacts(count = SEED_FACT_COUNT) {
  const facts = [];
  for (let i = 0; i < count; i += 1) {
    facts.push({
      subject: `subject${i}`, predicate: "IsA", object: `class${i % 40}`,
      provenance: "corpus:conceptnet", createdAt: SEED_AT,
    });
  }
  return facts;
}

/** A pre-built seed file plus the payload the same store hands back, so a test
 *  can run one cycle each way over one graph. */
async function buildSeed(count) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-worker-seed-"));
  const dbPath = join(dir, "xl-seed.sqlite");
  const writable = await createSqliteMemoryStore(dbPath);
  await appendFacts(writable, seedFacts(count));
  const payload = await loadMemory(writable);
  closeSqliteMemoryStore(writable);
  const store = await openSqliteSeedStore(dbPath);
  return { payload, store, dbPath, async cleanup() { closeSqliteMemoryStore(store); await rm(dir, { recursive: true, force: true }); } };
}

/** A session backend that remembers every key `putRows` was asked to write. */
function recordingBackend() {
  const inner = createRowMemoryBackend();
  const writtenKeys = [];
  return {
    writtenKeys,
    inner,
    backend: {
      ...inner,
      async putRows(rows) { for (const row of rows) writtenKeys.push(row.rowKey); return inner.putRows(rows); },
    },
  };
}

async function runIngestCycle({ seedPayload = null, seedStore = null, backend, log = () => {} }) {
  const worker = createNewsWorker({
    createSessionBackend: () => backend,
    seedPayload,
    seedStore,
    now: () => "2026-07-11T10:00:00.000Z",
    log,
  });
  return worker.runCycle({ sessionKey: SESSION, cycleId: "cycle-1", mode: "ingest", body: { text: "A dog is a mammal." } });
}

test("a cycle over a sqlite seed writes the same session rows as the same seed as a payload", async () => {
  const seed = await buildSeed(12);
  try {
    const fromPayload = recordingBackend();
    await runIngestCycle({ seedPayload: seed.payload, backend: fromPayload.backend });

    const fromStore = recordingBackend();
    await runIngestCycle({ seedStore: seed.store, backend: fromStore.backend });

    assert.ok(fromStore.writtenKeys.length, "the cycle taught something");
    assert.deepEqual(fromStore.writtenKeys.sort(), fromPayload.writtenKeys.sort(), "the seam changed no write");
  } finally {
    await seed.cleanup();
  }
});

test("a cycle over a sqlite seed never writes a seed row back", async () => {
  const seed = await buildSeed(200);
  try {
    const seedKeys = new Set(payloadToRows(seed.payload, { onOversizedRow: "keep" }).map((r) => r.rowKey));
    const session = recordingBackend();
    await runIngestCycle({ seedStore: seed.store, backend: session.backend });

    assert.ok(session.writtenKeys.length, "the cycle taught something");
    for (const key of session.writtenKeys) {
      assert.equal(seedKeys.has(key), false, `putRows received the seed row ${key}`);
    }
  } finally {
    await seed.cleanup();
  }
});

test("a cycle narrates start, each phase and the end, carrying its own memory readout", async () => {
  const seed = await buildSeed(200);
  const entries = [];
  try {
    await runIngestCycle({ seedStore: seed.store, backend: recordingBackend().backend, log: (entry) => entries.push(entry) });
  } finally {
    await seed.cleanup();
  }

  assert.deepEqual(
    entries.map((e) => e.event), ["cycle-start", "phase-done", "phase-done", "cycle-end"],
  );
  assert.equal(entries[0].seed, "sqlite", "the narration says which seed source the cycle opened");
  assert.deepEqual(entries.slice(1, 3).map((e) => e.phase), ["ingest", "materialize"]);
  const end = entries.at(-1);
  assert.ok(Number.isFinite(end.ms), "the cycle's own duration is on the line");
  for (const key of ["peakHeapMb", "heapGrowthMb", "maxRssMb", "maxRssGrowthMb"]) {
    assert.ok(Number.isFinite(end[key]), `${key} is a number the log can be read for`);
  }
});

test("the console log seam stamps every line, so a deployed cycle is readable in order", () => {
  const lines = [];
  const realLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    logToConsole({ event: "cycle-start", mode: "poll" });
  } finally {
    console.log = realLog;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z news-worker \{"event":"cycle-start","mode":"poll"\}$/);
});

// The measured peak, not a guess: one cycle over a 2,000-fact seed in a clean
// process peaked at 105.5-105.8 MB across repeated runs when this landed, and
// the budget takes its headroom from there. It is measured in a CHILD process
// on purpose — a peak read inside this file would carry whatever the tests
// above it left on the heap, and would drift with GC timing on a saturated
// machine; a fresh process reads the cycle alone and reads it the same every
// time. What the budget catches is another copy of the seed coming back: the
// row projection this path removed is tens of megabytes at this seed size.
const CYCLE_PEAK_HEAP_BUDGET_MB = 140;

const CYCLE_PROBE = `
const [handlerHref, coreHref, backendHref, dbPath] = process.argv.slice(1);
const { createNewsWorker } = await import(handlerHref);
const { openSqliteSeedStore, closeSqliteMemoryStore } = await import(coreHref);
const { createRowMemoryBackend } = await import(backendHref);
let peakHeapBytes = 0;
const sample = () => { const h = process.memoryUsage().heapUsed; if (h > peakHeapBytes) peakHeapBytes = h; };
setInterval(sample, 20).unref();
const seedStore = await openSqliteSeedStore(dbPath);
const worker = createNewsWorker({
  createSessionBackend: () => createRowMemoryBackend(),
  seedStore,
  now: () => "2026-07-11T10:00:00.000Z",
});
await worker.runCycle({ sessionKey: "${SESSION}", cycleId: "probe", mode: "ingest", body: { text: "A dog is a mammal." } });
closeSqliteMemoryStore(seedStore);
sample();
console.log(JSON.stringify({ peakHeapMb: Math.round((peakHeapBytes / (1024 * 1024)) * 10) / 10 }));
`;

const hrefOf = (relative) => new URL(relative, import.meta.url).href;

test("a fixture cycle's peak heap stays under its budget", async () => {
  const seed = await buildSeed();
  let stdout;
  try {
    ({ stdout } = await execFile(process.execPath, [
      "--input-type=module", "-e", CYCLE_PROBE,
      hrefOf("../../server/news-worker/handler.mjs"),
      hrefOf("../../src/adapters/memory/core.mjs"),
      hrefOf("../../src/adapters/memory/row-backend-memory.mjs"),
      seed.dbPath,
    ]));
  } finally {
    await seed.cleanup();
  }

  const { peakHeapMb } = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.ok(
    peakHeapMb < CYCLE_PEAK_HEAP_BUDGET_MB,
    `a cycle over a ${SEED_FACT_COUNT}-fact sqlite seed peaked at ${peakHeapMb} MB, over the ${CYCLE_PEAK_HEAP_BUDGET_MB} MB budget`,
  );
});
