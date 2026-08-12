// sense-gate-isa-closure.test.mjs — the disjointness gate on isa derivation.
// A corpus band flattens two word senses onto one label ("region" is both a
// geographic area and an anatomical one), and subClassOf transitivity then
// walks across the join. These pin the refusal, and pin what the refusal must
// never touch: a stated fact, a legitimate multi-hop chain, or the answer's
// independence from ingestion order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFact, appendFacts, loadMemory, readFactRows, removeFacts,
} from "../../src/adapters/memory/core.mjs";
import {
  deriveSubClassClosure, deriveTypePropagation, syllogise as syllogiseSeam,
  SUBCLASS_PREDICATE, TYPE_PREDICATE,
} from "../../src/domain/syllogise.mjs";
import {
  buildSenseGate, disjointTopPairs, TOP_CLASSES, OVERLAPPING_TOP_PAIRS,
} from "../../src/domain/sense-gate.mjs";

const STORE = { loadMemory, readFactRows, appendFacts, removeFacts };
const syllogise = (dir, opts = {}) => syllogiseSeam(dir, { store: STORE, ...opts });
const mkRepo = () => mkdtemp(join(tmpdir(), "tmct-sense-gate-"));

// The committed chain, in the shape the WordNet bands really store it: every
// row below is true of ONE sense of its subject, and `region` is where the two
// senses meet.
const SPECIMEN_EDGES = [
  ["russia", "country"],
  ["country", "place"],
  ["country", "geographical area"],
  ["country", "administrative district"],
  ["geographical area", "region"],
  ["region", "location"],
  ["region", "body part"],
  ["body part", "part"],
  ["moscow", "city"],
  ["city", "place"],
  ["city", "municipality"],
  ["musical composition", "music"],
  ["music", "communication"],
  ["premise", "postulate"],
  ["postulate", "message"],
  // a clean lineage with no sense join anywhere in it
  ["dog", "canine"],
  ["canine", "carnivore"],
  ["carnivore", "mammal"],
  ["mammal", "vertebrate"],
  ["vertebrate", "animal"],
  ["animal", "organism"],
];

const gateOver = (edges, typeEdges = []) => buildSenseGate({ subClassEdges: edges, typeEdges });
const derived = (edges, opts) => deriveSubClassClosure(edges, { budget: 10000, ...opts });
const has = (rows, s, o) => rows.some((d) => d.subject === s && d.object === o);

// ---- placing a term ---------------------------------------------------------

test("topsOf places a term by the nearest level its own asserted chain reaches", () => {
  const gate = gateOver(SPECIMEN_EDGES);
  assert.deepEqual(gate.topsOf("russia"), ["place"], "russia reaches place in two hops, body part in four");
  assert.deepEqual(gate.topsOf("body part"), ["body part"], "a top's own label places it directly");
  assert.deepEqual(gate.topsOf("musical composition"), ["communication"]);
  assert.deepEqual(gate.topsOf("premise"), ["communication"]);
  assert.deepEqual(gate.topsOf("dog"), ["living thing"]);
});

test("topsOf returns BOTH tops for a term genuinely under two of them", () => {
  const gate = gateOver(SPECIMEN_EDGES);
  assert.deepEqual(gate.topsOf("region"), ["body part", "place"], "region is the sense join itself");
  assert.deepEqual(gate.topsOf("geographical area"), ["body part", "place"]);
});

test("topsOf leaves an unreachable term unplaced, and an unplaced term never blocks", () => {
  const gate = gateOver(SPECIMEN_EDGES);
  assert.deepEqual(gate.topsOf("nigel farage"), []);
  assert.equal(gate.declines("nigel farage", "body part"), false);
  assert.equal(gate.declines("russia", "nigel farage"), false);
});

// ---- the refusal ------------------------------------------------------------

test("the russia chain no longer derives body part, musical composition or premise", () => {
  const gate = gateOver(SPECIMEN_EDGES);
  const rows = derived(SPECIMEN_EDGES, { gate });
  assert.equal(has(rows, "russia", "body part"), false, "place and body part are declared disjoint");
  assert.equal(has(rows, "russia", "musical composition"), false);
  assert.equal(has(rows, "russia", "premise"), false);
  assert.equal(has(rows, "russia", "message"), false);
});

test("without the gate the same edges do derive russia ⊑ body part", () => {
  const rows = derived(SPECIMEN_EDGES);
  assert.equal(has(rows, "russia", "body part"), true, "the gate is what makes the difference, not the fixture");
});

