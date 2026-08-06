// Recall seam tests — retrieveBlocks feeding the honest-miss path.
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
import { runTurn, runChat, RECALL_MIN_SCORE } from "../../src/services/chat.mjs";
import { saveBlock } from "../../src/adapters/memory/blocks.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import * as source from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));

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

test("recall: a relevant recalled block answers the miss — framed, cited, hint kept below", async () => {
  const dir = await repoWithBlock();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") }; // no artifact → empty graph → miss
    // codeDomainActive: true — this test pins the CODE-domain wall's own wording
    // kept below a recall; the neutrality tier (test/estate) pins the inactive
    // (neutral) wording separately.
    const { answer, record } = await runTurn("which modules import a.mjs", { config, memoryDir: dir, codeDomainActive: true });
    assert.match(answer, /^you asked about this before \(session 0189aaaa, \d{4}-\d{2}-\d{2}\):/,
      "framed + cited with the session short-id and date");
    assert.ok(answer.includes(BLOCK_DAY), "the date is the uuidv7-decoded day");
    assert.match(answer, /Q: which modules import a\.mjs/);
    assert.match(answer, /A: app\/lib\/b\.mjs and app\/lib\/c\.mjs/);
    assert.match(answer, /no code graph is loaded in this session/,
      "the engine's own honest miss (the empty-bootstrap wall here) is kept below");
    assert.equal(record.via, "recall");
    assert.equal(record.miss, false, "memory answered it — no longer recorded as a blank");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("recall: an irrelevant memory leaves the honest miss byte-unchanged", async () => {
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

test("recall: a bare runTurn (no memoryDir) never consults memory", async () => {
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

test("recall: the explicit recall forms work after a real session folds (end-to-end)", async () => {
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

test("recall: the explicit form with nothing folded is an honest recall-miss", async () => {
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

test("recall: the relevance floor is exported and conservative", () => {
  assert.ok(RECALL_MIN_SCORE >= 1.5, "a frame-word coincidence (~1.0) must stay below the floor");
});

// ---- 0.8.2 recall hygiene: nested recall-of-recall-of-wall + loose matching ----

/** A temp repo with NO graph artifact and one block of the given text. */
async function repoWithBlockText(text) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w2-hyg-"));
  await saveBlock(dir, { id: BLOCK_ID, text });
  return dir;
}

/** Assert query against a repo carrying `blockText` produces NO recall and the
 *  miss stands byte-unchanged (identical to the memory-less answer). */
async function assertNoRecall(blockText, query) {
  const dir = await repoWithBlockText(blockText);
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const withMemory = await runTurn(query, { config, memoryDir: dir });
    clearCache();
    const bare = await runTurn(query, { config });
    assert.doesNotMatch(withMemory.answer, /you asked about this before/, `"${query}" must not recall`);
    assert.equal(withMemory.answer, bare.answer, `"${query}" miss byte-unchanged`);
    assert.notEqual(withMemory.record.via, "recall");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
}

test("hygiene: a folded WALL answer is never replayed as a memory", async () => {
  await assertNoRecall(
    "Q: who owns billing.mjs\n" +
    'A: couldn\'t parse this as a graph question. Try: "which modules import <name>". Type /help for all query shapes.',
    "who owns billing.mjs", // a genuine re-ask — but the stored A is the wall, so the miss stands
  );
});

test("hygiene: a nested recall preamble is never replayed (no recall-of-recall)", async () => {
  await assertNoRecall(
    "Q: which modules import a.mjs\n" +
    "A: you asked about this before (session 0189aaaa, 2023-08-01): Q: which modules import a.mjs A: app/lib/b.mjs.",
    "which modules import a.mjs",
  );
});

test("hygiene: a Q-only pair (no answer) is never replayed", async () => {
  await assertNoRecall("Q: which modules import a.mjs", "which modules import a.mjs");
});

test("hygiene: path-noise-only overlap never recalls (src/mjs tokens are stopwords)", async () => {
  await assertNoRecall(
    "Q: who touched src/core/store.mjs\nA: store.mjs was touched by commit abc123 (2 days ago).",
    "who owns src/handlers/tasks.mjs",
  );
});

test("hygiene: a single plain shared content word is not enough (needs a dotted token or ≥2 words)", async () => {
  await assertNoRecall(
    "Q: which modules import config.mjs\nA: config.mjs is imported by app/lib/b.mjs.",
    "which modules parse yaml",
  );
});

test("hygiene: a genuine re-ask with a substantive stored answer STILL recalls, via recall", async () => {
  const dir = await repoWithBlockText(
    "Q: which modules import a.mjs\nA: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.",
  );
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const { answer, record } = await runTurn("which modules import a.mjs", { config, memoryDir: dir });
    assert.match(answer, /^you asked about this before \(session 0189aaaa/);
    assert.match(answer, /A: app\/lib\/b\.mjs/);
    assert.equal(record.via, "recall");
    assert.equal(record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Bug A (0.8.2 follow-up): explicit entity∧predicate conjunction + a
// recall-then-wall shortens on repeat exactly like a plain wall does ----

test("hygiene: a predicate mismatch never recalls (entity token shared, predicate isn't)", async () => {
  // "who touched X" and "who owns X" share the dotted entity token "billing.mjs"
  // but NOT a predicate word — the old OR-shaped test recalled off the shared
  // entity token alone; the new conjunction correctly rejects it.
  await assertNoRecall(
    "Q: who touched billing.mjs\nA: billing.mjs was touched by commit abc123 (2 days ago).",
    "who owns billing.mjs",
  );
});

test("hygiene: an entity mismatch never recalls (predicate shared, entity token isn't)", async () => {
  // Both questions share the predicate word "import" and the directory segment
  // "handlers", which used to satisfy the old ≥2-shared-word branch on its own —
  // but the actual FILE differs (logger.mjs vs tasks.mjs), so this must not recall.
  await assertNoRecall(
    "Q: which modules import src/handlers/logger.mjs\nA: app/lib/b.mjs imports src/handlers/logger.mjs.",
    "which modules import src/handlers/tasks.mjs",
  );
});

test("hygiene: a recall-then-wall's trailing miss text shortens on the 2nd identical turn", async () => {
  // "who owns billing.mjs really truly" shares the predicate word "owns" and the
  // dotted entity token "billing.mjs" with the stored Q, so it recalls — but the
  // engine's OWN parse of this exact live query is a genuine grammar-wall miss
  // (no recognized relation verb), so the trailing text after the recall frame
  // must still shorten on repeat exactly like a plain (non-recall) wall does.
  const dir = await mkdtemp(join(tmpdir(), "tmct-w2-hyg-wall-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
    await saveBlock(dir, {
      id: BLOCK_ID,
      text: "Q: who owns billing.mjs\nA: billing.mjs is owned by Priya, per the last teach session.",
    });
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const graph = parseEntities(await source.fetchEntities(config));
    const q = "who owns billing.mjs really truly";

    const t1 = await runTurn(q, { config, graph, memoryDir: dir });
    assert.equal(t1.record.via, "recall");
    assert.match(t1.answer, /^you asked about this before/);
    // First occurrence: the trailing text is the SHORT tailored hint (the wall
    // opening still appears, just with the 2-example short form, not the raw
    // full grammar-cheat-sheet dump).
    assert.match(t1.answer, /couldn't parse this as a graph question\. Try:/);
    assert.match(t1.answer, /"who touched <name>"/, "the short tailored hint, not the full rephraseHint dump");

    const t2 = await runTurn(q, { config, graph, memoryDir: dir, last: t1.last });
    assert.equal(t2.record.via, "recall");
    assert.match(t2.answer, /^you asked about this before/);
    // Second identical turn: the trailing text collapses to the wall-repeat
    // one-liner, which does NOT match WALL_MISS_RE (self-limiting, per the
    // existing composed-path convention) — so the raw wall opening no longer
    // appears anywhere in the answer.
    assert.doesNotMatch(t2.answer, /couldn't parse this as a graph question\. Try:/);
    assert.match(t2.answer, /still couldn't parse that/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
