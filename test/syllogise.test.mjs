// syllogise.test.mjs — the speculative-inference engine (Phase 9 /
// archive/PLAN_SPECULATIVE_INFERENCE.md): the pure forward-chaining kernel, the
// materialising pass (entailed provenance + low trust, never outranks a stated
// fact), and the HONEST KILL CRITERION — does a pre-derived transitive fact flip
// a real subclass-chain miss to a hit, measured on the DEFAULT W3 bootstrap seed
// (not a hand fixture, not the whole corpus)?
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, loadMemory, readFactRows } from "../src/memory/core.mjs";
import {
  deriveSubClassClosure, deriveTypePropagation, deriveDisjointViolations, findIsaChain, syllogise,
  ENTAILED_PROVENANCE, SUBCLASS_PREDICATE, ENTAILED_TYPE_PROVENANCE, TYPE_PREDICATE,
  ENTAILED_DISJOINT_PROVENANCE, DISJOINT_PREDICATE, CAX_DW_RULE, CAX_DW_RULE_CONFIDENCE,
} from "../src/syllogise.mjs";
import { freshConceptNetRepo } from "./helpers/seeded-fixture.mjs";

const mkRepo = () => mkdtemp(join(tmpdir(), "tmct-syllog-"));
const subClassRows = (rows) => rows.filter((r) => r.predicate === SUBCLASS_PREDICATE);
const typeRows = (rows) => rows.filter((r) => r.predicate === TYPE_PREDICATE);
const disjointRows = (rows) => rows.filter((r) => r.predicate === DISJOINT_PREDICATE);
const hasEdge = (rows, s, o) => subClassRows(rows).some((r) => r.subject === s && r.object === o);
const hasType = (rows, s, o) => typeRows(rows).some((r) => r.subject === s && r.object === o);
const hasDisjoint = (rows, s, o) => disjointRows(rows).some((r) => r.subject === s && r.object === o);
const round6 = (n) => Number(n.toFixed(6)); // mirrors memory/trust.mjs's own `round`

// ---- the pure kernel: bounded, screened, focus-filtered, deterministic -------

test("deriveSubClassClosure: transitivity — (a⊑b),(b⊑c) ⊨ (a⊑c)", () => {
  const d = deriveSubClassClosure([["a", "b"], ["b", "c"]]);
  assert.deepEqual(d, [{ subject: "a", object: "c", via: "b" }]);
});

