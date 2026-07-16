// extensions-corpus.test.mjs — the unified corpus loader loop
// (src/services/extensions.mjs seedActiveCorpusEntries), Part 2's core seam: ordering,
// per-bundle failure tolerance, and idempotent re-running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveExtensions, seedActiveCorpusEntries } from "../src/services/extensions.mjs";
import { loadMemory, FACT_CLASS } from "../src/adapters/memory/core.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "tmct-extcorpus-"));

// PLAN_SEED.md's persona flip: seon/conceptnet ship but are no longer active
// by default (that's `human` now — see extensions.test.mjs). Several tests
// below are specifically about SEON/ConceptNet's OWN seeding mechanics
// (ordering, failure tolerance alongside them) — they now explicitly
// reactivate both AND deactivate `human` via a written tmct.toml, so this
// file's own assertions stay scoped to seon+conceptnet exactly as before,
// undiluted by the new default bundle also being active alongside them.
const CODE_PERSONA_TOML = "[extensions.seon]\nactive = true\n\n[extensions.conceptnet]\nactive = true\n\n[extensions.human]\nactive = false\n";

test("seedActiveCorpusEntries: only ACTIVE corpus-kind entries seed; inactive/non-corpus entries are skipped", async () => {
  const dir = await tmp();
  try {
    const { entries } = await resolveExtensions(dir); // default: human active, seon/conceptnet/3 tier2 inactive
    const { appended, perBundle } = await seedActiveCorpusEntries(dir, entries);
    assert.ok(appended > 0);
    assert.deepEqual(Object.keys(perBundle).sort(), ["human"], "only the one active bundle ran");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seon seeds BEFORE conceptnet — a term both corpora carry keeps the seon provenance (idempotency-ordering precedent)", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), CODE_PERSONA_TOML);
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
    await writeFile(join(dir, "tmct.toml"), CODE_PERSONA_TOML);
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

// BUGFIX regression (CLI/config unification batch): a "pack"-kind entry's
// corpusPath used to be silently skipped by seedActiveCorpusEntries — the
// module's own docblock has always claimed pack entries combine corpus_path/
// lexicon_path/etc, but the seed loop only ever matched kind === "corpus".
test("BUGFIX: an active pack-kind entry with a corpusPath now seeds (previously silently skipped)", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "pack-corpus.jsonl"), '{"start":"/c/en/widget","rel":"/r/IsA","end":"/c/en/gadget"}\n');
    await writeFile(join(dir, "tmct.toml"),
      '[extensions.mypack]\nkind = "pack"\nactive = true\ncorpus_path = "pack-corpus.jsonl"\nprovenance_prefix = "corpus:mypack"\n');
    const { entries } = await resolveExtensions(dir);
    const { perBundle } = await seedActiveCorpusEntries(dir, entries);
    assert.ok(perBundle.mypack, "the pack bundle ran at all");
    assert.equal(perBundle.mypack.appended, 1, "the pack's one fact was actually written");
    assert.equal(perBundle.mypack.error, undefined);

    const mem = await loadMemory(dir);
    const facts = mem.individuals.filter((i) => i.class === FACT_CLASS);
    const fromPack = facts.filter((f) =>
      (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:mypack")));
    assert.ok(fromPack.length > 0, "the pack's fact carries its own provenance tag");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a pack-kind entry with NO corpusPath (lexicon/templates-only pack) is still skipped — never a crash", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "lex.json"), '{"nouns":{},"verbs":{},"adjectives":{},"properNames":[]}\n');
    await writeFile(join(dir, "tmct.toml"),
      '[extensions.lexonly]\nkind = "pack"\nactive = true\nlexicon_path = "lex.json"\n');
    const { entries } = await resolveExtensions(dir);
    const { perBundle } = await seedActiveCorpusEntries(dir, entries);
    assert.equal(perBundle.lexonly, undefined, "a lexicon-only pack entry never enters the corpus seed loop");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mid-list active bundle (tier2-aws, activated via tmct.toml) seeds alongside seon+conceptnet in one loop", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), `${CODE_PERSONA_TOML}\n[extensions.tier2-aws]\nactive = true\n`);
    const { entries } = await resolveExtensions(dir);
    assert.deepEqual([...entries.keys()].filter((n) => entries.get(n).active), ["seon", "conceptnet", "tier2-aws"]);
    const { perBundle } = await seedActiveCorpusEntries(dir, entries);
    assert.deepEqual(Object.keys(perBundle).sort(), ["conceptnet", "seon", "tier2-aws"]);
    assert.ok(perBundle["tier2-aws"].appended > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// PLAN_AGENTS.md §4 Phase 1 TASK 1(a): confirm EVERY shipped tier-2 bundle
// (not just aws, above) genuinely activates end-to-end via the same
// config-only [extensions.<name>] active = true seam, and that the newly
// added tier2-general bundle (a non-code-domain "wider general-knowledge"
// seed set, TASK 1(b)) rides the identical path.
for (const name of ["tier2-python", "tier2-java", "tier2-general"]) {
  test(`activation seam: [extensions.${name}] active = true seeds real facts alongside seon+conceptnet`, async () => {
    const dir = await tmp();
    try {
      await writeFile(join(dir, "tmct.toml"), `${CODE_PERSONA_TOML}\n[extensions.${name}]\nactive = true\n`);
      const { entries } = await resolveExtensions(dir);
      assert.deepEqual([...entries.keys()].filter((n) => entries.get(n).active), ["seon", "conceptnet", name]);
      const { perBundle } = await seedActiveCorpusEntries(dir, entries);
      assert.ok(perBundle[name].appended > 0, `${name} actually wrote facts`);
      assert.equal(perBundle[name].error, undefined, `${name} seeded without error`);

      const mem = await loadMemory(dir);
      const facts = mem.individuals.filter((i) => i.class === FACT_CLASS);
      const fromBundle = facts.filter((f) =>
        (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes(`corpus:${name}`)));
      assert.ok(fromBundle.length > 0, `some fact carries ${name}'s own provenance tag`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
