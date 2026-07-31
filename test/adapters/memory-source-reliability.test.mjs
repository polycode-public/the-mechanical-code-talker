// memory/core.mjs + memory/trust.mjs end-to-end test — Part B3: actor-level
// (session-scoped) Source reliability. Proves recomputeSourceReliability (wired
// into mutateMemory's existing per-mutation bookkeeping, core.mjs) and
// sessionReliabilityFrom (the pure formula, trust.mjs) work together over a
// real memory store: a session whose taught facts get repeatedly contradicted
// ends up with a lower mgx:sourceReliability than a session whose facts are
// never contradicted, and — via B1's computeTrust hook — that difference is
// measurably visible on materialised mgx:trustScore, even for a fact the
// low-reliability session asserted that was NEVER ITSELF contradicted (the
// whole point of "actor-level" trust: a session's reputation follows it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, loadMemory, readFactRows, SOURCE_CLASS, SOURCE_RELIABILITY_PROP, UPDATED_AT_PROP } from "../../src/adapters/memory/core.mjs";
import { sessionReliabilityFrom } from "../../src/domain/memory/trust.mjs";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-mem-srcrel-"));
const attr = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value;

const SESSION_A = "0189ffff-0000-7000-8000-00000000aaaa"; // contradicted repeatedly
const SESSION_B = "0189ffff-0000-7000-8000-00000000bbbb"; // corroborated (never contradicted)

// A functional relation — one subject has one of these — so the resolver table
// leaves it on the default `contradiction` strategy and a differing object is a
// real disagreement the reliability tally can count.
const SINGLE_VALUED = "mgx:father";