test("deriveSubClassClosure: closes a long chain across rounds (a⊑…⊑e)", () => {
  const d = deriveSubClassClosure([["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]]);
  const pairs = new Set(d.map((x) => `${x.subject}->${x.object}`));
  // every non-adjacent pair in the chain is entailed
  for (const [s, o] of [["a", "c"], ["a", "d"], ["a", "e"], ["b", "d"], ["b", "e"], ["c", "e"]]) {
    assert.ok(pairs.has(`${s}->${o}`), `${s}⊑${o} should be derived`);
  }
  assert.equal(d.length, 6);
});

test("deriveSubClassClosure: tautology screen — never emits a⊑a (cycle a⊑b,b⊑a)", () => {
  const d = deriveSubClassClosure([["a", "b"], ["b", "a"]]);
  assert.deepEqual(d, [], "reflexive conclusions are screened, and both direct edges already exist");
});

test("deriveSubClassClosure: dedup/novelty screen — a⊑c already present is not re-derived", () => {
  const d = deriveSubClassClosure([["a", "b"], ["b", "c"], ["a", "c"]]);
  assert.deepEqual(d, []);
});

test("deriveSubClassClosure: focus-connection — a derivation must touch focus (one step out)", () => {
  const edges = [["a", "b"], ["b", "c"]];
  assert.deepEqual(deriveSubClassClosure(edges, { focus: new Set(["z"]) }), [], "unrelated focus → nothing");
  // focus on the PIVOT b still admits a⊑c (b is one step out from both ends)
  assert.deepEqual(deriveSubClassClosure(edges, { focus: new Set(["b"]) }), [{ subject: "a", object: "c", via: "b" }]);
  assert.deepEqual(deriveSubClassClosure(edges, { focus: new Set(["a"]) }), [{ subject: "a", object: "c", via: "b" }]);
});

test("deriveSubClassClosure: hard budget caps derivations, deterministically", () => {
  // a star + chain giving many closures; budget 3 truncates a sorted candidate set
  const edges = [["a", "b"], ["b", "c"], ["b", "d"], ["b", "e"], ["c", "f"]];
  const d = deriveSubClassClosure(edges, { budget: 3 });
  assert.equal(d.length, 3);
  const again = deriveSubClassClosure(edges, { budget: 3 });
  assert.deepEqual(d, again, "same inputs → same truncation (deterministic)");
});

// ---- cax-sco: rdf:type propagation across a subClassOf chain -----------------

test("deriveTypePropagation: (x:C),(C⊑D) ⊨ (x:D)", () => {
  const d = deriveTypePropagation([["redis.mjs", "cache"]], [["cache", "component"]]);
  assert.deepEqual(d, [{ subject: "redis.mjs", object: "component", via: "cache" }]);
});

test("deriveTypePropagation: propagates across a MULTI-hop taught ⊑-chain in one call (no fixpoint rounds needed)", () => {
  const d = deriveTypePropagation(
    [["redis.mjs", "cache"]],
    [["cache", "store"], ["store", "component"], ["component", "artifact"]],
  );
  const pairs = new Set(d.map((x) => `${x.subject}->${x.object}`));
  for (const o of ["store", "component", "artifact"]) {
    assert.ok(pairs.has(`redis.mjs->${o}`), `redis.mjs:${o} should be derived`);
  }
  assert.equal(d.length, 3);
});

test("deriveTypePropagation: tautology screen — never emits x:x, and a class is never typed as itself", () => {
  const d = deriveTypePropagation([["a", "b"]], [["b", "a"]]); // b⊑a would close a:a
  assert.deepEqual(d, [], "reflexive x:x conclusions are screened");
});

test("deriveTypePropagation: dedup/novelty screen — x:D already present is not re-derived", () => {
  const d = deriveTypePropagation([["x", "c"], ["x", "d"]], [["c", "d"]]);
  assert.deepEqual(d, [], "x:d is already a stated type edge");
});

test("deriveTypePropagation: focus-connection — a derivation must touch focus (one step out)", () => {
  const typeEdges = [["x", "c"]];
  const subClassEdges = [["c", "d"]];
  assert.deepEqual(deriveTypePropagation(typeEdges, subClassEdges, { focus: new Set(["z"]) }), [], "unrelated focus → nothing");
  assert.deepEqual(
    deriveTypePropagation(typeEdges, subClassEdges, { focus: new Set(["c"]) }),
    [{ subject: "x", object: "d", via: "c" }],
    "focus on the pivot class still admits x:d",
  );
  assert.deepEqual(
    deriveTypePropagation(typeEdges, subClassEdges, { focus: new Set(["x"]) }),
    [{ subject: "x", object: "d", via: "c" }],
  );
});

test("deriveTypePropagation: hard budget caps derivations, deterministically", () => {
  const typeEdges = [["x", "c"]];
  const subClassEdges = [["c", "d1"], ["c", "d2"], ["c", "d3"]];
  const d = deriveTypePropagation(typeEdges, subClassEdges, { budget: 2 });
  assert.equal(d.length, 2);
  const again = deriveTypePropagation(typeEdges, subClassEdges, { budget: 2 });
  assert.deepEqual(d, again, "same inputs → same truncation (deterministic)");
});

// ---- cax-dw: disjointness violations — x:C1, C1 disjointWith C2 ⊨ x∉C2 -------

test("deriveDisjointViolations: direct member — x:C1, C1 disjointWith C2 ⊨ x is NOT C2", () => {
  const d = deriveDisjointViolations([["redis.mjs", "cache"]], [], [["cache", "queue"]]);
  assert.deepEqual(d, [{ subject: "redis.mjs", object: "queue", viaType: "cache", viaClass: "cache" }]);
});

test("deriveDisjointViolations: disjointWith is symmetric — the taught direction doesn't matter", () => {
  const d = deriveDisjointViolations([["redis.mjs", "cache"]], [], [["queue", "cache"]]); // reverse of the above
  assert.deepEqual(d, [{ subject: "redis.mjs", object: "queue", viaType: "cache", viaClass: "cache" }]);
});

test("deriveDisjointViolations: the ⊑-lift — x∈mock, mock⊑fixture, fixture disjointWith test ⊨ x∉test "
  + "(PLAN_INFERENCE_TESTING.md §1 footnote², B1's hardest cell)", () => {
  const d = deriveDisjointViolations(
    [["e01.mjs", "mock"]],
    [["mock", "fixture"]],
    [["fixture", "test"]],
  );
  assert.deepEqual(d, [{ subject: "e01.mjs", object: "test", viaType: "mock", viaClass: "fixture" }]);
});

test("deriveDisjointViolations: a MULTI-hop ⊑-lift also reaches the disjoint ancestor (mock⊑fixture⊑asset)", () => {
  const d = deriveDisjointViolations(
    [["e01.mjs", "mock"]],
    [["mock", "fixture"], ["fixture", "asset"]],
    [["asset", "test"]],
  );
  assert.deepEqual(d, [{ subject: "e01.mjs", object: "test", viaType: "mock", viaClass: "asset" }]);
});

test("deriveDisjointViolations: an unrelated pair is NEVER asserted — no connecting disjointness, nothing derived "
  + "(the honest 'cannot be proven' floor is the CALLER's job, not a fabricated 'no' here)", () => {
  const d = deriveDisjointViolations([["e02.mjs", "widget"]], [], [["cache", "queue"]]);
  assert.deepEqual(d, [], "widget has no stated disjointness with anything — silence, never a guessed no");
});

test("deriveDisjointViolations: no disjointWith facts at all ⊨ nothing derived", () => {
  assert.deepEqual(deriveDisjointViolations([["x", "c"]], [], []), []);
});

test("deriveDisjointViolations: dedup/novelty screen — an already-known instance-level disjointWith is not re-derived "
  + "(this is ALSO syllogise()'s idempotency mechanism: a prior pass's own entailed rows feed back in as disjointEdges)", () => {
  const d = deriveDisjointViolations(
    [["redis.mjs", "cache"]],
    [],
    [["cache", "queue"], ["redis.mjs", "queue"]], // the conclusion is already present
  );
  assert.deepEqual(d, []);
});

test("deriveDisjointViolations: focus-connection — a derivation must touch focus (one step out)", () => {
  const typeEdges = [["redis.mjs", "cache"]];
  const disjointEdges = [["cache", "queue"]];
  assert.deepEqual(deriveDisjointViolations(typeEdges, [], disjointEdges, { focus: new Set(["z"]) }), [], "unrelated focus → nothing");
  assert.deepEqual(
    deriveDisjointViolations(typeEdges, [], disjointEdges, { focus: new Set(["cache"]) }),
    [{ subject: "redis.mjs", object: "queue", viaType: "cache", viaClass: "cache" }],
  );
  assert.deepEqual(
    deriveDisjointViolations(typeEdges, [], disjointEdges, { focus: new Set(["redis.mjs"]) }),
    [{ subject: "redis.mjs", object: "queue", viaType: "cache", viaClass: "cache" }],
  );
});

test("deriveDisjointViolations: hard budget caps derivations, deterministically", () => {
  const typeEdges = [["x", "c"]];
  const disjointEdges = [["c", "d1"], ["c", "d2"], ["c", "d3"]];
  const d = deriveDisjointViolations(typeEdges, [], disjointEdges, { budget: 2 });
  assert.equal(d.length, 2);
  const again = deriveDisjointViolations(typeEdges, [], disjointEdges, { budget: 2 });
  assert.deepEqual(d, again, "same inputs → same truncation (deterministic)");
});

// ---- findIsaChain: a bounded, ROOTED proof search (not a third rule) ---------

test("findIsaChain: scm-sco — a taught ⊑-chain of length 2 is found, shortest-first", () => {
  const chain = findIsaChain("a", new Set(["c"]), [], [["a", "b"], ["b", "c"]]);
  assert.deepEqual(chain, [
    { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b" },
    { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c" },
  ]);
});

test("findIsaChain: cax-sco — a taught type + one taught ⊑-edge is found", () => {
  const chain = findIsaChain("redis.mjs", new Set(["component"]), [["redis.mjs", "cache"]], [["cache", "component"]]);
  assert.deepEqual(chain, [
    { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "cache" },
    { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "component" },
  ]);
});

test("findIsaChain: no path within maxHops → null (honest miss, never a guess)", () => {
  assert.equal(findIsaChain("a", new Set(["z"]), [], [["a", "b"], ["b", "c"]]), null);
  assert.equal(findIsaChain("a", new Set(["c"]), [], []), null, "no edges at all");
});

test("findIsaChain: ROOTED at subj only — an unrelated flood of edges elsewhere never steals the search "
  + "(the whole-graph-closure+budget bug this function replaces: a large fact store must never make a real "
  + "2-hop chain unreachable)", () => {
  // hundreds of edges that touch "class" as PIVOT or OBJECT but have nothing to
  // do with the class->migration->promise chain under test — a whole-graph
  // closure with a small shared budget can get flooded by these; a rooted
  // search from "class" must not be.
  const noise = [];
  for (let i = 0; i < 300; i += 1) {
    noise.push([`corpus-term-${i}`, "class"]); // X ⊑ class (touches "class" as object)
  }
  const subClassEdges = [["class", "migration"], ["migration", "promise"], ...noise];
  const chain = findIsaChain("class", new Set(["promise"]), [], subClassEdges);
  assert.deepEqual(chain, [
    { subject: "class", predicate: SUBCLASS_PREDICATE, object: "migration" },
    { subject: "migration", predicate: SUBCLASS_PREDICATE, object: "promise" },
  ]);
});

test("findIsaChain: hop budget — a chain longer than maxHops is not found, exactly at the boundary", () => {
  // a->b->c->d->e is a 4-EDGE chain from a to e.
  const edges = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]];
  assert.equal(findIsaChain("a", new Set(["e"]), [], edges, { maxHops: 2 }), null, "e is 4 hops away, budget 2 — not found");
  assert.equal(findIsaChain("a", new Set(["e"]), [], edges, { maxHops: 3 }), null, "e is 4 hops away, budget 3 — NOT found either (no off-by-one)");
  const chain = findIsaChain("a", new Set(["e"]), [], edges, { maxHops: 4 });
  assert.equal(chain?.length, 4, "budget 4 exactly reaches e — found, no more no less");
  // a shorter target within the SAME graph is found even at a small budget
  assert.deepEqual(
    findIsaChain("a", new Set(["b"]), [], edges, { maxHops: 1 }),
    [{ subject: "a", predicate: SUBCLASS_PREDICATE, object: "b" }],
  );
});

// ---- the materialising pass: entailed provenance, low trust, never outranks --

test("syllogise: materializes a⊑c as an entailed, low-trust, retractable Fact", async () => {
  const dir = await mkRepo();
  try {
    // stated premises (corpus band, trust ≈ 0.7)
    await appendFact(dir, { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "store", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "store", predicate: SUBCLASS_PREDICATE, object: "component", provenance: "corpus:conceptnet /r/IsA" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(before, "cache", "component"), "cache⊑component is a MISS before the pass");

    const res = await syllogise(dir);
    assert.equal(res.count, 1);
    assert.deepEqual(res.derived.map((d) => [d.subject, d.object]), [["cache", "component"]]);

    const after = readFactRows(await loadMemory(dir));
    const derived = subClassRows(after).find((r) => r.subject === "cache" && r.object === "component");
    assert.ok(derived, "cache⊑component is now a stored Fact (miss → hit)");
    assert.match(derived.provenance, /entailed:subClassOf/, "carries entailed provenance");
    assert.ok(derived.sourceTypes.includes("entailed"), "backed by a first-class entailed Source");

    // never outranks a stated fact: entailed trust (prior 0.3) < stated corpus trust
    const stated = subClassRows(after).find((r) => r.subject === "cache" && r.object === "store");
    assert.ok(derived.trust < 0.5, `entailed trust is low (${derived.trust})`);
    assert.ok(derived.trust < stated.trust, "an entailed conclusion never outranks its stated premise");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: idempotent — a second pass derives nothing new (dedup on stored entailments)", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "a", predicate: SUBCLASS_PREDICATE, object: "b", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "b", predicate: SUBCLASS_PREDICATE, object: "c", provenance: "corpus:conceptnet /r/IsA" });
    assert.equal((await syllogise(dir)).count, 1);
    assert.equal((await syllogise(dir)).count, 0, "closure already materialized → nothing to add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: materializes cax-sco (x:C) too, in the SAME pass as scm-sco, seeing its OWN scm-sco conclusions", async () => {
  const dir = await mkRepo();
  try {
    // taught: redis.mjs is a cache; every cache is a store; every store is a component
    await appendFact(dir, { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "cache", provenance: "ace:chat:s1@2026-07-08T00:00:00.000Z" });
    await appendFact(dir, { subject: "cache", predicate: SUBCLASS_PREDICATE, object: "store", provenance: "ace:chat:s1@2026-07-08T00:00:01.000Z" });
    await appendFact(dir, { subject: "store", predicate: SUBCLASS_PREDICATE, object: "component", provenance: "ace:chat:s1@2026-07-08T00:00:02.000Z" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasEdge(before, "cache", "component"), "cache⊑component is a scm-sco MISS before the pass");
    assert.ok(!hasType(before, "redis.mjs", "store"), "redis.mjs:store is a cax-sco MISS before the pass");
    assert.ok(!hasType(before, "redis.mjs", "component"), "redis.mjs:component is a cax-sco MISS before the pass (needs cache⊑component too)");

    const res = await syllogise(dir);
    // scm-sco: cache⊑component. cax-sco: redis.mjs:store, redis.mjs:component (via the
    // ENLARGED subClassOf set this same pass just derived) — cax-sco reaches the WHOLE
    // chain in one call, no second `tmct syllogise` invocation needed.
    assert.equal(res.count, 3);
    assert.deepEqual(new Set(res.derived.map((d) => `${d.rule}:${d.subject}->${d.object}`)), new Set([
      "subClassOf:cache->component",
      "type:redis.mjs->store",
      "type:redis.mjs->component",
    ]));

    const after = readFactRows(await loadMemory(dir));
    assert.ok(hasEdge(after, "cache", "component"), "cache⊑component now stored (scm-sco)");
    assert.ok(hasType(after, "redis.mjs", "store"), "redis.mjs:store now stored (cax-sco)");
    assert.ok(hasType(after, "redis.mjs", "component"), "redis.mjs:component now stored (cax-sco over the enlarged closure)");

    const caxRow = typeRows(after).find((r) => r.subject === "redis.mjs" && r.object === "component");
    assert.match(caxRow.provenance, /entailed:type/, "carries entailed:type provenance");
    assert.ok(caxRow.sourceTypes.includes("entailed"), "backed by a first-class entailed Source");
    assert.ok(caxRow.trust < 0.5, `entailed trust is low (${caxRow.trust})`);

    // idempotent: a second pass derives nothing new
    assert.equal((await syllogise(dir)).count, 0, "closure already materialized (both rules) → nothing to add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- cax-dw: syllogise() materializes disjointness violations, a provable "no" -

test("syllogise: cax-dw materializes a direct disjoint-type violation as a provable 'no' Fact "
  + "(PLAN_INFERENCE_TESTING.md INF-B1)", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "cache", predicate: DISJOINT_PREDICATE, object: "queue", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "cache", provenance: "ace:chat:s1" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasDisjoint(before, "redis.mjs", "queue"), "'redis.mjs is not a queue' is a MISS before the pass");

    const res = await syllogise(dir);
    assert.ok(res.derived.some((d) => d.rule === CAX_DW_RULE && d.subject === "redis.mjs" && d.object === "queue"));

    const after = readFactRows(await loadMemory(dir));
    const derived = disjointRows(after).find((r) => r.subject === "redis.mjs" && r.object === "queue");
    assert.ok(derived, "'redis.mjs is not a queue' is now a stored, provable Fact (miss → hit)");
    assert.match(derived.provenance, /entailed:disjointWith/, "carries entailed:disjointWith provenance");
    assert.ok(derived.sourceTypes.includes("entailed"), "backed by a first-class entailed Source");

    // idempotent: a second pass derives nothing new
    assert.equal((await syllogise(dir)).count, 0, "the violation is already materialized → nothing to add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: cax-dw materializes the ⊑-LIFTED case — x∈mock, mock⊑fixture, fixture disjointWith test "
  + "(PLAN_INFERENCE_TESTING.md §1 footnote², B1's hardest cell — reuses deriveSubClassClosure's/"
  + "deriveTypePropagation's ancestor-closure machinery, not a reimplementation)", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "fixture", predicate: DISJOINT_PREDICATE, object: "test", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "mock", predicate: SUBCLASS_PREDICATE, object: "fixture", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e01.mjs", predicate: TYPE_PREDICATE, object: "mock", provenance: "ace:chat:s1" });

    const before = readFactRows(await loadMemory(dir));
    assert.ok(!hasDisjoint(before, "e01.mjs", "test"), "'e01.mjs is not a test' is a MISS before the pass");

    const res = await syllogise(dir);
    assert.ok(res.derived.some((d) => d.rule === CAX_DW_RULE && d.subject === "e01.mjs" && d.object === "test"));

    const after = readFactRows(await loadMemory(dir));
    assert.ok(hasDisjoint(after, "e01.mjs", "test"), "'e01.mjs is not a test' now stored, reached via the mock⊑fixture lift");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: cax-dw NEVER asserts a 'no' for an unrelated pair — silence, not a guessed no "
  + "(the 'cannot be proven' answer shape is chat.mjs's job, not this rule's)", async () => {
  const dir = await mkRepo();
  try {
    await appendFact(dir, { subject: "cache", predicate: DISJOINT_PREDICATE, object: "queue", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "e02.mjs", predicate: TYPE_PREDICATE, object: "widget", provenance: "ace:chat:s1" });

    const res = await syllogise(dir);
    assert.ok(!res.derived.some((d) => d.rule === CAX_DW_RULE), "widget has no stated disjointness — cax-dw derives nothing for it");

    const after = readFactRows(await loadMemory(dir));
    assert.equal(disjointRows(after).filter((r) => r.subject === "e02.mjs").length, 0, "no fabricated disjointWith fact for e02.mjs");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syllogise: cax-dw's entailed trust is PREMISE-DERIVED (min(premiseTrusts) × ruleConfidence), "
  + "not the bare 0.3 floor — PLAN_INFERENCE_TESTING.md §4 stage 2's exit criterion, closed here for cax-dw", async () => {
  const dir = await mkRepo();
  try {
    // Two DIFFERENT trust tiers so min() is meaningfully picking the weaker
    // premise: the type premise is operator-taught (prior 1.0), the
    // disjointness premise is corpus-sourced (prior 0.7). createdAt is
    // omitted on both (defaults to "now"), so recency is ~1.0 for both and
    // the arithmetic below is exact, not just approximately bounded.
    await appendFact(dir, { subject: "redis.mjs", predicate: TYPE_PREDICATE, object: "cache", provenance: "ace:chat:s1" });
    await appendFact(dir, { subject: "cache", predicate: DISJOINT_PREDICATE, object: "queue", provenance: "corpus:conceptnet /r/IsA" });

    const before = readFactRows(await loadMemory(dir));
    const typeTrust = before.find((r) => r.predicate === TYPE_PREDICATE && r.subject === "redis.mjs" && r.object === "cache").trust;
    const dwTrust = before.find((r) => r.predicate === DISJOINT_PREDICATE && r.subject === "cache" && r.object === "queue").trust;
    assert.notEqual(typeTrust, dwTrust, "premises must sit at DIFFERENT trust tiers for min() to matter");

    await syllogise(dir);
    const after = readFactRows(await loadMemory(dir));
    const derived = disjointRows(after).find((r) => r.subject === "redis.mjs" && r.object === "queue");
    assert.ok(derived, "the violation was derived");

    const expected = round6(Math.min(typeTrust, dwTrust) * CAX_DW_RULE_CONFIDENCE);
    assert.equal(derived.trust, expected, `entailed trust is premise-derived: expected ${expected}, got ${derived.trust}`);
    assert.notEqual(derived.trust, 0.3, "not the bare entailed floor");
    assert.ok(derived.trust < Math.min(typeTrust, dwTrust), "still strictly below its weakest premise — never outranks a stated fact");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- THE KILL CRITERION, on the real default seed ----------------------------
// Does pre-derivation flip a REAL subclass-chain miss? Measured against the
// DEFAULT W3 bootstrap seed (SEED_LIMIT=500, subClassOf-preferred — exactly what
// chat.mjs seeds a fresh repo with), not a hand fixture. If a bounded pass
// derives a chain-closure fact a subclass-chain query then answers (that missed
// before), this is YES with a concrete fact. If it derives nothing, this FAILS
// loudly — the honest STOP signal, never weakened to force a pass.

test("KILL CRITERION: on the default seed, a bounded pass flips a real subclass-chain miss to a hit", async () => {
  // Shared fixture (test/helpers/seeded-fixture.mjs): the seed's own parse+write
  // pass is built ONCE per process and copied here — this test consumes the
  // seeded material (its closure-worthy chains), it isn't testing the seed
  // pipeline itself.
  const { dir, seedResult: seeded } = await freshConceptNetRepo("tmct-syllog-");
  try {
    assert.ok(seeded.appended > 0, "the default seed wrote real material");

    const before = readFactRows(await loadMemory(dir));
    const statedChains = subClassRows(before);
    assert.ok(statedChains.length > 0, "the seed contains stated subClassOf facts");

    // What the closure SHOULD yield from exactly this seeded material (pure).
    const edges = statedChains.map((r) => [r.subject, r.object]);
    const expected = deriveSubClassClosure(edges); // default budget 50, whole-graph
    assert.ok(
      expected.length > 0,
      "the default seed must contain at least one transitive subclass chain to close — " +
        "if this ever fails, Phase 9 has drawn no blood on real material (the honest STOP)",
    );

    // Each expected conclusion is a genuine MISS in the seeded store.
    for (const e of expected) {
      assert.ok(!hasEdge(before, e.subject, e.object), `${e.subject}⊑${e.object} is a miss before the pass`);
    }

    const res = await syllogise(dir); // whole-graph, default budget — the real batch pass
    assert.ok(res.count > 0, "the bounded pass derived at least one closure fact");

    const after = readFactRows(await loadMemory(dir));
    // The concrete flip: the first expected conclusion now answers via the memory fact path.
    const flip = expected[0];
    assert.ok(
      hasEdge(after, flip.subject, flip.object),
      `KILL CRITERION MET: "${flip.subject} ⊑ ${flip.object}" (via ${flip.via}) was a MISS, now a stored, ` +
        "retrievable Fact after speculation",
    );
    const flipRow = subClassRows(after).find((r) => r.subject === flip.subject && r.object === flip.object);
    assert.match(flipRow.provenance, /entailed:subClassOf/, "the flipped fact is honestly marked entailed");
    assert.ok(flipRow.trust < 0.5, "and carries low, speculative trust");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
