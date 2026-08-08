// el-classify-pass.test.mjs — classifyEl: the materialising pass writes the
// right rows with the right provenance, trust and justification; a second
// pass derives nothing new (idempotence); restriction scaffolding is
// written; an unsatisfiable class is reported but never materialised; and a
// store missing a required function throws a loud construction error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import {
  classifyEl, ENTAILED_EL_PROVENANCE, ENTAILED_EL_RESTRICTION_PROVENANCE, EL_RULE_CONFIDENCE,
} from "../../src/domain/el-classify.mjs";
import { SUBCLASS_PREDICATE, TYPE_PREDICATE, ON_PROPERTY_PREDICATE, SOME_VALUES_FROM_PREDICATE } from "../../src/domain/syllogise.mjs";

const STORE = { loadMemory, readFactRows, appendFacts };
const classify = (dir, opts = {}) => classifyEl(dir, { store: STORE, ...opts });
const mkRepo = () => mkdtemp(join(tmpdir(), "tmct-el-classify-"));
const subClassRows = (rows) => rows.filter((r) => r.predicate === SUBCLASS_PREDICATE);

test("classifyEl materializes a chained NF1 subsumption as an entailed, low-trust, retractable Fact", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "cat", predicate: SUBCLASS_PREDICATE, object: "mammal", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "mammal", predicate: SUBCLASS_PREDICATE, object: "animal", provenance: "corpus:conceptnet /r/IsA" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!subClassRows(before).some((r) => r.subject === "cat" && r.object === "animal"), "cat⊑animal is a MISS before the pass");

    const res = await classify(dir);
    assert.equal(res.count, 1);
    assert.deepEqual(res.derived.map((d) => [d.subject, d.object, d.rule]), [["cat", "animal", "elSubsumption"]]);

    const after = readFactRows(await loadMemory(dir));
    const derived = subClassRows(after).find((r) => r.subject === "cat" && r.object === "animal");
    assert.ok(derived, "cat⊑animal is now a stored Fact (miss → hit)");
    assert.equal(derived.provenance, ENTAILED_EL_PROVENANCE);
    assert.ok(derived.sourceTypes.includes("entailed"));
    assert.equal(derived.justification.length, 2, "cites both premise facts in the chain");

    const stated = subClassRows(after).find((r) => r.subject === "cat" && r.object === "mammal");
    assert.ok(derived.trust < stated.trust, "an EL conclusion never outranks its stated premise");
    assert.ok(derived.trust <= EL_RULE_CONFIDENCE * stated.trust + 1e-9);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("classifyEl: idempotent — a second pass derives nothing new", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "cat", predicate: SUBCLASS_PREDICATE, object: "mammal", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "mammal", predicate: SUBCLASS_PREDICATE, object: "animal", provenance: "corpus:conceptnet /r/IsA" });
    assert.equal((await classify(dir)).count, 1);
    assert.equal((await classify(dir)).count, 0, "closure already materialized → nothing to add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("classifyEl writes restriction scaffolding for a goal-introduced restriction name (E1)", async () => {
  const dir = await mkRepo();
  try {
    await appendFacts(dir, [
      { subject: "heart", predicate: SUBCLASS_PREDICATE, object: "some-has-valve", provenance: "ace:chat:s1@2026-07-08T00:00:00.000Z" },
      { subject: "some-has-valve", predicate: ON_PROPERTY_PREDICATE, object: "has", provenance: "ace:chat:s1@2026-07-08T00:00:00.000Z" },
      { subject: "some-has-valve", predicate: SOME_VALUES_FROM_PREDICATE, object: "valve", provenance: "ace:chat:s1@2026-07-08T00:00:00.000Z" },
      { subject: "valve", predicate: SUBCLASS_PREDICATE, object: "flap", provenance: "ace:chat:s1@2026-07-08T00:00:01.000Z" },
    ]);
    const res = await classify(dir);
    const flapDerivation = res.derived.find((d) => d.object === "some-has-flap");
    assert.ok(flapDerivation, "the goal-introduced some-has-flap restriction materializes over heart");
    assert.equal(flapDerivation.rule, "elRestriction");

    const rows = readFactRows(await loadMemory(dir));
    const heartRestriction = subClassRows(rows).find((r) => r.subject === "heart" && r.object === "some-has-flap");
    assert.equal(heartRestriction.provenance, ENTAILED_EL_RESTRICTION_PROVENANCE);

    const scaffoldType = rows.find((r) => r.subject === "some-has-flap" && r.predicate === TYPE_PREDICATE);
    const scaffoldProp = rows.find((r) => r.subject === "some-has-flap" && r.predicate === ON_PROPERTY_PREDICATE);
    const scaffoldFiller = rows.find((r) => r.subject === "some-has-flap" && r.predicate === SOME_VALUES_FROM_PREDICATE);
    assert.ok(scaffoldType, "the introduced restriction node carries its own rdf:type owl:Restriction row");
    assert.equal(scaffoldProp.object, "has");
    assert.equal(scaffoldFiller.object, "flap");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("classifyEl reports an unsatisfiable class but never materialises anything for it", async () => {
  const dir = await mkRepo();
  try {
    await appendFacts(dir, [
      { subject: "tabby", predicate: SUBCLASS_PREDICATE, object: "cat", provenance: "ace:chat:s1@2026-07-08T00:00:00.000Z" },
      { subject: "tabby", predicate: SUBCLASS_PREDICATE, object: "dog", provenance: "ace:chat:s1@2026-07-08T00:00:00.000Z" },
      { subject: "tabby", predicate: SUBCLASS_PREDICATE, object: "pet", provenance: "ace:chat:s1@2026-07-08T00:00:00.000Z" },
      { subject: "cat", predicate: "owl:disjointWith", object: "dog", provenance: "ace:chat:s1@2026-07-08T00:00:01.000Z" },
    ]);
    const res = await classify(dir);
    assert.deepEqual(res.unsatisfiable, ["tabby"]);
    assert.ok(!res.derived.some((d) => d.subject === "tabby"), "an unsatisfiable subject gets no writes at all");

    const rows = readFactRows(await loadMemory(dir));
    const tabbyEntailed = rows.filter((r) => r.subject === "tabby" && String(r.provenance || "").startsWith("entailed:"));
    assert.deepEqual(tabbyEntailed, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("classifyEl respects a focus term, scoping derivations to the concepts it touches", async () => {
  const dir = await mkRepo();
  try {
    await appendFacts(dir, [
      { subject: "cat", predicate: SUBCLASS_PREDICATE, object: "mammal" },
      { subject: "mammal", predicate: SUBCLASS_PREDICATE, object: "animal" },
      { subject: "oak", predicate: SUBCLASS_PREDICATE, object: "tree" },
      { subject: "tree", predicate: SUBCLASS_PREDICATE, object: "plant" },
    ]);
    const res = await classify(dir, { focus: new Set(["cat", "mammal", "animal"]) });
    assert.ok(res.derived.some((d) => d.subject === "cat" && d.object === "animal"));
    assert.ok(!res.derived.some((d) => d.subject === "oak"), "outside the focus set, nothing about oak is touched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("classifyEl: a store missing a required function throws a loud construction error, never a silent no-op", async () => {
  const dir = await mkRepo();
  try {
    await assert.rejects(
      () => classifyEl(dir, { store: { loadMemory, readFactRows } }), // appendFacts missing
      /classifyEl needs a store option.*appendFacts/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("classifyEl budget truncation reads as an honest miss marker, never a silent partial result reported as complete", async () => {
  const dir = await mkRepo();
  try {
    await appendFacts(dir, [
      { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b" },
      { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c" },
      { subject: "c", predicate: SUBCLASS_PREDICATE, object: "d" },
    ]);
    const res = await classify(dir, { budget: 1 });
    assert.equal(res.truncated, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
