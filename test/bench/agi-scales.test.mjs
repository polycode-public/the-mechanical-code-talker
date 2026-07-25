// AGI-scales aggregator tests (PLAN_BENCHMARK_MECHANISATION.md lever 7): the row
// builder reads the sibling benches' committed envelopes and emits the eight
// entry-rung readings mechanically, marking a scale MEASURED only when a bench
// artifact actually produced the scalar — never fabricating a rung.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildAgiRow, goalNotchFromRung, renderAgiRow } from "../../scripts/agi-scales-aggregate.mjs";

const ENVELOPE_FILE = fileURLToPath(new URL("../../test-benchmarks/agentbench/envelope.json", import.meta.url));

test("goalNotchFromRung maps AGENTBENCH ladder rungs to goal-origination notches", () => {
  assert.equal(goalNotchFromRung(null), null);
  assert.equal(goalNotchFromRung("TOOL-3").notch, 1);
  assert.equal(goalNotchFromRung("TOOL-6").notch, 2);
  assert.equal(goalNotchFromRung("TOOL-8").notch, 2);
  assert.equal(goalNotchFromRung("TOOL-9").notch, 3);
});

test("buildAgiRow reads two scalars from the committed AGENTBENCH envelope and leaves the other six assessment-only", async () => {
  const agentbench = JSON.parse(await readFile(ENVELOPE_FILE, "utf8"));
  const row = buildAgiRow({ agentbench, version: "9.9.9" });
  assert.equal(row.benchmark, "AGI_SCALES");
  assert.equal(row.version, "9.9.9");
  assert.equal(row.scales.length, 8);
  const byScale = Object.fromEntries(row.scales.map((s) => [s.scale, s]));
  assert.equal(byScale["abstention-calibration"].measured, true);
  assert.ok(/fabrication 0%/.test(byScale["abstention-calibration"].reading));
  assert.equal(byScale["goal-origination-distance"].measured, true);
  assert.equal(byScale["transfer-breadth"].measured, false);
  assert.equal(byScale["transfer-breadth"].reading, "entry rung held, assessment only");
  assert.equal(row.measuredCount, 2);
});

test("buildAgiRow never fabricates a scalar: no envelope means every scale reads assessment-only", () => {
  const row = buildAgiRow({ agentbench: null, version: "1.0.0" });
  assert.equal(row.measuredCount, 0);
  assert.ok(row.scales.every((s) => s.measured === false));
  assert.ok(row.scales.every((s) => s.reading === "entry rung held, assessment only"));
  assert.equal(row.generatedFrom.agentbench, null);
});

test("buildAgiRow abstention stays UNMEASURED when the envelope does not gate-pass (non-zero fabrication or sub-floor coverage)", () => {
  const dirty = { metrics: { overall: { hallucinationRate: 0.1, planCompletion: 1 } }, ladder: { rungReached: "TOOL-8" } };
  const scaleOf = (env, key) => buildAgiRow({ agentbench: env }).scales.find((s) => s.scale === key);
  assert.equal(scaleOf(dirty, "abstention-calibration").measured, false); // fabrication > 0 -> no scalar
  const lowCov = { metrics: { overall: { hallucinationRate: 0, planCompletion: 0.3 } }, ladder: { rungReached: "TOOL-8" } };
  assert.equal(scaleOf(lowCov, "abstention-calibration").measured, false); // coverage < 50% -> no scalar
  // but goal-origination still reads its notch from the rung
  assert.equal(scaleOf(lowCov, "goal-origination-distance").measured, true);
});

test("renderAgiRow prints one line per scale with its measured/assessment label", () => {
  const md = renderAgiRow(buildAgiRow({ agentbench: null, version: "1.0.0" }));
  assert.ok(md.includes("abstention-calibration"));
  assert.ok(md.includes("assessment only"));
  assert.equal(md.split("\n").filter((l) => l.startsWith("- **")).length, 8);
});

const okAgentbench = { metrics: { overall: { hallucinationRate: 0, planCompletion: 1 } }, ladder: { rungReached: "TOOL-8" } };
const okInfbenchChat = { capability: { chat: { fabricationZero: true, metrics: { overall: { completion: 1 } } } } };
const okChatbench = { capability: { hardFailRate: 0, tier1PassRate: 0.92 } };

test("buildAgiRow's abstention-calibration degrades to the agentbench-only reading when infbench/chatbench envelopes are absent", async () => {
  const agentbench = JSON.parse(await readFile(ENVELOPE_FILE, "utf8"));
  const row = buildAgiRow({ agentbench, version: "9.9.9" });
  const scale = row.scales.find((s) => s.scale === "abstention-calibration");
  assert.equal(scale.measured, true);
  assert.ok(!/spans three pools/.test(scale.reading));
});

test("buildAgiRow's abstention-calibration reports the three-pool reading only once agentbench, infbench's chat arm, and chatbench ALL clear their zero-fabrication check", () => {
  const row = buildAgiRow({ agentbench: okAgentbench, infbench: okInfbenchChat, chatbench: okChatbench, version: "9.9.9" });
  const scale = row.scales.find((s) => s.scale === "abstention-calibration");
  assert.equal(scale.measured, true);
  assert.match(scale.reading, /spans three pools/);
});

test("buildAgiRow's abstention-calibration stays at the agentbench-only reading when only one of infbench/chatbench clears", () => {
  const infOnly = buildAgiRow({ agentbench: okAgentbench, infbench: okInfbenchChat, version: "9.9.9" })
    .scales.find((s) => s.scale === "abstention-calibration");
  assert.ok(!/spans three pools/.test(infOnly.reading));
  const dirtyChat = { capability: { hardFailRate: 0.1, tier1PassRate: 0.9 } };
  const chatDirty = buildAgiRow({ agentbench: okAgentbench, infbench: okInfbenchChat, chatbench: dirtyChat, version: "9.9.9" })
    .scales.find((s) => s.scale === "abstention-calibration");
  assert.ok(!/spans three pools/.test(chatDirty.reading));
});

test("buildAgiRow's knowledge-scale-tolerance reads corpus/child/manifest.json's counts.facts directly, and stays assessment-only when absent", () => {
  const withManifest = buildAgiRow({ childManifest: { counts: { facts: 12345 } }, version: "9.9.9" })
    .scales.find((s) => s.scale === "knowledge-scale-tolerance");
  assert.equal(withManifest.measured, true);
  assert.match(withManifest.reading, /12,345 triples/);
  const withoutManifest = buildAgiRow({ version: "9.9.9" }).scales.find((s) => s.scale === "knowledge-scale-tolerance");
  assert.equal(withoutManifest.measured, false);
});
