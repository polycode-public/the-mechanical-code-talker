// The action Rule family: one taught sentence = one Rule individual,
// signature/precondition/effect kinds sharing one mgx:ruleName, collected by
// name at plan time. Also pins ruleIdFor's content-address byte-stability
// across the slot-array generalization.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendRule,
  findRuleByName,
  findRulesByName,
  readRuleRows,
  loadMemory,
  resolveRelationChase,
  resolveRelationChaseReverse,
  normFactTerm,
  RULE_KIND_ACTION_SIGNATURE,
  RULE_KIND_ACTION_PRECOND,
  RULE_KIND_ACTION_EFFECT,
} from "../../src/adapters/memory/core.mjs";
import { validateIndividual } from "../../src/adapters/memory/shacl.mjs";
import { findActionPath, findReachableSet } from "../../src/domain/planning.mjs";

const tempDir = () => mkdtemp(join(tmpdir(), "tmct-rules-action-"));

// Minimal helpers bag for the chase functions: no facts, no aliases — enough
// to prove the dispatch declines honestly on an action-family name.
const chaseHelpers = {
  relationFactsFor: () => [],
  renderFactLine: (f) => `${f.subject} ${f.predicate} ${f.object}`,
  factPhrase: (f) => `${f.subject} ${f.predicate} ${f.object}`,
  factTermVariants: (norm, t) => new Set([norm(t)]),
  byTrust: () => 0,
  rows: [],
  HAS_PROPERTY_PREDICATE: "mgx:hasProperty",
  findActionPath,
  findReachableSet,
};

