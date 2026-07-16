// The RETAINED SHOWCASE — the five most complex sequences tmct has achieved,
// frozen as deterministic regression tests (CHATBENCH cycles 1-2; the "demo
// reel" of SKILL_TUNING_CYCLE.md step 6). These run in unit-test timescale
// (no judge, no network): if any of them regresses, a cycle's PASS is void
// regardless of what the mean does.
//
//   1. the full-stack session: focus → pronoun → declarative memory →
//      vocative+filler+double-typo repair → aggregate → conversational close
//   2. cross-session memory: session 2 counts session 1 from the graph the
//      conversation itself wrote
//   3. typo-onto-schema-trap repair with a receipt (tf-modles)
//   4. the ambiguity surround ("this could mean more than one thing")
//   5. the honest empty with a traversal receipt, through noise
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, PassThrough } from "node:stream";
import { runTurn, runChat } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { ingestSchemaDocs } from "../../src/schema-docs.mjs";
import { loadMemory, FACT_CLASS } from "../../src/adapters/memory/core.mjs";

const FIXTURE = new URL("../fixtures/entities.fixture.json", import.meta.url).pathname;

function sink() {
  const out = new PassThrough();
  out.setEncoding("utf8");
  let text = "";
  out.on("data", (c) => (text += c));
  return { out, text: () => text };
}

/** A temp repo whose .tmct/graph.json is the fixture run through the same
 *  writer pipeline a real producer uses (ingestSchemaDocs before write). */
async function repoWithIngestedFixture() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-showcase-"));
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  ingestSchemaDocs(payload);
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

test("showcase 1: focus → pronoun → declarative memory → noisy typo repair → count → bye", async () => {
  const dir = await repoWithIngestedFixture();
  try {
    const input = Readable.from([
      "/describe app/lib/a.mjs\n",
      "what calls it\n",
      "every module is a component\n",
      "hey tmct, i was wondering whcih modules imprt a.mjs\n",
      "how many classes are there\n",
      "bye\n",
    ]);
    const { out, text } = sink();
    clearCache();
    await runChat({ repoPath: dir, input, output: out });
    const t = text();
    assert.match(t, /app\/lib\/a\.mjs — Module/, "describe renders the module");
    assert.match(t, /scripts\/g\.mjs\./, "pronoun 'it' resolves to the described module");
    assert.match(t, /noted — remembered 1 fact: module rdfs:subClassOf component/, "declarative is remembered");
    assert.match(t, /app\/lib\/b\.mjs and app\/lib\/c\.mjs and app\/lib\/e\.mjs/, "vocative+filler+double-typo query still answers");
    assert.match(t, /3 classes\./, "aggregate count");
    assert.match(t, /Bye — flushing the session log/, "conversational close");
    const m = await loadMemory(dir);
    const fact = m.individuals.find((i) => i.class === FACT_CLASS);
    assert.ok(fact, "the remembered fact is durably in .tmct/memory/graph.json");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("showcase 2: cross-session memory — session 2 counts session 1", async () => {
  const dir = await repoWithIngestedFixture();
  try {
    clearCache();
    const s1 = sink();
    await runChat({
      repoPath: dir,
      input: Readable.from(["which modules import a.mjs\n", "/exit\n"]),
      output: s1.out,
    });
    assert.match(s1.text(), /app\/lib\/b\.mjs/, "session 1 answers");
    clearCache(); // separate processes in real life; the cache is process-scoped
    const s2 = sink();
    await runChat({
      repoPath: dir,
      input: Readable.from(["how many sessions are there\n", "/exit\n"]),
      output: s2.out,
    });
    assert.match(s2.text(), /1 session\./, "session 2 sees session 1 in the graph the conversation wrote");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("showcase 3: typo onto the schema trap repairs with a receipt (tf-modles)", async () => {
  const dir = await repoWithIngestedFixture();
  try {
    clearCache();
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const { answer } = await runTurn("which modles import a.mjs", { config });
    assert.match(answer, /read as "which modules import a\.mjs"/, "repair receipt shown");
    assert.match(answer, /app\/lib\/b\.mjs and app\/lib\/c\.mjs and app\/lib\/e\.mjs/, "and the right answer follows");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("showcase 4: the ambiguity surround — distinct readings are RESOLVED and shown, not just described", async () => {
  const { answer } = await runTurn("which classes extends Base and couples to app/lib/b.mjs", {
    config: { graphFile: FIXTURE },
  });
  assert.match(answer, /this could mean more than one thing/, "ambiguity is surfaced");
  assert.match(answer, /1\)/, "reading 1 offered");
  assert.match(answer, /2\)/, "reading 2 offered");
  // each reading now carries its own REAL resolved answer, not a bare "try rephrasing"
  // punt — same honest admission of ambiguity, backed by real content for both branches.
  assert.match(answer, /no class named/, "reading 1's real honest-miss answer is shown");
  assert.match(answer, /no imports edge found/, "reading 2's real honest-miss answer is shown");
});

test("showcase 5: the symbol-level caller surfaced through noise (the callsSymbol edge)", async () => {
  // CORRECTNESS FIX (cycle W2P): this case previously PINNED the WRONG honest-empty
  //   BEFORE: "No modules found whose module directly calls fnAlpha. (traversal: calls
  //            edges where object = fnAlpha)"   [record.miss === true]
  // The fixture records a real symbol-level caller — Widget.render --callsSymbol--> fnAlpha
  // — that the old module-coarse `calls` scan silently ignored. A bare "what calls fnAlpha"
  // now reads the fn/method-precise callsSymbol edge (like "which functions call X" already
  // did), so the honest answer is Widget.render, WITH its module (app/lib/b.mjs) as its site:
  //   AFTER: "in app/lib/b.mjs there is function Widget.render()."   [record.miss === false]
  const { answer, record } = await runTurn("i was wondering what calls fnAlpha", {
    config: { graphFile: FIXTURE },
  });
  assert.match(answer, /Widget\.render/, "the real symbol-level caller is named, not a false empty");
  assert.match(answer, /app\/lib\/b\.mjs/, "with its module (site), through the 'i was wondering' noise");
  assert.equal(record.miss, false, "a recorded caller exists — no longer the honest miss the old scan reported");
});
