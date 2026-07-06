// quickwins.test.mjs — the 0.8.1 quick-win regression pins. Each block locks a
// bounded playtest fix by ROUTING (never grammar rigidity, never an LLM), so a
// later change that silently un-fixes one fails HERE, in `npm test`.
//
//   1. singular "what is a test" reaches the relation-concept force (chat.mjs
//      relationTermOf widening) — without admitting the frozen am-meta-imports
//      ambiguity or preempting a real schema predicate ("what is a contains").
//   2. "who touched X" renders a friendly commit ref (short sha + author), not a
//      raw sha (ask.mjs commitRefOf) — degrading to the sha alone with no author.
//   3. "what tests cover X" honest-empty reads cleanly ("No tests cover X."), not
//      the "…whose module directly tests cover X" garble (ask.mjs miss renderer) —
//      while the frozen "which modules test X" wording is left byte-exact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask } from "../src/ask.mjs";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE = new URL("./fixtures/entities.fixture.json", import.meta.url);
const FIXTURE_PAYLOAD = JSON.parse(await readFile(FIXTURE, "utf8"));
const graph = parseEntities(ingestSchemaDocs(structuredClone(FIXTURE_PAYLOAD)));

/** A temp repo whose .tmct/graph.json IS the writer-ingested fixture (a producer runs
 *  ingestSchemaDocs before writing; the product loader — server.mjs — does not), so
 *  the schema-doc individuals a real shipped graph carries are present. The end-to-end
 *  runTurn path loads it from config exactly as the real shell does. */
async function repoWithFixture() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-qw-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const payload = structuredClone(FIXTURE_PAYLOAD);
  ingestSchemaDocs(payload);
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

// ── Fix 1: singular "what is a test" (meta shape) reaches the relation force ──

test("fix1: 'what is a test' composes the SAME relation-concept answer as 'what are the tests'", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const singular = await runTurn("what is a test", { config, graph });
    clearCache();
    const plural = await runTurn("what are the tests", { config, graph });
    assert.equal(singular.record.miss, false, "the singular meta shape is no longer an honest miss");
    assert.equal(singular.answer, plural.answer,
      "'what is a test' fires the relation-concept force identically to its plural");
    assert.match(singular.answer, /^A test is code that exercises/, "the curated relation definition leads");
    assert.match(singular.answer, /tests app\/lib\/b\.mjs/, "real example test EDGES follow");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fix1: the frozen am-meta-imports ambiguity is NOT admitted (a different shape)", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const r = await runTurn("what does imports mean", { config, graph });
    assert.match(r.answer, /could mean more than one thing/,
      "'what does imports mean' keeps its honest ambiguity surround — the relation force never preempts it");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fix1: a relation word that IS a real schema predicate keeps its schema meta answer", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const r = await runTurn("what is a contains", { config, graph });
    assert.match(r.answer, /contains is a predicate \(relation\) in the graph's schema/,
      "a resolvable schema predicate (non-miss) is untouched by the widening");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fix1: a non-relation unknown term still declines to the honest vocabulary miss", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const r = await runTurn("what is a widget", { config, graph });
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /isn't a term in this graph's own vocabulary/,
      "'widget' is not a RELATION_TERM, so the relation force declines and the miss stands");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

