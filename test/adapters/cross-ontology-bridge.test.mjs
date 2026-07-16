// Cross-ontology bridge, the fact-store side: WordNet's noun hierarchy and
// Schema.org's class hierarchy were built independently; the corpus's tiny
// hand-authored bridge clump ("person rdfs:subClassOf schema person") lets
// scm-sco prove a chain spanning both sources plus a session-taught hop:
//
//   surgeon ⊑ doctor (taught)  ⊑ person (WordNet)  ⊑ schema person (bridge)
//
// The chat-visible 2-hop answer is an inference-lane row; this file reads
// the fact rows directly — per-hop provenance, the live pure proof-search
// (findIsaChain), and the offline materializing pass (syllogise/scm-sco)
// actually persisting the collapsed fact with entailed provenance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { createSession } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows, appendFacts, removeFacts } from "../../src/adapters/memory/core.mjs";
import { syllogise as syllogiseSeam, findIsaChain, SUBCLASS_PREDICATE, ENTAILED_PROVENANCE } from "../../src/domain/syllogise.mjs";

// The persisting seam takes the store's read/write functions injected; wire
// the real memory/core.mjs implementations once here.
const STORE = { loadMemory, readFactRows, appendFacts, removeFacts };
const syllogise = (dir, opts = {}) => syllogiseSeam(dir, { store: STORE, ...opts });
import { clearCache } from "../../src/adapters/source.mjs";
import { freshBootstrapRepo } from "../helpers/seeded-fixture.mjs";

test("a taught hop composes with the corpus-seeded WordNet and Schema.org-bridge hops, and scm-sco materializes the full span", async () => {
  const dir = await freshBootstrapRepo("tmct-bridge-");
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
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
    assert.ok(wordnetHop, "doctor ⊑ person — WordNet's own hypernym chain");
    assert.ok(wordnetHop.sourceTypes.includes("corpus"), "corpus-sourced");
    assert.match(wordnetHop.provenance, /^corpus:human/);

    const bridgeHop = findFact("person", "schema person");
    assert.ok(bridgeHop, "person ⊑ schema person — the hand-authored Schema.org bridge");
    assert.ok(bridgeHop.sourceTypes.includes("corpus"), "corpus-sourced");
    assert.match(bridgeHop.provenance, /^corpus:human/);

    // ---- The LIVE pure proof-search walks the full chain, each step a real
    // stored fact whose own provenance a caller could cite ----
    const subClassEdges = rows.filter((r) => r.predicate === SUBCLASS_PREDICATE).map((r) => [r.subject, r.object]);
    const chain = findIsaChain("surgeon", new Set(["schema person"]), [], subClassEdges, { maxHops: 6 });
    assert.ok(chain, "a chain from surgeon to schema person is found");
    assert.deepEqual(
      chain.map((step) => [step.subject, step.object]),
      [["surgeon", "doctor"], ["doctor", "person"], ["person", "schema person"]],
      "the full 3-hop chain, in order — the taught hop first, then the two corpus hops",
    );
    for (const step of chain) {
      assert.ok(findFact(step.subject, step.object), `chain step ${step.subject}⊑${step.object} is a real stored fact`);
    }

    // ---- The OFFLINE materializing pass (scm-sco) actually collapses the
    // chain into one persisted fact ----
    const result = await syllogise(dir, { focus: ["surgeon"], budget: 200 });
    assert.ok(!result.truncated, "the focused pass completes without hitting its budget");
    const derivedRows = readFactRows(await loadMemory(dir));
    const entailed = derivedRows.find((r) =>
      r.predicate === SUBCLASS_PREDICATE && r.subject === "surgeon" && r.object === "schema person");
    assert.ok(entailed, "scm-sco materializes surgeon ⊑ schema person — the full cross-ontology span");
    assert.equal(entailed.provenance, ENTAILED_PROVENANCE);
    assert.ok(entailed.sourceTypes.includes("entailed"));
    // never outranks a stated premise (this module's own standing invariant)
    assert.ok(entailed.trust < wordnetHop.trust, "the entailed conclusion stays below its weakest real premise");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
