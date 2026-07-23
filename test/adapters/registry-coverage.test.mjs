// registry-coverage.test.mjs — every DISPATCHABLE tool (the name dispatchTool
// actually serves) is either a declared capability or a documented
// EXCLUDED_FROM_REGISTRY entry, never neither and never both. tmct_related sat
// outside both before its 2.7.12 fix; tmct_ingest/tmct_export shipped into the
// same gap. This is the coverage sweep that catches a THIRD tool doing it again.
import { test } from "node:test";
import assert from "node:assert/strict";

import { TOOL_NAMES } from "../../src/tools/definitions.mjs";
import { capabilities, isCapability, EXCLUDED_FROM_REGISTRY } from "../../src/domain/router/registry.mjs";

test("conformance tool→registry: every declared tool is a capability XOR an EXCLUDED_FROM_REGISTRY entry", () => {
  const orphans = [];
  for (const name of TOOL_NAMES) {
    const registered = isCapability(name);
    const excluded = name in EXCLUDED_FROM_REGISTRY;
    if (registered && excluded) orphans.push(`${name} is both a capability and excluded`);
    if (!registered && !excluded) orphans.push(name);
    if (excluded) assert.equal(typeof EXCLUDED_FROM_REGISTRY[name], "string", `EXCLUDED_FROM_REGISTRY.${name} carries a reason`);
  }
  assert.deepEqual(orphans, [], `declared tools must be a capability or a documented exclusion (found: ${orphans.join(", ")})`);
});

test("conformance registry→tool: EXCLUDED_FROM_REGISTRY names only real, currently-dispatchable tools", () => {
  const toolSet = new Set(TOOL_NAMES);
  for (const name of Object.keys(EXCLUDED_FROM_REGISTRY)) {
    assert.ok(toolSet.has(name), `EXCLUDED_FROM_REGISTRY.${name} names a declared tool`);
    assert.ok(!isCapability(name), `${name} is excluded but IS a registered capability — remove the entry`);
  }
});

test("tmct_ingest and tmct_export are documented exclusions, not a silent registry gap", () => {
  assert.ok("tmct_ingest" in EXCLUDED_FROM_REGISTRY);
  assert.ok("tmct_export" in EXCLUDED_FROM_REGISTRY);
  assert.ok(!isCapability("tmct_ingest"));
  assert.ok(!isCapability("tmct_export"));
});

test("capabilities() only ever holds tools the definitions still declare — no stale registrations", () => {
  const toolSet = new Set(TOOL_NAMES);
  for (const cap of capabilities()) {
    if (cap.name.startsWith("taught:")) continue; // runtime-registered, not one of the declared tools
    assert.ok(toolSet.has(cap.name), `capability "${cap.name}" names a declared tool`);
  }
});