test("actor-level trust end-to-end: a contradicted session's Source scores lower than a corroborated session's, and it measurably lowers that session's own facts' trust", async () => {
  const dir = await tmpRepo();
  try {
    const teachA = (subject, object) => appendFact(dir, {
      subject, predicate: SINGLE_VALUED, object, provenance: `teach:chat:${SESSION_A}@2026-07-09T00:00:00.000Z`,
    });
    const teachB = (subject, object) => appendFact(dir, {
      subject, predicate: SINGLE_VALUED, object, provenance: `teach:chat:${SESSION_B}@2026-07-09T00:00:00.000Z`,
    });
    const corpusSays = (subject, object) => appendFact(dir, {
      subject, predicate: SINGLE_VALUED, object, provenance: "corpus:conceptnet /r/IsA",
    });

    // Session A: 5 taught facts, 3 of which are later contradicted by a
    // (unrelated, non-session-scoped) corpus source — 3 differing-object pairs.
    await teachA("alpha", "bruno"); await corpusSays("alpha", "rex");
    await teachA("beta", "bruno"); await corpusSays("beta", "rex");
    await teachA("gamma", "bruno"); await corpusSays("gamma", "rex");
    await teachA("delta", "bruno");   // asserted by A, NEVER itself contradicted
    await teachA("epsilon", "bruno"); // asserted by A, NEVER itself contradicted

    // Session B: 5 taught facts, none ever contradicted.
    await teachB("zeta", "bruno");
    await teachB("eta", "bruno");
    await teachB("theta", "bruno");
    await teachB("iota", "bruno");
    await teachB("kappa", "bruno");

    const m = await loadMemory(dir);
    const sourceA = m.individuals.find((i) => i.class === SOURCE_CLASS && i.id === `src:teach-chat:${SESSION_A}`);
    const sourceB = m.individuals.find((i) => i.class === SOURCE_CLASS && i.id === `src:teach-chat:${SESSION_B}`);
    assert.ok(sourceA, "session A's teach Source individual exists");
    assert.ok(sourceB, "session B's teach Source individual exists");

    const reliabilityA = Number(attr(sourceA, SOURCE_RELIABILITY_PROP));
    const reliabilityB = Number(attr(sourceB, SOURCE_RELIABILITY_PROP));
    assert.ok(Number.isFinite(reliabilityA), "session A's reliability materialised");
    assert.ok(Number.isFinite(reliabilityB), "session B's reliability materialised");
    assert.ok(reliabilityA < reliabilityB, `contradicted session (${reliabilityA}) scores lower than corroborated session (${reliabilityB})`);

    // it matches the pure function directly — auditable, reproducible from the
    // exact (factsAsserted, factsContradicted) tally this fixture produces.
    assert.equal(reliabilityA, sessionReliabilityFrom({ factsAsserted: 5, factsContradicted: 3 }));
    assert.equal(reliabilityB, sessionReliabilityFrom({ factsAsserted: 5, factsContradicted: 0 }));
    assert.ok(reliabilityA < 1, "a majority-contradicted session drops below neutral");
    assert.ok(reliabilityB > 1, "a wholly-corroborated session rises above neutral");

    // B1's hook, end-to-end: session A's own (never-contradicted) fact "delta"
    // scores measurably LOWER than session B's equivalent uncontradicted fact
    // "zeta" — the session's overall reputation follows every fact it stated,
    // not just the ones directly caught in a contradiction.
    const rows = readFactRows(m);
    const deltaTrust = rows.find((r) => r.subject === "delta")?.trust;
    const zetaTrust = rows.find((r) => r.subject === "zeta")?.trust;
    assert.ok(Number.isFinite(deltaTrust) && Number.isFinite(zetaTrust), "both trust scores materialised");
    assert.ok(
      deltaTrust < zetaTrust,
      `session A's reputation lowers delta's trust (${deltaTrust}) below session B's zeta (${zetaTrust}), despite neither fact being directly contradicted`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("actor-level trust: a session with no facts at all mints no reliability attribute (recomputeSourceReliability only ever touches Sources it has evidence for)", async () => {
  const dir = await tmpRepo();
  try {
    // a single, ordinary, session-less fact — no operator/teach session Source
    // should ever be minted, let alone carry a reliability attribute.
    await appendFact(dir, { subject: "x", predicate: "isa", object: "y", provenance: "corpus:conceptnet /r/IsA" });
    const m = await loadMemory(dir);
    const sessionScoped = m.individuals.filter((i) => i.class === SOURCE_CLASS && /^src:(operator|teach)-chat:/.test(i.id));
    assert.deepEqual(sessionScoped, [], "no session-scoped Source exists when nothing was taught/asserted in a session");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a Fact's and a Source's mgx:updatedAt advance when recomputeFactTrust/recomputeSourceReliability re-stamp trust attributes on a later, unrelated mutation", async () => {
  const dir = await tmpRepo();
  try {
    const SESSION = "0189ffff-0000-7000-8000-00000000cccc";
    const teach = (subject, object) => appendFact(dir, {
      subject, predicate: "mgx:hasProperty", object, provenance: `teach:chat:${SESSION}@2026-07-11T00:00:00.000Z`,
    });

    await teach("alpha", "red");
    const m1 = await loadMemory(dir);
    const sourceId = `src:teach-chat:${SESSION}`;
    const source1 = m1.individuals.find((i) => i.class === SOURCE_CLASS && i.id === sourceId);
    const fact1 = m1.individuals.find((i) => i.class === "Fact" && attr(i, "rdf:subject") === "alpha");
    assert.ok(source1, "session's teach Source individual exists");
    assert.ok(fact1, "the taught fact exists");
    const sourceUpdated1 = attr(source1, UPDATED_AT_PROP);
    const factUpdated1 = attr(fact1, UPDATED_AT_PROP);
    assert.ok(sourceUpdated1, "recomputeSourceReliability stamped the Source's updatedAt");
    assert.ok(factUpdated1, "recomputeFactTrust stamped the Fact's updatedAt");

    await new Promise((r) => setTimeout(r, 5)); // force a distinct wall-clock millisecond
    // A second, UNRELATED teach from the same session: recomputeSourceReliability re-stamps
    // EVERY session-scoped Source it finds evidence for on every mutation (not just the source
    // whose own fact count just changed), and re-materialises trust for every Fact that Source
    // stated — so both "alpha"'s Fact and the session's Source get a fresh updatedAt here even
    // though "alpha" itself was not re-taught.
    await teach("beta", "red");
    const m2 = await loadMemory(dir);
    const source2 = m2.individuals.find((i) => i.class === SOURCE_CLASS && i.id === sourceId);
    const fact2 = m2.individuals.find((i) => i.class === "Fact" && attr(i, "rdf:subject") === "alpha");
    const sourceUpdated2 = attr(source2, UPDATED_AT_PROP);
    const factUpdated2 = attr(fact2, UPDATED_AT_PROP);

    assert.ok(sourceUpdated2 > sourceUpdated1, `Source updatedAt advances (${sourceUpdated1} -> ${sourceUpdated2})`);
    assert.ok(factUpdated2 > factUpdated1, `Fact updatedAt advances (${factUpdated1} -> ${factUpdated2})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
