// The runtime-readable AGENTBENCH capability envelope: a downstream consumer
// (bedrock-meter's tripwire calibration) imports this instead of hand-copying
// test-benchmarks/agentbench/envelope.json's stamped figures into its own
// source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { agentbenchEnvelope } from "../../test-benchmarks/agentbench/envelope-reader.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(HERE, "..", "..", "test-benchmarks", "agentbench", "envelope.json");

test("agentbenchEnvelope() carries the stamped capability fields", () => {
  const envelope = agentbenchEnvelope();
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(typeof envelope.generatedFrom.stamp, "string");
  assert.ok("maxContextTokens" in envelope.capability);
  assert.equal(typeof envelope.capability.maxContextTokensMeasured, "boolean");
  assert.equal(typeof envelope.capability.structuredOk, "boolean");
  assert.equal(typeof envelope.capability.toolsOk, "boolean");
  assert.ok(Array.isArray(envelope.ladder.rungs) && envelope.ladder.rungs.length > 0);
});

test("agentbenchEnvelope() matches the committed envelope.json exactly", () => {
  const committed = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
  assert.deepEqual(agentbenchEnvelope(), committed);
});

test("agentbenchEnvelope() hands back a fresh object each call, so a caller can't corrupt another caller's read", () => {
  const first = agentbenchEnvelope();
  first.capability.toolsOk = "mutated";
  const second = agentbenchEnvelope();
  assert.notEqual(second.capability.toolsOk, "mutated");
});

test("the package's ./envelope subpath resolves to the same reader", async () => {
  const subpath = await import("@polycode-projects/the-mechanical-code-talker/envelope");
  assert.deepEqual(subpath.agentbenchEnvelope(), agentbenchEnvelope());
});
