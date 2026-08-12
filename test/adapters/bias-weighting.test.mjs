// bias-weighting.test.mjs — Part 6 of the extension-pack batch: bias-weighted
// fact ranking (src/domain/memory/bias.mjs), and its wiring into chat.mjs's
// fact-listing lanes.
//
// Pure unit coverage for biasForSourceId/biasForRow/rankByBiasThenTrust, then
// an end-to-end drive through the REAL seeding path (src/adapters/corpus/conceptnet.mjs
// seedMemory, two different provenancePrefixes — the exact shape two active
// extension bundles produce) and runTurn's own fact-listing answer, proving:
//   - a higher-bias bundle's fact renders FIRST;
//   - the lower-bias fact is STILL PRESENT and cited (never dropped/hidden);
//   - with no [bias] configured, the order falls to the facts' own content and
//     not to the order they were seeded in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { biasForSourceId, biasForRow, rankByBiasThenTrust } from "../../src/domain/memory/bias.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { seedMemory } from "../../src/adapters/corpus/conceptnet.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

// ---- pure unit tests --------------------------------------------------------

test("biasForSourceId: src:corpus:<name> resolves against biasByBundle; unconfigured/non-corpus -> 1", () => {
  const bias = { seon: 1.5, "tier2-aws": 0.5 };
  assert.equal(biasForSourceId("src:corpus:seon", bias), 1.5);
  assert.equal(biasForSourceId("src:corpus:tier2-aws", bias), 0.5);
  assert.equal(biasForSourceId("src:corpus:conceptnet", bias), 1, "unconfigured bundle -> neutral 1");
  assert.equal(biasForSourceId("src:operator-chat", bias), 1, "a non-corpus source id is never a bundle");
  assert.equal(biasForSourceId("src:teach-chat", bias), 1);
  assert.equal(biasForSourceId("src:entailed:transitivity", bias), 1);
  assert.equal(biasForSourceId("", bias), 1);
  assert.equal(biasForSourceId(undefined, bias), 1);
  assert.equal(biasForSourceId("src:corpus:seon"), 1, "no biasByBundle arg at all -> neutral");
});

test("biasForSourceId: a non-numeric configured value is ignored (neutral), never throws", () => {
  assert.equal(biasForSourceId("src:corpus:seon", { seon: "high" }), 1);
  assert.equal(biasForSourceId("src:corpus:seon", { seon: NaN }), 1);
  assert.equal(biasForSourceId("src:corpus:seon", { seon: null }), 1);
});

test("biasForRow: the MAX bias across a row's sourceIds; empty/absent -> neutral 1", () => {
  const bias = { seon: 2, "tier2-aws": 0.5 };
  assert.equal(biasForRow({ sourceIds: ["src:corpus:tier2-aws", "src:corpus:seon"] }, bias), 2, "max, not averaged down");
  assert.equal(biasForRow({ sourceIds: ["src:corpus:tier2-aws"] }, bias), 0.5);
  assert.equal(biasForRow({ sourceIds: [] }, bias), 1);
  assert.equal(biasForRow({}, bias), 1);
  assert.equal(biasForRow(null, bias), 1);
});

test("rankByBiasThenTrust: bias desc, then trust desc, then content — never drops a row", () => {
  const bias = { high: 2, low: 0.5 };
  const row = (subject, trust, sourceIds) => ({ subject, predicate: "mgx:hasProperty", object: "x", trust, sourceIds });
  const rows = [
    row("a", 0.9, ["src:corpus:low"]),
    row("b", 0.5, ["src:corpus:high"]),
    row("c", 0.99, ["src:corpus:high"]), // ties bias with b, wins on trust
    row("e", 0.5, []),                   // neutral bias 1, tied trust with d
    row("d", 0.5, []),
  ];
  const ranked = rankByBiasThenTrust(rows, bias);
  assert.deepEqual(ranked.map((r) => r.subject), ["c", "b", "d", "e", "a"],
    "d before e on content, though e arrived first");
  assert.equal(ranked.length, rows.length, "every row comes back out — nothing dropped");
});

test("rankByBiasThenTrust: equal-trust rows rank by content, whichever order they arrive in", () => {
  const rows = [
    { subject: "a", predicate: "p", object: "o", trust: 0.5 },
    { subject: "b", predicate: "p", object: "o", trust: 0.9 },
    { subject: "c", predicate: "p", object: "o", trust: 0.5 },
    { subject: "d", predicate: "p", object: "o", trust: 0.7 },
  ];
  const expected = ["b", "d", "a", "c"];
  assert.deepEqual(rankByBiasThenTrust(rows).map((r) => r.subject), expected);
  assert.deepEqual(rankByBiasThenTrust(rows, {}).map((r) => r.subject), expected);
  assert.deepEqual(rankByBiasThenTrust([...rows].reverse()).map((r) => r.subject), expected,
    "the reversed arrival order ranks identically");
});

test("rankByBiasThenTrust: rows tied on trust and content split on provenance, not on arrival", () => {
  const rows = [
    { subject: "a", predicate: "p", object: "o", trust: 0.5, provenance: "corpus:two" },
    { subject: "a", predicate: "p", object: "o", trust: 0.5, provenance: "corpus:one" },
  ];
  assert.deepEqual(rankByBiasThenTrust(rows).map((r) => r.provenance), ["corpus:one", "corpus:two"]);
  assert.deepEqual(rankByBiasThenTrust([...rows].reverse()).map((r) => r.provenance), ["corpus:one", "corpus:two"]);
});

