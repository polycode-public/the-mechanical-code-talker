// extensions.test.mjs — the extension-pack seam (src/extensions.mjs).
//
// resolveExtensions(repoRoot) is the ONE seam every corpus-loading, lexicon-
// merging and bias-ranking caller consults: a bare/no-toml dir must resolve to
// exactly today's implicit `human` default (PLAN_SEED.md's persona flip —
// `seon`/`conceptnet` ship but are now opt-in); a tmct.toml can flip a
// shipped-but-inactive tier-2 bundle (or seon/conceptnet) active, or declare a
// brand new host-supplied pack entry; malformed entries and a malformed
// [bias] table both fail loudly, naming the bad key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveExtensions, validateExtensionEntry, BUILTIN_EXTENSIONS, EXTENSION_KINDS,
} from "../src/extensions.mjs";
import { SEON_CONCEPTS_FILE, SLICE_FILE as CONCEPTNET_SLICE_FILE, TIER2_DIR } from "../src/corpus/conceptnet.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "tmct-ext-"));

test("bare/no-toml dir: resolves to exactly today's implicit `human` default (seon/conceptnet shipped but inactive)", async () => {
  const dir = await tmp();
  try {
    const { entries, biasByBundle } = await resolveExtensions(dir);
    assert.deepEqual(biasByBundle, {});
    // fixed order: seon, conceptnet, then the rest sorted
    assert.deepEqual([...entries.keys()], ["seon", "conceptnet", "human", "tier2-aws", "tier2-general", "tier2-java", "tier2-python"]);
    const seon = entries.get("seon");
    assert.equal(seon.kind, "corpus");
    assert.equal(seon.active, false, "seon ships inactive now — opt-in via --with-persona code");
    assert.equal(seon.corpusPath, SEON_CONCEPTS_FILE);
    assert.equal(seon.provenancePrefix, "corpus:seon");
    const conceptnet = entries.get("conceptnet");
    assert.equal(conceptnet.active, false, "conceptnet ships inactive now — equally code/tech-domain-biased (PLAN_SEED.md §2)");
    assert.equal(conceptnet.corpusPath, CONCEPTNET_SLICE_FILE);
    assert.equal(conceptnet.provenancePrefix, "corpus:conceptnet");
    assert.equal(conceptnet.limit, undefined);
    assert.deepEqual(conceptnet.prefer, ["rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf"]);
    const human = entries.get("human");
    assert.equal(human.kind, "corpus");
    assert.equal(human.active, true, "human is the new default active bundle");
    assert.equal(human.corpusPath, join(TIER2_DIR, "human.jsonl"));
    assert.equal(human.provenancePrefix, "corpus:human");
    // the four tier-2 bundles ship but stay inactive
    for (const id of ["tier2-aws", "tier2-python", "tier2-java", "tier2-general"]) {
      assert.equal(entries.get(id).kind, "corpus");
      assert.equal(entries.get(id).active, false, `${id} ships inactive`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("BUILTIN_EXTENSIONS matches the resolved defaults' shape (kind/active for every shipped bundle)", () => {
  assert.deepEqual(Object.keys(BUILTIN_EXTENSIONS).sort(), ["conceptnet", "human", "seon", "tier2-aws", "tier2-general", "tier2-java", "tier2-python"]);
  assert.equal(BUILTIN_EXTENSIONS.seon.active, false);
  assert.equal(BUILTIN_EXTENSIONS.conceptnet.active, false);
  assert.equal(BUILTIN_EXTENSIONS.human.active, true);
  assert.equal(BUILTIN_EXTENSIONS["tier2-aws"].active, false);
});

test("a tmct.toml flipping tier2-aws active — recognized-name override, path/provenance untouched", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), '[extensions.tier2-aws]\nactive = true\n');
    const { entries } = await resolveExtensions(dir);
    assert.equal(entries.get("tier2-aws").active, true);
    assert.equal(entries.get("tier2-aws").provenancePrefix, "corpus:tier2-aws");
    assert.equal(entries.get("tier2-python").active, false, "sibling bundles untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a tmct.toml with an unrecognized-key host pack entry", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "corpus.jsonl"), "");
    await writeFile(join(dir, "tmct.toml"),
      '[extensions.seonix]\nkind = "pack"\nactive = true\ncorpus_path = "corpus.jsonl"\nprovenance_prefix = "corpus:seonix"\n');
    const { entries } = await resolveExtensions(dir);
    assert.ok(entries.has("seonix"), "the unrecognized name became a new entry");
    const e = entries.get("seonix");
    assert.equal(e.kind, "pack");
    assert.equal(e.active, true);
    assert.equal(e.corpusPath, join(dir, "corpus.jsonl"), "a relative path resolves against repoRoot");
    assert.equal(e.provenancePrefix, "corpus:seonix");
    // ordering: seon, conceptnet, then the rest (including the new one) sorted
    assert.deepEqual([...entries.keys()], ["seon", "conceptnet", "human", "seonix", "tier2-aws", "tier2-general", "tier2-java", "tier2-python"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a malformed entry throws, naming the bad key", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), '[extensions.bogus]\nkind = "not-a-real-kind"\n');
    await assert.rejects(() => resolveExtensions(dir), /extension "bogus".*unknown kind/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unrecognized entry with no kind throws, naming it", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), '[extensions.mystery]\nactive = true\n');
    await assert.rejects(() => resolveExtensions(dir), /extension "mystery".*needs a "kind"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a corpus entry missing its path throws", () => {
  assert.throws(() => validateExtensionEntry("x", { kind: "corpus", active: true }), /needs corpus_path/);
  assert.throws(() => validateExtensionEntry("x", { kind: "lexicon", active: true }), /needs lexicon_path/);
  assert.throws(() => validateExtensionEntry("x", { kind: "templates", active: true }), /needs templates_path/);
  assert.throws(() => validateExtensionEntry("x", { kind: "pack", active: true }), /needs at least one of/);
});

test("EXTENSION_KINDS is the closed vocabulary the validator checks against", () => {
  assert.deepEqual(EXTENSION_KINDS, ["corpus", "lexicon", "templates", "pack"]);
});

// ---- [bias] table -------------------------------------------------------

test("[bias] present: a flat bundle-name -> number table", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), "[bias]\nseon = 1.0\nconceptnet = 0.6\n");
    const { biasByBundle } = await resolveExtensions(dir);
    assert.deepEqual(biasByBundle, { seon: 1, conceptnet: 0.6 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("[bias] partial (one bundle only) and absent both resolve cleanly", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), "[bias]\nconceptnet = 0.6\n");
    const { biasByBundle } = await resolveExtensions(dir);
    assert.deepEqual(biasByBundle, { conceptnet: 0.6 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const dir2 = await tmp();
  try {
    const { biasByBundle } = await resolveExtensions(dir2);
    assert.deepEqual(biasByBundle, {});
  } finally {
    await rm(dir2, { recursive: true, force: true });
  }
});

test("[bias] non-numeric value throws, naming the bundle", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), '[bias]\nseon = "high"\n');
    await assert.rejects(() => resolveExtensions(dir), /\[bias\] "seon".*must be a finite number/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("[extensions] table-of-tables is DISTINCT from [bias] — bias never lives nested under extensions", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), "[extensions.tier2-aws]\nactive = true\n\n[bias]\ntier2-aws = 2.0\n");
    const { entries, biasByBundle } = await resolveExtensions(dir);
    assert.equal(entries.get("tier2-aws").active, true);
    assert.deepEqual(biasByBundle, { "tier2-aws": 2 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
