// Regression guard for PLAN_GRAPH_SCAN.md Phase 1: appendFacts (src/memory/core.mjs)
// used to run syncFactSources's six linear scans over payload.individuals / the
// statedBy edge list PER FACT in a batch, making one appendFacts call O(n^2) in
// the batch size n — an 8x bigger batch could take ~64x longer, not ~8x. The fix
// threads a mutateMemory-scoped id->individual / statedBy lookup index through
// upsertSource/upsertIndividual/upsertEdge/statedByObjectsFor/sourcesByIdMap so
// the same batch is O(n) instead. This test seeds two batch sizes with a large
// size gap through the REAL appendFacts and asserts wall-clock growth stays far
// below what quadratic growth would predict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFacts } from "../src/memory/core.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-mem-seed-perf-"));
}

// Unique subject/object per fact, one shared provenance tag — mirrors one
// corpus bundle's shape (PLAN_GRAPH_SCAN.md's own repro convention).
function syntheticFacts(n, tag) {
  const facts = [];
  for (let i = 0; i < n; i++) {
    facts.push({
      subject: `${tag}-subj-${i}`,
      predicate: "rdfs:subClassOf",
      object: `${tag}-obj-${i}`,
      provenance: `corpus:${tag}`,
    });
  }
  return facts;
}

/** Seed `n` facts into a fresh tmp dir and return the wall-clock ms. */
async function timeSeed(n, tag) {
  const dir = await tmpRepo();
  try {
    const t0 = Date.now();
    const res = await appendFacts(dir, syntheticFacts(n, tag));
    assert.equal(res.appended, n);
    return Date.now() - t0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** MIN of `trials` independent measurements — a single wall-clock sample is
 *  too noisy on a machine that may be running other concurrent agents/test
 *  suites (observed directly: the same 8x/10x-ceiling single-shot version of
 *  this test flaked twice under real contention, at 6.30x and 10.49x, despite
 *  the underlying fix being correct — confirmed separately via the real
 *  init:xl 72,075-fact CLI path dropping from ~8m25s to ~8s). Taking the
 *  minimum across several trials is the standard noise-filtering technique
 *  (as microbenchmark tools like hyperfine use): contention can only ever
 *  make a trial SLOWER than its true cost, never faster, so the minimum
 *  converges on the real, uncontended cost even when most trials are noisy. */
async function minSeedTime(n, tag, trials = 5) {
  let best = Infinity;
  for (let i = 0; i < trials; i++) best = Math.min(best, await timeSeed(n, `${tag}-${i}`));
  return best;
}

test("appendFacts: an 8x bigger batch takes well under 8x-squared as long — O(n) seeding, not O(n^2)", async () => {
  // 2,000 vs 16,000 facts (8x). Linear seed cost predicts ~8x wall-clock;
  // O(n^2) predicts up to ~64x. A 12x ceiling on the MIN-of-5 measurement for
  // each size still catches a real quadratic regression by a wide margin
  // while being robust to machine contention (see minSeedTime's own comment).
  const smallMs = await minSeedTime(2000, "perf-small");
  const largeMs = await minSeedTime(16000, "perf-large");

  const ratio = smallMs > 0 ? largeMs / smallMs : (largeMs > 0 ? Infinity : 1);
  assert.ok(
    ratio < 12,
    `16000-fact batch's best-of-5 took ${largeMs}ms vs 2000-fact batch's best-of-5 ${smallMs}ms ` +
      `(${ratio.toFixed(2)}x) — expected well under 12x for O(n) seeding`,
  );
});
