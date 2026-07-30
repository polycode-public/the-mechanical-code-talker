// Read-path perf guard for the sqlite `facts` projection (src/adapters/memory/
// core.mjs). Every read used to start with `SELECT json FROM individuals ORDER
// BY ord` — the WHOLE store — and answer "which facts are about dog" with a JS
// array scan over it. The projection gives the same question real columns and a
// (subject, predicate) index, so the database answers it directly. This test
// measures both paths against one seeded store and asserts the indexed lookup
// is faster by a wide margin; its sibling memory-seed-perf.test.mjs covers the
// WRITE batch, and nothing covered the read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSqliteMemoryStore, closeSqliteMemoryStore, appendFacts, loadMemory, FACT_CLASS,
} from "../../src/adapters/memory/core.mjs";

// Big enough that loading the whole store costs real time, small enough that
// seeding it stays a few seconds. The gap the guard measures widens with store
// size, so a bigger seed would only make the assertion easier to pass.
const SEED_FACTS = 4000;
const TARGET_SUBJECT = "read-perf-subj-2000";

/** MIN of `trials` measurements, the same noise filter memory-seed-perf.test.mjs
 *  uses and for the same reason: this machine may be running other agents and
 *  test suites, and contention can only ever make a trial slower than its true
 *  cost, so the minimum converges on the uncontended cost. */
function minMs(trials, run) {
  let best = Infinity;
  for (let i = 0; i < trials; i++) {
    const t0 = performance.now();
    run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

async function minMsAsync(trials, run) {
  let best = Infinity;
  for (let i = 0; i < trials; i++) {
    const t0 = performance.now();
    await run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

test("facts projection: an indexed SELECT by subject beats loading the whole store and scanning it, by orders of magnitude", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-facts-read-perf-"));
  const handle = await createSqliteMemoryStore(join(dir, "graph.sqlite"));
  try {
    const facts = [];
    for (let i = 0; i < SEED_FACTS; i++) {
      facts.push({
        subject: `read-perf-subj-${i}`,
        predicate: "rdfs:subClassOf",
        object: `read-perf-obj-${i}`,
        provenance: "corpus:conceptnet /r/IsA",
      });
    }
    assert.equal((await appendFacts(handle, facts)).appended, SEED_FACTS);

    const indexed = handle.db.prepare("SELECT json FROM facts WHERE subject = ?");
    // Both paths answer the SAME question and are checked for the same answer,
    // so neither can win by doing less work.
    const indexedHits = () => indexed.all(TARGET_SUBJECT).map((r) => JSON.parse(r.json));
    const scannedHits = async () => {
      const memory = await loadMemory(handle);
      return (memory.individuals || []).filter((ind) => ind?.class === FACT_CLASS
        && (ind.attributes || []).find((a) => a?.prop === "rdf:subject")?.value === TARGET_SUBJECT);
    };
    assert.equal(indexedHits().length, 1);
    assert.equal((await scannedHits()).length, 1);
    assert.equal(indexedHits()[0].id, (await scannedHits())[0].id, "both paths resolve the same fact");

    const indexedMs = minMs(5, indexedHits);
    // loadMemory serves later calls from handle.cachedPayload, so this is the
    // FASTER of the two shapes today's readers see (a cold read rebuilds the
    // payload from SQL first) — the guard compares against the better one.
    const scanMs = await minMsAsync(5, scannedHits);

    const ratio = indexedMs > 0 ? scanMs / indexedMs : Infinity;
    assert.ok(
      ratio > 25,
      `indexed SELECT best-of-5 ${indexedMs.toFixed(3)}ms vs load-and-scan best-of-5 ${scanMs.toFixed(3)}ms `
        + `(${ratio.toFixed(1)}x) over ${SEED_FACTS} facts — expected the indexed read to be far faster`,
    );
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});

test("facts projection: the subject lookup uses the (subject, predicate) index rather than scanning the table", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-facts-read-plan-"));
  const handle = await createSqliteMemoryStore(join(dir, "graph.sqlite"));
  try {
    await appendFacts(handle, [
      { subject: "dog", predicate: "capableOf", object: "bark", provenance: "corpus:conceptnet /r/CapableOf" },
      { subject: "cat", predicate: "capableOf", object: "purr", provenance: "corpus:conceptnet /r/CapableOf" },
    ]);
    const plan = handle.db.prepare("EXPLAIN QUERY PLAN SELECT json FROM facts WHERE subject = ?").all("dog")
      .map((r) => r.detail).join(" ");
    assert.match(plan, /USING INDEX facts_by_subject_predicate/);
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});
