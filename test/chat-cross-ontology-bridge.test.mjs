// chat-cross-ontology-bridge.test.mjs — PLAN_SEED.md §8's showcase: WordNet's
// noun hierarchy (rooted at "entity") and Schema.org's class hierarchy (rooted
// at ":Thing") were built independently, by different people, for different
// purposes. `scm-sco` (subClassOf transitivity — already built, already
// tested in src/syllogise.mjs, UNMODIFIED here) doesn't care where an edge
// came from, so `human-bridge`'s tiny set of hand-authored bridge facts
// (corpus/tier2/human.jsonl, e.g. "person rdfs:subClassOf schema person")
// lets tmct prove a chain spanning BOTH sources at once:
//
//   surgeon ⊑ doctor (taught, this session)
//         ⊑ person (WordNet, corpus:human's human-core clump)
//         ⊑ schema person (Schema.org-bridged, corpus:human's human-bridge clump)
//
// This is content + test only — no new rule code (PLAN_SEED.md §8's own
// scope line). Two proofs, both exercising real machinery:
//   1. the LIVE pure proof-search (findIsaChain) walks the full 3-hop chain
//      and hands back each hop's own stored fact, so the caller can cite each
//      one's own provenance (the taught link + the two corpus:human-sourced
//      WordNet/Schema.org-bridged links) — this is what "citing both sources
//      in the answer's provenance" means here.
//   2. the OFFLINE MATERIALIZING pass (`syllogise()`, the same engine behind
//      `tmct syllogise`) actually writes the collapsed "surgeon ⊑ schema
//      person" fact into memory with `entailed:subClassOf` provenance,
//      proving scm-sco closes the chain for real, not just in a live query.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { syllogise, findIsaChain, SUBCLASS_PREDICATE, ENTAILED_PROVENANCE } from "../src/syllogise.mjs";
import { clearCache } from "../src/source.mjs";

const mem = () => mkdtemp(join(tmpdir(), "tmct-bridge-"));

test("cross-ontology bridge: a taught WordNet-side chain composes with the corpus-seeded human-bridge fact, and scm-sco proves the full span end to end", async () => {
  const dir = await mem();
  try {
    clearCache();
    // A fresh session auto-seeds the default `human` bundle (PLAN_SEED.md's
    // persona flip) — this alone carries human-core's "doctor ⊑ person" and
    // human-bridge's "person ⊑ schema person" (the WordNet-root-to-Schema.org
    // showcase connection), with zero teaching required for either.
    const s = await createSession({ repoPath: dir, env: {} });
    // The only NEW thing this test teaches: one further WordNet-side hop,
    // making a genuine multi-hop chain that spans a taught link AND two
    // corpus-sourced links before reaching the Schema.org-bridged root.
    const taught = await s.turn("a surgeon is a kind of doctor");
    await s.close();
    assert.match(taught.answer, /noted — remembered/, "the taught link stores cleanly");

    const rows = readFactRows(await loadMemory(dir));
    const findFact = (subject, object) =>
      rows.find((r) => r.predicate === SUBCLASS_PREDICATE && r.subject === subject && r.object === object);

    // ---- Every hop of the chain is present, from its own real source ----
    const taughtHop = findFact("surgeon", "doctor");
    assert.ok(taughtHop, "surgeon ⊑ doctor (taught this session)");
    assert.ok(!taughtHop.sourceTypes.includes("corpus"), "the taught hop is NOT corpus-sourced");

    const wordnetHop = findFact("doctor", "person");
    assert.ok(wordnetHop, "doctor ⊑ person — WordNet's own hypernym chain (human-core clump)");
    assert.ok(wordnetHop.sourceTypes.includes("corpus"), "corpus-sourced (corpus:human)");
    assert.match(wordnetHop.provenance, /^corpus:human/);

    const bridgeHop = findFact("person", "schema person");
    assert.ok(bridgeHop, "person ⊑ schema person — the hand-authored Schema.org bridge (human-bridge clump)");
    assert.ok(bridgeHop.sourceTypes.includes("corpus"), "corpus-sourced (corpus:human)");
    assert.match(bridgeHop.provenance, /^corpus:human/);

    // ---- Proof 1: the LIVE pure proof-search walks the full chain, citing
    // each hop's own fact (both sources: the taught link + the two
    // corpus:human-sourced WordNet/Schema.org-bridged links) ----
    const subClassEdges = rows.filter((r) => r.predicate === SUBCLASS_PREDICATE).map((r) => [r.subject, r.object]);
    const chain = findIsaChain("surgeon", new Set(["schema person"]), [], subClassEdges, { maxHops: 6 });
    assert.ok(chain, "a chain from surgeon to schema person is found");
    assert.deepEqual(
      chain.map((step) => [step.subject, step.object]),
      [["surgeon", "doctor"], ["doctor", "person"], ["person", "schema person"]],
      "the full 3-hop chain, in order — the taught hop first, then the two WordNet/Schema.org-bridged corpus hops",
    );
    // Every step in the chain resolves back to a real stored fact this test
    // already confirmed above — the caller (a chat answer) would cite each
    // one's own provenance line, spanning the taught source AND corpus:human
    // (which itself is hand-curated from Open English WordNet + Schema.org —
    // see corpus/tier2/generate.mjs's own CORPUSES.human docblock).
    for (const step of chain) {
      assert.ok(findFact(step.subject, step.object), `chain step ${step.subject}⊑${step.object} is a real stored fact`);
    }

    // ---- Proof 2: the OFFLINE materializing pass (scm-sco, unmodified)
    // actually collapses the chain into one persisted fact ----
    const result = await syllogise(dir, { focus: ["surgeon"], budget: 200 });
    assert.ok(!result.truncated, "the focused pass completes without hitting its budget");
    const derivedRows = readFactRows(await loadMemory(dir));
    const entailed = derivedRows.find((r) =>
      r.predicate === SUBCLASS_PREDICATE && r.subject === "surgeon" && r.object === "schema person");
    assert.ok(entailed, "scm-sco materializes surgeon ⊑ schema person — the full cross-ontology span, proved");
    assert.equal(entailed.provenance, ENTAILED_PROVENANCE);
    assert.ok(entailed.sourceTypes.includes("entailed"));
    // never outranks a stated premise (this module's own standing invariant)
    assert.ok(entailed.trust < wordnetHop.trust, "the entailed conclusion stays below its weakest real premise");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
