// memory/shacl.mjs tests — the declarative SHACL-STYLE ingest gate.
// Two halves:
// (1) validateIndividual/assertIndividualValid exercised directly against
// hand-built individuals (the unit-level shape contract), and (2) the LIVE
// wiring at appendFact/appendRule's write boundary — a genuinely malformed
// candidate must be rejected before anything reaches disk; every legitimate
// call this codebase's own tests already rely on (including provenance-less
// re-writes) must keep working byte-identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateIndividual, assertIndividualValid } from "../../src/adapters/memory/shacl.mjs";
import {
  appendFact, appendRule, loadMemory,
  RULE_KIND_COMPOSE2, RULE_KIND_FILTER, RULE_KIND_RECURSIVE,
} from "../../src/adapters/memory/core.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-mem-shacl-"));
}

// ---- Unit level: validateIndividual against hand-built individuals --------

test("IndividualShape: a recognized class conforms; a missing/unrecognized class is rejected", () => {
  assert.equal(validateIndividual({ id: "x:1", class: "Fact", attributes: [
    { prop: "rdf:subject", value: "a" }, { prop: "rdf:predicate", value: "b" }, { prop: "rdf:object", value: "c" },
  ] }).ok, true);
  const noClass = validateIndividual({ id: "x:2", attributes: [] });
  assert.equal(noClass.ok, false);
  assert.match(noClass.violations.join(" "), /closed vocabulary/);
  const badClass = validateIndividual({ id: "x:3", class: "Bogus", attributes: [] });
  assert.equal(badClass.ok, false);
  assert.match(badClass.violations.join(" "), /closed vocabulary/);
});

test("FactShape: subject/predicate/object each required and non-empty", () => {
  const good = validateIndividual({
    id: "fact:1", class: "Fact",
    attributes: [
      { prop: "rdf:subject", value: "module" },
      { prop: "rdf:predicate", value: "tmct:imports" },
      { prop: "rdf:object", value: "test" },
    ],
  });
  assert.deepEqual(good, { ok: true, violations: [] });

  const missing = validateIndividual({ id: "fact:2", class: "Fact", attributes: [] });
  assert.equal(missing.ok, false);
  assert.equal(missing.violations.length, 3, "all three of subject/predicate/object are named");

  const emptySubject = validateIndividual({
    id: "fact:3", class: "Fact",
    attributes: [
      { prop: "rdf:subject", value: "" },
      { prop: "rdf:predicate", value: "tmct:imports" },
      { prop: "rdf:object", value: "test" },
    ],
  });
  assert.equal(emptySubject.ok, false);
  assert.match(emptySubject.violations.join(" "), /rdf:subject/);
});

test("FactShape: provenance is OPTIONAL — absent is fine; present-but-blank is rejected", () => {
  const noProv = validateIndividual({
    id: "fact:1", class: "Fact",
    attributes: [
      { prop: "rdf:subject", value: "module" },
      { prop: "rdf:predicate", value: "tmct:imports" },
      { prop: "rdf:object", value: "test" },
    ],
  });
  assert.equal(noProv.ok, true, "no factProvenance attribute at all still conforms");

  const withProv = validateIndividual({
    id: "fact:2", class: "Fact",
    attributes: [
      { prop: "rdf:subject", value: "module" },
      { prop: "rdf:predicate", value: "tmct:imports" },
      { prop: "rdf:object", value: "test" },
      { prop: "mgx:factProvenance", value: "ace:chat:s1@2026-07-10T00:00:00Z" },
    ],
  });
  assert.equal(withProv.ok, true);

  const blankProv = validateIndividual({
    id: "fact:3", class: "Fact",
    attributes: [
      { prop: "rdf:subject", value: "module" },
      { prop: "rdf:predicate", value: "tmct:imports" },
      { prop: "rdf:object", value: "test" },
      { prop: "mgx:factProvenance", value: "" },
    ],
  });
  assert.equal(blankProv.ok, false);
  assert.match(blankProv.violations.join(" "), /factProvenance/);
});

