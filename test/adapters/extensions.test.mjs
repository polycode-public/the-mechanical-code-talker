// extensions.test.mjs — the extension-pack seam (src/services/extensions.mjs).
//
// resolveExtensions(repoRoot) is the ONE seam every corpus-loading, lexicon-
// merging and bias-ranking caller consults: a bare/no-toml dir must resolve to
// exactly today's implicit `human` default (the persona flip —
// `seon`/`conceptnet` ship but are now opt-in); a tmct.toml can flip a
// shipped-but-inactive tier-2 bundle (or seon/conceptnet) active, or declare a
// brand new host-supplied pack entry; malformed entries and a malformed
// [bias] table both fail loudly, naming the bad key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveExtensions, validateExtensionEntry, BUILTIN_EXTENSIONS, EXTENSION_KINDS, mergedLaneVocab, defaultCodeLaneVocab,
} from "../../src/services/extensions.mjs";
import { SEON_CONCEPTS_FILE, SLICE_FILE as CONCEPTNET_SLICE_FILE, TIER2_DIR } from "../../src/adapters/corpus/conceptnet.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "tmct-ext-"));

test("bare/no-toml dir: resolves to exactly today's implicit `human` default (seon/conceptnet shipped but inactive)", async () => {
  const dir = await tmp();
  try {
    const { entries, biasByBundle } = await resolveExtensions(dir);
    assert.deepEqual(biasByBundle, {});
    // fixed order: seon, conceptnet, then the rest sorted
    assert.deepEqual([...entries.keys()], ["seon", "conceptnet", "child", "code", "human", "human-large", "human-medium", "namenet", "tier2-general", "wordnet-full", "wordnet-xl"]);
    const seon = entries.get("seon");
    assert.equal(seon.kind, "corpus");
    assert.equal(seon.active, false, "seon ships inactive now — opt-in via --with-persona code");
    assert.equal(seon.corpusPath, SEON_CONCEPTS_FILE);
    assert.equal(seon.provenancePrefix, "corpus:seon");
    const conceptnet = entries.get("conceptnet");
    assert.equal(conceptnet.active, false, "conceptnet ships inactive now — equally code/tech-domain-biased");
    assert.equal(conceptnet.corpusPath, CONCEPTNET_SLICE_FILE);
    assert.equal(conceptnet.provenancePrefix, "corpus:conceptnet");
    assert.equal(conceptnet.limit, undefined);
    assert.deepEqual(conceptnet.prefer, [
      "rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf",
      "mgx:atLocation", "mgx:causes", "mgx:desires", "mgx:motivatedByGoal", "mgx:hasSubevent",
    ]);
    const human = entries.get("human");
    assert.equal(human.kind, "corpus");
    assert.equal(human.active, true, "human is the new default active bundle");
    assert.equal(human.corpusPath, join(TIER2_DIR, "human.jsonl"));
    assert.equal(human.provenancePrefix, "corpus:human");
    // tier2-general remains a corpus-kind entry (no pack wrapper yet)
    assert.equal(entries.get("tier2-general").kind, "corpus");
    assert.equal(entries.get("tier2-general").active, false, "tier2-general ships inactive");
    // human-medium/human-large: SIZE tiers of the SAME
    // `human` bundle, ship but stay inactive — Small is the default.
    for (const id of ["human-medium", "human-large"]) {
      assert.equal(entries.get(id).kind, "corpus");
      assert.equal(entries.get(id).active, false, `${id} ships inactive`);
      assert.equal(entries.get(id).corpusPath, join(TIER2_DIR, `${id === "human-medium" ? "human-medium" : "human-large"}.jsonl`));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("BUILTIN_EXTENSIONS matches the resolved defaults' shape (kind/active for every shipped bundle)", () => {
  assert.deepEqual(Object.keys(BUILTIN_EXTENSIONS).sort(), ["child", "code", "conceptnet", "human", "human-large", "human-medium", "namenet", "seon", "tier2-general", "wordnet-full", "wordnet-xl"]);
  assert.equal(BUILTIN_EXTENSIONS.seon.active, false);
  assert.equal(BUILTIN_EXTENSIONS.code.active, false, "the code domain pack ships inactive — opt-in via --with-persona code or `tmct index`");
  assert.equal(BUILTIN_EXTENSIONS.code.kind, "pack");
  assert.equal(BUILTIN_EXTENSIONS.code.provenancePrefix, "corpus:seon", "the code pack keeps seon's own provenance prefix");
  assert.equal(BUILTIN_EXTENSIONS.conceptnet.active, false);
  assert.equal(BUILTIN_EXTENSIONS.human.active, true);
  assert.equal(BUILTIN_EXTENSIONS["tier2-general"].active, false);
  assert.equal(BUILTIN_EXTENSIONS["wordnet-xl"].active, false, "wordnet-xl ships inactive");
  assert.equal(BUILTIN_EXTENSIONS["wordnet-full"].active, false, "wordnet-full ships inactive");
  assert.equal(BUILTIN_EXTENSIONS.namenet.active, false, "namenet ships inactive");
  assert.equal(BUILTIN_EXTENSIONS.child.active, false, "the child pack ships inactive");
  assert.equal(BUILTIN_EXTENSIONS.child.kind, "corpus");
  assert.ok(BUILTIN_EXTENSIONS.child.shardPackPath, "the child pack reads sharded files, not one slice");
  assert.equal(BUILTIN_EXTENSIONS.child.provenancePrefix, "corpus:child");
});

test("a tmct.toml flipping tier2-general active — recognized-name override, path/provenance untouched", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), '[extensions.tier2-general]\nactive = true\n');
    const { entries } = await resolveExtensions(dir);
    assert.equal(entries.get("tier2-general").active, true);
    assert.equal(entries.get("tier2-general").provenancePrefix, "corpus:tier2-general");
    assert.equal(entries.get("namenet").active, false, "sibling bundles untouched");
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
    assert.deepEqual([...entries.keys()], ["seon", "conceptnet", "child", "code", "human", "human-large", "human-medium", "namenet", "seonix", "tier2-general", "wordnet-full", "wordnet-xl"]);
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
  assert.throws(() => validateExtensionEntry("x", { kind: "ontology", active: true }), /needs ontology_path/);
});

test("EXTENSION_KINDS is the closed vocabulary the validator checks against", () => {
  assert.deepEqual(EXTENSION_KINDS, ["corpus", "lexicon", "templates", "pack", "ontology"]);
});

// ---- ontology kind (CLI/config unification batch) -----------------------

test("an ontology-kind host entry: ontology_path aliases the same corpusPath field a corpus entry uses", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "onto.jsonl"), "");
    await writeFile(join(dir, "tmct.toml"),
      '[extensions.myonto]\nkind = "ontology"\nactive = true\nontology_path = "onto.jsonl"\n');
    const { entries } = await resolveExtensions(dir);
    const e = entries.get("myonto");
    assert.equal(e.kind, "ontology");
    assert.equal(e.active, true);
    assert.equal(e.corpusPath, join(dir, "onto.jsonl"), "ontology_path resolves into the same internal corpusPath field");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an ontology entry missing ontology_path throws, naming it", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), '[extensions.myonto]\nkind = "ontology"\nactive = true\n');
    await assert.rejects(() => resolveExtensions(dir), /extension "myonto".*ontology.*needs ontology_path/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seon's existing corpus-kind entry is left alone — no relabel to ontology", () => {
  assert.equal(BUILTIN_EXTENSIONS.seon.kind, "corpus");
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
    await writeFile(join(dir, "tmct.toml"), "[extensions.tier2-general]\nactive = true\n\n[bias]\ntier2-general = 2.0\n");
    const { entries, biasByBundle } = await resolveExtensions(dir);
    assert.equal(entries.get("tier2-general").active, true);
    assert.deepEqual(biasByBundle, { "tier2-general": 2 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- vocab_path + the grounding-channel declaration (pack entries) --------

test("the code pack declares vocab_path and an extraction grounding channel", () => {
  const code = BUILTIN_EXTENSIONS.code;
  assert.equal(code.kind, "pack");
  assert.ok(code.vocabPath.endsWith("vocab.json"));
  assert.equal(code.groundingKind, "extraction");
  assert.ok(code.groundingAdapter && code.groundingAdapter.length > 0);
});

test("a tmct.toml pack entry can declare vocab_path/grounding_kind/grounding_adapter", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "vocab.json"), JSON.stringify({ countNouns: { widget: "Widget" } }));
    await writeFile(join(dir, "tmct.toml"),
      '[extensions.mypack]\nkind = "pack"\nactive = true\ncorpus_path = "corpus.jsonl"\nvocab_path = "vocab.json"\n'
      + 'grounding_kind = "taught-only"\n');
    await writeFile(join(dir, "corpus.jsonl"), "");
    const { entries } = await resolveExtensions(dir);
    const e = entries.get("mypack");
    assert.equal(e.vocabPath, join(dir, "vocab.json"));
    assert.equal(e.groundingKind, "taught-only");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- mergedLaneVocab (Part 3b) --------------------------------------------

test("mergedLaneVocab: a bare session (no active pack) merges to an empty vocabulary", async () => {
  const { entries } = await resolveExtensions(await tmp());
  const vocab = await mergedLaneVocab(entries, {});
  assert.deepEqual(vocab, { countNouns: {}, classLabels: {}, helpRows: [], missRecoveryPointer: "" });
});

test("mergedLaneVocab: the active code pack's vocabulary merges in", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "tmct.toml"), '[extensions.code]\nactive = true\n');
    const { entries, biasByBundle } = await resolveExtensions(dir);
    const vocab = await mergedLaneVocab(entries, biasByBundle);
    assert.equal(vocab.countNouns.class, "Class");
    assert.deepEqual(vocab.classLabels.Class, ["class", "classes"]);
    assert.ok(vocab.helpRows.some(([name]) => name.startsWith("/callers")));
    assert.match(vocab.missRecoveryPointer, /tmct index/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergedLaneVocab: bias order resolves a countNouns collision the same way mergedLexiconExtra does — higher bias wins", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "low.json"), JSON.stringify({ countNouns: { thing: "Low" } }));
    await writeFile(join(dir, "high.json"), JSON.stringify({ countNouns: { thing: "High" } }));
    await writeFile(join(dir, "tmct.toml"),
      '[extensions.lowpack]\nkind = "pack"\nactive = true\ncorpus_path = "low.json"\nvocab_path = "low.json"\n'
      + '[extensions.highpack]\nkind = "pack"\nactive = true\ncorpus_path = "high.json"\nvocab_path = "high.json"\n'
      + "[bias]\nlowpack = 0.5\nhighpack = 2.0\n");
    const { entries, biasByBundle } = await resolveExtensions(dir);
    const vocab = await mergedLaneVocab(entries, biasByBundle);
    assert.equal(vocab.countNouns.thing, "High", "the higher-bias pack's entry wins the collision");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("defaultCodeLaneVocab: the shipped code pack's own vocabulary, loaded regardless of activation", async () => {
  const vocab = await defaultCodeLaneVocab();
  assert.equal(vocab.countNouns.class, "Class");
  assert.deepEqual(vocab.classLabels.Module, ["module", "modules"]);
});

test("the built-in packs' in-code vocab stays deep-equal to their on-disk vocab files", async () => {
  const { CODE_VOCAB_DATA, EMPTY_VOCAB_DATA } = await import("../../src/services/lane-vocab-data.mjs");
  const root = new URL("../..", import.meta.url);
  const codeFile = JSON.parse(await readFile(new URL("corpus/domains/code/vocab.json", root), "utf8"));
  const emptyFile = JSON.parse(await readFile(new URL("corpus/tier2/vocab-empty.json", root), "utf8"));
  assert.deepEqual(CODE_VOCAB_DATA, codeFile, "code pack vocab drifted between src and corpus");
  assert.deepEqual(EMPTY_VOCAB_DATA, emptyFile, "tier2 empty vocab drifted between src and corpus");
});
