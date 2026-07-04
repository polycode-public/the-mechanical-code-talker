// W2 seam tests — retrieveBlocks → the miss path (ROADMAP Phase 4).
//
//   - a relevant folded block ANSWERS an honest ask-miss: recalled Q/A framed +
//     cited (session short-id + uuidv7-decoded date), engine miss hint kept below,
//     via:"recall";
//   - an irrelevant memory leaves the miss byte-unchanged (via:"composed");
//   - a bare runTurn (no memoryDir) never consults memory;
//   - the explicit forms ("what did i ask before", "what did we talk about")
//     summarize the last folded session — proven end-to-end after a real
//     runChat session folds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, PassThrough } from "node:stream";
import { runTurn, runChat, RECALL_MIN_SCORE } from "../src/chat.mjs";
import { saveBlock } from "../src/memory/blocks.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));

// A fixed uuidv7-shaped block id (fold.mjs sets block id = session id). Its
// leading 48 bits decode to a real date the recall frame must cite.
const BLOCK_ID = "0189aaaa-0000-7000-8000-000000000000";
const BLOCK_DAY = new Date(parseInt("0189aaaa0000", 16)).toISOString().slice(0, 10);

/** A temp repo with NO graph artifact (empty bootstrap) and one folded block. */
async function repoWithBlock() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w2-"));
  await saveBlock(dir, {
    id: BLOCK_ID,
    text: "Q: which modules import a.mjs\nA: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.",
  });
  return dir;
}

function sink() {
  const out = new PassThrough();
  out.setEncoding("utf8");
  let text = "";
  out.on("data", (c) => (text += c));
  return { out, text: () => text };
}

test("W2: a relevant recalled block answers the miss — framed, cited, hint kept below", async () => {
  const dir = await repoWithBlock();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") }; // no artifact → empty graph → miss
    const { answer, record } = await runTurn("which modules import a.mjs", { config, memoryDir: dir });
    assert.match(answer, /^you asked about this before \(session 0189aaaa, \d{4}-\d{2}-\d{2}\):/,
      "framed + cited with the session short-id and date");
    assert.ok(answer.includes(BLOCK_DAY), "the date is the uuidv7-decoded day");
    assert.match(answer, /Q: which modules import a\.mjs/);
    assert.match(answer, /A: app\/lib\/b\.mjs and app\/lib\/c\.mjs/);
    assert.match(answer, /is empty — no entities to answer from/,
      "the engine's own honest miss (the empty-bootstrap hint here) is kept below");
    assert.equal(record.via, "recall");
    assert.equal(record.miss, false, "memory answered it — no longer recorded as a blank");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W2: an irrelevant memory leaves the honest miss byte-unchanged", async () => {
  const dir = await repoWithBlock();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const query = "which functions call zebra";
    const withMemory = await runTurn(query, { config, memoryDir: dir });
    clearCache();
    const bare = await runTurn(query, { config });
    assert.equal(withMemory.answer, bare.answer, "no recall → identical miss answer");
    assert.doesNotMatch(withMemory.answer, /you asked about this before/);
    assert.equal(withMemory.record.via, "composed");
    assert.equal(withMemory.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W2: a bare runTurn (no memoryDir) never consults memory", async () => {
  const dir = await repoWithBlock();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const { answer, record } = await runTurn("which modules import a.mjs", { config });
    assert.doesNotMatch(answer, /you asked about this before/);
    assert.equal(record.miss, true);
    assert.equal(record.via, "composed");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W2: the explicit recall forms work after a real session folds (end-to-end)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w2-e2e-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
    clearCache();
    const s1 = sink();
    await runChat({
      repoPath: dir,
      input: Readable.from(["which modules import a.mjs\n", "/exit\n"]),
      output: s1.out,
    });
    assert.match(s1.text(), /app\/lib\/b\.mjs/, "session 1 answered from the graph");

    clearCache();
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    for (const q of ["what did i ask before", "what did we talk about"]) {
      const { answer, record } = await runTurn(q, { config, memoryDir: dir });
      assert.match(answer, /^last time \(session [0-9a-f]{8}, \d{4}-\d{2}-\d{2}\) you asked:/, q);
      assert.match(answer, /"which modules import a\.mjs"/, `${q} lists the folded question`);
      assert.equal(record.via, "recall");
      assert.equal(record.miss, false);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W2: the explicit form with nothing folded is an honest recall-miss", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w2-empty-"));
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const { answer, record } = await runTurn("what did i ask before", { config, memoryDir: dir });
    assert.match(answer, /nothing to recall yet/);
    assert.equal(record.via, "recall");
    assert.equal(record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W2: the relevance floor is exported and conservative", () => {
  assert.ok(RECALL_MIN_SCORE >= 1.5, "a frame-word coincidence (~1.0) must stay below the floor");
});
