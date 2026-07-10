// extensions-corpus.test.mjs — the unified corpus loader loop
// (src/extensions.mjs seedActiveCorpusEntries), Part 2's core seam: ordering,
// per-bundle failure tolerance, and idempotent re-running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveExtensions, seedActiveCorpusEntries } from "../src/extensions.mjs";
import { loadMemory, FACT_CLASS } from "../src/memory/core.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "tmct-extcorpus-"));

test("seedActiveCorpusEntries: only ACTIVE corpus-kind entries seed; inactive/non-corpus entries are skipped", async () => {
  const dir = await tmp();
  try {
    const { entries } = await resolveExtensions(dir); // default: seon+conceptnet active, 3 tier2 inactive
    const { appended, perBundle } = await seedActiveCorpusEntries(dir, entries);
    assert.ok(appended > 0);
    assert.deepEqual(Object.keys(perBundle).sort(), ["conceptnet", "seon"], "only the two active bundles ran");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seon seeds BEFORE conceptnet — a term both corpora carry keeps the seon provenance (idempotency-ordering precedent)", async () => {
  const dir = await tmp();
  try {
    const { entries } = await resolveExtensions(dir);
    await seedActiveCorpusEntries(dir, entries);
    const mem = await loadMemory(dir);
    // "cache" is a curated SEON term (definitions.jsonl / concepts.jsonl) that
    // also appears in the general ConceptNet slice — its facts should carry
    // "corpus:seon" provenance (seon won the content-hash race by seeding first).
    const facts = mem.individuals.filter((i) => i.class === FACT_CLASS);
    const cacheFacts = facts.filter((f) => (f.attributes || []).some((a) => a.key === "subject" && a.value === "cache"));
    assert.ok(cacheFacts.length > 0, "some fact about 'cache' landed");
    const anySeonTagged = cacheFacts.some((f) =>
      (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:seon")));
    assert.ok(anySeonTagged, "at least one 'cache' fact is seon-provenanced (seeded first)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failure tolerance: one bad bundle's error is recorded, never thrown, and never blocks the others", async () => {
  const dir = await tmp();
  try {
    const { entries } = await resolveExtensions(dir);
    // graft in a bogus third active corpus entry pointing at a missing file
    entries.set("bogus", { kind: "corpus", active: true, corpusPath: join(dir, "does-not-exist.jsonl"), provenancePrefix: "corpus:bogus" });
    const { appended, perBundle } = await seedActiveCorpusEntries(dir, entries);
    assert.ok(appended > 0, "seon+conceptnet still landed despite the bogus bundle");
    assert.ok(perBundle.bogus.error, "the bogus bundle's failure is recorded, not silently swallowed");
    assert.equal(perBundle.bogus.appended, 0);
    assert.ok(perBundle.seon.appended > 0);
    assert.ok(perBundle.conceptnet.appended > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("idempotent re-run: seeding the SAME entries twice appends nothing the second time (content-hashed fact ids)", async () => {
  const dir = await tmp();
  try {
    const { entries } = await resolveExtensions(dir);
    const first = await seedActiveCorpusEntries(dir, entries);
    assert.ok(first.appended > 0);
    const second = await seedActiveCorpusEntries(dir, entries);
    assert.equal(second.appended, 0, "a second run over the same entries appends nothing new");
    assert.ok(second.skipped > 0, "the second run reports the dedup skips");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mid-list active bundle (tier2-aws, activated via tmct.toml) seeds alongside seon+conceptnet in one loop", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), "[extensions.tier2-aws]\nactive = true\n");
    const { entries } = await resolveExtensions(dir);
    assert.deepEqual([...entries.keys()].filter((n) => entries.get(n).active), ["seon", "conceptnet", "tier2-aws"]);
    const { perBundle } = await seedActiveCorpusEntries(dir, entries);
    assert.deepEqual(Object.keys(perBundle).sort(), ["conceptnet", "seon", "tier2-aws"]);
    assert.ok(perBundle["tier2-aws"].appended > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
