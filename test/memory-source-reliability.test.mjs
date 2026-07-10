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
import { appendFact, loadMemory, readFactRows, SOURCE_CLASS, SOURCE_RELIABILITY_PROP } from "../src/memory/core.mjs";
import { sessionReliabilityFrom } from "../src/memory/trust.mjs";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-mem-srcrel-"));
const attr = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value;

const SESSION_A = "0189ffff-0000-7000-8000-00000000aaaa"; // contradicted repeatedly
const SESSION_B = "0189ffff-0000-7000-8000-00000000bbbb"; // corroborated (never contradicted)

test("actor-level trust end-to-end: a contradicted session's Source scores lower than a corroborated session's, and it measurably lowers that session's own facts' trust", async () => {
  const dir = await tmpRepo();
  try {
    const teachA = (subject, object) => appendFact(dir, {
      subject, predicate: "mgx:hasProperty", object, provenance: `teach:chat:${SESSION_A}@2026-07-09T00:00:00.000Z`,
    });
    const teachB = (subject, object) => appendFact(dir, {
      subject, predicate: "mgx:hasProperty", object, provenance: `teach:chat:${SESSION_B}@2026-07-09T00:00:00.000Z`,
    });
    const corpusSays = (subject, object) => appendFact(dir, {
      subject, predicate: "mgx:hasProperty", object, provenance: "corpus:conceptnet /r/HasProperty",
    });

    // Session A: 5 taught facts, 3 of which are later contradicted by a
    // (unrelated, non-session-scoped) corpus source — 3 differing-object pairs.
    await teachA("alpha", "red"); await corpusSays("alpha", "blue");
    await teachA("beta", "red"); await corpusSays("beta", "blue");
    await teachA("gamma", "red"); await corpusSays("gamma", "blue");
    await teachA("delta", "red");   // asserted by A, NEVER itself contradicted
    await teachA("epsilon", "red"); // asserted by A, NEVER itself contradicted

    // Session B: 5 taught facts, none ever contradicted.
    await teachB("zeta", "red");
    await teachB("eta", "red");
    await teachB("theta", "red");
    await teachB("iota", "red");
    await teachB("kappa", "red");

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
