// completions-stage0.test.mjs — Stage 0 verification for PLAN_COMPLETIONS.md's mechanical
// text-generation pipeline (Stage 1: broad search, Stage 2: grouping — no more, per the
// plan's §4 staging table).
//
// Stage 0's own exit criterion ("groups are stable and inspectable for a hand-picked prompt
// set") is made a CONCRETE, checkable assertion here, not an eyeballed claim: the whole
// search+group pipeline is deterministic (no randomness anywhere), so it is run TWICE over
// the identical fixed prompt set + fixed corpus/graph snapshot and the two runs' resulting
// group partitions are diffed for EXACT equality — any difference would be a real
// determinism bug, not acceptable noise. Each group's output also carries its member ids
// PLUS a human-inspectable label (its top shared-IDF tokens), asserted directly.
//
// Fixtures, deliberately reused rather than invented:
//   - the graph half of the corpus is the SHIPPED examples/mini-webapp/.tmct/graph.json,
//     the same fixture test/chatflow-*.test.mjs and test/ask-resolve-ranking.test.mjs etc.
//     already drive against (read-only here — this file never writes into examples/).
//   - the block half of the corpus is seeded with saveBlock() into a throwaway temp dir,
//     the exact pattern test/memory-blocks.test.mjs already established for exercising
//     memory/blocks.mjs (a literal { id: text } corpus object, not a new fixture file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { saveBlock } from "../src/adapters/memory/blocks.mjs";
import { parseEntities } from "../src/domain/codegraph.mjs";
import { createGraphService } from "../src/adapters/providers/graph-service.mjs";
import { broadSearch } from "../src/domain/completions/search.mjs";
import { groupHits } from "../src/domain/completions/group.mjs";

const MINI_WEBAPP_GRAPH = fileURLToPath(
  new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url),
);

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-completions-stage0-"));
}

// A small block corpus mirroring mini-webapp's own domains, seeded the same way
// test/memory-blocks.test.mjs seeds its CORPUS — three blocks share store/validate
// vocabulary (should cluster together), two share logger/http vocabulary (should cluster
// together), one is a deliberate off-topic isolate (should stay a singleton group).
const BLOCK_CORPUS = {
  "blk-store-1": "Q: what does the Store class do?\nA: Store holds Task and User records and persists them via loadStore and saveStore.",
  "blk-store-2": "Q: how is a task validated?\nA: validateTask checks a Task record's fields before Store saves it.",
  "blk-store-3": "Q: what does saveStore write?\nA: saveStore serializes the Store's Task and User records to disk.",
  "blk-logger-1": "Q: what does Logger do?\nA: Logger.info writes request log lines created by createLogger.",
  "blk-logger-2": "Q: how does http parsing work?\nA: parseBody and sendJson handle request and response bodies for the Logger-backed handlers.",
  "blk-lunch": "Q: what is a good lunch?\nA: soup, reportedly excellent soup.",
};

async function seedBlocks(dir) {
  for (const [id, text] of Object.entries(BLOCK_CORPUS)) await saveBlock(dir, { id, text });
}

async function graphServiceForMiniWebapp() {
  const payload = JSON.parse(await readFile(MINI_WEBAPP_GRAPH, "utf8"));
  const graph = parseEntities(payload);
  return createGraphService(graph);
}

// Five realistic, hand-picked prompts against mini-webapp's real domain vocabulary (Store,
// validateTask, Router, Logger, listTasks — all real individuals in the shipped graph; see
// examples/mini-webapp/.tmct/graph.json's classes/individuals).
const PROMPT_SET = [
  "what does the Store class do",
  "how does validateTask work",
  "what is the Router used for",
  "tell me about Logger",
  "what does listTasks call",
];

/** Runs the full Stage 1 + Stage 2 pipeline once over PROMPT_SET, against a fresh block
 *  corpus + the shipped mini-webapp graph. Returns a plain, JSON-diffable snapshot: for each
 *  prompt, its groups' memberIds + label (never raw hit text/scores — those aren't the
 *  contract Stage 0 is verifying; the PARTITION and its LABELS are). */
async function runPipelineOnce(dir, graphService) {
  const out = {};
  for (const prompt of PROMPT_SET) {
    const hits = await broadSearch(dir, prompt, { graphService });
    const groups = groupHits(hits);
    out[prompt] = groups.map((g) => ({ id: g.id, memberIds: g.memberIds, label: g.label }));
  }
  return out;
}

