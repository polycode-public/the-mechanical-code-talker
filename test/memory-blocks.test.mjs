// memory/blocks.mjs tests — text blocks + the relevance index: storage
// (atomic upsert, idempotent replace), the iterative PageRank over the
// block-similarity graph, and IDF-weighted retrieval combined with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BLOCKS_DIR_REL, tokenizeBlock, rankBlocks, degreeOf, loadBlockIndex,
  saveBlock, removeBlock, retrieveBlocks,
} from "../src/adapters/memory/blocks.mjs";

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

test("retrieveBlocks: hub dampening — the RAW rank signal still favours connectivity, but on an IDF tie retrieval now favours the truly isolated block over one that is connected but disproportionately so", async () => {
  const dir = await tmpRepo();
  try {
    // "zebra" appears in exactly two blocks with identical IDF contribution:
    // one connected to the cluster (shares graph/modules with BOTH other1 and
    // other2, degree 2), one truly isolated (degree 0, no edges at all).
    await seed(dir, {
      connected: "zebra graph modules imports",
      isolated: "zebra quokka pangolin",
      other1: "graph modules sessions",
      other2: "graph imports sessions",
    });
    const index = await loadBlockIndex(dir);
    // The underlying PageRank signal is unchanged and still genuinely favours
    // connectivity (0.317 vs 0.048 here) — connectivity is a real, meaningful
    // graph-structure signal, dampening doesn't touch rankBlocks() itself.
    assert.ok(index.blocks.connected.rank > index.blocks.isolated.rank, "PageRank favours the connected block");
    assert.equal(index.blocks.connected.degree, 2, "connected: shares an edge with both other1 and other2");
    assert.equal(index.blocks.isolated.degree, 0, "isolated: shares no edge with anything");

    // But retrieveBlocks divides by sqrt(1+degree): sqrt(3)≈1.732 for `connected`
    // vs sqrt(1)=1 for `isolated`. Working the numbers — idfSum is identical for
    // both (0.847), trustFactor identical (1.5, same sourceType) — the tie comes
    // down to (1+rank)/sqrt(1+degree): isolated → 1.0476/1 ≈ 1.048; connected →
    // 1.3175/1.732 ≈ 0.761. This flip is NOT a fixture-tuning artefact: it is
    // mathematically forced at ANY corpus size. The best possible topology for a
    // degree-1 block (a tight mutual pair with its one neighbour, nothing else
    // linked to either) provably caps its achievable (1+rank) ratio over an
    // isolated competitor at ≈1.37 — below the sqrt(2)≈1.414 divisor gap a
    // single edge already costs, and the gap only widens for higher degree. So a
    // block with ANY nonzero degree can never out-retrieve a degree-0 block on an
    // exact IDF tie once dampening is on; that's the dampening working as
    // designed, not a corpus that needs to be bigger. (See the two tests below
    // for the properties that DO survive dampening: connectivity still breaks
    // ties between equally-connected blocks, and a disproportionate hub still
    // loses to a specifically on-topic block.)
    const hits = await retrieveBlocks(dir, "zebra", 2);
    assert.deepEqual(hits.map((h) => h.id), ["isolated", "connected"],
      "dampening suppresses connected's tie-break advantage against a truly unconnected block");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("degreeOf: hand-verified adjacency on a small, easy-to-check-by-hand graph", () => {
  // Overlap threshold is 2 shared tokens. Pairwise shared-token counts:
  //   A∩B = {cat,dog}  = 2 → edge      A∩C = {cat,bird} = 2 → edge
  //   A∩D = {}         = 0 → no edge   A∩E = {cat,dog}  = 2 → edge
  //   B∩C = {cat,fish} = 2 → edge      B∩D = {}         = 0 → no edge
  //   B∩E = {cat,dog}  = 2 → edge      C∩D = {}         = 0 → no edge
  //   C∩E = {cat}      = 1 → no edge   D∩E = {}         = 0 → no edge
  // So: A-B, A-C, A-E, B-C, B-E are edges (5 total); D has none.
  // Degrees: A={B,C,E}=3, B={A,C,E}=3, C={A,B}=2, D={}=0, E={A,B}=2.
  const tokensById = {
    A: ["cat", "dog", "bird"],
    B: ["cat", "dog", "fish"],
    C: ["cat", "bird", "fish"],
    D: ["zebra", "quokka"],
    E: ["cat", "dog"],
  };
  assert.deepEqual(degreeOf(tokensById), { A: 3, B: 3, C: 2, D: 0, E: 2 });
  assert.deepEqual(degreeOf({}), {}, "empty corpus → empty degrees");
  assert.deepEqual(degreeOf({ only: ["a", "b"] }), { only: 0 }, "a single block has no one to link to");
});

test("retrieveBlocks: connectivity still breaks a real IDF tie between EQUALLY-connected blocks (dampening only penalises a block's OWN degree, so equal degree means equal penalty and rank still decides)", async () => {
  const dir = await tmpRepo();
  try {
    // Both `moreImportant` and `lessImportant` have degree 1 — same sqrt(1+degree)
    // divisor for both, so it cancels out of the comparison entirely and the
    // underlying PageRank difference is free to decide, exactly as pre-dampening.
    // `moreImportant`'s one neighbour (dedicatedPartner) links to nothing else, so
    // ALL of its rank flows back — the rank-maximising topology for a degree-1
    // block. `lessImportant`'s one neighbour (busyNeighbor) is itself a small hub
    // (degree 4, linked to busy2/3/4 too), so its rank gets diluted across four
    // neighbours instead of concentrating on lessImportant alone.
    await seed(dir, {
      moreImportant: "zebra graph modules",
      dedicatedPartner: "graph modules sessions",
      lessImportant: "zebra commits edges",
      busyNeighbor: "commits edges history imports rollback deploy",
      busy2: "history imports rollback",
      busy3: "imports rollback deploy",
      busy4: "rollback deploy history",
      filler1: "database schema migration plan",
      filler2: "authentication token refresh expiry",
    });
    const index = await loadBlockIndex(dir);
    assert.equal(index.blocks.moreImportant.degree, 1);
    assert.equal(index.blocks.lessImportant.degree, 1);
    assert.ok(index.blocks.moreImportant.rank > index.blocks.lessImportant.rank,
      "same degree, but moreImportant's neighbour concentrates rank while lessImportant's is diluted");
    // Worked numbers (damping 0.85, this 9-block corpus): moreImportant rank
    // ≈0.137 → score ≈1.672; lessImportant rank ≈0.062 → score ≈1.561. Both
    // divide by the identical sqrt(2)≈1.414, so the ~2.2× rank gap survives
    // dampening completely intact.
    const hits = await retrieveBlocks(dir, "zebra", 2);
    assert.deepEqual(hits.map((h) => h.id), ["moreImportant", "lessImportant"],
      "connectivity/importance is still a real signal once degree itself is held equal");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retrieveBlocks: a disproportionate 'boilerplate' hub is suppressed below a specifically on-topic block, even though the hub's raw PageRank score would have won", async () => {
  const dir = await tmpRepo();
  try {
    // `hub` shares ≥2 tokens with EVERY other block in this 10-block corpus
    // (degree 9 — a genuine generic/boilerplate block, topically vague but
    // vocabulary-adjacent to everything). `specific` shares the query's tokens
    // too (an exact IDF tie with hub) but is otherwise linked to nothing except
    // hub itself (degree 1) — it is the specifically on-topic block.
    await seed(dir, {
      hub: "graph modules imports sessions history commits edges schema migration",
      specific: "schema migration rollback plan",
      peer1: "graph modules sessions",
      peer2: "graph imports sessions",
      peer3: "modules imports history",
      peer4: "imports commits edges",
      peer5: "sessions edges history",
      peer6: "modules commits schema",
      peer7: "graph history edges",
      peer8: "imports sessions schema",
    });
    const index = await loadBlockIndex(dir);
    assert.equal(index.blocks.hub.degree, 9, "hub links to every other block in the corpus");
    assert.equal(index.blocks.specific.degree, 1, "specific links only to hub");
    // Worked numbers: idfSum is tied at ≈2.565 for both (both contain "schema"
    // and "migration"). Undamped, hub's inflated rank (≈0.355 vs specific's
    // ≈0.049) would have made hub win: hub scoreOld ≈5.21 > specific scoreOld
    // ≈4.03. Dampening flips it: hub ÷ sqrt(10)≈3.16 → ≈1.65; specific ÷
    // sqrt(2)≈1.41 → ≈2.85 — specific wins by a wide margin.
    assert.ok(index.blocks.hub.rank > index.blocks.specific.rank, "undamped PageRank still favours the hub");
    const hits = await retrieveBlocks(dir, "schema migration", 2);
    assert.deepEqual(hits.map((h) => h.id), ["specific", "hub"],
      "the on-topic block outranks the inflated generic hub once dampening applies");
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
