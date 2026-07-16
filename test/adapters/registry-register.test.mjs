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
import { resolveOne } from "../../src/domain/router/resolver.mjs";
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

const symbolParam = {
  parameters: [{ type: VOCAB.Parameter, name: "symbol", kind: "seon:CodeEntity", arg: "symbol", required: true }],
  preconditions: [{ type: VOCAB.Precondition, pred: PRECOND.resolves, param: "symbol", as: "seon:CodeEntity" }],
};

// The resolver reaches a runtime-registered record only through an injected command
// register (it backward-chains `knows` topics, which a taught record never carries), so
// that is the seam these drive the read-only gate through.
const commandCtx = (capName, calls) => ({
  selectTool: () => ({ name: capName, input: { symbol: "Widget" } }),
  resolve: () => ({ match: { label: "Widget" }, ambiguous: false, tier: 1 }),
  dispatch: async (name, input) => { calls.push({ name, input }); return { ok: true, text: "dispatched" }; },
});

test("the resolver refuses to dispatch a readOnly:false capability — an observation never fires a write", async () => {
  const calls = [];
  const unregister = registerCapability(record("taught:test-resolver-guard", symbolParam));
  try {
    const r = await resolveOne("guard Widget", ["taught:test-resolver-guard"], commandCtx("taught:test-resolver-guard", calls));
    assert.equal(r.refused, true);
    assert.equal(r.selected, null);
    assert.match(r.reason, /not read-only/);
    assert.equal(calls.length, 0, "the gate stops the dispatch, nothing was fired");
  } finally {
    unregister();
  }
});

test("the resolver's read-only gate admits an otherwise identical readOnly:true record", async () => {
  const calls = [];
  const unregister = registerCapability(record("taught:test-resolver-open", { ...symbolParam, readOnly: true }));
  try {
    const r = await resolveOne("guard Widget", ["taught:test-resolver-open"], commandCtx("taught:test-resolver-open", calls));
    assert.ok(!r.refused, r.reason);
    assert.equal(r.selected.name, "taught:test-resolver-open");
    assert.deepEqual(calls, [{ name: "taught:test-resolver-open", input: { symbol: "Widget" } }]);
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