test("Stage 0 exit criterion: two runs over the identical prompt set + fixed corpus produce EXACTLY the same group partitions", async () => {
  const dir = await tmpRepo();
  try {
    await seedBlocks(dir);
    const graphService = await graphServiceForMiniWebapp();

    const run1 = await runPipelineOnce(dir, graphService);
    const run2 = await runPipelineOnce(dir, graphService);

    assert.deepEqual(run2, run1, "identical inputs must yield byte-identical group partitions — any diff is a determinism bug");

    // sanity: the double-run actually exercised something real, not two empty no-ops.
    const totalGroups = Object.values(run1).reduce((n, gs) => n + gs.length, 0);
    assert.ok(totalGroups > 0, "the hand-picked prompt set must produce at least one group somewhere");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("groupHits(): every group carries member ids PLUS a human-inspectable label (top shared-IDF tokens)", async () => {
  const dir = await tmpRepo();
  try {
    await seedBlocks(dir);
    const hits = await broadSearch(dir, "what does the Store class do", { graphService: null });
    assert.ok(hits.length > 0, "the seeded block corpus must produce block hits for this prompt");
    const groups = groupHits(hits);
    assert.ok(groups.length > 0);
    for (const g of groups) {
      assert.ok(Array.isArray(g.memberIds) && g.memberIds.length > 0, "every group has real member ids");
      assert.equal(typeof g.label, "string");
      assert.ok(g.label.length > 0, "every group has a non-empty, inspectable label");
      assert.ok(Array.isArray(g.tokens));
      // memberIds sorted, deduped, and matching the group's own members
      assert.deepEqual(g.memberIds, [...g.memberIds].sort());
      assert.deepEqual(g.memberIds, [...new Set(g.memberIds)]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("groupHits(): connected components — blocks that share vocabulary cluster together; an off-topic block stays its own singleton group", async () => {
  const dir = await tmpRepo();
  try {
    await seedBlocks(dir);
    // A broad-enough prompt/k to pull in the whole seeded corpus, so this test exercises the
    // clustering shape directly rather than depending on retrieval ranking cutting anything.
    const hits = await broadSearch(dir, "store task user logger http lunch", { blockK: Object.keys(BLOCK_CORPUS).length });
    const ids = new Set(hits.map((h) => h.id));
    assert.ok(["blk-store-1", "blk-store-2", "blk-store-3", "blk-logger-1", "blk-logger-2", "blk-lunch"].every((id) => ids.has(id)),
      "the broad prompt must retrieve the whole seeded corpus for this shape assertion to be meaningful");

    const groups = groupHits(hits);
    const groupOf = (id) => groups.find((g) => g.memberIds.includes(id));

    const storeGroup = groupOf("blk-store-1");
    assert.ok(storeGroup, "blk-store-1 lands in some group");
    assert.deepEqual(
      [...storeGroup.memberIds].sort(),
      ["blk-store-1", "blk-store-2", "blk-store-3"],
      "the three store/validate blocks share enough vocabulary to form one connected component",
    );

    const lunchGroup = groupOf("blk-lunch");
    assert.ok(lunchGroup, "blk-lunch lands in some group");
    assert.deepEqual(lunchGroup.memberIds, ["blk-lunch"], "the off-topic block shares no edge with anything else, so it stays a singleton group");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("broadSearch(): block-only (no graphService) is still a valid, honest broad search — never throws, [] on no match", async () => {
  const dir = await tmpRepo();
  try {
    const hits = await broadSearch(dir, "anything at all", { graphService: null });
    assert.deepEqual(hits, [], "an empty block corpus honestly returns no hits, never a guess");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("broadSearch(): an empty/blank query returns [] without touching either source", async () => {
  const dir = await tmpRepo();
  try {
    await seedBlocks(dir);
    const graphService = await graphServiceForMiniWebapp();
    assert.deepEqual(await broadSearch(dir, "", { graphService }), []);
    assert.deepEqual(await broadSearch(dir, "   ", { graphService }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("broadSearch(): with a graphService, real graph search()/ask() hits are included and source-tagged", async () => {
  const dir = await tmpRepo();
  try {
    const graphService = await graphServiceForMiniWebapp();
    const hits = await broadSearch(dir, "Store", { graphService });
    assert.ok(hits.some((h) => h.source === "graph-search"), "graph search() results are included");
    assert.ok(hits.every((h) => ["block", "graph-search", "graph-ask"].includes(h.source)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("groupHits(): [] in -> [] out (no crash on an empty hit list)", () => {
  assert.deepEqual(groupHits([]), []);
  assert.deepEqual(groupHits(null), []);
});
