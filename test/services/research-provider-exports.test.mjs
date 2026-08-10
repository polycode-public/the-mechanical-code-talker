// Pins the public seam a research-provider consumer reaches: registration
// resolved through the package's own `exports` map (the "." entry), the same
// way registerProvider already works for fetchEntities — not a relative
// import into src/, which an external consumer cannot take.
import { test } from "node:test";
import assert from "node:assert/strict";

import { researchSources } from "../../src/adapters/corpus/research-source.mjs";

const tmct = await import("@polycode-projects/the-mechanical-code-talker");

test("registerResearchProvider and registerResearchSource resolve off the package root", () => {
  assert.equal(typeof tmct.registerResearchProvider, "function");
  assert.equal(typeof tmct.registerResearchSource, "function");
});

test("registerResearchSource, called through the package root, registers a source the shared registry then lists", async () => {
  let created = 0;
  const custom = { name: "consumer-style-source-pin", origin: "https://example.invalid", lookup: async () => null, provenanceTag: () => "research:consumer-style-source-pin:x" };
  tmct.registerResearchSource({ name: "consumer-style-source-pin", create: () => { created += 1; return custom; } });
  const entry = researchSources().find((e) => e.name === "consumer-style-source-pin");
  assert.ok(entry, "the package-root call reaches the same registry the built-in adapters register into");
  assert.equal(entry.create(), custom);
  assert.equal(created, 1);
});

test("registerResearchProvider, called through the package root, swaps the active provider outright", async () => {
  const { getResearchProvider } = await import("../../src/adapters/corpus/wikipedia-live.mjs");
  const stub = { lookup: async () => null };
  try {
    tmct.registerResearchProvider(stub);
    assert.equal(getResearchProvider(), stub);
  } finally {
    tmct.registerResearchProvider(null);
  }
});