test("RuleShape: name + closed-vocabulary kind + the matching slot pair per kind", () => {
  const compose2 = validateIndividual({
    id: "rule:1", class: "Rule",
    attributes: [
      { prop: "mgx:ruleName", value: "grandparent" },
      { prop: "mgx:ruleKind", value: "compose2" },
      { prop: "mgx:ruleBase1", value: "parent" },
      { prop: "mgx:ruleBase2", value: "parent" },
    ],
  });
  assert.deepEqual(compose2, { ok: true, violations: [] });

  const filter = validateIndividual({
    id: "rule:2", class: "Rule",
    attributes: [
      { prop: "mgx:ruleName", value: "senior-dev" },
      { prop: "mgx:ruleKind", value: "filter" },
      { prop: "mgx:ruleBase1", value: "developer" },
      { prop: "mgx:ruleFilterProperty", value: "senior" },
    ],
  });
  assert.equal(filter.ok, true);

  const recursive = validateIndividual({
    id: "rule:3", class: "Rule",
    attributes: [
      { prop: "mgx:ruleName", value: "ancestor" },
      { prop: "mgx:ruleKind", value: "recursive" },
      { prop: "mgx:ruleBaseCase", value: "parent" },
      { prop: "mgx:ruleRecStep", value: "ancestor" },
    ],
  });
  assert.equal(recursive.ok, true);

  const badKind = validateIndividual({
    id: "rule:4", class: "Rule",
    attributes: [{ prop: "mgx:ruleName", value: "x" }, { prop: "mgx:ruleKind", value: "bogus" }],
  });
  assert.equal(badKind.ok, false);
  assert.match(badKind.violations.join(" "), /compose2 \| filter \| recursive/);

  const wrongSlots = validateIndividual({
    id: "rule:5", class: "Rule",
    attributes: [
      { prop: "mgx:ruleName", value: "grandparent" },
      { prop: "mgx:ruleKind", value: "compose2" },
      { prop: "mgx:ruleBase1", value: "parent" },
      // missing ruleBase2 — the wrong (filter-shaped) slot pair for compose2
      { prop: "mgx:ruleFilterProperty", value: "senior" },
    ],
  });
  assert.equal(wrongSlots.ok, false);
  assert.match(wrongSlots.violations.join(" "), /ruleBase2/);

  const noName = validateIndividual({
    id: "rule:6", class: "Rule",
    attributes: [{ prop: "mgx:ruleKind", value: "compose2" }, { prop: "mgx:ruleBase1", value: "a" }, { prop: "mgx:ruleBase2", value: "b" }],
  });
  assert.equal(noName.ok, false);
  assert.match(noName.violations.join(" "), /ruleName/);
});

test("assertIndividualValid: throws a clear, aggregated error on a violation; is a no-op on a conforming individual", () => {
  assert.doesNotThrow(() => assertIndividualValid({
    id: "fact:1", class: "Fact",
    attributes: [{ prop: "rdf:subject", value: "a" }, { prop: "rdf:predicate", value: "b" }, { prop: "rdf:object", value: "c" }],
  }));
  assert.throws(
    () => assertIndividualValid({ id: "fact:2", class: "Fact", attributes: [] }),
    (e) => {
      assert.match(e.message, /SHACL validation failed for Fact "fact:2"/);
      assert.ok(Array.isArray(e.violations) && e.violations.length === 3);
      return true;
    },
  );
});

// ---- Live wiring: appendFact / appendRule reject before writing -----------

test("appendFact: a well-formed fact (including one with NO provenance) writes fine — the gate never regresses an existing valid call", async () => {
  const dir = await tmpRepo();
  try {
    const { id } = await appendFact(dir, { subject: "module", predicate: "tmct:imports", object: "test" });
    const m = await loadMemory(dir);
    assert.ok(m.individuals.some((i) => i.id === id), "the fact landed in the graph despite carrying no provenance");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendFact: the existing structural floor (empty subject/predicate/object) still throws exactly as before — unrelated to the SHACL gate", async () => {
  const dir = await tmpRepo();
  try {
    await assert.rejects(() => appendFact(dir, { subject: "", predicate: "tmct:imports", object: "test" }), /needs subject, predicate and object/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendRule: a well-formed rule of each kind writes fine", async () => {
  const dir = await tmpRepo();
  try {
    const c = await appendRule(dir, { name: "grandparent", kind: RULE_KIND_COMPOSE2, slots: { base1: "parent", base2: "parent" } });
    const f = await appendRule(dir, { name: "senior-dev", kind: RULE_KIND_FILTER, slots: { base: "developer", property: "senior" } });
    const r = await appendRule(dir, { name: "ancestor", kind: RULE_KIND_RECURSIVE, slots: { baseCase: "parent", recStep: "ancestor" } });
    const m = await loadMemory(dir);
    for (const { id } of [c, f, r]) assert.ok(m.individuals.some((i) => i.id === id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendRule: the existing structural floor (missing slots for the declared kind) still throws exactly as before", async () => {
  const dir = await tmpRepo();
  try {
    await assert.rejects(
      () => appendRule(dir, { name: "grandparent", kind: RULE_KIND_COMPOSE2, slots: { base1: "parent" } }),
      /needs base1 \+ base2/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendFact re-teach (upsert of an existing fact) with no provenance on the second write stays valid — the gate never blocks a legitimate sparse re-write", async () => {
  const dir = await tmpRepo();
  try {
    const first = await appendFact(dir, { subject: "module", predicate: "tmct:imports", object: "test", provenance: "ace:chat:s1@2026-07-10T00:00:00Z" });
    const second = await appendFact(dir, { subject: "module", predicate: "tmct:imports", object: "test" }); // no provenance this time
    assert.equal(first.id, second.id, "same (s,p,o) still upserts to the same id");
    const m = await loadMemory(dir);
    assert.ok(m.individuals.some((i) => i.id === first.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
