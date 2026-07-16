// memory/core.mjs Rule-storage tests — pure
// plumbing (RULE_CLASS, appendRule, findRuleByName), zero chat.mjs behavior.
// Mirrors memory-core.test.mjs's house style (tmpRepo, attr() helper).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RULE_CLASS, FACT_CLASS, SOURCE_CLASS,
  RULE_KIND_COMPOSE2, RULE_KIND_FILTER, RULE_KIND_RECURSIVE,
  loadMemory, appendRule, findRuleByName,
} from "../../src/adapters/memory/core.mjs";

const attr = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value;
const propOf = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.prop;

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-mem-rules-"));
}

test("appendRule: compose2 — stores ruleName/ruleKind/base1/base2, round-trips via loadMemory", async () => {
  const dir = await tmpRepo();
  try {
    const { id } = await appendRule(dir, {
      name: "grandparent", kind: RULE_KIND_COMPOSE2,
      slots: { base1: "parent", base2: "parent" },
      provenance: "teach:chat:s1@2026-07-09T00:00:00.000Z",
    });
    assert.match(id, /^rule:[0-9a-f]{8}$/);

    const m = await loadMemory(dir);
    const rules = m.individuals.filter((i) => i.class === RULE_CLASS);
    assert.equal(rules.length, 1);
    const r = rules[0];
    assert.equal(attr(r, "type"), "owl:NamedIndividual");
    assert.equal(propOf(r, "ruleName"), "mgx:ruleName");
    assert.equal(attr(r, "ruleName"), "grandparent");
    assert.equal(propOf(r, "ruleKind"), "mgx:ruleKind");
    assert.equal(attr(r, "ruleKind"), RULE_KIND_COMPOSE2);
    assert.equal(propOf(r, "base1"), "mgx:ruleBase1");
    assert.equal(attr(r, "base1"), "parent");
    assert.equal(propOf(r, "base2"), "mgx:ruleBase2");
    assert.equal(attr(r, "base2"), "parent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendRule: filter — stores ruleName/ruleKind/base(->ruleBase1)/property(->ruleFilterProperty)", async () => {
  const dir = await tmpRepo();
  try {
    const { id } = await appendRule(dir, {
      name: "grandfather", kind: RULE_KIND_FILTER,
      slots: { base: "grandparent", property: "male" },
    });
    assert.match(id, /^rule:[0-9a-f]{8}$/);

    const m = await loadMemory(dir);
    const r = m.individuals.find((i) => i.id === id);
    assert.equal(r.class, RULE_CLASS);
    assert.equal(attr(r, "ruleName"), "grandfather");
    assert.equal(attr(r, "ruleKind"), RULE_KIND_FILTER);
    // filter's "base" slot deliberately reuses the SAME attribute (mgx:ruleBase1)
    // compose2's first slot uses — §3's dispatcher chases a filter rule's
    // candidate set via "ruleBase1's candidate set", one shared attribute name
    // for the identical "base relation this rule builds on" role.
    assert.equal(propOf(r, "base"), "mgx:ruleBase1");
    assert.equal(attr(r, "base"), "grandparent");
    assert.equal(propOf(r, "property"), "mgx:ruleFilterProperty");
    assert.equal(attr(r, "property"), "male");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendRule: recursive — stores ruleName/ruleKind/baseCase/recStep", async () => {
  const dir = await tmpRepo();
  try {
    const { id } = await appendRule(dir, {
      name: "descendant", kind: RULE_KIND_RECURSIVE,
      slots: { baseCase: "parent", recStep: "parent" },
    });
    const m = await loadMemory(dir);
    const r = m.individuals.find((i) => i.id === id);
    assert.equal(attr(r, "ruleName"), "descendant");
    assert.equal(attr(r, "ruleKind"), RULE_KIND_RECURSIVE);
    assert.equal(propOf(r, "baseCase"), "mgx:ruleBaseCase");
    assert.equal(attr(r, "baseCase"), "parent");
    assert.equal(propOf(r, "recStep"), "mgx:ruleRecStep");
    assert.equal(attr(r, "recStep"), "parent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendRule: re-teaching an IDENTICAL rule upserts — same id, no duplicate individual", async () => {
  const dir = await tmpRepo();
  try {
    const rule = { name: "grandparent", kind: RULE_KIND_COMPOSE2, slots: { base1: "parent", base2: "parent" } };
    const first = await appendRule(dir, rule);
    const second = await appendRule(dir, rule);
    assert.equal(second.id, first.id, "content-addressed rule id is stable");

    const m = await loadMemory(dir);
    assert.equal(m.individuals.filter((i) => i.class === RULE_CLASS).length, 1, "no duplicate individual");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendRule: a DIFFERENT rule under the SAME name gets a DISTINCT id — both individuals present, never a silent overwrite", async () => {
  // Design choice (documented here, matching appendFact's own precedent: two
  // Facts sharing a subject but differing predicate/object are two distinct
  // Fact individuals, never merged): re-defining "grandparent" with different
  // slots hashes to a different rule:<hex> id (kind+name+slots are ALL part of
  // the content address), so BOTH the old and new definition coexist as
  // separate Rule individuals under the same mgx:ruleName. This phase does not
  // pick "which one wins" for the dispatcher — that's later phases' job; the
  // storage layer's job is only to never silently lose either taught rule.
  const dir = await tmpRepo();
  try {
    const original = await appendRule(dir, {
      name: "grandparent", kind: RULE_KIND_COMPOSE2, slots: { base1: "parent", base2: "parent" },
    });
    const redefined = await appendRule(dir, {
      // same name, same kind, but a genuinely different composition
      name: "grandparent", kind: RULE_KIND_COMPOSE2, slots: { base1: "parent", base2: "guardian" },
    });
    assert.notEqual(redefined.id, original.id, "different slots hash to a different id");

    const m = await loadMemory(dir);
    const named = m.individuals.filter(
      (i) => i.class === RULE_CLASS && attr(i, "ruleName") === "grandparent",
    );
    assert.equal(named.length, 2, "both the original and the redefinition are present");
    assert.ok(named.some((i) => i.id === original.id));
    assert.ok(named.some((i) => i.id === redefined.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendRule: rejects an unknown kind and missing slots, honestly (never mints a malformed Rule)", async () => {
  const dir = await tmpRepo();
  try {
    await assert.rejects(
      () => appendRule(dir, { name: "x", kind: "bogus", slots: { base1: "a", base2: "b" } }),
      /kind must be one of/,
    );
    await assert.rejects(
      () => appendRule(dir, { name: "x", kind: RULE_KIND_COMPOSE2, slots: { base1: "a" } }),
      /needs base1 \+ base2/,
    );
    const m = await loadMemory(dir);
    assert.equal(m.individuals.filter((i) => i.class === RULE_CLASS).length, 0, "no partial writes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recountClasses: Rule individuals are counted in classes[] alongside Session/Utterance/Fact/Source", async () => {
  const dir = await tmpRepo();
  try {
    await appendRule(dir, { name: "grandparent", kind: RULE_KIND_COMPOSE2, slots: { base1: "parent", base2: "parent" } });
    await appendRule(dir, { name: "grandfather", kind: RULE_KIND_FILTER, slots: { base: "grandparent", property: "male" } });
    const m = await loadMemory(dir);
    const ruleClass = m.classes.find((c) => c.name === RULE_CLASS);
    assert.ok(ruleClass, "Rule appears in classes[]");
    assert.equal(ruleClass.count, 2);
    assert.equal(ruleClass.sample.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findRuleByName: the query-dispatcher's future entry point — one lookup, no per-name branch", async () => {
  const dir = await tmpRepo();
  try {
    await appendRule(dir, { name: "grandparent", kind: RULE_KIND_COMPOSE2, slots: { base1: "parent", base2: "parent" } });
    const m = await loadMemory(dir);
    const found = findRuleByName(m, "grandparent");
    assert.ok(found, "found by exact name");
    assert.equal(found.class, RULE_CLASS);
    assert.equal(attr(found, "ruleKind"), RULE_KIND_COMPOSE2);
    // normFactTerm-normalized lookup: "the grandparent" / stray whitespace still resolves
    assert.equal(findRuleByName(m, "the grandparent")?.id, found.id);
    assert.equal(findRuleByName(m, "  Grandparent  ")?.id, found.id);
    assert.equal(findRuleByName(m, "nonexistent-rule"), undefined, "an untaught name is an honest miss");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("provenance/trust: a taught Rule rides the SAME Source-derivation + trust pipeline as an ordinary Fact, unmodified", async () => {
  const dir = await tmpRepo();
  try {
    const { id } = await appendRule(dir, {
      name: "grandparent", kind: RULE_KIND_COMPOSE2, slots: { base1: "parent", base2: "parent" },
      provenance: "teach:chat:s1@2026-07-09T00:00:00.000Z",
    });
    const m = await loadMemory(dir);
    const r = m.individuals.find((i) => i.id === id);

    // a Source individual was derived from the provenance tag, exactly the way
    // syncFactSources derives one for a Fact (memory-core.test.mjs's own
    // "appendFacts: ONE write for a whole batch" test asserts the identical
    // shape for a Fact — same assertion, now against a Rule).
    assert.equal(attr(r, "provenance"), "teach:chat:s1@2026-07-09T00:00:00.000Z");
    const sources = m.individuals.filter((i) => i.class === SOURCE_CLASS);
    assert.ok(sources.some((s) => attr(s, "sourceType") === "teach"), "a teach Source was derived");

    const statedGroup = m.objectProperties.find((g) => g.prop === "mgx:statedBy");
    assert.ok(statedGroup, "a statedBy edge group exists");
    assert.ok(statedGroup.examples.some((e) => e.subject === id), "the Rule itself is statedBy some Source");

    // trust score materialised on the Rule individual, same TRUST_SCORE_PROP a
    // Fact carries — proves recomputeFactTrust ran against it unmodified.
    const trust = Number(attr(r, "trustScore"));
    assert.ok(trust > 0, "trust materialised on the Rule individual");
    assert.ok(attr(r, "trustInputs"), "the auditable trust-inputs JSON was written too");

    // Confirm this is genuinely the SAME pipeline, not a parallel one: a Fact
    // taught via the identical provenance tag in the SAME store produces the
    // same source id and a comparable trust score.
    const { appendFact } = await import("../../src/adapters/memory/core.mjs");
    await appendFact(dir, {
      subject: "ahab", predicate: "isa", object: "captain",
      provenance: "teach:chat:s1@2026-07-09T00:00:00.000Z",
    });
    const m2 = await loadMemory(dir);
    const fact = m2.individuals.find((i) => i.class === FACT_CLASS);
    const ruleAgain = m2.individuals.find((i) => i.id === id);
    assert.equal(attr(fact, "trustScore"), attr(ruleAgain, "trustScore"), "identical provenance -> identical trust score, Fact and Rule alike");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