test("compose2 rule ids are byte-stable across the ruleIdFor generalization", async () => {
  const dir = await tempDir();
  try {
    const { id } = await appendRule(dir, {
      name: "grandparent",
      kind: "compose2",
      slots: { base1: "parent", base2: "parent" },
      provenance: "pin:test",
    });
    // Computed with the pre-generalization (kind, name, slot1, slot2) template.
    assert.equal(id, "rule:6ee9f121");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("each action kind round-trips through appendRule and readRuleRows", async () => {
  const dir = await tempDir();
  try {
    await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_SIGNATURE,
      slots: { subjectClass: "disk", targetClass: "peg" },
      provenance: "teach:test",
    });
    await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_PRECOND,
      slots: { shape: "no-incoming", predicate: "rest-on", role: "subject", scope: "any" },
      provenance: "teach:test",
    });
    await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_EFFECT,
      slots: { predicate: "rest-on", subjectRole: "subject", objectRole: "target" },
      provenance: "teach:test",
    });
    const memory = await loadMemory(dir);
    const rows = readRuleRows(memory).filter((r) => r.name === "move onto");
    assert.equal(rows.length, 3);
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    assert.deepEqual(byKind[RULE_KIND_ACTION_SIGNATURE].slots, { subjectClass: "disk", targetClass: "peg" });
    // value/negate (precond) and value (effect) are the fact-value shape's
    // optional slots — readRuleRows defaults an unwritten one to "", the
    // same "not supplied" signal an omitted key gives domain.mjs.
    assert.deepEqual(byKind[RULE_KIND_ACTION_PRECOND].slots, {
      shape: "no-incoming", predicate: "rest-on", role: "subject", scope: "any", value: "", negate: "",
    });
    assert.deepEqual(byKind[RULE_KIND_ACTION_EFFECT].slots, {
      predicate: "rest-on", subjectRole: "subject", objectRole: "target", value: "",
    });
    for (const r of rows) assert.match(r.provenance, /teach:test/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two same-name preconditions with different slots coexist; identical re-teach upserts", async () => {
  const dir = await tempDir();
  try {
    const first = await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_PRECOND,
      slots: { shape: "no-incoming", predicate: "rest-on", role: "subject", scope: "any" },
    });
    const second = await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_PRECOND,
      slots: { shape: "no-incoming", predicate: "rest-on", role: "target", scope: "any" },
    });
    const repeat = await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_PRECOND,
      slots: { shape: "no-incoming", predicate: "rest-on", role: "subject", scope: "any" },
    });
    assert.notEqual(first.id, second.id);
    assert.equal(first.id, repeat.id);
    const memory = await loadMemory(dir);
    const preconds = readRuleRows(memory).filter((r) => r.kind === RULE_KIND_ACTION_PRECOND);
    assert.equal(preconds.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findRulesByName returns the whole family, sorted by kind then id", async () => {
  const dir = await tempDir();
  try {
    await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_SIGNATURE,
      slots: { subjectClass: "disk", targetClass: "peg" },
    });
    await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_EFFECT,
      slots: { predicate: "rest-on", subjectRole: "subject", objectRole: "target" },
    });
    await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_PRECOND,
      slots: { shape: "no-incoming", predicate: "rest-on", role: "subject", scope: "any" },
    });
    const memory = await loadMemory(dir);
    const family = findRulesByName(memory, "move onto");
    assert.equal(family.length, 3);
    const kinds = family.map((i) => i.attributes.find((a) => a.prop === "mgx:ruleKind").value);
    assert.deepEqual(kinds, [RULE_KIND_ACTION_EFFECT, RULE_KIND_ACTION_PRECOND, RULE_KIND_ACTION_SIGNATURE]);
    // findRuleByName still answers (with one family member) for existing callers.
    assert.ok(findRuleByName(memory, "move onto"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readRuleRows sorts deterministically and skips nothing it can read", async () => {
  const dir = await tempDir();
  try {
    await appendRule(dir, { name: "grandparent", kind: "compose2", slots: { base1: "parent", base2: "parent" } });
    await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_SIGNATURE,
      slots: { subjectClass: "disk", targetClass: "peg" },
    });
    const memory = await loadMemory(dir);
    const rows = readRuleRows(memory);
    assert.deepEqual(rows.map((r) => r.name), ["grandparent", "move onto"]);
    for (const r of rows) {
      assert.ok(r.id.startsWith("rule:"));
      assert.equal(typeof r.slots, "object");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SHACL rejects a malformed action rule", () => {
  const bogusKind = validateIndividual({
    id: "rule:x", label: "x", class: "Rule",
    attributes: [
      { prop: "mgx:ruleName", key: "ruleName", value: "move onto" },
      { prop: "mgx:ruleKind", key: "ruleKind", value: "action-bogus" },
    ],
  });
  assert.equal(bogusKind.ok, false);

  const missingSlot = validateIndividual({
    id: "rule:y", label: "y", class: "Rule",
    attributes: [
      { prop: "mgx:ruleName", key: "ruleName", value: "move onto" },
      { prop: "mgx:ruleKind", key: "ruleKind", value: RULE_KIND_ACTION_PRECOND },
      { prop: "mgx:ruleActionPrecondShape", key: "shape", value: "no-incoming" },
      { prop: "mgx:ruleActionPrecondPredicate", key: "predicate", value: "rest-on" },
      { prop: "mgx:ruleActionPrecondRole", key: "role", value: "subject" },
      // scope missing
    ],
  });
  assert.equal(missingSlot.ok, false);
});

test("the relation chases decline honestly on an action-family name", async () => {
  const dir = await tempDir();
  try {
    await appendRule(dir, {
      name: "move onto",
      kind: RULE_KIND_ACTION_SIGNATURE,
      slots: { subjectClass: "disk", targetClass: "peg" },
    });
    const memory = await loadMemory(dir);
    const forward = await resolveRelationChase(memory, "move onto", "disk-1", "peg-a", {
      ...chaseHelpers, factTermVariants: (norm, t) => new Set([norm(t)]),
    });
    assert.equal(forward, null);
    const reverse = await resolveRelationChaseReverse(memory, "move onto", "peg-a", chaseHelpers);
    assert.deepEqual(reverse, []);
    assert.equal(normFactTerm("Move Onto"), "move onto");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
