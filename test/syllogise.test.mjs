// syllogise.test.mjs — the speculative-inference engine (Phase 9 /
// PLAN_SPECULATIVE_INFERENCE.md): the pure forward-chaining kernel, the
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
import { deriveSubClassClosure, syllogise, ENTAILED_PROVENANCE, SUBCLASS_PREDICATE } from "../src/syllogise.mjs";
import { seedMemory } from "../src/corpus/conceptnet.mjs";
import { SEED_LIMIT, SEED_PREFER } from "../src/chat.mjs";

const mkRepo = () => mkdtemp(join(tmpdir(), "tmct-syllog-"));
const subClassRows = (rows) => rows.filter((r) => r.predicate === SUBCLASS_PREDICATE);
const hasEdge = (rows, s, o) => subClassRows(rows).some((r) => r.subject === s && r.object === o);

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
