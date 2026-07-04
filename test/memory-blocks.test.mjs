// memory/blocks.mjs tests — text blocks + the relevance index: storage
// (atomic upsert, idempotent replace), the iterative PageRank over the
// block-similarity graph, and IDF-weighted retrieval combined with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BLOCKS_DIR_REL, tokenizeBlock, rankBlocks, loadBlockIndex,
  saveBlock, removeBlock, retrieveBlocks,
} from "../src/memory/blocks.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-mem-blocks-"));
}

// A tiny corpus: three graph/session-flavoured blocks that share vocabulary
// (well-connected) and one isolated block about something else entirely.
const CORPUS = {
  "sess-imports": "Q: which modules import config.mjs?\nA: the graph shows app/lib/b.mjs imports config.mjs.",
  "sess-calls": "Q: who calls the helper function in the graph?\nA: helper is called by modules that import b.mjs.",
  "sess-history": "Q: what does the commit history say about the graph modules?\nA: commits touch the import edges of config.mjs.",
  "sess-lunch": "Q: what is a good lunch?\nA: soup, reportedly excellent soup.",
};

async function seed(dir, corpus = CORPUS) {
  for (const [id, text] of Object.entries(corpus)) await saveBlock(dir, { id, text });
}

test("saveBlock: writes <id>.txt + index.json with tokens and a rank; same id replaces, never duplicates", async () => {
  const dir = await tmpRepo();
  try {
    await saveBlock(dir, { id: "sess-1", text: "Q: which modules import config.mjs?" });
    await saveBlock(dir, { id: "sess-1", text: "Q: who calls helper?" }); // re-fold: replace
    const names = await readdir(join(dir, BLOCKS_DIR_REL));
    assert.deepEqual(names.sort(), ["index.json", "sess-1.txt"]);
    assert.ok(!names.some((n) => n.includes(".tmp-")), "atomic writes leave no temp litter");
    assert.equal(await readFile(join(dir, BLOCKS_DIR_REL, "sess-1.txt"), "utf8"), "Q: who calls helper?");

    const index = await loadBlockIndex(dir);
    assert.deepEqual(Object.keys(index.blocks), ["sess-1"]);
    assert.ok(index.blocks["sess-1"].tokens.includes("helper"), "re-tokenized on replace");
    assert.ok(!index.blocks["sess-1"].tokens.includes("config"), "old tokens gone");
    assert.equal(typeof index.blocks["sess-1"].rank, "number");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveBlock: a hostile block id is normalized into the filename, never a path", async () => {
  const dir = await tmpRepo();
  try {
    const entry = await saveBlock(dir, { id: "../../evil id", text: "harmless" });
    assert.doesNotMatch(entry.file, /[/\\]/);
    const names = await readdir(join(dir, BLOCKS_DIR_REL));
    assert.ok(names.includes(entry.file), "block landed inside the blocks dir");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rankBlocks: genuine iterative PageRank — ranks sum to 1, well-connected blocks outrank isolated ones", () => {
  const tokensById = {
    hub: ["graph", "modules", "imports", "sessions"],
    a: ["graph", "modules", "alpha"],
    b: ["graph", "imports", "beta"],
    c: ["modules", "sessions", "gamma"],
    loner: ["soup", "lunch", "recipes"],
  };
  const ranks = rankBlocks(tokensById);
  const total = Object.values(ranks).reduce((s, r) => s + r, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `ranks are a distribution (sum=${total})`);
  assert.ok(ranks.hub > ranks.a, "the hub (linked by all three) outranks a spoke");
  assert.ok(ranks.a > ranks.loner, "any connected block outranks the isolated one");
  assert.deepEqual(rankBlocks({}), {}, "empty corpus → empty ranks");
  // a single unlinked block still gets the full (dangling) mass
  const solo = rankBlocks({ only: ["alpha", "beta"] });
  assert.ok(Math.abs(solo.only - 1) < 1e-9);
});

test("retrieveBlocks: the on-topic block wins for an off-cluster query (IDF beats connectivity)", async () => {
  const dir = await tmpRepo();
  try {
    await seed(dir);
    const hits = await retrieveBlocks(dir, "any good soup for lunch?", 2);
    assert.equal(hits[0].id, "sess-lunch", "rare on-topic tokens beat well-connected off-topic blocks");
    assert.equal(hits[0].text, CORPUS["sess-lunch"], "the block text rides along");
    assert.ok(hits[0].score > (hits[1]?.score ?? 0));

    const graphHits = await retrieveBlocks(dir, "which modules import config.mjs", 3);
    assert.equal(graphHits[0].id, "sess-imports");
    assert.ok(graphHits.every((h) => h.id !== "sess-lunch"), "the lunch block never touches a graph question");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retrieveBlocks: on an IDF tie the static rank prefers the well-connected block", async () => {
  const dir = await tmpRepo();
  try {
    // "zebra" appears in exactly two blocks with identical IDF contribution:
    // one connected to the cluster (shares graph/modules), one isolated.
    await seed(dir, {
      connected: "zebra graph modules imports",
      isolated: "zebra quokka pangolin",
      other1: "graph modules sessions",
      other2: "graph imports sessions",
    });
    const index = await loadBlockIndex(dir);
    assert.ok(index.blocks.connected.rank > index.blocks.isolated.rank, "PageRank favours the connected block");
    const hits = await retrieveBlocks(dir, "zebra", 2);
    assert.deepEqual(hits.map((h) => h.id), ["connected", "isolated"], "tie broken by static rank");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retrieveBlocks: no index, no query tokens, or no overlap → [] (honest, never a guessed block)", async () => {
  const dir = await tmpRepo();
  try {
    assert.deepEqual(await retrieveBlocks(dir, "anything"), [], "no blocks dir yet");
    await seed(dir);
    assert.deepEqual(await retrieveBlocks(dir, "a ? !"), [], "no tokenizable words in the query");
    assert.deepEqual(await retrieveBlocks(dir, "xylophone cadenza"), [], "no overlapping block");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeBlock: deletes the block + entry and re-ranks; unknown id is a no-op", async () => {
  const dir = await tmpRepo();
  try {
    await seed(dir);
    assert.equal(await removeBlock(dir, "sess-lunch"), true);
    assert.equal(await removeBlock(dir, "sess-lunch"), false);
    const index = await loadBlockIndex(dir);
    assert.equal(index.blocks["sess-lunch"], undefined);
    const total = Object.values(index.blocks).reduce((s, b) => s + b.rank, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, "survivors re-ranked to a distribution");
    const names = await readdir(join(dir, BLOCKS_DIR_REL));
    assert.ok(!names.includes("sess-lunch.txt"), "block file removed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tokenizeBlock: prose + identifier decomposition, deduped/sorted; a long transcript is not starved by the per-doc cap", () => {
  const tokens = tokenizeBlock("Q: who calls calculateTotalPrice in app/lib/b.mjs?\nA: calculateTotalPrice is called by checkout.");
  for (const t of ["calculate", "total", "price", "checkout", "calls", "lib"]) {
    assert.ok(tokens.includes(t), `token "${t}" present`);
  }
  assert.deepEqual(tokens, [...new Set(tokens)].sort(), "deduped and sorted");
  // 300 lines × distinct words would blow tokenizeProse's 120/doc cap if applied whole-block
  const long = Array.from({ length: 300 }, (_, i) => `unique word${i} appears here`).join("\n");
  assert.ok(tokenizeBlock(long).length > 120, "per-line union beats the per-doc cap");
});