test("the refusal keeps every step of russia's own place lineage", () => {
  const gate = gateOver(SPECIMEN_EDGES);
  const rows = derived(SPECIMEN_EDGES, { gate });
  for (const object of ["place", "geographical area", "administrative district", "region", "location"]) {
    assert.equal(has(rows, "russia", object), true, `russia ⊑ ${object} survives`);
  }
});

test("a legitimate multi-hop chain still closes end to end", () => {
  const gate = gateOver(SPECIMEN_EDGES);
  const rows = derived(SPECIMEN_EDGES, { gate });
  for (const object of ["carnivore", "mammal", "vertebrate", "animal", "organism"]) {
    assert.equal(has(rows, "dog", object), true, `dog ⊑ ${object} survives`);
  }
});

test("a shared top allows the crossing even when the pivot carries two senses", () => {
  const gate = gateOver(SPECIMEN_EDGES);
  assert.equal(gate.declines("geographical area", "body part"), false, "geographical area is itself under both tops");
  assert.equal(gate.declines("russia", "region"), false, "region shares place with russia");
});

test("cax-sco: an individual typed under one top never inherits a disjoint one", () => {
  const typeEdges = [["moscow", "city"]];
  const gate = gateOver(SPECIMEN_EDGES, typeEdges);
  assert.deepEqual(gate.topsOf("moscow"), ["place"], "a taught rdf:type is the walk's first hop");
  const chained = SPECIMEN_EDGES.concat([["city", "geographical area"]]);
  const rows = deriveTypePropagation(typeEdges, chained, { budget: 10000, gate: gateOver(chained, typeEdges) });
  assert.equal(has(rows, "moscow", "body part"), false);
  assert.equal(has(rows, "moscow", "place"), true, "the place lineage still propagates");
});

// ---- what the gate must never touch ----------------------------------------

