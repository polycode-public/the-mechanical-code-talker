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

test("appendFacts: an 8x bigger batch takes well under 8x-squared as long — O(n) seeding, not O(n^2)", async () => {
  const dirSmall = await tmpRepo();
  const dirLarge = await tmpRepo();
  try {
    const small = syntheticFacts(1000, "perf-small");
    const large = syntheticFacts(8000, "perf-large");

    const t0 = Date.now();
    const resSmall = await appendFacts(dirSmall, small);
    const smallMs = Date.now() - t0;

    const t1 = Date.now();
    const resLarge = await appendFacts(dirLarge, large);
    const largeMs = Date.now() - t1;

    assert.equal(resSmall.appended, 1000);
    assert.equal(resLarge.appended, 8000);

    // 8x more facts. Linear seed cost predicts ~8x wall-clock; O(n^2) predicts
    // up to ~64x. A 6x ceiling catches a real quadratic regression while
    // tolerating normal timing noise (GC, a busy machine running other agents).
    const ratio = smallMs > 0 ? largeMs / smallMs : (largeMs > 0 ? Infinity : 1);
    assert.ok(
      ratio < 6,
      `8000-fact batch took ${largeMs}ms vs 1000-fact batch's ${smallMs}ms ` +
        `(${ratio.toFixed(2)}x) — expected well under 6x for O(n) seeding`,
    );
  } finally {
    await rm(dirSmall, { recursive: true, force: true });
    await rm(dirLarge, { recursive: true, force: true });
  }
});
