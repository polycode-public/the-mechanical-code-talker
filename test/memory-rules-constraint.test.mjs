// The action-constraint Rule kind: slot round-trip through appendRule and
// readRuleRows, content-addressed coexistence/upsert, and the SHACL gate.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendRule, loadMemory, readRuleRows, RULE_KIND_ACTION_CONSTRAINT,
} from "../src/memory/core.mjs";
import { validateIndividual } from "../src/memory/shacl.mjs";

test("an action-constraint rule round-trips its left/right/guard slots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-rules-constraint-"));
  try {
    const first = await appendRule(dir, {
      name: "haul onto",
      kind: RULE_KIND_ACTION_CONSTRAINT,
      slots: { left: "alpha", right: "beta", guard: "escort" },
      provenance: "teach:test",
    });
    const sibling = await appendRule(dir, {
      name: "haul onto",
      kind: RULE_KIND_ACTION_CONSTRAINT,
      slots: { left: "beta", right: "gamma", guard: "escort" },
    });
    const repeat = await appendRule(dir, {
      name: "haul onto",
      kind: RULE_KIND_ACTION_CONSTRAINT,
      slots: { left: "alpha", right: "beta", guard: "escort" },
    });
    assert.notEqual(first.id, sibling.id, "different slots coexist");
    assert.equal(first.id, repeat.id, "an identical re-teach upserts");

    const rows = readRuleRows(await loadMemory(dir)).filter((r) => r.kind === RULE_KIND_ACTION_CONSTRAINT);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.slots), [
      { left: "alpha", right: "beta", guard: "escort" },
      { left: "beta", right: "gamma", guard: "escort" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendRule rejects an action-constraint with a missing slot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-rules-constraint-"));
  try {
    await assert.rejects(
      appendRule(dir, {
        name: "haul onto",
        kind: RULE_KIND_ACTION_CONSTRAINT,
        slots: { left: "alpha", right: "beta" },
      }),
      /needs left \+ right \+ guard/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SHACL rejects an action-constraint individual missing its guard slot", () => {
  const missingGuard = validateIndividual({
    id: "rule:x", label: "x", class: "Rule",
    attributes: [
      { prop: "mgx:ruleName", key: "ruleName", value: "haul onto" },
      { prop: "mgx:ruleKind", key: "ruleKind", value: RULE_KIND_ACTION_CONSTRAINT },
      { prop: "mgx:ruleActionConstraintLeft", key: "left", value: "alpha" },
      { prop: "mgx:ruleActionConstraintRight", key: "right", value: "beta" },
    ],
  });
  assert.equal(missingGuard.ok, false);
});