test("a stated fact is never blocked: teaching russia ⊑ body part keeps the row", async () => {
  const dir = await mkRepo();
  try {
    for (const [s, o] of SPECIMEN_EDGES) {
      await appendFact(dir, { subject: s, predicate: SUBCLASS_PREDICATE, object: o, provenance: "corpus:test" });
    }
    await appendFact(dir, {
      subject: "russia", predicate: SUBCLASS_PREDICATE, object: "body part", provenance: "user:teach",
    });
    await syllogise(dir, { budget: 200 });
    const rows = readFactRows(await loadMemory(dir));
    const taught = rows.find((r) => r.subject === "russia" && r.predicate === SUBCLASS_PREDICATE && r.object === "body part");
    assert.ok(taught, "the taught row survives the gated pass");
    assert.ok(!String(taught.provenance).startsWith("entailed:"), "and it is still the taught row, not a derivation");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise writes no entailed russia ⊑ body part over the specimen chain", async () => {
  const dir = await mkRepo();
  try {
    for (const [s, o] of SPECIMEN_EDGES) {
      await appendFact(dir, { subject: s, predicate: SUBCLASS_PREDICATE, object: o, provenance: "corpus:test" });
    }
    await syllogise(dir, { budget: 500 });
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(
      rows.some((r) => r.subject === "russia" && r.predicate === SUBCLASS_PREDICATE && r.object === "body part"),
      false,
      "no fact of any provenance says russia is a body part",
    );
    assert.ok(
      rows.some((r) => r.subject === "russia" && r.predicate === SUBCLASS_PREDICATE && r.object === "place"),
      "russia ⊑ place is still materialised",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("senseGate: false runs the kernels raw, so the opt-out is real", async () => {
  const dir = await mkRepo();
  try {
    for (const [s, o] of SPECIMEN_EDGES) {
      await appendFact(dir, { subject: s, predicate: SUBCLASS_PREDICATE, object: o, provenance: "corpus:test" });
    }
    await syllogise(dir, { budget: 500, senseGate: false });
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(
      rows.some((r) => r.subject === "russia" && r.predicate === SUBCLASS_PREDICATE && r.object === "body part"),
      "ungated, the crossing comes back",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- purity -----------------------------------------------------------------

test("order independence: two ingestion orders of the same edges derive the same set", () => {
  const reversed = [...SPECIMEN_EDGES].reverse();
  const shuffled = [...SPECIMEN_EDGES].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const runs = [SPECIMEN_EDGES, reversed, shuffled].map((edges) => {
    const rows = derived(edges, { gate: gateOver(edges) });
    return rows.map((d) => `${d.subject}|${d.object}`).sort();
  });
  assert.deepEqual(runs[1], runs[0], "reversing the fact list changes nothing");
  assert.deepEqual(runs[2], runs[0], "nor does re-sorting it");
});

test("order independence: topsOf survives a truncating visit budget", () => {
  const build = (edges) => buildSenseGate({ subClassEdges: edges, maxVisited: 4 });
  const forward = build(SPECIMEN_EDGES);
  const backward = build([...SPECIMEN_EDGES].reverse());
  for (const term of ["russia", "dog", "region", "musical composition", "geographical area"]) {
    assert.deepEqual(backward.topsOf(term), forward.topsOf(term), `${term} places the same either way`);
  }
});

// ---- the table itself -------------------------------------------------------

test("the disjointness table is symmetric, duplicate-free and canonically ordered", () => {
  const pairs = disjointTopPairs();
  const seen = new Set();
  for (const [a, b] of pairs) {
    assert.notEqual(a, b, "no top is disjoint from itself");
    assert.ok(a < b, `${a} | ${b} is stored in codepoint order`);
    const key = `${a}|${b}`;
    assert.equal(seen.has(key), false, `${key} appears once`);
    seen.add(key);
    assert.equal(pairs.some(([x, y]) => x === b && y === a), false, "and never also in reverse");
  }
  const tops = TOP_CLASSES.map((t) => t.top);
  assert.equal(pairs.length, (tops.length * (tops.length - 1)) / 2 - OVERLAPPING_TOP_PAIRS.length);
});

test("the table is minimal: every declared overlap names two real tops", () => {
  const tops = new Set(TOP_CLASSES.map((t) => t.top));
  const seen = new Set();
  for (const [a, b] of OVERLAPPING_TOP_PAIRS) {
    assert.ok(tops.has(a), `${a} is a declared top`);
    assert.ok(tops.has(b), `${b} is a declared top`);
    assert.notEqual(a, b);
    const key = [a, b].sort().join("|");
    assert.equal(seen.has(key), false, `${key} is declared once`);
    seen.add(key);
  }
});

test("no label is claimed by two tops, and every top carries its own name", () => {
  const owner = new Map();
  for (const { top, labels } of TOP_CLASSES) {
    assert.ok(labels.includes(top), `${top} lists itself among its labels`);
    for (const label of labels) {
      assert.equal(owner.has(label), false, `"${label}" belongs to one top (${owner.get(label)} and ${top} both claim it)`);
      owner.set(label, top);
    }
  }
});

test("region is not a top: it is the sense join the gate exists to catch", () => {
  const tops = new Set(TOP_CLASSES.flatMap((t) => t.labels));
  assert.equal(tops.has("region"), false);
  assert.equal(tops.has("geographical area"), false);
});

test("the disjoint set separates place from body part and every other end of the pollution", () => {
  const pairs = new Set(disjointTopPairs().map((p) => p.join("|")));
  for (const key of ["body part|place", "communication|place", "event|place", "living thing|place", "place|time period"]) {
    assert.ok(pairs.has(key), `${key} is declared disjoint`);
  }
  for (const key of ["artifact|place", "body part|substance", "living thing|substance"]) {
    assert.equal(pairs.has(key), false, `${key} is a declared overlap, never disjoint`);
  }
});

test("a taught rdf:type edge places an individual the same way a class chain does", () => {
  const gate = buildSenseGate({
    subClassEdges: SPECIMEN_EDGES,
    typeEdges: [["nigel farage", "politician"], ["politician", "person"]],
  });
  assert.deepEqual(gate.topsOf("nigel farage"), [], "no top above politician in this fixture, so unplaced");
  assert.equal(gate.declines("nigel farage", "body part"), false);
});

test("the gate never blocks a derivation onto the subject's own top", () => {
  const gate = gateOver(SPECIMEN_EDGES);
  assert.equal(gate.declines("russia", "place"), false);
  assert.equal(gate.declines("dog", "organism"), false);
  assert.equal(gate.declines("russia", "russia"), false, "and never a tautology");
});

test("TYPE_PREDICATE and SUBCLASS_PREDICATE both reach the gate through syllogise", async () => {
  const dir = await mkRepo();
  try {
    for (const [s, o] of SPECIMEN_EDGES) {
      await appendFact(dir, { subject: s, predicate: SUBCLASS_PREDICATE, object: o, provenance: "corpus:test" });
    }
    await appendFact(dir, { subject: "city", predicate: SUBCLASS_PREDICATE, object: "geographical area", provenance: "corpus:test" });
    await appendFact(dir, { subject: "moscow", predicate: TYPE_PREDICATE, object: "city", provenance: "corpus:test" });
    await syllogise(dir, { budget: 500 });
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(
      rows.some((r) => r.subject === "moscow" && r.predicate === TYPE_PREDICATE && r.object === "body part"),
      false,
      "no entailed type carries moscow into the anatomical branch",
    );
    assert.ok(
      rows.some((r) => r.subject === "moscow" && r.predicate === TYPE_PREDICATE && r.object === "place"),
      "the place branch still propagates",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
