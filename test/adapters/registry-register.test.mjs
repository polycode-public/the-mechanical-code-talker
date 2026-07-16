// registerCapability: the runtime registration seam, its readOnly dispatch
// guard, and the taught-action bridge that feeds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REGISTRY, capabilities, capabilityByName, isCapability,
  registerCapability, PRECOND, VOCAB,
} from "../../src/domain/router/registry.mjs";
import { guard } from "../../src/domain/router/guardrail.mjs";
import { actionFamilies, capabilityFromActionRules, registerTaughtActions } from "../../src/domain/router/taught.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readRuleRows } from "../../src/adapters/memory/core.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const record = (name, extra = {}) => ({
  name,
  label: name,
  question: "a test capability",
  readOnly: false,
  parameters: [],
  preconditions: [],
  effects: { add: [], del: [] },
  ...extra,
});

test("register/unregister round-trip: accessors and REGISTRY.capabilities stay live", () => {
  const before = capabilities().length;
  const unregister = registerCapability(record("taught:test-roundtrip"));
  try {
    assert.equal(capabilities().length, before + 1);
    assert.equal(REGISTRY.capabilities.length, before + 1);
    assert.ok(isCapability("taught:test-roundtrip"));
    assert.equal(capabilityByName("taught:test-roundtrip").dispatchable, false);
  } finally {
    unregister();
  }
  assert.equal(capabilities().length, before);
  assert.equal(REGISTRY.capabilities.length, before);
  assert.ok(!isCapability("taught:test-roundtrip"));
});

test("registration validates: unique name, explicit boolean readOnly, effects shape", () => {
  assert.throws(() => registerCapability(record("")), /non-empty name/);
  assert.throws(() => registerCapability(record("tmct_describe")), /already registered/);
  assert.throws(() => registerCapability({ ...record("taught:x"), readOnly: undefined }), /explicit boolean readOnly/);
  assert.throws(() => registerCapability({ ...record("taught:x"), effects: {} }), /effects \{add/);
});

test("dispatch guard: the candidate enrichment never dispatches a readOnly:false capability", async () => {
  const unregister = registerCapability(record("taught:test-guard", {
    parameters: [{ type: VOCAB.Parameter, name: "symbol", kind: "seon:CodeEntity", arg: "symbol", required: true }],
    preconditions: [{ type: VOCAB.Precondition, pred: PRECOND.resolves, param: "symbol", as: "seon:CodeEntity" }],
  }));
  const calls = [];
  const ctx = {
    resolve: () => ({ match: { label: "a" }, ambiguous: true, candidates: [{ label: "b" }] }),
    dispatch: async (name, input) => { calls.push({ name, input }); return { ok: true }; },
  };
  try {
    const verdict = await guard({ name: "taught:test-guard", input: { symbol: "amb" } }, null, ctx);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.candidateResults, undefined);
    assert.equal(calls.length, 0);
    // The same ambiguous context against a readOnly builtin still enriches.
    const builtin = await guard({ name: "tmct_describe", input: { symbol: "amb" } }, null, ctx);
    assert.ok(Array.isArray(builtin.candidateResults));
    assert.ok(calls.length > 0);
  } finally {
    unregister();
  }
});

test("taught bridge: the hanoi move family maps to a well-formed record; registration is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-taught-"));
  const teach = [
    "you can move a disk onto a peg.",
    "you can move a disk onto a disk.",
    "to move a disk onto a target, nothing may rest on the disk.",
    "to move a disk onto a disk, the disk must be smaller than the target.",
    "moving a disk onto a target makes the disk rest on the target.",
  ];
  try {
    for (const line of teach) {
      const r = await runTurn(line, { memoryDir: dir });
      assert.match(String(r.answer), /^noted/, `teach failed: ${line}`);
    }
    const memory = await loadMemory(dir);
    const payload = memory.payload ?? memory;
    const ruleRows = readRuleRows(payload);
    const families = actionFamilies(ruleRows);
    assert.equal(families.size, 1);
    const [name, family] = [...families.entries()][0];
    const cap = capabilityFromActionRules(name, family);
    assert.equal(cap.name, `taught:${name}`);
    assert.equal(cap.readOnly, false);
    assert.deepEqual(cap.parameters[0].classes, ["disk"]);
    assert.deepEqual(cap.parameters[1].classes, ["disk", "peg"]);
    assert.equal(cap.preconditions.length, 2);
    assert.equal(cap.effects.add.length, 1);
    assert.equal(cap.effects.add[0].predicate, "rest-on");

    const disposers = registerTaughtActions(ruleRows);
    try {
      assert.equal(disposers.length, 1);
      assert.ok(isCapability(cap.name));
      assert.equal(registerTaughtActions(ruleRows).length, 0);
    } finally {
      for (const d of disposers) d();
    }
    assert.ok(!isCapability(cap.name));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
