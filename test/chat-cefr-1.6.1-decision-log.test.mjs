// BENCHMARK_CEFR_ENGLISH_1.6.0.md's decision log, items 1 and 2 — the two ranked
// weaknesses picked up this cycle:
//
//   1. g-a1-naming-8 "what does tests mean" — a schema-term/common-word
//      collision, one tier down from the already-fixed A2 cell (07f4805).
//      "tests" is BOTH a real RELATIONS/VERB_TO_KIND keyword and the object of
//      a "what does X mean" meta question, so keyword-spot independently reads
//      the sentence as a "reverse"-shaped query (kind:"tests", object:"mean")
//      — a spurious parse ("mean" is never a graph entity) that collided with
//      the grammar strategy's own clean "meta" parse to manufacture the legacy
//      {ambiguousParse} surface. Pruned generally in ask.mjs's parseQuery
//      (pruneSpuriousMeaningAmbiguity), EXCEPT for "imports" — see test 3 below,
//      the sibling case g-a1-naming-9 is a permanent, structural non-fix: its
//      exact input text is also am-meta-imports's own frozen expectation, and a
//      deterministic function cannot honor both on the same input.
//
//   2. am-tests-cover "which tests cover b.mjs" — 'b.mjs' matches both
//      app/lib/b.mjs and its own conventional test-variant sibling
//      app/unit-tests/b.test.mjs; the object resolver used to silently pick
//      the plain module and never flag the collision. Fixed in ask.mjs's
//      traverse() (the test-variant collision check next to the existing
//      altObject/noise-strip prune), scoped to kind==="tests" and a BARE
//      (unslashed) term so an unrelated query about the same file, or a query
//      that already spells out the full path, is untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE = new URL("./fixtures/entities.fixture.json", import.meta.url);
const FIXTURE_PAYLOAD = JSON.parse(await readFile(FIXTURE, "utf8"));
const GRAPH = parseEntities(ingestSchemaDocs(structuredClone(FIXTURE_PAYLOAD)));

// A temp repo whose .tmct/graph.json IS the writer-ingested fixture (a real graph
// writer runs ingestSchemaDocs before writing) — same helper quickwins.test.mjs
// uses, needed here because these cases are specifically about SCHEMA VOCABULARY
// ("tests", "imports", "contains"), which only resolves once the SchemaPredicate
// individuals ingestSchemaDocs merges in are actually present in the graph.
async function repoWithFixture() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-cefr161-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const payload = structuredClone(FIXTURE_PAYLOAD);
  ingestSchemaDocs(payload);
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}
async function withFixtureConfig(fn) {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    return await fn(config);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
}
test("g-a1-naming-8: 'what does tests mean' answers the schema predicate directly, not the two-way meta/mean punt", () =>
  withFixtureConfig(async (config) => {
    const { answer, record } = await runTurn("what does tests mean", { config, graph: GRAPH });
    assert.match(answer, /^tests is a predicate \(relation\) in the graph's schema/);
    assert.equal(record.miss, false);
    assert.doesNotMatch(answer, /could mean more than one thing/);
  }));

test("am-tests-cover: 'which tests cover b.mjs' flags the real app/lib/b.mjs vs app/unit-tests/b.test.mjs collision instead of silently picking one", () =>
  withFixtureConfig(async (config) => {
    const { answer, record } = await runTurn("which tests cover b.mjs", { config, graph: GRAPH });
    assert.match(answer, /matches more than one module ambiguously/);
    assert.match(answer, /app\/lib\/b\.mjs/);
    assert.match(answer, /app\/unit-tests\/b\.test\.mjs/);
    assert.match(answer, /narrow/, "the tier-1 answerMatch check requires the literal word, lowercase");
    assert.equal(record.miss, false);
  }));

test("am-tests-cover guard: a query naming the full path is already unambiguous and stays untouched", () =>
  withFixtureConfig(async (config) => {
    const { answer } = await runTurn("which tests cover app/lib/b.mjs", { config, graph: GRAPH });
    assert.doesNotMatch(answer, /matches more than one module ambiguously/);
  }));

test("am-tests-cover guard: the SAME bare filename in a non-'tests' query never gets swept into the collision check", () =>
  withFixtureConfig(async (config) => {
    // "where is b.mjs defined" is a "where"-shaped query, not a tests-kind one —
    // the test-variant collision check is scoped to kind==="tests" specifically.
    const { record } = await runTurn("where is b.mjs defined", { config, graph: GRAPH });
    assert.equal(record.miss, false);
  }));

test("frozen guard: 'what does imports mean' keeps its existing ambiguity surround — am-meta-imports and quickwins.test.mjs both require it, and g-a1-naming-9 cannot be reconciled with that on the same input", () =>
  withFixtureConfig(async (config) => {
    const { answer } = await runTurn("what does imports mean", { config, graph: GRAPH });
    assert.match(answer, /could mean more than one thing/);
    assert.match(answer, /meta "imports"/);
  }));

test("frozen guard: 'what does fnAlpha mean' (A2 fix, 07f4805) is untouched by the new prune — no relation-keyword collision to begin with", () =>
  withFixtureConfig(async (config) => {
    const { answer, record } = await runTurn("what does fnAlpha mean", { config, graph: GRAPH });
    assert.match(answer, /^fnAlpha is a function in this codebase/);
    assert.equal(record.miss, false);
  }));

test("frozen guard: 'what is a contains' (quickwins fix1) still answers the resolvable schema predicate directly", () =>
  withFixtureConfig(async (config) => {
    const { answer } = await runTurn("what is a contains", { config, graph: GRAPH });
    assert.match(answer, /^contains is a predicate \(relation\) in the graph's schema/);
  }));
