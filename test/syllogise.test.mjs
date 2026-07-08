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
  deriveSubClassClosure, deriveTypePropagation, findIsaChain, syllogise,
  ENTAILED_PROVENANCE, SUBCLASS_PREDICATE, ENTAILED_TYPE_PROVENANCE, TYPE_PREDICATE,
} from "../src/syllogise.mjs";
import { seedMemory } from "../src/corpus/conceptnet.mjs";
import { SEED_LIMIT, SEED_PREFER } from "../src/chat.mjs";

const mkRepo = () => mkdtemp(join(tmpdir(), "tmct-syllog-"));
const subClassRows = (rows) => rows.filter((r) => r.predicate === SUBCLASS_PREDICATE);
const typeRows = (rows) => rows.filter((r) => r.predicate === TYPE_PREDICATE);
const hasEdge = (rows, s, o) => subClassRows(rows).some((r) => r.subject === s && r.object === o);
const hasType = (rows, s, o) => typeRows(rows).some((r) => r.subject === s && r.object === o);

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

// ---- THE KILL CRITERION, on the real default seed ----------------------------
// Does pre-derivation flip a REAL subclass-chain miss? Measured against the
// DEFAULT W3 bootstrap seed (SEED_LIMIT=500, subClassOf-preferred — exactly what
// chat.mjs seeds a fresh repo with), not a hand fixture. If a bounded pass
// derives a chain-closure fact a subclass-chain query then answers (that missed
// before), this is YES with a concrete fact. If it derives nothing, this FAILS
// loudly — the honest STOP signal, never weakened to force a pass.

test("KILL CRITERION: on the default seed, a bounded pass flips a real subclass-chain miss to a hit", async () => {
  const dir = await mkRepo();
  try {
    const seeded = await seedMemory(dir, { limit: SEED_LIMIT, prefer: SEED_PREFER });
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