test("rankByBiasThenTrust: non-array input degrades to []", () => {
  assert.deepEqual(rankByBiasThenTrust(null), []);
  assert.deepEqual(rankByBiasThenTrust(undefined), []);
});

// ---- end-to-end: the real seeding path + runTurn's fact-listing answer -----

const tmp = () => mkdtemp(join(tmpdir(), "tmct-bias-e2e-"));

/** Seed one conflicting-fact pair — "widget x" mgx:hasProperty {red|blue} —
 *  from two DIFFERENT provenancePrefixes, the exact shape two active
 *  corpus-kind extension bundles (src/services/extensions.mjs) produce via seedMemory.
 *  "red" (tier2-aws) is seeded FIRST, "blue" (seon) SECOND, and both are equally
 *  corpus-trusted — so with no bias configured the pair ties on everything a
 *  rank reads and falls to its own content. `seedFirst` flips which one arrives
 *  first, for the reader that has to prove arrival stopped counting. */
async function seedConflictingPair(dir, seedFirst = "red") {
  const sliceA = join(dir, "aws.jsonl");
  const sliceB = join(dir, "seon.jsonl");
  await writeFile(sliceA, JSON.stringify({ start: "/c/en/widget_x", rel: "/r/HasProperty", end: "/c/en/red", weight: 1 }) + "\n");
  await writeFile(sliceB, JSON.stringify({ start: "/c/en/widget_x", rel: "/r/HasProperty", end: "/c/en/blue", weight: 1 }) + "\n");
  const red = () => seedMemory(dir, { slicePath: sliceA, provenancePrefix: "corpus:tier2-aws" });
  const blue = () => seedMemory(dir, { slicePath: sliceB, provenancePrefix: "corpus:seon" });
  if (seedFirst === "red") { await red(); await blue(); } else { await blue(); await red(); }
}

test("end-to-end: a higher-bias bundle's fact renders FIRST; the lower-bias fact is STILL PRESENT and cited", async () => {
  const dir = await tmp();
  try {
    clearCache();
    await seedConflictingPair(dir);
    const config = { graphFile: join(dir, ".tmct", "graph.json") }; // empty bootstrap graph
    const biasByBundle = { seon: 5 }; // seon (blue) outweighs tier2-aws (red, default 1)
    const r = await runTurn("what do you know about widget x", { config, memoryDir: dir, biasByBundle });
    const redIdx = r.answer.indexOf("widget x is red");
    const blueIdx = r.answer.indexOf("widget x is blue");
    assert.ok(redIdx >= 0 && blueIdx >= 0, `both facts are present/cited: ${r.answer}`);
    assert.ok(blueIdx < redIdx, `the higher-bias (seon) fact renders FIRST: ${r.answer}`);
    assert.match(r.answer, /\(source: corpus:tier2-aws/, "the lower-bias fact still carries its own provenance");
    assert.match(r.answer, /\(source: corpus:seon/, "the higher-bias fact carries its own provenance");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("end-to-end: flipping the bias flips the render order — bias only REORDERS, never drops either fact", async () => {
  const dir = await tmp();
  try {
    clearCache();
    await seedConflictingPair(dir);
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const r = await runTurn("what do you know about widget x", { config, memoryDir: dir, biasByBundle: { "tier2-aws": 5 } });
    const redIdx = r.answer.indexOf("widget x is red");
    const blueIdx = r.answer.indexOf("widget x is blue");
    assert.ok(redIdx >= 0 && blueIdx >= 0, `both facts still present: ${r.answer}`);
    assert.ok(redIdx < blueIdx, `now the higher-bias (tier2-aws) fact renders FIRST: ${r.answer}`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("end-to-end: with NO [bias] configured, omitting biasByBundle and passing {} produce the same output order", async () => {
  const dir = await tmp();
  try {
    clearCache();
    await seedConflictingPair(dir);
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const withoutOpt = await runTurn("what do you know about widget x", { config, memoryDir: dir }); // biasByBundle omitted entirely
    const withEmpty = await runTurn("what do you know about widget x", { config, memoryDir: dir, biasByBundle: {} });
    assert.equal(withoutOpt.answer, withEmpty.answer, "omitting biasByBundle === passing {} explicitly");
    // Both corpus-single-source facts tie on trust, so the neutral-bias order
    // falls to the objects' own spelling: "blue" before "red".
    const redIdx = withoutOpt.answer.indexOf("widget x is red");
    const blueIdx = withoutOpt.answer.indexOf("widget x is blue");
    assert.ok(redIdx >= 0 && blueIdx >= 0);
    assert.ok(blueIdx < redIdx, `unconfigured bias falls to content order: ${withoutOpt.answer}`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("end-to-end: seeding the same pair in the other order renders byte-identical text", async () => {
  const redFirst = await tmp();
  const blueFirst = await tmp();
  try {
    clearCache();
    await seedConflictingPair(redFirst, "red");
    const a = await runTurn("what do you know about widget x", {
      config: { graphFile: join(redFirst, ".tmct", "graph.json") }, memoryDir: redFirst,
    });
    clearCache();
    await seedConflictingPair(blueFirst, "blue");
    const b = await runTurn("what do you know about widget x", {
      config: { graphFile: join(blueFirst, ".tmct", "graph.json") }, memoryDir: blueFirst,
    });
    assert.equal(a.answer, b.answer, "the same facts on the same lines, whichever bundle was seeded first");
  } finally {
    clearCache();
    await rm(redFirst, { recursive: true, force: true });
    await rm(blueFirst, { recursive: true, force: true });
  }
});
