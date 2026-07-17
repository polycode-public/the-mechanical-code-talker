// The query side memoizes its per-turn reload of the fact rows.
// Before this fix, `factRows` (chat.mjs) called `loadMemory`
// + `readFactRows` (memory/core.mjs) fresh, UNCACHED, on every single call —
// and a single runTurn call can reach several independent factRows() readers
// (factAnswer's own cascade, factReadBack, countFromFacts,
// answerQuantifierRecall, describedFacts, teachLane's grounding fallbacks,
// conceptForceAnswer, assertTurn's paraphrase check, …). The fix threads ONE
// runTurn-scoped cache object through every one of those readers, so the
// underlying loadMemory/readFactRows pass runs at most once per turn no
// matter how many readers ask for the rows.
//
// This is a CALL-COUNT assertion (deterministic), not a wall-clock one:
// timing assertions are flaky under machine contention, call counts are not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
// answerCount (and therefore countFromFacts, one of the two lanes this test
// exercises) declines outright with no graph loaded — pass it explicitly,
// same as every other test in this suite that needs a real graph present.
const GRAPH = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));

test("factRows cache: one runTurn call reuses the memory reload across every reader that asks for it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-factrows-cache-"));
  try {
    // Teach an ASSERTED-VOCABULARY fact ("every class is a type") — the exact
    // shape countFromFacts's own docblock uses as its canonical example: the
    // OBJECT noun ("type") inherits the SUBJECT class's ("class") real graph
    // cardinality once asserted.
    const taught = await runTurn("every class is a type", {
      config: CONFIG, graph: GRAPH, memoryDir: dir, sessionId: "cache-test",
    });
    assert.match(taught.answer, /noted — remembered 1 fact/);

    // "how many types are there" walks TWO independent factRows() readers in
    // one runTurn call, in sequence, neither short-circuiting the other:
    //   1. answerQuantifierRecall (Feature A point 4's "how many Xs are Ys"
    //      literal-quantifier recall) — reads factRows, finds no isa-fact
    //      whose SUBJECT is "type" (the taught fact's subject is "class", not
    //      "type"), declines (returns null).
    //   2. answerCount recognizes the "how many <noun>" SHAPE but not "types"
    //      as a real graph kind, so it returns its own non-null "I can't
    //      count" text — which routes to countFromFacts, the asserted-
    //      vocabulary override, which ALSO reads factRows, this time finding
    //      the taught fact by its OBJECT ("type") and answering with the
    //      inherited "class" cardinality.
    // Before this fix, that's two full loadMemory+readFactRows passes for one
    // turn; after it, the second reader hits the first reader's cached rows.
    const factRowsCache = { rows: null };
    const answer = await runTurn("how many types are there", {
      config: CONFIG, graph: GRAPH, memoryDir: dir, factRowsCache,
    });

    // Sanity: the turn actually answered via the asserted-vocabulary lane
    // this test means to exercise (countFromFacts, which — confirmed live —
    // labels its hit via:"fact", the same tag ordinary remembered-fact
    // answers use; via:"count" is reserved for answerCount's OWN literal
    // graph-cardinality answer, a different lane), not some unrelated miss.
    assert.match(answer.answer, /^\d+ types?\.$/);
    assert.equal(answer.record.via, "fact");

    // The actual regression assertion: exactly ONE real reload this turn.
    assert.equal(factRowsCache.reloads, 1,
      "expected exactly one loadMemory+readFactRows pass for this turn " +
      "(answerQuantifierRecall's decline and countFromFacts's hit should " +
      "share the same cached rows), got " + factRowsCache.reloads);
    // ...and the cache genuinely holds the real rows (not left null / unused).
    assert.ok(Array.isArray(factRowsCache.rows) && factRowsCache.rows.length > 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("factRows cache: a caller with no injected cache still gets a fresh, correct per-turn cache (backward compatible default)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-factrows-cache-default-"));
  try {
    const taught = await runTurn("every class is a type", {
      config: CONFIG, graph: GRAPH, memoryDir: dir, sessionId: "cache-test-default",
    });
    assert.match(taught.answer, /noted — remembered 1 fact/);

    // No `factRowsCache` passed at all — every existing caller's shape.
    // Must answer exactly as before: same text, same `via`, no crash.
    const answer = await runTurn("how many types are there", {
      config: CONFIG, graph: GRAPH, memoryDir: dir,
    });
    assert.match(answer.answer, /^\d+ types?\.$/);
    assert.equal(answer.record.via, "fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
